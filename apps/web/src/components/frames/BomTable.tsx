'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DimKey, Part, RevisionContent } from '@bom/domain';
import { fmtMm, makePatch, parseMmInput, TEAMS } from '@bom/domain';
import type { Analysis } from '@bom/engine';
import { useUi } from '@/lib/store';
import type { RevisionLive } from '@/lib/live';

interface Props {
  rev: RevisionLive;
  content: RevisionContent;
  analysis: Analysis;
  revisionId: string;
  readOnly: boolean;
}

/** BOM table frame (PRD §5): the revision's parts as an editable grid; a row highlights its part everywhere. */
export function BomTable({ rev, content, analysis, revisionId, readOnly }: Props) {
  const selection = useUi((s) => s.selection);
  const selected = new Set(selection.revisionId === revisionId ? selection.partIds : []);
  const [filter, setFilter] = useState('');
  const sev = useMemo(() => {
    const m = new Map<string, 'fail' | 'warn'>();
    for (const f of analysis.findings) {
      if (f.waived || f.severity === 'info') continue;
      for (const id of f.partIds) if (m.get(id) !== 'fail') m.set(id, f.severity);
    }
    return m;
  }, [analysis]);
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const asm = new Map(content.assemblies.map((a) => [a.id, a]));
    const by = new Map<string, Part[]>();
    for (const p of content.parts) {
      if (q && !`${p.name} ${p.originalName} ${p.stdCode ?? ''} ${p.material ?? ''} ${p.finishCode ?? ''}`.toLowerCase().includes(q)) continue;
      const k = p.assemblyId ?? '—';
      by.set(k, [...(by.get(k) ?? []), p]);
    }
    return [...by.entries()].map(([id, ps]) => ({ id, name: asm.get(id)?.name ?? (id === '—' ? 'Loose parts' : id), qty: asm.get(id)?.qty ?? 1, parts: ps }));
  }, [content, filter]);

  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected.size) return;
    const row = body.current?.querySelector<HTMLElement>(`tr[data-part="${[...selected][0]}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDim = (p: Part, dim: DimKey, raw: string) => {
    const t = raw.trim();
    if (!t || t === String(p.expressions[dim] ?? p.dims[dim])) return;
    if (t.startsWith('=')) rev.edit(makePatch([{ op: 'setExpr', partId: p.id, dim, expr: t }], `${p.name}: ${dim} ${t}`));
    else {
      const v = parseMmInput(t);
      if (v === null || v <= 0) return void useUi.getState().toast(`"${t}" is not a size in mm`, 'error');
      rev.edit(makePatch([{ op: 'setDim', partId: p.id, dim, value: v }], `${p.name}: ${dim} ${p.dims[dim]} → ${v}`));
    }
  };
  const setField = (p: Part, field: 'qty' | 'finishCode' | 'material' | 'hardwareSku', raw: string) => {
    const v = field === 'qty' ? Number(raw) : raw.trim() || null;
    if (field === 'qty' && (!Number.isInteger(v) || (v as number) < 0)) return void useUi.getState().toast('Quantity must be a whole number', 'error');
    if (v === p[field]) return;
    rev.edit(makePatch([{ op: 'setField', partId: p.id, field, value: v }], `${p.name}: ${field} → ${v ?? '—'}`));
  };

  const cell = (p: Part, dim: DimKey) => (
    <td className={`num ${p.expressions[dim] ? 'expr' : ''}`}>
      <input
        key={`${p.id}-${dim}-${p.dims[dim]}-${p.expressions[dim] ?? ''}`}
        defaultValue={p.expressions[dim] ?? fmtMm(p.dims[dim])}
        title={p.expressions[dim] ? `${p.expressions[dim]} = ${p.dims[dim]}` : `${p.dims[dim]} mm`}
        readOnly={readOnly}
        aria-label={`${p.name} ${dim}`}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        onBlur={(e) => setDim(p, dim, e.currentTarget.value)}
      />
    </td>
  );
  const text = (p: Part, field: 'finishCode' | 'material' | 'hardwareSku', w = 90) => (
    <td>
      <input key={`${p.id}-${field}-${p[field]}`} style={{ width: w, textAlign: 'left' }} defaultValue={p[field] ?? ''} readOnly={readOnly} aria-label={`${p.name} ${field}`} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} onBlur={(e) => setField(p, field, e.currentTarget.value)} />
    </td>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: 6, borderBottom: '1px solid var(--line)' }}>
        <input className="input grow" placeholder="Filter by name, Std Code, material, finish…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{content.parts.length} lines</span>
      </div>
      <div ref={body} style={{ overflow: 'auto', flex: 1 }}>
        <table className="grid" data-testid="bom-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Std Code</th>
              <th>Match</th>
              <th>Pos</th>
              <th className="num">Qty</th>
              <th className="num">T</th>
              <th className="num">W</th>
              <th className="num">L</th>
              <th>Material</th>
              <th>Finish</th>
              <th>HW SKU</th>
              <th>Team</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentRows key={g.id}>
                <tr className="l1">
                  <td colSpan={13}>
                    {g.name} {g.qty > 1 ? `× ${g.qty}` : ''}
                  </td>
                </tr>
                {g.parts.map((p) => (
                  <tr key={p.id} data-part={p.id} className={`${selected.has(p.id) ? 'selected' : ''} ${sev.get(p.id) ?? ''}`} onClick={(e) => useUi.getState().select(revisionId, [p.id], e.shiftKey)}>
                    <td title={p.originalName}>{p.name}</td>
                    <td className="mono">{p.stdCode ?? '—'}</td>
                    <td>
                      <span className={`chip ${p.match.status === 'fuzzy' || p.match.status === 'ai' ? 'warn' : p.match.status === 'unmatched' ? 'fail' : 'ok'}`}>{p.match.status}</span>
                    </td>
                    <td>{p.position ?? ''}</td>
                    <td className="num">
                      <input key={`${p.id}-qty-${p.qty}`} defaultValue={p.qty} style={{ width: 44 }} readOnly={readOnly} aria-label={`${p.name} qty`} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} onBlur={(e) => setField(p, 'qty', e.currentTarget.value)} />
                    </td>
                    {cell(p, 'T')}
                    {cell(p, 'W')}
                    {cell(p, 'L')}
                    {text(p, 'material', 120)}
                    {text(p, 'finishCode')}
                    {text(p, 'hardwareSku')}
                    <td>
                      <span className="chip" style={{ borderColor: TEAMS[p.teamOwner].color }}>{TEAMS[p.teamOwner].label.en}</span>
                    </td>
                    <td className="muted">{p.role ?? '—'}</td>
                  </tr>
                ))}
              </FragmentRows>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
