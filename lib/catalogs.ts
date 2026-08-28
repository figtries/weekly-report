import type { CatalogEntry, Database, ProjectCatalogs } from './types';

/**
 * Per-project category lists.
 *
 * These used to live as literals in `lib/defaults.ts` — PT Indoturbine's own
 * five delay causes, six HSE activities and three crew rows, compiled into the
 * app. That is the single reason no second project could use it: changing a
 * category meant editing code and redeploying.
 *
 * The lists below are now a *starting template*, not a rule. A project owns its
 * copy from the moment it is created and can rename, add or drop rows freely.
 */

/**
 * `claimable` is not decoration: these are the causes that support an
 * extension-of-time claim, and marking them here is what lets the delay
 * register assemble itself later without anyone re-classifying by hand.
 */
export function templateDelayCauses(): CatalogEntry[] {
  return [
    { id: 'wx', label: 'Bad Weather', claimable: true },
    { id: 'gsm', label: 'General Safety Meeting', claimable: false },
    { id: 'crew', label: 'Crew Change Day', claimable: false },
    { id: 'stby', label: 'Personnel Standby', claimable: true },
    { id: 'drill', label: 'Fire Drill', claimable: false },
    { id: 'mat', label: 'Material Delay', claimable: true },
    { id: 'permit', label: 'Permit / PTW Delay', claimable: true },
  ];
}

/** Ids are the `WeatherInfo` field names — renaming a label must not move a slot. */
export function templateWeather(): CatalogEntry[] {
  return [
    { id: 'hujanDeras', label: 'Hujan Deras' },
    { id: 'hujanSedang', label: 'Hujan Sedang' },
    { id: 'berawanMendung', label: 'Berawan / Mendung' },
    { id: 'cerahTerang', label: 'Cerah / Terang' },
  ];
}

export function templateHse(): CatalogEntry[] {
  return [
    { id: 'fatality', label: 'Fatality' },
    { id: 'lti', label: 'Lost Time Incident (LTI)' },
    { id: 'nlti', label: 'Non - Lost Time Incident (NLTI)' },
    { id: 'unsafe', label: 'Unsafe Condition / Unsafe Action' },
    { id: 'nearmiss', label: 'Near Miss' },
    { id: 'medical', label: 'Medical Treatment' },
  ];
}

export function templateCrew(): CatalogEntry[] {
  return [
    { id: 'office', label: 'Office' },
    { id: 'site', label: 'Site' },
    { id: 'vendor', label: 'Vendor' },
  ];
}

export function templateCatalogs(): ProjectCatalogs {
  return {
    weather: templateWeather(),
    delayCause: templateDelayCauses(),
    hse: templateHse(),
    crew: templateCrew(),
  };
}

/**
 * Read a project's catalogs, filling in the template for anything absent.
 *
 * Seeded databases predate `db.catalogs` entirely, so this never assumes the
 * field exists — a project opened from an old file behaves exactly as before
 * until someone edits a list.
 */
export function getCatalogs(db: Database): ProjectCatalogs {
  const c = db.catalogs;
  return {
    // Weather is length-checked against 4, not 0: a stored list that lost a slot
    // would silently drop a checkbox from every future daily report.
    weather: c?.weather?.length === 4 ? c.weather : templateWeather(),
    delayCause: c?.delayCause?.length ? c.delayCause : templateDelayCauses(),
    hse: c?.hse?.length ? c.hse : templateHse(),
    crew: c?.crew?.length ? c.crew : templateCrew(),
  };
}

/** Weather label by `WeatherInfo` key, ready for the form and the printed sheet. */
export function weatherLabels(db: Database): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of getCatalogs(db).weather) out[w.id] = w.label;
  return out;
}

/** Which causes count toward an extension-of-time claim. */
export function claimableCauseLabels(db: Database): Set<string> {
  return new Set(
    getCatalogs(db)
      .delayCause.filter((c) => c.claimable)
      .map((c) => c.label.toLowerCase())
  );
}

export type CatalogKey = keyof ProjectCatalogs;

export const CATALOG_TITLES: Record<CatalogKey, { title: string; hint: string }> = {
  weather: {
    title: 'Weather terms',
    hint: 'The four conditions ticked in the daily report. There are always four — only what they are called can change.',
  },
  delayCause: {
    title: 'Causes of non-effective hours',
    hint: 'Anything marked claimable flows into the Delay Register as material for an extension-of-time claim.',
  },
  hse: {
    title: 'HSE categories',
    hint: 'The rows counted in the daily report and summarised weekly.',
  },
  crew: {
    title: 'Manhour groups',
    hint: 'The companies or crews whose hours are recorded separately.',
  },
};
