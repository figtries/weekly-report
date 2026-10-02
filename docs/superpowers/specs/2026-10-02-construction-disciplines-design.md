# Construction by discipline

Decided 2 Oct 2026 in a brainstorm with the user, from a screenshot of
"Hydrotest Pipeline (4 Sections)" being asked "Material on site" and
"Connections". One Construction ladder (Material on site 15 · Installation 50 ·
Connections 25 · QC inspection 10) is asked of every construction row, so a
hydrotest, a foundation and a cable run are all measured on rungs that do not
exist for them, and the figure a project control engineer reports is an
interpretation rather than a measurement.

The goal is to make the figure SHARPER FOR PROJECT CONTROL without asking
anyone for more input. Counting rungs by quantity (sections, dia-inch, m³) was
built as a mockup and rejected the same day as engineer-level detail. What stays
is the same tick list as today, with three things the app does for PC:

1. the ladder fits the discipline, and every rung says when it is ticked;
2. the plan is read back as a STAGE ("one stage behind"), not only a percent;
3. one check: a rung ticked before the work it waits for is done.

## 1. Nine disciplines

Construction gets a second question, asked only after Construction is pressed.
Nine tiles in a 3 × 3 grid, no empty cell. The user chose nine over twelve; to
keep nine standard for EPC, Electrical and Instrument are one tile (they climb
the same four rungs), tie-ins are piping work, and buildings are civil work.
Painting keeps its own tile because surface protection is its own discipline
with its own ladder; putting it in Other would measure it on the wrong rungs.

No published standard fixes the WEIGHTS. Every EPC contractor measures under a
Progress Measurement Procedure the client approves. What is standard is the
method (ordered, weighted rungs, each with a definition of done) and the
discipline split, and the rung ORDER below matches real progress reports (a
pipeline report runs grading → stringing → ditching → welding → coating →
lowering-in → backfill → tie-ins → cleanup → hydrotest). The weights are
starting points and stay editable per row, as today. A contract that carries its
own procedure wins.

Step ids are prefixed by discipline so a row's discipline can be read from its
own rungs (see §4). "Needs" marks the rung the check in §6 guards.

### Civil (`civil`), icon `BrickWall`
Foundations, roads, drainage, paving, piling, fences, buildings.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `civil-excavate` | Excavated **(Needs)** | 10 | Dug to design level and checked |
| `civil-rebar` | Rebar and formwork | 30 | Rebar and formwork inspected, ready to pour |
| `civil-pour` | Concrete poured | 40 | Pour complete, cubes sampled |
| `civil-finish` | Backfilled and finished | 20 | Formwork stripped, backfilled, area clean |

### Steel (`steel`), icon `Frame`
Pipe racks, shelters, platforms, stairs, handrails.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `steel-erect` | Erected **(Needs)** | 50 | Members set and temporarily bolted |
| `steel-bolt` | Bolted and aligned | 30 | Final bolts torqued, plumb and level checked |
| `steel-touchup` | Touched up and inspected | 20 | Touch-up paint done, QC accepted |

### Mechanical (`mechanical`), icon `Cog`
Vessels, tanks, pumps, compressors, skids, exchangers, generators.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `mech-set` | Set in place **(Needs)** | 50 | On its foundation, anchor bolts in |
| `mech-align` | Aligned and grouted | 30 | Levelled, aligned, grout cured |
| `mech-fit` | Accessories fitted | 10 | Ladders, platforms, internals fitted |
| `mech-boxup` | Boxed up | 10 | Internal inspection signed, manways closed |

### Piping (`piping`), icon: custom pipe elbow (lucide has no pipe)
In-plant piping, spools, headers, fire water networks, tie-ins.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `piping-erect` | Spools erected **(Needs)** | 40 | Spools on supports in position |
| `piping-joint` | Welded or bolted | 30 | Field joints welded, flanges bolted |
| `piping-support` | Supports complete | 15 | Permanent supports, shoes, guides fitted |
| `piping-ndt` | NDT and punch cleared | 15 | NDT accepted, punch A cleared |

