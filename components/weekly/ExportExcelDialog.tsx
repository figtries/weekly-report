'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import SavePdfButton from '@/components/print/SavePdfButton';
import { CheckBox } from '@/components/ui/CheckBox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OVERALL, selectionCount, selectionQuery, type WeeklySelection } from '@/lib/xlsx/weekly-selection';

export interface ExportPackage {
  /** `SummaryRow.key`, what the route reads the package by. */
  key: string;
  /** As the project names it, the same words as its Summary card. */
  label: string;
}

/**
 * Which sheets go into the weekly workbook (variant V2, chosen 3 Oct 2026): the two
 * report sheets, then one row per work package with a Detail and an S-Curve box.
 * Everything is ticked on opening, which reproduces the client's sample. Nothing is
 * flagged until Export is pressed (validate on action only).
 */
export default function ExportExcelDialog({
  open,
  onOpenChange,
  week,
  period,
  packages,
  fileName,
  figuresReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  week: number;
  period: string;
  packages: ExportPackage[];
  fileName: string;
  figuresReady: boolean;
}) {
  const rows: ExportPackage[] = [{ key: OVERALL, label: 'Overall' }, ...packages];
  const all = rows.map((r) => r.key);
  const [sel, setSel] = useState<WeeklySelection>(() => ({
    documentation: true,
    summary: figuresReady,
    detail: figuresReady ? all : [],
    scurve: figuresReady ? all : [],
  }));
  const [error, setError] = useState('');
  const n = selectionCount(sel);

  const toggle = (list: 'detail' | 'scurve', key: string) => {
    setError('');
    setSel((s) => ({
      ...s,
      [list]: s[list].includes(key) ? s[list].filter((k) => k !== key) : all.filter((k) => k === key || s[list].includes(k)),
    }));
  };
  const flip = (field: 'documentation' | 'summary') => {
    setError('');
    setSel((s) => ({ ...s, [field]: !s[field] }));
  };

  const cell = 'flex min-h-11 items-center justify-center';

  /**
   * FOCUS MOVES AFTER THE FIRST FRAMES, NOT BEFORE THEM. Radix focuses the first
   * checkbox while it mounts the card, and a focus() makes the browser lay out the
   * whole report page under it: 90 ms of the open at CPU 4x, all of it before the
   * first frame of the animation could be drawn (3 Oct 2026). So the card opens
   * first and focus follows two frames later, without scrolling anything; on close
   * it goes back to the button that opened it the same way. Keyboard and screen
   * reader users still land inside the dialog and return to the button.
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Opens on the app's own motion, not shadcn's 100ms pop: see `.dialog-soft`
          in app/globals.css. A plain dark scrim, no blur, like the activity sheet. */}
      <DialogContent
        className="dialog-soft max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        overlayClassName="scrim-soft bg-black/40 supports-backdrop-filter:backdrop-blur-none"
        ref={contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          later(() => contentRef.current?.focus({ preventScroll: true }));
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const back = opener.current;
          if (back) later(() => back.focus({ preventScroll: true }));
        }}
      >
        <DialogHeader>
          <DialogTitle>Export Excel</DialogTitle>
          <DialogDescription>
            Week {week} · {period}
          </DialogDescription>
        </DialogHeader>

        {!figuresReady && (
          <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Progress sheets are held until every activity has a budget and the weights total 100%.{' '}
            <Link href={`/weekly/${week}/weights`} className="font-semibold underline underline-offset-2">
              Open Weights
            </Link>
          </p>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Report</p>
          {(
            [
              ['documentation', 'Documentation', true],
              ['summary', 'Summary Overall', figuresReady],
            ] as const
          ).map(([field, label, enabled]) => (
            <label key={field} className={`flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm ${enabled ? 'cursor-pointer hover:bg-muted/60' : 'opacity-50'}`}>
              <CheckBox checked={sel[field]} disabled={!enabled} onChange={() => flip(field)} />
              <span className="font-medium text-foreground">{label}</span>
            </label>
          ))}
        </div>

        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-end px-2 pb-1 text-xs font-medium text-muted-foreground">
            <span>Work package</span>
            <span className="text-center">Detail</span>
            <span className="text-center">S-Curve</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className={`grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center rounded-lg px-2 text-sm hover:bg-muted/60 ${figuresReady ? '' : 'opacity-50'}`}>
              <span className={`truncate ${r.key === OVERALL ? 'font-semibold text-foreground' : 'text-foreground'}`} title={r.label}>
                {r.label}
              </span>
              {(['detail', 'scurve'] as const).map((list) => (
                <label key={list} className={`${cell} ${figuresReady ? 'cursor-pointer' : ''}`} aria-label={`${list === 'detail' ? 'Detail' : 'S-Curve'} ${r.label}`}>
                  <CheckBox checked={sel[list].includes(r.key)} disabled={!figuresReady} onChange={() => toggle(list, r.key)} />
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className="pt-1">
          <SavePdfButton
            url={`/api/xlsx/weekly/${week}?${selectionQuery(sel)}`}
            filename={fileName}
            ariaLabel={`Export ${n} sheets of week ${week} to Excel`}
            label={`Export ${n} ${n === 1 ? 'sheet' : 'sheets'}`}
            noun="Excel"
            mime="spreadsheet"
            warm={false}
            labelAlways
            beforeDownload={async () => {
              if (n > 0) return true;
              setError('Choose at least one sheet first.');
              return false;
            }}
          />
          <p role="alert" className="mt-2 min-h-5 text-sm font-medium text-rose-600">
            {error}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
