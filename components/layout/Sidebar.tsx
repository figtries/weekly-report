'use client';

import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';

const weeklyIcon = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7 12l3-3 3 3 4-4M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
    />
  </svg>
);

const dailyIcon = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

const weeklyPages = [
  {
    key: 'overall',
    label: 'Data Overall',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 10h18M9 10v10M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"
        />
      </svg>
    ),
  },
  {
    key: 'summary',
    label: 'Overall Summary',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055zM20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
        />
      </svg>
    ),
  },
  {
    key: 'detail',
    label: 'Detail Progress',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
  },
  {
    key: 'scurve',
    label: 'S-Curve',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
        />
      </svg>
    ),
  },
  {
    key: 'documentation',
    label: 'Documentation',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

function NavList({ pathname, currentWeek }: { pathname: string | null; currentWeek: number }) {
  const router = useRouter();
  const onWeekly = pathname?.startsWith('/weekly') ?? false;
  const onDaily = pathname?.startsWith('/daily') ?? false;
  // Manual toggle wins until the next navigation, then the route decides again.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setManualOpen(null);
  }, [pathname]);
  const open = manualOpen ?? onWeekly;

  // Keep sub-links on the week being viewed; fall back to the reporting week.
  const week = Number(pathname?.match(/^\/weekly\/(\d+)/)?.[1] ?? currentWeek);

  // After every navigation, warm the sidebar's own targets during idle time:
  // the five weekly tabs of the viewed week plus the daily list. This is what
  // keeps daily ↔ weekly jumps instant, even right after a mutation cleared
  // the prefetch cache (router.prefetch dedupes anything already warm).
  useEffect(() => {
    const warm = () => {
      for (const page of weeklyPages) router.prefetch(`/weekly/${week}/${page.key}`);
      router.prefetch('/daily');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [pathname, week, router]);

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-6 space-y-1">
      <button
        onClick={() => setManualOpen(!open)}
        className={`group flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ease-ios active:scale-[0.97] ${
          onWeekly
            ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        <span className="transition-transform duration-300 ease-spring group-hover:scale-110">
          {weeklyIcon}
        </span>
        <span className="flex-1 text-left">Weekly Report</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-300 ease-ios ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="animate-fade-in pb-2">
          <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-400">
            Report Pages
          </p>
          <div className="space-y-0.5">
            {weeklyPages.map((page) => {
              const isActive = onWeekly && (pathname?.endsWith(`/${page.key}`) ?? false);
              return (
                <Link
                  key={page.key}
                  href={`/weekly/${week}/${page.key}`}
                  className={`group flex items-center gap-3 rounded-lg py-2 pl-6 pr-3 text-sm font-medium transition-all duration-300 ease-ios active:scale-[0.97] ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className="transition-transform duration-300 ease-spring group-hover:scale-110">
                    {page.icon}
                  </span>
                  <span>{page.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <Link
        href="/daily"
        className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ease-ios active:scale-[0.97] ${
          onDaily
            ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        <span className="transition-transform duration-300 ease-spring group-hover:scale-110">
          {dailyIcon}
        </span>
        <span>Daily Report</span>
      </Link>
    </nav>
  );
}

function ActiveNavList({ currentWeek }: { currentWeek: number }) {
  return <NavList pathname={usePathname()} currentWeek={currentWeek} />;
}

function MobileDrawer({ currentWeek }: { currentWeek: number }) {
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
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-300 print:hidden ${
              open ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div
            className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] print:hidden ${
              open ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex flex-col h-full">
              <div className="h-14 flex items-center justify-between px-4 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <Image
                    src="/figtries-logo (1).png"
                    alt="Figtries"
                    width={28}
                    height={28}
                    className="h-7 w-7 object-contain"
                  />
                  <div>
                    <h1 className="text-sm font-semibold text-gray-900">Figtries</h1>
                    <p className="text-[10px] text-gray-500">Progress Report</p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

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
        aria-label="Open menu"
        className="-ml-2 flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors active:scale-95"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {overlay}
    </>
  );
}

export default function Sidebar({ currentWeek }: { currentWeek: number }) {
  return (
    <>
      {/* Mobile / tablet: slim top bar with hamburger */}
      <header className="lg:hidden print:hidden sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white/95 px-4 backdrop-blur">
        <Suspense>
          <MobileDrawer currentWeek={currentWeek} />
        </Suspense>
        <span className="text-sm font-semibold text-gray-900">Progress Report</span>
      </header>

      {/* Desktop: full sidebar */}
      <aside className="hidden lg:block w-56 h-screen bg-white border-r border-gray-200 print:hidden flex-shrink-0">
        <div className="flex flex-col h-full">
          <div className="h-16 flex items-center px-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <Image
                src="/figtries-logo (1).png"
                alt="Figtries"
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
              <div>
                <h1 className="text-base font-semibold text-gray-900">Figtries</h1>
                <p className="text-xs text-gray-500">Progress Report</p>
              </div>
            </div>
          </div>

          <Suspense fallback={<NavList pathname={null} currentWeek={currentWeek} />}>
            <ActiveNavList currentWeek={currentWeek} />
          </Suspense>
        </div>
      </aside>
    </>
  );
}
