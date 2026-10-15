import type { Id } from './ids';
import type { Mm } from './units';
import type { Team } from './teams';

/* ------------------------------------------------------------------ */
/* Geometry primitives                                                 */
/* ------------------------------------------------------------------ */

export type DimKey = 'T' | 'W' | 'L';
export const DIM_KEYS: readonly DimKey[] = ['T', 'W', 'L'];
export type Axis = 'x' | 'y' | 'z';
export const AXES: readonly Axis[] = ['x', 'y', 'z'];

/** Cut size of a part: Thickness, Width, Length (mm). Legacy sheets call these T / L(ebar) / P(anjang). */
export interface Dims {
  T: Mm;
  W: Mm;
  L: Mm;
}

/**
 * Which world axis each cut dimension runs along. World: x = width (left→right),
 * y = height (up), z = depth (back→front). e.g. side panel {T:'x', W:'z', L:'y'}.
 */
export type AxisMap = Record<DimKey, Axis>;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Position is the part's min corner (x,y,z) in mm; rotation in degrees about its centre. */
export interface Transform {
  position: Vec3;
  rotation: Vec3;
}

/* ------------------------------------------------------------------ */
/* Dictionary                                                          */
/* ------------------------------------------------------------------ */

export interface StdPart {
  stdCode: string;
  level: 1 | 2;
  /** L1 head name (assembly). */
  l1: string;
  /** L2 component name (null for level-1 rows). */
  l2: string | null;
  /** Canonical display name (Indonesian, as used on the floor). */
  name: string;
  /** Optional English alias column. */
  nameEn?: string | null;
  category: string;
  subCategory: string;
  positions: string[];
  variants: string[];
  mergedNames: string[];
  fgsUsing: number;
  sgLines: number;
  source: string;
  axisMap: AxisMap | null;
  defaultRole: PartRole | null;
  ownerTeam: Team | null;
  /** Parent L1 code for level-2 rows, e.g. CAN-02 for CAN-02-01. */
  parentCode: string | null;
}

/* ------------------------------------------------------------------ */
/* Parts and assemblies                                                */
/* ------------------------------------------------------------------ */

/** Placement roles understood by the layout templates. Free strings are allowed for extensions. */
export const PART_ROLES = [
  // case goods — top
  'top', 'topThickener', 'topProfile',
  // case goods — sides
  'sidePanel', 'sideThickener', 'legFront', 'legBack', 'sideRailTop', 'sideRailBottom', 'sideInnerProfile',
  'runner', 'runnerBlock', 'cornerBlock', 'block',
  // case goods — front frame, back, base
  'frontRail', 'frontRailBottom', 'frontStile', 'frontProfile', 'innerRail', 'midRunner',
  'backStile', 'backRail', 'back', 'dustPanel', 'baseCover', 'baseFrameStile', 'baseFrameRail',
  'centerSupport', 'centerLeg', 'legSupport',
  // drawers
  'drawerFront', 'drawerFrontTrim', 'drawerBoxFrontBack', 'drawerSide', 'drawerBottom', 'drawerBlock', 'drawerCenterSupport',
  // doors / shelves
  'door', 'shelf', 'divider',
  // beds
  'bedPost', 'bedPanel', 'bedCap', 'bedCapProfile', 'bedCapProfileSide', 'bedAppliedRail', 'bedAppliedStile', 'bedAppliedProfile',
  'bedBackRail', 'bedBackStile', 'bedBackSupport', 'stretcher', 'stretcherBlock', 'lowerLeg', 'legThickener',
  'bedRail', 'railLining', 'slatLedger', 'slat', 'slatSupportLeg',
  // tables
  'tableTop', 'tableLeg', 'apron',
  // packing
  'skidLong', 'skidShort', 'carton', 'packingMaterial',
  // hardware
  'slide', 'handle', 'knob', 'hinge', 'glide', 'fastener', 'antiTip', 'counterWeight', 'namePlate', 'hardware',
] as const;
export type PartRole = (typeof PART_ROLES)[number] | (string & {});

export type PartKind = 'solid' | 'panel' | 'veneer' | 'hardware' | 'packing' | 'other';

export type MatchStatus =
  | 'code' // exact Std Code given
  | 'exact' // exact name / merged name (+ position)
  | 'fuzzy' // needs confirmation
  | 'ai' // AI suggestion, needs confirmation
  | 'confirmed' // a person confirmed a fuzzy / AI match
  | 'manual' // a person picked the code by hand
  | 'unmatched';

