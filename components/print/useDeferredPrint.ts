'use client';

import { useEffect, useState } from 'react';

export function useDeferredPrint(delay = 250) {
  const [mounted, setMounted] = useState(false);
  const [pendingPrint, setPendingPrint] = useState(false);

  useEffect(() => {
    const requestPrint = () => {
      setMounted(true);
      setPendingPrint(true);
    };

    window.addEventListener('weekly-print-request', requestPrint);
    return () => window.removeEventListener('weekly-print-request', requestPrint);
  }, []);

  useEffect(() => {
    if (!mounted || !pendingPrint) return;

    const timer = window.setTimeout(() => {
      window.print();
      setPendingPrint(false);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [delay, mounted, pendingPrint]);

  useEffect(() => {
    const cleanup = () => setMounted(false);

    window.addEventListener('afterprint', cleanup);
    return () => window.removeEventListener('afterprint', cleanup);
  }, []);

  return mounted;
}
