import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';

/**
 * The one empty state. Every screen with nothing to show yet — no project open,
 * no weights, no progress, no weekly reports, no daily reports, no delay
 * records — says so through this: same card, same size, same place on screen.
 *
 * It exists because they had drifted. The dashboard printed a 2xl headline
 * pinned near the top of the page while Weekly and Daily drew a card, and the
 * Daily card sat at the top while the Weekly one sat in the middle. Three
 * screens saying the same kind of thing in three shapes reads as three separate
 * faults rather than as one state the app has.
 *
 * `min-h-full` NEXT TO `flex-1` is what fixes the position, and both are load-
 * bearing. The weekly layout hands its children a `flex h-full flex-col`
 * wrapper, so there `flex-1` does the centring — that is why Weekly was the one
 * screen already correct. Daily and Klaim render straight into <main>, which is
 * not a flex container, so `flex-1` is inert there and `min-height: 100%`
 * against <main>'s definite height centres it instead. Under 560px of viewport
 * height the weekly shell releases its scroller (see globals.css) and the
 * percentage resolves to auto — the card then sits at its natural height, which
 * is the right answer on a screen that short.
 */
export default function EmptyState({
  icon: Icon,
  title,
  body,
  primary,
  secondary,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="animate-enter w-full max-w-md rounded-xl border bg-card p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-10 place-items-center rounded-lg bg-muted"
        >
          <Icon className="size-5 text-muted-foreground" />
        </span>

        <h2 className="mt-3 text-sm font-semibold">{title}</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>

        {(primary || secondary) && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {primary && (
              <Link
                href={primary.href}
                className="btn-primary inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium"
              >
                {primary.label}
                <ArrowRight className="size-4" />
              </Link>
            )}
            {secondary && (
              <Link
                href={secondary.href}
                className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
              >
                {secondary.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
