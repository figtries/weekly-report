'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { commitSetupAction } from '@/lib/actions';
import type { SetupDraft, SetupDraftRow } from '@/lib/setup-draft';
import {
  PATTERN_HINTS,
  PATTERN_LABELS,
  evenWeights,
  generatePlanCurve,
  parseWbsText,
  weightsFromBoq,
} from '@/lib/setup';
import { fmtNum, fmtPct, formatRupiah } from '@/lib/analysis';
import type { DistributionPattern } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import PlanCurvePreview from './PlanCurvePreview';

/**
 * Setting a project up is the part of project control that actually needs
 * experience — and the reason a new hire can't start from a blank screen. The
 * wizard removes the two judgement calls that stop them:
 *
 *   Step 3 asks for prices, not weights, so `bobot` is derived and the total
 *   closes at 100 by construction.
 *   Step 4 asks for dates and a shape, so the plan curve is generated instead
 *   of being built by hand in Excel.
 *
 * Everything is held in local state until step 5. Nothing touches the database
 * until the baseline is deliberately locked, so abandoning the wizard costs
 * nothing.
 */

const STEPS = [
  { key: 'identitas', label: 'Identity', hint: 'Name, contract, duration' },
  { key: 'wbs', label: 'WBS', hint: 'Build it or paste from Excel' },
  { key: 'nilai', label: 'Value', hint: 'Prices → weights, automatically' },
  { key: 'jadwal', label: 'Schedule', hint: 'Start, finish, spread' },
  { key: 'baseline', label: 'Baseline', hint: 'Review the curve, then lock' },
] as const;

const SAMPLE = `1\tPekerjaan Persiapan
1.1\tMobilisasi Peralatan\t1\tLs
1.2\tPembersihan Lahan\t2400\tm2
2\tPekerjaan Sipil
2.1\tGalian Pondasi\t180\tm3
2.2\tPembesian\t14500\tkg
2.3\tPengecoran Pondasi\t96\tm3
3\tPekerjaan Mekanikal
3.1\tErection Piping Fuel Gas\t340\tm
3.2\tGrouting Baseplate\t18\tm3
4\tPekerjaan Elektrikal
4.1\tCable Pulling Power & Control\t1250\tm
4.2\tTermination & Testing\t1\tLs
5\tCommissioning
5.1\tPre-Commissioning\t1\tLs
5.2\tStart Up & Running Test\t1\tLs`;

