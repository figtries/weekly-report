'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';


import Spinner from '@/components/ui/Spinner';
import SoftSheet from '@/components/ui/SoftSheet';

// Shared confirm dialog, on the app's one sheet (`SoftSheet`): up from below
// on a phone like Data Overall's activity sheet, a rising card from `sm`.
//
// NO BLUR (4 Oct 2026). The backdrop was `backdrop-blur-sm` over the whole
// screen, and blurring everything behind it is the most expensive paint a page
// can ask for: traced at 390px with CPU 4x, the first frame of the open took
// 60-90 ms from the EDL builder. Export Excel dropped its blur for the same
// reason; this dialog now opens the same way.
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
  return (
    <SoftSheet open={open} onClose={() => !busy && onCancel()} label={title} size="sm" className="px-5 pb-5 sm:p-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <div className="mt-1 text-sm text-muted-foreground">{message}</div>

        {/* THE ACTION LEADS AND CANCEL FOLLOWS, on one row, the same way the
            project modals read. This dialog had them the other way round, so
            the two places in the app that ask "are you sure?" answered in
            opposite directions and muscle memory from one was wrong in the
            other. The action keeps `flex-1` so it is unmistakably the primary
            even when its label is short. */}
        <div className="mt-6 grid grid-cols-2 gap-2">
          {/* Two equal halves, Cancel first: a narrow grey Cancel beside a wide
              pink Delete read as two unrelated buttons (9 Oct 2026). */}
          <m.button {...pressMotion}
            onClick={onCancel}
            disabled={busy}
            className="btn-cancel inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm"
          >
            Cancel
          </m.button>
          <m.button {...pressMotion}
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold shadow-sm transition-colors duration-200 ease-ios hover:shadow-md disabled:opacity-60 ${
              destructive
                ? 'bg-destructive text-white hover:bg-destructive/90'
                : 'btn-primary'
            }`}
          >
            {busy && <Spinner />}
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </m.button>
        </div>
    </SoftSheet>
  );
}
