# Motion Interaction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every interactive element in the app a smooth, soft, non-janky motion response driven by framer-motion, without touching any page-load entrance.

**Architecture:** One `LazyMotion` provider with `strict` wraps the whole body, forcing every animated element in the app through `m.*` and through the single curve/spring/duration in `MOTION`. Five small primitives in `components/motion/` cover the five interaction shapes the app actually has; the 26 client components consume those primitives instead of writing motion props by hand. Page-load entrances stay CSS keyframes, unchanged.

**Tech Stack:** Next.js (cacheComponents), React 19 `ViewTransition`, framer-motion 13.1.1, Tailwind v4, shadcn/Radix (`radix-nova`), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-08-30-motion-interaction-layer-design.md`

## Global Constraints

- **There is no test runner in this repo.** No vitest, jest, or playwright. Verification is: `npx tsc --noEmit`, `npx next build`, the puppeteer scripts in `scripts/`, and looking at screenshots. Do not add a test framework.
- **Never verify a build through a pipe.** `next build | grep` reports grep's exit code. Write to a file, then `echo $?`.
- **Every motion value comes from `MOTION` in `lib/design.ts`.** No literal duration, easing array, or spring config anywhere else in the app.
- **Page-load entrances stay CSS.** `Reveal`, `ScrollReveal`, `CountUp`, `RouteTransition`, `HeroGauge`, `PlanBar`, `SCurveClient` sweeps — never converted.
- **No motion instance inside a `.map()` that can exceed ~20 rows.** `WbsTreeTable` can render 285 leaves.
- **`/print/*` gets zero motion.** Puppeteer photographs without waiting.
- **The app is in English.** Sentence case, always a capital. Decimal point, `en-GB` dates.
- **framer-motion 13.1.1 exports** `LazyMotion`, `domMax`, `domAnimation`, `m`, `MotionConfig`, `LayoutGroup`, `AnimatePresence`, `useReducedMotion` — all verified present in `node_modules/framer-motion/dist/index.d.ts`.
- **`MOTION.ease` is a readonly tuple** (`as const`). framer-motion's `ease` wants a mutable 4-tuple. Spread it: `ease: [...MOTION.ease]`. A bare `MOTION.ease` fails typecheck; `[...MOTION.ease]` keeps the tuple arity and passes.
- **Animate `transform` and `opacity` only.** The single exception is `Expand`, which must touch `height` and is fenced to panels because of it.
- **Never hand-write `will-change`.** framer-motion adds and removes it around each animation. One pinned permanently holds a GPU layer for the life of the page, which on a cheap phone becomes the cause of jank rather than the cure.

---

## File Structure

**Created:**
- `components/motion/MotionRoot.tsx` — the `LazyMotion` + `MotionConfig` provider. No hooks.
- `components/motion/Press.tsx` — `pressMotion` props object + `Press` wrapper for clickable cards.
- `components/motion/Expand.tsx` — open/close with `height: auto`.
- `components/motion/Swap.tsx` — drill-down level in/out.
- `components/motion/SlideTab.tsx` — the active pill that slides via `layoutId`.

**Modified:**
- `lib/design.ts` — add `MOTION.spring`, amend rule 2.
- `app/layout.tsx` — mount `MotionRoot` inside `<body>`.
- `components/dokumen/LogScreen.tsx`, `components/dokumen/RegisterCurve.tsx`, `components/dokumen/RegisterWorkbench.tsx`, `components/settings/EngineeringSource.tsx` — `motion.*` → `m.*` (forced by `strict`).
- `components/layout/SectionTabs.tsx`, `components/weekly/WeekTabs.tsx` — `SlideTab`.
- `components/weekly/WbsTreeVisual.tsx:177`, `components/weekly/DataOverallWorkbench.tsx:1175` — `Swap`.
- `components/weekly/ApprovalPanel.tsx`, `components/settings/CatalogEditor.tsx`, `components/dokumen/DocumentEditor.tsx` — `Expand`.
- `components/daily/DailyReportsView.tsx`, `components/weekly/PhotoUploadGrid.tsx` — `layout` + `AnimatePresence`.
- Remaining clickable surfaces — `pressMotion`.
- `scripts/_motion-verify.mjs` — add the server-HTML guard and the interaction checks.

---

## Task 1: The spring token

**Files:**
- Modify: `lib/design.ts` (the `MOTION` object and the rule-2 comment above it)

**Interfaces:**
- Consumes: nothing.
- Produces: `MOTION.spring: { readonly type: "spring"; readonly stiffness: 300; readonly damping: 30; readonly mass: 0.9 }` — every later task imports this.

- [ ] **Step 1: Amend rule 2 in the file header**

Find the block that reads:

```
 * 2. ONE CURVE, ONE DURATION. `MOTION` below is the only place either is
 *    allowed to be written. `/print/*` gets no motion at all: Puppeteer
 *    photographs without waiting for an animation.
```

Replace with:

```
 * 2. ONE CURVE, ONE SPRING, ONE DURATION. `MOTION` below is the only place any
 *    of the three is allowed to be written. The curve is for what CHANGES
 *    APPEARANCE — a fade, a colour, a small scale. The spring is for what
 *    MOVES FROM ONE PLACE TO ANOTHER — a drill level sliding, the active tab
 *    pill travelling, a panel opening. Asking which of the two a thing is
 *    answers which of the two it gets, every time, without taste entering it.
 *    `/print/*` gets no motion at all: Puppeteer photographs without waiting
 *    for an animation.
```

- [ ] **Step 2: Add the token at the end of the `MOTION` object**

Insert after `routeIn: 0.36,`:

```ts
  /**
   * The one spring, for what MOVES rather than what merely changes.
   *
   * Damping ratio ζ = 30 / (2·√(300 × 0.9)) ≈ 0.91 — just under critical. It
   * lands with a single settle you can feel and cannot quite see. That is the
   * whole difference between "soft" and "toy": a bounce that reads AS a bounce
   * is charming on the first press and tiring by the end of the week, on a
   * screen someone opens forty times a day.
   *
   * IT IS NOT MIRRORED INTO globals.css, and that is not an oversight. CSS has
   * no spring, which is exactly why this one lives here and why the things it
   * drives are the things CSS could never have done. The curve and the
   * durations still have two sides that must be kept in step; this has one.
   *
   * `layout` and `layoutId` animations do NOT read the default transition from
   * `MotionConfig` — they carry their own. Anything using them must pass
   * `transition={MOTION.spring}` explicitly.
   */
  spring: { type: 'spring', stiffness: 300, damping: 30, mass: 0.9 },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?`
Expected: `0`. If non-zero, read `tsc.log`.

- [ ] **Step 4: Confirm the literal type survived `as const`**

Run: `npx tsc --noEmit` after temporarily adding to any file `const t: import('framer-motion').Transition = MOTION.spring;`
Expected: no error — `type` must be the literal `"spring"`, not widened to `string`. Remove the probe line afterwards.

- [ ] **Step 5: Commit**

```bash
git add lib/design.ts && git commit -m "Add the one spring, and say which of the two each thing gets"
```

---

## Task 2: The provider, and the four components `strict` breaks

This task is atomic on purpose. Turning on `strict` makes every existing `motion.*` throw, so the provider and the migration must land together or the app is broken between commits.

**Files:**
- Create: `components/motion/MotionRoot.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/dokumen/LogScreen.tsx:4,80,94,153`, `components/dokumen/RegisterCurve.tsx:3,103,148,152`, `components/dokumen/RegisterWorkbench.tsx:5,250,258`, `components/settings/EngineeringSource.tsx:4,189,205`

**Interfaces:**
- Consumes: `MOTION.spring`, `MOTION.duration`, `MOTION.ease` from Task 1.
- Produces: `MotionRoot({ children }: { children: ReactNode })` — a client component with no hooks. Every `m.*` in the app must be inside it.

- [ ] **Step 1: Write `components/motion/MotionRoot.tsx`**

```tsx
'use client';

