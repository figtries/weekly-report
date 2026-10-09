'use client';

import { m } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import DateField from '@/components/ui/DateField';
import { daysLapsed, lapsedPermits } from '@/lib/daily-status';
import type { PtwRow } from '@/lib/types';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { cn } from '@/lib/utils';
import { Labeled, TextField } from '../fields';
import { CapacityNote, RowButton, SectionRow, sameHint, type SectionProps } from '../SectionRow';
import { newId, type LogDraft } from '../useDailyReport';

const DATE_CLS =
  'min-h-11 min-w-0 rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1 sm:min-h-9';

const LINK =
  'inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-chart-1 transition-opacity duration-200 hover:opacity-80 sm:min-h-8';

const dateLabel = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'no date';

export default function PtwSection({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: SectionProps) {
  const rows = report.ptw;
  const lapsed = lapsedPermits(report);
  const lapsedIds = new Set(lapsed.map((l) => l.id));
  const openCount = rows.filter((r) => r.status.trim().toUpperCase() === 'OPEN').length;
  // One permit's fields are open at a time; the list itself stays a list.
  const [editing, setEditing] = useState<string | null>(null);

  const setRows = (next: PtwRow[], log?: LogDraft) => commit({ ptw: next, confirmed: { ptw: true } }, log);
  const setRow = (id: string, p: Partial<PtwRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    const id = newId('ptw');
    setRows(
      [...rows, { id, description: '', type: 'Cold Work', pwtNo: '', pa: '', issued: '', validity: '', status: 'OPEN' }],
      { kind: 'ptw', text: 'Permit added' }
    );
    setEditing(id);
    onOpen();
  };
  const closeLapsed = () =>
    setRows(
      rows.map((r) => (lapsedIds.has(r.id) ? { ...r, status: 'CLOSED' } : r)),
      { kind: 'ptw', text: `Closed ${lapsed.map((l) => l.pwtNo || 'permit').join(', ')}` }
    );
  const extend = () => {
    setEditing(lapsed[0]?.id ?? null);
    onOpen();
  };

  const summary = lapsed[0]
    ? `${openCount} open · validity ended ${daysLapsed(lapsed[0].validity, report.date)} days ago`
    : openCount > 0
      ? `${openCount} open`
      : rows.length > 0
        ? `${rows.length} recorded, none open`
        : 'No permits recorded';

  return (
    <SectionRow
      id="ptw"
      title="Permit to Work"
      summary={summary}
      hint={state === 'same' ? sameHint(hasPredecessor) : undefined}
      state={state}
      open={open}
      onToggle={onToggle}
      stackActions
      actions={
        state === 'look' ? (
          <>
            <RowButton primary onClick={closeLapsed}>
              Close it
            </RowButton>
            <RowButton onClick={extend}>Extend</RowButton>
          </>
        ) : state === 'same' ? (
          <RowButton onClick={() => commit({ confirmed: { ptw: true } })}>Confirm</RowButton>
        ) : state === 'empty' ? (
          <RowButton onClick={() => commit({ confirmed: { ptw: true } })}>None today</RowButton>
        ) : undefined
      }
    >
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No permits recorded for this day.</p>}
      <div className="space-y-2.5">
        {rows.map((r) => {
          const isOpen = r.status.trim().toUpperCase() === 'OPEN';
          const late = lapsedIds.has(r.id);
          const edit = editing === r.id;
          return (
            <div key={r.id} className={cn('rounded-xl border px-3.5 py-3', late ? 'border-amber-300 bg-amber-50/60' : 'border-border bg-card')}>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-foreground">{r.pwtNo || 'New permit'}</p>
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                    isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  )}
                >
                  {r.status || 'No status'}
                </span>
              </div>
              {r.description && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{r.description}</p>}
              <p className={cn('mt-1.5 text-[12px]', late ? 'font-medium text-amber-700' : 'text-gray-400')}>
                {r.validity
                  ? late
                    ? `Valid until ${dateLabel(r.validity)} · ${daysLapsed(r.validity, report.date)} days ago`
                    : `Valid until ${dateLabel(r.validity)}`
                  : 'No validity date'}
              </p>

              {edit && (
                <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-border pt-3 sm:grid-cols-2">
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
                </div>
              )}

              <div className="mt-1 flex items-center gap-5">
                <button type="button" className={LINK} onClick={() => setEditing(edit ? null : r.id)}>
                  {edit ? 'Done' : 'Edit details'}
                </button>
                {edit && (
                  <m.button
                    type="button"
                    {...pressMotion}
                    onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                    className="min-h-11 text-[13px] text-muted-foreground transition-colors hover:text-bad sm:min-h-8"
                  >
                    Remove permit
                  </m.button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className={cn(LINK, 'mt-1')} onClick={add}>
        <Plus className="size-3.5" />
        Add permit
      </button>
      <CapacityNote count={rows.length} capacity={CAPACITY.ptw} what="permits" />
    </SectionRow>
  );
}
