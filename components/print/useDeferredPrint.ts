'use client';

import { useCallback, useEffect, useState } from 'react';
import { subscribeToPrintRequests } from './printRequest';

// Mounts the print sheet when the toolbar's Print button asks for one — including
// when it was pressed before this component existed (see printRequest.ts: the
// request is latched, never dropped).
//
// Deliberately does NOT call window.print() and does NOT listen for afterprint:
// on Android, afterprint fires the moment print() returns (not when the dialog
// closes), so auto-unmounting here blanked the printout — see PrintSheet.tsx,
// which owns printing and closing.
export function useDeferredPrint() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => subscribeToPrintRequests(() => setMounted(true)), []);

  const close = useCallback(() => setMounted(false), []);

  return { mounted, close };
}
