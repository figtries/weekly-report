'use client';

import { m } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import DateField from '@/components/ui/DateField';
import type { AocRow } from '@/lib/types';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { cn } from '@/lib/utils';
import NativeSelect from '@/components/ui/NativeSelect';
import { Labeled, TextField } from '../fields';
import { CapacityNote, RowButton, SectionRow, type SectionProps } from '../SectionRow';
import { newId } from '../useDailyReport';

const DATE_CLS =
  'min-h-11 min-w-0 rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1 sm:min-h-9';

const LINK =
  'inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-chart-1 transition-opacity duration-200 hover:opacity-80 sm:min-h-8';

const dateLabel = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'no date';

export default function AocSection({ report, commit, state, open, onToggle, onOpen }: SectionProps) {
  const rows = report.aoc ?? [];
  const [editing, setEditing] = useState<string | null>(null);

  const setRows = (next: AocRow[]) => commit({ aoc: next, aocNone: false, confirmed: { aoc: true } });
  const setRow = (id: string, p: Partial<AocRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    const id = newId('aoc');
    setRows([...rows, { id, type: 'AOC', description: '', date: report.date, actionBy: '', status: 'OPEN' }]);
    setEditing(id);
    onOpen();
  };

  return (
    <SectionRow
      id="aoc"
      title="Area of Concern"
      summary={rows.length > 0 ? `${rows.length} raised` : report.aocNone ? 'None today' : 'Nothing raised yet'}
      state={state}
      open={open}
      onToggle={onToggle}
      stackActions
      actions={
        state === 'empty' ? (
          <>
            <RowButton onClick={() => commit({ aoc: [], aocNone: true, confirmed: { aoc: true } })}>None today</RowButton>
            <RowButton primary onClick={add}>
              Raise
            </RowButton>
          </>
        ) : undefined
      }
    >
      {rows.length === 0 && (
        <p className="text-sm leading-snug text-muted-foreground">
          {report.aocNone
            ? 'You marked this day as having no area of concern.'
            : 'Nothing raised for this day. Raise an area of concern, or ask for help (AFH), when something on site needs attention.'}
        </p>
      )}
      <div className="space-y-2.5">
        {rows.map((r) => {
          const edit = editing === r.id;
          const isOpen = r.status.trim().toUpperCase() === 'OPEN';
          return (
            <div key={r.id} className="rounded-xl border border-border bg-card px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {r.type} <span className="font-normal text-gray-400">· {dateLabel(r.date)}</span>
                </p>
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                    isOpen ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                  )}
                >
                  {r.status || 'No status'}
                </span>
              </div>
              {r.description && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{r.description}</p>}
              {r.actionBy && <p className="mt-1.5 text-[12px] text-gray-400">Action by {r.actionBy}</p>}

              {edit && (
                <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-border pt-3 sm:grid-cols-2">
                  <Labeled label="Type">
                    <NativeSelect
                      aria-label="Type"
                      value={r.type}
                      onChange={(e) => setRow(r.id, { type: e.target.value as AocRow['type'] })}
                      className="bg-card pl-3 sm:h-9"
                    >
                      <option value="AOC">AOC (Area of Concern)</option>
                      <option value="AFH">AFH (Ask for Help)</option>
                    </NativeSelect>
                  </Labeled>
                  <Labeled label="Date">
                    <DateField value={r.date} onChange={(v) => setRow(r.id, { date: v })} placeholder="Date" className={`${DATE_CLS} w-full`} />
                  </Labeled>
                  <Labeled label="Description" className="sm:col-span-2">
                    <TextField multiline label="Description" placeholder="Description" value={r.description} onCommit={(v) => setRow(r.id, { description: v })} />
                  </Labeled>
                  <Labeled label="Action by">
                    <TextField label="Action by" placeholder="Action by" value={r.actionBy} onCommit={(v) => setRow(r.id, { actionBy: v })} />
                  </Labeled>
                  <Labeled label="Status">
                    <TextField label="Status" placeholder="Status" value={r.status} onCommit={(v) => setRow(r.id, { status: v })} />
                  </Labeled>
                </div>
              )}

              <div className="mt-1 flex items-center gap-5">
                <button type="button" className={LINK} onClick={() => setEditing(edit ? null : r.id)}>
                  {edit ? 'Done' : 'Edit'}
                </button>
                {edit && (
                  <m.button
                    type="button"
                    {...pressMotion}
                    onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                    className="min-h-11 text-[13px] text-muted-foreground transition-colors hover:text-bad sm:min-h-8"
                  >
                    Remove
                  </m.button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className={cn(LINK, 'mt-1')} onClick={add}>
        <Plus className="size-3.5" />
        {rows.length === 0 ? 'Raise a concern' : 'Raise another'}
      </button>
      <CapacityNote count={rows.length} capacity={CAPACITY.aoc} what="lines" />
    </SectionRow>
  );
}