import { LazyMotion, MotionConfig, domMax } from 'framer-motion';
import type { ReactNode } from 'react';

import { MOTION } from '@/lib/design';

/**
 * The one framer-motion provider, and the fence around it.
 *
 * IT WRAPS THE WHOLE BODY, NOT `<main>`. `Sidebar` and `StorageWarning` are
 * SIBLINGS of `<main>` in `app/layout.tsx`, not children of it. A provider
 * around `<main>` alone leaves the app's primary navigation outside, where
 * `m.*` renders with no features and simply sits still — and it does that
 * SILENTLY, with no error and no warning. The boundary has to be right the
 * first time because nothing will tell you it is wrong.
 *
 * `strict` IS THE POINT. It makes `motion.*` throw, so the only way to animate
 * anything is `m.*`, and the only way to reach a curve or a duration is
 * `MOTION`. Without it "one curve" dies quietly: in six months there are three
 * durations in the app and nobody knows which is correct. That is the exact
 * disease `lib/design.ts` was written to prevent, and a lint rule nobody runs
 * is not a cure.
 *
 * `domMax` and not `domAnimation`, at a cost of about 13kb. What it buys is
 * `layoutId` — the only thing in this whole layer that genuinely cannot be
 * built another way.
 *
 * `reducedMotion="user"` handles `prefers-reduced-motion` for all of
 * framer-motion in one place, so no component needs its own opinion. The
 * `@media (prefers-reduced-motion: reduce)` block in globals.css still covers
 * the CSS side.
 *
 * NO HOOKS, DELIBERATELY. The last client component to sit at this height read
 * `usePathname()` and killed the build on `/print/daily/[date]`: under
 * `cacheComponents` the pathname is uncached data, and reading it in the root
 * layout blocks every route in the app. `children` arrives already rendered
 * from the server and stays that way.
 *
 * The default transition below applies to PROPERTY animations only. `layout`
 * and `layoutId` carry their own and ignore it — see `MOTION.spring`.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig
        reducedMotion="user"
        // Spread, not `MOTION.ease` — the token is a readonly tuple and
        // framer-motion wants a mutable one. The spread keeps the arity.
        transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
```

- [ ] **Step 2: Mount it in `app/layout.tsx`**

Import it alongside the other layout imports:

```tsx
import { MotionRoot } from '@/components/motion/MotionRoot';
```

Then wrap everything inside `<body>`. The body currently opens with `<Sidebar .../>`; it must become:

```tsx
      <body className="h-full flex flex-col lg:flex-row bg-background font-sans print:block print:h-auto">
        <MotionRoot>
          <Sidebar currentWeek={currentWeek} projects={projects} />
          <div className="flex-1 min-h-0 flex flex-col print:block print:h-auto">
            <StorageWarning />
            <main className="flex-1 min-h-0 overflow-auto print:h-auto print:overflow-visible">
              {children}
            </main>
          </div>
        </MotionRoot>
      </body>
```

`MotionRoot` renders no DOM of its own, so the flex layout on `<body>` still applies to `Sidebar` and the `<div>` exactly as before. Keep the existing comments in that file.

- [ ] **Step 3: Migrate the four components to `m.*`**

In each of the four files, change the import and every `motion.` to `m.`:

`components/dokumen/LogScreen.tsx:4`, `components/dokumen/RegisterWorkbench.tsx:5`, `components/settings/EngineeringSource.tsx:4`:

```tsx
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
```

`components/dokumen/RegisterCurve.tsx:3`:

```tsx
import { m, useReducedMotion } from 'framer-motion';
```

Then rename the elements: `motion.span` → `m.span`, `motion.section` → `m.section`, `motion.div` → `m.div`, `motion.svg` → `m.svg`, and every matching closing tag.

`useReducedMotion` is a hook, not a component — `strict` does not touch it. **Leave every existing `reduced` branch exactly as it is.** `reducedMotion="user"` is additive, and stripping those branches is a separate cleanup with its own risk; this task changes imports and element names only.

**Do not change any value.** `RegisterCurve` in particular has a standing note about `pathLength` shredding a line that already has `strokeDasharray` — its numbers, curve and shape must come out byte-identical apart from the rename.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 5: Build**

Run: `npx next build > build.log 2>&1; echo $?`
Expected: `0`. Never pipe this. If non-zero, read `build.log`.

- [ ] **Step 6: Add the lint rule, because `strict` alone is not enough**

**Finding, 30 August 2026:** `strict` is development-only. The guard at `node_modules/framer-motion/dist/es/motion/index.mjs:89` is wrapped in `process.env.NODE_ENV !== "production"`. Building this app with a deliberate `motion.div` in place exits **0** — the build never catches it, and what slips through is not only the discipline but the whole library instead of the tree-shaken slice.

So add a static guard beside the runtime one, in `eslint.config.mjs`, before the `globalIgnores` call:

```js
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "framer-motion",
              importNames: ["motion"],
              message:
                "Import `m` instead of `motion`. The app mounts LazyMotion with `strict`; a `motion` component throws in dev and silently defeats tree shaking in production. See components/motion/MotionRoot.tsx.",
            },
          ],
        },
      ],
    },
  },
```

Then prove it both ways — a guard nobody has watched fail is not a guard:

```bash
npx eslint components lib app > lint.log 2>&1; echo $?
```
Expected: no `no-restricted-imports` error (the app's 8 pre-existing `setState`-in-effect errors are unrelated and stay).

Then temporarily add `motion` back to LogScreen's import and re-run against that one file.
Expected: exit `1` with `'motion' import from 'framer-motion' is restricted`. Restore the file.

- [ ] **Step 7: Look at the two screens that changed**

```bash
node scripts/shoot.mjs http://localhost:3000/dokumen/43/log tmp-log.png 390 844
```

Then open the image. Filter pills, the day sections, and the curve must look unchanged.

- [ ] **Step 8: Commit**

```bash
git add components/motion/MotionRoot.tsx app/layout.tsx components/dokumen components/settings/EngineeringSource.tsx
git commit -m "One provider, and a strict mode that makes the rule enforce itself"
```

---

## Task 3: `Press` — the tap response

**Files:**
- Create: `components/motion/Press.tsx`
- Modify: `components/layout/Sidebar.tsx` (first consumer, and the proof the provider reaches outside `<main>`)

**Interfaces:**
- Consumes: `MOTION.spring` from Task 1; `MotionRoot` from Task 2.
- Produces:
  - `pressMotion` — `{ whileTap: { scale: 0.97 }; transition: typeof MOTION.spring }`, spread onto any `m.*` element.
  - `Press({ children, className, ...rest })` — an `m.div` wrapper for clickable surfaces that are not themselves buttons.

- [ ] **Step 1: Write `components/motion/Press.tsx`**

```tsx
'use client';

import { m } from 'framer-motion';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * The press response, as props rather than as a wrapper.
 *
 * SPREAD THIS ONTO `m.button`, DO NOT WRAP THE BUTTON IN A DIV. A wrapper adds
 * a DOM node, changes the layout box, and drops every button concern on the
 * floor — `disabled`, `type`, `form`, the ref, the focus ring. Turning
 * `<button>` into `<m.button {...pressMotion}>` keeps all of it and costs one
 * word per call site.
 *
 * 0.97 is the number the app already used, scattered across call sites as
 * `active:scale-[0.97]`. The value does not change here; its home does.
 *
 * REMOVE `active:scale-[0.97]` AND ANY `transition-all` FROM WHATEVER TAKES
 * THIS. Two systems scaling one element fight: the class writes `transform`
 * through CSS, framer-motion writes it inline, and what you see is a press
 * that stutters halfway down. One thing, one mover.
 *
 * HOVER IS NOT HERE, and that is deliberate. The spec asked for hover to raise
 * a shadow, and the app's existing `hover:` classes already do exactly that —
 * in CSS, where a shadow change belongs. Animating `box-shadow` from
 * JavaScript repaints on every frame, which is the opposite of what this layer
 * was asked for. Hover also never happens on the phone this app is tested on
 * first, and AGENTS.md forbids hover from ever carrying information.
 */
