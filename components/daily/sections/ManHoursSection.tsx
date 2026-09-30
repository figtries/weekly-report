'use client';

import { m } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { hoursEachOf } from '@/lib/daily-items';
import type { ManHourRow, NonEffectiveRow } from '@/lib/types';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { Labeled, NumField, Stepper, TextField } from '../fields';
import { CapacityNote, RowButton, SectionRow, sameHint, type SectionProps } from '../SectionRow';
import { newId } from '../useDailyReport';

const n0 = (n: number) => n.toLocaleString('en-US');
const n1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const LINK = 'inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-chart-1 transition-opacity duration-200 hover:opacity-80 sm:min-h-8';

export default function ManHoursSection({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: SectionProps) {
  const rows = report.manHours;
  const ne = report.nonEffective;
  // "Adjust" is where the rarely changed things live: a company's name, its hours each,
  // the running total from before this report, and a cause's remark.
  const [adjust, setAdjust] = useState(false);
  const [allCauses, setAllCauses] = useState(false);

  const crewed = rows.filter((r) => r.pobQty > 0);
  const pob = rows.reduce((s, r) => s + r.pobQty, 0);
  const today = rows.reduce((s, r) => s + r.todayHours, 0);
  const cumulative = rows.reduce((s, r) => s + r.previousHours + r.todayHours, 0);
  const lost = ne.reduce((s, r) => s + r.today, 0);

  const setRows = (next: ManHourRow[]) => commit({ manHours: next, confirmed: { manHours: true } });
  const setRow = (id: string, p: Partial<ManHourRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  // Counting heads is the whole job: today's hours follow from people × hours each.
  const setPob = (r: ManHourRow, n: number) => {
    const each = hoursEachOf(r);
    setRow(r.id, { pobQty: n, hoursEach: each || undefined, todayHours: each ? n * each : r.todayHours });
  };
  const setEach = (r: ManHourRow, n: number) => setRow(r.id, { hoursEach: n, todayHours: r.pobQty * n });
  const setNe = (id: string, p: Partial<NonEffectiveRow>) =>
    commit({ nonEffective: ne.map((r) => (r.id === id ? { ...r, ...p } : r)), confirmed: { manHours: true } });

  const visibleCauses = allCauses ? ne : ne.filter((r, i) => i < 2 || r.today > 0);

  return (
    <SectionRow
      id="manHours"
      title="Man hours"
      summary={
        pob > 0
          ? `${crewed.length} ${crewed.length === 1 ? 'company' : 'companies'} · ${pob} people · ${n0(today)} h today`
          : 'No crew entered yet'
      }
      hint={state === 'same' ? sameHint(hasPredecessor) : undefined}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <RowButton onClick={() => commit({ confirmed: { manHours: true } })}>Confirm</RowButton>
        ) : state === 'empty' ? (
          <RowButton onClick={onOpen}>Add crew</RowButton>
        ) : undefined
      }
    >
      <div>
        {rows.map((r) => {
          const each = hoursEachOf(r);
          const name = r.company || 'New company';
          return adjust ? (
            <div key={r.id} className="space-y-2 border-b border-border py-3 last:border-b-0">
              <div className="flex items-center gap-2">
                <TextField label="Company" placeholder="Company name" value={r.company} onCommit={(v) => setRow(r.id, { company: v })} />
                <m.button
                  type="button"
                  {...pressMotion}
                  aria-label={`Remove ${name}`}
                  onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-muted hover:text-bad sm:size-9"
                >
                  <X className="size-4" />
                </m.button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Labeled label="Hours each">
                  <NumField label={`${name} hours each`} value={each} onCommit={(n) => setEach(r, n)} />
                </Labeled>
                <Labeled label="Previous total (h)">
                  <NumField label={`${name} previous hours`} value={r.previousHours} onCommit={(n) => setRow(r.id, { previousHours: n })} />
                </Labeled>
              </div>
            </div>
          ) : (
            <div key={r.id} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{name}</p>
                <p className="text-[12px] text-gray-400">{each > 0 ? `${each} h each` : 'Set hours in Adjust'}</p>
              </div>
              <Stepper label={`${name} people`} value={r.pobQty} onChange={(n) => setPob(r, n)} />
              <span className="w-12 text-right text-[13px] tabular-nums text-muted-foreground">{n0(r.todayHours)} h</span>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-x-5">
          <button
            type="button"
            className={LINK}
            onClick={() => {
              setRows([...rows, { id: newId('mh'), company: '', pobQty: 0, hoursEach: 8, previousHours: 0, todayHours: 0 }]);
              setAdjust(true);
            }}
          >
            <Plus className="size-3.5" />
            Add company
          </button>
          <button type="button" className={LINK} onClick={() => setAdjust((v) => !v)}>
            {adjust ? 'Done adjusting' : 'Adjust names and hours'}
          </button>
        </div>
        <p className="mt-1 border-t border-border pt-2.5 text-[12.5px] tabular-nums text-muted-foreground">
          {pob} people · {n0(today)} h today · {n0(cumulative)} h so far
        </p>
        <CapacityNote count={rows.length} capacity={CAPACITY.crew} what="companies" fold />

        <div className="mt-4 rounded-xl border border-border bg-muted/30 px-3 pb-1.5 pt-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-foreground">Lost time</p>
            <p className="text-[12.5px] tabular-nums text-muted-foreground">{n1(lost)} h today</p>
          </div>
          {visibleCauses.map((r) => (
            <div key={r.id} className="border-b border-border/70 py-2 last:border-b-0">
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-sm text-foreground">{r.cause}</p>
                <Stepper label={`${r.cause} hours`} value={r.today} step={0.5} onChange={(n) => setNe(r.id, { today: n })} />
                <span className="w-4 text-[12px] text-gray-400">h</span>
              </div>
              {adjust && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Labeled label="Previous total (h)">
                    <NumField label={`${r.cause} previous`} value={r.previous} onCommit={(n) => setNe(r.id, { previous: n })} />
                  </Labeled>
                  <Labeled label="Remark">
                    <TextField label={`${r.cause} remark`} placeholder="Remark" value={r.remark} onCommit={(v) => setNe(r.id, { remark: v })} />
                  </Labeled>
                </div>
              )}
            </div>
          ))}
          {ne.length > visibleCauses.length || allCauses ? (
            <button type="button" className={LINK} onClick={() => setAllCauses((v) => !v)}>
              {allCauses ? 'Show fewer causes' : `Show ${ne.length - visibleCauses.length} more causes`}
            </button>
          ) : null}
          <CapacityNote count={ne.length} capacity={CAPACITY.nonEffective} what="causes" fold />
        </div>
      </div>
    </SectionRow>
  );
}
