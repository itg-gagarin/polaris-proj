/**
 * ERP push (PRD §10 "later"; which ERP and which API is an open question, PRD §14).
 * We push item masters and BOMs from released revisions only; stock and costing stay in the ERP.
 */
import type { Product, Revision } from '@bom/domain';
import { materialTakeOff } from '@bom/bom-io';
import type { Fetcher, DeliveryResult } from './http';
import { defaultFetcher } from './http';

export interface ErpItem {
  itemCode: string;
  description: string;
  uom: string;
  category: string;
}

export interface ErpBomLine {
  parentItem: string;
  componentItem: string;
  description: string;
  qty: number;
  uom: string;
  sizeMm: { T: number; W: number; L: number } | null;
  material: string | null;
  finish: string | null;
}

export interface ErpPayload {
  source: 'furniture-bom-studio';
  product: ErpItem;
  revision: { label: string; releasedAt: string | null; id: string };
  components: ErpItem[];
  bom: ErpBomLine[];
  materials: { material: string; kind: string; thickness: number | null; volumeM3: number; areaM2: number }[];
}

/** Neutral payload any ERP connector maps from. Only released revisions can be pushed. */
export function erpPayload(product: Product, rev: Revision): ErpPayload {
  if (rev.state !== 'released') throw new Error('Only released revisions are pushed to the ERP');
  const lines = rev.content.parts.filter((p) => p.kind !== 'veneer');
  const code = (p: (typeof lines)[number]) => p.stdCode ? `${p.stdCode}-${p.id.slice(-6)}` : `X-${p.id.slice(-10)}`;
  return {
    source: 'furniture-bom-studio',
    product: { itemCode: product.code, description: product.name, uom: 'pcs', category: `${product.category} / ${product.subCategory}` },
    revision: { label: rev.label, releasedAt: rev.releasedAt, id: rev.id },
    components: lines.map((p) => ({ itemCode: code(p), description: p.originalName, uom: p.unit, category: p.kind })),
    bom: lines.map((p) => ({ parentItem: product.code, componentItem: code(p), description: p.originalName, qty: p.qty, uom: p.unit, sizeMm: p.kind === 'hardware' ? null : { ...p.dims }, material: p.material, finish: p.finishCode })),
    materials: materialTakeOff(rev.content),
  };
}

export interface ErpConnector {
  readonly name: string;
  push(payload: ErpPayload): Promise<DeliveryResult>;
}

/** Generic REST connector: POSTs the neutral payload to an ERP integration endpoint. */
export class RestErpConnector implements ErpConnector {
  readonly name = 'rest';
  constructor(private url: string, private token: string, private fetcher: Fetcher = defaultFetcher) {}
  async push(payload: ErpPayload): Promise<DeliveryResult> {
    const r = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(payload) });
    return { ok: r.ok, status: r.status, target: this.url };
  }
}

/** Until the ERP is chosen: write the payload as a file the ERP team can import. */
export class FileErpConnector implements ErpConnector {
  readonly name = 'file';
  readonly written: ErpPayload[] = [];
  async push(payload: ErpPayload): Promise<DeliveryResult> {
    this.written.push(payload);
    return { ok: true, status: 200, target: 'file' };
  }
}
