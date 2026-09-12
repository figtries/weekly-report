'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import { Plus } from 'lucide-react';

import { MOTION } from '@/lib/design';
import { createProjectAction } from '@/lib/project-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NativeSelect from '@/components/ui/NativeSelect';
import Spinner from '@/components/ui/Spinner';
import DateField from '@/components/ui/DateField';
import MoneyInput from '@/components/ui/MoneyInput';
import { CURRENCIES } from '@/lib/currency';
import { INITIAL_LENGTH, deriveInitial } from '@/lib/initial';

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
  const [alias, setAlias] = useState('');
  const [client, setClient] = useState('');
  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');
  const [value, setValue] = useState('');
  // Bumped by reset(), which is how MoneyInput is told to clear itself.
  const [valueSeed, setValueSeed] = useState(0);
  const [currency, setCurrency] = useState('IDR');
  const [error, setError] = useState<string | null>(null);
  /** The row exists; what is left is the navigation to its page. */
  const [opening, setOpening] = useState(false);

  // Portalled for the same reason ProjectDetails is: this button sits inside a
  // header carrying `.animate-enter`, and a transform left behind by that
  // keyframe makes `position: fixed` resolve against the header instead of the
  // viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ready = name.trim() !== '' && start !== '' && finish !== '';

  function reset() {
    setName('');
    setAlias('');
    setClient('');
    setStart('');
    setFinish('');
    setValue('');
    setValueSeed((n) => n + 1);
    setError(null);
  }

  /**
   * The dialog stays up until the project's own page has taken the screen.
   *
   * It used to close the moment the row was written and push afterwards, which
   * left the projects list sitting there apparently ignoring the click for as
   * long as the planner took to render — seconds on a cold lambda. Nothing had
   * hung; there was simply nothing on screen saying so. The transition covers
   * BOTH the write and the navigation, so the button can say which of the two
   * it is on, and this component unmounts with the page it is part of.
   */
  function create() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createProjectAction({
        name,
        alias,
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
      setOpening(true);
      created.current = true;
      router.push(`/projects/${res.id}`);
    });
  }

  // Same reason as NewDailyButton: it stays up for the whole trip, then closes
  // once the transition (action AND navigation) is finished, so coming back to
  // the project list never finds the "New project" form still standing.
  const created = useRef(false);
  useEffect(() => {
    if (pending || !created.current) return;
    created.current = false;
    setOpening(false);
    setOpen(false);
    reset();
  }, [pending]);

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

                    {/* The guess is the PLACEHOLDER, not the value. Pre-filling
                        the input would mean anyone who edits the name
                        afterwards keeps an initial derived from the name they
                        abandoned, with nothing on screen saying so. As a
                        placeholder it follows the name until somebody types
                        over it, and after that it never interferes again.

                        Uppercased as you type, and three characters wide rather
                        than full width: the field's own size is what says three
                        letters, before anyone reads the sentence under it. */}
                    <div className="space-y-1">
                      <Label htmlFor="np-initial">Project initial</Label>
                      <Input
                        id="np-initial"
                        value={alias}
                        onChange={(e) => setAlias(e.target.value.toUpperCase())}
                        placeholder={deriveInitial(name) || 'ABC'}
                        maxLength={INITIAL_LENGTH}
                        inputMode="text"
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                        className="h-11 w-24 text-center text-base font-semibold uppercase tracking-[0.2em]"
                      />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Three letters, used wherever the full name will not fit. Leave it blank and
                        we use the one shown here.
                      </p>
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
                        <NativeSelect
                          id="np-cur"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code}
                            </option>
                          ))}
                        </NativeSelect>
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
                    <Button
                      className="h-11 flex-1 gap-1.5"
                      onClick={create}
                      disabled={pending || !ready}
                    >
                      {pending && <Spinner />}
                      {opening ? 'Opening the project…' : pending ? 'Creating…' : 'Create project'}
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
                  {/* Said in words as well as in the button, because what the
                      wait is FOR is the part that was missing: the project is
                      already made by this point. */}
                  {opening && (
                    <p role="status" className="animate-fade-in mt-2 text-center text-[11px] text-muted-foreground">
                      Made. Setting up its work breakdown and schedule…
                    </p>
                  )}
                </m.div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