export default function SetupWizard({ hasExistingProject }: { hasExistingProject: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [project, setProject] = useState({
    name: '',
    contractNo: '',
    customer: '',
    contractor: '',
    workLocation: '',
    weekAnchorEndDate: '',
  });
  const [totalWeeks, setTotalWeeks] = useState(52);
  const [wbsText, setWbsText] = useState('');
  const [rows, setRows] = useState<SetupDraftRow[]>([]);
  const [useEven, setUseEven] = useState(false);

  // --- derived -------------------------------------------------------------

  // A row is a leaf when nothing deeper follows it before the tree steps back
  // out — the same rule lib/rollup.ts uses, applied to the flat draft.
  const leafFlags = useMemo(
    () => rows.map((r, i) => !(rows[i + 1] && rows[i + 1].level > r.level)),
    [rows]
  );
  const leafIdx = useMemo(
    () => leafFlags.map((isLeaf, i) => (isLeaf ? i : -1)).filter((i) => i >= 0),
    [leafFlags]
  );

  const pricing = useMemo(() => {
    const ids = leafIdx.map(String);
    const boq = leafIdx.map((i) => ({
      leafId: String(i),
      unitPrice: rows[i].unitPrice,
      qty: rows[i].vol ?? 1,
    }));
    return weightsFromBoq(ids, boq);
  }, [leafIdx, rows]);

  const weights = useMemo(
    () => (useEven || pricing.contractValue <= 0 ? evenWeights(leafIdx.map(String)) : pricing.weights),
    [useEven, pricing, leafIdx]
  );

  const curve = useMemo(() => {
    if (!leafIdx.length) return null;
    return generatePlanCurve(
      leafIdx.map((i) => ({ id: String(i), bobot: weights[String(i)] ?? 0 })),
      leafIdx.map((i) => ({
        leafId: String(i),
        startWeek: rows[i].startWeek,
        finishWeek: Math.max(rows[i].startWeek, rows[i].finishWeek),
        pattern: rows[i].pattern,
      })),
      totalWeeks
    );
  }, [leafIdx, rows, weights, totalWeeks]);

  const weightTotal = Object.values(weights).reduce((s, v) => s + v, 0);

  // --- step gating ---------------------------------------------------------

  const canAdvance = [
    project.name.trim().length > 0 && totalWeeks >= 1,
    rows.length > 0,
    useEven || pricing.contractValue > 0,
    leafIdx.every((i) => rows[i].finishWeek >= rows[i].startWeek),
    true,
  ][step];

  function importWbs(text: string) {
    const parsed = parseWbsText(text);
    setRows(
      parsed.map((p) => ({
        ...p,
        unitPrice: 0,
        startWeek: 1,
        finishWeek: totalWeeks,
        pattern: 'scurve' as DistributionPattern,
      }))
    );
  }

  function patchRow(i: number, patch: Partial<SetupDraftRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function commit() {
    setError(null);
    const draft: SetupDraft = {
      project,
      totalWeeks,
      rows,
      evenWeights: useEven || pricing.contractValue <= 0,
    };
    startTransition(async () => {
      const res = await commitSetupAction(draft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/weekly/1/control');
    });
  }

  // --- render --------------------------------------------------------------

  return (
    <div className="mx-auto max-w-5xl px-3 py-5 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Project Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Five steps. The app works out the weights and the plan curve — you fill in what you have.
        </p>
      </header>

      {/* WRAPS on a phone, shares the row from `sm` up. `flex-1` on five chips
          divides whatever width there is by five — at 320px that is 55px each,
          and the labels came out as "1 I…  2 W…  3 V…  4 S…  5 B…", which names
          nothing. Sized to their content they wrap onto a second row instead
          and every step keeps its word. The hint line stays `sm:block`, so the
          wrapped rows are one line tall and cost almost nothing. */}
      <ol className="mb-6 flex flex-wrap gap-1.5 pb-1 sm:flex-nowrap sm:overflow-x-auto">
        {STEPS.map((s, i) => {
          const state = i === step ? 'now' : i < step ? 'done' : 'todo';
          return (
            <li key={s.key} className="flex-none sm:min-w-0 sm:flex-1">
              <button
                type="button"
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                className={`flex min-h-11 w-full flex-col justify-center rounded-md border px-2.5 py-2 text-left transition-colors duration-200 ease-ios sm:min-h-0 sm:block ${
                  state === 'now'
                    ? 'border-primary/40 bg-primary/5'
                    : state === 'done'
                      ? 'bg-card hover:bg-muted/60'
                      : 'border-dashed bg-transparent opacity-60'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      state === 'todo' ? 'text-muted-foreground' : 'text-primary'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate text-xs font-medium">{s.label}</span>
                </div>
                <div className="mt-0.5 hidden truncate text-[11px] text-muted-foreground sm:block">
                  {s.hint}
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      {/* key on the step so each panel fades in on its own — one soft cue that
          the screen changed, nothing that delays the interaction. */}
      <div key={step} className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-6">
        {step === 0 && (
          <Section
            title="Project identity"
            desc="What appears in the header of every report. Editable at any time later."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project name" required>
                <Input
                  value={project.name}
                  onChange={(e) => setProject({ ...project, name: e.target.value })}
                  placeholder="Relocation of 2 GTG units to Field …"
                />
              </Field>
              <Field label="Contract number">
                <Input
                  value={project.contractNo}
                  onChange={(e) => setProject({ ...project, contractNo: e.target.value })}
                  placeholder="002/PPC60000/2025-SO"
                />
              </Field>
              <Field label="Client">
                <Input
                  value={project.customer}
                  onChange={(e) => setProject({ ...project, customer: e.target.value })}
                  placeholder="PT …"
                />
              </Field>
              <Field label="Contractor">
                <Input
                  value={project.contractor}
                  onChange={(e) => setProject({ ...project, contractor: e.target.value })}
                  placeholder="PT …"
                />
              </Field>
              <Field label="Site">
                <Input
                  value={project.workLocation}
                  onChange={(e) => setProject({ ...project, workLocation: e.target.value })}
                  placeholder="CPP …"
                />
              </Field>
              <Field label="Project duration" hint="Weeks until handover.">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={520}
                    value={totalWeeks}
                    onChange={(e) => setTotalWeeks(Math.max(1, Number(e.target.value) || 1))}
                    className="max-w-28 tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">weeks</span>
                </div>
              </Field>
            </div>
            {hasExistingProject && (
              <p className="mt-4 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                There is already an active project in this app. Finishing the wizard replaces it —
                run <code className="font-mono">npm run seed</code> to bring the demo data
                back.
              </p>
            )}
          </Section>
        )}

        {step === 1 && (
          <Section
            title="Build the WBS"
            desc="Paste from Excel. The hierarchy is read from dotted numbering (1.2.3), indentation, or a level column — whichever you have."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <Label htmlFor="wbs-paste" className="mb-1.5 block text-xs text-muted-foreground">
                  Paste here — columns: code, description, quantity, unit
                </Label>
                <Textarea
                  id="wbs-paste"
                  value={wbsText}
                  onChange={(e) => setWbsText(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  placeholder={'1\tPekerjaan Persiapan\n1.1\tMobilisasi\t1\tLs'}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => importWbs(wbsText)} disabled={!wbsText.trim()}>
                    Read WBS
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setWbsText(SAMPLE);
                      importWbs(SAMPLE);
                    }}
                  >
                    Pakai contoh
                  </Button>
                  {rows.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setRows([])}>
                      Kosongkan
                    </Button>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <div className="mb-1.5 text-xs text-muted-foreground">
                  Hasil baca — {rows.length} baris, {leafIdx.length} item berbobot
                </div>
                <div className="max-h-80 overflow-auto rounded-md border">
                  {rows.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Nothing read yet.</p>
                  ) : (
                    <ul className="divide-y text-sm">
                      {rows.map((r, i) => (
                        <li
                          key={i}
                          className="flex items-baseline gap-2 px-3 py-1.5"
                          style={{ paddingLeft: `${0.75 + (r.level - 1) * 0.85}rem` }}
                        >
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            {r.wbsCode}
                          </span>
                          <span className={leafFlags[i] ? '' : 'font-medium'}>{r.deskripsi}</span>
                          {r.vol !== null && (
                            <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                              {fmtNum(r.vol)} {r.satuan ?? ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section
            title="Price per item"
            desc="Fill in the unit prices from the BOQ — the weights work themselves out and are guaranteed to total 100%. No weight is ever guessed."
          >
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Contract value
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  {useEven ? '—' : formatRupiah(pricing.contractValue)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Total weight
                </div>
                <div className="text-lg font-semibold tabular-nums">{fmtPct(weightTotal)}</div>
              </div>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={useEven}
                  onChange={(e) => setUseEven(e.target.checked)}
                  className="size-5 accent-primary sm:size-4"
                />
                <span>No BOQ yet — use even weights for now</span>
              </label>
            </div>

            {useEven && (
              <p className="mb-3 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Even weights are not real weights. The project still runs, but its deviation cannot
                be trusted until the BOQ is filled in — and the report cannot speak in money.
              </p>
            )}

            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Volume</th>
                    <th className="px-3 py-2 text-right font-medium">Harga satuan</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leafIdx.map((i) => {
                    const r = rows[i];
                    const val = r.unitPrice * (r.vol ?? 1);
                    return (
                      <tr key={i}>
                        <td className="px-3 py-1.5">
                          <div className="leading-snug">{r.deskripsi}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {r.wbsCode}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {r.vol !== null ? `${fmtNum(r.vol)} ${r.satuan ?? ''}` : '1 Ls'}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {/* Native input on purpose: this table can run to
                              hundreds of rows and a Radix control per row is
                              what makes a page like this stutter on a phone.
                              See AGENTS.md — Radix per screen, never per row. */}
                          <input
                            type="text"
                            inputMode="numeric"
                            disabled={useEven}
                            value={r.unitPrice ? r.unitPrice.toLocaleString('id-ID') : ''}
                            onChange={(e) =>
                              patchRow(i, {
                                unitPrice: Number(e.target.value.replace(/\D/g, '')) || 0,
                              })
                            }
                            placeholder="0"
                            className="h-8 w-28 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none transition-colors duration-150 ease-ios focus:border-primary/60 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {val ? formatRupiah(val) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {fmtPct(weights[String(i)] ?? 0, 3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section
            title="Schedule per item"
            desc="Start week, finish week, and the shape of the spread. The plan curve falls out of those three."
          >
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(PATTERN_LABELS) as DistributionPattern[]).map((p) => (
                <div key={p} className="rounded-md border bg-muted/30 p-2.5">
                  <div className="text-xs font-semibold">{PATTERN_LABELS[p]}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {PATTERN_HINTS[p]}
                  </div>
                </div>
              ))}
            </div>

            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Start</th>
                    <th className="px-3 py-2 text-right font-medium">Finish</th>
                    <th className="px-3 py-2 text-left font-medium">Pola</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leafIdx.map((i) => {
                    const r = rows[i];
                    const bad = r.finishWeek < r.startWeek;
                    return (
                      <tr key={i} className={bad ? 'bg-destructive/5' : undefined}>
                        <td className="px-3 py-1.5">
                          <div className="leading-snug">{r.deskripsi}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {r.wbsCode}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <WeekInput
                            value={r.startWeek}
                            max={totalWeeks}
                            onChange={(v) => patchRow(i, { startWeek: v })}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <WeekInput
                            value={r.finishWeek}
                            max={totalWeeks}
                            invalid={bad}
                            onChange={(v) => patchRow(i, { finishWeek: v })}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={r.pattern}
                            onChange={(e) =>
                              patchRow(i, { pattern: e.target.value as DistributionPattern })
                            }
                            className="h-8 rounded-md border bg-background px-2 text-sm outline-none transition-colors duration-150 ease-ios focus:border-primary/60"
                          >
                            {(Object.keys(PATTERN_LABELS) as DistributionPattern[]).map((p) => (
                              <option key={p} value={p}>
                                {PATTERN_LABELS[p]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!canAdvance && (
              <p className="mt-2 text-xs text-destructive">
                Some items finish in an earlier week than they start.
              </p>
            )}
          </Section>
        )}

        {step === 4 && (
          <Section
            title="Plan curve"
            desc="Built from the schedule and weights in the steps before — never imported. Revise the schedule later and this curve recomputes itself."
          >
            {curve && <PlanCurvePreview series={curve.projectPlan} totalWeeks={totalWeeks} />}

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Summary label="Weighted items" value={fmtNum(leafIdx.length)} />
              <Summary label="Total weight" value={fmtPct(weightTotal)} />
              <Summary
                label="Contract value"
                value={useEven ? 'not filled in' : formatRupiah(pricing.contractValue)}
              />
              <Summary label="Duration" value={`${totalWeeks} weeks`} />
            </dl>

            {error && (
              <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
              <Button onClick={commit} disabled={pending || !leafIdx.length}>
                {pending ? 'Locking…' : 'Lock the baseline & start the project'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Nothing is saved until this button is pressed.
              </p>
            </div>
          </Section>
        )}
      </div>

      <nav className="mt-4 flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
            Lanjut — {STEPS[step + 1].label}
          </Button>
        )}
      </nav>
    </div>
  );
}

// --- small pieces ----------------------------------------------------------

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mb-4 mt-0.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{desc}</p>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WeekInput({
  value,
  max,
  invalid,
  onChange,
}: {
  value: number;
  max: number;
  invalid?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      max={max}
      value={value}
      onChange={(e) => onChange(Math.min(max, Math.max(1, Number(e.target.value) || 1)))}
      className={`h-8 w-16 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none transition-colors duration-150 ease-ios focus:border-primary/60 ${
        invalid ? 'border-destructive' : ''
      }`}
    />
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
