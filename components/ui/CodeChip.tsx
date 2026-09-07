import { cn } from '@/lib/utils';

/**
 * A WBS code or an SPK tag — data, so it keeps its own casing and its own
 * monospace face.
 *
 * It exists because the identifier is at the WRONG END of the name. Every
 * contract on this project is called "Pekerjaan Relokasi … (SPK-002)", so a
 * title truncated from the right loses the only part that tells one row from
 * another, and at 390px the list reads "Pekerjaan Relok…" three times over.
 * Pulling the tag out front makes every row identifiable at any width.
 *
 * Lifted out of `components/dashboard/charts.tsx`, where it was first written
 * for the "By contract" list. Detail Progress now shows the same chip in the
 * same place, so a contract looks like itself on both screens.
 */
export default function CodeChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  );
}

/** The "(SPK-###)" tag and the name without it. */
export function splitCode(deskripsi: string): { tag: string | null; name: string } {
  return {
    tag: deskripsi.match(/\(SPK-\d+\)/)?.[0]?.replace(/[()]/g, '') ?? null,
    name: deskripsi.replace(/\s*\(SPK-\d+\)\s*/, '').trim(),
  };
}
