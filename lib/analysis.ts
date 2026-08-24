import { computeGrandTotal, computeRollup, flattenTree, type RollupNode } from './rollup';
import type { Database } from './types';

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

  const totalAt = (w: number) => {
    const m = weekMap.get(w);
    if (!m) return null;
    const prev = weekMap.get(w - 1);
    return computeGrandTotal(computeRollup(db.wbsItems, m.leafData, prev?.leafData ?? null));
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

export interface Finding {
  level: FindingLevel;
  title: string;
  detail: string;
}

export interface ValidationResult {
  findings: Finding[];
  errors: number;
  warnings: number;
  /** False blocks issuing the report. */
  canIssue: boolean;
}

/**
 * The checks a senior would run before signing.
 *
 * These are not cosmetic: week 36 of the seeded project carries six leaves
 * whose progress moved backwards — one from 100% to 0% — and the current app
 * prints them without a word. A gate is what makes it safe to hand the app to
 * someone new.
 */
export function validateWeek(db: Database, week: number): ValidationResult {
  const findings: Finding[] = [];
  const weekMap = new Map(db.weeks.map((w) => [w.week, w]));
  const meta = weekMap.get(week);
  if (!meta) {
    return { findings: [], errors: 0, warnings: 0, canIssue: false };
  }
  const prev = weekMap.get(week - 1);
  const roots = computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null);
  const leaves = flattenTree(roots).filter((n) => n.isLeaf && n.bobot > 0);

  // 1. Physical work cannot un-happen.
  const backwards = leaves
    .filter((n) => n.curProgressPct < n.prevProgressPct - 0.001)
    .map((n) => ({ n, drop: n.prevProgressPct - n.curProgressPct }))
    .sort((a, b) => b.drop * b.n.bobot - a.drop * a.n.bobot);

  if (backwards.length) {
    const worst = backwards
      .slice(0, 3)
      .map((b) => `${shortName(b.n.deskripsi)} ${round(b.n.prevProgressPct)}→${round(b.n.curProgressPct)}%`)
      .join(', ');
    findings.push({
      level: 'error',
      title: `${backwards.length} item progressnya mundur`,
      detail: `${worst}${backwards.length > 3 ? `, dan ${backwards.length - 3} lainnya` : ''}. Pekerjaan fisik tidak bisa berkurang.`,
    });
  }

  // 2. Weights must close.
  const total = leaves.reduce((s, n) => s + n.bobot, 0);
  if (Math.abs(total - 100) > 0.01) {
    findings.push({
      level: 'error',
      title: `Total bobot ${fmtPct(total)}, bukan 100%`,
      detail: 'Selama bobot tidak menutup, setiap persen di laporan ini salah skala.',
    });
  } else {
    findings.push({
      level: 'ok',
      title: 'Total bobot 100,00%',
      detail: `${leaves.length} item leaf terjumlah utuh, tidak ada bobot menggantung.`,
    });
  }

  // 3. Weeks must not go backwards at project level either.
  if (prev) {
    const gt = computeGrandTotal(roots);
    if (gt.thisWeekProgressPct < -0.001) {
      findings.push({
        level: 'error',
        title: 'Progress mingguan negatif',
        detail: `Minggu ini tercatat ${fmtPct(gt.thisWeekProgressPct)} — laporan resmi tidak boleh mundur.`,
      });
    }
  }

  // 4. Progress that is only ever a round number is progress that was guessed.
  const rounded = leaves.filter((n) => Math.abs(n.curProgressPct % 5) < 0.0001).length;
  const roundedShare = leaves.length ? (rounded / leaves.length) * 100 : 0;
  if (roundedShare > 80) {
    findings.push({
      level: 'warn',
      title: `${fmtPct(roundedShare)} nilai progress kelipatan 5`,
      detail:
        'Angka yang selalu bulat menandakan taksiran, bukan pengukuran. Item dengan kuantitas akan menghasilkan angka yang tidak bulat.',
    });
  }

  // 5. Hours spent with nothing to show.
  const daily = db.daily.filter((d) => d.date);
  const hoursLogged = daily.reduce(
    (s, d) => s + d.manHours.reduce((a, m) => a + m.todayHours + m.previousHours, 0),
    0
  );
  const stalled = leaves.filter((n) => n.curProgressPct === 0).length;
  if (hoursLogged > 0 && stalled > 0) {
    findings.push({
      level: 'warn',
      title: 'Ada jam kerja tapi sebagian item belum bergerak',
      detail: `${fmtNum(hoursLogged)} jam kumulatif tercatat sementara ${stalled} item masih 0%.`,
    });
  }

  // 6. Setup completeness — the root cause behind most of the above.
  const quantified = db.wbsItems.filter(
    (i) => i.vol !== null && i.satuan && i.satuan.toLowerCase() !== 'ls'
  ).length;
  if (quantified === 0) {
    findings.push({
      level: 'warn',
      title: 'Tidak ada item berkuantitas',
      detail:
        'Semua item bersatuan lumpsum, jadi tidak ada progress yang bisa diverifikasi ulang di lapangan.',
    });
  }
  if (!db.project.contractValue) {
    findings.push({
      level: 'warn',
      title: 'Nilai kontrak belum diisi',
      detail: 'Tanpa itu laporan hanya bisa bicara persen — tidak bisa naik ke direksi.',
    });
  }

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
export function buildNarrative(health: ProjectHealth, laggards: Laggard[]): string {
  const behind = health.deviationPct < 0;
  const parts: string[] = [];

  parts.push(
    `Progress minggu ${health.week} tercatat ${fmtPct(health.actualPct)} terhadap rencana ${fmtPct(
      health.planPct
    )}, sehingga proyek berada ${fmtPct(Math.abs(health.deviationPct))} ${
      behind ? 'di belakang' : 'di depan'
    } jadwal (SPI ${fmtNum(health.spi, 3)})`
  );

  if (health.scheduleVarianceRp !== null && Math.abs(health.scheduleVarianceRp) > 0) {
    parts.push(
      ` atau setara ${formatRupiah(Math.abs(health.scheduleVarianceRp))} pekerjaan yang ${
        behind ? 'belum terealisasi' : 'terealisasi lebih awal'
      }`
    );
  }
  parts.push('. ');

  if (laggards.length) {
    const top = laggards[0];
    parts.push(
      `Penyeret terbesar adalah ${top.deskripsi} (bobot ${fmtPct(top.bobot)}) yang baru mencapai ${fmtPct(
        top.actualPct
      )} dari rencana ${fmtPct(top.planPct)}`
    );
    if (laggards.length > 1) {
      const sum = laggards.reduce((s, l) => s + Math.abs(l.varianceWF), 0);
      parts.push(`; ${laggards.length} item teratas menahan total ${fmtPct(sum)} progress proyek`);
    }
    parts.push('. ');
  }

  if (health.forecastFinishWeek !== null && health.weeksAgainstContract !== null) {
    const early = health.weeksAgainstContract > 0;
    const gap = Math.abs(Math.round(health.weeksAgainstContract));
    parts.push(
      `Kecepatan ${VELOCITY_WINDOW} minggu terakhir ${fmtPct(
        health.velocityPerWeek
      )} per minggu, sementara sisa rencana menuntut ${fmtPct(health.requiredVelocity)} per minggu`
    );
    parts.push(
      `; bila laju ini terjaga, penyelesaian diproyeksikan pada minggu ${Math.round(
        health.forecastFinishWeek
      )}${gap > 0 ? `, ${gap} minggu ${early ? 'lebih cepat' : 'lebih lambat'} dari akhir kontrak` : ', tepat pada akhir kontrak'}.`
    );
  } else {
    parts.push(
      'Kecepatan empat minggu terakhir belum cukup untuk memproyeksikan tanggal penyelesaian.'
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Formatting — one place, so every screen says the number the same way
// ---------------------------------------------------------------------------

export function fmtPct(n: number, digits = 2): string {
  return `${n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Rupiah at meeting scale: nobody reads twelve digits off a slide. */
export function formatRupiah(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `Rp ${fmtNum(n / 1e12, 2)} T`;
  if (abs >= 1e9) return `Rp ${fmtNum(n / 1e9, 2)} M`;
  if (abs >= 1e6) return `Rp ${fmtNum(n / 1e6, 1)} jt`;
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
        topRisk: 'Belum di-setup',
        approvedThroughWeek: null,
        blockingFindings: 0,
      });
      continue;
    }

    const validation = validateWeek(db, week);
    const prev = db.weeks.find((w) => w.week === week - 1);
    const meta = db.weeks.find((w) => w.week === week)!;
    const roots = computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null);
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
