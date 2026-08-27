'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';

import { DURATION, EASE } from '@/components/motion/Reveal';
import { cn } from '@/lib/utils';

/**
 * The five screens of Document Control.
 *
 * They are routes rather than tab state, so a controller can bookmark the one
 * they live in and a reload lands where they were. The moving underline is one
 * `layoutId` — framer-motion's shared-element transition — which is why it
 * slides between tabs instead of blinking.
 *
 * The bar scrolls sideways on a phone. Five labels do not fit in 390px and
 * shortening them to fit would cost the one thing a tab has to do.
 */
const TABS = [
  { href: '/dokumen', label: 'Ringkasan EDL' },
  { href: '/dokumen/data', label: 'Data EDL' },
  { href: '/dokumen/vdrl', label: 'Ringkasan VDRL' },
  { href: '/dokumen/vdrl/data', label: 'Data VDRL' },
  { href: '/dokumen/log', label: 'Log' },
] as const;

export function RegisterTabs() {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  // Longest match wins: `/dokumen/vdrl/data` must not light up `/dokumen/vdrl`.
  const active = TABS.reduce((best, tab) =>
    pathname === tab.href || pathname.startsWith(`${tab.href}/`)
      ? (tab.href.length > best.length ? tab.href : best)
      : best, '');

  return (
    <nav
      aria-label="Document Control"
      className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex min-w-max items-stretch gap-1 border-b">
        {TABS.map((tab) => {
          const isActive = active === tab.href;
          return (
            <li key={tab.href} className="relative">
              <Link
                href={tab.href}
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
  );
}