export const pressMotion = {
  whileTap: { scale: 0.97 },
  transition: MOTION.spring,
} as const;

/**
 * For a clickable surface that is not a button — a card, a row, a tile. Same
 * response, and it takes the className so the caller's layout is unaffected.
 */
export function Press({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentPropsWithoutRef<typeof m.div>) {
  return (
    <m.div {...pressMotion} className={cn(className)} {...rest}>
      {children}
    </m.div>
  );
}
```

- [ ] **Step 2: Apply it to the sidebar's nav items**

Read `components/layout/Sidebar.tsx`. For each interactive `<button>` or clickable `<Link>` wrapper, change the element to `m.button` (importing `m` from `framer-motion` and `pressMotion` from `@/components/motion/Press`), spread `{...pressMotion}`, and **delete any `active:scale-[...]` and `transition-all` from its className**.

The sidebar is the first consumer on purpose: it lives outside `<main>`, so if `MotionRoot`'s boundary from Task 2 were wrong, this is where it shows.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?` then `npx next build > build.log 2>&1; echo $?`
Expected: `0` for both.

- [ ] **Step 4: Confirm the sidebar actually presses**

Start the dev server, then:

```bash
node scripts/_motion-verify.mjs http://localhost:3000
```

Expected: still `ALL PASS` — this task must not disturb the existing scroll-reveal or tab-survival checks.

Then prove the press reaches OUTSIDE `<main>`. Save this as `tmp-press-probe.mjs` and run it against the dev server:

```js
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 120_000 });
await new Promise((r) => setTimeout(r, 1500));
const t = await page.evaluate(async () => {
  // A button in the SIDEBAR, which is a sibling of <main>.
  const btn = document.querySelector('body > * button, aside button, nav button');
  if (!btn) return 'no sidebar button found';
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const v = getComputedStyle(btn).transform;
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }));
  return v;
});
console.log('sidebar button transform on press:', t);
await browser.close();
process.exit(t !== 'none' && !String(t).startsWith('no ') ? 0 : 1);
```

Expected: a `matrix(...)` and exit `0`. `none` means the sidebar is outside the provider — the silent failure `MotionRoot`'s comment warns about. Delete the probe file afterwards.

- [ ] **Step 5: Commit**

```bash
git add components/motion/Press.tsx components/layout/Sidebar.tsx
git commit -m "Press is props, not a wrapper, and the class it replaces comes off"
```

---

## Task 4: `SlideTab` — the pill that travels

`LogScreen` already does this by hand with `layoutId="log-filter"`. This task generalises that proven pattern and gives it the spring.

**Files:**
- Create: `components/motion/SlideTab.tsx`
- Modify: `components/layout/SectionTabs.tsx`, `components/weekly/WeekSteps.tsx:83-96`
- Do NOT modify: `components/weekly/WeekTabs.tsx` — it renders `WeekSteps` and `SectionTabs` and owns no tab row itself.

**Interfaces:**
- Consumes: `MOTION.spring` from Task 1.
- Produces: `SlideTab({ id, className }: { id: string; className?: string })` — an absolutely positioned `m.span`, rendered only inside the ACTIVE trigger.

- [ ] **Step 1: Write `components/motion/SlideTab.tsx`**

```tsx
'use client';

import { m } from 'framer-motion';

import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * The active pill, moving between tabs instead of blinking from one to the next.
 *
 * Render it ONLY inside the active trigger. React unmounts it from the old one
 * and mounts it in the new one; the shared `layoutId` is what turns those two
 * events into one continuous movement. There is no state here and no
 * measurement — framer-motion does the measuring.
 *
 * `id` MUST DIFFER PER TAB ROW. Two rows sharing an id will pull each other's
 * pill across the page, because `layoutId` is global inside the provider.
 * `'section-tab'` for SectionTabs, `'week-tab'` for WeekTabs.
 *
 * `transition` is passed explicitly because layout animations do not read the
 * default from `MotionConfig` — see the note on `MOTION.spring`.
 *
 * It writes NOTHING into the server HTML: no `initial`, no `animate`, just a
 * span with a background. If the bundle never arrives, the active tab still
 * has its pill — it simply does not slide.
 *
 * This is `LogScreen`'s `layoutId="log-filter"` grown up. That one used the
 * curve; this uses the spring, because a pill crossing a tab row is something
 * MOVING, which is the whole distinction rule 2 now draws.
 */
export function SlideTab({ id, className }: { id: string; className?: string }) {
  return (
    <m.span
      layoutId={id}
      transition={MOTION.spring}
      aria-hidden
      className={cn('absolute inset-0 -z-10 rounded-lg bg-background shadow-sm', className)}
    />
  );
}
```

- [ ] **Step 2: Put it in `SectionTabs.tsx`**

The trigger currently is:

```tsx
          <TabsTrigger
            key={t.href}
            value={t.href}
            asChild
            className="h-auto min-h-11 whitespace-nowrap rounded-lg px-3.5 transition-all duration-300 ease-ios active:scale-[0.97]"
          >
            <Link href={t.href} aria-current={activeHref === t.href ? 'page' : undefined}>
              {t.label}
            </Link>
          </TabsTrigger>
```

Becomes:

```tsx
          <TabsTrigger
            key={t.href}
            value={t.href}
            asChild
            className="relative h-auto min-h-11 whitespace-nowrap rounded-lg px-3.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <Link href={t.href} aria-current={activeHref === t.href ? 'page' : undefined}>
              {activeHref === t.href && <SlideTab id="section-tab" />}
              <span className="relative">{t.label}</span>
            </Link>
          </TabsTrigger>
```

Three things there, all load-bearing: `relative` gives the pill a positioning context; `data-[state=active]:bg-transparent` turns off shadcn's own static active background so the sliding pill is the only one; and `active:scale-[0.97]`/`transition-all` come off per the `Press` note. `activationMode="manual"` on the `Tabs` root stays — Radix defaults to activating on focus, which on a row of links fires a navigation per arrow key.

Also give `SectionTabs` an optional pill id, defaulting to the same string, so two instances can never collide if one is ever added:

```tsx
export default function SectionTabs({ tabs, className, pillId = 'section-tab' }: { tabs: SectionTab[]; className?: string; pillId?: string }) {
```

and pass it through as `<SlideTab id={pillId} />`.

- [ ] **Step 3: Put it in `WeekSteps.tsx`, not `WeekTabs.tsx`**

`WeekTabs` renders no tab row of its own — it renders `WeekSteps` (the stepper) and, on the report step, a `SectionTabs`. `SectionTabs` was handled in Step 2, so the remaining row is the stepper.

In `components/weekly/WeekSteps.tsx`, the active `<Link>` currently carries its own background:

```tsx
                className={cn(
                  'flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
                  'transition-all duration-300 ease-ios active:scale-[0.97]',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-foreground/60 hover:text-foreground'
                )}
```

Becomes:

```tsx
                className={cn(
                  'relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
                  active ? 'text-foreground' : 'text-foreground/60 hover:text-foreground'
                )}
```

with `{active && <SlideTab id="week-step" className="rounded-md" />}` as the Link's first child. `rounded-md` overrides `SlideTab`'s default `rounded-lg` so the pill matches this row's corner radius; `bg-background` and `shadow-sm` now come from `SlideTab` itself.

Keep the `min-h-11` comment — the 44px touch target is a rule, not an accident. Do not touch the "Current" badge's `animate-pop-in` or the Set-Week button's `animate-scale-in` in `WeekTabs`; those are load entrances and stay CSS.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?` then `npx next build > build.log 2>&1; echo $?`
Expected: `0` for both.

- [ ] **Step 5: Look at both tab rows, both widths**

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/summary tmp-week-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/weekly/43/summary tmp-week-desk.png 1280 900
node scripts/shoot.mjs http://localhost:3000/settings tmp-section-390.png 390 844
```

Open all three. The active tab must have exactly one pill, correctly positioned, with the label legible on top of it. A pill that has vanished means shadcn's active background was turned off without `SlideTab` rendering; a doubled pill means it was not turned off.

- [ ] **Step 6: Regression check**

Run: `node scripts/_motion-verify.mjs http://localhost:3000`
Expected: `ALL PASS`. Check 2 in that script navigates the weekly tab row, which this task just rewrote.

- [ ] **Step 7: Commit**

```bash
git add components/motion/SlideTab.tsx components/layout/SectionTabs.tsx components/weekly/WeekTabs.tsx
git commit -m "The active tab travels instead of blinking"
```

---

## Task 5: `Swap` — drill levels that leave as well as arrive

**Files:**
- Create: `components/motion/Swap.tsx`
- Modify: `components/weekly/WbsTreeVisual.tsx:164-181` (the `Level` component), `components/weekly/DataOverallWorkbench.tsx:1175`

**Interfaces:**
- Consumes: `MOTION.spring` from Task 1.
- Produces: `Swap({ levelKey, direction, children, className }: { levelKey: number | string; direction: 'fwd' | 'back'; children: ReactNode; className?: string })`.

- [ ] **Step 1: Write `components/motion/Swap.tsx`**

```tsx
'use client';

import { AnimatePresence, m } from 'framer-motion';
import type { ReactNode } from 'react';

import { MOTION } from '@/lib/design';

/**
 * One drill level, arriving from the side it came from — and the one it
 * replaces LEAVING, which is the part CSS could never do.
 *
 * `.animate-level-fwd` / `.animate-level-back` could only animate the incoming
 * level, because React had already removed the outgoing one before any
 * keyframe could run. So a level did not replace another level; one vanished
 * and another appeared. Here the two move together.
 *
 * `initial={false}` ON `AnimatePresence` IS THE ENTIRE REASON THIS IS ALLOWED
 * TO BE framer-motion. The comments in WbsTreeVisual and DataOverallWorkbench
 * rejected the library because `motion.div` writes its `initial` prop into the
 * SERVER HTML, and the whole first level shipped at `opacity: 0`, invisible
 * until hydration finished. `initial={false}` writes nothing: the first mount
 * appears as-is, in the first paint, with no animation at all. Every mount
 * AFTER that one is a real user action on a live page, which is precisely
 * where framer-motion belongs. The objection is answered at its source, not
 * worked around.
 *
 * `mode="popLayout"` takes the outgoing level out of flow, so the two slide
 * across each other instead of stacking and shoving the page down a screen.
 *
 * The spring, not the curve: a whole level is a thing MOVING.
 *
 * The level animates as ONE block. It was once one `animate-fade-in-up` per
 * card with a computed delay, and a folder here can hold 89 activities — the
 * last of them arriving three and a half seconds in. Do not reintroduce a
 * per-card stagger.
 */
export function Swap({
  levelKey,
  direction,
  children,
  className,
}: {
  levelKey: number | string;
  direction: 'fwd' | 'back';
  children: ReactNode;
  className?: string;
}) {
  const dx = direction === 'fwd' ? 32 : -32;
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <m.div
        key={levelKey}
        initial={{ opacity: 0, x: dx }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -dx }}
        transition={MOTION.spring}
        className={className}
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Replace `Level` in `WbsTreeVisual.tsx`**

The existing component at lines 164–181 keeps its name and signature so the call sites do not change; only its body and its doc comment do:

```tsx
function Level({
  levelKey,
  direction,
  children,
}: {
  levelKey: number;
  direction: 'fwd' | 'back';
  children: React.ReactNode;
}) {
  return (
    <Swap levelKey={levelKey} direction={direction}>
      {children}
    </Swap>
  );
}
```

Import `Swap` from `@/components/motion/Swap`. Rewrite the doc comment above it: the paragraph explaining why it is a CSS keyframe is now wrong, and must be replaced with the `initial={false}` reason. Leave the paragraph about the whole level animating as a single instance — it is still true and still the reason there is no per-card stagger.

- [ ] **Step 3: Replace the level wrapper in `DataOverallWorkbench.tsx:1175`**

Currently:

```tsx
          <div key={levelKey} className={`mt-3 ${direction === 'fwd' ? 'animate-level-fwd' : 'animate-level-back'}`}>
```

Becomes:

```tsx
          <Swap key={levelKey} levelKey={levelKey} direction={direction} className="mt-3">
```

with the matching closing tag changed from `</div>` to `</Swap>`, and `Swap` imported.

- [ ] **Step 4: Leave the CSS keyframes in place**

Do NOT delete `@keyframes level-in-fwd`, `level-in-back`, `.animate-level-fwd` or `.animate-level-back` from `app/globals.css` in this task. Removing CSS whose last consumer was just changed is how a page ends up unstyled two commits later; a separate cleanup can do it once the screens are confirmed.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?` then `npx next build > build.log 2>&1; echo $?`
Expected: `0` for both.

- [ ] **Step 6: Verify the first level is NOT hidden in the server HTML**

```bash
curl -s http://localhost:3000/weekly/43/overall > tmp-ssr.html
grep -c 'opacity:0\|opacity: 0' tmp-ssr.html
```

Expected: `0`. This is the exact regression the two rejected comments were about; if it is non-zero, `initial={false}` is missing or on the wrong element.

- [ ] **Step 7: Look at the drill-down**

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall tmp-overall-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall tmp-overall-desk.png 1280 900
```

Open both. The first level must be fully visible and correctly positioned — not offset by 32px, which would mean the entry animation ran when it should not have.

- [ ] **Step 8: Commit**

```bash
git add components/motion/Swap.tsx components/weekly/WbsTreeVisual.tsx components/weekly/DataOverallWorkbench.tsx
git commit -m "A drill level now replaces another instead of one vanishing and one appearing"
```

---

## Task 6: `Expand` — the one thing CSS genuinely cannot do

**Files:**
- Create: `components/motion/Expand.tsx`
- Modify: `components/weekly/ApprovalPanel.tsx`, `components/settings/CatalogEditor.tsx`, `components/dokumen/DocumentEditor.tsx`
- Modify: `components/settings/EngineeringSource.tsx:187-207` (replace its hand-rolled copy with the primitive)

**Interfaces:**
- Consumes: `MOTION.duration`, `MOTION.ease` from Task 1.
- Produces: `Expand({ open, children, className }: { open: boolean; children: ReactNode; className?: string })`.

- [ ] **Step 1: Write `components/motion/Expand.tsx`**

```tsx
'use client';

import { AnimatePresence, m } from 'framer-motion';
import type { ReactNode } from 'react';

import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * Open and close, with the height the content actually has.
 *
 * THIS IS THE CLEAREST CASE IN THE WHOLE LAYER. CSS cannot transition to
 * `height: auto`, and every `max-height` trick used to fake it pays for the
 * guess: set it too high and the animation spends its last third moving
 * nothing, which reads as a stall on exactly the panels people open most.
 *
 * `AnimatePresence initial={false}` keeps this out of the server HTML in both
 * directions. Closed, nothing renders at all. Open at first paint, the initial
 * animation is skipped, so no `height: 0` and no `opacity: 0` are written into
 * the markup — the same rule every other primitive in this folder obeys.
 *
 * THE CURVE, NOT THE SPRING, and `overflow-hidden` is not optional. `height`
 * is a LAYOUT property: it cannot run on the compositor, and a spring
 * overshooting a height would relayout the page past its resting size and
 * back. That is also why this is for PANELS — one thing a person opened — and
 * never inside a `.map()`. For a long list use opacity and transform, which
 * cost nothing.
 */
export function Expand({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Replace the hand-rolled copy in `EngineeringSource.tsx`**

Lines 187–207 currently hold exactly this pattern written out longhand. Replace the `AnimatePresence`/`m.div` pair with:

```tsx
      <Expand open={!!(error || (on && drop < -0.05))}>
        <Badge
          className={cn(
            'mt-3 w-full justify-start whitespace-normal text-left font-normal',
            error ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white',
          )}
        >
          <TriangleAlert className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          {error ?? `Reported engineering progress in this discipline falls by an average of ${Math.abs(drop).toFixed(1)} points while this is on.`}
        </Badge>
      </Expand>
```

The `reduced ? false : {...}` guard is dropped here because `MotionConfig reducedMotion="user"` from Task 2 covers it centrally. If `reduced` becomes unused in the file after this, remove the `useReducedMotion()` call too; if it is still used elsewhere in the file, leave it.

- [ ] **Step 3: Apply to the other three panels**

Each of these is an existing `condition && (...)` block. Replace the `&&` with `<Expand open={condition}>` wrapping the same children, unchanged:

- `components/weekly/ApprovalPanel.tsx` — three of them: `drifted &&` (line ~91), `blocked &&` (line ~111), and `!by.trim() && !pending &&` (line ~145). The drift notice is the one that matters most: it appears when a signed week is edited afterwards, and a notice that pops in without movement reads as a page glitch rather than as a warning.
**Both of the other two turned out not to be panels, and were skipped — 30 August 2026:**

- `components/settings/CatalogEditor.tsx` — `showClaim` sits INSIDE the `.map()` over catalog rows, which is the one place this layer is not allowed to go. It is also a prop rather than state, so it never toggles and there is nothing to animate. Its two `hidden={fixedLength}` attributes are permanent structure, not a disclosure. Left alone entirely.
- `components/dokumen/DocumentEditor.tsx` — `showAll` swaps the `stages` array between `CORE` and `STAGE_ORDER` and the result is rendered through a `.map()`. That is a list changing length, not a panel opening: wrapping it in `Expand` would collapse and re-expand the three core stages as well, which is wrong. It is a reasonable candidate for the Task 7 treatment (`AnimatePresence` on the rows, ~7 of them) and is recorded here rather than done, because Task 6 is panels.

Do not change any condition, any child, or any class on the children. If a block's children contain a `.map()` that can exceed ~20 rows, skip that block and say so.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?` then `npx next build > build.log 2>&1; echo $?`
Expected: `0` for both.

- [ ] **Step 5: Confirm nothing ships hidden**

```bash
curl -s http://localhost:3000/settings > tmp-ssr.html
grep -c 'height:0\|height: 0\|opacity:0\|opacity: 0' tmp-ssr.html
```

Expected: `0`.

- [ ] **Step 6: Look at it**

```bash
node scripts/shoot.mjs http://localhost:3000/settings tmp-settings-390.png 390 844
```

Open the image and confirm the panels are in their correct default state — nothing collapsed that should be open, nothing open that should be collapsed.

- [ ] **Step 7: Commit**

```bash
git add components/motion/Expand.tsx components/settings components/weekly/ApprovalPanel.tsx components/dokumen/DocumentEditor.tsx
git commit -m "Open to the height the content actually has"
```

---

## Task 7: Lists that rearrange when filtered

**Files:**
- Modify: `components/daily/DailyReportsView.tsx`, `components/weekly/PhotoUploadGrid.tsx`

**Interfaces:**
- Consumes: `MOTION.spring` from Task 1; the provider from Task 2.
- Produces: nothing new — this task consumes only.

`LogScreen` and `RegisterWorkbench` already do this and were migrated in Task 2; they need no further change.

- [ ] **Step 1: Count the rows before touching either file**

Read both files and establish the maximum length each list can reach. `PhotoUploadGrid` is paged by `PAGE_SIZE`; `DailyReportsView` is one report's rows.

**If either can exceed ~20 items, do not add `layout` to it.** Record the number and skip that file, saying so. The constraint is not negotiable: `layout` measures every element carrying it on every change, and `WbsTreeTable`'s 285 leaves are the standing proof of what that costs.

- [ ] **Step 2: Apply `layout` + `AnimatePresence` where the count allows**

For a list that passes Step 1, the shape is `LogScreen`'s, which is already proven in this codebase:

```tsx
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => (
            <m.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={MOTION.spring}
            >
              {/* existing row content, unchanged */}
            </m.div>
          ))}
        </AnimatePresence>
```

`key` must be a stable id from the data, never the array index — an index key makes framer-motion animate the wrong row when the list reorders.

Note that `initial` here DOES write `opacity: 0` into the server HTML. That is acceptable only where the list is client-rendered behind an interaction; if the list is present in the server HTML of a first page load, use `initial={false}` on the `AnimatePresence` instead and let the rows appear plainly.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?` then `npx next build > build.log 2>&1; echo $?`
Expected: `0` for both.

- [ ] **Step 4: Check the server HTML of both pages**

```bash
curl -s http://localhost:3000/daily > tmp-ssr.html
grep -c 'opacity:0\|opacity: 0' tmp-ssr.html
```

Expected: `0`. If it is not, Step 2's `initial={false}` fallback applies.

- [ ] **Step 5: Look at both pages at both widths**

```bash
node scripts/shoot.mjs http://localhost:3000/daily tmp-daily-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/daily tmp-daily-desk.png 1280 900
```

- [ ] **Step 6: Commit**

```bash
git add components/daily/DailyReportsView.tsx components/weekly/PhotoUploadGrid.tsx
git commit -m "Filtered lists rearrange instead of jumping"
```

---

## Task 8: The press rollout

**Files:**
- Modify: every remaining client component with a clickable surface — `components/daily/NewDailyButton.tsx`, `components/daily/CreateReportHere.tsx`, `components/daily/DailyForm.tsx`, `components/portfolio/ProjectSwitcher.tsx`, `components/print/SavePdfButton.tsx`, `components/weekly/WeekSelect.tsx`, `components/weekly/ContractValueField.tsx`, `components/weekly/WbsTreeVisual.tsx`, `components/weekly/DataOverallWorkbench.tsx`, `components/dokumen/AddDocumentDialog.tsx`, `components/ui/ConfirmDialog.tsx`, `components/setup/SetupWizard.tsx`

**Interfaces:**
- Consumes: `pressMotion` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Find every remaining occurrence of the class being replaced**

```bash
grep -rn "active:scale-" --include=*.tsx components app > tmp-press-sites.txt
cat tmp-press-sites.txt
```

This list is the work. Each line is one button that presses by CSS today.

- [ ] **Step 2: Convert each site**

For each: change `<button` to `<m.button`, add `{...pressMotion}`, and delete `active:scale-[0.97]` (or whatever value it carries) and any `transition-all` from the className. Import `m` and `pressMotion`.

**Three exclusions, each for a reason already paid for:**

- **Anything inside a `.map()` that can exceed ~20 rows.** `WbsTreeVisual` and `DataOverallWorkbench` both render long lists — convert only their chrome (headers, breadcrumbs, back buttons), never a per-row control. Leave `active:scale-` on those rows.
- **`components/ui/DateField.tsx`, `TruncatedName.tsx`, `AnimatedNumber.tsx`.** AGENTS.md: these hand-rolled primitives have absorbed rounds of mobile fixes. Leave them alone.
- **`components/print/SavePdfButton.tsx`'s state animations.** Its Save → Preparing → Downloading → Saved sequence is load-and-state CSS that has been debugged on real phones. Add `pressMotion` to the button if it carries `active:scale-`, and change nothing else.

- [ ] **Step 3: Confirm no site was left half-converted**

```bash
grep -rn "active:scale-" --include=*.tsx components app
```

Every remaining line must be one of the three exclusions above. Check each against the list.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit > tsc.log 2>&1; echo $?` then `npx next build > build.log 2>&1; echo $?`
Expected: `0` for both.

- [ ] **Step 5: Sweep every route at both widths**

```bash
for u in / /weekly/43/summary /weekly/43/overall /weekly/43/detail /daily /dokumen/43/summary /portfolio /settings /klaim; do
  node scripts/shoot.mjs "http://localhost:3000$u" "tmp$(echo $u | tr '/' '-')-390.png" 390 844
done
```

Open every image. Nothing may have shifted position, lost a background, or lost its focus ring.

- [ ] **Step 6: Commit**

```bash
git add components app && git commit -m "Every button presses from one place"
```

---

## Task 9: The guard that keeps this from regressing

**Files:**
- Modify: `scripts/_motion-verify.mjs`, `scripts/_motion-perf.mjs:23`

**Interfaces:**
- Consumes: everything above.
- Produces: a check that fails the moment a hidden-until-hydration element reappears anywhere in the app.

- [ ] **Step 1: Add the server-HTML guard to `scripts/_motion-verify.mjs`**

Append before the `browser.close()` call:

```js
/* ------------------------- 4 · nothing ships hidden in the SERVER HTML */
// The runtime check above (3) looks at the page AFTER hydration, which is
// exactly when this bug stops being visible. This one reads the markup the
// server sent, with no JavaScript involved at all — the state the field crew's
// phone is looking at while the bundle is still downloading.
//
// It has been paid for three times: Reveal shipped six elements at opacity 0,
// CountUp shipped the hero figure invisible and never recovered it under
// prefers-reduced-motion, and WbsTreeVisual's ring shipped an empty arc for
// four and a half seconds. Every one was found by a person who happened to
// look.
const ROUTES = ['/', '/weekly/43/summary', '/weekly/43/overall', '/weekly/43/detail', '/daily', '/dokumen/43/summary', '/portfolio', '/settings'];
const HIDDEN = /style="[^"]*(opacity:\s*0(?![.\d])|visibility:\s*hidden)/g;
for (const route of ROUTES) {
  const html = await fetch(BASE + route).then((r) => r.text());
  const hits = [...html.matchAll(HIDDEN)].map((m) => m[0].slice(0, 60));
  check(`server HTML of ${route} ships nothing hidden`, hits.length === 0, hits.slice(0, 3).join(' | '));
}
```

`opacity: 0` is matched but `opacity: 0.5` is not — hence the `(?![.\d])`.

- [ ] **Step 2: Add the interaction checks**

Also before `browser.close()`:

```js
/* ------------------------------------- 5 · the interaction layer is live */
await go('/settings');
await sleep(800);
const pressed = await page.evaluate(async () => {
  const btn = document.querySelector('main button');
  if (!btn) return 'no button found';
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t = getComputedStyle(btn).transform;
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }));
  return t;
});
check('a button actually scales on press', pressed !== 'none' && pressed !== 'no button found', String(pressed));
```

A press that reports `none` means the element is outside `MotionRoot` — the silent failure Task 2's comment warns about.

- [ ] **Step 3: Run the whole script**

Start the dev server, then:

```bash
node scripts/_motion-verify.mjs http://localhost:3000
```

Expected: `ALL PASS`, exit `0`. All five groups must pass, not just the new ones.

- [ ] **Step 4: Prove the new guard can fail**

Temporarily add `<div style="opacity: 0">x</div>` to `app/page.tsx`, re-run the script.
Expected: check 4 reports FAIL for `/`. Remove the probe and re-run to confirm PASS returns.

A guard nobody has watched fail is not a guard.

- [ ] **Step 5: Measure the jank, on a phone-shaped machine**

`scripts/_motion-perf.mjs` already exists and already does the right thing: 390px viewport, `Emulation.setCPUThrottlingRate: 4`, counting long tasks (>50ms of blocked main thread) and forced synchronous layouts. That pair IS what "laggy" means; a frame counter cannot tell them from a slow dev build.

Add the two routes this layer changed most to its URL list at line ~23:

```js
for (const url of ['/', '/dokumen/36/summary', '/daily/2026-08-29', '/weekly/43/overall', '/settings']) {
```

`/weekly/43/overall` carries the drill-down `Swap`; `/settings` carries the `Expand` panels and a `SectionTabs` pill.

Run it against a PRODUCTION build, not `next dev` — a dev build's compile cost swamps the measurement:

```bash
npx next build > build.log 2>&1; echo $?
npx next start &
node scripts/_motion-perf.mjs http://localhost:3000
```

Record the numbers in the commit message. If forced synchronous layouts rose on `/weekly/43/overall` or `/settings`, the cause is `Expand`'s `height` or a `layout` prop that got onto a long list — go back to Task 6 or Task 7, do not tune the spring.

- [ ] **Step 6: Final build**

Run: `npx next build > build.log 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/_motion-verify.mjs scripts/_motion-perf.mjs
git commit -m "Fail the build the fourth time something ships hidden"
```

---

## Out of scope, deliberately

- **No draggable `Reorder`.** No list in this app has an order that belongs to the user.
- **No cross-route shared element transitions.** `RouteTransition` already fades correctly and reads nothing; adding `layoutId` across routes brings it back into the territory that killed the build once.
- **No second spring.** If one turns out to be insufficient, that is a finding to write down, not a value to add quietly.
- **No deletion of the now-unused CSS keyframes** (`level-in-fwd`, `level-in-back`). A separate cleanup, once the screens are confirmed.
- **No removal of the existing `useReducedMotion()` branches** in the four migrated components. `reducedMotion="user"` is additive; stripping them is its own change with its own risk.
