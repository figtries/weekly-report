'use client';

import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  href: (week: number | null) => string;
  match: (pathname: string) => boolean;
}

const DATA_OVERALL = ['overall', 'control'];
const WEEKLY_PROGRESS = ['summary', 'detail', 'scurve', 'documentation', 'print'];

const DESTINATIONS: Destination[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: () => '/',
    match: (p) => p === '/',
  },
  {
    label: 'Data Overall',
    icon: Activity,
    href: (w) => (w ? `/weekly/${w}/overall` : '/weekly'),
    match: (p) => DATA_OVERALL.some((k) => p.startsWith('/weekly/') && p.endsWith(`/${k}`)),
  },
  {
    label: 'Daily',
    icon: CalendarDays,
    href: () => '/daily',
    match: (p) => p.startsWith('/daily'),
  },
  {
    label: 'Weekly Progress',
    icon: FileText,
    href: (w) => (w ? `/weekly/${w}/summary` : '/weekly/summary'),
    // `/weekly/` is load-bearing, not decoration: Document Control's tabs are
    // named `summary` and `detail` too, so a bare endsWith lit this entry as well
    // on every /dokumen page — two destinations highlighted at once.
    match: (p) => WEEKLY_PROGRESS.some((k) => p.startsWith('/weekly/') && p.endsWith(`/${k}`)),
  },
  {
    label: 'Document Control',
    icon: Files,
    href: (w) => (w ? `/dokumen/${w}/summary` : '/dokumen'),
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

function NavItem({ dest, week, pathname }: { dest: Destination; week: number | null; pathname: string | null }) {
  const Icon = dest.icon;
  const active = pathname ? dest.match(pathname) : false;
  return (
    <PressLink href={dest.href(week)} className={itemClass(active)} {...pressMotion}>
      <Icon className="h-[18px] w-[18px] transition-transform duration-300 ease-spring group-hover:scale-110" />
      <span>{dest.label}</span>
    </PressLink>
  );
}

function Links({ dests, pathname }: { dests: Destination[]; pathname: string | null }) {
  /*
   * Keep links on the week being viewed; when the path holds no week, send
   * them to the INDEX route rather than guess a number.
   *
   * THE NUMBER USED TO BE GUESSED, and it was guessed from the wrong store.
   * `app/layout.tsx` read `getDb()`, which is db.json and holds exactly ONE
   * project, so every week-scoped entry in this menu was stamped with Gundih's
   * week 36. Open any other project and the whole menu pointed outside it: a
   * 22-week project tapping Data Overall landed on `/weekly/36/overall`, a week
   * it does not have, and got a 404 with nothing on screen able to move it
   * (17 Sep 2026). Weekly Progress and Document Control carried the same 36.
   * The index routes were fixed for exactly this in 766b3ae; the sidebar never
   * went through them, so that fix could not reach it.
   *
   * The layout cannot resolve it either: the open project is a cookie, and an
   * uncached read there blocks every route and fails the build. So the menu
   * stops carrying a week at all and lets `/weekly`, `/weekly/summary` and
   * `/dokumen` answer it, each reading the OPEN project behind `<Suspense>`.
   *
   * `/dokumen/` is in the pattern deliberately. It is per-week for the same
   * project, and leaving it out meant a Document Control page tapping Data
   * Overall fell through to the same wrong number.
   */
  const inPath = pathname?.match(/^\/(?:weekly|dokumen)\/(\d+)/)?.[1];
  const week = inPath ? Number(inPath) : null;

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
    <>
      {dests.map((dest) => (
        <NavItem key={dest.label} dest={dest} week={week} pathname={pathname} />
      ))}
    </>
  );
}

