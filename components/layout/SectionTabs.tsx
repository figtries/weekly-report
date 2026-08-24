'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface SectionTab {
  href: string;
  label: string;
}

/**
 * The tab row that replaced two-thirds of the sidebar.
 *
 * Deliberately native links rather than a Radix Tabs: every one of these is a
 * route, and a report sheet has to stay shareable by URL. It also keeps the row
 * free of a Radix context on pages that already render hundreds of rows.
 *
 * Scrolls sideways inside itself on narrow screens so the page body never does.
 */
export default function SectionTabs({ tabs, className }: { tabs: SectionTab[]; className?: string }) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden',
        className
      )}
    >
      <div className="inline-flex gap-1 rounded-xl bg-gray-100 p-1">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium',
                'transition-all duration-300 ease-ios active:scale-[0.97]',
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Setup and Portfolio used to own permanent sidebar slots; they live here now. */
export const PROJECT_TABS: SectionTab[] = [
  { href: '/settings', label: 'Katalog' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/setup', label: 'Setup' },
];
