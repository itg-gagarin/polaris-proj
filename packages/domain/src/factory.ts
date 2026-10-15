import { newId } from './ids';
import type { Part, ProductHeader, RevisionContent, LayoutFamily, Assembly } from './model';

export function emptyHeader(): ProductHeader {
  return {
    productSize: null,
    packingSizes: [],
    buyer: null,
    series: null,
    description: null,
    spec: null,
    setup: null,
    carton: null,
    sheetNote: null,
    date: null,
    netWeightKg: null,
    grossWeightKg: null,
    cbm: null,
    loadQty40HC: null,
    markets: [],
  };
}

export function emptyContent(family: LayoutFamily = 'generic'): RevisionContent {
  return { header: emptyHeader(), family, parts: [], assemblies: [], joints: [], parameters: {}, assumptions: {}, waivers: {} };
}

export function makePart(p: Partial<Part> & Pick<Part, 'originalName'>): Part {
  return {
    id: p.id ?? newId('part'),
    stdCode: null,
    match: { status: 'unmatched', score: null, candidates: [] },
    name: p.originalName,
    l1: null,
    l2: null,
    position: null,
    dims: { T: 18, W: 100, L: 100 },
    expressions: {},
    qty: 1,
    unit: 'pcs',
    kind: 'other',
    material: null,
    materialCode: null,
    finishCode: null,
    hardwareSku: null,
    teamOwner: 'engineering',
    role: null,
    roleSource: null,
    axisMap: null,
    instanceTransforms: {},
    assemblyId: null,
    locked: false,
    asymmetric: false,
    visible: null,
    notes: '',
    source: null,
    attrs: {},
    ...p,
  };
}

export function makeAssembly(a: Partial<Assembly> & Pick<Assembly, 'name'>): Assembly {
  return {
    id: a.id ?? newId('asm'),
    stdCode: null,
    originalName: a.name,
    qty: 1,
    dims: null,
    parentId: null,
    role: null,
    finishCode: null,
    transform: null,
    explodeVector: null,
    assemblyStep: null,
    notes: '',
    ...a,
  };
}
