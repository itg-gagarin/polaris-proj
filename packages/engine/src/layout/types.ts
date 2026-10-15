import type { Confidence, LayoutFamily, Vec3 } from '@bom/domain';
import type { Box } from '../geometry';

export interface PlacedInstance {
  /** `${partId}#${index}` */
  key: string;
  partId: string;
  index: number;
  assemblyId: string | null;
  asmInstance: number;
  /** Rigid group: parts that move together (a drawer with its slides and knob). */
  group: string;
  role: string | null;
  min: Vec3;
  max: Vec3;
  /** Unrotated world extents. */
  size: Vec3;
  /** Degrees, about the centre. */
  rotation: Vec3;
  moving: boolean;
  source: 'template' | 'explicit' | 'stack' | 'tray';
  confidence: Confidence;
  /** Offset at explode = 1. */
  explode: Vec3;
  /** Cut size was clipped to the assembly envelope (trim allowance). */
  trimmed: boolean;
  kind: string;
  /** Packing parts are drawn in the packing lens and skipped by clash. */
  packing: boolean;
}

export interface Cell {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface DrawerSlot {
  assemblyId: string;
  asmInstance: number;
  row: number;
  col: number;
  cell: Cell;
  frontPartId: string | null;
  box: Box | null;
}

export interface DrawerRow {
  index: number;
  perRow: number;
  assemblyId: string;
  /** Cell (opening) height and y range. */
  y0: number;
  y1: number;
  cellWidth: number;
  slots: DrawerSlot[];
}

export interface Requirement {
  role: string;
  partIds: string[];
  required: number;
  have: number;
  reason: string;
  confidence: Confidence;
  severity: 'fail' | 'warn' | 'info';
}

export interface Layout {
  family: LayoutFamily;
  instances: PlacedInstance[];
  /** Geometric parts the template could not place (shown in the Unplaced tray, never dropped). */
  unplaced: { partId: string; count: number; reason: string }[];
  /** BOM lines without geometry (screws, veneer, cartons…). */
  nonGeometric: string[];
  bounds: Box;
  rows: DrawerRow[];
  requirements: Requirement[];
  notes: string[];
  caseInfo: null | {
    width: number;
    depth: number;
    legHeight: number;
    openingX0: number;
    openingX1: number;
    zoneTop: number;
    zoneBottom: number;
    zoneHeight: number;
    stackHeight: number;
    frontZ: number;
    backZ: number;
  };
  bedInfo: null | {
    width: number;
    railSpan: number;
    ledgerSpan: number;
    railLength: number;
    railInnerX0: number;
    railInnerX1: number;
    slatY: number;
    hasLedger: boolean;
    slatCount: number;
  };
}
