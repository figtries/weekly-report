'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
        className={`relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-xl sm:p-6 ${
          open ? 'animate-scale-in' : 'animate-scale-out'
        }`}
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <div className="mt-1 text-sm text-gray-500">{message}</div>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 ease-ios hover:bg-gray-50 active:scale-[0.97] disabled:opacity-50 sm:py-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 ease-ios hover:shadow-md active:scale-[0.96] disabled:opacity-60 sm:py-2 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
