'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m } from 'framer-motion';
import { ClipboardPaste, CornerDownRight, TriangleAlert } from 'lucide-react';

import { MOTION } from '@/lib/design';
import { applyPasteAction, previewPasteAction, type PastePreview } from '@/lib/paste-actions';

/**
 * The plan already exists in a workbook. This is the door.
 *
 * Gundih is 285 rows and nobody types 285 rows, so until this existed no real
 * project could enter the app at all — every other feature here was being built
 * on a plan that could only be demonstrated, never used.
 *
 * **It reads before it writes.** Paste, press Read it, and the app says what it
 * understood: how many rows, where the depth came from, which day-order it
 * assumed, which numbers it read as thousands, and the first dozen rows drawn as
 * the tree they will become. Only then is there an Insert button. A bulk write
 * that cannot be undone shows its damage first — the same rule the weights
 * recalculation follows.
 *
 * **It is a sheet on a phone and a card on a desktop**, portalled to the body,
 * like every other panel in this section. The textarea is the one place that
 * genuinely wants a full screen.
 */
export default function PasteRows({
  projectId,
  afterNodeId,
  afterLabel,
  onDone,
  trigger,
}: {
  projectId: string;
  afterNodeId: string | null;
  /** The selected row's name, so the button can say where the block will land. */
  afterLabel: string | null;
  onDone: () => void;
  /** Rendered as the opener; lets the toolbar and the empty state share this. */
  trigger: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PastePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function close() {
    setOpen(false);
    setText('');
    setPreview(null);
    setError(null);
  }

  function read(next: string) {
    setText(next);
    setPreview(null);
    setError(null);
  }

  function look() {
    setError(null);
    startTransition(async () => {
      const res = await previewPasteAction(text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res);
    });
  }

  function insert() {
    setError(null);
    startTransition(async () => {
      const res = await applyPasteAction(projectId, text, afterNodeId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      close();
      onDone();
    });
  }

  return (
    <>
      {trigger(() => setOpen(true))}

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: MOTION.duration, ease: MOTION.ease }}
                className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
                onClick={() => !pending && close()}
              >
                <m.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: MOTION.enter, ease: MOTION.ease }}
                  className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border bg-card shadow-lg sm:max-w-2xl sm:rounded-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="shrink-0 border-b p-4">
                    <h2 className="text-sm font-semibold">Paste rows from Excel</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Select the cells in the workbook, copy, and paste here. A task name is the
                      only column that has to be there — an outline code, dates, a duration and a
                      price are all read when they are.
                    </p>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    <textarea
                      autoFocus
                      value={text}
                      onChange={(e) => read(e.target.value)}
                      spellCheck={false}
                      placeholder={
                        'WBS\tUraian Pekerjaan\tMulai\tSelesai\tNilai\n1\tRelokasi 2 Unit GTG\t27/10/2025\t15/12/2026\n1.1\tProject Award\t27/10/2025\t27/10/2025'
                      }
                      className="h-40 w-full resize-y rounded-lg border bg-background p-2.5 font-mono text-[11px] leading-relaxed outline-none focus:border-foreground"
                    />

                    {preview && (
                      <div className="animate-fade-in-up mt-3 space-y-3">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-muted p-2.5 text-[11px]">
                          <span className="flex items-baseline gap-1.5">
                            <strong className="text-sm font-semibold tabular-nums">
                              {preview.count}
                            </strong>
                            rows
                          </span>
                          <span className="flex items-baseline gap-1.5 text-muted-foreground">
                            <strong className="tabular-nums text-foreground">
                              {preview.withDates}
                            </strong>
                            with dates
                          </span>
                          <span className="flex items-baseline gap-1.5 text-muted-foreground">
                            <strong className="tabular-nums text-foreground">
                              {preview.withPrices}
                            </strong>
                            priced
                          </span>
                          {preview.milestones > 0 && (
                            <span className="flex items-baseline gap-1.5 text-muted-foreground">
                              <strong className="tabular-nums text-foreground">
                                {preview.milestones}
                              </strong>
                              milestones
                            </span>
                          )}
                        </div>

                        {/* Every guess, said out loud. The parser cannot know
                            whether 03/04 is April or March, and a person can. */}
                        {preview.notes.length > 0 && (
                          <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                            {preview.notes.map((n) => (
                              <li key={n} className="flex gap-1.5">
                                <span aria-hidden>·</span>
                                {n}
                              </li>
                            ))}
                          </ul>
                        )}

                        {preview.skipped.length > 0 && (
                          <div className="rounded-lg bg-warn/10 p-2.5 text-[11px] text-warn">
                            <p className="flex items-center gap-1.5 font-medium">
                              <TriangleAlert className="size-3.5" />
                              Skipped, because there was no name
                            </p>
                            <ul className="mt-1 space-y-0.5 font-mono">
                              {preview.skipped.map((s) => (
                                <li key={s.line}>
                                  line {s.line}: {s.text || '(blank)'}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            First rows
                          </p>
                          <div className="mt-1 overflow-hidden rounded-lg border">
                            {preview.sample.map((r, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 border-b px-2.5 py-1.5 text-[11px] last:border-b-0"
                              >
                                <span
                                  className="min-w-0 flex-1 truncate font-medium"
                                  style={{ paddingLeft: r.depth * 14 }}
                                >
                                  {r.depth > 0 && (
                                    <CornerDownRight
                                      aria-hidden
                                      className="mr-1 inline size-3 text-muted-foreground"
                                    />
                                  )}
                                  {r.name}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {r.start ?? '—'}
                                </span>
                              </div>
                            ))}
                            {preview.count > preview.sample.length && (
                              <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
                                and {preview.count - preview.sample.length} more
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <p className="animate-fade-in-up mt-3 text-xs text-destructive">{error}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2 border-t p-4">
                    {preview ? (
                      <button
                        type="button"
                        onClick={insert}
                        disabled={pending}
                        className="btn-primary h-11 flex-1 rounded-lg text-sm font-medium"
                      >
                        {pending
                          ? 'Inserting…'
                          : afterLabel
                            ? `Insert ${preview.count} rows after “${afterLabel.slice(0, 22)}”`
                            : `Insert ${preview.count} rows at the end`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={look}
                        disabled={pending || text.trim() === ''}
                        className="btn-primary h-11 flex-1 rounded-lg text-sm font-medium"
                      >
                        {pending ? 'Reading…' : 'Read it'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={close}
                      disabled={pending}
                      className="h-11 rounded-lg border px-4 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </m.div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

export { ClipboardPaste };
