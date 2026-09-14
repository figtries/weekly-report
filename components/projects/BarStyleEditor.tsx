'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowDown, ArrowUp, Check as CheckIcon, Plus, RotateCcw, Trash2, X } from 'lucide-react';

import { MOTION } from '@/lib/design';
import {
  CONDITIONS,
  PAINTS,
  PRESETS,
  SHAPES,
  type BarCondition,
  type BarPaint,
  type BarPreset,
  type BarShape,
  type BarStyle,
} from '@/lib/bar-styles';
import {
  addBarStyleAction,
  customiseBarStylesAction,
  deleteBarStyleAction,
  moveBarStyleAction,
  setBarPresetAction,
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
  source,
  auto,
  pruned,
  units,
  onChanged,
  open,
  onClose,
}: {
  projectId: string;
  styles: BarStyle[];
  /** Which of the three lists this plan is reading. */
  source: 'custom' | BarPreset;
  /** True when nobody chose and the plan picked for itself. */
  auto: boolean;
  /** Rules left out because they could not tell this plan's rows apart. */
  pruned: string[];
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

  /**
   * The list as this dialog is showing it, which is ahead of the server's.
   *
   * Every select here was driven straight off the props, so picking a colour
   * changed nothing on screen until a server action AND the page refresh behind
   * it had both come back — the dropdown sat on its old value for the best part
   * of a second and the whole dialog went disabled while it waited. Reported as
   * "ganti-ganti warnanya ngeleg banget" on 14 Sep 2026.
   *
   * The prop is adopted whenever nothing of ours is in the air. A change the
   * server refuses is therefore put right by the refresh that follows it,
   * without this component having to remember what it looked like before.
   */
  const [local, setLocal] = useState<{ list: BarStyle[]; source: 'custom' | BarPreset }>({
    list: styles,
    source,
  });
  const inFlight = useRef(0);
  useEffect(() => {
    if (inFlight.current === 0) setLocal({ list: styles, source });
  }, [styles, source]);

  /**
   * Structural writes — add, move, delete, and switching lists. They keep the
   * old shape: awaited, and the buttons disabled while they run.
   *
   * That is not laziness. A rule on a list that is still one of the READY-MADE
   * ones has no row of its own yet; `resolveId` on the server finds it by its
   * POSITION in the preset. Reordering or deleting optimistically would leave
   * this dialog holding preset ids whose positions no longer mean what they
   * meant, and the next edit would quietly land on the wrong rule.
   */
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

  /**
   * One rule's fields, drawn at once and sent behind the screen.
   *
   * Serialised rather than fired in parallel: the first edit to a ready-made
   * list COPIES it, and two copies racing is not a thing worth finding out
   * about. `onChanged` waits for the whole burst rather than firing per field,
   * because it costs the sheet a full re-read each time.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const patch = (id: string, p: Parameters<typeof updateBarStyleAction>[2]) => {
    setError(null);
    setLocal((l) => ({
      // Editing a line makes the list this project's own; the server does the
      // same thing, and the choice above should not lag a field below it.
      source: 'custom',
      list: l.list.map((s) => (s.id === id ? { ...s, ...p } : s)),
    }));
    inFlight.current += 1;
    startTransition(async () => {
      const job = chain.current.then(
        () => updateBarStyleAction(projectId, id, p),
        () => updateBarStyleAction(projectId, id, p)
      );
      chain.current = job.then(
        () => undefined,
        () => undefined
      );
      const res = await job.catch(() => ({ ok: false, error: 'Something went wrong' }));
      inFlight.current -= 1;
      if (!res.ok) setError(res.error ?? 'Something went wrong');
      // One refresh for a burst, once the last of it has landed.
      if (inFlight.current === 0) onChanged();
    });
  };

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
          onClick={onClose}
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
              {/* A WAY OUT THAT IS ALWAYS THERE.
                  Done at the foot of a list this long is below the fold on a
                  phone, and the backdrop is a target you have to know about.
                  There is nothing to cancel — every line is saved as it is
                  changed — so this says Close and not Cancel, and "Let the app
                  choose" at the foot is what undoes a list you regret. */}
              <div className="flex items-start gap-2">
                <h2 className="flex-1 text-sm font-semibold">Bar styles</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                What the colours on the timeline mean. Pick one of the two ready-made answers, or
                write your own list. Everything here is saved as you change it.
              </p>

              {/* The choice comes FIRST, because "why is everything a different
                  colour" is the question people arrive with, and the answer is
                  which of these is switched on — not any single rule below. */}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {PRESETS.map((preset) => (
                  <Choice
                    key={preset.key}
                    active={local.source === preset.key}
                    disabled={pending}
                    title={preset.label}
                    help={preset.help}
                    onClick={() => run(() => setBarPresetAction(projectId, preset.key))}
                  />
                ))}
                <Choice
                  active={local.source === 'custom'}
                  disabled={pending}
                  title="My own rules"
                  help="Start from whichever list is showing and change it line by line."
                  onClick={() => run(() => customiseBarStylesAction(projectId))}
                />
              </div>

              {auto && local.source !== 'custom' && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Chosen from the plan itself:{' '}
                  <strong className="font-medium text-foreground">
                    {source === 'package'
                      ? 'this one has packages, so the colours follow them'
                      : 'this one has no packages yet, so the colours follow what each row is'}
                  </strong>
                  . Mark a second package and it moves across on its own, until you pick one
                  here, and then it stays picked.
                </p>
              )}

              {pruned.length > 0 && (
                <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground">
                  Left out of this plan: <strong className="text-foreground">{pruned.join(', ')}</strong>{' '}
                  because every row would have matched, and a colour every row shares says nothing.
                  It comes back as soon as it separates something.
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
              {local.source !== 'custom' && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Read down the list; the first line that describes a bar is the one that draws it.
                  Changing anything here makes this list the project&apos;s own.
                </p>
              )}
              {local.list.map((s, i) => {
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
                        disabled={pending || i === local.list.length - 1}
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
              {(local.source === 'custom' || !auto) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setBarPresetAction(projectId, null))}
                  className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                  title="Hand the choice back to the app"
                >
                  <RotateCcw className="size-4" />
                  Let the app choose
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="btn-primary ml-auto h-11 rounded-lg px-5 text-sm font-medium"
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

function Choice({
  active,
  disabled,
  title,
  help,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  help: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      aria-pressed={active}
      className={`rounded-xl border p-2.5 text-left transition-colors disabled:opacity-100 ${
        active ? 'border-foreground bg-muted' : 'hover:border-muted-foreground'
      }`}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {active && <CheckIcon className="size-3.5 shrink-0" />}
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{help}</span>
    </button>
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
