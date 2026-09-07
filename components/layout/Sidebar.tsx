'use client';

import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { m } from 'framer-motion';

import { PressLink, pressMotion } from '@/components/motion/Press';
import {
  Activity,
  CalendarDays,
  FileText,
  Files,
  LayoutDashboard,
  Menu,
  FolderKanban,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import ProjectSwitcher from '@/components/portfolio/ProjectSwitcher';
import { cn } from '@/lib/utils';
import type { ProjectCard } from '@/lib/projects';

/**
 * Six destinations, not twelve.
 *
 * The old list mirrored the Excel workbook: four of its entries were report
 * SHEETS, which are output, not places to go. They belong to one Reports
 * destination with tabs, exactly as they appear in the PDF. Everything used to
 * put numbers in sits under Progress; everything used once a project starts
 * sits under Settings, at the bottom, where it stops competing for attention
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
}

const WEEKLY_PROGRESS = ['overall', 'control'];
const WEEKLY_REPORT = ['summary', 'detail', 'scurve', 'documentation', 'print'];

const DESTINATIONS: Destination[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: () => '/',
    match: (p) => p === '/',
  },
  {
    label: 'Weekly Progress',
    icon: Activity,
    href: (w) => `/weekly/${w}/overall`,
    match: (p) => WEEKLY_PROGRESS.some((k) => p.startsWith('/weekly/') && p.endsWith(`/${k}`)),
  },
  {
    label: 'Daily',
    icon: CalendarDays,
    href: () => '/daily',
    match: (p) => p.startsWith('/daily'),
  },
  {
    label: 'Reports',
    icon: FileText,
    href: (w) => `/weekly/${w}/summary`,
    // `/weekly/` is load-bearing, not decoration: Document Control's tabs are
    // named `summary` and `detail` too, so a bare endsWith lit Reports as well
    // on every /dokumen page — two destinations highlighted at once.
    match: (p) => WEEKLY_REPORT.some((k) => p.startsWith('/weekly/') && p.endsWith(`/${k}`)),
  },
  {
    label: 'Document Control',
    icon: Files,
    href: (w) => `/dokumen/${w}/summary`,
    match: (p) => p.startsWith('/dokumen'),
  },
  {
    // Where a project is kept, created and planned. It is the app's first
    // screen: everything below reads whichever project is open here.
    label: 'Projects',
    icon: FolderKanban,
    href: () => '/projects',
    match: (p) => p.startsWith('/projects') || p.startsWith('/portfolio'),
  },
];

const SETTINGS: Destination = {
  label: 'Settings',
  icon: Settings,
  // Setup and Portfolio live as tabs inside Settings — a project is configured
  // a handful of times, and until now they cost two permanent menu slots.
  href: () => '/settings',
  match: (p) => p.startsWith('/settings'),
};

const itemClass = (active: boolean) =>
  cn(
    // min-h-11: this is the app's primary navigation and has to clear the
    // 44px touch target, which px-3 py-2 alone left at 36.
    'group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
    // `transition-colors`, not `transition-all`: the press is framer-motion's
    // now, and leaving a CSS transition on `transform` here would fight it —
    // two writers on one property is a press that stutters halfway down. The
    // colour change stays CSS, where it costs nothing.
    'transition-colors duration-300 ease-ios',
    active
      ? 'bg-chart-1/10 text-chart-1 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  );

function NavItem({ dest, week, pathname }: { dest: Destination; week: number; pathname: string | null }) {
  const Icon = dest.icon;
  const active = pathname ? dest.match(pathname) : false;
  return (
    <PressLink href={dest.href(week)} className={itemClass(active)} {...pressMotion}>
      <Icon className="h-[18px] w-[18px] transition-transform duration-300 ease-spring group-hover:scale-110" />
      <span>{dest.label}</span>
    </PressLink>
  );
}

function NavList({ pathname, currentWeek }: { pathname: string | null; currentWeek: number }) {
  // Keep links on the week being viewed; fall back to the reporting week.
  const week = Number(pathname?.match(/^\/weekly\/(\d+)/)?.[1] ?? currentWeek);

  /*
   * THE SIDEBAR NO LONGER WARMS ANYTHING, and the reason is a measurement.
   *
   * It used to hold a `warm` list per destination — every weekly tab, both
   * document tabs — and prefetch the lot on an idle callback after EVERY
   * navigation, with a note claiming `router.prefetch` deduped what was already
   * warm. It does not. Sitting on three screens in turn and touching nothing:
   *
   *     land on /projects    59 RSC requests for 16 distinct URLs
   *     then /daily          87 for 23
   *     back to /projects   106 for 16
   *
   * 252 requests for a session with no clicks in it. `/settings`, which has no
   * project list and no tab bar at all, still spent 47 requests on 13 URLs —
   * seven of them weekly tabs belonging to a tab bar that was not on screen.
   *
   * The multiplier is not duplication anyone wrote. Under `cacheComponents` ONE
   * `router.prefetch` is about three network requests, because the route is
   * fetched as segments. So the only lever that matters is HOW MANY ROUTES get
   * warmed at all — and the answer here is none of them, because every one was
   * already covered:
   *
   *   - each sidebar destination is a `<Link>` in this very list, on screen,
   *     which Next prefetches by itself;
   *   - each sibling tab is a `<Link>` in `SectionTabs`, on the page where that
   *     tab bar actually appears — plus `WeekTabs` prefetches its own siblings
   *     explicitly.
   *
   * Warming them from here was buying a second copy of work the page in front
   * of the user had already done, on every screen in the app. On a desk that is
   * invisible; on a phone it is the connection busy at the moment somebody taps.
   */

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-6">
      <div className="space-y-1">
        {DESTINATIONS.map((dest) => (
          <NavItem key={dest.label} dest={dest} week={week} pathname={pathname} />
        ))}
      </div>

      <div className="mt-auto border-t pt-3">
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
        <h1 className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-base')}>Figtries</h1>
        <p className={cn('text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>Progress Report</p>
      </div>
    </div>
  );
}

function MobileDrawer({ currentWeek, projects }: { currentWeek: number; projects: ProjectCard[] }) {
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
              'fixed inset-y-0 left-0 z-50 w-64 bg-card shadow-2xl transition-transform duration-300 print:hidden',
              'ease-[cubic-bezier(0.32,0.72,0,1)]',
              open ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <div className="flex h-full flex-col">
              <div className="flex h-14 items-center justify-between border-b px-4">
                <Brand compact />
                <m.button
                  {...pressMotion}
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </m.button>
              </div>

              {projects.length > 0 && (
                <div className="px-4 pt-3">
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
      {/* The hamburger is the app's proof that the provider reaches outside
          <main>: it lives in the sidebar, which is a sibling of it. If this
          stops pressing, MotionRoot's boundary has moved. `active:scale-95`
          came off here — 0.95 was a third value for the same gesture, and the
          token is 0.97. */}
      <m.button
        {...pressMotion}
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </m.button>
      {overlay}
    </>
  );
}

export default function Sidebar({
  currentWeek,
  projects,
}: {
  currentWeek: number;
  projects: ProjectCard[];
}) {
  return (
    <>
      {/* Mobile / tablet: slim top bar with hamburger */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:hidden print:hidden">
        <Suspense>
          <MobileDrawer currentWeek={currentWeek} projects={projects} />
        </Suspense>
        <span className="text-sm font-semibold text-foreground">Progress Report</span>
      </header>

      {/* Desktop: full sidebar */}
      <aside className="hidden h-screen w-56 flex-shrink-0 border-r bg-card lg:block print:hidden">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center border-b px-5">
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