/**
 * The menu's frame. The links arrive as SLOTS rather than being drawn here,
 * because on the desktop they swap from an unlit list to a lit one after
 * hydration (see `ActiveLinks`) — and the project card must not swap with
 * them. A card inside the swapping subtree is remounted on every page load:
 * its streamed content is thrown away and redrawn a frame later.
 *
 * The card sits at the FOOT, above Settings (25 Sep 2026): on a phone that is
 * under the thumb, and it leaves the destinations as the first thing under the
 * name. The rule above it runs edge to edge (-mx-3), which is what separates
 * "where to go" from "what you are looking at".
 */
function NavList({ links, settings, card }: { links: ReactNode; settings: ReactNode; card: ReactNode }) {
  return (
    <nav className="flex flex-1 flex-col px-3 pb-3 pt-2">
      <div className="space-y-1">{links}</div>

      <div className="-mx-3 mt-auto border-t px-3 pt-3">
        {card}
        <div className="mt-2">{settings}</div>
      </div>
    </nav>
  );
}

/**
 * WHICH LINK IS THE CURRENT ONE — and why this is not behind `<Suspense>`.
 *
 * `usePathname()` is request data, so under `cacheComponents` calling it during
 * a prerender postpones, and this used to sit inside a `<Suspense>` with an
 * unhighlighted `NavList` as the fallback. That boundary cost the app a
 * whole-shell re-render on five routes, and the mechanism is worth writing
 * down because nothing about it is guessable:
 *
 * React numbers its streamed Suspense boundaries `S:0…S:n`. Next numbers the
 * PPR resume segments it splices into a prerendered shell `S:3…S:n` — the SAME
 * namespace, always starting at 3 (measured on 13 Sep 2026 across every route:
 * remove one boundary and the resume segments still start at 3). The shell had
 * exactly four boundaries, so React's last one was `S:3` and the two collided.
 *
 * They collide because the splices are not simultaneous. `$RC` resolves both
 * elements and QUEUES the reveal, flushing up to ~300ms later to batch it; in
 * that window React's `<div hidden id="S:3">` is still in the document, so
 * Next's `$RS("S:3","P:3")` — which resolves by id, at call time — took the
 * SIDEBAR and spliced it into a summary card. React then found a DOM it had
 * not produced, threw #418, and regenerated `.section-shell`: week picker,
 * stepper and tab row rebuilt on every load of
 * `/weekly/[w]/summary`, `/weekly/[w]/control`, `/weekly/[w]/overall`,
 * `/dokumen/[w]/summary` and `/dokumen/[w]/vdrl`. Measured cost, 390px at 4x
 * CPU: 308ms to first contentful paint against 156ms on a page without it.
 *
 * This is a Next bug, and the only lever the app has is to own fewer streamed
 * boundaries than three. So the pathname is read AFTER mount instead: nothing
 * postpones, no boundary is emitted, the nav ships complete in the shell, and
 * the active link lights up on hydration. Client-side navigation still updates
 * it, because `LiveLinks` keeps the real hook.
 *
 * `scripts/verify-hydration.mjs` fails the moment a fourth boundary comes back.
 */
function ActiveLinks({ dests }: { dests: Destination[] }) {
  // `useSyncExternalStore` rather than a mounted flag in an effect: it takes a
  // server snapshot and a client one directly, so there is no setState during
  // an effect and no extra render pass to get there.
  const live = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  return live ? (
    <LiveLinks dests={dests} />
  ) : (
    <Links dests={dests} pathname={null} />
  );
}

/** Mounted only after hydration, which is what keeps `usePathname()` off the prerender. */
function LiveLinks({ dests }: { dests: Destination[] }) {
  return <Links dests={dests} pathname={usePathname()} />;
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      {/* The mark is taller than it is wide (307x512), so it is sized by
          HEIGHT and left to find its own width. Squared off it would have had
          to shrink to fit, and at 32px it read as a speck beside the word.
          THE ROW IS ALIGNED TO THE MENU BELOW IT, not centred by eye: its
          wrapper carries px-6 because a nav icon sits at 24px (nav px-3 + item
          px-3), and the gap is picked so the word lands on the nav LABELS at
          54px — 36px tall is 21.6px wide, + gap-2 = 53.6. Change the height or
          the gap and the word steps out of the column; re-do that sum. */}
      <Image src="/lucille-mark.png" alt="" width={22} height={36} className="h-9 w-auto" />
      <h1 className="text-lg font-semibold tracking-tight text-foreground">Lucille</h1>
    </div>
  );
}

