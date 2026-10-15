import type { AxisMap, PartKind, PartRole, Team, Unit } from '@bom/domain';
import { axisMapFrom } from './axis';
import { normalizeName, stripAssemblyPrefix, BASE_POSITIONS } from './normalize';

/**
 * Role knowledge: what a part *is* for placement, who owns it, and which
 * cut dimension runs along which world axis (x = width, y = height, z = depth, front = +z).
 */
export interface RoleInfo {
  team: Team;
  visible: boolean;
  /** false = BOM line without geometry (screws, veneer, packing material). Never "unplaced". */
  geometric: boolean;
  axis: AxisMap | null;
  kind: PartKind;
}

const A = axisMapFrom;
const info = (team: Team, visible: boolean, axis: string | null, kind: PartKind = 'solid', geometric = true): RoleInfo => ({
  team,
  visible,
  geometric,
  axis: axis ? A(axis) : null,
  kind,
});

export const ROLE_INFO: Record<string, RoleInfo> = {
  top: info('design', true, 'T:y W:z L:x', 'panel'),
  topThickener: info('engineering', false, 'T:y W:z L:x', 'panel'),
  topProfile: info('design', true, 'T:y W:z L:x'),
  sidePanel: info('design', true, 'T:x W:z L:y', 'panel'),
  sideThickener: info('engineering', false, 'T:x W:z L:y', 'panel'),
  legFront: info('design', true, 'T:x W:z L:y'),
  legBack: info('design', true, 'T:x W:z L:y'),
  sideRailTop: info('engineering', true, 'T:x W:y L:z'),
  sideRailBottom: info('engineering', true, 'T:x W:y L:z'),
  sideInnerProfile: info('design', true, 'T:z W:x L:y'),
  runner: info('engineering', false, 'T:x W:y L:z'),
  runnerBlock: info('engineering', false, 'T:x W:y L:z'),
  cornerBlock: info('engineering', false, 'T:x W:z L:y'),
  block: info('engineering', false, 'T:x W:z L:y'),
  weightSkin: info('engineering', false, 'T:z W:x L:y', 'panel'),
  weightStile: info('engineering', false, 'T:z W:x L:y', 'panel'),
  weightRail: info('engineering', false, 'T:z W:y L:x', 'panel'),
  frontRail: info('design', true, 'T:y W:z L:x'),
  frontRailBottom: info('design', true, 'T:y W:z L:x'),
  frontStile: info('design', true, 'T:z W:x L:y'),
  frontProfile: info('design', true, 'T:z W:y L:x'),
  innerRail: info('engineering', false, 'T:y W:z L:x'),
  midRunner: info('engineering', false, 'T:x W:y L:z'),
  backStile: info('engineering', false, 'T:z W:x L:y'),
  backRail: info('engineering', false, 'T:z W:y L:x'),
  back: info('engineering', false, 'T:z W:x L:y', 'panel'),
  dustPanel: info('engineering', false, 'T:y W:z L:x', 'panel'),
  bottomPanel: info('engineering', false, 'T:y W:z L:x', 'panel'),
  centerSupport: info('engineering', false, 'T:x W:y L:z'),
  centerLeg: info('engineering', false, 'T:x W:y L:z'),
  legSupport: info('engineering', false, 'T:x W:z L:y'),
  divider: info('engineering', true, 'T:x W:z L:y', 'panel'),
  shelf: info('design', true, 'T:y W:z L:x', 'panel'),
  door: info('design', true, 'T:z W:x L:y', 'panel'),
  drawer: info('design', true, 'T:z W:y L:x', 'panel'),
  drawerFront: info('design', true, 'T:z W:y L:x', 'panel'),
  drawerFrontTrim: info('design', true, 'T:z W:y L:x', 'panel'),
  drawerBoxFrontBack: info('engineering', false, 'T:z W:y L:x', 'panel'),
  drawerSide: info('engineering', false, 'T:x W:y L:z', 'panel'),
  drawerBottom: info('engineering', false, 'T:y W:z L:x', 'panel'),
  drawerBlock: info('engineering', false, 'T:x W:z L:y'),
  drawerCenterSupport: info('engineering', false, 'T:y W:x L:z'),
  profile: info('design', true, 'T:y W:z L:x'),
  apron: info('design', true, 'T:z W:y L:x'),
  tableTop: info('design', true, 'T:y W:z L:x', 'panel'),
  tableLeg: info('design', true, 'T:x W:z L:y'),
  bedPost: info('design', true, 'T:z W:x L:y'),
  bedPanel: info('design', true, 'T:z W:y L:x', 'panel'),
  bedCap: info('design', true, 'T:y W:z L:x'),
  bedCapProfile: info('design', true, 'T:y W:z L:x'),
  bedCapProfileSide: info('design', true, 'T:y W:x L:z'),
  bedAppliedRail: info('design', true, 'T:z W:y L:x'),
  bedAppliedStile: info('design', true, 'T:z W:x L:y'),
  bedAppliedProfile: info('design', true, 'T:z W:x L:y'),
  bedBackRail: info('engineering', false, 'T:z W:y L:x'),
  bedBackStile: info('engineering', false, 'T:z W:x L:y'),
  bedBackSupport: info('engineering', false, 'T:z W:y L:x'),
  stretcher: info('engineering', false, 'T:z W:y L:x'),
  stretcherBlock: info('engineering', false, 'T:x W:z L:y'),
  lowerLeg: info('design', true, 'T:z W:x L:y'),
  legThickener: info('engineering', false, 'T:x W:z L:y'),
  bedRail: info('design', true, 'T:x W:y L:z', 'panel'),
  railLining: info('design', true, 'T:x W:y L:z', 'panel'),
  slatLedger: info('engineering', false, 'T:y W:x L:z'),
  slat: info('engineering', false, 'T:y W:z L:x'),
  slatSupportLeg: info('engineering', false, 'T:x W:z L:y'),
  skidLong: info('packing', false, 'T:y W:z L:x', 'packing'),
  skidShort: info('packing', false, 'T:y W:x L:z', 'packing'),
  skidBlock: info('packing', false, 'T:y W:z L:x', 'packing'),
  weightPanel: info('engineering', false, 'T:z W:x L:y', 'panel'),
  carton: info('packing', false, null, 'packing', false),
  packingMaterial: info('packing', false, null, 'packing', false),
  veneer: info('finishing', false, null, 'veneer', false),
  slide: info('hardware', false, 'T:x W:y L:z', 'hardware'),
  handle: info('hardware', true, 'T:z W:y L:x', 'hardware'),
  knob: info('hardware', true, 'T:z W:y L:x', 'hardware'),
  hinge: info('hardware', false, null, 'hardware'),
  glide: info('hardware', false, 'T:y W:z L:x', 'hardware'),
  antiTip: info('hardware', false, null, 'hardware', false),
  counterWeight: info('hardware', false, null, 'hardware', false),
  namePlate: info('hardware', false, null, 'hardware', false),
  fastener: info('hardware', false, null, 'hardware', false),
  hardware: info('hardware', false, null, 'hardware', false),
};

