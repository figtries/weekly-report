'use client';

import { usePathname } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PressLink, pressMotion } from '@/components/motion/Press';
import { SlideTab } from '@/components/motion/SlideTab';
import { cn } from '@/lib/utils';

export interface SectionTab {
  href: string;
  label: string;
}

/**
 * The tab row that replaced two-thirds of the sidebar.
 *
 * Built on shadcn's `Tabs`, but every trigger is still a real `<Link>` through
 * `asChild`: each of these is a ROUTE, and a report sheet has to stay
 * shareable, middle-clickable and reachable by URL. Radix supplies the roving
 * tab order, the arrow keys and the aria wiring; Next supplies the navigation.
 *
 * `activationMode="manual"` matters here and nowhere else in the app. Radix
 * defaults to activating a tab on FOCUS, which on a row of links means arrowing
 * across the row would fire four navigations.
 *
 * One Tabs root per screen is the whole budget — see AGENTS.md. This row must
 * never be rendered inside a `.map()` over WBS rows.
 *
 * Scrolls sideways inside itself on narrow screens so the page body never does.
 */
export default function SectionTabs({
  tabs,
  className,
  pillId = 'section-tab',
}: {
  tabs: SectionTab[];
  className?: string;
  /**
   * The `layoutId` its sliding pill travels on. Defaults to the only value the
   * app currently needs; it exists so that two SectionTabs rows on one screen
   * could never drag each other's pill across the page.
   */
  pillId?: string;
}) {
  const pathname = usePathname();
  const activeHref =
    tabs.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? '';

  return (
    <Tabs
      value={activeHref}
      activationMode="manual"
      className={cn(
        // The row arrives with the section it belongs to. It only plays when
        // this actually mounts, and the section layouts keep it mounted across
        // sub-tab navigation on purpose — so it fires on the way INTO a
        // section and stays still once you are moving around inside it.
        'animate-enter overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden',
        className
      )}
    >
      {/* h-auto overrides the list's own h-8: these are the section's primary
          navigation and the triggers below carry the 44px touch target. */}
      <TabsList className="group-data-horizontal/tabs:h-auto p-1">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.href}
            value={t.href}
            asChild
            // `relative` gives the pill something to be absolute inside.
            // The two `data-[state=active]` resets turn OFF shadcn's own static
            // active background, because the sliding pill is now drawing it —
            // leave them out and the screen shows two pills, the old one
            // blinking and the new one arriving.
            className="relative h-auto min-h-11 whitespace-nowrap rounded-lg px-3.5 transition-colors duration-300 ease-ios data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <PressLink
              href={t.href}
              aria-current={activeHref === t.href ? 'page' : undefined}
              {...pressMotion}
            >
              {activeHref === t.href && <SlideTab id={pillId} />}
              <span className="relative">{t.label}</span>
            </PressLink>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Setup and Portfolio used to own permanent sidebar slots; they live here now. */
export const PROJECT_TABS: SectionTab[] = [
  { href: '/settings', label: 'Katalog' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/setup', label: 'Setup' },
];
