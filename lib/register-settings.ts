/**
 * A register's own words and colours (4 Oct 2026): what each stage is called,
 * what it weighs, the colour of its bar, and how the client's codes read.
 *
 * Set on Setup, read by every Document Control screen. The STAGE KEY (IFR,
 * IFA, AFC) and the CODE KEY (APP, AWC, RWC) never change: progress, lateness
 * and "approved" are worked out from the keys (`lib/register-shared.ts`), so a
 * project that writes "A" for approved still counts it as approved. Only the
 * words and colours are the project's.
 *
 * Plain data, no server imports: the screens and the server share it.
 */
import type { DocStage } from './schema';
import { STAGE_FULL, STAGE_LABEL } from './register-shared';

export interface StageSetting {
  stage: DocStage;
  /** 0..100; the weighted stages add up to 100. */
  weight: number;
  /** Short name, as a document controller says it: IFR. */
  label: string;
  /** Full name: Issued for review. */
  name: string;
  color: string;
}

export type CodeKey = 'APP' | 'AWC' | 'RWC';

export interface CodeSetting {
  key: CodeKey;
  /** What the client writes on the reply. */
  label: string;
  /** What it means, in the project's words. */
  meaning: string;
}

export interface RegisterSettings {
  stages: StageSetting[];
  codes: CodeSetting[];
  /** The area segment of a document number, '' for none. */
  area: string;
}

/** The colours offered for a stage bar: the app's blues first. */
export const STAGE_PALETTE = ['#1e3a8a', '#1d4ed8', '#60a5fa', '#bfdbfe', '#0d9488', '#7c3aed', '#f59e0b', '#475569'];

const DEFAULT_COLOR: Partial<Record<DocStage, string>> = { IFR: '#1d4ed8', IFA: '#60a5fa', AFC: '#93c5fd' };

/** The three stages Setup shows; resubmissions are laps of these, not stages of their own. */
export const MAIN_STAGES: DocStage[] = ['IFR', 'IFA', 'AFC'];

export const DEFAULT_WEIGHT: Partial<Record<DocStage, number>> = { IFR: 50, IFA: 30, AFC: 20 };

export const DEFAULT_CODES: CodeSetting[] = [
  { key: 'APP', label: 'APP', meaning: 'Approved' },
  { key: 'AWC', label: 'AWC', meaning: 'Approved with comments' },
  { key: 'RWC', label: 'RWC', meaning: 'Revise and resubmit' },
];

/** What a code DOES, fixed by its key: the words are the project's, the rule is not. */
export const CODE_EFFECT: Record<CodeKey, string> = {
  APP: 'Goes on to the next stage',
  AWC: 'Next stage, comments carried into it',
  RWC: 'Sent again at the same stage',
};

export function defaultStage(stage: DocStage, weight?: number): StageSetting {
  const name = STAGE_FULL[stage];
  return {
    stage,
    weight: weight ?? DEFAULT_WEIGHT[stage] ?? 0,
    label: STAGE_LABEL[stage],
    name: name.charAt(0) + name.slice(1).toLowerCase(),
    color: DEFAULT_COLOR[stage] ?? '#94a3b8',
  };
}

export function parseCodes(raw: string | null | undefined): CodeSetting[] {
  let stored: Partial<CodeSetting>[] = [];
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(value)) stored = value as Partial<CodeSetting>[];
  } catch { /* the defaults below */ }
  return DEFAULT_CODES.map((d) => {
    const s = stored.find((x) => x?.key === d.key);
    return {
      key: d.key,
      label: s?.label?.trim() || d.label,
      meaning: s?.meaning?.trim() || d.meaning,
    };
  });
}

export function stageOf(settings: RegisterSettings, stage: DocStage): StageSetting {
  return settings.stages.find((s) => s.stage === stage) ?? defaultStage(stage);
}

export function codeLabel(settings: RegisterSettings, code: string | null): string {
  if (!code) return '';
  return settings.codes.find((c) => c.key === code)?.label ?? code;
}

export const DEFAULT_SETTINGS: RegisterSettings = {
  stages: MAIN_STAGES.map((s) => defaultStage(s)),
  codes: DEFAULT_CODES,
  area: '',
};
