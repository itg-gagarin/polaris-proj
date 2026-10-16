/**
 * Fasteners (screws, bolts, nuts) on the model.
 *
 * The BOM gives fastener lines as quantities only ("sekrup ×60"), never positions. So positions are
 * suggested from the placed parts: insert nuts and T-nuts at the foot of each leg (where the glide
 * screws in), hanger bolts at leg tops, connector bolts where bed rails meet posts, and screws at
 * the places a factory screws: glue blocks, runners, slides, drawer fronts. Every mark is Low
 * confidence and kept out of clash detection; what cannot be placed is counted, never dropped.
 */
import type { Part, RevisionContent, Vec3 } from '@bom/domain';
import { normalizeName } from '@bom/dictionary';
import type { Layout, PlacedInstance } from './layout/types';
import { instanceCount } from './layout/placer';

export type FastenerKind = 'screw' | 'connectorBolt' | 'hangerBolt' | 'insertNut' | 'tNut' | 'capNut' | 'tool' | 'other';
export type Axis = 'x' | 'y' | 'z';

export interface FastenerMark {
  /** `${partId}#${index}` */
  key: string;
  partId: string;
  index: number;
  kind: FastenerKind;
  /** Point on the contact face where the fastener enters. */
  at: Vec3;
  axis: Axis;
  /** Direction it is driven along the axis. */
  dir: 1 | -1;
  /** Nominal size for drawing, mm. */
  length: number;
  diameter: number;
  /** What it joins (instance keys), for the tooltip. */
  hosts: string[];
  site: FastenerSite;
}

export type FastenerSite = 'foot' | 'legTop' | 'post' | 'block' | 'runner' | 'slide' | 'drawerFront' | 'joint';

export interface FastenerLine {
  partId: string;
  kind: FastenerKind;
  qty: number;
  shown: number;
  /** Why some are not drawn (e.g. "loose in the hardware bag"). */
  note: string | null;
}

export interface FastenerPlan {
  marks: FastenerMark[];
  lines: FastenerLine[];
}

const SIZES: Record<FastenerKind, { length: number; diameter: number }> = {
  screw: { length: 30, diameter: 4 },
  connectorBolt: { length: 60, diameter: 6 },
  hangerBolt: { length: 60, diameter: 8 },
  insertNut: { length: 13, diameter: 10 },
  tNut: { length: 11, diameter: 14 },
  capNut: { length: 8, diameter: 12 },
  tool: { length: 0, diameter: 0 },
  other: { length: 20, diameter: 6 },
};

/** Classify a fastener line by its (Indonesian or English) name. */
export function classifyFastener(name: string): FastenerKind {
  const n = normalizeName(name);
  if (/\bkunci l\b|\ballen\b|\bhex key\b|\bkunci (pas|ring)\b/.test(n)) return 'tool';
  if (/\bhanger\b/.test(n)) return 'hangerBolt';
  if (/\bt ?nut\b|\bmur t\b/.test(n)) return 'tNut';
  if (/\bmur payung\b|\bcap nut\b|\bacorn\b|\bdop\b/.test(n)) return 'capNut';
  if (/\bmur nanas\b|\binsert\b|\bthreaded insert\b|\bmur tanam\b|\bhalf moon\b|\bbarrel\b|\bcross dowel\b/.test(n)) return 'insertNut';
  if (/\bhex nut\b|\bmur\b|\bnut\b/.test(n)) return 'capNut';
  if (/\bbaut\b|\bbolt\b|\bjcbc\b|\bconnector\b|\bbatang ulir\b|\bthreaded rod\b/.test(n)) return 'connectorBolt';
  if (/\bsekrup\b|\bskrup\b|\bscrew\b|\bsrew\b/.test(n)) return 'screw';
  return 'other';
}

export function isFastenerPart(p: Part): boolean {
  return p.role === 'fastener' || (p.kind === 'hardware' && classifyFastener(p.originalName) !== 'other' && !['slide', 'handle', 'knob', 'hinge', 'glide'].includes(p.role ?? ''));
}

interface Site {
  at: Vec3;
  axis: Axis;
  dir: 1 | -1;
  hosts: string[];
  site: FastenerSite;
}

