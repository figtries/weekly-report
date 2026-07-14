'use client';

import { useCallback, useEffect, useState } from 'react';

// Mounts the print sheet when the toolbar's Print button fires the request
// event. Deliberately does NOT call window.print() and does NOT listen for
// afterprint: on Android, afterprint fires the moment print() returns (not
// when the dialog closes), so auto-unmounting here blanked the printout —
// see PrintSheet.tsx, which owns printing and platform-aware closing.
export function useDeferredPrint() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const open = () => setMounted(true);
    window.addEventListener('weekly-print-request', open);
    return () => window.removeEventListener('weekly-print-request', open);
  }, []);

  const close = useCallback(() => setMounted(false), []);

  return { mounted, close };
}
