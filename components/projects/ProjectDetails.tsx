'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import { Check, Pencil } from 'lucide-react';

import { MOTION } from '@/lib/design';
import { formatMoney } from '@/lib/currency';
import { updateProjectFieldAction, type ProjectField } from '@/lib/project-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import MoneyInput from '@/components/ui/MoneyInput';
import { Label } from '@/components/ui/label';

/**
 * Everything a project is, apart from its plan.
 *
 * None of these fields had a way in. `updateProjectFieldAction` was written,
 * exported and never called from anywhere — so a project made in this app could
 * not be given a contractor, a contract number, a site or a document-number
 * prefix, and Document Control cannot number a single drawing without that last
 * one.
 *
 * The contract value sits here because it is SIGNED, not derived. Deriving it
 * from the prices forced the signed figure and the allocated one to be equal by
 * construction, which deleted the gap between them — the number that says how
 * much of the contract still has no price against it.
 *
 * Motion comes from `MOTION` in lib/design.ts: `duration` for a reply the user
 * just asked for, `ease` for the curve. Nothing here invents its own numbers.
 */

interface Project {
  id: string;
  name: string;
  clientName: string | null;
  contractorName: string | null;
  contractNo: string | null;
  workLocation: string | null;
  docNoPrefix: string | null;
  contractValue: number | null;
  currency: string;
  startDate: string | null;
  finishDate: string | null;
}

const FIELDS: {
  key: ProjectField;
  label: string;
  hint?: string;
  type?: 'text' | 'date' | 'number';
}[] = [
  { key: 'name', label: 'Project name' },
  { key: 'clientName', label: 'Client', hint: 'Who the work is for' },
  { key: 'contractorName', label: 'Contractor', hint: 'Who signs for the work' },
  { key: 'contractNo', label: 'Contract number', hint: 'Several SPK numbers can share one line' },
  { key: 'workLocation', label: 'Work location' },
  {
    key: 'docNoPrefix',
    label: 'Document number prefix',
    hint: 'Document Control builds every drawing number from this — e.g. PRGG-00-G0',
  },
  { key: 'contractValue', label: 'Contract value', type: 'number', hint: 'The signed figure' },
  { key: 'startDate', label: 'Starts', type: 'date' },
  { key: 'finishDate', label: 'Finishes', type: 'date' },
];

export default function ProjectDetails({ project }: { project: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProjectField | null>(null);

  // The overlay is PORTALLED to the body, and that is a bug fix rather than a
  // preference. This button sits inside the page header, which carries
  // `.animate-enter` — a keyframe that leaves a translateY behind when it
  // finishes. A transform on ANY ancestor makes `position: fixed` resolve
  // against that ancestor instead of the viewport, and the panel opened 333px
  // above the top of the screen with its first two fields unreachable.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const valueOf = (k: ProjectField): string => {
    const v = project[k as keyof Project];
    if (v == null) return '';
    return String(v);
  };

  // Saved on blur, one field at a time. A form with a Save button would mean
  // losing everything typed if one value is rejected, and every other surface in
  // this app already commits per field.
  const commit = (field: ProjectField, next: string) => {
    if (next === valueOf(field)) return;
    setError(null);
    startTransition(async () => {
      const res = await updateProjectFieldAction(project.id, field, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(field);
      window.setTimeout(() => setSaved(null), 1400);
      router.refresh();
    });
  };

  return (
    <>
      <m.button
        type="button"
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: MOTION.duration, ease: MOTION.ease }}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <Pencil className="size-3.5" />
        Details
      </m.button>

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
                onClick={() => setOpen(false)}
              >
                <m.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: MOTION.enter, ease: MOTION.ease }}
                  className="max-h-[88vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 className="text-sm font-semibold">Project details</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Saved as you leave each field. The contract value is the signed figure — what
                    the prices in the sheet add up to is shown against it on the project page.
                  </p>

                  <div className="mt-3 space-y-3">
                    {FIELDS.map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label htmlFor={`pd-${f.key}`} className="flex items-center gap-1.5">
                          {f.label}
                          {f.key === 'contractValue' && (
                            <span className="text-[10px] font-normal text-muted-foreground">
                              {project.currency}
                            </span>
                          )}
                          <AnimatePresence>
                            {saved === f.key && (
                              <m.span
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.duration, ease: MOTION.ease }}
                                className="flex items-center gap-0.5 text-[10px] font-medium text-ok"
                              >
                                <Check className="size-3" />
                                Saved
                              </m.span>
                            )}
                          </AnimatePresence>
                        </Label>
                        {/* The contract value is the one field that groups as
                            it is typed: ten raw digits are unreadable, and the
                            same figure is printed under it a moment later. */}
                        {f.type === 'number' ? (
                          <MoneyInput
                            id={`pd-${f.key}`}
                            defaultValue={valueOf(f.key)}
                            resetKey={valueOf(f.key)}
                            disabled={pending}
                            onCommit={(raw) => commit(f.key, raw)}
                            className="h-11 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
                          />
                        ) : (
                          <Input
                            id={`pd-${f.key}`}
                            type={f.type === 'date' ? 'date' : 'text'}
                            defaultValue={valueOf(f.key)}
                            disabled={pending}
                            onBlur={(e) => commit(f.key, e.target.value)}
                            className="h-11"
                          />
                        )}
                        {/* The value field keeps its raw digits — 5920000.006405001
                            is what was signed and rounding it in the box would
                            commit the rounding on the next keystroke. The readable
                            form goes under it instead, stated once. */}
                        {f.key === 'contractValue' && project.contractValue ? (
                          <p className="text-[11px] text-muted-foreground">
                            Reads as{' '}
                            <strong className="font-medium text-foreground tabular-nums">
                              {formatMoney(project.contractValue, project.currency)}
                            </strong>
                          </p>
                        ) : (
                          f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 rounded-lg bg-muted p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    The currency is changed on the project page, next to the contract figure. It
                    relabels — it never converts.
                  </p>

                  {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

                  <Button className="mt-4 h-11 w-full" onClick={() => setOpen(false)}>
                    Done
                  </Button>
                </m.div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

