'use client';

import { Download, Plus, Send } from 'lucide-react';

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
  register, onAdd, onTransmittal, onTransmittalIntent,
}: {
  register: RegisterKind;
  onAdd: () => void;
  /** Opens Record transmittal: one letter, many documents (3 Oct 2026). */
  onTransmittal: () => void;
  /** Fetch the dialog's code before the press lands (pointer down, focus). */
  onTransmittalIntent?: () => void;
}) {
  const label = register === 'edl' ? 'EDL' : 'VDRL';

  return (
    // Phone: Add and Export side by side, Record transmittal full width under
    // them; three buttons in one wrapping row left Export stranded on a line
    // of its own. From sm they sit in one row again.
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
      <Button className="h-11" onClick={onAdd}>
        <Plus className="mr-1.5 h-4 w-4" /> Add {label}
      </Button>

      <Button
        variant="outline"
        className="order-last col-span-2 h-11 sm:order-none"
        onClick={onTransmittal}
        onPointerDown={onTransmittalIntent}
        onFocus={onTransmittalIntent}
      >
        <Send className="mr-1.5 h-4 w-4" /> Record transmittal
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
