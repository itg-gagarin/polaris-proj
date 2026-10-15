/** DXF (R12 ASCII) 2D views for AutoCAD users (PRD §10, phase 6): front, side, top laid side by side, one layer per view. */
import type { RevisionContent } from '@bom/domain';
import type { Layout } from '@bom/engine';
import { project, sheetInstances, type Projection } from './projection';

export function dxfExport(content: RevisionContent, layout: Layout, info: { title: string }): string {
  const inst = sheetInstances(layout, { hardware: false });
  const views: Projection[] = [project(inst, 'front'), project(inst, 'side'), project(inst, 'top')];
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : v);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4); // millimetres
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, views.length + 2);
  const layers = ['FRONT', 'SIDE', 'TOP', 'DIMENSIONS', 'TEXT'];
  layers.forEach((name, i) => {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, i + 1);
    g(6, 'CONTINUOUS');
  });
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const line = (layer: string, x0: number, y0: number, x1: number, y1: number) => {
    g(0, 'LINE');
    g(8, layer);
    g(10, x0);
    g(20, y0);
    g(30, 0);
    g(11, x1);
    g(21, y1);
    g(31, 0);
  };
  const label = (layer: string, x: number, y: number, h: number, s: string) => {
    g(0, 'TEXT');
    g(8, layer);
    g(10, x);
    g(20, y);
    g(30, 0);
    g(40, h);
    g(1, s.replace(/[\r\n]/g, ' '));
  };
  let ox = 0;
  views.forEach((v, k) => {
    const layer = layers[k];
    const dx = ox - v.bounds.x0;
    for (const r of v.rects) {
      line(layer, r.x0 + dx, r.y0, r.x1 + dx, r.y0);
      line(layer, r.x1 + dx, r.y0, r.x1 + dx, r.y1);
      line(layer, r.x1 + dx, r.y1, r.x0 + dx, r.y1);
      line(layer, r.x0 + dx, r.y1, r.x0 + dx, r.y0);
    }
    const w = v.bounds.x1 - v.bounds.x0;
    const h = v.bounds.y1 - v.bounds.y0;
    line('DIMENSIONS', ox, v.bounds.y0 - 60, ox + w, v.bounds.y0 - 60);
    label('DIMENSIONS', ox + w / 2 - 30, v.bounds.y0 - 100, 25, `${Math.round(w * 10) / 10}`);
    line('DIMENSIONS', ox + w + 60, v.bounds.y0, ox + w + 60, v.bounds.y1);
    label('DIMENSIONS', ox + w + 80, v.bounds.y0 + h / 2, 25, `${Math.round(h * 10) / 10}`);
    label('TEXT', ox, v.bounds.y1 + 60, 35, String(v.view).toUpperCase());
    ox += w + 400;
  });
  label('TEXT', 0, -400, 40, `${info.title} — ${content.parts.length} BOM lines — mm`);
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}
