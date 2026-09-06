'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m } from 'framer-motion';
import { Calculator, Check, ChevronRight, TriangleAlert } from 'lucide-react';

import { MOTION } from '@/lib/design';
import type { WeightSummary } from '@/lib/weights';
import { applyWeightsAction, previewWeightsAction, type WeightPreview } from '@/lib/weights-actions';
import { formatMoney } from '@/lib/currency';
import CurrencyPicker from './CurrencyPicker';

/**
 * The money, in one figure and one sentence.
 *
 * This line used to carry five numbers — contract, allocated, the gap, the unit
 * total, the weight total — and three of them were the other two subtracted. It
 * read as a wall, and the two words doing the most work were the two nobody
 * outside project controls uses: "allocated" and "unpriced". A person opening
 * this screen has ONE question about the money, and it is not any of those five:
 * *is this project's money set up yet?*
 *
 * So the strip answers that and nothing else — the signed figure, a bar, and how
 * far the pricing has got. Everything that was on the line is still here, one tap
 * away under **Money**, where there is room to say each number in a full
 * sentence instead of a label nobody can expand.
 *
 * The bar is deliberately a bar. A percentage set in digits is read by
 * arithmetic; a bar is read by looking, and "how much of this is done" is
 * exactly the shape a bar was invented for.
 */
export default function ValueStrip({
  summary,
  projectId,
}: {
  summary: WeightSummary;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const money = (v: number) => formatMoney(v, summary.currency);

  const signed = summary.contractValue > 0;
  // Over 100 is possible and worth seeing as a fact rather than a full bar:
  // prices that add up to more than the contract is a real state a plan gets
  // into, and it is not the same as being finished.
  const pct = signed ? (summary.allocated / summary.contractValue) * 100 : 0;
  const over = summary.gap < -0.5;
  const closed = signed && Math.abs(summary.gap) <= 0.5;

  return (
    <>
      {/* Three parts, and BELOW 640px the bar takes a line of its own — the
          `order` is what does it. Side by side at 390px the sentence ran under
          the Money button and the two overlapped. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-6">
        <span className="order-1 flex items-center gap-2">
          <strong className="text-base font-semibold tabular-nums sm:text-lg">
            {signed ? money(summary.contractValue) : 'No contract value yet'}
          </strong>
          <CurrencyPicker projectId={projectId} currency={summary.currency} />
        </span>

        {signed && (
          <span className="order-3 flex w-full min-w-0 items-center gap-2 sm:order-2 sm:w-auto sm:flex-1">
            <span
              aria-hidden
              className="h-1.5 w-full max-w-[10rem] shrink overflow-hidden rounded-full bg-muted"
            >
              <m.span
                initial={false}
                animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                transition={{ duration: MOTION.enter, ease: MOTION.ease }}
                className={`block h-full rounded-full ${over ? 'bg-warn' : 'bg-foreground'}`}
              />
            </span>
            <span className="min-w-0 text-xs text-muted-foreground">
              {over ? (
                <span className="font-medium text-warn">
                  {money(Math.abs(summary.gap))} more than the contract
                </span>
              ) : closed ? (
                <span className="flex items-center gap-1 font-medium text-ok">
                  <Check className="size-3.5" />
                  every part has a price
                </span>
              ) : summary.allocated <= 0 ? (
                'nothing has a price against it yet'
              ) : (
                <>
                  <strong className="font-semibold tabular-nums text-foreground">
                    {pct < 1 ? pct.toFixed(1) : Math.round(pct)}%
                  </strong>{' '}
                  has a price against it
                </>
              )}
            </span>
          </span>
        )}

        <m.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => setOpen(true)}
          className="order-2 ml-auto flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:order-3"
        >
          Money
          <ChevronRight className="size-3.5" />
        </m.button>
      </div>

      <MoneyPanel
        open={open}
        onClose={() => setOpen(false)}
        summary={summary}
        projectId={projectId}
        money={money}
      />
    </>
  );
}

/**
 * Everything the strip stopped saying, said properly.
 *
 * Each figure gets a full sentence rather than a label, because the labels were
 * the problem: "allocated" and "unpriced" are project-controls words, and a
 * screen used by a 22-year-old on their first project should not need a glossary.
 */
function MoneyPanel({
  open,
  onClose,
  summary,
  projectId,
  money,
}: {
  open: boolean;
  onClose: () => void;
  summary: WeightSummary;
  projectId: string;
  money: (v: number) => string;
}) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<WeightPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const signed = summary.contractValue > 0;
  const closes = Math.abs(summary.storedTotal - 100) < 0.005;
  const missing = summary.leaves - summary.storedLeaves;
  const unitsMatch = Math.abs(summary.unitTotal - summary.contractValue) <= 0.5;

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: MOTION.duration, ease: MOTION.ease }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
            onClick={() => !pending && onClose()}
          >
            <m.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: MOTION.enter, ease: MOTION.ease }}
              className="max-h-[88vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold">Money on this project</h2>

              <div className="mt-3 space-y-2.5">
                <Line
                  label="Signed contract"
                  value={signed ? money(summary.contractValue) : '—'}
                  note={
                    signed
                      ? 'Typed by a person, never worked out from the prices. Change it under Details.'
                      : 'Nobody has typed one yet — add it under Details.'
                  }
                />

                <Line
                  label="Prices you have entered"
                  value={money(summary.allocated)}
                  note={
                    summary.pricedRows === 0
                      ? 'No row has a price on it yet.'
                      : `Added up from the ${summary.pricedRows} ${
                          summary.pricedRows === 1 ? 'row that carries' : 'rows that carry'
                        } one. A price on a branch already covers everything under it, so nothing is counted twice.`
                  }
                />

                {signed && Math.abs(summary.gap) > 0.5 && (
                  <Line
                    tone={summary.gap > 0 ? 'warn' : 'warn'}
                    label={summary.gap > 0 ? 'Still without a price' : 'More than the contract'}
                    value={money(Math.abs(summary.gap))}
                    note={
                      summary.gap > 0
                        ? 'Work that is in the plan but has no money against it yet. Put prices on those rows and this reaches zero.'
                        : 'The prices add up to more than the contract was signed for. One of the two is wrong.'
                    }
                  />
                )}

                {summary.unitCount > 0 && (
                  <Line
                    tone={unitsMatch ? 'ok' : 'warn'}
                    label={`${summary.unitCount} package${summary.unitCount === 1 ? '' : 's'}`}
                    value={money(summary.unitTotal)}
                    note={
                      unitsMatch
                        ? 'Every SPK has its own value, and together they come to exactly the contract.'
                        : 'The packages do not add up to the contract. Each one is its own contract, even when it sits inside another.'
                    }
                  />
                )}

                {summary.leaves > 0 && (
                  <Line
                    // Closing at 100 is the thing that has to be true; how many
                    // rows carry a weight is context, not a fault. Gundih has 42
                    // rows without one and a total of exactly 100.000000, and
                    // colouring that amber would call a correct project broken.
                    tone={closes ? 'ok' : 'warn'}
                    label="Weights"
                    value={`${summary.storedTotal.toFixed(2)}%`}
                    note={
                      // Said honestly either way. The old line printed "100.00%"
                      // beside "1 of 3 rows", two facts that contradict each
                      // other in the same breath.
                      !closes
                        ? missing > 0
                          ? `These do not close at 100, and ${missing} of ${summary.leaves} rows have no weight at all yet.`
                          : 'These do not close at 100, so every reported percentage is off by the difference.'
                        : missing > 0
                          ? `They close at 100. ${missing} of ${summary.leaves} rows carry no weight of their own — the rest account for the whole project.`
                          : summary.basis === 'even'
                            ? 'Spread evenly across the rows — not worked out from money.'
                            : 'Every row has one and they close at 100.'
                    }
                  />
                )}
              </div>

              {error && <p className="animate-fade-in-up mt-3 text-xs text-destructive">{error}</p>}

              <div className="mt-4 flex gap-2">
                {summary.leaves > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await previewWeightsAction(projectId);
                        if (!res.ok) {
                          setError(res.error);
                          return;
                        }
                        setPreview(res);
                      })
                    }
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-50"
                  >
                    <Calculator className="size-4" />
                    {pending ? 'Working it out…' : 'Work the weights out from the prices'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-lg bg-foreground px-5 text-sm font-medium text-background"
                >
                  Done
                </button>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>

      {preview && (
        <PreviewDialog
          preview={preview}
          money={money}
          projectId={projectId}
          onClose={() => setPreview(null)}
        />
      )}
    </>,
    document.body
  );
}

