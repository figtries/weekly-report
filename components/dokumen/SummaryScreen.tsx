import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { RegisterCurve } from '@/components/dokumen/RegisterCurve';
import { verdict } from '@/components/dokumen/verdict';
import type {
  EngineeringBridge, Obstacle, RegisterNode, RegisterSummary, WeekMovement,
} from '@/lib/register-shared';
import { CODE_TONE, DEFAULT_SETTINGS, codeLabel, stageOf, type RegisterSettings } from '@/lib/register-settings';
import { cn } from '@/lib/utils';

/**
 * A register's week on one screen (4 Oct 2026, variant A of the mockups,
 * "Ledger", with the touch of luxury the user asked for: stronger type, and
 * room between the grey and the black line of every outstanding row).
 *
 * Top to bottom, the order a weekly meeting reads it in: where it stands (the
 * figure, each stage, the week's letters), how it got there (the curve beside
 * the disciplines, most behind first), and what has to happen next (Needs
 * action: what is ours to send, what the other side has had too long). Every
 * row there is a link straight into the document on Data.
 *
 * The stage names and colours are the register's own (Setup). No percentage
 * is computed here: every figure comes from lib/register.ts.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number) => Math.min(100, Math.max(0, n));
const fmt = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

const card = 'rounded-2xl bg-card shadow-[0_0_0_1px_rgba(16,24,40,.05),0_1px_2px_rgba(16,24,40,.06)]';
const title = 'text-[15px] font-bold tracking-tight text-foreground';

export function SummaryScreen({
  summary,
  groups,
  obstacles,
  movement,
  bridge,
  groupsTitle,
  settings = DEFAULT_SETTINGS,
  otherName,
  week,
}: {
  summary: RegisterSummary;
  groups: RegisterNode[];
  obstacles: Obstacle[];
  movement: WeekMovement | null;
  /** The seam to the weekly report. EDL only. */
  bridge?: EngineeringBridge | null;
  groupsTitle: string;
  /** Kept for the VDRL page's call; the table sorts the same way for both. */
  foldEmptyGroups?: boolean;
  settings?: RegisterSettings;
  /** The client's (EDL) or vendors' (VDRL) name, from the project. */
  otherName?: string;
  week: number;
}) {
  const edl = summary.register === 'edl';
  const dataHref = `/dokumen/${week}/${edl ? 'data' : 'vdrl-data'}`;
  const hasPlan = summary.plan !== null;
  const against = hasPlan ? verdict(summary.actual, summary.plan!) : null;
  const stale = summary.evidenceWeek < summary.asOfWeek;
  const other = otherName?.trim() || (edl ? 'the client' : 'vendors');

  const ranked = [...groups].sort((a, b) => {
    if (a.plan === null || b.plan === null) return (a.plan === null ? 1 : 0) - (b.plan === null ? 1 : 0) || a.actual - b.actual;
    return verdict(a.actual, a.plan).diff - verdict(b.actual, b.plan).diff;
  });

  const ours = obstacles.filter((o) => o.kind === 'late' || o.kind === 'comments' || o.kind === 'soon');
  const theirs = obstacles.filter((o) => o.kind === 'waiting');
  const stages = summary.stages.filter((s) => ['IFR', 'IFA', 'AFC'].includes(s.stage));
  // The table is narrow on a phone and again as the half-width card below xl:
  // there it drops the count and the bars and says the count under the name.
  const cols = hasPlan
    ? 'grid-cols-[minmax(0,1fr)_3rem_3rem_3.25rem] sm:grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_3.5rem_3.5rem_3.5rem] lg:grid-cols-[minmax(0,1fr)_3rem_3rem_3.25rem] xl:grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_3.5rem_3.5rem_3.5rem]'
    : 'grid-cols-[minmax(0,1fr)_3.5rem] sm:grid-cols-[minmax(0,1fr)_2.5rem_5rem_3.5rem] lg:grid-cols-[minmax(0,1fr)_3.5rem] xl:grid-cols-[minmax(0,1fr)_2.5rem_5rem_3.5rem]';
  const wide = 'max-sm:hidden lg:max-xl:hidden';
  const narrow = 'sm:max-lg:hidden xl:hidden';

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* ------------------------------------------------- where it stands */}
      <section className={cn(card, 'grid grid-cols-3 overflow-hidden lg:grid-cols-[1.35fr_1fr_1fr_1fr_1.35fr]')}>
        <div className="col-span-3 flex flex-col justify-center gap-1.5 border-b border-border/70 p-5 lg:col-span-1 lg:border-b-0 lg:border-r">
          <span className="text-[13px] font-semibold text-foreground/80">{edl ? 'Engineering progress' : 'Vendor documents'}</span>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            {/* The figure itself takes the verdict's colour: red behind plan,
                green on or ahead of it, plain with no plan to read against. */}
            <span className={cn('text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums', against ? (against.diff < 0 ? 'text-bad' : 'text-ok') : 'text-foreground')}>
              {r1(summary.actual).toFixed(1)}<span className={cn('ml-0.5 text-xl font-medium', against ? 'opacity-80' : 'text-muted-foreground')}>%</span>
            </span>
            {against && (
              <span className={cn('mb-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums', against.chip)}>
                {against.diff > 0 ? `+${against.diff.toFixed(1)} pts ahead` : against.diff === 0 ? 'On plan' : `${Math.abs(against.diff).toFixed(1)} pts behind`}
              </span>
            )}
          </div>
          <span className="text-[13px] text-foreground/75 tabular-nums">
            {hasPlan && <>Plan <b className="font-semibold text-foreground">{r1(summary.plan!).toFixed(1)}%</b> · </>}
            <b className="font-semibold text-foreground">{summary.documents}</b> documents
          </span>
          {stale && (
            <span className="w-fit rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">
              Nothing recorded since week {summary.evidenceWeek}
            </span>
          )}
        </div>
        {stages.map((s, i) => {
          const st = stageOf(settings, s.stage);
          const pct = summary.documents ? (s.reached / summary.documents) * 100 : 0;
          return (
            <div key={s.stage} className={cn('flex min-w-0 flex-col justify-between gap-2 border-b border-r border-border/70 p-3.5 sm:p-5 lg:border-b-0', i === stages.length - 1 && 'max-lg:border-r-0')}>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-[13px] font-semibold text-foreground">{st.label}</b>
                  <span className="text-[13px] font-medium text-foreground/70 tabular-nums">{pct.toFixed(1)}%</span>
                </div>
                <span className="line-clamp-2 text-xs text-foreground/65">{st.name}</span>
              </div>
              <span className="text-2xl font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums sm:text-[30px]">
                {s.reached}<span className="text-sm font-medium text-muted-foreground sm:text-base"> / {summary.documents}</span>
              </span>
              <span className="h-1.5 rounded-full bg-muted"><span className="block h-1.5 rounded-full" style={{ width: `${clamp(pct)}%`, background: st.color }} /></span>
            </div>
          );
        })}
        <div className="col-span-3 flex flex-col justify-center gap-2 p-5 lg:col-span-1">
          <span className="text-[13px] text-foreground/75">
            <b className="font-semibold text-foreground">This week</b>
            {movement && <> · {fmt(movement.startDate)} – {fmt(movement.endDate)}</>}
          </span>
          <div className="flex items-baseline gap-5 tabular-nums">
            {[
              [movement?.submitted ?? 0, edl ? 'sent' : 'received'],
              [movement?.returned ?? 0, edl ? 'back' : 'replied'],
              [movement?.approved ?? 0, 'approved'],
            ].map(([n, w]) => (
              <span key={w as string}>
                <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-foreground">{n}</span>
                <span className="ml-1 text-[13px] text-foreground/70">{w}</span>
              </span>
            ))}
          </div>
          <span className="text-[13px] text-foreground/70 tabular-nums">
            {r1(summary.thisWeek) >= 0 ? '+' : ''}{r1(summary.thisWeek).toFixed(1)} pts of progress this week
          </span>
        </div>
      </section>

      {/* --------------------------------------- how it got there, by whom */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={cn(card, 'flex flex-col p-5')}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className={title}>Week by week</h2>
            <span className="text-[13px] text-foreground/70">Cumulative progress, weighted by stage</span>
            <span className="ml-auto text-[13px] font-medium text-foreground/70 tabular-nums">Week {summary.asOfWeek}</span>
          </div>
          <div className="mt-3 flex-1">
            <RegisterCurve series={summary.series} asOfWeek={summary.asOfWeek} undated={summary.undated} />
          </div>
        </section>

        <section className={cn(card, 'flex flex-col overflow-hidden')}>
          <div className="flex items-center gap-3 px-5 pb-2 pt-5">
            <h2 className={title}>{groupsTitle}</h2>
            <span className="ml-auto text-[13px] text-foreground/70">{hasPlan ? 'Most behind first' : 'Least done first'}</span>
          </div>
          <div className={cn('grid items-center gap-x-3 border-y border-border/70 bg-muted/50 px-5 py-2 text-xs font-medium text-foreground/70', cols)}>
            <span>{edl ? 'Discipline' : 'Package'}</span><span className={cn('text-right', wide)}>Docs</span><span className={wide} />
            <span className="text-right">Actual</span>{hasPlan && <><span className="text-right">Plan</span><span className="text-right">Δ</span></>}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-none lg:max-h-[20rem]">
            {ranked.map((g) => {
              const d = g.plan !== null ? verdict(g.actual, g.plan).diff : null;
              return (
                <div key={g.id} className={cn('grid min-h-11 items-center gap-x-3 border-b border-border/50 px-5 py-1.5 text-[13.5px] last:border-b-0', cols)}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground">{g.name}</span>
                    <span className={cn('block text-xs text-foreground/60 tabular-nums', narrow)}>{g.documents} documents</span>
                  </span>
                  <span className={cn('text-right text-foreground/70 tabular-nums', wide)}>{g.documents}</span>
                  <span className={cn('flex flex-col gap-[2px]', wide)}>
                    <span className="h-1.5 rounded-full bg-muted"><span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${clamp(g.actual)}%` }} /></span>
                    {g.plan !== null && <span className="h-[3px] rounded-full bg-muted"><span className="block h-[3px] rounded-full bg-chart-2" style={{ width: `${clamp(g.plan)}%` }} /></span>}
                  </span>
                  <span className="text-right font-semibold text-foreground tabular-nums">{r1(g.actual).toFixed(1)}</span>
                  {hasPlan && (
                    <>
                      <span className="text-right text-foreground/70 tabular-nums">{g.plan === null ? '—' : r1(g.plan).toFixed(1)}</span>
                      <span className={cn('text-right font-semibold tabular-nums', d === null ? 'text-muted-foreground' : d < 0 ? 'text-bad' : d > 0 ? 'text-ok' : 'text-muted-foreground')}>
                        {d === null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}`}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* --------------------------------------------- what has to happen */}
      <section className={cn(card, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <h2 className={title}>Needs action</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground tabular-nums">{ours.length + theirs.length}</span>
          <Link href={dataHref} className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-primary">
            Open in Data <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid border-t border-border/70 lg:grid-cols-2">
          <ActionColumn
            heading="With us"
            // Both counts are Data's chips of the same names; the rows are the ones that need action.
            sub={`${summary.withUs} to send`}
            rows={ours}
            settings={settings}
            dataHref={dataHref}
            className="lg:border-r lg:border-border/70"
            empty="Nothing of ours needs action."
          />
          <ActionColumn
            heading={`With ${other}`}
            sub={`${summary.awaiting} waiting${summary.longestWait !== null ? ` · longest ${summary.longestWait} d` : ''}`}
            rows={theirs}
            settings={settings}
            dataHref={dataHref}
            empty={`Nothing is with ${other} past its review.`}
          />
        </div>
      </section>

      {bridge && (
        <p className="px-1 text-[13px] text-foreground/70 tabular-nums">
          The weekly report reads engineering at <b className="font-semibold text-foreground">{r1(bridge.typedPercent).toFixed(1)}%</b>;
          this register says <b className="font-semibold text-foreground">{r1(bridge.registerPercent).toFixed(1)}%</b>
          {bridge.linked > 0 && <> ({bridge.linked} of {bridge.disciplines} disciplines linked)</>}.
        </p>
      )}
    </div>
  );
}

function ActionColumn({
  heading, sub, rows, settings, dataHref, className, empty,
}: {
  heading: string;
  sub: string;
  rows: Obstacle[];
  settings: RegisterSettings;
  dataHref: string;
  className?: string;
  empty: string;
}) {
  const label = (s: Obstacle['stage']) => (s ? stageOf(settings, s).label : '');
  return (
    <div className={className}>
      <div className="flex items-baseline gap-2 border-b border-border/70 bg-muted/40 px-5 py-2.5">
        <span className="text-[13.5px] font-bold text-foreground">{heading}</span>
        <span className="text-[13px] text-foreground/70 tabular-nums">{sub}</span>
      </div>
      {rows.length === 0 && <p className="px-5 py-6 text-[13.5px] text-foreground/70">{empty}</p>}
      {rows.slice(0, 8).map((o) => {
        const reason = o.kind === 'late'
          ? { text: `Late ${o.days ?? 0} d · send ${label(o.next)}`, tone: 'bg-bad-soft text-bad' }
          : o.kind === 'comments'
            ? { text: `${codeLabel(settings, o.returnCode)} ${o.days ?? 0} d ago · send ${label(o.next)}`, tone: CODE_TONE[o.returnCode ?? 'AWC'] ?? 'bg-warn-soft text-warn' }
            : o.kind === 'soon'
              ? { text: `Due ${fmt(o.since)} · ${label(o.next)}`, tone: 'bg-primary-soft text-primary' }
              : { text: `${o.days ?? 0} d${(o.days ?? 0) > 14 ? ' · overdue' : ' waiting'}`, tone: (o.days ?? 0) > 14 ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn' };
        return (
          <div key={o.documentId} className="flex min-h-[3.75rem] items-center gap-3 border-b border-border/50 px-5 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="mb-[5px] truncate text-xs text-foreground/65 tabular-nums">{o.docNo ?? 'No number'} · {o.categoryName}</p>
              <p className="truncate text-[14px] font-semibold leading-5 text-foreground">{o.title}</p>
            </div>
            <span className={cn('hidden shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold sm:inline', reason.tone)}>{reason.text}</span>
            {/* No prefetch: every row is a different address, and prefetching each
                one rendered the whole Data page a dozen times on arrival. */}
            <Link
              href={`${dataHref}?doc=${o.documentId}`}
              prefetch={false}
              className="flex h-9 shrink-0 items-center rounded-lg border border-border px-3.5 text-[13px] font-semibold text-primary transition-colors duration-200 ease-ios hover:bg-primary-soft"
            >
              {o.kind === 'waiting' ? 'Chase' : 'Send'}
            </Link>
          </div>
        );
      })}
      {rows.length > 8 && (
        <Link href={dataHref} className="flex min-h-11 items-center px-5 text-[13px] font-medium text-primary">
          {rows.length - 8} more in Data
        </Link>
      )}
    </div>
  );
}