The icon is drawn in lucide's own grid and stroke (24 × 24, stroke 2, round
caps): `M4 5h7a9 9 0 0 1 9 9v6`, `M4 11h7a3 3 0 0 1 3 3v6`, `M4 3v10`,
`M12 20h10`. A double-walled elbow with a flange at each end.

### Pipeline (`pipeline`), icon `Route`
Cross-country pipelines, flowlines, trunklines, crossings.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `pipeline-string` | Strung **(Needs)** | 10 | Right of way ready, pipe strung along it |
| `pipeline-weld` | Welded | 30 | Joints welded |
| `pipeline-coat` | NDT and coated | 15 | NDT accepted, field joints coated and holiday tested |
| `pipeline-lower` | Lowered in | 25 | Trenched, lowered in, padded |
| `pipeline-reinstate` | Backfilled and reinstated | 20 | Backfilled, markers set, right of way reinstated |

### E&I (`ei`), icon `Zap`
Electrical and instrument: trays, cables, panels, lighting, earthing,
instruments, tubing, junction boxes, F&G, DCS/ESD panels.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `ei-install` | Installed **(Needs)** | 30 | Tray and conduit run, or instrument mounted |
| `ei-cable` | Cabled or tubed | 35 | Cables pulled and tagged, or impulse tubing run |
| `ei-term` | Terminated | 20 | Both ends glanded and terminated |
| `ei-test` | Tested | 15 | Megger, continuity or calibration recorded |

### Painting (`painting`), icon `PaintRoller`
Painting, coating, insulation, fireproofing.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `paint-prep` | Surface prepared **(Needs)** | 30 | Blasted or cleaned, profile checked |
| `paint-prime` | Primed | 30 | Primer applied, thickness checked |
| `paint-finish` | Finished | 40 | Final coat or insulation done, inspected |

### Testing (`testing`), icon `Gauge`
Hydrotest, pressure, leak and pneumatic tests, pigging, dewatering.

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `test-pack` | Test pack approved | 20 | Client signs the test pack |
| `test-fill` | Filled and pressurized **(Needs)** | 30 | Filled, test pressure reached |
| `test-hold` | Held and witnessed | 30 | Hold time passed, witnessed, report signed |
| `test-drain` | Drained and reinstated | 20 | Drained, dried, reinstated |

The test pack can be approved while the line is still being finished, so the
guarded rung is the second one, not the first.

### Other (`other`), icon `Ellipsis`
Anything that fits none of the above. Its ladder is today's Construction
ladder with today's step ids, unchanged, which is what keeps every row already
filled in exactly as it is (see §4).

| Step id | Rung | Weight | Ticked when |
|---|---|---|---|
| `material` | Material on site **(Needs)** | 15 | Material for this row on site |
| `install` | Installation | 50 | Installed |
| `connect` | Connections | 25 | Connected |
| `qc` | QC inspection | 10 | QC accepted |

Loop check is NOT construction: it is pre-commissioning and belongs to the
Commissioning kind.

## 2. How a discipline is guessed

`guessDiscipline(name)` in `lib/work-kind.ts`, run on the row's name and offered
as the selected tile when the discipline grid opens. Never applied in silence.

- Each discipline carries name words, English and Indonesian (`pondasi`, `beton`,
  `jalan`, `pagar`, `baja`, `pompa`, `pipa`, `jalur pipa`, `kabel`, `listrik`,
  `instrumen`, `cat`, `insulasi`, `uji tekan`, …).
- WORK WORDS BEAT OBJECT WORDS. Testing and Painting are checked before the
  rest, so "Hydrotest Pipeline" is Testing (not Pipeline) and "Painting Tank
  T-201" is Painting (not Mechanical). `tie in` / `hot tap` words point to Piping.
