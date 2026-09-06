import {
  computeGrandTotal,
  computeRollup,
  flattenTree,
  promoteNestedSpkContracts,
  type RollupNode,
} from './rollup';
import { hasRealQuantity } from './progress';
import { weekOfDate } from './weeks';
import { buildWorklist } from './worklist';
import type { Database } from './types';
import { toSi } from './currency';

/**
 * The reading layer.
 *
 * Everything here is derived from data the app already collects — no new
 * input, no new screens to fill in. This is the difference between a report
 * that shows two lines and one that says what the two lines mean, and it is
 * what lets someone without years of project control still have an answer in
 * the Monday meeting.
 */

const VELOCITY_WINDOW = 4;

export interface ProjectHealth {
  week: number;
  lastWeek: number;
  planPct: number;
  actualPct: number;
  /** Negative = behind schedule. */
  deviationPct: number;
  /** actual / plan. Below 1.00 is behind. */
  spi: number;
  contractValue: number | null;
  earnedValue: number | null;
  plannedValue: number | null;
  /** Rupiah of work that should exist but doesn't. Negative = ahead. */
  scheduleVarianceRp: number | null;
  /** Percent per week over the last `VELOCITY_WINDOW` weeks. */
  velocityPerWeek: number;
  /** Percent per week still needed to finish on contract time. */
  requiredVelocity: number;
  /** null when velocity is zero or negative — no honest forecast exists. */
  forecastFinishWeek: number | null;
  /** Positive = finishing early. */
  weeksAgainstContract: number | null;
}

export function computeHealth(db: Database, week: number): ProjectHealth | null {
  const weekMap = new Map(db.weeks.map((w) => [w.week, w]));
  const meta = weekMap.get(week);
  if (!meta) return null;

  // Promoted, like every other reader in the app. Grand totals happen to be
  // invariant under the promotion — it moves a nested SPK subtree sideways
  // rather than adding or dropping weight — so this changes no figure today.
  // It closes the seam: a second way of building the tree is a second place for
  // the numbers to drift apart, and that is exactly what `validateWeek` did
  // until it was pulled onto the shared one.
  const totalAt = (w: number) => {
    const m = weekMap.get(w);
    if (!m) return null;
    const prev = weekMap.get(w - 1);
    return computeGrandTotal(
      promoteNestedSpkContracts(computeRollup(db.wbsItems, m.leafData, prev?.leafData ?? null))
    );
  };

  const gt = totalAt(week);
  if (!gt) return null;

  const lastWeek = db.weeks.length ? Math.max(...db.weeks.map((w) => w.week)) : week;
  const planPct = gt.bobot > 0 ? (gt.targetWF / gt.bobot) * 100 : 0;
  const actualPct = gt.curProgressPct;

  // Velocity from the actual line, not from this week alone — one strong or
  // idle week shouldn't swing the forecast by months.
  const backWeek = Math.max(1, week - VELOCITY_WINDOW);
  const back = totalAt(backWeek);
  const span = week - backWeek;
  const velocityPerWeek = back && span > 0 ? (actualPct - back.curProgressPct) / span : 0;

  const weeksLeftOnContract = Math.max(0, lastWeek - week);
  const requiredVelocity = weeksLeftOnContract > 0 ? (100 - actualPct) / weeksLeftOnContract : 0;

  let forecastFinishWeek: number | null = null;
  if (velocityPerWeek > 0.01 && actualPct < 100) {
    forecastFinishWeek = week + (100 - actualPct) / velocityPerWeek;
  } else if (actualPct >= 100) {
    forecastFinishWeek = week;
  }

  const contractValue = db.project.contractValue ?? null;
  const earnedValue = contractValue !== null ? (contractValue * actualPct) / 100 : null;
  const plannedValue = contractValue !== null ? (contractValue * planPct) / 100 : null;

  return {
    week,
    lastWeek,
    planPct,
    actualPct,
    deviationPct: actualPct - planPct,
    spi: planPct > 0 ? actualPct / planPct : 1,
    contractValue,
    earnedValue,
    plannedValue,
    scheduleVarianceRp:
      plannedValue !== null && earnedValue !== null ? plannedValue - earnedValue : null,
    velocityPerWeek,
    requiredVelocity,
    forecastFinishWeek,
    weeksAgainstContract: forecastFinishWeek !== null ? lastWeek - forecastFinishWeek : null,
  };
}

// ---------------------------------------------------------------------------
// What is dragging the project
// ---------------------------------------------------------------------------