const FOOT_ROLES = new Set(['legFront', 'legBack', 'centerLeg', 'legSupport', 'bedPost', 'lowerLeg', 'slatSupportLeg', 'tableLeg']);
const LEG_ROLES = new Set(['legFront', 'legBack', 'centerLeg', 'tableLeg']);
const BLOCK_ROLES = new Set(['block', 'cornerBlock', 'drawerBlock', 'stretcherBlock', 'runnerBlock']);
const RUNNER_ROLES = new Set(['runner', 'midRunner', 'slatLedger']);
const RAIL_ROLES = new Set(['bedRail', 'stretcher', 'apron', 'sideRailTop', 'sideRailBottom']);
const POST_ROLES = new Set(['bedPost', 'legFront', 'legBack', 'tableLeg']);

const center = (i: PlacedInstance): Vec3 => ({ x: (i.min.x + i.max.x) / 2, y: (i.min.y + i.max.y) / 2, z: (i.min.z + i.max.z) / 2 });

/** Contact between two boxes: the axis they touch on (gap ≤ tol) and the centre of the shared face. */
export function contact(a: PlacedInstance, b: PlacedInstance, tol = 1): { axis: Axis; at: Vec3; dir: 1 | -1; area: number; span: { u: Axis; lo: number; hi: number } } | null {
  const lo = { x: Math.max(a.min.x, b.min.x), y: Math.max(a.min.y, b.min.y), z: Math.max(a.min.z, b.min.z) };
  const hi = { x: Math.min(a.max.x, b.max.x), y: Math.min(a.max.y, b.max.y), z: Math.min(a.max.z, b.max.z) };
  const ext = { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z };
  // Touching axis: the one with the thinnest overlap (or the gap), within tolerance.
  const axes: Axis[] = ['x', 'y', 'z'];
  const axis = axes.reduce((m, k) => (ext[k] < ext[m] ? k : m), 'x' as Axis);
  if (ext[axis] < -tol || ext[axis] > tol) return null;
  const others = axes.filter((k) => k !== axis);
  if (others.some((k) => ext[k] <= 2)) return null; // edge or corner contact only
  const at = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  const dir: 1 | -1 = center(b)[axis] >= center(a)[axis] ? 1 : -1;
  const u = others.reduce((m, k) => (ext[k] > ext[m] ? k : m));
  return { axis, at, dir, area: ext[others[0]] * ext[others[1]], span: { u, lo: lo[u], hi: hi[u] } };
}

/** Points spread along the contact's long side, inset from the ends. */
function spread(c: NonNullable<ReturnType<typeof contact>>, n: number, inset = 25): Vec3[] {
  const len = c.span.hi - c.span.lo;
  const usable = Math.max(0, len - 2 * Math.min(inset, len / 4));
  const start = c.span.lo + (len - usable) / 2;
  return Array.from({ length: n }, (_, k) => ({ ...c.at, [c.span.u]: n === 1 ? (c.span.lo + c.span.hi) / 2 : start + (k * usable) / (n - 1) }));
}

