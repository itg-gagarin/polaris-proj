import type { LayoutFamily, RevisionContent, MatchCandidate, MatchStatus, PartRole, AxisMap } from '@bom/domain';

export type ImportFormat = 'standard' | 'legacy-mbf';

export interface ImportRowPreview {
  partId: string;
  sheetRow: number | null;
  originalName: string;
  l1: string | null;
  qty: number;
  dims: { T: number; W: number; L: number };
  match: { status: MatchStatus; stdCode: string | null; name: string | null; score: number | null; candidates: MatchCandidate[] };
  role: PartRole | null;
  roleSource: 'dictionary' | 'inferred' | 'manual' | null;
  axisMap: AxisMap | null;
  axisSource: 'column' | 'dictionary' | 'role' | null;
  geometric: boolean;
  issues: string[];
}

export interface ImportedProduct {
  sheet: string;
  format: ImportFormat;
  product: {
    code: string;
    name: string;
    category: string;
    subCategory: string;
    family: LayoutFamily;
  };
  revisionLabel: string;
  content: RevisionContent;
  preview: ImportRowPreview[];
  warnings: string[];
}

export interface ImportResult {
  products: ImportedProduct[];
  skippedSheets: { name: string; reason: string }[];
  workbookNotes: string[];
}