export interface Laggard {
  id: string;
  wbsCode: string;
  deskripsi: string;
  bobot: number;
  planPct: number;
  actualPct: number;
  /** Negative. How much project percent this single item is holding back. */
  varianceWF: number;
  valueRp: number | null;
}

/**
 * Rank by weight-factor variance, not by percent behind.
 *
 * An item at 0% of a 3.3% weight costs the project ten times more than an item
 * at 0% of a 0.3% weight, yet both read as "100% behind". Sorting on percent is
 * how a review meeting ends up spending its hour on the wrong item.
 */
export function findLaggards(
  roots: RollupNode[],
  contractValue: number | null,
  limit = 8
): Laggard[] {
  return flattenTree(roots)
    .filter((n) => n.isLeaf && n.bobot > 0 && n.variance < 0)
    .sort((a, b) => a.variance - b.variance)
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      wbsCode: n.wbsCode,
      deskripsi: n.deskripsi,
      bobot: n.bobot,
      planPct: n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0,
      actualPct: n.curProgressPct,
      varianceWF: n.variance,
      valueRp: contractValue !== null ? (contractValue * Math.abs(n.variance)) / 100 : null,
    }));
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export type FindingLevel = 'error' | 'warn' | 'ok';

/** One offending row, so the screen can list what failed instead of describing it. */
export interface FindingRow {
  label: string;
  /** Already formatted — what "the problem" is differs per check. */
  value: string;
  /**
   * Where the item sits, as its last two ancestors. A WBS legitimately carries
   * the same description under several parents — "RTS" and "Material On Site"
   * each appear more than once on Gundih — so a bare label leaves six
   * identical-looking rows and no way to tell which one failed.
   */
  trail?: string;
}

export interface Finding {
  level: FindingLevel;
  title: string;
  detail: string;
  /**
   * The rows that failed this check. The detail line used to carry the worst
   * three glued into a sentence, which reads as prose and cannot be scanned,
   * clicked or counted.
   */
  rows?: FindingRow[];
}

export interface ValidationResult {
  findings: Finding[];
  errors: number;
  warnings: number;
  /** False blocks issuing the report. */
  canIssue: boolean;
}

/**
 * Where a leaf sits, as its last two ancestors: 'Electrical › Busduct'.
 *
 * Built from the SAME promoted tree the Update screen walks, so a row named
 * here can be found there. Without it the evidence lists read as six copies of
 * "RTS" — the WBS carries that description under several parents.
 */
function trailIndex(roots: RollupNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (node: RollupNode, trail: string[]) => {
    if (node.children.length > 0) {
      const next = [...trail, node.deskripsi];
      node.children.forEach((c) => visit(c, next));
      return;
    }
    // The outermost ancestor is the project itself, identical on every row.
    out.set(node.id, trail.slice(1).slice(-2).join(' › '));
  };
  roots.forEach((r) => visit(r, []));
  return out;
}

/**
 * The checks a senior would run before signing.
 *
 * These are not cosmetic: week 36 of the seeded project carries six leaves
 * whose progress moved backwards — one from 100% to 0% — and the current app
 * prints them without a word. A gate is what makes it safe to hand the app to
 * someone new.
 *
 * THE GATE READS THE SAME TREE AND THE SAME QUEUE AS STEP ①. It used to build
 * its own `computeRollup` without `promoteNestedSpkContracts`, so the screen
 * that judges the week walked a different WBS from the screen that fills it in
 * — the two only agreed because Gundih's weights land on exactly 100. And it
 * never opened the schedule at all, which meant the three things step ① puts
 * on someone's Friday could all be left undone and this screen would still say
 * "ready to issue". `buildWorklist` here is the same call the Update page and
 * the step badges make, so the counts cannot drift apart.
 */