export interface MatchCandidate {
  stdCode: string;
  name: string;
  score: number;
  reason: string;
}

export interface PartMatch {
  status: MatchStatus;
  score: number | null;
  candidates: MatchCandidate[];
  /** Who/what confirmed a fuzzy/AI match. */
  confirmedBy?: string | null;
}

export type Unit = 'pcs' | 'pair' | 'set' | 'm' | 'm2' | 'kg' | 'roll';

export interface Part {
  id: Id;
  stdCode: string | null;
  match: PartMatch;
  /** Free text exactly as imported. */
  originalName: string;
  /** Display name (dictionary standard name when matched, else original). */
  name: string;
  l1: string | null;
  l2: string | null;
  position: string | null;
  dims: Dims;
  /** Size expressions, e.g. { W: '=opening.width - 2*slideClearance' }. A typed number clears the expression. */
  expressions: Partial<Record<DimKey, string>>;
  /** Total quantity on the BOM line (across all instances of the parent assembly). */
  qty: number;
  unit: Unit;
  kind: PartKind;
  /** Material / species label, e.g. MAHOGANY, PARTICLE BOARD E2. */
  material: string | null;
  /** Raw material code from the source sheet, e.g. 'm', 'x', 'p', 'm1', 'l'. */
  materialCode: string | null;
  finishCode: string | null;
  hardwareSku: string | null;
  teamOwner: Team;
  role: PartRole | null;
  roleSource: 'dictionary' | 'inferred' | 'manual' | null;
  axisMap: AxisMap | null;
  /** Explicit transforms per instance index; overrides the layout template for that instance. */
  instanceTransforms: Record<number, Transform>;
  assemblyId: Id | null;
  locked: boolean;
  /** Left/right pairs are expected equal unless marked asymmetric. */
  asymmetric: boolean;
  /** null = derived from role. */
  visible: boolean | null;
  notes: string;
  source: { sheet?: string; row?: number; file?: string } | null;
  /** Free-form attributes kept from the import (e.g. legacy cost columns are NOT kept). */
  attrs: Record<string, string | number | boolean | null>;
}

export interface Assembly {
  id: Id;
  stdCode: string | null;
  name: string;
  originalName: string;
  /** How many of this assembly the product has, e.g. RAKITAN LACI qty 2 = two drawers. */
  qty: number;
  /** Bounding size from the sheet (T/W/L) when given. */
  dims: Dims | null;
  parentId: Id | null;
  role: string | null;
  finishCode: string | null;
  transform: Transform | null;
  explodeVector: Vec3 | null;
  assemblyStep: number | null;
  notes: string;
}

export type JointType = 'tenon' | 'dado' | 'rabbet' | 'half-lap' | 'screw' | 'glue-block' | 'groove' | 'contact';

export interface Joint {
  id: Id;
  partA: Id;
  partB: Id;
  type: JointType;
  allowedOverlapMm: Mm;
  /** 'template' joints are generated by the layout template; 'user' joints are declared by people. */
  source: 'template' | 'user' | 'import';
}

/* ------------------------------------------------------------------ */
/* Parameters, assumptions, header                                     */
/* ------------------------------------------------------------------ */

export type Confidence = 'high' | 'medium' | 'low';

export interface Parameter {
  key: string;
  /** Expression or plain number as string; value is the evaluated number. */
  expr: string | null;
  value: number;
  source: 'inferred' | 'user' | 'default' | 'import';
  note?: string;
}

export interface Assumption {
  key: string;
  value: string | number | boolean;
  source: 'default' | 'inferred' | 'user';
  confidence: Confidence;
  note?: string;
}

export interface Size3 {
  W: Mm;
  D: Mm;
  H: Mm;
}

export interface ProductHeader {
  productSize: Size3 | null;
  packingSizes: Size3[];
  buyer: string | null;
  series: string | null;
  description: string | null;
  spec: string | null;
  setup: string | null;
  carton: string | null;
  sheetNote: string | null;
  date: string | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
  loadQty40HC: number | null;
  /** Target markets, e.g. ['US'] — drives market rules (tip-over). */
  markets: string[];
}

export type LayoutFamily = 'caseWithDrawers' | 'caseWithDoors' | 'bed' | 'bedComponent' | 'table' | 'chair' | 'bench' | 'bookcase' | 'generic';

