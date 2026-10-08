'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import type { PrintRowLite } from '@/lib/gantt-print';

// The overlay rule (AGENTS.md), the same way ExportExcelButton loads its pop-up:
// out of the first bundle, fetched once the page has loaded and again on the
// first touch, mounted closed so a press only opens it.
const loadDialog = () => import('./GanttPdfDialog');
const GanttPdfDialog = dynamic(loadDialog);
let dialogReady: Promise<unknown> | null = null;
function preloadDialog(): Promise<unknown> {
  dialogReady ??= loadDialog().catch(() => {
    dialogReady = null;
  });
  return dialogReady;
}

/** The plan as a PDF to send (8 Oct 2026): beside Details, opening the choices. */
export default function GanttPdfButton({
  projectId,
  fileBase,
  parties,
  packages,
  rows,
}: {
  projectId: string;
  fileBase: string;
  parties: { client: string | null; contractor: string | null };
  packages: { id: string; label: string }[];
  rows: PrintRowLite[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let live = true;
    const start = () => {
      void preloadDialog().then(() => {
        if (live) setMounted(true);
      });
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      live = false;
      window.removeEventListener('load', start);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onPointerDown={preloadDialog}
        onFocus={preloadDialog}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        aria-label="Download the plan as a PDF"
        disabled={rows.length === 0}
        // Lucille blue, as Export Excel is: the export of this screen (8 Oct 2026).
        // A square icon on a phone, so the three header buttons share the way
        // back's line and sit flush right (8 Oct 2026).
        className="inline-flex size-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-white shadow-sm transition-colors duration-300 ease-ios hover:bg-primary-hover hover:shadow-md active:scale-[0.97] disabled:opacity-50 sm:h-9 sm:w-auto sm:px-3"
      >
        <FileDown className="size-4" />
        <span className="hidden sm:inline">PDF</span>
      </button>
      {/* Its own boundary: a lazy component suspends once, and without one the
          header around this button would flash back to its skeleton. */}
      {mounted && (
        <Suspense fallback={null}>
          <GanttPdfDialog
            open={open}
            onOpenChange={setOpen}
            projectId={projectId}
            fileBase={fileBase}
            parties={parties}
            packages={packages}
            rows={rows}
          />
        </Suspense>
      )}
    </>
  );
}