export function validateWeek(db: Database, week: number): ValidationResult {
  const findings: Finding[] = [];
  const weekMap = new Map(db.weeks.map((w) => [w.week, w]));
  const meta = weekMap.get(week);
  if (!meta) {
    return { findings: [], errors: 0, warnings: 0, canIssue: false };
  }
  const prev = weekMap.get(week - 1);
  const roots = promoteNestedSpkContracts(
    computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null)
  );
  const leaves = flattenTree(roots).filter((n) => n.isLeaf && n.bobot > 0);
  const trails = trailIndex(roots);
  const currentWeek = db.project.currentWeek;
  const worklist = buildWorklist({
    roots,
    schedule: db.schedule,
    week,
    changeLog: db.changeLog,
  });

  // EVERY CHECK REPORTS, PASS OR FAIL. It used to push a finding only when
  // something was wrong, so the screen could show what had broken but never
  // what had been looked at — and "what does this check?" had no answer
  // anywhere in the app. A checklist that only ever shows failures is not a
  // checklist, it is an error log.

  // 1. Physical work cannot un-happen.
  const backwards = leaves
    .filter((n) => n.curProgressPct < n.prevProgressPct - 0.001)
    .map((n) => ({ n, drop: n.prevProgressPct - n.curProgressPct }))
    .sort((a, b) => b.drop * b.n.bobot - a.drop * a.n.bobot);

  findings.push(
    backwards.length
      ? {
          level: 'error',
          title: `${backwards.length} ${backwards.length === 1 ? 'item has' : 'items have'} gone backwards`,
          detail:
            'Work that was reported as done is now reported as less done. One of the two weeks is wrong.',
          rows: backwards.map(({ n }) => ({
            label: n.deskripsi,
            value: `${round(n.prevProgressPct)}% → ${round(n.curProgressPct)}%`,
            trail: trails.get(n.id),
          })),
        }
      : {
          level: 'ok',
          title: 'No item has gone backwards',
          detail: 'Every item is at least where it was last week.',
        }
  );

  // 2. Weights must close.
  const total = leaves.reduce((s, n) => s + n.bobot, 0);
  findings.push(
    Math.abs(total - 100) > 0.01
      ? {
          level: 'error',
          title: `Weights total ${fmtPct(total)}, not 100%`,
          detail:
            'While the weights do not close, every percentage in this report is on the wrong scale.',
        }
      : {
          level: 'ok',
          title: 'Weights total 100.00%',
          detail: `All ${leaves.length} leaf items add up, with no weight left dangling.`,
        }
  );

  // 3. What step ① asked for must actually have been answered.
  //
  // This is the join between the two screens. The queue on the Update page is
  // built from the schedule — items whose span covers this week — and an item
  // counts as dealt with once something is recorded against it, because "no
  // progress" is a legitimate answer. So an item still in `due` here is not a
  // slow item, it is an UNANSWERED one, and a report printed over it carries a
  // hole rather than a bad number. That is why this one blocks.
  findings.push(
    !worklist.hasSchedule
      ? {
          level: 'warn',
          title: 'This project has no schedule',
          detail:
            'Without a start and finish week per item the app cannot say what was due, so nothing on this page can be checked against the plan.',
        }
      : worklist.due.length > 0
        ? {
            // BLOCKING FROM THE CURRENT WEEK FORWARD ONLY. An item counts as
            // answered by its entry in the change log, and a week imported
            // from a workbook carries none by construction — so weeks 1-35 of
            // the seeded project would sit permanently red over work that was
            // in fact done and issued months ago. A closed week still lists
            // the gap; it just does not pretend the gap can still be filled.
            level: week >= currentWeek ? 'error' : 'warn',
            title: `${worklist.due.length} ${worklist.due.length === 1 ? 'item is' : 'items are'} due this week and unanswered`,
            detail:
              week >= currentWeek
                ? 'The schedule puts these in this week and nothing has been recorded against them. Recording "no progress" is an answer — leaving them untouched is not.'
                : `Week ${week} is already closed, so this is flagged rather than blocked — the schedule put these here and the app holds no record of anyone answering them.`,
            rows: worklist.due.map((e) => ({
              label: e.node.deskripsi,
              value:
                e.behindPct > 0.05
                  ? `${fmtPct(e.behindPct)} behind`
                  : `week ${e.weekOfSpan} of ${e.spanWeeks}`,
              trail: trails.get(e.node.id),
            })),
          }
        : worklist.done.length > 0
          ? {
              level: 'ok',
              title: 'Everything due this week has been answered',
              detail: `${worklist.done.length} ${worklist.done.length === 1 ? 'item was' : 'items were'} scheduled for week ${week}, and all of them were recorded.`,
            }
          : {
              level: 'ok',
              title: 'Nothing was scheduled for this week',
              detail: `No item's span covers week ${week}, so step ① had nothing to hand over.`,
            }
  );

  // 4. Items the queue deliberately leaves out.
  //
  // `buildWorklist` keeps these off the Update screen on purpose — at W43
  // there are 44 of them, which is a project problem rather than a Friday
  // to-do list — and that screen's warning sends people HERE to review them.
  // Until this check existed, that button led to a page that never mentioned
  // them.
  findings.push(
    worklist.stuck.length > 0
      ? {
          level: 'warn',
          title: `${worklist.stuck.length} ${worklist.stuck.length === 1 ? 'item is' : 'items are'} past their finish date and still open`,
          detail:
            'Their scheduled finish has gone by while they are short of 100%. They need a revised date or a reason, not a number typed into this week.',
          rows: worklist.stuck.map((s) => ({
            label: s.node.deskripsi,
            value: `${round(s.pct)}% · ${s.weeksLate}w late`,
            trail: trails.get(s.node.id),
          })),
        }
      : {
          level: 'ok',
          title: 'Nothing is past its finish date',
          detail: 'Every item whose scheduled finish has passed is complete.',
        }
  );

  // 5. Weeks must not go backwards at project level either — and a week that
  //    did not move at all is not a pass. The old check only ever errored on a
  //    negative, so weeks 38-60 of the seeded project each read "The project
  //    total moved forward · 0.00% added", a title arguing with its own number.
  const gt = computeGrandTotal(roots);
  findings.push(
    prev && gt.thisWeekProgressPct < -0.001
      ? {
          level: 'error',
          title: 'The project total went down this week',
          detail: `This week records ${fmtPct(gt.thisWeekProgressPct)} — a signed report must not go backwards.`,
        }
      : prev && gt.thisWeekProgressPct < 0.001
        ? {
            level: 'warn',
            title: 'Nothing moved this week',
            detail: `The total is unchanged from week ${week - 1}, at ${fmtPct(gt.curProgressPct)}. A flat week is allowed, but the report has to say why.`,
          }
        : {
            level: 'ok',
            title: 'The project total moved forward',
            detail: prev
              ? `${fmtPct(gt.thisWeekProgressPct)} added since week ${week - 1}.`
              : 'First week — nothing to compare against yet.',
          }
  );

  // 6. A week nobody has reported yet is not a week you can issue.
  //
  // Future weeks are materialised with the last reported figures carried
  // forward, so they render perfectly and say nothing. Without this the app
  // offered to print week 60 of a project standing at week 36.
  findings.push(
    currentWeek > 0 && week > currentWeek
      ? {
          level: 'warn',
          title: `Week ${week} is ahead of the current week (${currentWeek})`,
          detail:
            'Its figures are carried forward from the last reported week, not measured. Set it as current once its actuals are in.',
        }
      : {
          level: 'ok',
          title:
            week === currentWeek
              ? 'This is the current reporting week'
              : `Week ${week} has already been reported`,
          detail:
            week === currentWeek
              ? 'Its figures are the ones being reported now.'
              : `The project has since moved on to week ${currentWeek}.`,
        }
  );

  // 7. Progress that is only ever a round number is progress that was guessed.
  const rounded = leaves.filter((n) => Math.abs(n.curProgressPct % 5) < 0.0001).length;
  const roundedShare = leaves.length ? (rounded / leaves.length) * 100 : 0;
  findings.push(
    roundedShare > 80
      ? {
          level: 'warn',
          title: `${fmtPct(roundedShare)} of progress values are multiples of 5`,
          detail:
            'Numbers that are always round are estimates, not measurements. Anything actually counted produces figures that are not round.',
        }
      : {
          level: 'ok',
          title: 'Progress figures do not look guessed',
          detail: `${fmtPct(roundedShare)} of them are multiples of 5, which is a normal share.`,
        }
  );

  // 8. Hours spent with nothing to show.
  //
  // BOTH HALVES ARE THIS WEEK'S. This check used to sum `todayHours` AND
  // `previousHours` across every daily report the project has ever filed —
  // `previousHours` is the running total the daily form carries forward, so the
  // same hours were counted again on every report, and the 138,556 it produced
  // was then held against ONE week's zero-percent items. Week 1 was warned
  // using week 36's hours.
  const anchor = db.project.weekAnchorEndDate;
  const hoursThisWeek = anchor
    ? db.daily
        .filter((d) => d.date && weekOfDate(anchor, d.date) === week)
        .reduce((s, d) => s + d.manHours.reduce((a, m) => a + m.todayHours, 0), 0)
    : 0;
  // And "has not moved" means an item the schedule says should already be
  // underway. A leaf at 0% whose start week is still ahead of us is not idle,
  // it is simply not due — counting those made the warning fire on almost every
  // project from week one.
  const startWeekOf = new Map((db.schedule ?? []).map((s) => [s.leafId, s.startWeek]));
  const stalled = leaves.filter(
    (n) =>
      n.curProgressPct === 0 &&
      (!worklist.hasSchedule || (startWeekOf.get(n.id) ?? Infinity) <= week)
  );
  findings.push(
    hoursThisWeek > 0 && stalled.length > 0
      ? {
          level: 'warn',
          title: 'Hours are being spent on items that have not moved',
          detail: `${fmtNum(hoursThisWeek)} hours were booked in week ${week} while ${stalled.length} items that should be underway sit at 0%. Either the hours or the progress is wrong.`,
          // Every one of them, not a sample: the UI does the capping, and
          // truncating twice made "and 2 more" appear under a sentence that had
          // just said 40.
          rows: stalled.map((n) => ({
            label: n.deskripsi,
            value: '0%',
            trail: trails.get(n.id),
          })),
        }
      : {
          level: 'ok',
          title: 'Hours and progress agree',
          detail:
            hoursThisWeek > 0
              ? `${fmtNum(hoursThisWeek)} hours booked in week ${week}, and nothing that should be underway is sitting at 0%.`
              : `No hours were recorded against week ${week}, so there is nothing to disagree with.`,
        }
  );

  // 9. Setup completeness — the root cause behind most of the above.
  //
  // `hasRealQuantity` rather than a hand-rolled `satuan !== 'ls'`: every seeded
  // item is stored as `vol: 1, satuan: 'Ls'`, and the naive test also misses
  // 'Lot' and a zero volume. See AGENTS.md — this exact duplication is what
  // rewrote a leaf that had sat at 100% for 27 weeks.
  const quantified = db.wbsItems.filter(hasRealQuantity).length;
  findings.push(
    quantified === 0
      ? {
          level: 'warn',
          title: 'No item carries a quantity',
          detail:
            'Every item is lumpsum, so no progress figure here can be checked again on site.',
        }
      : {
          level: 'ok',
          title: `${quantified} items carry a real quantity`,
          detail: 'Their percentages come from something countable rather than from an opinion.',
        }
  );

  findings.push(
    !db.project.contractValue
      ? {
          level: 'warn',
          title: 'Contract value is not filled in',
          detail: 'Without it the report can only speak in percentages — not in money a board will read.',
        }
      : {
          level: 'ok',
          title: 'Contract value is set',
          detail: 'Earned value and the deferred figure can be stated in rupiah.',
        }
  );

  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warn').length;
  return { findings, errors, warnings, canIssue: errors === 0 };
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

