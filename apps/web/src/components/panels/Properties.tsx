'use client';
import { useEffect, useMemo, useState } from 'react';
import type { DimKey, Part, PartRole, StdPart, Team } from '@bom/domain';
import { fmtMm, makePart, makePatch, parseMmInput, PART_ROLES, TEAM_IDS, TEAMS } from '@bom/domain';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api } from '@/lib/api';
import type { RevisionLive } from '@/lib/live';
import { FindingCard } from '../frames/Findings';
import { usePrefs } from '@/lib/prefs';
import { ProductSummary, SimplePartProps } from './SimpleProps';

/** Figma-style inspector (PRD §5): size, transform, material, finish, hardware, team, joints, checks. */
export function Properties() {
  const t = useT();
  const selection = useUi((s) => s.selection);
  const activeRevisionId = useUi((s) => s.activeRevisionId);
  const ui = { selection };
  const simple = usePrefs((s) => s.mode) === 'simple';
  const rev = useRevision(selection.revisionId ?? activeRevisionId);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const h = () => setAdding(true);
    window.addEventListener('bom:add-part', h);
    return () => window.removeEventListener('bom:add-part', h);
  }, []);
  if (!rev?.content) return <div className="muted">{t('props.none')}</div>;
  const parts = rev.content.parts.filter((p) => ui.selection.revisionId === rev.id && ui.selection.partIds.includes(p.id));
  if (simple)
    return (
      <div data-testid="properties">
        {parts.length === 0 && !adding && <ProductSummary rev={rev} />}
        {parts.length === 1 && <SimplePartProps rev={rev} part={parts[0]} details={<PartProps rev={rev} part={parts[0]} compact />} />}
        {parts.length > 1 && <MultiProps rev={rev} parts={parts} />}
        {adding && (
          <>
            <div className="section-title">{t('studio.addCatalogue')}</div>
            <AddPart rev={rev} onDone={() => setAdding(false)} />
          </>
        )}
      </div>
    );
  return (
    <div data-testid="properties">
      {rev.readOnly && <div className="banner">{rev.bundle?.revision.state === 'released' ? t('readonly.released') : 'Read-only for your role'}</div>}
      {parts.length === 0 && <div className="muted">{t('props.none')}</div>}
      {parts.length === 1 && <PartProps rev={rev} part={parts[0]} />}
      {parts.length > 1 && <MultiProps rev={rev} parts={parts} />}
      <div className="section-title">{t('tool.addPart')}</div>
      {!adding ? (
        <button className="btn small" onClick={() => setAdding(true)} disabled={rev.readOnly}>
          + {t('tool.addPart')} (Shift+A)
        </button>
      ) : (
        <AddPart rev={rev} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function DimInput({ rev, part, dim }: { rev: RevisionLive; part: Part; dim: DimKey }) {
  const expr = part.expressions[dim];
  const shown = expr ?? fmtMm(part.dims[dim]);
  const commit = (raw: string) => {
    const v = raw.trim();
    if (!v || v === shown) return;
    if (v.startsWith('=')) rev.edit(makePatch([{ op: 'setExpr', partId: part.id, dim, expr: v }], `${part.name}: ${dim} ${v}`));
    else {
      const n = parseMmInput(v);
      if (n === null || n <= 0) return void useUi.getState().toast(`"${v}" is not a size in mm`, 'error');
      rev.edit(makePatch([{ op: 'setDim', partId: part.id, dim, value: n }], `${part.name}: ${dim} ${part.dims[dim]} → ${n}`));
    }
  };
  return (
    <div className="dimrow">
      <label className="mono">{dim}</label>
      <input key={`${part.id}-${dim}-${shown}`} className="input mono" defaultValue={shown} title={expr ? `= ${part.dims[dim]} mm` : 'mm (0.1 mm precision); = for an expression'} readOnly={rev.readOnly} aria-label={`${dim} size`} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} onBlur={(e) => commit(e.currentTarget.value)} style={expr ? { color: 'var(--accent)' } : undefined} />
    </div>
  );
}

function Field({ rev, part, field, label }: { rev: RevisionLive; part: Part; field: 'material' | 'finishCode' | 'hardwareSku' | 'position' | 'notes'; label: string }) {
  return (
    <>
      <label>{label}</label>
      <input key={`${part.id}-${field}-${part[field]}`} className="input" defaultValue={(part[field] as string) ?? ''} readOnly={rev.readOnly} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} onBlur={(e) => {
        const v = e.currentTarget.value.trim() || null;
        if ((v ?? null) !== (part[field] ?? null)) rev.edit(makePatch([{ op: 'setField', partId: part.id, field, value: field === 'notes' ? (v ?? '') : v }], `${part.name}: ${label} → ${v ?? '—'}`));
      }} />
    </>
  );
}

/** `compact`: inside the simple inspector's "More details" (sizes, qty, material, finish and checks are shown above it). */
function PartProps({ rev, part, compact }: { rev: RevisionLive; part: Part; compact?: boolean }) {
  const t = useT();
  const { me } = useEditor();
  const a = rev.analysis;
  const findings = a?.findings.filter((f) => f.partIds.includes(part.id)) ?? [];
  const joints = rev.content!.joints.filter((j) => j.partA === part.id || j.partB === part.id);
  const lock = rev.locks.find((l) => l.partId === part.id);
  const inst = a?.layout.instances.filter((i) => i.partId === part.id) ?? [];
  const nameOf = (id: string) => rev.content!.parts.find((p) => p.id === id)?.name ?? id;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const ask = async () => {
    try {
      const r = await api<{ answer: { answer: string; citations?: string[] } | string }>('/api/ai/helper', { method: 'POST', json: { kind: 'ask', revisionId: rev.id, question, partIds: [part.id] } });
      setAnswer(typeof r.answer === 'string' ? r.answer : `${r.answer.answer}${r.answer.citations?.length ? `\n\nSources: ${r.answer.citations.join(', ')}` : ''}`);
    } catch (e) {
      setAnswer((e as Error).message);
    }
  };
  const confirm = (code: string) => rev.edit(makePatch([{ op: 'setField', partId: part.id, field: 'stdCode', value: code }, { op: 'setField', partId: part.id, field: 'match', value: { ...part.match, status: 'confirmed', confirmedBy: 'user' } }], `Confirm ${part.originalName} → ${code}`));
  return (
    <div>
      <div className="row">
        <strong className="grow">{part.name}</strong>
        {lock ? (
          <button className="btn small" onClick={() => rev.unlock([part.id])} title={t('props.lockedBy', { name: lock.userName })} disabled={lock.userId !== me.id}>
            🔒 {lock.userName.split(' ')[0]}
          </button>
        ) : (
          <button className="btn small" onClick={() => rev.lock([part.id])} disabled={rev.readOnly}>
            🔓 {t('props.lock')}
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {part.originalName} · {part.l1 ?? ''}
      </div>
      {!compact && (
        <>
          <div className="section-title">{t('props.size')}</div>
          <div className="col">
            <DimInput rev={rev} part={part} dim="T" />
            <DimInput rev={rev} part={part} dim="W" />
            <DimInput rev={rev} part={part} dim="L" />
            <div className="muted" style={{ fontSize: 11 }}>{t('props.expressionHint')}</div>
          </div>
        </>
      )}
      {compact && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('props.expressionHint')}</div>}
      <div className="kv" style={{ marginTop: 8 }}>
        {!compact && (
          <>
            <label>{t('props.qty')}</label>
            <input key={`${part.id}-qty-${part.qty}`} className="input" defaultValue={part.qty} readOnly={rev.readOnly} onBlur={(e) => {
              const q = Number(e.currentTarget.value);
              if (Number.isInteger(q) && q >= 0 && q !== part.qty) rev.edit(makePatch([{ op: 'setField', partId: part.id, field: 'qty', value: q }], `${part.name}: qty → ${q}`));
            }} />
            <Field rev={rev} part={part} field="material" label={t('props.material')} />
            <Field rev={rev} part={part} field="finishCode" label={t('props.finish')} />
          </>
        )}
        <Field rev={rev} part={part} field="hardwareSku" label={t('props.hardware')} />
        <Field rev={rev} part={part} field="position" label="Position" />
        <label>{t('props.team')}</label>
        <select className="select" value={part.teamOwner} disabled={rev.readOnly} onChange={(e) => rev.edit(makePatch([{ op: 'setField', partId: part.id, field: 'teamOwner', value: e.target.value as Team }], `${part.name}: team → ${e.target.value}`))}>
          {TEAM_IDS.map((tm) => (
            <option key={tm} value={tm}>
              {TEAMS[tm].label.en}
            </option>
          ))}
        </select>
        <label>{t('props.role')}</label>
        <select className="select" value={part.role ?? ''} disabled={rev.readOnly} onChange={(e) => rev.edit(makePatch([{ op: 'setField', partId: part.id, field: 'role', value: (e.target.value || null) as PartRole | null }], `${part.name}: role → ${e.target.value}`))}>
          <option value="">—</option>
          {PART_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <Field rev={rev} part={part} field="notes" label="Notes" />
      </div>
      <div className="section-title">{t('props.match')}</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="mono">{part.stdCode ?? '—'}</span>
        <span className={`chip ${part.match.status === 'fuzzy' || part.match.status === 'ai' ? 'warn' : part.match.status === 'unmatched' ? 'fail' : 'ok'}`}>{part.match.status}</span>
        {part.match.score !== null && <span className="muted">score {part.match.score.toFixed(2)}</span>}
      </div>
      {(part.match.status === 'fuzzy' || part.match.status === 'ai' || part.match.status === 'unmatched') &&
        part.match.candidates.slice(0, 3).map((c) => (
          <div key={c.stdCode} className="row" style={{ marginTop: 3 }}>
            <span className="grow ellipsis">
              <span className="mono">{c.stdCode}</span> {c.name}
            </span>
            <span className="muted">{c.score.toFixed(2)}</span>
            <button className="btn small" onClick={() => confirm(c.stdCode)} disabled={rev.readOnly}>
              ✓
            </button>
          </div>
        ))}
      <div className="section-title">{t('props.transform')}</div>
      {inst.slice(0, 4).map((i) => (
        <div key={i.key} className="mono muted" style={{ fontSize: 11 }}>
          #{i.index} x {Math.round(i.min.x)} y {Math.round(i.min.y)} z {Math.round(i.min.z)} · rot {i.rotation.x}/{i.rotation.y}/{i.rotation.z} · {i.source} · {i.confidence}
          {part.instanceTransforms[i.index] && (
            <button className="btn small ghost" onClick={() => rev.edit(makePatch([{ op: 'setTransform', partId: part.id, instance: i.index, transform: null }], `${part.name}: back to template position`))}>
              reset
            </button>
          )}
        </div>
      ))}
      {inst.length > 4 && <div className="muted">+{inst.length - 4} more instances</div>}
      {joints.length > 0 && (
        <>
          <div className="section-title">{t('props.joints')}</div>
          {joints.map((j) => (
            <div key={j.id} className="muted" style={{ fontSize: 12 }}>
              {j.type} with {nameOf(j.partA === part.id ? j.partB : j.partA)} · overlap ≤ {j.allowedOverlapMm} mm · {j.source}
            </div>
          ))}
        </>
      )}
      {!compact && (
        <>
          <div className="section-title">{t('props.issues')}</div>
          {findings.length ? findings.map((f) => <FindingCard key={f.key} f={f} rev={rev} revisionId={rev.id} readOnly={rev.readOnly} />) : <div className="muted">{t('findings.none')}</div>}
        </>
      )}
      <div className="section-title">{t('props.askAi')}</div>
      <div className="row">
        <input className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Why is this front red?" onKeyDown={(e) => e.key === 'Enter' && question && ask()} />
        <button className="btn small" onClick={ask} disabled={!question}>
          Ask
        </button>
      </div>
      {answer && <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{answer}</div>}
    </div>
  );
}

function MultiProps({ rev, parts }: { rev: RevisionLive; parts: Part[] }) {
  const [finish, setFinish] = useState('');
  return (
    <div>
      <strong>{parts.length} parts selected</strong>
      <div className="muted" style={{ fontSize: 12 }}>{parts.slice(0, 6).map((p) => p.name).join(', ')}{parts.length > 6 ? '…' : ''}</div>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input grow" placeholder="Finish code for all" value={finish} onChange={(e) => setFinish(e.target.value)} readOnly={rev.readOnly} />
        <button className="btn small" disabled={!finish || rev.readOnly} onClick={() => rev.edit(makePatch(parts.map((p) => ({ op: 'setField', partId: p.id, field: 'finishCode', value: finish })), `Finish ${finish} on ${parts.length} parts`))}>
          Set
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Command line: SET W 567 · SET FINISH F-12 · LOCK · ISOLATE · DIM (two parts)</div>
    </div>
  );
}

/** Add part (Shift+A): pick from the standard dictionary by category and L1, default size from Variants Seen. */
function AddPart({ rev, onDone }: { rev: RevisionLive; onDone: () => void }) {
  const { loadDictionary, products } = useEditor();
  const [dict, setDict] = useState<StdPart[] | null>(null);
  const [q, setQ] = useState('');
  const product = rev.bundle ? products.get(rev.bundle.revision.productId) : null;
  const [scoped, setScoped] = useState(true);
  useEffect(() => {
    void loadDictionary().then(setDict);
  }, [loadDictionary]);
  const sel = useUi.getState().selection;
  const selPart = rev.content!.parts.find((p) => sel.revisionId === rev.id && p.id === sel.partIds[0]);
  const list = useMemo(() => {
    if (!dict) return [];
    const qq = q.toLowerCase();
    return dict
      .filter((d) => d.level === 2 && (!scoped || !product || (d.category === product.category && d.subCategory === product.subCategory)) && (!qq || `${d.stdCode} ${d.name} ${d.l1} ${d.mergedNames.join(' ')}`.toLowerCase().includes(qq)))
      .sort((a, b) => b.fgsUsing - a.fgsUsing)
      .slice(0, 40);
  }, [dict, q, scoped, product]);
  const add = (d: StdPart) => {
    const m = d.variants.map((v) => /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(v)).find(Boolean);
    const dims = m ? { T: Number(m[1]), W: Number(m[2]), L: Number(m[3]) } : { T: 18, W: 100, L: 400 };
    const part = makePart({ originalName: d.name, name: d.name, stdCode: d.stdCode, match: { status: 'manual', score: 1, candidates: [] }, dims, qty: 1, l1: d.l1, l2: d.l2, axisMap: d.axisMap, role: d.defaultRole, roleSource: d.defaultRole ? 'dictionary' : null, teamOwner: d.ownerTeam ?? 'engineering', assemblyId: selPart?.assemblyId ?? null });
    rev.edit(makePatch([{ op: 'addPart', part }], `Add ${d.name} (${d.stdCode})`));
    useUi.getState().select(rev.id, [part.id]);
    onDone();
  };
  return (
    <div className="col">
      <div className="row">
        <input autoFocus className="input grow" placeholder="Search the standard dictionary" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn small ghost" onClick={onDone}>
          ✕
        </button>
      </div>
      <label className="row muted" style={{ fontSize: 12 }}>
        <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} /> only {product ? `${product.category} / ${product.subCategory}` : 'this category'}
      </label>
      {!dict && <div className="muted">Loading dictionary…</div>}
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        {list.map((d) => (
          <div key={d.stdCode} className="tree-node" onClick={() => add(d)} title={`${d.l1} · used by ${d.fgsUsing} products`}>
            <span className="mono">{d.stdCode}</span>
            <span className="grow ellipsis">{d.name}</span>
            <span className="muted ellipsis" style={{ maxWidth: 90 }}>{d.l1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