export interface RevisionContent {
  header: ProductHeader;
  family: LayoutFamily;
  parts: Part[];
  assemblies: Assembly[];
  joints: Joint[];
  parameters: Record<string, Parameter>;
  assumptions: Record<string, Assumption>;
  /** Waived findings: findingKey → waiver. Stays visible, marked as waived. */
  waivers: Record<string, Waiver>;
}

export interface Waiver {
  findingKey: string;
  kind: 'accepted-risk' | 'false-positive';
  reason: string;
  by: Id;
  at: string;
}

/* ------------------------------------------------------------------ */
/* Products and revisions                                              */
/* ------------------------------------------------------------------ */

export interface Product {
  id: Id;
  workspaceId: Id;
  code: string;
  name: string;
  category: string;
  subCategory: string;
  currentRevisionId: Id | null;
  /** Products shared with external buyers. */
  sharedWithBuyer: boolean;
  /** Component products that make a set (e.g. bed = HB + FB + rails). */
  componentProductIds: Id[];
  createdAt: string;
}

export const REVISION_STATES = ['draft', 'in_review', 'changes_requested', 'approved', 'released'] as const;
export type RevisionState = (typeof REVISION_STATES)[number];

export interface Revision {
  id: Id;
  productId: Id;
  label: string;
  state: RevisionState;
  notes: string;
  authorId: Id;
  createdAt: string;
  updatedAt: string;
  parentRevisionId: Id | null;
  /** Alternatives: B-wood vs B-metal. */
  branch: { name: string; status: 'active' | 'promoted' | 'archived' } | null;
  content: RevisionContent;
  /** Hash frozen at submit; review lanes attach to it. */
  submittedHash: string | null;
  releasedAt: string | null;
  meetingIds: Id[];
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type Severity = 'fail' | 'warn' | 'info';

export interface Finding {
  /** Stable key: ruleId + sorted part ids (+ discriminator). Used for waivers and diffing. */
  key: string;
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  ownerTeam: Team;
  partIds: Id[];
  message: string;
  numbers: Record<string, number>;
  assumptionKeys: string[];
  fix: Patch | null;
  /** Clash pin location (world mm), when relevant. */
  at?: Vec3;
  waived?: Waiver;
}

/* ------------------------------------------------------------------ */
/* Patches (the only way content changes)                              */
/* ------------------------------------------------------------------ */

export type PartField =
  | 'qty' | 'unit' | 'material' | 'materialCode' | 'finishCode' | 'hardwareSku' | 'teamOwner' | 'position'
  | 'stdCode' | 'role' | 'notes' | 'name' | 'locked' | 'asymmetric' | 'visible' | 'axisMap' | 'kind' | 'assemblyId' | 'match';

export type PatchOp =
  | { op: 'setDim'; partId: Id; dim: DimKey; value: number; from?: number }
  | { op: 'setExpr'; partId: Id; dim: DimKey; expr: string | null; from?: string | null }
  | { op: 'setField'; partId: Id; field: PartField; value: unknown; from?: unknown }
  | { op: 'setTransform'; partId: Id; instance: number; transform: Transform | null; from?: Transform | null }
  | { op: 'addPart'; part: Part }
  | { op: 'removePart'; partId: Id; part?: Part; index?: number }
  | { op: 'setAssembly'; assemblyId: Id; field: keyof Assembly; value: unknown; from?: unknown }
  | { op: 'addAssembly'; assembly: Assembly }
  | { op: 'removeAssembly'; assemblyId: Id; assembly?: Assembly; index?: number }
  | { op: 'addJoint'; joint: Joint }
  | { op: 'removeJoint'; jointId: Id; joint?: Joint }
  | { op: 'setParameter'; key: string; parameter: Parameter | null; from?: Parameter | null }
  | { op: 'setAssumption'; key: string; assumption: Assumption | null; from?: Assumption | null }
  | { op: 'setHeader'; field: keyof ProductHeader; value: unknown; from?: unknown }
  | { op: 'setWaiver'; findingKey: string; waiver: Waiver | null; from?: Waiver | null };

export type ChangeSource = 'user' | 'ai' | 'rule' | 'import' | 'meeting' | 'system';

export interface Patch {
  id: Id;
  ops: PatchOp[];
  reason: string;
  source: ChangeSource;
  authorId?: Id | null;
  ruleId?: string | null;
  confidence?: Confidence | null;
  team?: Team | null;
  /** AI suggestions with no rule behind them are labelled "Suggestion". */
  label?: string | null;
}