/**
 * The paragraph someone would otherwise write by hand every Friday, filled in
 * from this week's numbers. Deliberately plain — it is meant to be pasted into
 * a report and defended in a meeting, not admired.
 */
export interface NarrativeParts {
  /** Where the project stands. */
  status: string;
  /** What is holding it back. Null when nothing is behind. */
  laggards: string | null;
  /** Where the current pace lands it. */
  forecast: string;
}

/**
 * The narrative, in three pieces.
 *
 * A screen that already shows the headline figures must not repeat them in
 * prose underneath — the dashboard hero states actual, plan, deviation and SPI,
 * so it renders `laggards` and `forecast` only. A printed report has no hero
 * and takes all three through `buildNarrative`.
 */
export function narrativeParts(health: ProjectHealth, laggards: Laggard[]): NarrativeParts {
  return {
    status: statusSentence(health),
    laggards: laggardSentence(laggards),
    forecast: forecastSentence(health),
  };
}

export function buildNarrative(health: ProjectHealth, laggards: Laggard[]): string {
  const p = narrativeParts(health, laggards);
  return [p.status, p.laggards, p.forecast].filter(Boolean).join(' ');
}

function statusSentence(health: ProjectHealth): string {
  const behind = health.deviationPct < 0;
  const parts: string[] = [];

  parts.push(
    `Week ${health.week} records ${fmtPct(health.actualPct)} against a plan of ${fmtPct(
      health.planPct
    )}, which puts the project ${fmtPct(Math.abs(health.deviationPct))} ${
      behind ? 'behind' : 'ahead of'
    } schedule (SPI ${fmtNum(health.spi, 3)})`
  );

  if (health.scheduleVarianceRp !== null && Math.abs(health.scheduleVarianceRp) > 0) {
    parts.push(
      ` — ${formatRupiah(Math.abs(health.scheduleVarianceRp))} of work ${
        behind ? 'not yet delivered' : 'delivered early'
      }`
    );
  }
  parts.push('.');
  return parts.join('');
}

