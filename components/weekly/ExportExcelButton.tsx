'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { ExportPackage } from './ExportExcelDialog';

// The overlay rule (AGENTS.md): the dialog stays out of the first bundle.
const ExportExcelDialog = dynamic(() => import('./ExportExcelDialog'));

// The route is a serverless function; a cold one makes the first export wait for
// the boot. Wake it while the button is on screen and again when the tab comes
// back, once every few minutes per week (as the PDF button did for Chromium).
const REWARM_MS = 4 * 60_000;
const lastWarmAt = new Map<number, number>();
function warm(week: number) {
  const last = lastWarmAt.get(week) ?? -Infinity;
  if (Date.now() - last < REWARM_MS) return;
  lastWarmAt.set(week, Date.now());
  fetch(`/api/xlsx/weekly/${week}?warm=1`).catch(() => undefined);
}

/**
 * The weekly report's one way out: the client's workbook in its own look, with the
 * sheets picked in a pop-up (3 Oct 2026; replaced "Save as PDF" in the same corner).
 */
export default function ExportExcelButton({
  week,
  period,
  packages,
  fileName,
  figuresReady,
}: {
  week: number;
  /** "28 Sep – 04 Oct 2026", under the pop-up's title. */
  period: string;
  packages: ExportPackage[];
  fileName: string;
  figuresReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Mounted once opened, so its choices survive closing and reopening it.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    warm(week);
    const onVisible = () => {
      if (document.visibilityState === 'visible') warm(week);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [week]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        aria-label={`Export week ${week} to Excel`}
        className="inline-flex h-11 w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-sm transition-colors duration-300 ease-ios hover:bg-primary-hover hover:shadow-md sm:w-auto sm:px-4 sm:py-2"
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M9 13l3 4m0-4l-3 4" />
        </svg>
        <span className="hidden sm:inline">Export Excel</span>
      </button>
      {mounted && (
        <ExportExcelDialog
          open={open}
          onOpenChange={setOpen}
          week={week}
          period={period}
          packages={packages}
          fileName={fileName}
          figuresReady={figuresReady}
        />
      )}
    </>
  );
}
