'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import { Plus } from 'lucide-react';

import { MOTION } from '@/lib/design';
import { createProjectAction } from '@/lib/project-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DateField from '@/components/ui/DateField';
import MoneyInput from '@/components/ui/MoneyInput';
import { CURRENCIES } from '@/lib/currency';

/**
 * Six fields, one screen, one Save — not a wizard.
 *
 * The old flow asked for a name and dropped you into a five-step setup. What it
 * produced was a dead row: a project with no dates has no weeks, and a project
 * with no weeks cannot be opened into anything. Dates are the difference
 * between a project that exists and one that merely has a name, so they are
 * asked here and nothing else is.
 *
 * The finish date is asked for too, and that is the point of it: the schedule
 * gets a span before the first row is typed, so the Gantt has a shape to draw
 * against instead of growing out of nothing.
 *
 * The contract VALUE is asked here too, and that is decision ②: a contract is
 * signed before a single WBS row exists. Deriving it later from whatever prices
 * happen to have been typed forced signed and allocated to be equal, which
 * deleted the gap between them — the number that says how much of the contract
 * still has nothing priced against it. It stays optional, because someone
 * scheduling before the award should not be stopped at the door.
 *
 * Everything else — contractor, contract numbers, site, document prefix —
 * belongs to the project's own page, where there is a project to hang it on.
 *
 * It is an OVERLAY, portalled to the body, not a card that unfolds inside the
 * page header. Inline, the open form set the header row's height and left a
 * screen-tall hole between the title and the list. The overlay is also the shape
 * every other panel in this section already has — RowMenu, ValueStrip,
 * CurrencyPicker, ProjectDetails — a sheet from the bottom on a phone, a centred
 * card on a desktop.
 */
export default function NewProjectDialog() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');
  const [value, setValue] = useState('');
  // Bumped by reset(), which is how MoneyInput is told to clear itself.
  const [valueSeed, setValueSeed] = useState(0);
  const [currency, setCurrency] = useState('IDR');
  const [error, setError] = useState<string | null>(null);

  // Portalled for the same reason ProjectDetails is: this button sits inside a
  // header carrying `.animate-enter`, and a transform left behind by that
  // keyframe makes `position: fixed` resolve against the header instead of the
  // viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ready = name.trim() !== '' && start !== '' && finish !== '';

  function reset() {
    setName('');
    setClient('');
    setStart('');
    setFinish('');
    setValue('');
    setValueSeed((n) => n + 1);
    setError(null);
  }

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createProjectAction({
        name,
        clientName: client,
        startDate: start,
        finishDate: finish,
        contractValue: value.trim() === '' ? null : Number(value.replace(/[^0-9.]/g, '')),
        currency,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      setOpen(false);
      router.push(`/projects/${res.id}`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-11 gap-1.5 self-start">
        <Plus className="size-4" />
        New project
      </Button>

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
                onClick={() => !pending && setOpen(false)}
              >
                <m.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: MOTION.enter, ease: MOTION.ease }}
                  className="max-h-[88vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 className="text-sm font-semibold">New project</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    The work breakdown, the prices and the schedule come next, on the
                    project&apos;s own page.
                  </p>

                  <div className="mt-3 space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="np-name">Project name</Label>
                      <Input
                        id="np-name"
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Relocation of 2 GTG units"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="np-client">Client</Label>
                      <Input
                        id="np-client"
                        value={client}
                        onChange={(e) => setClient(e.target.value)}
                        placeholder="Who the work is for"
                        className="h-11"
                      />
                    </div>

                    {/* The signed figure, asked here because the contract exists
                        before the plan does. Optional: someone starting a
                        schedule before the award should not be stopped at the
                        door. */}
                    <div className="grid grid-cols-[1fr_5.5rem] gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="np-value">Contract value</Label>
                        <MoneyInput
                          id="np-value"
                          resetKey={valueSeed}
                          onValueChange={setValue}
                          placeholder="Not signed yet? Leave it"
                          className="h-11 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="np-cur">Currency</Label>
                        <select
                          id="np-cur"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          className="h-11 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-foreground"
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="np-start">Starts</Label>
                        <DateField
                          id="np-start"
                          value={start}
                          onChange={setStart}
                          className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="np-finish">Finishes</Label>
                        <DateField
                          id="np-finish"
                          value={finish}
                          onChange={setFinish}
                          className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm shadow-xs transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {error && (
                    <p className="animate-fade-in-up mt-2 text-xs text-destructive">{error}</p>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button className="h-11 flex-1" onClick={create} disabled={pending || !ready}>
                      {pending ? 'Creating…' : 'Create project'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11"
                      onClick={() => {
                        reset();
                        setOpen(false);
                      }}
                      disabled={pending}
                    >
                      Cancel
                    </Button>
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
