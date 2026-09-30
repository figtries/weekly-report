'use client';

import { m } from 'framer-motion';
import { Users, X } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import { hoursEachOf } from '@/lib/daily-items';
import type { ManHourRow, NonEffectiveRow } from '@/lib/types';
import { NumField, Stepper, TextField } from '../fields';
import { CardButton, SectionCard, sameLabel, type CardProps } from '../SectionCard';
import { newId } from '../useDailyReport';

const n0 = (n: number) => n.toLocaleString('en-US');

export default function ManHoursCard({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: CardProps) {
  const rows = report.manHours;
  const ne = report.nonEffective;
  const crewed = rows.filter((r) => r.pobQty > 0);
  const pob = rows.reduce((s, r) => s + r.pobQty, 0);
  const today = rows.reduce((s, r) => s + r.todayHours, 0);
  const cumulative = rows.reduce((s, r) => s + r.previousHours + r.todayHours, 0);

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

  return (
    <SectionCard
      id="manHours"
      icon={<Users className="size-[18px]" />}
      title="Man Hours"
      summary={
        pob > 0
          ? `${crewed.length} ${crewed.length === 1 ? 'company' : 'companies'} · ${pob} POB · ${n0(today)} h today`
          : 'No crew entered yet'
      }
      state={state}
      chipLabel={state === 'same' ? sameLabel(hasPredecessor) : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { manHours: true } })}>
              Confirm
            </CardButton>
            <CardButton onClick={onOpen}>Change</CardButton>
          </>
        ) : state === 'empty' ? (
          <CardButton variant="default" onClick={onOpen}>
            Add crew
          </CardButton>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <TextField label="Company" placeholder="Company" value={r.company} onCommit={(v) => setRow(r.id, { company: v })} />
              <m.button
                type="button"
                {...pressMotion}
                aria-label={`Remove ${r.company || 'company'}`}
                onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-bad sm:size-9"
              >
                <X className="size-4" />
              </m.button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Stepper label={`${r.company || 'company'} people`} value={r.pobQty} onChange={(n) => setPob(r, n)} />
              <span className="text-sm text-muted-foreground">×</span>
              <NumField
                label={`${r.company || 'company'} hours each`}
                value={hoursEachOf(r)}
                onCommit={(n) => setEach(r, n)}
                className="w-16"
              />
              <span className="text-sm text-muted-foreground">h each</span>
              <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{n0(r.todayHours)} h</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span>Previous</span>
              <NumField
                label={`${r.company || 'company'} previous hours`}
                value={r.previousHours}
                onCommit={(n) => setRow(r.id, { previousHours: n })}
                className="w-24 text-xs"
              />
              <span className="ml-auto">Total {n0(r.previousHours + r.todayHours)} h</span>
            </div>
          </div>
        ))}
        <CardButton
          className="w-full flex-none border-dashed text-chart-1"
          onClick={() =>
            setRows([...rows, { id: newId('mh'), company: '', pobQty: 0, hoursEach: 8, previousHours: 0, todayHours: 0 }])
          }
        >
          Add company
        </CardButton>
        <p className="text-[12px] font-medium text-muted-foreground">
          {pob} people · {n0(today)} h today · {n0(cumulative)} h so far
        </p>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-foreground">Non Effective Working Hours</h3>
      <div className="space-y-2">
        {ne.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">{r.cause}</span>
              <div className="flex items-center gap-2">
                <NumField label={`${r.cause} today`} value={r.today} onCommit={(n) => setNe(r.id, { today: n })} className="w-16" />
                <span className="text-[12px] text-muted-foreground">h today</span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <TextField label={`${r.cause} remark`} placeholder="Remark" value={r.remark} onCommit={(v) => setNe(r.id, { remark: v })} />
              <span className="shrink-0 text-[12px] text-muted-foreground">Cumm. {r.previous + r.today}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
