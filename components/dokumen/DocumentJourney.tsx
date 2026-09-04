'use client';

import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

import { MOTION } from '@/lib/design';
import { STAGE_FULL, STAGE_LABEL, type DocumentLap } from '@/lib/register-shared';
import { cn } from '@/lib/utils';

/**
 * What has happened to this document: a summary you press, and the trips
 * underneath it.
 *
 * This is the old Log screen, folded onto the document it describes. That
 * screen printed the register as 511 raw events newest-first, so one document's
 * three trips landed as three near-identical cards — same title, same number,
 * same category, differing by one small badge — 173 documents down 54,718
 * pixels of page.
 *
 * The first attempt at folding it went too far the other way: an 11px grey
 * label and three pastel pills, carrying no dates, sitting between the document
 * title and the form. It weighed exactly as much as the stage badges above it,
 * so it read as metadata rather than as content, and someone looking straight
 * at it reported the history missing. Two lessons, both paid for:
 *
 * **A history without dates does not read as a history.** The dates were left
 * out to avoid repeating the stage table below — but that table is a FORM, and
 * reading "when did this go out" off a row of date inputs is work, not a
 * glance. The two now split by job: this reads, the table edits.
 *
 * **It needs a control, not a caption.** The shape is the change-log toggle
 * from `DataOverallWorkbench` — status dot in an 18px slot, summary, chevron
 * that turns — because that one is already the app's answer to "a summary you
 * can open", and a second answer would only be a second thing to learn.
 *
 * One deliberate difference from that control: it opens INLINE on every size,
 * where the weekly one floats over the page on phones. It has to. This sits
 * inside the expanded document row, which clips its own overflow twice over —
 * the row's card and the height-animating wrapper inside it — so an absolutely
 * positioned panel would be cut off rather than float. It costs nothing here:
 * that panel carries sixty log rows and this one carries three trips.
 */

const TONE: Record<DocumentLap['outcome'], string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  returned: 'bg-red-100 text-red-700',
  waiting: 'bg-blue-100 text-blue-700',
  // Deliberately the quietest thing here: a gap in the record is not a finding,
  // and it must not out-shout the stage that is genuinely stuck.
  unrecorded: 'bg-muted text-muted-foreground',
};

/**
 * What happened, in words anybody can read.
 *
 * This panel had been written in the vocabulary of the people who already know
 * it — "3 trips", "still out", "Back 30 Oct", a bare "AWC", a bare "T.001" —
 * and every one of those is a term you have to be told once before it means
 * anything. The register's own codes stay (they are the client's data and the
 * letters are how a document is actually chased), but nothing here is left to
 * an acronym alone.
 *
 * "Returned with comments" is not an invention: `DocumentEditor` states the
 * rule this app runs on — APP closes a stage, anything else means it came back
 * for comment and is still holding construction up.
 */
const OUTCOME_LABEL: Record<DocumentLap['outcome'], string> = {
  approved: 'Approved',
  returned: 'Returned with comments',
  waiting: 'Still with the reviewer',
  unrecorded: 'No reply recorded',
};

/**
 * The title's colour, and the three states it answers.
 *
 * Asked for by name: red when the document is late, emerald when it is
 * through, blue while it is simply running. The colours are the app's existing
 * pairs — the text halves of `TONE` above, which are themselves the summary
 * screens' own — so nothing new enters the palette.
 *
 * LATE WINS OVER DONE, deliberately. A document can have its last round
 * approved and still be past the promised date for the stage after it; saying
 * "finished" in green over a stage nobody has sent yet is the more expensive
 * of the two mistakes.
 *
 * Returned-with-comments counts as late rather than as running, because that
 * is what red already means everywhere else in Document Control — a document
 * that came back for comment is holding construction up, and a colour that
 * changes meaning between two screens is worse than no colour at all.
 */
const TITLE_TONE = {
  late: 'text-red-700',
  done: 'text-emerald-700',
  running: 'text-blue-700',
  idle: 'text-foreground',
} as const;

const shortDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
      })
    : 'no date';

