import type { WorkspaceSettings } from '@bom/domain';
import { v3 } from '../geometry';
import type { ContentIndex } from '../model';
import { instanceCount, type Placer } from './placer';
import { layoutSkids } from './case';

/** Minimal table template: top on four corner legs with aprons between them. */
export function layoutTable(ix: ContentIndex, params: Record<string, number>, _s: WorkspaceSettings, pl: Placer): void {
  const top = ix.first('tableTop') ?? ix.first('top');
  const topS = top ? pl.sizeOf(top, null).size : v3(1200, 25, 800);
  const size = ix.content.header.productSize;
  const W = size?.W ?? topS.x;
  const D = size?.D ?? topS.z;
  const leg = ix.first('tableLeg');
  const legS = leg ? pl.sizeOf(leg, null).size : v3(50, 720, 50);
  const H = size?.H ?? legS.y + topS.y;
  const inset = params['leg.inset'] ?? 30;
  if (top) for (let i = 0; i < instanceCount(top); i++) pl.put(top, i, v3((W - topS.x) / 2, H - topS.y, (D - topS.z) / 2), { explode: v3(0, 220, 0), envelope: null });
  const corners = [v3(inset, 0, inset), v3(W - inset - legS.x, 0, inset), v3(inset, 0, D - inset - legS.z), v3(W - inset - legS.x, 0, D - inset - legS.z)];
  for (const p of ix.role('tableLeg')) for (let i = 0; i < instanceCount(p); i++) pl.put(p, i, corners[i % 4], { asmInstance: i, envelope: null });
  for (const p of ix.role('apron')) {
    for (let i = 0; i < instanceCount(p); i++) {
      const s = pl.sizeOf(p, null).size;
      const alongX = s.x >= s.z;
      const y = H - topS.y - s.y;
      const pos = alongX ? v3((W - s.x) / 2, y, i % 2 === 0 ? inset + legS.z / 2 - s.z / 2 : D - inset - legS.z / 2 - s.z / 2) : v3(i % 2 === 0 ? inset + legS.x / 2 - s.x / 2 : W - inset - legS.x / 2 - s.x / 2, y, (D - s.z) / 2);
      pl.put(p, i, pos, { envelope: null, confidence: 'low' });
    }
  }
  layoutSkids(ix, pl, W, D);
}
