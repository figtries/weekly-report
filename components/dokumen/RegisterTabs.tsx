'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';

import WeekSelect from '@/components/weekly/WeekSelect';
import { DURATION, EASE } from '@/components/motion/Reveal';
import { cn } from '@/lib/utils';

/**
 * The five screens of Document Control, and the week they are read as of.
 *
 * They are routes rather than tab state, so a controller can bookmark the one
 * they live in and a reload lands where they were. The moving underline is one
 * `layoutId` — framer-motion's shared-element transition — which is why it
 * slides between tabs instead of blinking.
 *
 * The week picker is the weekly report's own control, pointed at these routes:
 * one place to learn, one behaviour to maintain, and the two screens stay in
 * step when someone moves between them.
 *
 * The bar scrolls sideways on a phone. Five labels do not fit in 390px and
 * shortening them to fit would cost the one thing a tab has to do.
 */
const TABS = [
  { key: 'summary', label: 'EDL Summary' },
  { key: 'data', label: 'EDL Data' },
  { key: 'vdrl', label: 'VDRL Summary' },
  { key: 'vdrl-data', label: 'VDRL Data' },
  { key: 'log', label: 'Log' },
] as const;

export function RegisterTabs({
  weeks,
  selectedWeek,
  projectCurrentWeek,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
}) {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  const active = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'summary';

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <WeekSelect
          weeks={weeks}
          selectedWeek={selectedWeek}
          projectCurrentWeek={projectCurrentWeek}
          activeTab={active}
          basePath="/dokumen"
        />
        {selectedWeek === projectCurrentWeek && (
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Current week
          </span>
        )}
      </div>

      <nav
        aria-label="Document Control"
        className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex min-w-max items-stretch gap-1 border-b">
          {TABS.map((tab) => {
            const isActive = active === tab.key;
            return (
              <li key={tab.key} className="relative">
                <Link
                  href={`/dokumen/${selectedWeek}/${tab.key}`}
                  aria-current={isActive ? 'page' : undefined}
                  // 44px minimum: this is tapped standing up, on site.
                  className={cn(
                    'flex min-h-11 items-center whitespace-nowrap rounded-t-lg px-3 text-sm font-medium transition-colors duration-300 ease-ios',
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </Link>
                {isActive && (
                  reduced ? (
                    <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground" />
                  ) : (
                    <motion.span
                      layoutId="dokumen-tab"
                      className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground"
                      transition={{ duration: DURATION, ease: EASE }}
                    />
                  )
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
