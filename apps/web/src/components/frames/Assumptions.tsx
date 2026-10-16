'use client';
import type { RevisionContent } from '@bom/domain';
import { makePatch } from '@bom/domain';
import type { Analysis } from '@bom/engine';
import type { RevisionLive } from '@/lib/live';

const CHOICES: Record<string, string[]> = {
  frontStyle: ['inset', 'overlay'],
  faceFrameCorners: ['butt-to-legs', 'as-bom'],
  boxJoint: ['dovetail', 'dowel', 'rabbet'],
  slideType: ['side-mount', 'undermount', 'wood-runner'],
  counterweight: ['true', 'false'],
  market: ['US', 'EU', 'AU', 'ID'],
  mattressSize: ['twin', 'full', 'queen', 'king', 'cal-king'],
  railAttachment: ['bolt', 'hook'],
  mattressSupport: ['slats', 'foundation', 'platform'],
};

/** Assumptions panel (PRD §8 "no silent assumptions"): every inferred choice, editable, with its source. */
export function Assumptions({ rev, content, analysis, readOnly }: { rev: RevisionLive; content: RevisionContent; analysis: Analysis; readOnly: boolean }) {
  const set = (key: string, raw: string) => {
    const prev = content.assumptions[key];
    const value: string | number | boolean = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw.trim() !== '' ? Number(raw) : raw;
    rev.edit(makePatch([{ op: 'setAssumption', key, assumption: { key, value, source: 'user', confidence: 'high', note: prev?.note } }], `Assumption ${key} → ${raw}`));
  };
  const setParam = (key: string, raw: string) => {
    const p = content.parameters[key];
    const v = Number(raw);
    rev.edit(makePatch([{ op: 'setParameter', key, parameter: { key, expr: raw.startsWith('=') ? raw : null, value: Number.isFinite(v) ? v : (p?.value ?? 0), source: 'user', note: p?.note } }], `Parameter ${key} → ${raw}`));
  };
  return (
    <div className="frame-fill" style={{ overflow: 'auto', padding: 8 }}>
      <div className="section-title">Assumptions</div>
      <table className="grid">
        <tbody>
          {Object.values(content.assumptions).map((a) => (
            <tr key={a.key}>
              <td className="mono">{a.key}</td>
              <td>
                {CHOICES[a.key] ? (
                  <select className="select" value={String(a.value)} disabled={readOnly} onChange={(e) => set(a.key, e.target.value)}>
                    {[...new Set([String(a.value), ...CHOICES[a.key]])].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input className="input" defaultValue={String(a.value)} readOnly={readOnly} onBlur={(e) => e.target.value !== String(a.value) && set(a.key, e.target.value)} />
                )}
              </td>
              <td>
                <span className={`chip ${a.source === 'user' ? 'ok' : 'warn'}`}>{a.source}</span>
              </td>
              <td className="muted">{a.confidence}</td>
              <td className="muted" style={{ whiteSpace: 'normal' }}>{a.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title">Parameters</div>
      <table className="grid">
        <tbody>
          {Object.values(content.parameters).map((p) => (
            <tr key={p.key}>
              <td className="mono">{p.key}</td>
              <td className="num">
                <input defaultValue={p.expr ?? String(p.value)} readOnly={readOnly || p.source === 'inferred'} title={p.source === 'inferred' ? 'Inferred from the BOM; edit the parts instead' : ''} onBlur={(e) => e.target.value !== (p.expr ?? String(p.value)) && setParam(p.key, e.target.value)} style={{ width: 120 }} />
              </td>
              <td className="num mono">{Math.round((analysis.content.parameters[p.key]?.value ?? p.value) * 10) / 10}</td>
              <td className="muted">{p.source}</td>
              <td className="muted" style={{ whiteSpace: 'normal' }}>{p.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