- `pipeline` must win over `pipe` (it does already: a longer hint scores
  higher), and a row under a heading whose name gives the discipline uses it
  when its own name gives nothing.
- A foundation is civil work whatever sits on it, so `foundation` / `pondasi`
  are work words too ("Pondasi Kompresor" is Civil, not Mechanical).
- No match → Other.
- The discipline WORK words (hydrotest, painting, welding, foundation, …) are
  also Construction kind words, so "Hydrotest" is guessed as Construction at the
  first question too (today it guesses nothing). Object words (instrument,
  cable, pump) are not: they also name engineering and procurement rows.

A row that IS one rung (Pipeline's "Welding", "Stringing", "Lowering &
Backfilling"; Testing's "Dewatering & Drying") stays a one-tick gate, as
`shapeOf` does today, matched against each discipline's own rung names and
stage words.

Peers keep working: a row spelled like one already answered takes that row's
discipline as well as its kind.

## 3. The picker

`components/weekly/WorkKindPicker.tsx`, built from its existing pieces: the same
tiles (`min-h-14 rounded-2xl`, `chart-1` tint when chosen), lucide icons,
`pressMotion`.

ONE SAVE (2 Oct 2026, after seeing it built). The picker had its own Save, and
with the grid open it sat right above the panel's Save at the foot: two blue
Save buttons, which read as a mistake. The picker has none now.

A PRESS APPLIES, SAVE WRITES (same day, his words: "langsung masuk pas ditekan
tapi savenya pas dipencet save"). Pressing a kind (or, for Construction, a
discipline) puts its rungs on screen at once, with the ids the server will give
them so ticks made before Save are accepted. Nothing reaches the database until
the panel's Save, which writes the kind, then what was ticked on the new rungs
or typed in the figure, then closes like any Save. Closing without Save leaves
the row as it was. Save pressed with the question still open applies the
highlighted answer and writes it.

- The first question is unchanged: four kinds in a 2 × 2 grid. The guess
  sentence stays ("Looks like Construction, Testing."). No "Suggested" mark.
- The discipline section opens ONLY when the person presses Construction, and
  closes when another kind is pressed. Height + opacity, the daily report's
  `Panel` motion, `contain: layout paint`.
- Inside: "Which part of construction?" and a 3 × 3 grid of smaller tiles
  (icon over a one-word label: Civil, Steel, Mechanical, Piping, Pipeline, E&I,
  Painting, Testing, Other). The guessed one is selected when it opens.
- No line of rung names under the grid, and no "Ticked when" under the rungs:
  both were built and removed the same day as too much text. The definitions
  stay in `lib/disciplines.ts` and in §1 as the ladder's definition of done.
- Save writes kind `construction` plus the chosen discipline's ladder
  (`ladderFor` → `setWorkKindSqlite`), through the existing restatement:
  rungs are awarded in order and never above the percent already reported
  (`changeFor`), with the before/after shown as it is today.
- Once saved, the panel's "Kind of work" row reads "Construction · Testing"
  with the existing Change pill.

Fits a 390px phone: the grid's tiles are about 100px wide.

A row whose answer is already Construction opens its picker (Change) with the
grid shown, since that is what the person came to change. A row on Other opens
on the app's guess rather than on Other: before this, every construction row was
on that ladder because there was no other, not because anybody chose it. Save
writes nothing when the ladder it would write is the one the row already has.

THE TYPED PERCENT STAYS. The figure under every form is an input today, and
typing in it overrides the rungs until a rung is touched again. None of this
removes or gates it: the app helps, and a person who wants to type their own
percent still can (user, 2 Oct 2026).

## 4. Storage: no new column

`work_kind` stays `'construction'`. The discipline is read from the row's own
rungs: milestone ids are stored `${nodeId}:${stepId}` and `stepIdOf` already
recovers the step, and the step prefixes above are unique per discipline.

- `disciplineOf(milestones)` returns the discipline whose step ids the row
  carries, `'other'` for today's `material/install/connect/qc`, and null for a
  gate or a row that is not on a ladder ("Construction" alone is shown).
- So the forecast, Priority Actions, the kind-vs-heading check and every reader
  of `work_kind` are untouched, nothing reaches the deployment through
  `ensureSchema()`, and no snapshot needs a migration.
- EVERY ROW ALREADY FILLED IN READS AS OTHER, with its figures unchanged.
  Moving it to a discipline is a press of Change, through the same restatement
  as any kind change, which never makes a row more generous than it was.

## 5. The plan, read as a stage

One sentence in `ActivityPanel`, under the ladder, for a construction row on a
ladder of two or more rungs. From the row's ticks and `MapNode.planPct` for the
week on screen:

- `stageAt(pct)`: the first rung whose cumulative weight passes `pct`; at 100,
  finished.
- Plan stage ≠ actual stage, plan ahead:
  "Plan has it at Drained and reinstated by week 30. It is at Held and
  witnessed, one stage behind." (plan finished: "Plan has it finished by week
  30."; nothing ticked: "It has not started, three stages behind.")
- Actual ahead: "… It is already at Held and witnessed, one stage ahead."
- Same stage: no sentence; the figures already say it.
- Counts are words up to nine ("one stage", "two stages").
- Held by the weight gate like every other plan figure (`lib/weight-gate.ts`),
  and never shown for a row weighing 0, whose `planPct` is 0 by construction.

No new bar and no new box: one line of text.

## 6. One check: ticked before what it waits for

Replaces C6 `material-early` in `lib/forecast-checks.ts` with `ticked-early`:

- For a construction row on a ladder, the rung marked **Needs** for its
  discipline is ticked while any row it waits for is below 100%.
- "Waits for" is what the planner confirmed (`waits_for`), or EPC order's
  suggestion while nobody has answered, exactly as C6 reads it today. Unlike
  C6 it is not limited to procurement rows: a hydrotest waiting for the piping
  it tests counts.
- Shown in Data Overall's existing "to check" list, never as a box in the panel:
  "Filled and pressurized ticked, but 3.2.1 Piping Area A is at 60.0%".
- Other's guarded rung is `material`, so rows on today's ladder are checked
  exactly as they are now.

## Out of scope

- Counting rungs by quantity (rejected 2 Oct 2026 as engineer-level detail).
- Disciplines for Engineering, Procurement or Commissioning.
- A per-project discipline catalog; weights stay editable per row as today.
- The industry picker at project creation (EPC stays the only profile).
- Changing the demo project's seed (a dummy only fills the app).

## Proof

- `scripts/verify-work-kind.ts` extended: every discipline closes at 100; step
  ids unique across disciplines; the guesses below; "Welding" under a
  pipeline heading is a gate.
  - "Hydrotest Pipeline (4 Sections)" → Testing; "Painting Tank T-201" →
    Painting; "Pipe Rack Erection" → Steel; "Piping Erection" → Piping;
    "Lowering & Backfilling" → Pipeline gate; "Cable Tray & Cable Laying" → E&I;
    "Pondasi Kompresor" → Civil; "Tie-in Works" → Piping;
    "Temporary Facilities (Site Office & Warehouse)" → Other.
- `disciplineOf` on today's ladder → Other; on a gate → null.
- Plan sentence: behind, ahead, same stage (none), finished plan, not started,
  weight gate closed (none), zero-weight row (none).
- `ticked-early`: Testing's fill rung ticked with its piping at 60% → listed;
  at 100% → not; Other's material rung behaves as C6 did.
- Pressed in a running app at 390px and desktop (`scripts/shoot.mjs`): open
  Construction, choose a discipline, Save, see "Construction · Testing", tick a
  rung, read the sentence. `next build` before pushing.
