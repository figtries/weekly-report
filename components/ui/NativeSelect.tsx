import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A `<select>` that looks like `<Input>`, because it stands next to one.
 *
 * Four screens had each styled their own: `h-10 rounded-md px-2.5` in the
 * document editor, `h-11 rounded-lg px-3` in the register builder, `h-8
 * px-1.5 text-[11px]` for the currency in the value strip. Put beside the text
 * fields they share a row with, no two of them were the same height, the same
 * corner, or the same distance from their own right edge.
 *
 * NATIVE, not Radix, and that is the repo's standing rule: these sit inside
 * rows that can run to hundreds, and a Radix Select per row is hundreds of
 * contexts, refs and portals. It also means the platform draws the list, which
 * on a phone is the part people already know how to use.
 *
 * The chevron is drawn here rather than left to the platform. A native arrow
 * is painted hard against the control's right edge at whatever size the OS
 * feels like, which is the whole reason these read as "pushed against the
 * edge"; `appearance-none` plus `pr-8` gives it the same gutter every other
 * field has.
 */
export default function NativeSelect({
  className,
  wrapperClassName,
  children,
  compact = false,
  ...props
}: React.ComponentProps<'select'> & {
  /** For a control riding inside a dense strip rather than a form row. */
  compact?: boolean;
  /**
   * Goes on the positioning wrapper, which is what a parent grid or flex row
   * actually lays out. Placement classes on `className` would land on the
   * `<select>` inside and do nothing.
   */
  wrapperClassName?: string;
}) {
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <select
        data-slot="select"
        className={cn(
          'w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent outline-none transition-colors',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
          compact
            ? 'h-8 pl-2 pr-7 text-[11px] font-medium'
            : 'h-8 min-h-11 py-1 pl-2.5 pr-8 text-base sm:min-h-0 md:text-sm',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground',
          compact ? 'right-2 size-3' : 'right-2.5 size-4'
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