export function roleInfo(role: PartRole | null | undefined): RoleInfo | null {
  return role ? ROLE_INFO[role] ?? null : null;
}

/* ------------------------------------------------------------------ */
/* Name rules                                                          */
/* ------------------------------------------------------------------ */

export interface RoleRule {
  id: string;
  /** Tested against the normalised name. */
  re: RegExp;
  /** Optional test against the normalised L1 (assembly) context. */
  ctx?: RegExp;
  role: PartRole;
  /** Skip when the name also matches this (e.g. wooden "frame peluncur" is not a metal slide). */
  notRe?: RegExp;
  /** Only for these layout families. */
  family?: string[];
  /** Overrides the role's default axis map. */
  axis?: string;
  unit?: Unit;
}

/** Ordered: first match wins. Patterns use normalised names (abbreviations expanded). */
export const ROLE_RULES: RoleRule[] = [
  // ---- hardware (ADDED COST lines) ----
  { id: 'hw-knob', notRe: /^(frame|klos|panel|papan|support|penebalan|tempelan)\b/, re: /\b(knop|knob)\b/, role: 'knob' },
  { id: 'hw-handle', notRe: /^(frame|klos|panel|papan|support|penebalan|tempelan)\b/, re: /\b(handle|pull|tarikan)\b/, role: 'handle' },
  { id: 'hw-slide', notRe: /^(frame|klos|panel|papan|support|penebalan|tempelan)\b/, re: /\b(peluncur|slide|rel laci|runner besi|ball bearing)\b/, role: 'slide', unit: 'pair' },
  { id: 'hw-hinge', notRe: /^(frame|klos|panel|papan|support|penebalan|tempelan)\b/, re: /\b(engsel|hinge)\b/, role: 'hinge' },
  { id: 'hw-glide', notRe: /^(frame|klos|panel|papan|support|penebalan|tempelan)\b/, re: /\b(glide|glider|leveler|adj)\b/, role: 'glide' },
  { id: 'hw-antitip', re: /anti ?tip/, role: 'antiTip', unit: 'set' },
  { id: 'hw-weight', re: /counter ?weight|pemberat \(?tekel|tekel|andesit/, role: 'counterWeight' },
  { id: 'hw-nameplate', re: /name ?plate/, role: 'namePlate' },
  { id: 'hw-fastener', notRe: /^(frame|klos|panel|papan|support|penebalan|tempelan)\b/, re: /\b(sekrup|screw|mur|baut|bolt|nut|batang ulir|half moon|kunci|dowel|cam lock|minifix|paku|staples?)\b/, role: 'fastener' },
  { id: 'hw-bungkus', re: /hardware bungkus/, role: 'hardware', unit: 'set' },
  // ---- packing ----
  { id: 'pk-carton', re: /\bcarton\b|\bkarton\b|\bbox\b/, role: 'carton' },
  { id: 'pk-material', re: /styrofoam|polyfoam|stiker|plakban|strech|stretch warp|wrap|straping|strapping|printing|hand tag|brosur|honeycomb|corner protector/, role: 'packingMaterial' },
  { id: 'pk-skid-long', re: /skid panjang|frame panjang skid|deckboard panjang/, role: 'skidLong' },
  { id: 'pk-skid-short', re: /skid pendek|frame pendek skid|deckboard pendek/, role: 'skidShort' },
  { id: 'pk-skid-block', re: /skid klos|klos skid|stringer/, role: 'skidBlock' },
  // ---- veneer / edging ----
  { id: 'veneer', re: /^(veneer|edging|vn)\b|\bveneer\b/, role: 'veneer' },
  // ---- drawers (L1 context laci) ----
  { id: 'dr-front-trim', re: /tempelan muka laci/, role: 'drawerFrontTrim' },
  { id: 'dr-front', re: /panel muka laci|muka laci$|^muka laci/, role: 'drawerFront' },
  { id: 'dr-box-fb', re: /papan muka belakang laci|papan (muka|belakang) laci/, role: 'drawerBoxFrontBack' },
  { id: 'dr-side', re: /papan samping laci|samping laci|laci samping/, role: 'drawerSide' },
  { id: 'dr-bottom', re: /dasar laci/, role: 'drawerBottom' },
  { id: 'dr-center', re: /support tengah laci/, role: 'drawerCenterSupport' },
  { id: 'dr-block', re: /^klos/, ctx: /laci/, role: 'drawerBlock' },
  { id: 'dr-block2', re: /klos .*laci/, role: 'drawerBlock' },
  // ---- top ----
  { id: 'top-thick-side', re: /penebalan top (samping|tengah)/, role: 'topThickener', axis: 'T:y W:x L:z' },
  { id: 'top-thick', re: /penebalan (top|panel top)/, role: 'topThickener' },
  { id: 'top-profile-side', re: /profil top samping/, role: 'topProfile', axis: 'T:y W:x L:z' },
  { id: 'top-profile', re: /profil top/, role: 'topProfile' },
  { id: 'top', re: /^(panel top|top|core panel top)\b/, role: 'top' },
  // ---- side assembly ----
  { id: 'leg-front', re: /(frame )?kaki depan/, role: 'legFront' },
  { id: 'leg-back', re: /(frame )?kaki belakang/, role: 'legBack' },
  { id: 'side-inner-profile', re: /profil tegak dalam/, role: 'sideInnerProfile' },
  { id: 'side-panel', re: /^(panel samping|dinding samping|samping)\b/, role: 'sidePanel' },
  { id: 'side-thick-v', re: /^penebalan tegak$/, ctx: /samping/, role: 'sideThickener' },
  { id: 'side-thick-h', re: /^penebalan datar$/, ctx: /samping/, role: 'sideThickener', axis: 'T:x W:y L:z' },
  { id: 'side-rail-top', re: /frame samping (datar )?atas/, role: 'sideRailTop' },
  { id: 'side-rail-bottom', re: /frame samping (datar )?bawah/, role: 'sideRailBottom' },
  { id: 'runner-block', re: /klos penahan frame peluncur/, role: 'runnerBlock' },
  { id: 'runner-mid', re: /frame peluncur tengah/, role: 'midRunner' },
  { id: 'runner', re: /frame peluncur|support rel laci|frame support rel laci/, role: 'runner' },
  // ---- counterweight panel ----
  { id: 'weight-skin', re: /panel tutup pemberat/, role: 'weightSkin' },
  { id: 'weight-stile', re: /frame rangka tegak/, ctx: /pemberat/, role: 'weightStile' },
  { id: 'weight-rail', re: /frame rangka datar/, ctx: /pemberat/, role: 'weightRail' },
  { id: 'weight-panel', re: /^panel pemberat/, role: 'weightPanel' },
  // ---- front frame ----
  { id: 'front-frame', re: /rangka depan/, role: 'frontRail' },
  { id: 'front-rail-bottom', re: /frame depan datar bawah|frame depan bawah/, role: 'frontRailBottom' },
  { id: 'front-rail', re: /frame depan datar|frame depan atas|frame depan tengah$|^frame depan$/, role: 'frontRail' },
  { id: 'front-stile', re: /frame depan tegak/, role: 'frontStile' },
  { id: 'front-profile', re: /frame profil datar|profil depan/, role: 'frontProfile' },
  { id: 'inner-rail', re: /frame datar dalam/, role: 'innerRail' },
  { id: 'corner-block', re: /klos (corner|sudut)/, role: 'cornerBlock' },
  // ---- back ----
  { id: 'back-stile', re: /frame belakang tegak/, role: 'backStile' },
  { id: 'back-rail', re: /frame belakang datar|frame belakang (atas|bawah)/, role: 'backRail' },
  { id: 'dust', re: /dust panel/, role: 'dustPanel' },
  { id: 'back', re: /dinding belakang|panel belakang/, role: 'back' },
  { id: 'bottom', re: /^panel bawah|sub panel bawah/, role: 'bottomPanel' },
  { id: 'center-support', re: /frame center bottom|frame (center|tengah) bawah|frame bawah tengah/, role: 'centerSupport' },
  { id: 'center-leg', re: /frame center leg|kaki tengah|center kaki/, role: 'centerLeg' },
  // ---- beds ----
  { id: 'bed-post', re: /frame tegak kaki (headboard|footboard)|kaki (headboard|footboard)|tiang/, role: 'bedPost' },
  { id: 'bed-panel', re: /^panel (headboard|footboard)\b/, role: 'bedPanel' },
  { id: 'bed-cap-profile-side', re: /profil cap samping/, role: 'bedCapProfileSide' },
  { id: 'bed-cap-profile', re: /profil cap/, role: 'bedCapProfile' },
  { id: 'bed-cap', re: /frame cap|cap rail|^cap\b/, role: 'bedCap' },
  { id: 'bed-applied-rail', re: /frame tempelan datar/, role: 'bedAppliedRail' },
  { id: 'bed-applied-stile', re: /frame tempelan tegak/, role: 'bedAppliedStile' },
  { id: 'bed-applied-profile', re: /profil tempelan/, role: 'bedAppliedProfile' },
  { id: 'bed-back-support', re: /frame support datar belakang/, role: 'bedBackSupport' },
  { id: 'bed-back-rail', re: /frame penebalan datar belakang/, role: 'bedBackRail' },
  { id: 'bed-back-stile', re: /frame penebalan tegak belakang/, role: 'bedBackStile' },
  { id: 'stretcher-block', re: /klos stretcher/, role: 'stretcherBlock' },
  { id: 'stretcher', re: /stretcher/, role: 'stretcher' },
  { id: 'leg-thickener', re: /penebalan kaki/, role: 'legThickener' },
  { id: 'lower-leg', re: /tonggak kaki|kaki bawah$/, role: 'lowerLeg' },
  { id: 'rail-lining', re: /penebalan side rail/, role: 'railLining' },
  { id: 'bed-rail', re: /side rail|panel side rail/, role: 'bedRail' },
  { id: 'bed-rail-panel', re: /^panel$|^komponen rel/, ctx: /side rail|^rel/, role: 'bedRail' },
  { id: 'slat-ledger', re: /klos slat|frame penahan slat|slat support|ledger/, role: 'slatLedger' },
  { id: 'slat', re: /^slats?\b|roll slat/, role: 'slat' },
  { id: 'slat-support-leg', re: /^leg support$|kaki support/, family: ['bed', 'bedComponent'], role: 'slatSupportLeg' },
  { id: 'leg-support', re: /^leg support$/, role: 'legSupport' },
  // ---- generic case / table ----
  { id: 'door', re: /^pintu\b|^door\b/, role: 'door' },
  { id: 'shelf', re: /shelf|\brak\b|panel sekat datar/, role: 'shelf' },
  { id: 'divider', re: /panel sekat|partisi|divider|dinding tengah/, role: 'divider' },
  { id: 'apron', re: /apron/, role: 'apron' },
  { id: 'table-leg', re: /komponen kaki|^kaki\b/, role: 'tableLeg' },
  { id: 'profile', re: /^(list )?profil|^list\b/, role: 'profile' },
  { id: 'drawer', re: /^laci\b/, role: 'drawer' },
  { id: 'block', re: /^klos\b|stoper|stopper/, role: 'block' },
];

export interface RoleGuess {
  role: PartRole | null;
  ruleId: string | null;
  axisMap: AxisMap | null;
  info: RoleInfo | null;
  unit: Unit | null;
  position: string | null;
}

const POSITION_WORDS = new Set(BASE_POSITIONS);

/** Capitalised position words found in a name, e.g. "frame kaki depan" → "Depan". */
export function positionFromName(normalized: string): string | null {
  const found = normalized.split(' ').filter((t) => POSITION_WORDS.has(t));
  if (!found.length) return null;
  return found.map((t) => t[0].toUpperCase() + t.slice(1)).join(' ');
}

/** Infer a placement role from a part name and its assembly context. */
export function inferRole(name: string, l1Context?: string | null, opts: { family?: string } = {}): RoleGuess {
  const n = normalizeName(name);
  const ctx = stripAssemblyPrefix(normalizeName(l1Context ?? ''));
  for (const rule of ROLE_RULES) {
    if (!rule.re.test(n)) continue;
    if (rule.notRe && rule.notRe.test(n)) continue;
    if (rule.ctx && !rule.ctx.test(ctx)) continue;
    if (rule.family && (!opts.family || !rule.family.includes(opts.family))) continue;
    const ri = roleInfo(rule.role);
    return {
      role: rule.role,
      ruleId: rule.id,
      axisMap: rule.axis ? axisMapFrom(rule.axis) : ri?.axis ?? null,
      info: ri,
      unit: rule.unit ?? null,
      position: positionFromName(n),
    };
  }
  return { role: null, ruleId: null, axisMap: null, info: null, unit: null, position: positionFromName(n) };
}

/* ------------------------------------------------------------------ */
/* Assembly (L1) roles                                                 */
/* ------------------------------------------------------------------ */

export const ASSEMBLY_RULES: { re: RegExp; role: string }[] = [
  { re: /panel top|^top\b/, role: 'top' },
  { re: /panel samping|dinding samping|^samping/, role: 'sideAssembly' },
  { re: /pemberat/, role: 'counterweight' },
  { re: /laci/, role: 'drawer' },
  { re: /pintu|door/, role: 'door' },
  { re: /panel headboard|^headboard/, role: 'headboard' },
  { re: /panel footboard|^footboard/, role: 'footboard' },
  { re: /side rail|^rail/, role: 'sideRails' },
  { re: /stretcher/, role: 'stretcher' },
  { re: /kaki bawah|^kaki/, role: 'legs' },
  { re: /pallet skid|skid/, role: 'skid' },
  { re: /hardware bungkus/, role: 'hardwarePack' },
  { re: /^body$|rangka/, role: 'body' },
];

export function inferAssemblyRole(name: string): string | null {
  const n = stripAssemblyPrefix(normalizeName(name));
  return ASSEMBLY_RULES.find((r) => r.re.test(n))?.role ?? null;
}