/** Suggested fastener positions for every fastener line of the revision. */
export function planFasteners(content: RevisionContent, layout: Layout): FastenerPlan {
  const inst = layout.instances.filter((i) => i.source !== 'tray' && !i.packing);
  const parts = new Map(content.parts.map((p) => [p.id, p]));
  const lines = content.parts.filter((p) => isFastenerPart(p));
  const marks: FastenerMark[] = [];
  const out: FastenerLine[] = [];

  // Neighbour contacts, computed once (a few hundred instances: n² is fine).
  const contacts: { a: PlacedInstance; b: PlacedInstance; c: NonNullable<ReturnType<typeof contact>> }[] = [];
  for (let x = 0; x < inst.length; x++) {
    for (let y = x + 1; y < inst.length; y++) {
      const a = inst[x];
      const b = inst[y];
      if (a.kind === 'hardware' || b.kind === 'hardware') continue;
      const c = contact(a, b);
      if (c) contacts.push({ a, b, c });
    }
  }
  const roleOf = (i: PlacedInstance) => i.role ?? '';
  const sitesFor = (kind: FastenerKind): Site[] => {
    switch (kind) {
      case 'insertNut':
      case 'tNut': {
        // Where the glide screws into the leg: glide tops if glides are placed, else leg feet.
        const glides = inst.filter((i) => i.role === 'glide');
        const feet = glides.length ? glides.map((g) => ({ at: { ...center(g), y: g.max.y }, hosts: [g.key] })) : inst.filter((i) => FOOT_ROLES.has(roleOf(i)) && i.min.y <= 1).map((l) => ({ at: { ...center(l), y: l.min.y }, hosts: [l.key] }));
        const posts = inst.filter((i) => i.role === 'bedPost');
        const extra = kind === 'insertNut' ? (posts.length ? postSites(posts, contacts) : railEndSites(inst.filter((i) => i.role === 'bedRail'))) : [];
        return [...feet.map((f) => ({ at: f.at, axis: 'y' as Axis, dir: 1 as const, hosts: f.hosts, site: 'foot' as const })), ...extra];
      }
      case 'hangerBolt': {
        // Centre legs first, then case legs; on beds the lower legs (or slat support legs) hang from the frame.
        const pick = [inst.filter((i) => i.role === 'centerLeg'), inst.filter((i) => LEG_ROLES.has(roleOf(i))), inst.filter((i) => i.role === 'lowerLeg' || i.role === 'slatSupportLeg')].find((x) => x.length) ?? [];
        return pick.map((l) => ({ at: { ...center(l), y: l.max.y }, axis: 'y' as Axis, dir: 1 as const, hosts: [l.key], site: 'legTop' as const }));
      }
      case 'connectorBolt':
      case 'capNut': {
        const posts = postSites(inst.filter((i) => POST_ROLES.has(roleOf(i))), contacts);
        return posts.length ? posts : railEndSites(inst.filter((i) => i.role === 'bedRail'));
      }
      case 'screw':
      case 'other':
        return screwSites(contacts, inst);
      default:
        return [];
    }
  };

  for (const p of lines) {
    const kind = classifyFastener(p.originalName);
    const qty = instanceCount(p);
    if (kind === 'tool') {
      out.push({ partId: p.id, kind, qty, shown: 0, note: 'loose in the hardware bag' });
      continue;
    }
    const sites = pickSites(sitesFor(kind), qty);
    const n = sites.length;
    for (let k = 0; k < n; k++) {
      const s = sites[k];
      const size = SIZES[kind];
      marks.push({ key: `${p.id}#${k}`, partId: p.id, index: k, kind, at: s.at, axis: s.axis, dir: s.dir, length: size.length, diameter: size.diameter, hosts: s.hosts, site: s.site });
    }
    out.push({ partId: p.id, kind, qty, shown: n, note: n < qty ? `${qty - n} more than the model has places for` : null });
  }
  void parts;
  return { marks, lines: out };
}

/**
 * Choose `qty` sites: every kind of site gets its turn (round-robin over blocks, runners, slides…),
 * and within one kind the picks are spread evenly, so a short line still shows where each kind goes.
 */
