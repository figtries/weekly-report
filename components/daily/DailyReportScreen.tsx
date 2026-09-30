'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PressLink, pressMotion } from '@/components/motion/Press';
import SavePdfButton from '@/components/print/SavePdfButton';
import { readyCount, sectionStates } from '@/lib/daily-status';
import type { DailyReport, DailySectionKey } from '@/lib/types';
import DailyHeader from './DailyHeader';
import SaveChangesButton from './SaveChangesButton';
import { GroupCard } from './SectionRow';
import ActivitiesSection from './sections/ActivitiesSection';
import AocSection from './sections/AocSection';
import HseSection from './sections/HseSection';
import ManHoursSection from './sections/ManHoursSection';
import PhotosSection from './sections/PhotosSection';
import PtwSection from './sections/PtwSection';
import WeatherSection from './sections/WeatherSection';
import TodayLog, { type LogRow } from './TodayLog';
import { useDailyReport } from './useDailyReport';

export interface DailyScreenProps {
  initial: DailyReport;
  project: { name: string; location: string };
  weatherLabels: Record<string, string>;
  hasPredecessor: boolean;
  /** Photo path to the instant it was taken (or uploaded), for "Today so far". */
  photoTimes: Record<string, string>;
  /** Week and day of the project for this date, computed from the plan; null with none. */
  weekDay: { week: number; day: number } | null;
}

export default function DailyReportScreen(props: DailyScreenProps) {
  const { initial, project, weatherLabels, hasPredecessor, weekDay } = props;
  const router = useRouter();
  const { report, commit, retry, failed, pending, setPhotos, flush } = useDailyReport(initial);
  const [open, setOpen] = useState<DailySectionKey | null>(null);
  const [times, setTimes] = useState(props.photoTimes);

  const states = useMemo(() => sectionStates(report), [report]);
  const ready = readyCount(states);

  // An upload is written by its own route and announced on the window. Mirror
  // the list, and stamp each new path with the moment it arrived.
  useEffect(() => {
    function onPhotos(e: Event) {
      const d = (e as CustomEvent).detail as { uploadUrl?: string; photos?: (string | null)[] } | null;
      if (d?.uploadUrl !== `/api/daily/${initial.date}/photos` || !Array.isArray(d.photos)) return;
      const photos = d.photos;
      setTimes((prev) => {
        const next = { ...prev };
        for (const p of photos) if (p && !next[p]) next[p] = new Date().toISOString();
        return next;
      });
      setPhotos(photos);
    }
    window.addEventListener('photos-updated', onPhotos);
    return () => window.removeEventListener('photos-updated', onPhotos);
  }, [initial.date, setPhotos]);

  // A change is on screen the instant it is made and reaches the store a moment
  // later. Closing the tab in that moment would lose it, so the browser is asked
  // to confirm while anything is still unsaved.
  useEffect(() => {
    if (pending === 0) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [pending]);

  const rows = useMemo<LogRow[]>(
    () => [
      ...(report.log ?? []),
      ...report.photos.flatMap((p, i) =>
        p && times[p]
          ? [{ id: `photo-${p}`, at: times[p], kind: 'photo' as const, text: `Photo ${i + 1}`, thumb: p }]
          : []
      ),
    ],
    [report.log, report.photos, times]
  );

  const weekday = new Date(`${report.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const subtitle = [weekDay ? `Week ${weekDay.week} · Day ${weekDay.day}` : '', project.name, project.location]
    .filter(Boolean)
    .join(' · ');

  // One part is open at a time: opening another closes the first, so the page never
  // grows into a long form and the row you just pressed stays where your thumb is.
  const shared = (k: DailySectionKey) => ({
    report,
    commit,
    state: states[k],
    open: open === k,
    onToggle: () => setOpen((cur) => (cur === k ? null : k)),
    onOpen: () => setOpen(k),
    hasPredecessor,
  });

  return (
    <div>
      {/* Back on the left, the two ways a report leaves on the right: Export Excel and Save
          changes, one size and differing only in colour. On a phone the pair takes a row of
          its own at half the width each, so neither shrinks to an icon. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <PressLink
        {...pressMotion}
        href="/daily"
        onClick={(e) => {
          // Leave only once every change has been written, then refresh so the
          // list shows this day's figures rather than the payload from before.
          if (pending > 0) {
            e.preventDefault();
            void flush().then(() => {
              router.refresh();
              router.push('/daily');
            });
            return;
          }
          router.refresh();
        }}
        className="inline-flex min-h-11 items-center gap-2 text-muted-foreground transition-colors duration-200 ease-ios hover:text-foreground sm:min-h-0"
        aria-label="Back to daily reports"
      >
        <ArrowLeft className="size-5" />
        <span className="text-sm font-medium">Back</span>
      </PressLink>
      {/* The daily report leaves as the client's own Excel workbook, not as a PDF. The
          same button walk (prepare, count, save) serves it; it waits for autosave first. */}
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
      <SavePdfButton
        variant="outline"
        labelAlways
        className="sm:w-44"
        url={`/api/xlsx/daily/${report.date}`}
        filename={`DAILY PROGRESS REPORT ${report.date.slice(8, 10)}${report.date.slice(5, 7)}${report.date.slice(0, 4)}.xlsx`}
        ariaLabel="Export the daily report as Excel"
        label="Export Excel"
        noun="Excel"
        mime="spreadsheetml"
        warm={false}
        beforeDownload={flush}
      />
      <SaveChangesButton flush={flush} retry={retry} href="/daily" className="sm:w-44" />
      </div>
      </div>

      <DailyHeader
        title={weekday}
        subtitle={subtitle}
        states={states}
        ready={ready}
        pending={pending}
        failed={!!failed}
        onRetry={retry}
      />

      {/* `grid-cols-1` is minmax(0, 1fr): a bare grid's column is `auto`, and one long
          unbreakable line in an open part then widened the whole column (and the log
          beside it) past the screen. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <GroupCard title="On site" className="animate-enter stagger-1">
            <WeatherSection {...shared('weather')} labels={weatherLabels} />
            <ManHoursSection {...shared('manHours')} />
          </GroupCard>
          <GroupCard title="Work" className="animate-enter stagger-2">
            <ActivitiesSection {...shared('activities')} />
            <PhotosSection {...shared('photos')} />
          </GroupCard>
          <GroupCard title="Safety" className="animate-enter stagger-3">
            <HseSection {...shared('hse')} />
            <PtwSection {...shared('ptw')} />
            <AocSection {...shared('aoc')} />
          </GroupCard>
        </div>
        <div className="animate-enter stagger-4 min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:self-start">
          <TodayLog rows={rows} />
        </div>
      </div>
    </div>
  );
}
