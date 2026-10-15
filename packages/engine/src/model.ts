import type { Assembly, Part, RevisionContent, PartRole } from '@bom/domain';
import { roleInfo } from '@bom/dictionary';

/** Does the line become geometry? Screws, veneer and packing material are BOM-only lines (never "unplaced"). */
export function isGeometric(p: Part): boolean {
  if (typeof p.attrs?.geometric === 'boolean') return p.attrs.geometric as boolean;
  const ri = roleInfo(p.role);
  if (ri) return ri.geometric;
  return p.kind === 'solid' || p.kind === 'panel' || p.kind === 'other';
}

export function isVisible(p: Part): boolean {
  if (p.visible !== null && p.visible !== undefined) return p.visible;
  return roleInfo(p.role)?.visible ?? false;
}

export class ContentIndex {
  readonly parts: Part[];
  readonly byId = new Map<string, Part>();
  readonly asmById = new Map<string, Assembly>();
  readonly byRole = new Map<string, Part[]>();
  readonly asmByRole = new Map<string, Assembly[]>();

  constructor(readonly content: RevisionContent) {
    this.parts = content.parts;
    for (const p of content.parts) {
      this.byId.set(p.id, p);
      if (p.role) {
        const l = this.byRole.get(p.role) ?? [];
        l.push(p);
        this.byRole.set(p.role, l);
      }
    }
    for (const a of content.assemblies) {
      this.asmById.set(a.id, a);
      if (a.role) {
        const l = this.asmByRole.get(a.role) ?? [];
        l.push(a);
        this.asmByRole.set(a.role, l);
      }
    }
  }

  role(r: PartRole): Part[] {
    return this.byRole.get(r) ?? [];
  }

  first(r: PartRole): Part | undefined {
    return this.byRole.get(r)?.[0];
  }

  qty(r: PartRole): number {
    return this.role(r).reduce((s, p) => s + p.qty, 0);
  }

  asm(p: Part): Assembly | undefined {
    return p.assemblyId ? this.asmById.get(p.assemblyId) : undefined;
  }

  asmRole(r: string): Assembly[] {
    return this.asmByRole.get(r) ?? [];
  }

  partsOf(a: Assembly): Part[] {
    return this.parts.filter((p) => p.assemblyId === a.id);
  }

  /** Pieces of a part per instance of its assembly (e.g. 4 drawer sides over 2 drawers = 2). */
  perAssembly(p: Part): number {
    const a = this.asm(p);
    const n = a?.qty ?? 1;
    return n > 0 ? p.qty / n : p.qty;
  }
}
