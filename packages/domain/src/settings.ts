import type { Team } from './teams';

/** Thresholds come from workspace settings, never from code, so each factory sets its own standard. */
export interface CheckThresholds {
  /** Overlap above this counts as a clash (mm). */
  clashTolerance: number;
  /** Side-mount slide clearance per side (mm). Brand dependent — open question in PRD §14. */
  slideClearance: number;
  slideTolerance: number;
  /** Gap around inset / overlay fronts (mm). */
  reveal: number;
  revealTolerance: number;
  frontAlignTolerance: number;
  /** Allowance per edge when a back / bottom sits in a groove (mm). */
  grooveAllowance: number;
  fitTolerance: number;
  slatEndClearance: number;
  slatBearingMin: number;
  slatBearingMax: number;
  slatGapMax: number;
  mattressClearance: number;
  pairTolerance: number;
  overallTolerance: number;
  /** US clothing-storage tip-over rule threshold: 27 in. Needs verification per market. */
  tipOverHeight: number;
  /** Mattress sizes by bed size keyword (W x L, mm). */
  mattresses: Record<string, { W: number; L: number }>;
  /** Extra packing around the product footprint for skids (mm). */
  skidMinOverhang: number;
}

export interface WorkspaceSettings {
  units: 'mm';
  language: 'en' | 'id';
  displayStep: number;
  inputStep: number;
  /** Editing outside your team's scope: blocked, or turned into a suggestion (PRD §2 open question). */
  outOfScopeEdit: 'block' | 'suggest';
  thresholds: CheckThresholds;
  /** Required review lanes per category or sub-category (most specific wins). */
  requiredLanes: Record<string, Team[]>;
  ai: {
    enabled: boolean;
    /** When false only deterministic rule fixes are produced. */
    modelPass: boolean;
    timeoutMs: number;
  };
  meetings: {
    /** Open question: unpublished personal notes at close. */
    unpublishedNotesAtClose: 'keep-private' | 'auto-share';
    recordingRetentionDays: number;
  };
  /** Part locks expire after this idle time. */
  lockIdleMinutes: number;
}

export const DEFAULT_THRESHOLDS: CheckThresholds = {
  clashTolerance: 0.05,
  slideClearance: 12.7,
  slideTolerance: 0.5,
  reveal: 2,
  revealTolerance: 1,
  frontAlignTolerance: 1,
  grooveAllowance: 6,
  fitTolerance: 2,
  slatEndClearance: 5,
  slatBearingMin: 15,
  slatBearingMax: 20,
  slatGapMax: 76,
  mattressClearance: 10,
  pairTolerance: 0.5,
  overallTolerance: 2,
  tipOverHeight: 686,
  mattresses: {
    twin: { W: 991, L: 1905 },
    full: { W: 1372, L: 1905 },
    queen: { W: 1524, L: 2032 },
    king: { W: 1930, L: 2032 },
    'cal-king': { W: 1829, L: 2134 },
  },
  skidMinOverhang: 0,
};

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  units: 'mm',
  language: 'en',
  displayStep: 0.5,
  inputStep: 0.1,
  outOfScopeEdit: 'suggest',
  thresholds: DEFAULT_THRESHOLDS,
  requiredLanes: {
    // PRD §9 example; final list is an open question (PRD §14).
    Beds: ['design', 'engineering', 'finishing', 'hardware', 'packing'],
    'Storage & Casegoods': ['design', 'engineering', 'finishing', 'assembly', 'hardware', 'packing', 'qc'],
    Tables: ['design', 'engineering', 'finishing', 'packing'],
    Seating: ['design', 'engineering', 'finishing', 'packing', 'qc'],
    '*': ['design', 'engineering', 'finishing', 'packing'],
  },
  ai: { enabled: true, modelPass: true, timeoutMs: 60_000 },
  meetings: { unpublishedNotesAtClose: 'keep-private', recordingRetentionDays: 90 },
  lockIdleMinutes: 30,
};

export function requiredLanesFor(settings: WorkspaceSettings, category: string, subCategory?: string): Team[] {
  const m = settings.requiredLanes;
  return (subCategory && m[`${category}/${subCategory}`]) || m[category] || m['*'] || [];
}
