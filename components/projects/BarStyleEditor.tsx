'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { MOTION } from '@/lib/design';
import {
  CONDITIONS,
  PAINTS,
  SHAPES,
  type BarCondition,
  type BarPaint,
  type BarShape,
  type BarStyle,
} from '@/lib/bar-styles';
import {
  addBarStyleAction,
  deleteBarStyleAction,
  moveBarStyleAction,
  resetBarStylesAction,
  updateBarStyleAction,
} from '@/lib/bar-style-actions';
import { paintSwatch } from './GanttChart';

/**
 * The rule list, as a list.
 *
 * The ORDER is the interface. A rule is read as a sentence — *"past its target
 * date → amber, hatched"* — and the first one that describes a bar is the one
 * that draws it, so moving a rule up is how a planner says lateness matters more
 * than packages. Nothing here explains that in a paragraph; the arrows and the
 * numbering say it.
 *
 * **Native `<select>`, not Radix.** The repo's standing rule is Radix per screen
 * and never per row, and this is a `.map()` with three selects in it. It is also
 * the better answer on a phone, where the OS wheel beats any menu we can draw.
 *
 * `Critical` is not offered. It needs the chain engine, and a rule that can
 * never fire looks like a rule that simply never matched.
 */
export default function BarStyleEditor({
  projectId,
  styles,
  customised,
  units,
  onChanged,
  open,
  onClose,
}: {
  projectId: string;
  styles: BarStyle[];
  /** False while the project is still reading through the defaults. */
  customised: boolean;
  /** Reporting units, for the "inside a package" condition. */
  units: { id: string; name: string }[];
  onChanged: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong');
        return;
      }
      onChanged();
    });
  };

  const patch = (id: string, p: Parameters<typeof updateBarStyleAction>[2]) =>
    run(() => updateBarStyleAction(projectId, id, p));

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: MOTION.duration, ease: MOTION.ease }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
          onClick={() => !pending && onClose()}
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
              <h2 className="text-sm font-semibold">Bar styles</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Each line says how a bar is drawn when it fits. The app reads down the list and
                stops at the first line that fits, so a rule higher up wins — put lateness above
                packages if lateness is what you want to see first.
              </p>
              {!customised && (
                <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
                  This project is using the standard list. Changing anything makes it its own.
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
              {styles.map((s, i) => {
                const cond = CONDITIONS.find((c) => c.key === s.condition);
                return (
                  <div
                    key={s.id}
                    className={`rounded-xl border p-2.5 transition-opacity ${
                      s.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <input
                        defaultValue={s.label}
                        onBlur={(e) =>
                          e.target.value.trim() !== s.label && patch(s.id, { label: e.target.value })
                        }
                        className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm font-medium outline-none focus:border-foreground"
                      />
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        onClick={() => run(() => moveBarStyleAction(projectId, s.id, 'up'))}
                        aria-label="Move up"
                        className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-muted disabled:opacity-30"
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === styles.length - 1}
                        onClick={() => run(() => moveBarStyleAction(projectId, s.id, 'down'))}
                        aria-label="Move down"
                        className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-muted disabled:opacity-30"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteBarStyleAction(projectId, s.id))}
                        aria-label="Delete rule"
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-30"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label="When">
                        <select
                          value={s.condition}
                          onChange={(e) =>
                            patch(s.id, {
                              condition: e.target.value as BarCondition,
                              conditionValue: null,
                            })
                          }
                          className="h-11 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-foreground"
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      {cond?.takes === 'unit' && (
                        <Field label="Package">
                          <select
                            value={s.conditionValue ?? ''}
                            onChange={(e) => patch(s.id, { conditionValue: e.target.value || null })}
                            className="h-11 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-foreground"
                          >
                            <option value="">Pick one…</option>
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      {cond?.takes === 'percent' && (
                        <Field label="Per cent">
                          <input
                            inputMode="decimal"
                            defaultValue={s.conditionValue ?? ''}
                            onBlur={(e) =>
                              e.target.value !== (s.conditionValue ?? '') &&
                              patch(s.id, { conditionValue: e.target.value || null })
                            }
                            className="h-11 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-foreground"
                          />
                        </Field>
                      )}

                      <Field label="Colour">
                        <div className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="size-3 shrink-0 rounded-[2px]"
                            style={{ background: paintSwatch(s.paint) }}
                          />
                          <select
                            value={s.paint}
                            onChange={(e) => patch(s.id, { paint: e.target.value as BarPaint })}
                            className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs outline-none focus:border-foreground"
                          >
                            {PAINTS.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </Field>

                      <Field label="Shape">
                        <select
                          value={s.shape}
                          onChange={(e) => patch(s.id, { shape: e.target.value as BarShape })}
                          className="h-11 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-foreground"
                        >
                          {SHAPES.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Check
                        checked={s.hatched}
                        onChange={(v) => patch(s.id, { hatched: v })}
                        label="Hatch the days past the target"
                      />
                      <Check
                        checked={s.enabled}
                        onChange={(v) => patch(s.id, { enabled: v })}
                        label="On"
                      />
                      {cond && (
                        <span className="text-[11px] text-muted-foreground">{cond.help}</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {error && <p className="animate-fade-in-up text-xs text-destructive">{error}</p>}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => addBarStyleAction(projectId))}
                className="flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
              >
                <Plus className="size-4" />
                Add a rule
              </button>
              {customised && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => resetBarStylesAction(projectId))}
                  className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <RotateCcw className="size-4" />
                  Back to standard
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="ml-auto h-11 rounded-lg bg-foreground px-5 text-sm font-medium text-background"
              >
                Done
              </button>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-muted-foreground">
      {label}
      <span className="mt-0.5 block">{children}</span>
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex h-9 items-center gap-1.5 text-[11px] font-medium">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-foreground"
      />
      {label}
    </label>
  );
}
