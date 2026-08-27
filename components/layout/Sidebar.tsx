'use client';

import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  CalendarDays,
  FileText,
  Files,
  LayoutDashboard,
  Menu,
  Scale,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import ProjectSwitcher from '@/components/portfolio/ProjectSwitcher';
import { cn } from '@/lib/utils';
import type { ProjectSummary } from '@/lib/workspace';

/**
 * Six destinations, not twelve.
 *
 * The old list mirrored the Excel workbook: four of its entries were report
 * SHEETS, which are output, not places to go. They belong to one Laporan
 * destination with tabs, exactly as they appear in the PDF. Everything used to
 * put numbers in sits under Progress; everything used once a project starts
 * sits under Pengaturan, at the bottom, where it stops competing for attention
 * every day.
 *
 * `match` decides highlighting, so a destination stays lit while the user moves
 * between its own tabs.
 */
interface Destination {
  label: string;
  icon: LucideIcon;
  href: (week: number) => string;
  match: (pathname: string) => boolean;
  /** Routes to warm during idle time — the tabs reachable from this entry. */
  warm?: (week: number) => string[];
}

const WEEKLY_PROGRESS = ['input', 'overall', 'control'];
const WEEKLY_REPORT = ['summary', 'detail', 'scurve', 'documentation', 'print'];

const DESTINATIONS: Destination[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: () => '/',
    match: (p) => p === '/',
  },
  {
    label: 'Progress',
    icon: Activity,
    href: (w) => `/weekly/${w}/input`,
    match: (p) => WEEKLY_PROGRESS.some((k) => p.endsWith(`/${k}`)),
    warm: (w) => WEEKLY_PROGRESS.map((k) => `/weekly/${w}/${k}`),
  },
  {
    label: 'Harian',
    icon: CalendarDays,
    href: () => '/daily',
    match: (p) => p.startsWith('/daily'),
    warm: () => ['/daily'],
  },
  {
    label: 'Laporan',
    icon: FileText,
    href: (w) => `/weekly/${w}/summary`,
    match: (p) => WEEKLY_REPORT.some((k) => p.endsWith(`/${k}`)),
    warm: (w) => WEEKLY_REPORT.map((k) => `/weekly/${w}/${k}`),
  },
  {
    label: 'Dokumen',
    icon: Files,
    href: () => '/dokumen',
    match: (p) => p.startsWith('/dokumen'),
  },
  {
    label: 'Klaim',
    icon: Scale,
    href: () => '/klaim',
    match: (p) => p.startsWith('/klaim'),
  },
];

const SETTINGS: Destination = {
  label: 'Pengaturan',
  icon: Settings,
  // Setup and Portfolio live as tabs inside Pengaturan — a project is configured
  // a handful of times, and until now they cost two permanent menu slots.
  href: () => '/settings',
  match: (p) => p.startsWith('/settings') || p.startsWith('/setup') || p.startsWith('/portfolio'),
};

const itemClass = (active: boolean) =>
  cn(
    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
    'transition-all duration-300 ease-ios active:scale-[0.97]',
    active
      ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
  );

function NavItem({ dest, week, pathname }: { dest: Destination; week: number; pathname: string | null }) {
  const Icon = dest.icon;
  const active = pathname ? dest.match(pathname) : false;
  return (
    <Link href={dest.href(week)} className={itemClass(active)}>
      <Icon className="h-[18px] w-[18px] transition-transform duration-300 ease-spring group-hover:scale-110" />
      <span>{dest.label}</span>
    </Link>
  );
}

function NavList({ pathname, currentWeek }: { pathname: string | null; currentWeek: number }) {
  const router = useRouter();

  // Keep links on the week being viewed; fall back to the reporting week.
  const week = Number(pathname?.match(/^\/weekly\/(\d+)/)?.[1] ?? currentWeek);

  // After every navigation, warm this sidebar's own targets during idle time.
  // It is what keeps daily ↔ weekly jumps instant even right after a mutation
  // cleared the prefetch cache (router.prefetch dedupes anything already warm).
  useEffect(() => {
    const warm = () => {
      for (const dest of DESTINATIONS) {
        for (const href of dest.warm?.(week) ?? [dest.href(week)]) router.prefetch(href);
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [pathname, week, router]);

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-6">
      <div className="space-y-1">
        {DESTINATIONS.map((dest) => (
          <NavItem key={dest.label} dest={dest} week={week} pathname={pathname} />
        ))}
      </div>

      <div className="mt-auto border-t border-gray-100 pt-3">
        <NavItem dest={SETTINGS} week={week} pathname={pathname} />
      </div>
    </nav>
  );
}

function ActiveNavList({ currentWeek }: { currentWeek: number }) {
  return <NavList pathname={usePathname()} currentWeek={currentWeek} />;
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/figtries-logo (1).png"
        alt="Figtries"
        width={compact ? 28 : 32}
        height={compact ? 28 : 32}
        className={compact ? 'h-7 w-7 object-contain' : 'h-8 w-8 object-contain'}
      />
      <div>
        <h1 className={cn('font-semibold text-gray-900', compact ? 'text-sm' : 'text-base')}>Figtries</h1>
        <p className={cn('text-gray-500', compact ? 'text-[10px]' : 'text-xs')}>Progress Report</p>
      </div>
    </div>
  );
}

function MobileDrawer({ currentWeek, projects }: { currentWeek: number; projects: ProjectSummary[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // print:hidden on BOTH: these are portalled to <body>, so the toolbar's own
  // print:hidden does not reach them. Parked off-screen with a transform, the
  // closed drawer still printed — its shadow bled onto the top-left of every
  // printed page.
  const overlay = mounted
    ? createPortal(
        <>
          <div
            className={cn(
              'fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-300 print:hidden',
              open ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            onClick={() => setOpen(false)}
          />

          <div
            className={cn(
              'fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-2xl transition-transform duration-300 print:hidden',
              'ease-[cubic-bezier(0.32,0.72,0,1)]',
              open ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <div className="flex h-full flex-col">
              <div className="flex h-14 items-center justify-between border-b border-gray-100 px-4">
                <Brand compact />
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Tutup menu"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {projects.length > 0 && (
                <div className="mb-3">
                  <ProjectSwitcher projects={projects} />
                </div>
              )}
              <NavList pathname={pathname} currentWeek={currentWeek} />
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Buka menu"
        className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95"
      >
        <Menu className="h-5 w-5" />
      </button>
      {overlay}
    </>
  );
}

export default function Sidebar({
  currentWeek,
  projects,
}: {
  currentWeek: number;
  projects: ProjectSummary[];
}) {
  return (
    <>
      {/* Mobile / tablet: slim top bar with hamburger */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:hidden print:hidden">
        <Suspense>
          <MobileDrawer currentWeek={currentWeek} projects={projects} />
        </Suspense>
        <span className="text-sm font-semibold text-gray-900">Progress Report</span>
      </header>

      {/* Desktop: full sidebar */}
      <aside className="hidden h-screen w-56 flex-shrink-0 border-r border-gray-200 bg-white lg:block print:hidden">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center border-b border-gray-100 px-5">
            <Brand />
          </div>

          {projects.length > 0 && (
            <div className="px-4 pt-3">
              <ProjectSwitcher projects={projects} />
            </div>
          )}

          <Suspense fallback={<NavList pathname={null} currentWeek={currentWeek} />}>
            <ActiveNavList currentWeek={currentWeek} />
          </Suspense>
        </div>
      </aside>
    </>
  );
}
