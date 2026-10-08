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
import { FIELDS as ENERGY_FIELDS } from '@/lib/fields';

/** Every control's size: one height, one type size, Input's own corner. */
const CONTROL = 'h-11 text-base md:text-sm';
/** What Input and NativeSelect draw for themselves, for the two that do not.
 *  The border colour is left to `tone`, so a missing field can turn it red. */
const BOX =
  'w-full min-w-0 rounded-lg border bg-transparent px-2.5 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** What Create asks for before it writes, in the order the form asks it. */
const REQUIRED = [
  { key: 'name', id: 'np-name', label: 'project name' },
  { key: 'field', id: 'np-field', label: 'field' },
  { key: 'value', id: 'np-value', label: 'contract value' },
  { key: 'start', id: 'np-start', label: 'start date' },
  { key: 'finish', id: 'np-finish', label: 'finish date' },
] as const;

/** "a", "a and b", "a, b and c". */
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * One screen, one Save — not a wizard.
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
 * still has nothing priced against it. Since 8 Oct 2026 it is REQUIRED, with
 * the name, the field and both dates: Create marks whatever is missing red,
 * names it, and takes the cursor there; nothing is red before that press.
 *
 * The client and the contractor are asked, not required. Everything else —
 * contract numbers, site, document prefix — belongs to the project's own page,
 * where there is a project to hang it on.
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
  const [field, setField] = useState(ENERGY_FIELDS[0].id);
  const [client, setClient] = useState('');
  const [contractor, setContractor] = useState('');
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

  // Red only after Create was pressed, and each box clears the moment it is filled.
  const [tried, setTried] = useState(false);
  const missing: Record<(typeof REQUIRED)[number]['key'], boolean> = {
    name: name.trim() === '',
    field: field === '',
    value: !(Number(value.replace(/[^0-9.]/g, '')) > 0),
    start: start === '',
    finish: finish === '',
  };
  const gaps = tried ? REQUIRED.filter((r) => missing[r.key]) : [];
  const bad = (key: keyof typeof missing) => tried && missing[key];
  /** Border colour for the two controls that do not read `aria-invalid`. */
  const tone = (key: keyof typeof missing) =>
    bad(key) ? 'border-destructive ring-3 ring-destructive/20' : 'border-input';

  function reset() {
    setName('');
    setAlias('');
    setClient('');
    setContractor('');
    setTried(false);
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
    setTried(true);
    const first = REQUIRED.find((r) => missing[r.key]);
    if (first) {
      document.getElementById(first.id)?.focus();
      return;
    }
    startTransition(async () => {
      const res = await createProjectAction({
        name,
        alias,
        field,
        clientName: client,
        contractorName: contractor,
        startDate: start,
        finishDate: finish,
        contractValue: Number(value.replace(/[^0-9.]/g, '')),
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
                  className="max-h-[88vh] w-full overflow-auto rounded-t-2xl border bg-card px-5 py-5 shadow-lg sm:max-w-md sm:rounded-2xl sm:px-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 className="text-[17px] font-semibold">New project</h2>

                  {/* ONE even grid: the name across the top, then every
                      control in two equal columns, each the same 44px box with
                      the same corner. Fields that each sized themselves read
                      as four forms in one (8 Oct 2026). */}
                  <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="np-name">Project name</Label>
                      <Input
                        id="np-name"
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. GTG relocation"
                        aria-invalid={bad('name') || undefined}
                        className={CONTROL}
                      />
                    </div>

                    {/* The guess is the PLACEHOLDER, not the value. Pre-filling
                        the input would mean anyone who edits the name
                        afterwards keeps an initial derived from the name they
                        abandoned, with nothing on screen saying so. As a
                        placeholder it follows the name until somebody types
                        over it, and after that it never interferes again.
                        Uppercased as you type; maxLength holds it to three. */}
                    <div className="space-y-1.5">
                      <Label htmlFor="np-initial">Initial</Label>
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
                        className={`${CONTROL} font-semibold uppercase tracking-[0.2em]`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="np-field">Field</Label>
                      <NativeSelect
                        id="np-field"
                        value={field}
                        onChange={(e) => setField(e.target.value)}
                        aria-invalid={bad('field') || undefined}
                        className={CONTROL}
                      >
                        {ENERGY_FIELDS.map((fd) => (
                          <option key={fd.id} value={fd.id} title={fd.help}>
                            {fd.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="np-client">Client</Label>
                      <Input
                        id="np-client"
                        value={client}
                        onChange={(e) => setClient(e.target.value)}
                        placeholder="Company name"
                        className={CONTROL}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="np-contractor">Contractor</Label>
                      <Input
                        id="np-contractor"
                        value={contractor}
                        onChange={(e) => setContractor(e.target.value)}
                        placeholder="Company name"
                        className={CONTROL}
                      />
                    </div>

                    {/* The signed figure, asked here because the contract exists
                        before the plan does. ONE box across both columns, the
                        currency its first segment: a figure and its unit are
                        read together, and as two boxes the currency stood
                        alone half the width of the form. */}
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="np-value">Contract value</Label>
                      <div
                        className={`flex h-11 overflow-hidden rounded-lg border transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 ${tone('value')}`}
                      >
                        <NativeSelect
                          id="np-cur"
                          aria-label="Currency"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          wrapperClassName="w-[5.25rem] shrink-0"
                          className="h-full min-h-0 rounded-none border-0 border-r border-input bg-muted text-base font-medium focus-visible:ring-0 sm:min-h-0 md:text-sm"
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code}
                            </option>
                          ))}
                        </NativeSelect>
                        <MoneyInput
                          id="np-value"
                          resetKey={valueSeed}
                          onValueChange={setValue}
                          placeholder="Signed value"
                          className="h-full min-w-0 flex-1 bg-transparent px-3 text-base tabular-nums outline-none placeholder:text-muted-foreground md:text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="np-start">Starts</Label>
                      <DateField
                        id="np-start"
                        value={start}
                        onChange={setStart}
                        className={`${CONTROL} ${BOX} ${tone('start')}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="np-finish">Finishes</Label>
                      <DateField
                        id="np-finish"
                        value={finish}
                        onChange={setFinish}
                        className={`${CONTROL} ${BOX} ${tone('finish')}`}
                      />
                    </div>
                  </div>

                  {(gaps.length > 0 || error) && (
                    <p role="alert" className="animate-fade-in-up mt-4 text-sm text-destructive">
                      {gaps.length > 0
                        ? `Fill in the ${listOf(gaps.map((g) => g.label))} to create the project.`
                        : error}
                    </p>
                  )}

                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => {
                        reset();
                        setOpen(false);
                      }}
                      disabled={pending}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="h-11 gap-1.5"
                      onClick={create}
                      disabled={pending}
                    >
                      {pending && <Spinner />}
                      {opening ? 'Opening the project…' : pending ? 'Creating…' : 'Create project'}
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
