/**
 * The shape an EDL already has, before anyone types anything.
 *
 * Nobody building a register should have to invent its structure. Two real
 * signed EDLs sit in this repo — Gundih's 28 groups and Petrogas' 36 — and they
 * are the same register twice: GENERAL with an execution plan and procedures,
 * then DETAIL ENGINEERING split per discipline, each discipline holding the
 * same handful of document types. What differs between them is spelling
 * ("Proces", "Elecrtical", "Scehedule", "Boq"), not structure.
 *
 * So this is their union, spelled correctly once. It is a STARTING POINT, never
 * a rule: sections nobody uses are simply left empty and never written, and a
 * project with a discipline of its own adds it.
 *
 * Names here are ours, so they are in English like the rest of the app. Names
 * that arrive from a workbook stay exactly as that workbook spelled them.
 */
import type { RegisterKind } from './schema';

export interface TemplateSection {
  name: string;
  /** Empty when the section holds documents directly — Execution Plan does. */
  groups: string[];
}

export interface TemplateBand {
  name: string;
  sections: TemplateSection[];
}

/** Present in Gundih AND Petrogas, unless noted. */
const EDL_TEMPLATE: TemplateBand[] = [
  {
    name: 'GENERAL',
    sections: [
      { name: 'EXECUTION PLAN', groups: [] },
      {
        name: 'PROCEDURE',
        groups: ['General Procedure', 'QA/QC Procedure', 'Commissioning Procedure'],
      },
    ],
  },
  {
    name: 'DETAIL ENGINEERING',
    sections: [
      {
        name: 'PROCESS',
        groups: [
          'Process Study & Report',
          'Process Flow Diagram',
          'Process & Instrumentation Diagram',
          'Process Schedule',
        ],
      },
      {
        // Petrogas only — Gundih's scope carried no civil work.
        name: 'CIVIL',
        groups: ['Civil Calculation', 'Civil Procedure', 'Civil Drawing', 'Civil Bill of Material'],
      },
      {
        name: 'MECHANICAL',
        groups: ['Mechanical Datasheet', 'Mechanical Drawing', 'Mechanical Bill of Material'],
      },
      {
        // Petrogas only.
        name: 'PIPING',
        groups: [
          'Piping Specification',
          'Piping QA/QC',
          'Piping Procedure',
          'Piping Drawing',
          'Piping Bill of Material',
        ],
      },
      {
        name: 'ELECTRICAL',
        groups: [
          'Electrical Calculation & Study',
          'Electrical Philosophy',
          'Electrical Procedure',
          'Electrical Datasheet',
          'Electrical List',
          'Electrical Drawing',
          'Electrical Bill of Material',
        ],
      },
      {
        name: 'INSTRUMENT',
        groups: [
          'Instrument Calculation',
          'Instrument Specification',
          'Instrument Datasheet',
          'Instrumentation Procedure',
          'Instrument List',
          'Instrument Drawing',
          'Instrument Bill of Material',
        ],
      },
    ],
  },
];

/**
 * The vendor register has no such shape, and pretending otherwise would be a
 * lie dressed as help: a VDRL is organised by vendor package, and Gundih's has
 * seventy-six of them, each named after a purchase order nobody can guess. So
 * it starts empty and every package is added by the person who knows it.
 */
const VDRL_TEMPLATE: TemplateBand[] = [
  { name: 'VENDOR PACKAGES', sections: [] },
];

export function templateFor(register: RegisterKind): TemplateBand[] {
  return register === 'edl' ? EDL_TEMPLATE : VDRL_TEMPLATE;
}
