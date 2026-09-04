'use client';

import { Download, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { RegisterKind } from '@/lib/schema';

/**
 * The two things you can do to a register as a whole.
 *
 * `Add` is one door, not three. An earlier version put Paste list, Import and
 * Export side by side, which made "how do I want to build this" the first
 * decision on the screen and hid the fact that both ways end in the same place.
 * One button opens the builder now, and the builder is what asks how.
 */
export function RegisterTools({
  register, onAdd,
}: {
  register: RegisterKind;
  onAdd: () => void;
}) {
  const label = register === 'edl' ? 'EDL' : 'VDRL';

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button className="h-11" onClick={onAdd}>
        <Plus className="mr-1.5 h-4 w-4" /> Add {label}
      </Button>

      {/* A plain link, not a fetch-and-blob: the file is built by a route that
          sets its own filename, and a link is what a phone's browser knows how
          to hand to Files or Drive. */}
      <Button variant="outline" className="h-11" asChild>
        <a href={`/api/register/export?register=${register}`} download>
          <Download className="mr-1.5 h-4 w-4" /> Export
        </a>
      </Button>
    </div>
  );
}