function MobileDrawer({ switcher }: { switcher: ReactNode }) {
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
              'fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-300 lg:hidden print:hidden',
              open ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            onClick={() => setOpen(false)}
          />

          {/* From the RIGHT, the side its button is on (25 Sep 2026). What
              opens is the desktop sidebar itself — same name row, same menu,
              same project card at the foot — so a phone and a laptop teach one
              layout, not two.
              The shadow is worn ONLY while open: parked off-screen, a 50px
              blur still reached back into the viewport and drew a grey smear
              down the edge of every page, desktop included — the portal lands
              in <body> whatever the header's `lg:hidden` says, which is why
              both layers carry their own. */}
          <div
            className={cn(
              'fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] bg-card transition-[translate,box-shadow] duration-300 lg:hidden print:hidden',
              'ease-[cubic-bezier(0.32,0.72,0,1)]',
              open ? 'translate-x-0 shadow-2xl' : 'translate-x-full shadow-none'
            )}
          >
            <div className="flex h-full flex-col overflow-y-auto">
              {/* No close button: tapping the dimmed backdrop closes the
                  drawer, and so does following any link in it. */}
              <div className="flex h-16 shrink-0 items-center px-6">
                <Brand />
              </div>

              <NavList
                links={<Links dests={DESTINATIONS} pathname={pathname} />}
                settings={<Links dests={[SETTINGS]} pathname={pathname} />}
                card={switcher}
              />
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
        className="ml-auto flex size-12 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Menu className="size-6" />
      </m.button>
      {overlay}
    </>
  );
}

export default function Sidebar({
  switcher,
}: {
  /**
   * The open project's card, handed down as a NODE rather than as data. It is a
   * server component that reads at request time (see LiveProjectSwitcher), and
   * a server component cannot be imported into a client one — which this is.
   */
  switcher: ReactNode;
}) {
  return (
    <>
      {/* Mobile / tablet: the name on the left, the menu on the right, on a
          SOLID white bar with a rule under it — the bar is what separates the
          app's chrome from the page scrolling beneath it (25 Sep 2026). It no
          longer carries the open project's initial: that lives on the card at
          the foot of the menu. */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2.5 border-b bg-card pl-4 pr-2 lg:hidden print:hidden">
        {/* The mark and the name, not <Brand>: the desktop sidebar already
            renders that <h1>, and both halves sit in the DOM at once. They stay
            OUTSIDE the boundary below, in the static shell, so the bar is never
            briefly empty. */}
        <Image src="/lucille-mark.png" alt="" width={17} height={28} className="h-7 w-auto" />
        <span className="text-base font-semibold tracking-tight text-foreground">Lucille</span>
        {/* The drawer reads the pathname, which is request data and cannot
            prerender. ONE boundary: the shell may not own a third streamed one,
            which is where the PPR resume segments start colliding with
            React's. */}
        <Suspense>
          <MobileDrawer switcher={switcher} />
        </Suspense>
      </header>

      {/* Desktop: full sidebar. 256px (w-64), up from 224px, so the project
          card at its foot can print a contract title whole in a few lines. */}
      <aside className="hidden h-screen w-64 flex-shrink-0 border-r bg-card lg:block print:hidden">
        <div className="flex h-full flex-col overflow-y-auto">
          <div className="flex h-16 shrink-0 items-center px-6">
            <Brand />
          </div>

          <NavList
            links={<ActiveLinks dests={DESTINATIONS} />}
            settings={<ActiveLinks dests={[SETTINGS]} />}
            card={switcher}
          />
        </div>
      </aside>
    </>
  );
}