export function DocumentJourney({
  laps,
  overdue,
  returnOpen,
}: {
  laps: DocumentLap[];
  /** Promised by the register's as-of date and still not submitted. */
  overdue: boolean;
  /** Came back with a comment and has not been approved since. */
  returnOpen: boolean;
}) {
  const [open, setOpen] = useState(false);

  const empty = laps.length === 0;
  const latest = laps[laps.length - 1];

  // `returnOpen`, not "the last round came back with comments". The two are
  // not the same and the difference is visible: PRGG-20-E0-DS-001 was returned
  // AWC at IFA, re-issued, and is now sitting at AFC — so its LAST round is
  // merely waiting, while the comment against it has never been closed out.
  // Reading only the last round painted that document blue underneath its own
  // red AWC badge, and inside a group whose card counts it among "7 returned".
  // One document cannot be two colours on one screen.
  const state = empty
    ? 'idle'
    : overdue || returnOpen
      ? 'late'
      : latest.outcome === 'approved'
        ? 'done'
        : 'running';

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={empty}
        aria-expanded={open}
        // ONE LINE, AND THE SAME LEFT EDGE AS THE PANEL BELOW IT.
        //
        // This went through three shapes before landing here, and the two it
        // discarded failed the same way. It carried the standing and a count of
        // rounds across two lines behind a coloured dot in an 18px slot: the dot
        // pushed this card's text to x=80 while the rows in the panel beneath
        // start at x=48, so two stacked cards ran on two different left edges —
        // and a dot set against a two-line block sits level with neither line.
        // Shortening it to the standing alone fixed the edge but left a heading
        // whose words changed from document to document.
        //
        // So: a plain title, on the panel rows' own padding. No dot, no caption,
        // no counts — every round states its own dates one line below.
        //
        // NO `active:scale` either. The weekly control this is modelled on can
        // afford one: it is a single column of a four-column grid, so 2% is a
        // couple of pixels. This spans the whole panel, where the same 2%
        // throws both edges inward by nine — it stops reading as a press and
        // starts reading as the row flinching. A press this wide is better said
        // with colour, which moves nothing.
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm ring-1 ring-foreground/10 transition-[background-color,border-color,box-shadow] duration-200 ease-ios sm:px-5',
          empty ? 'cursor-default' : 'cursor-pointer hover:border-border hover:shadow-md active:bg-muted/50',
        )}
      >
        {/* The words are fixed; the colour is not. Asked for deliberately, so
            the state is readable before the panel is opened. It is the one
            place in this component where a fact is carried by colour alone —
            acceptable only because the same fact is written out twice within
            an inch of it: as a chip on every round inside, and on the document
            row directly above. */}
        <span className={cn('flex-1 text-left text-sm font-semibold', TITLE_TONE[state])}>
          Document History
        </span>

        {empty ? (
          <span className="text-xs text-muted-foreground">Not sent yet</span>
        ) : (
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-ios',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {/* ONE MOTION. THE BOX IS NEVER AHEAD OF WHAT IS IN IT.
          This was briefly built as two speeds — the frame opening on
          `MOTION.duration` and the trips inside arriving on `MOTION.enter`, a
          beat behind, on the theory that opening fast and filling slowly reads
          as unhurried. On screen it reads as broken. `--ease-out-expo` is
          heavily front-loaded, so the card reached FULL HEIGHT within about
          70ms of the press while its first row had barely started moving and
          its last was still 700ms away: you pressed a button and a large empty
          white rectangle appeared. Measured from a CDP screencast, not guessed.

          So the panel and its contents are now one thing, on the app's own
          disclosure transition — the same `{ duration, ease }` the document row
          forty lines up in `RegisterWorkbench` uses to expand. The growing box
          IS the reveal, which is what an accordion is supposed to be, and an
          empty frame becomes impossible by construction rather than by timing.

          The lesson generalises: `design.ts` says the lever is time and
          distance, never the curve — true of opacity and transform, where the
          curve genuinely cannot be seen. It is NOT true of height, where a
          front-loaded curve is the difference between growing and snapping. */}
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
            className="overflow-hidden"
          >
          <div className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-md ring-1 ring-foreground/10">

            {/* Softer rules between the trips: at full strength three dividers
                in an 11rem card cut it into slices, and the panel read as a
                table rather than as one surface. */}
            <div className="divide-y divide-border/60">
              {laps.map((lap) => (
                // No entrance of their own: the box growing over them is the
                // entrance. A second animation here is what let the frame run
                // ahead of its own contents.
                //
                // TWO LINES, AND THE SPLIT IS THE POINT. The first says what
                // this round was and how it ended; the second says when it
                // moved. Everything used to sit on one line, which put a
                // three-word acronym, two dates, two letter numbers and a code
                // in a single ragged row where no two rounds lined up — one
                // round has a return leg and another does not, so the columns
                // never agreed with each other.
                <div key={lap.stage} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* The full name leads, the acronym follows: AGENTS.md's
                        rule for anywhere a stage is the SUBJECT of the line,
                        which here it is. */}
                    <span className="text-sm font-medium">{STAGE_FULL[lap.stage]}</span>
                    <span className="font-mono text-[0.7rem] text-muted-foreground">
                      {STAGE_LABEL[lap.stage]}
                    </span>

                    {/* Its own full-width row on a phone, left-aligned with
                        everything else. Floated right by `ml-auto` it wrapped
                        onto a second line and STAYED pushed right, so a short
                        chip like "No reply recorded" sat marooned in the middle
                        of the card with nothing under it. */}
                    <span className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          TONE[lap.outcome],
                        )}
                      >
                        {OUTCOME_LABEL[lap.outcome]}
                        {/* The client's own code, kept beside the plain words
                            rather than instead of them. */}
                        {lap.returnCode && (
                          <span className="font-mono text-[0.7rem] opacity-70">{lap.returnCode}</span>
                        )}
                      </span>
                      {/* NO DAY COUNT. There was a `23d` / `170d` column here
                          and it has been taken out on purpose: a round already
                          prints the day it went and the day it came back, so a
                          reader who wants the span has both numbers in front of
                          them, and one of the three rounds could never show one
                          at all — an overtaken round's clock belongs to the
                          stage that followed it. A column that is blank on
                          every third row is not a column.

                          `DocumentLap.days` still carries it. `buildJourney`
                          translates stage rows into rounds and that translation
                          stays lossless; what this component chooses to draw is
                          a separate question. */}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    Sent {shortDate(lap.sentAt)}
                    {lap.sentTransmittal && <> on letter <Letter no={lap.sentTransmittal} /></>}
                    {lap.returnedAt && (
                      <>
                        {' · came back '}
                        {shortDate(lap.returnedAt)}
                        {lap.returnTransmittal && <> on letter <Letter no={lap.returnTransmittal} /></>}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>

            {/* The amber footnote that stood here said the day counts were
                estimates. With the counts gone it had nothing to caveat — and
                the admission it carried is not lost, because a round with no
                date reads "Sent no date" on its own line, which says it where
                it happened rather than in a note at the bottom. */}
          </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A transmittal number, labelled.
 *
 * It used to appear as a bare `T.001` next to a date, which tells a reader who
 * has not worked in document control nothing at all. The word "letter" in front
 * of it is the whole fix — that is what a transmittal is.
 */
function Letter({ no }: { no: string }) {
  return <span className="font-mono text-[0.7rem] text-foreground">{no}</span>;
}
