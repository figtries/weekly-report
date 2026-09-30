'use client';

import { m } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import type { HseRow } from '@/lib/types';
import { NumField } from '../fields';
import { CardButton, SectionCard, sameLabel, type CardProps } from '../SectionCard';

export default function HseCard({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: CardProps) {
  const rows = report.hseInput;
  const hits = rows.filter((r) => r.today > 0);
  const setRow = (id: string, p: Partial<HseRow>) =>
    commit({ hseInput: rows.map((r) => (r.id === id ? { ...r, ...p } : r)), confirmed: { hse: true } });
  // A tap is a fact with a time; a typed total is a correction and is not logged.
  const plusOne = (r: HseRow) =>
    commit(
      { hseInput: rows.map((x) => (x.id === r.id ? { ...x, today: x.today + 1 } : x)), confirmed: { hse: true } },
      { kind: 'hse', text: `${r.activity} +1` }
    );

  return (
    <SectionCard
      id="hse"
      icon={<ShieldCheck className="size-[18px]" />}
      title="HSE Input"
      summary={hits.length ? hits.map((r) => `${r.activity} ${r.today}`).join(' · ') : 'All zero today'}
      state={state}
      chipLabel={state === 'same' ? sameLabel(hasPredecessor) : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { hse: true } })}>
              Confirm
            </CardButton>
            <CardButton onClick={onOpen}>Change</CardButton>
          </>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3">
            <span className="min-w-0 flex-1 basis-40 text-sm font-medium text-foreground">{r.activity}</span>
            <span className="text-[12px] text-muted-foreground">Previous {r.previous}</span>
            <NumField label={`${r.activity} today`} value={r.today} onCommit={(n) => setRow(r.id, { today: n })} className="w-16" />
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => plusOne(r)}
              aria-label={`Add one ${r.activity}`}
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-chart-1 transition-colors hover:bg-muted sm:min-h-9"
            >
              +1
            </m.button>
            <span className="w-16 text-right text-[12px] font-medium text-foreground">Cumm. {r.previous + r.today}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