function pickSites(sites: Site[], qty: number): Site[] {
  if (sites.length <= qty) return sites;
  const byKind = new Map<FastenerSite, Site[]>();
  for (const s of sites) byKind.set(s.site, [...(byKind.get(s.site) ?? []), s]);
  const groups = [...byKind.values()];
  const take = groups.map(() => 0);
  let left = qty;
  while (left > 0) {
    let moved = false;
    for (let g = 0; g < groups.length && left > 0; g++) {
      if (take[g] < groups[g].length) {
        take[g]++;
        left--;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return groups.flatMap((xs, g) => Array.from({ length: take[g] }, (_, k) => xs[take[g] === xs.length ? k : Math.floor((k * xs.length) / take[g])]));
}

/** Rail ends (side rails delivered on their own): two per end, on the end face. */
function railEndSites(rails: PlacedInstance[]): Site[] {
  const out: Site[] = [];
  for (const r of rails) {
    const along: Axis = (['x', 'y', 'z'] as Axis[]).reduce((m, k) => (r.size[k] > r.size[m] ? k : m), 'x' as Axis);
    const v: Axis = (['x', 'y', 'z'] as Axis[]).filter((k) => k !== along).reduce((m, k) => (r.size[k] > r.size[m] ? k : m));
    for (const end of [r.min[along], r.max[along]]) {
      for (const f of [0.3, 0.7]) out.push({ at: { ...center(r), [along]: end, [v]: r.min[v] + r.size[v] * f }, axis: along, dir: end === r.min[along] ? 1 : -1, hosts: [r.key], site: 'post' });
    }
  }
  return out;
}

/** Bolt positions on posts and legs: where rails meet them, else two on the inner face. */
function postSites(posts: PlacedInstance[], contacts: { a: PlacedInstance; b: PlacedInstance; c: NonNullable<ReturnType<typeof contact>> }[]): Site[] {
  const ids = new Set(posts.map((p) => p.key));
  const out: Site[] = [];
  for (const { a, b, c } of contacts) {
    const post = ids.has(a.key) ? a : ids.has(b.key) ? b : null;
    const other = post === a ? b : a;
    if (!post || !RAIL_ROLES.has(other.role ?? '')) continue;
    // Two bolts per rail end, stacked along the contact.
    for (const at of spread(c, 2, 15)) out.push({ at, axis: c.axis, dir: post === a ? c.dir : (-c.dir as 1 | -1), hosts: [post.key, other.key], site: 'post' });
  }
  // Then where the post meets the board itself (cap, panel, back rails): knock-down bolts.
  for (const { a, b, c } of contacts) {
    const post = ids.has(a.key) ? a : ids.has(b.key) ? b : null;
    const other = post === a ? b : a;
    if (!post || ids.has(other.key) || RAIL_ROLES.has(other.role ?? '') || other.kind === 'veneer' || c.area < 600) continue;
    out.push({ at: c.at, axis: c.axis, dir: post === a ? c.dir : (-c.dir as 1 | -1), hosts: [post.key, other.key], site: 'joint' });
  }
  if (out.length) return out;
  // No rails in this product (a headboard on its own): the face the side rails will bolt to.
  for (const p of posts) {
    const cz = (p.min.z + p.max.z) / 2;
    const h = p.max.y - p.min.y;
    void cz;
    for (const f of [0.25, 0.4]) out.push({ at: { x: (p.min.x + p.max.x) / 2, y: p.min.y + h * f, z: p.max.z }, axis: 'z', dir: -1, hosts: [p.key], site: 'post' });
  }
  return out;
}

/** Screw positions in the order a factory would screw: blocks, runners, slides, drawer fronts, other joints. */
function screwSites(contacts: { a: PlacedInstance; b: PlacedInstance; c: NonNullable<ReturnType<typeof contact>> }[], inst: PlacedInstance[]): Site[] {
  const buckets: Record<FastenerSite, Site[]> = { block: [], runner: [], slide: [], drawerFront: [], joint: [], foot: [], legTop: [], post: [] };
  const push = (s: Site) => buckets[s.site].push(s);
  for (const { a, b, c } of contacts) {
    const ra = a.role ?? '';
    const rb = b.role ?? '';
    const hosts = [a.key, b.key];
    if (BLOCK_ROLES.has(ra) || BLOCK_ROLES.has(rb)) {
      const block = BLOCK_ROLES.has(ra) ? a : b;
      for (const at of spread(c, 1)) push({ at, axis: c.axis, dir: block === a ? c.dir : (-c.dir as 1 | -1), hosts, site: 'block' });
    } else if (RUNNER_ROLES.has(ra) || RUNNER_ROLES.has(rb)) {
      const run = RUNNER_ROLES.has(ra) ? a : b;
      for (const at of spread(c, 2, 40)) push({ at, axis: c.axis, dir: run === a ? c.dir : (-c.dir as 1 | -1), hosts, site: 'runner' });
    } else if ((ra === 'drawerFront' && rb === 'drawerBoxFrontBack') || (rb === 'drawerFront' && ra === 'drawerBoxFrontBack')) {
      const box = ra === 'drawerBoxFrontBack' ? a : b;
      // Four screws from inside the box into the front.
      const pts = spread(c, 2, 30);
      const v: Axis = (['x', 'y', 'z'] as Axis[]).find((k) => k !== c.axis && k !== c.span.u)!;
      const vlo = Math.max(a.min[v], b.min[v]);
      const vhi = Math.min(a.max[v], b.max[v]);
      for (const p of pts) for (const f of [0.3, 0.7]) push({ at: { ...p, [v]: vlo + (vhi - vlo) * f }, axis: c.axis, dir: box === a ? c.dir : (-c.dir as 1 | -1), hosts, site: 'drawerFront' });
    } else if (a.kind !== 'veneer' && b.kind !== 'veneer' && c.area > 400) {
      push({ at: c.at, axis: c.axis, dir: c.dir, hosts, site: 'joint' });
    }
  }
  // Slides: three screws per slide into the drawer side (slides are hardware, so not in `contacts`).
  for (const s of inst.filter((i) => i.role === 'slide')) {
    const len = s.max.z - s.min.z;
    for (const f of [0.15, 0.5, 0.85]) push({ at: { x: (s.min.x + s.max.x) / 2, y: (s.min.y + s.max.y) / 2, z: s.min.z + len * f }, axis: 'x', dir: s.min.x < 0 ? 1 : 1, hosts: [s.key], site: 'slide' });
  }
  return [...buckets.block, ...buckets.runner, ...buckets.slide, ...buckets.drawerFront, ...buckets.joint];
}
