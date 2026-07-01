const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function weekEndDate(anchorEndDateISO: string, week: number): Date {
  const anchor = parseISODate(anchorEndDateISO);
  return new Date(anchor.getTime() + (week - 1) * 7 * MS_PER_DAY);
}

export function weekStartDate(anchorEndDateISO: string, week: number): Date {
  const end = weekEndDate(anchorEndDateISO, week);
  return new Date(end.getTime() - 6 * MS_PER_DAY);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function formatDateShort(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(d).replace(/ /g, '-');
}

export function formatWeekday(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d);
}

export function weekPeriodLabel(anchorEndDateISO: string, week: number): string {
  const start = weekStartDate(anchorEndDateISO, week);
  const end = weekEndDate(anchorEndDateISO, week);
  return `${formatDateLong(start)} s/d ${formatDateLong(end)}`;
}

function formatDateCompact(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(d);
}

export function weekPeriodShort(anchorEndDateISO: string, week: number): string {
  const start = weekStartDate(anchorEndDateISO, week);
  const end = weekEndDate(anchorEndDateISO, week);
  const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'UTC' }).format(end);
  return `${formatDateCompact(start)} – ${formatDateCompact(end)} ${year}`;
}
