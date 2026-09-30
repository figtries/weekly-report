'use client';

import { m } from 'framer-motion';
import { FileCheck2 } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import DateField from '@/components/ui/DateField';
import { daysLapsed, lapsedPermits } from '@/lib/daily-status';
import type { PtwRow } from '@/lib/types';
import { Labeled, TextField } from '../fields';
import { CardButton, SectionCard, sameLabel, type CardProps } from '../SectionCard';
import { newId, type LogDraft } from '../useDailyReport';

const DATE_CLS =
  'min-h-11 min-w-0 rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1 sm:min-h-9';

const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function PtwCard({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: CardProps) {
  const rows = report.ptw;
  const lapsed = lapsedPermits(report);
  const openCount = rows.filter((r) => r.status.trim().toUpperCase() === 'OPEN').length;

  const setRows = (next: PtwRow[], log?: LogDraft) => commit({ ptw: next, confirmed: { ptw: true } }, log);
  const setRow = (id: string, p: Partial<PtwRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    setRows(
      [
        ...rows,
        { id: newId('ptw'), description: '', type: 'Cold Work', pwtNo: '', pa: '', issued: '', validity: '', status: 'OPEN' },
      ],
      { kind: 'ptw', text: 'Permit added' }
    );
    onOpen();
  };
  const closeLapsed = () =>
    setRows(
      rows.map((r) => (lapsed.some((l) => l.id === r.id) ? { ...r, status: 'CLOSED' } : r)),
      { kind: 'ptw', text: `Closed ${lapsed.map((l) => l.pwtNo || 'permit').join(', ')}` }
    );

  const summary = lapsed[0]
    ? `${openCount} open · validity ended ${dateLabel(lapsed[0].validity)}, ${daysLapsed(lapsed[0].validity, report.date)} days ago`
    : openCount > 0
      ? `${openCount} open`
      : rows.length > 0
        ? `${rows.length} recorded, none open`
        : 'No permits recorded';

  return (
    <SectionCard
      id="ptw"
      icon={<FileCheck2 className="size-[18px]" />}
      title="Permit to Work"
      summary={summary}
      state={state}
      chipLabel={state === 'same' ? sameLabel(hasPredecessor) : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'look' ? (
          <>
            <CardButton variant="default" onClick={closeLapsed}>
              Close it
            </CardButton>
            <CardButton onClick={onOpen}>Extend validity</CardButton>
          </>
        ) : state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { ptw: true } })}>
              Confirm
            </CardButton>
            <CardButton onClick={onOpen}>Change</CardButton>
          </>
        ) : state === 'empty' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { ptw: true } })}>
              None today
            </CardButton>
            <CardButton onClick={add}>Add permit</CardButton>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No permits recorded for this day.</p>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
            <Labeled label="Description" className="sm:col-span-2">
              <TextField multiline label="Description" placeholder="Description" value={r.description} onCommit={(v) => setRow(r.id, { description: v })} />
            </Labeled>
            <Labeled label="Type">
              <TextField label="Type" placeholder="Type" value={r.type} onCommit={(v) => setRow(r.id, { type: v })} />
            </Labeled>
            <Labeled label="PWT No">
              <TextField label="PWT No" placeholder="PWT No" value={r.pwtNo} onCommit={(v) => setRow(r.id, { pwtNo: v })} />
            </Labeled>
            <Labeled label="PA">
              <TextField label="PA" placeholder="PA" value={r.pa} onCommit={(v) => setRow(r.id, { pa: v })} />
            </Labeled>
            <Labeled label="Status">
              <TextField label="Status" placeholder="Status" value={r.status} onCommit={(v) => setRow(r.id, { status: v })} />
            </Labeled>
            <Labeled label="Issued">
              <DateField value={r.issued} onChange={(v) => setRow(r.id, { issued: v })} placeholder="Issued" clearable className={`${DATE_CLS} w-full`} />
            </Labeled>
            <Labeled label="Validity">
              <DateField value={r.validity} onChange={(v) => setRow(r.id, { validity: v })} placeholder="Validity" clearable className={`${DATE_CLS} w-full`} />
            </Labeled>
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              className="min-h-11 justify-self-start text-xs text-muted-foreground transition-colors hover:text-bad sm:min-h-9"
            >
              Remove permit
            </m.button>
          </div>
        ))}
        <CardButton className="w-full flex-none border-dashed text-chart-1" onClick={add}>
          Add permit
        </CardButton>
      </div>
    </SectionCard>
  );
}
