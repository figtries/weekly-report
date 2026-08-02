'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** How long a finger has to rest on the name before it gives up the rest of it. */
const HOLD_MS = 380;
/** Past this much drift the gesture is a scroll, not a hold. */
const SLOP_PX = 10;
/** Breathing room between the popover and the name, and against the screen edge.
 *  EDGE is the phone gutter (px-3) so a full-width popover lines up exactly with
 *  the cards underneath it rather than overhanging or insetting from them. */
const GAP_PX = 10;
const EDGE_PX = 12;
const MAX_W_PX = 420;

/**
 * A WBS name that is cut to one line when it does not fit. Press and hold it and
 * the whole name rises out of the card in a popover; let go and it is gone.
 *
 * The list is the reason this is a hold and not a chevron: a row of "Pekerjaan
 * Relokasi 2 unit GT…" with a little affordance stapled to every one of them
 * looked terrible, and the cards are the page. So nothing is added at rest —
 * the card renders exactly as it did before — and the whole name lives one
 * long press away.
 *
 * The popover is one of the app's own cards, not a foreign black tooltip: white,
 * rounded-2xl, the same 14px semibold title face as a LeafCard, lifted off the
 * page by shadow alone. Its caret points at the finger that summoned it and the
 * scale grows from exactly that point, and the accent rail repeats the status
 * colour of the ring on the card being held, so the popover reads as that card
 * speaking rather than as a layer on top of it.
 *
 * The hold is armed only while the name is genuinely cut off, so a name that
 * already fits behaves like plain text. A hold that fires also swallows the
 * click it would otherwise end in, so holding never drills into the folder.
 *
 * The cut is purely visual — screen readers read the whole name either way — so
 * the popover is aria-hidden and this stays a <span>: it sits inside a card
 * <button>, where a nested interactive element would be invalid. The popover
 * itself is portalled to <body> because the cards animate on transform, which
 * would otherwise trap a fixed-position child inside the card.
 */
export default function TruncatedName({
  text,
  className = '',
  accent,
}: {
  text: string;
  className?: string;
  /** Status colour of the card's ring — repeated as the popover's accent rail. */
  accent?: string;
}) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowClick = useRef(false);

  const [clipped, setClipped] = useState(false);
  /** The name's box plus the x the finger landed on, captured when the hold fires. */
  const [anchor, setAnchor] = useState<{ rect: DOMRect; pointerX: number } | null>(null);
  /** Filled in after the popover has been measured — until then it stays hidden. */
  const [place, setPlace] = useState<{ top: number; above: boolean } | null>(null);

  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    let live = true;
    const measure = () => {
      if (live) setClipped(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    // The clipped width never changes when Inter finally swaps in, so the
    // observer alone would keep a first-paint measurement taken in a fallback
    // face.
    document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [text]);

  // The gesture is watched on the window, not on the name: a finger that slides
  // off the name still has to end the hold, and without pointer capture (which
  // would eat the card's own tap) its pointerup lands on some other element.
  const unwatch = useRef<() => void>(() => {});

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unwatch.current();
    unwatch.current = () => {};
    setAnchor(null);
    setPlace(null);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    unwatch.current();
  }, []);

  // Anything that moves the card out from under the popover closes it.
  useEffect(() => {
    if (!anchor) return;
    const close = () => {
      setAnchor(null);
      setPlace(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  // Horizontal geometry is known as soon as the hold fires; the vertical side
  // needs the rendered height, so it waits for the layout pass below.
  // One rule covers both shapes: the popover is as wide as it is allowed to be,
  // then slid to sit under the name. On a phone that maths out to the full
  // content width — the whole point, since a name that fits on one line beats a
  // narrow box breaking "(SPK-007)" across two. On a desktop the cap keeps it a
  // popover and the slide keeps it tied to the name it came from.
  const geo = anchor
    ? (() => {
        const width = Math.min(MAX_W_PX, window.innerWidth - EDGE_PX * 2);
        const left = Math.max(EDGE_PX, Math.min(anchor.rect.left - 14, window.innerWidth - EDGE_PX - width));
        return { left, width, caret: Math.max(left + 20, Math.min(anchor.pointerX, left + width - 20)) };
      })()
    : null;

  // Above the name by preference — the finger doing the holding sits below it
  // and would cover a popover placed there. Below only when there is no room.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !anchor) return;
    const h = el.offsetHeight;
    const above = anchor.rect.top - GAP_PX - h >= EDGE_PX;
    setPlace({
      top: above ? anchor.rect.top - GAP_PX - h : Math.min(anchor.rect.bottom + GAP_PX, window.innerHeight - EDGE_PX - h),
      above,
    });
  }, [anchor]);

  return (
    <>
      <span
        className={`block select-none [-webkit-touch-callout:none] ${className}`}
        onPointerDown={(e) => {
          swallowClick.current = false;
          if (!clipped || e.button !== 0) return;
          stop();
          const start = { x: e.clientX, y: e.clientY };
          const onMove = (ev: PointerEvent) => {
            // Past the slop the finger is scrolling the list, not asking a question.
            if (timer.current && (Math.abs(ev.clientX - start.x) > SLOP_PX || Math.abs(ev.clientY - start.y) > SLOP_PX)) stop();
          };
          const onEnd = () => stop();
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onEnd);
          window.addEventListener('pointercancel', onEnd);
          unwatch.current = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
          };
          timer.current = setTimeout(() => {
            timer.current = null;
            const el = nameRef.current;
            if (!el) return;
            swallowClick.current = true;
            setAnchor({ rect: el.getBoundingClientRect(), pointerX: start.x });
          }, HOLD_MS);
        }}
        onContextMenu={(e) => {
          if (clipped) e.preventDefault();
        }}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <span ref={nameRef} className="block truncate">
          {text}
        </span>
      </span>

      {geo &&
        createPortal(
          <span
            ref={popRef}
            aria-hidden
            className={`pointer-events-none fixed z-[60] block rounded-2xl bg-white shadow-[0_20px_48px_-12px_rgb(15_23_42/0.45),0_4px_12px_-4px_rgb(15_23_42/0.16)] ${
              place ? 'animate-popover-in' : ''
            }`}
            style={{
              left: geo.left,
              width: geo.width,
              top: place?.top ?? 0,
              transformOrigin: place ? `${geo.caret - geo.left}px ${place.above ? '100%' : '0%'}` : undefined,
              visibility: place ? 'visible' : 'hidden',
            }}
          >
            <span className="flex items-stretch gap-3 px-4 py-3">
              <span className="w-[3px] shrink-0 rounded-full" style={{ background: accent ?? '#d1d5db' }} />
              <span className="text-[14px] font-semibold leading-snug text-gray-900">{text}</span>
            </span>
            {place && (
              <span
                className="absolute h-3 w-3 rotate-45 rounded-[3px] bg-white"
                style={{ left: geo.caret - geo.left - 6, [place.above ? 'bottom' : 'top']: -5 }}
              />
            )}
          </span>,
          document.body
        )}
    </>
  );
}
