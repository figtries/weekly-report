'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import Spinner from '@/components/ui/Spinner';

// Shared confirm dialog with the same motion language as the other modals:
// backdrop fade + card scale-in, and a mirrored exit animation on close.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busyLabel,
  busy = false,
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Keep mounted briefly after close so the exit animation can play.
  const [visible, setVisible] = useState(open);
  useEffect(() => {
    if (open) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), 120);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${open ? 'animate-fade-in' : 'animate-fade-out'}`}
        onClick={() => !busy && onCancel()}
      />
      <div
        className={`relative w-full max-w-sm rounded-2xl border bg-card p-5 shadow-xl sm:p-6 ${
          open ? 'animate-scale-in' : 'animate-scale-out'
        }`}
      >
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <div className="mt-1 text-sm text-muted-foreground">{message}</div>

        {/* THE ACTION LEADS AND CANCEL FOLLOWS, on one row, the same way the
            project modals read. This dialog had them the other way round, so
            the two places in the app that ask "are you sure?" answered in
            opposite directions and muscle memory from one was wrong in the
            other. The action keeps `flex-1` so it is unmistakably the primary
            even when its label is short. */}
        <div className="mt-6 flex gap-2">
          <m.button {...pressMotion}
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium shadow-sm transition-colors duration-200 ease-ios hover:shadow-md disabled:opacity-60 ${
              destructive
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'btn-primary'
            }`}
          >
            {busy && <Spinner />}
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </m.button>
          <m.button {...pressMotion}
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </m.button>
        </div>
      </div>
    </div>,
    document.body
  );
}