function laggardSentence(laggards: Laggard[]): string | null {
  if (!laggards.length) return null;
  const top = laggards[0];
  const parts: string[] = [];
  parts.push(
    `The biggest drag is ${top.deskripsi} (weight ${fmtPct(top.bobot)}), at ${fmtPct(
      top.actualPct
    )} against a plan of ${fmtPct(top.planPct)}`
  );
  if (laggards.length > 1) {
    const sum = laggards.reduce((s, l) => s + Math.abs(l.varianceWF), 0);
    parts.push(`; the top ${laggards.length} items hold back ${fmtPct(sum)} of project progress`);
  }
  parts.push('.');
  return parts.join('');
}

function forecastSentence(health: ProjectHealth): string {
  const parts: string[] = [];
  if (health.forecastFinishWeek !== null && health.weeksAgainstContract !== null) {
    const early = health.weeksAgainstContract > 0;
    const gap = Math.abs(Math.round(health.weeksAgainstContract));
    parts.push(
      `Velocity over the last ${VELOCITY_WINDOW} weeks is ${fmtPct(
        health.velocityPerWeek
      )} per week, while the remaining plan demands ${fmtPct(health.requiredVelocity)} per week`
    );
    parts.push(
      `; at this rate completion lands in week ${Math.round(
        health.forecastFinishWeek
      )}${gap > 0 ? `, ${gap} weeks ${early ? 'earlier' : 'later'} than the contract end` : ', exactly on the contract end'}.`
    );
  } else {
    parts.push(
      'The last four weeks do not give enough velocity to forecast a completion date.'
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Formatting — one place, so every screen says the number the same way
// ---------------------------------------------------------------------------

/**
 * Numbers on SCREEN group the SI way — three digits at a time, separated by a
 * narrow no-break space, never a comma or a dot. `5.000` is five thousand in
 * Jakarta and five in London; a space cannot be misread by either. The decimal
 * marker stays a point, which is the rule this app was already locked to.
 *
 * `/print/*` is deliberately untouched and does not import these: the printed
 * report is the client's own signed deliverable in the client's own format, and
 * formats its numbers inline with `en-US`. See AGENTS.md.
 */
export function fmtPct(n: number, digits = 2): string {
  return `${toSi(n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }))}%`;
}

export function fmtNum(n: number, digits = 0): string {
  return toSi(
    n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  );
}

/** Rupiah at meeting scale: nobody reads twelve digits off a slide. */
export function formatRupiah(n: number): string {
  const abs = Math.abs(n);
  // Spelled out rather than abbreviated: Indonesian "M" means miliar while
  // English "M" means million, and a Rupiah figure off by a thousand times is
  // the kind of mistake a meeting does not catch.
  if (abs >= 1e12) return `Rp ${fmtNum(n / 1e12, 2)} trillion`;
  if (abs >= 1e9) return `Rp ${fmtNum(n / 1e9, 2)} billion`;
  if (abs >= 1e6) return `Rp ${fmtNum(n / 1e6, 1)} million`;
  return `Rp ${fmtNum(n)}`;
}

function round(n: number): string {
  return String(Math.round(n));
}

function shortName(s: string): string {
  const t = s.trim();
  return t.length > 34 ? `${t.slice(0, 33)}…` : t;
}

// ---------------------------------------------------------------------------
// Delay register — the claim material
// ---------------------------------------------------------------------------

export interface DelayRow {
  cause: string;
  hours: number;
  /** Hours ÷ the project's own working day, so "3,5 hari" means something. */
  equivalentDays: number;
  claimable: boolean;
  occurrences: number;
  firstDate: string | null;
  lastDate: string | null;
  photoCount: number;
}

export interface DelayRegister {
  rows: DelayRow[];
  totalHours: number;
  claimableHours: number;
  claimableDays: number;
  workingHoursPerDay: number;
  daysCovered: number;
  daysWithPhotos: number;
  totalPhotos: number;
  /** Photos whose own EXIF carries a capture time — the ones that survive scrutiny. */
  verifiedPhotos: number;
  photosWithGps: number;
  /** True once every stored photo carries capture metadata. */
  photosVerifiable: boolean;
}

/**
 * Assemble every non-effective hour ever logged into claim material.
 *
 * All of this is already collected daily and then thrown away: nothing sums it
 * across weeks, so a contractor six weeks late has the evidence for an
 * extension of time sitting in the database and no way to hand it over. On a
 * contract this size one successful claim is worth more than any subscription
 * — which is why this is the highest-value thing the daily form can feed.
 */
export function buildDelayRegister(db: Database, claimableCauses: Set<string>): DelayRegister {
  const byCause = new Map<string, DelayRow>();
  let totalHours = 0;
  let daysWithPhotos = 0;
  let totalPhotos = 0;
  let verifiedPhotos = 0;
  let photosWithGps = 0;
  const photoMeta = db.photoMeta ?? {};

  const sorted = [...db.daily].filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));

  // The working day comes from the reports themselves rather than a constant:
  // "3,5 days" only means something against the hours this project actually works.
  let spanTotal = 0;
  let spanCount = 0;
  for (const d of sorted) {
    const [sh, sm] = (d.weather.waktuMulai || '').split(':').map(Number);
    const [eh, em] = (d.weather.waktuSelesai || '').split(':').map(Number);
    if (Number.isFinite(sh) && Number.isFinite(eh)) {
      const span = eh + (em || 0) / 60 - (sh + (sm || 0) / 60);
      if (span > 0 && span <= 24) {
        spanTotal += span;
        spanCount++;
      }
    }
  }
  const workingHoursPerDay = spanCount ? spanTotal / spanCount : 8;

  for (const d of sorted) {
    const paths = d.photos.filter((p): p is string => !!p);
    const photos = paths.length;
    if (photos > 0) daysWithPhotos++;
    totalPhotos += photos;
    for (const p of paths) {
      const m = photoMeta[p];
      if (m?.takenAt) verifiedPhotos++;
      if (m?.lat !== undefined && m?.lon !== undefined) photosWithGps++;
    }

    for (const ne of d.nonEffective) {
      const hours = ne.today || 0;
      if (hours <= 0) continue;
      totalHours += hours;

      const key = ne.cause.trim();
      const row = byCause.get(key) ?? {
        cause: key,
        hours: 0,
        equivalentDays: 0,
        claimable: claimableCauses.has(key.toLowerCase()),
        occurrences: 0,
        firstDate: null,
        lastDate: null,
        photoCount: 0,
      };
      row.hours += hours;
      row.occurrences += 1;
      row.firstDate ??= d.date;
      row.lastDate = d.date;
      row.photoCount += photos;
      byCause.set(key, row);
    }
  }

  const rows = [...byCause.values()]
    .map((r) => ({ ...r, equivalentDays: r.hours / workingHoursPerDay }))
    .sort((a, b) => b.hours - a.hours);

  const claimableHours = rows.filter((r) => r.claimable).reduce((s, r) => s + r.hours, 0);

  return {
    rows,
    totalHours,
    claimableHours,
    claimableDays: claimableHours / workingHoursPerDay,
    workingHoursPerDay,
    daysCovered: sorted.length,
    daysWithPhotos,
    totalPhotos,
    verifiedPhotos,
    photosWithGps,
    // Only claim verifiability when every photo can back its own date. A
    // partially verifiable set is the one an opposing party picks apart, so
    // "mostly" has to read as "no" here.
    photosVerifiable: totalPhotos > 0 && verifiedPhotos === totalPhotos,
  };
}

// ---------------------------------------------------------------------------
// Look-ahead
// ---------------------------------------------------------------------------

export interface LookAheadWeek {
  week: number;
  targetPct: number;
  /** Percent that must be added between now and that week. */
  gapFromNow: number;
  /** How many times the recent pace that demands. */
  paceMultiple: number | null;
}

/**
 * The next two weeks, stated as what has to happen rather than what is planned.
 *
 * A plan curve says "72.50% by week 37"; that only becomes actionable once it
 * is expressed against the pace the crew is actually managing — which is what
 * turns this from a record of the past into something worth opening on Monday.
 */
export function buildLookAhead(db: Database, health: ProjectHealth, weeks = 2): LookAheadWeek[] {
  const out: LookAheadWeek[] = [];
  const weekMap = new Map(db.weeks.map((w) => [w.week, w]));

  for (let i = 1; i <= weeks; i++) {
    const w = health.week + i;
    const meta = weekMap.get(w);
    if (!meta) break;
    const prev = weekMap.get(w - 1);
    const gt = computeGrandTotal(computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null));
    const targetPct = gt.bobot > 0 ? (gt.targetWF / gt.bobot) * 100 : 0;
    const gapFromNow = targetPct - health.actualPct;
    out.push({
      week: w,
      targetPct,
      gapFromNow,
      paceMultiple:
        health.velocityPerWeek > 0.001 ? gapFromNow / (health.velocityPerWeek * i) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Portfolio — the layer above a single project
// ---------------------------------------------------------------------------

export type PortfolioStatus = 'ok' | 'watch' | 'critical';

export interface PortfolioRow {
  id: string;
  name: string;
  customer: string;
  isActive: boolean;
  week: number;
  totalWeeks: number;
  planPct: number;
  actualPct: number;
  deviationPct: number;
  spi: number;
  contractValue: number | null;
  scheduleVarianceRp: number | null;
  forecastFinishWeek: number | null;
  weeksAgainstContract: number | null;
  status: PortfolioStatus;
  topRisk: string | null;
  approvedThroughWeek: number | null;
  blockingFindings: number;
}

/**
 * Thresholds, stated once.
 *
 * A director reading eight projects needs the same word to mean the same thing
 * on every row; letting each screen decide what "behind" looks like is how a
 * portfolio view stops being comparable.
 */
function statusOf(deviationPct: number, blocking: number): PortfolioStatus {
  if (deviationPct <= -5 || blocking > 0) return 'critical';
  if (deviationPct <= -2) return 'watch';
  return 'ok';
}

export const STATUS_LABEL: Record<PortfolioStatus, string> = {
  ok: 'Sesuai',
  watch: 'Perlu dipantau',
  critical: 'Kritis',
};

export function buildPortfolio(
  projects: { id: string; db: Database; isActive: boolean }[]
): PortfolioRow[] {
  const rows: PortfolioRow[] = [];

  for (const { id, db, isActive } of projects) {
    const week = db.project.currentWeek;
    const health = computeHealth(db, week);
    if (!health) {
      // A project that has been created but never set up still belongs on the
      // list — showing it as a blank row is how a director notices it is idle.
      rows.push({
        id,
        name: db.project.name || '(tanpa nama)',
        customer: db.project.customer,
        isActive,
        week: 0,
        totalWeeks: 0,
        planPct: 0,
        actualPct: 0,
        deviationPct: 0,
        spi: 1,
        contractValue: db.project.contractValue ?? null,
        scheduleVarianceRp: null,
        forecastFinishWeek: null,
        weeksAgainstContract: null,
        status: 'watch',
        topRisk: 'Not set up yet',
        approvedThroughWeek: null,
        blockingFindings: 0,
      });
      continue;
    }

    const validation = validateWeek(db, week);
    const prev = db.weeks.find((w) => w.week === week - 1);
    const meta = db.weeks.find((w) => w.week === week)!;
    const roots = promoteNestedSpkContracts(
      computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null)
    );
    const laggards = findLaggards(roots, health.contractValue, 1);

    const approvals = db.approvals ?? [];
    const approvedThroughWeek = approvals.length
      ? Math.max(...approvals.map((a) => a.week))
      : null;

    rows.push({
      id,
      name: db.project.name || '(tanpa nama)',
      customer: db.project.customer,
      isActive,
      week,
      totalWeeks: health.lastWeek,
      planPct: health.planPct,
      actualPct: health.actualPct,
      deviationPct: health.deviationPct,
      spi: health.spi,
      contractValue: health.contractValue,
      scheduleVarianceRp: health.scheduleVarianceRp,
      forecastFinishWeek: health.forecastFinishWeek,
      weeksAgainstContract: health.weeksAgainstContract,
      status: statusOf(health.deviationPct, validation.errors),
      topRisk: laggards[0]?.deskripsi ?? null,
      approvedThroughWeek,
      blockingFindings: validation.errors,
    });
  }

  // Worst first: a portfolio page is read top-down and the row that needs a
  // decision should not be the one you scroll to.
  return rows.sort((a, b) => a.deviationPct - b.deviationPct);
}

export interface PortfolioTotals {
  projects: number;
  contractValue: number;
  earnedValue: number;
  scheduleVarianceRp: number;
  critical: number;
  watch: number;
  blocked: number;
  /** Value-weighted, so a large project can't be averaged away by small ones. */
  weightedActualPct: number;
  weightedPlanPct: number;
}

export function portfolioTotals(rows: PortfolioRow[]): PortfolioTotals {
  let contractValue = 0;
  let earnedValue = 0;
  let plannedValue = 0;
  let scheduleVarianceRp = 0;

  for (const r of rows) {
    if (r.contractValue === null) continue;
    contractValue += r.contractValue;
    earnedValue += (r.contractValue * r.actualPct) / 100;
    plannedValue += (r.contractValue * r.planPct) / 100;
    scheduleVarianceRp += r.scheduleVarianceRp ?? 0;
  }

  return {
    projects: rows.length,
    contractValue,
    earnedValue,
    scheduleVarianceRp,
    critical: rows.filter((r) => r.status === 'critical').length,
    watch: rows.filter((r) => r.status === 'watch').length,
    blocked: rows.filter((r) => r.blockingFindings > 0).length,
    weightedActualPct: contractValue > 0 ? (earnedValue / contractValue) * 100 : 0,
    weightedPlanPct: contractValue > 0 ? (plannedValue / contractValue) * 100 : 0,
  };
}
