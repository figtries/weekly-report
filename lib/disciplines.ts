/**
 * Construction, by discipline (spec 2026-10-02-construction-disciplines-design).
 *
 * One Construction ladder (Material on site / Installation / Connections / QC)
 * was asked of every construction row, so a hydrotest was asked about
 * "Connections" and a foundation about "Material on site". The figure a project
 * control engineer reported from it was an interpretation, not a measurement.
 * Here every discipline climbs its own rungs, and every rung says when it is
 * ticked, which is what makes two people looking at the same site tick the same
 * thing.
 *
 * NOTHING HERE IS STORED. `work_kind` stays 'construction', so the forecast,
 * Priority Actions and every other reader of it are untouched; the discipline
 * is read back from the row's own rungs, whose ids are `${nodeId}:${stepId}`
 * and whose step ids are unique per discipline. Today's ladder keeps today's
 * ids and reads as Other, which is what leaves every row already filled in
 * exactly as it was.
 *
 * The WEIGHTS are starting points, not a standard: no published standard fixes
 * them, every EPC contractor measures under a Progress Measurement Procedure its
 * client approves, and they stay editable per row. What is standard is the
 * method and the order of the rungs.
 */
import { stepIdOf } from './forecast-epc';
import { BUILT_IN_KINDS, normalizeName, type WorkKind } from './work-kind';

export interface Discipline extends WorkKind {
  /** The word on the tile and after "Construction ·". */
  short: string;
  /** The rung `ticked-early` guards (lib/forecast-checks.ts). */
  needs: string;
  /**
   * What ticking each rung means, by step id. Empty for Other. The definition
   * of done the ladder is built on; NOT shown on screen (it was, under each
   * rung, and on 2 Oct 2026 read as too much text), so it lives here and in
   * the spec for whoever sets a project's procedure.
   */
  tickedWhen: Record<string, string>;
  /** Work words: when one is in the name it wins over any object word. */
  firstWords: string[];
}

const construction = BUILT_IN_KINDS.find((k) => k.id === 'construction')!;

function d(
  id: string, short: string, label: string, needs: string,
  rungs: Array<[string, string, number, string]>,
  kindHints: string[], stageHints: string[], firstWords: string[] = []
): Discipline {
  return {
    id, short, label, needs,
    steps: rungs.map(([sid, l, w]) => ({ id: sid, label: l, weight: w })),
    tickedWhen: Object.fromEntries(rungs.filter((r) => r[3]).map(([sid, , , t]) => [sid, t])),
    kindHints, stageHints, firstWords,
  };
}

export const OTHER: Discipline = {
  ...construction,
  id: 'other', short: 'Other', label: 'Other', needs: 'material',
  steps: construction.steps.map((s) => ({ ...s })),
  tickedWhen: {}, kindHints: [], firstWords: [],
};