function Line({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        <strong
          className={`shrink-0 text-sm font-semibold tabular-nums ${
            tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : ''
          }`}
        >
          {value}
        </strong>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * The Recalculate button always shows its damage first. Deriving weights over an
 * imported project would move 121 of Gundih's 218 rows, because its construction
 * weights came from the workbook rather than from money — see lib/weights.ts.
 */
function PreviewDialog({
  preview: p,
  money,
  projectId,
  onClose,
}: {
  preview: WeightPreview;
  money: (v: number) => string;
  projectId: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const heavy = p.changes > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <m.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.enter, ease: MOTION.ease }}
        className="max-h-[85vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Work the weights out from the prices</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A row&apos;s weight is <strong className="text-foreground">its price ÷ the contract</strong>
          . A price on a branch is the value of everything under it; rows without one take a share of
          what is left of their parent.
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Fact label="Contract" value={money(p.contractValue)} />
          <Fact label="Prices reach" value={`${p.covers} of ${p.leaves} rows`} />
          <Fact label="Weights now" value={`${p.storedTotal.toFixed(2)}%`} />
          <Fact
            label="Would become"
            value={`${p.derivedTotal.toFixed(2)}%`}
            bad={Math.abs(p.derivedTotal - 100) > 0.5}
          />
        </dl>

        {heavy && (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
              <TriangleAlert className="size-3.5" />
              {p.changes} of {p.leaves} rows would change
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {p.basis === 'boq'
                ? 'The prices cover the whole plan, so the new weights close at 100.'
                : 'The prices do not cover the whole plan. Some of these weights were entered from a source this calculation cannot see — replacing them would lose them.'}
            </p>
            <ul className="mt-2 space-y-0.5">
              {p.biggest.map((b) => (
                <li key={b.code} className="flex items-center gap-2 text-[11px] tabular-nums">
                  <span className="w-20 shrink-0 text-muted-foreground">{b.code}</span>
                  <span className="truncate">{b.name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {b.before?.toFixed(3) ?? '—'} → {b.after?.toFixed(3) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await applyWeightsAction(projectId);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                onClose();
              })
            }
            className="h-11 flex-1 rounded-lg bg-foreground text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? 'Applying…' : `Replace ${p.changes} weights`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </m.div>
    </div>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border p-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${bad ? 'text-warn' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
