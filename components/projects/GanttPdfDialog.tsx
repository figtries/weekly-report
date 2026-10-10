'use client';

import { useMemo, useRef, useState } from 'react';
import SavePdfButton from '@/components/print/SavePdfButton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { estimatePages, levelsIn, type PrintRowLite } from '@/lib/gantt-print';

/**
 * What goes into the Gantt PDF (8 Oct 2026): the whole plan or one work
 * package, and how many levels of it. "Free to print all of it or just part of
 * it" was the brief; the page count under the choices says what a choice makes
 * before anyone presses, from the same layout the PDF is cut with.
 */
export default function GanttPdfDialog({
  open,
  onOpenChange,
  projectId,
  fileBase,
  parties,
  packages,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The project's initial and name, the start of the file name. */
  fileBase: string;
  /** Printed in the corner only when ticked: unasked, it read as clutter (8 Oct 2026). */
  parties: { client: string | null; contractor: string | null };
  packages: { id: string; label: string }[];
  rows: PrintRowLite[];
}) {
  // Ticked: 'all', or any number of packages (10 Oct 2026, radios became checkboxes).
  const [ticked, setTicked] = useState<string[]>(['all']);
  const whole = ticked.includes('all');
  const scope = whole ? 'all' : packages.filter((p) => ticked.includes(p.id)).map((p) => p.id).join(',');
  const toggle = (id: string, on: boolean) =>
    setTicked(
      id === 'all'
        ? on ? ['all'] : []
        : (whole ? packages.map((p) => p.id) : ticked).filter((t) => t !== id).concat(on ? [id] : []),
    );
  const [levels, setLevels] = useState(0);
  const [shown, setShown] = useState({ client: false, contractor: false });
  const partyChoices = (['client', 'contractor'] as const).filter((k) => parties[k]);
  const depth = useMemo(() => levelsIn(rows, scope), [rows, scope]);
  // A level the new choice does not have falls back to all of them.
  const shownLevels = levels < depth ? levels : 0;
  const size = useMemo(() => estimatePages(rows, scope, shownLevels), [rows, scope, shownLevels]);
  const picked = whole ? undefined : packages.find((p) => p.id === scope);
  const fileName = `${fileBase} - Schedule${picked ? ` - ${picked.label}` : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  // Up to three levels besides All: four buttons that share both edges, 2 x 2 on a phone.
  const levelChoices = Array.from({ length: Math.max(0, Math.min(depth - 1, 3)) }, (_, i) => i + 1);
  const levelCols = levelChoices.length === 3 ? 'grid-cols-2 sm:grid-cols-4' : levelChoices.length === 2 ? 'grid-cols-3' : 'grid-cols-2';

  // Focus after the first frames, as in ExportExcelDialog: Radix focusing while
  // the card mounts costs the open its first frames.
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

  const option = (active: boolean) =>
    `flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${
      active ? 'bg-primary/10 font-semibold text-foreground' : 'text-foreground hover:bg-muted/60'
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="dialog-soft max-h-[90dvh] overflow-y-auto sm:max-w-md"
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
          <DialogTitle>Download PDF</DialogTitle>
          <DialogDescription>Gantt chart on A4 landscape, with a key on every page.</DialogDescription>
        </DialogHeader>

        {packages.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">What to include</p>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {[{ id: 'all', label: 'Whole plan' }, ...packages].map((p) => (
                <label key={p.id} className={option(whole || ticked.includes(p.id))}>
                  <input
                    type="checkbox"
                    checked={whole || ticked.includes(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    className="size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="min-w-0">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {levelChoices.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">How much detail</p>
            <div className={`grid gap-1.5 ${levelCols}`} role="radiogroup" aria-label="How much detail">
              {[0, ...levelChoices].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={shownLevels === n}
                  onClick={() => setLevels(n)}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors duration-200 ease-ios ${
                    shownLevels === n ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  {n === 0 ? 'All levels' : n === 1 ? 'Top level' : `${n} levels`}
                </button>
              ))}
            </div>
          </div>
        )}

        {partyChoices.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Show on the page</p>
            <div className="space-y-0.5">
              {partyChoices.map((k) => (
                <label key={k} className={option(shown[k])}>
                  <input
                    type="checkbox"
                    checked={shown[k]}
                    onChange={(e) => setShown((s) => ({ ...s, [k]: e.target.checked }))}
                    className="size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="min-w-0">
                    {k === 'client' ? 'Client' : 'Contractor'} · {parties[k]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1">
          <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
            {!scope
              ? 'Tick at least one to download.'
              : size.rows === 0
                ? 'Nothing to print here yet.'
                : `${size.rows} ${size.rows === 1 ? 'row' : 'rows'} · ${size.pages} ${size.pages === 1 ? 'page' : 'pages'}`}
          </p>
          {scope && <SavePdfButton
            url={`/api/pdf/projects/${projectId}?scope=${encodeURIComponent(scope)}&levels=${shownLevels}${shown.client ? '&client=1' : ''}${shown.contractor ? '&contractor=1' : ''}`}
            filename={fileName}
            ariaLabel={`Download the Gantt chart as a PDF, ${size.pages} pages`}
            label="Download PDF"
            labelAlways
          />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