export const CONSTRUCTION_DISCIPLINES: Discipline[] = [
  d('civil', 'Civil', 'Civil', 'civil-excavate', [
    ['civil-excavate', 'Excavated', 10, 'Dug to design level and checked'],
    ['civil-rebar', 'Rebar and formwork', 30, 'Rebar and formwork inspected, ready to pour'],
    ['civil-pour', 'Concrete poured', 40, 'Pour complete, cubes sampled'],
    ['civil-finish', 'Backfilled and finished', 20, 'Formwork stripped, backfilled, area clean'],
  ], ['civil', 'foundation', 'foundations', 'pondasi', 'fondasi', 'concrete', 'beton', 'piling', 'pile', 'tiang pancang',
      'drainage', 'drainase', 'sewer', 'road', 'jalan', 'paving', 'fence', 'pagar', 'earthwork', 'galian', 'urugan',
      'land clearing', 'bund wall', 'building', 'gedung', 'bangunan', 'warehouse', 'gudang', 'guard house', 'pos jaga',
      'tie beam', 'landscaping', 'parking'],
     ['excavation', 'galian', 'rebar', 'formwork', 'bekisting', 'concrete pouring', 'pengecoran', 'backfill'],
     // A foundation is civil work whatever sits on it: "Pondasi Kompresor", "Pipe Rack Foundations".
     ['foundation', 'foundations', 'pondasi', 'fondasi', 'excavation', 'galian', 'piling', 'concrete', 'beton']),
  d('steel', 'Steel', 'Steel structure', 'steel-erect', [
    ['steel-erect', 'Erected', 50, 'Members set and temporarily bolted'],
    ['steel-bolt', 'Bolted and aligned', 30, 'Final bolts torqued, plumb and level checked'],
    ['steel-touchup', 'Touched up and inspected', 20, 'Touch-up paint done, QC accepted'],
  ], ['steel', 'structure', 'structural', 'struktur', 'baja', 'pipe rack', 'piperack', 'shelter', 'canopy', 'platform',
      'stair', 'stairs', 'tangga', 'ladder', 'handrail'],
     ['erection', 'bolting', 'touch up']),
  d('mechanical', 'Mechanical', 'Mechanical equipment', 'mech-set', [
    ['mech-set', 'Set in place', 50, 'On its foundation, anchor bolts in'],
    ['mech-align', 'Aligned and grouted', 30, 'Levelled, aligned, grout cured'],
    ['mech-fit', 'Accessories fitted', 10, 'Ladders, platforms, internals fitted'],
    ['mech-boxup', 'Boxed up', 10, 'Internal inspection signed, manways closed'],
  ], ['equipment', 'vessel', 'tank', 'tangki', 'pump', 'pompa', 'compressor', 'kompresor', 'skid', 'separator', 'scrubber',
      'heater', 'exchanger', 'air cooler', 'generator', 'genset', 'turbine', 'teg', 'boiler', 'hvac'],
     ['setting', 'alignment', 'grouting', 'box up']),
  d('piping', 'Piping', 'Piping', 'piping-erect', [
    ['piping-erect', 'Spools erected', 40, 'Spools on supports in position'],
    ['piping-joint', 'Welded or bolted', 30, 'Field joints welded, flanges bolted'],
    ['piping-support', 'Supports complete', 15, 'Permanent supports, shoes, guides fitted'],
    ['piping-ndt', 'NDT and punch cleared', 15, 'NDT accepted, punch A cleared'],
  ], ['piping', 'pipe', 'pipa', 'spool', 'header', 'manifold', 'valve', 'hydrant', 'fire water', 'tie in', 'hot tap',
      'cut in', 'interkoneksi'],
     ['spool erection', 'bolt up', 'supports', 'punch']),
  d('pipeline', 'Pipeline', 'Pipeline', 'pipeline-string', [
    ['pipeline-string', 'Strung', 10, 'Right of way ready, pipe strung along it'],
    ['pipeline-weld', 'Welded', 30, 'Joints welded'],
    ['pipeline-coat', 'NDT and coated', 15, 'NDT accepted, field joints coated and holiday tested'],
    ['pipeline-lower', 'Lowered in', 25, 'Trenched, lowered in, padded'],
    ['pipeline-reinstate', 'Backfilled and reinstated', 20, 'Backfilled, markers set, right of way reinstated'],
  ], ['pipeline', 'flowline', 'flow line', 'trunkline', 'trunk line', 'jalur pipa', 'row', 'right of way', 'stringing',
      'trenching', 'lowering', 'crossing', 'boring', 'hdd', 'field joint coating', 'marker', 'cathodic', 'anode', 'cp'],
     ['stringing', 'welding', 'ndt', 'ndt radiography', 'radiography', 'field joint coating', 'trenching', 'lowering',
      'lowering in', 'lowering backfilling', 'backfilling', 'row clearing grading', 'row reinstatement']),
  d('ei', 'E&I', 'Electrical and instrument', 'ei-install', [
    ['ei-install', 'Installed', 30, 'Tray and conduit run, or instrument mounted'],
    ['ei-cable', 'Cabled or tubed', 35, 'Cables pulled and tagged, or impulse tubing run'],
    ['ei-term', 'Terminated', 20, 'Both ends glanded and terminated'],
    ['ei-test', 'Tested', 15, 'Megger, continuity or calibration recorded'],
  ], ['electrical', 'listrik', 'elektrikal', 'cable', 'kabel', 'tray', 'conduit', 'panel', 'mcc', 'switchgear',
      'transformer', 'trafo', 'lighting', 'penerangan', 'small power', 'earthing', 'grounding', 'instrument', 'instrumen',
      'instrumentation', 'transmitter', 'tubing', 'hook up', 'junction box', 'analyzer', 'f g', 'fire and gas',
      'detector', 'dcs', 'esd', 'plc', 'scada', 'telecom', 'cctv', 'termination', 'megger'],
     ['cable pulling', 'cable laying', 'termination', 'megger']),
  d('painting', 'Painting', 'Painting and insulation', 'paint-prep', [
    ['paint-prep', 'Surface prepared', 30, 'Blasted or cleaned, profile checked'],
    ['paint-prime', 'Primed', 30, 'Primer applied, thickness checked'],
    ['paint-finish', 'Finished', 40, 'Final coat or insulation done, inspected'],
  ], ['painting', 'paint', 'pengecatan', 'cat', 'coating', 'insulation', 'insulasi', 'blasting', 'fireproofing'],
     ['blasting', 'priming', 'primer'],
     ['painting', 'paint', 'pengecatan', 'blasting', 'fireproofing']),
  d('testing', 'Testing', 'Testing', 'test-fill', [
    ['test-pack', 'Test pack approved', 20, 'Client signs the test pack'],
    ['test-fill', 'Filled and pressurized', 30, 'Filled, test pressure reached'],
    ['test-hold', 'Held and witnessed', 30, 'Hold time passed, witnessed, report signed'],
    ['test-drain', 'Drained and reinstated', 20, 'Drained, dried, reinstated'],
  ], ['hydrotest', 'hydro test', 'hydrostatic', 'pressure test', 'leak test', 'pneumatic test', 'uji tekan', 'test pack',
      'pigging', 'pig run', 'caliper', 'gauging', 'dewatering', 'drying'],
     ['dewatering drying', 'dewatering', 'drying'],
     ['hydrotest', 'hydro test', 'hydrostatic', 'pressure test', 'leak test', 'pneumatic test', 'uji tekan', 'test pack']),
  OTHER,
];

