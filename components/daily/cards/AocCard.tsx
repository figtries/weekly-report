'use client';

import { m } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import DateField from '@/components/ui/DateField';
import type { AocRow } from '@/lib/types';
import { INPUT_CLS, Labeled, TextField } from '../fields';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { CapacityNote, CardButton, SectionCard, type CardProps } from '../SectionCard';
import { newId } from '../useDailyReport';

const DATE_CLS =
  'min-h-11 min-w-0 rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1 sm:min-h-9';

export default function AocCard({ report, commit, state, open, onToggle, onOpen }: CardProps) {
  const rows = report.aoc ?? [];
  const setRows = (next: AocRow[]) => commit({ aoc: next, aocNone: false, confirmed: { aoc: true } });
  const setRow = (id: string, p: Partial<AocRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    setRows([
      ...rows,
      { id: newId('aoc'), type: 'AOC', description: '', date: report.date, actionBy: '', status: 'OPEN' },
    ]);
    onOpen();
  };

  return (
    <SectionCard
      id="aoc"
      icon={<TriangleAlert className="size-[18px]" />}
      title="Area of Concern"
      summary={rows.length > 0 ? `${rows.length} raised` : report.aocNone ? 'None today' : 'Nothing raised yet'}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'empty' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ aoc: [], aocNone: true, confirmed: { aoc: true } })}>
              None today
            </CardButton>
            <CardButton onClick={add}>Add</CardButton>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing raised for this day.</p>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
            <Labeled label="Type">
              <select
                aria-label="Type"
                value={r.type}
                onChange={(e) => setRow(r.id, { type: e.target.value as AocRow['type'] })}
                className={INPUT_CLS}
              >
                <option value="AOC">AOC (Area of Concern)</option>
                <option value="AFH">AFH (Ask for Help)</option>
              </select>
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
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              className="min-h-11 justify-self-start text-xs text-muted-foreground transition-colors hover:text-bad sm:min-h-9"
            >
              Remove
            </m.button>
          </div>
        ))}
        <CardButton className="w-full flex-none border-dashed text-chart-1" onClick={add}>
          Add area of concern
        </CardButton>
        <CapacityNote count={rows.length} capacity={CAPACITY.aoc} what="lines" />
      </div>
    </SectionCard>
  );
}
