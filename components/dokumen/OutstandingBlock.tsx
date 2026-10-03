'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, CircleAlert } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LOOKAHEAD_DAYS, REPLY_DAYS, STAGE_LABEL,
  type Obstacle, type ObstacleKind,
} from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { TYPE } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * OUTSTANDING, in the Dashboard's Priority Actions shape (3 Oct 2026, variant A
 * of three rendered for him). The first build was four tiles with a coloured
 * stripe down the left and a big number in each, and he called it ugly and
 * "very AI"; this card speaks the way the rest of Lucille already does.
 *
 * One list, worst first (the order `getObstacles` already gives: late, back
 * with comments, too long with the other side, due soon). THE PILL SAYS WHY
 * AND ITS COLOUR SAYS HOW URGENT, in Priority Actions' own three tones, and
 * every pill is the same size. The right-hand column says what to do ("Send
 * IFA"), so nobody has to translate a status into an action. A row opens that
 * document on the Data screen. Documents with the other side and not yet late
 * are one line at the foot, not rows: they are not ours to act on.
 */

type Shown = Exclude<ObstacleKind, 'untouched'>;

const TONE: Record<Shown, string> = {
  late: 'bg-bad-soft text-bad',
  comments: 'bg-warn-soft text-warn',
  waiting: 'bg-warn-soft text-warn',
  soon: 'bg-chart-1/10 text-primary',
};

const PAGE = 8;

const dayMonth = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : '';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function OutstandingBlock({
  obstacles,
  register,
  week,
  asOfDate,
  awaiting,
  longestWait,
  onOpen,
  query = '',
}: {
  obstacles: Obstacle[];
  register: RegisterKind;
  week: number;
  /** The end of the week being viewed; "due" runs to LOOKAHEAD_DAYS after it. */
  asOfDate: string;
  /** Documents whose latest send has had no reply. */
  awaiting: number;
  longestWait: number | null;
  /**
   * On the Data screen a row opens the document in place instead of linking
   * to it, and the screen's own search box narrows the list.
   */
  onOpen?: (categoryId: string, documentId: string) => void;
  query?: string;
}) {
  const edl = register === 'edl';
  const q = query.trim().toLowerCase();
  const items = obstacles
    .filter((o): o is Obstacle & { kind: Shown } => o.kind !== 'untouched')
    .filter((o) => q === ''
      || (o.docNo ?? '').toLowerCase().includes(q)
      || o.title.toLowerCase().includes(q)
      || o.categoryName.toLowerCase().includes(q));
  const [limit, setLimit] = useState(PAGE);

  const count = (k: Shown) => items.filter((o) => o.kind === k).length;
  const horizon = new Date(Date.parse(`${asOfDate}T00:00:00Z`) + LOOKAHEAD_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const other = edl ? 'client' : 'reviewer';

  const pill = (o: Obstacle & { kind: Shown }) => {
    switch (o.kind) {
      case 'late': return `Late ${plural(o.days ?? 0, 'day')}`;
      case 'comments': return o.since ? `${o.returnCode ?? 'Back'} ${dayMonth(o.since)}` : (o.returnCode ?? 'Comments');
      case 'waiting': return `${plural(o.days ?? 0, 'day')} out`;
      case 'soon': return `Due ${dayMonth(o.since)}`;
    }
  };
  const meta = (o: Obstacle & { kind: Shown }) => {
    const stage = o.stage ? STAGE_LABEL[o.stage] : '';
    const detail = {
      late: `Planned ${dayMonth(o.since)}`,
      comments: `${stage} came back`,
      waiting: `${stage} sent ${dayMonth(o.since)}`,
      soon: '',
    }[o.kind];
    return [o.categoryName, detail].filter(Boolean).join(' · ');
  };
  // On the vendor register a comment is the vendor's to answer, not ours.
  const action = (o: Obstacle & { kind: Shown }) =>
    o.kind === 'waiting'
      ? (edl ? 'Chase client' : 'Chase review')
      : !edl && o.kind === 'comments'
        ? 'Vendor resends'
        : o.next ? `Send ${STAGE_LABEL[o.next]}` : 'Resend';

  const parts = [
    count('late') > 0 && `${count('late')} late`,
    count('comments') > 0 && `${count('comments')} with comments`,
    count('waiting') > 0 && `${count('waiting')} over ${REPLY_DAYS} days out`,
    count('soon') > 0 && `${count('soon')} due`,
  ].filter(Boolean);

  const overdueOut = count('waiting');

  return (
    <Card>
      <CardHeader>
        <CardTitle className={TYPE.cardTitle}>{edl ? 'What has to go out' : 'What is open'}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 && q !== '' ? (
          <p className="text-sm text-muted-foreground">Nothing outstanding matches that search.</p>
        ) : items.length === 0 ? (
          <div>
            <p className={TYPE.figure}>Nothing to send</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing late, back with comments or due by {dayMonth(horizon)}.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-5 flex flex-wrap items-baseline gap-x-2">
              <span className={TYPE.figure}>{plural(items.length, 'document')}</span>
              <span className="text-sm text-muted-foreground">
                {items.length === 1 ? 'needs' : 'need'} action by {dayMonth(horizon)}
                {parts.length > 0 && ` · ${parts.join(' · ')}`}
              </span>
            </p>
            <ul className="flex flex-col gap-1">
              {items.slice(0, limit).map((o) => (
                <li key={o.documentId}>
                  <RowShell
                    href={`/dokumen/${week}/${edl ? 'data' : 'vdrl-data'}?doc=${o.documentId}`}
                    onOpen={onOpen && (() => onOpen(o.categoryId, o.documentId))}
                    className="-mx-2 grid w-[calc(100%+1rem)] text-left min-h-14 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 py-2 transition-colors duration-200 ease-ios hover:bg-muted/60 sm:grid-cols-[6.5rem_minmax(0,1fr)_7rem] sm:gap-x-4"
                  >
                    <span className={cn(
                      'flex h-7 w-26 items-center justify-center rounded-lg text-xs font-semibold tabular-nums whitespace-nowrap',
                      TONE[o.kind],
                    )}>
                      {pill(o)}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('truncate', TYPE.row)}>{o.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {/* On a phone the action leads the meta line, so a long
                            discipline name truncates instead of the action. */}
                        <span className="font-semibold text-foreground sm:hidden">{action(o)} · </span>
                        {meta(o)}
                      </p>
                    </div>
                    <span className="hidden text-right text-sm font-semibold whitespace-nowrap sm:block">
                      {action(o)}
                    </span>
                  </RowShell>
                </li>
              ))}
            </ul>
            {items.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE)}
                className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
              >
                Show {Math.min(PAGE, items.length - limit)} more
              </button>
            )}
          </>
        )}

        <p className="mt-4 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
          {overdueOut > 0 ? (
            <CircleAlert className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          ) : (
            <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />
          )}
          <span>
            {awaiting === 0
              ? `Nothing with the ${other}`
              : [
                `${awaiting} with the ${other}`,
                overdueOut > 0 ? `${overdueOut} over ${REPLY_DAYS} days` : `None over ${REPLY_DAYS} days`,
                longestWait !== null ? `Longest ${plural(longestWait, 'day')}` : null,
              ].filter(Boolean).join(' · ')}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/** A row is a link on the summary and a button where the document opens in place. */
function RowShell({
  href, onOpen, className, children,
}: {
  href: string;
  onOpen?: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return onOpen
    ? <button type="button" onClick={onOpen} className={className}>{children}</button>
    : <Link href={href} className={className}>{children}</Link>;
}