export function findDiscipline(id: string | null | undefined): Discipline | null {
  return CONSTRUCTION_DISCIPLINES.find((x) => x.id === id) ?? null;
}

const has = (n: string, phrase: string) => ` ${n} `.includes(` ${phrase} `);

function bestIn(n: string, pick: (x: Discipline) => string[]): Discipline | null {
  let best: { d: Discipline; len: number } | null = null;
  for (const x of CONSTRUCTION_DISCIPLINES) {
    for (const w of pick(x)) if (has(n, w) && (!best || w.length > best.len)) best = { d: x, len: w.length };
  }
  return best?.d ?? null;
}

/**
 * The discipline the app offers, from the row's name and then its headings,
 * nearest first. Whole words only ("row" is a right of way, not "arrow"). A
 * WORK word (hydrotest, painting) beats an OBJECT word (pipeline, tank), so
 * "Hydrotest Pipeline" is Testing; otherwise the longest match wins.
 */
export function guessDiscipline(name: string, context: string[] = []): Discipline {
  for (const text of [name, ...context]) {
    const n = normalizeName(text);
    const hit = bestIn(n, (x) => x.firstWords) ?? bestIn(n, (x) => x.kindHints);
    if (hit) return hit;
  }
  return OTHER;
}

/** The discipline a row is on, read from its own rungs. Null for a gate or a ladder that is not a discipline's. */
export function disciplineOf(milestones: ReadonlyArray<{ id: string }> | undefined): Discipline | null {
  if (!milestones || milestones.length < 2) return null;
  const steps = milestones.map((m) => stepIdOf(m.id));
  return CONSTRUCTION_DISCIPLINES.find((x) => steps.every((s) => x.steps.some((st) => st.id === s))) ?? null;
}
