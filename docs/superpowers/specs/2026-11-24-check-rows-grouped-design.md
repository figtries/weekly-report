# Check rows name their mother — 24 Nov 2026

Small change. Short design.

## Intent

A finding on `/weekly/[week]/control` lists the activities that failed it. Each
row is a name plus a one-line trail of its last two ancestors. On a real plan
that trail is not enough to say where the row sits, and the user said so:
"backend backend dari mana, selalu kaitkan dengan mothernya."

Three things are wrong today, all in `trailIndex` (`lib/analysis.ts:423`) and
`CheckRow` (`components/weekly/WeekChecks.tsx:31`):

1. **The root is dropped unconditionally** (`trail.slice(1)`). An activity whose
   only ancestor IS the project gets an empty trail, so "Backend" prints bare
   while the row under it prints "Backend". The same word reads as two
   different things on one screen.
2. **Only the last two ancestors survive** (`.slice(-2)`). Deeper than that and
   the chain is cut with nothing saying it was cut.
3. **The trail repeats per row.** Three activities under one heading print that
   heading three times, in muted 11px text that this user reads as absent.

The two link checks (`lib/analysis.ts:815` and `:828`, "starts before what it
waits for" and "A link loops back") carry no trail at all — they build rows from
a `names` map instead of `trails`.

## Goals

- Every row on Check says where it sits, down from the project.
- A reader is never shown a chain that was silently cut.
- The list gets SHORTER as the plan gets deeper, not longer. This is the
  constraint the user raised himself: "pasti rame juga karena banyak cabang,
  gmn biar g penuh bgt."

## Non-goals

- No change to which activities a check reports, or to any figure.
- No change to the four weekly tabs, the week row, or the gate card above the
  checks.
- Group headings are not pressable. Links join activities, not headings.

## Anti-goal

A screen that reads as a spreadsheet: a column of indented codes, or a
breadcrumb so long it pushes the figure off a 390px phone.

## Approaches

**A · Full path on every row, middle elided.** `FRB › … › Backend` under each
name. Smallest diff. Rejected: the repetition stays, and every row grows a line,
so the list gets longer exactly when there are many branches.

**B · Group the rows under their mother.** The mother is stated once as a
heading, its activities listed beneath it. **Chosen.** It is the only one of the
three that shrinks as branches multiply, and the mother becomes a real line
rather than a grey caption.

**C · WBS number in front of the name.** `1.2.3 Payment Gateway`. Full position
in six characters at any depth. Rejected: a number is not a name — a reader
still has to open the row to learn which package it belongs to — and a column of
codes is the spreadsheet look the product replaces.

The user picked B.

## What gets built

### The trail becomes the whole chain

`trailIndex` returns the full ancestor chain joined with ` › `. The outermost
ancestor is dropped ONLY when the plan has one top row (then it is the project,
identical on every row); a plan with several roots keeps it, because there the
first segment is that row's own contract. The root is also kept when it is the
only ancestor:


```
Relocation › Lucille Online Real Time
Relocation › Backend
Figtries Road to 3 Billion            // an activity hanging off the root
```

It also indexes every node it walks, not only leaves, so the two link checks can
read it.

### Rows are grouped by that chain

`CheckRow` groups `f.rows` by `trail`. Group order is the order its first member
appears in the list, so a check that already sorts worst-first keeps its worst
group at the top; row order inside a group is untouched. A row with no trail at
all (an id the tree does not know) falls into one unheaded group at the end.

```
┌ Relocation › Lucille Online Real Time
│    Server                              100.00% behind  ›
│    Database                            100.00% behind  ›
│    Installation                        100.00% behind  ›
├ Relocation › Backend
│    Backend                              33.33% behind  ›
│    Payment Gateway                     100.00% behind  ›
└
```

The heading is 12px semibold on the muted ground, not 11px muted text: a quiet
line reads as missing to this user.

### A deep chain elides its middle, visibly

Three segments or fewer print whole. More, and the middle becomes `…`, keeping
the first and the last two: `A › … › Y › Z`. Truncation is never left to CSS
alone, because an ellipsis the browser draws looks the same as a name that
happens to end there, and nothing may live only in a tooltip.

### The cap still counts ROWS

The existing CSS-checkbox "Show N more" stays, and it keeps counting activities,
not headings: six activities are visible, a heading whose activities are all
beyond the cap is hidden with them, and the label still reads `Show N more` with
N the number of hidden activities.

## Left to the builder

- Where the heading sits relative to the existing `divide-y`: the group is one
  block, and a heading must not read as a pressable row.
- Whether the grouping helper lives in `WeekChecks.tsx` or beside `Finding` in
  `lib/analysis.ts`. It is display shaping, so the component is the default.

## Proof

`scripts/` has no Check-specific verifier. One check, the smallest that fails if
the logic breaks: a unit assertion that grouping a row list preserves every row
exactly once and keeps the original order within each group, plus a 390px and a
desktop shot of `/weekly/9/control` read with `scripts/shoot.mjs`.
