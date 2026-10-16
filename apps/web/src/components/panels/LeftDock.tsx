'use client';
import { useMemo, useState } from 'react';
import type { FrameItem, Part } from '@bom/domain';
import { newId, TEAMS } from '@bom/domain';
import { materialColor } from '@bom/exporters/colors';
import { useEditor, useLiveVersion, usePresenceVersion, useRevision, useT } from '@/lib/editor';
import { useUi, type LeftTab, type LayerMode } from '@/lib/store';
import { usePrefs } from '@/lib/prefs';
import type { MsgKey } from '@/lib/i18n';

export function LeftDock() {
  const t = useT();
  const open = useUi((s) => s.leftOpen);
  const tab = useUi((s) => s.leftTab);
  const advanced = usePrefs((s) => s.mode) === 'advanced';
  const tabs: [LeftTab, MsgKey][] = [
    ['products', 'dock.products'],
    ['outliner', advanced ? 'dock.outliner' : 'studio.parts'],
    ...(advanced ? ([['layers', 'dock.layers']] as [LeftTab, MsgKey][]) : []),
  ];
  return (
    <aside className={`dock left float-panel ${open ? 'open' : 'closed'}`} aria-label="Left dock" data-guide="parts">
      <div className="dock-tabs" role="tablist">
        <button className="dock-tab" onClick={() => useUi.setState({ leftOpen: !open })} aria-label={open ? t('dock.collapse') : t('dock.expand')} title={open ? t('dock.collapse') : t('dock.expand')}>
          {open ? '⟨' : '⟩'}
        </button>
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" className="dock-tab" aria-selected={tab === k} onClick={() => useUi.setState({ leftTab: k, leftOpen: true })} title={t(label)}>
            {open ? t(label) : t(label)[0]}
          </button>
        ))}
      </div>
      {open && (
        <div className="dock-body">
          {tab === 'products' && <Products />}
          {tab === 'outliner' && <Outliner />}
          {tab === 'layers' && advanced && <Layers />}
        </div>
      )}
    </aside>
  );
}

function Products() {
  const { boot, live } = useEditor();
  useLiveVersion();
  const [q, setQ] = useState('');
  const byProduct = useMemo(() => {
    const m = new Map<string, typeof boot.revisions>();
    for (const r of boot.revisions) m.set(r.productId, [...(m.get(r.productId) ?? []), r]);
    return m;
  }, [boot.revisions]);
  const open = (productId: string, revisionId: string) => {
    const existing = live.items.find((i) => i.kind === 'frame' && i.revisionId === revisionId) as FrameItem | undefined;
    const b = useUi.getState().board;
    if (existing) {
      useUi.setState({ activeFrameId: existing.id, activeRevisionId: revisionId, board: { zoom: b.zoom, x: -existing.rect.x * b.zoom + 80, y: -existing.rect.y * b.zoom + 60 } });
      return;
    }
    const p = boot.products.find((x) => x.id === productId)!;
    const r = boot.revisions.find((x) => x.id === revisionId)!;
    const maxY = Math.max(0, ...live.items.map((i) => i.rect.y + Math.abs(i.rect.h)));
    const y = maxY + 120;
    const frames: FrameItem[] = [
      { id: newId('frame'), kind: 'frame', type: 'viewport', rect: { x: 0, y, w: 760, h: 560 }, z: 1, title: `3D · ${p.name}`, productId, revisionId, props: { shading: 'material' } },
      { id: newId('frame'), kind: 'frame', type: 'bom', rect: { x: 800, y, w: 1100, h: 560 }, z: 1, title: `BOM · ${p.name} ${r.label}`, productId, revisionId, props: {} },
    ];
    live.writeItems((m) => frames.forEach((f) => m.set(f.id, f)));
    useUi.setState({ activeFrameId: frames[0].id, activeRevisionId: revisionId, board: { zoom: b.zoom, x: 80, y: -y * b.zoom + 60 } });
  };
  return (
    <div>
      <input className="input" style={{ width: '100%' }} placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
      {boot.products
        .filter((p) => !q || `${p.code} ${p.name} ${p.category} ${p.subCategory}`.toLowerCase().includes(q.toLowerCase()))
        .map((p) => (
          <div key={p.id} style={{ margin: '8px 0' }}>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {p.code} · {p.category} / {p.subCategory}
              {p.componentProductIds.length ? ` · set of ${p.componentProductIds.length}` : ''}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 3 }}>
              {(byProduct.get(p.id) ?? []).map((r) => (
                <button key={r.id} className={`chip ${r.state === 'released' ? 'ok' : r.state === 'changes_requested' ? 'fail' : 'info'}`} style={{ cursor: 'pointer' }} onClick={() => open(p.id, r.id)} title={`${r.parts} lines · ${r.state}`}>
                  {r.label}
                  {r.branch ? ` (${r.branch.status})` : ''} · {r.state.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function Outliner() {
  const ui = useUi();
  const rev = useRevision(ui.activeRevisionId);
  const content = rev?.content;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const t = useT();
  const { live } = useEditor();
  usePresenceVersion();
  if (!rev || !content) return <div className="muted">Click a frame to see its parts.</div>;
  const hidden = new Set(ui.hidden[rev.id] ?? []);
  const selected = new Set(ui.selection.revisionId === rev.id ? ui.selection.partIds : []);
  // Free-text search: every word must appear in the part's names, codes, position, material or finish.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const asmName = (p: Part) => content.assemblies.find((a) => a.id === p.assemblyId)?.name ?? '';
  const hay = (p: Part) => `${p.name} ${p.originalName} ${p.stdCode ?? ''} ${p.position ?? ''} ${p.material ?? ''} ${p.finishCode ?? ''} ${p.hardwareSku ?? ''} ${p.l1 ?? ''} ${asmName(p)}`.toLowerCase();
  const shownParts = words.length ? content.parts.filter((p) => words.every((w) => hay(p).includes(w))) : content.parts;
  const peerOn = new Map<string, string>();
  for (const pr of live.peers()) if (pr.selRevisionId === rev.id) for (const id of pr.selection ?? []) peerOn.set(id, pr.user.color);
  const notesOn = new Map<string, number>();
  for (const th of rev.bundle?.threads ?? []) if (th.status === 'open' && th.anchor.kind === 'part') notesOn.set(th.anchor.partId, (notesOn.get(th.anchor.partId) ?? 0) + 1);
  const groups = new Map<string, Part[]>();
  for (const p of shownParts) groups.set(p.assemblyId ?? '—', [...(groups.get(p.assemblyId ?? '—') ?? []), p]);
  const mark = (text: string) => {
    if (!words.length) return text;
    const i = text.toLowerCase().indexOf(words[0]);
    return i < 0 ? text : (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + words[0].length)}</mark>
        {text.slice(i + words[0].length)}
      </>
    );
  };
  const asm = new Map(content.assemblies.map((a) => [a.id, a]));
  const toggleHide = (ids: string[]) => {
    const allHidden = ids.every((id) => hidden.has(id));
    useUi.setState((s) => ({ hidden: { ...s.hidden, [rev.id]: allHidden ? (s.hidden[rev.id] ?? []).filter((x) => !ids.includes(x)) : [...new Set([...(s.hidden[rev.id] ?? []), ...ids])] } }));
  };
  const lockState = (ids: string[]) => ids.every((id) => rev.locks.some((l) => l.partId === id));
  const toggleLock = (ids: string[]) => (lockState(ids) ? rev.unlock(ids) : rev.lock(ids));
  const unplaced = new Set(rev.analysis?.layout.unplaced.map((u) => u.partId) ?? []);
  return (
    <div data-testid="outliner">
      <div className="part-search">
        <input
          className="input"
          type="search"
          placeholder={t('studio.findPart')}
          aria-label={t('studio.findPart')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shownParts[0]) ui.select(rev.id, [shownParts[0].id]);
            if (e.key === 'Escape') setQ('');
          }}
          data-testid="part-search"
        />
        {words.length > 0 && <span className="muted search-count">{t('studio.found', { n: shownParts.length })}</span>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {content.header.description ?? ''} · {content.parts.length} lines · {content.assemblies.length} assemblies
      </div>
      {words.length > 0 && !shownParts.length && <div className="muted">{t('studio.noneFound')}</div>}
      {[...groups.entries()].map(([aid, ps]) => {
        const a = asm.get(aid);
        const ids = ps.map((p) => p.id);
        return (
          <div key={aid}>
            <div className={`tree-node ${ui.enteredAssembly === aid ? 'selected' : ''}`} onClick={() => ui.select(rev.id, ids)} onDoubleClick={() => useUi.setState({ enteredAssembly: aid })}>
              <button className="icon-btn" onClick={(e) => (e.stopPropagation(), setCollapsed((c) => ({ ...c, [aid]: !c[aid] })))} aria-label="Expand">
                {collapsed[aid] ? '▸' : '▾'}
              </button>
              <strong className="grow ellipsis">{a?.name ?? 'Loose parts'}</strong>
              {a && a.qty > 1 && <span className="muted">×{a.qty}</span>}
              <button className="icon-btn" title="Show / hide" onClick={(e) => (e.stopPropagation(), toggleHide(ids))}>
                {ids.every((id) => hidden.has(id)) ? '◌' : '◉'}
              </button>
              <button className="icon-btn" title="Lock / unlock" onClick={(e) => (e.stopPropagation(), toggleLock(ids))}>
                {lockState(ids) ? '🔒' : '🔓'}
              </button>
            </div>
            {(!collapsed[aid] || words.length > 0) &&
              ps.map((p) => {
                const lock = rev.locks.find((l) => l.partId === p.id);
                return (
                  <div key={p.id} className={`tree-node ${selected.has(p.id) ? 'selected' : ''}`} style={{ paddingLeft: 22 }} onClick={(e) => ui.select(rev.id, [p.id], e.shiftKey)} title={`${p.originalName} · ${p.stdCode ?? 'no Std Code'}`}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: materialColor(p), flex: '0 0 8px' }} />
                    <span className="grow ellipsis">
                      {mark(p.name)}
                      {p.position ? <> · {mark(p.position)}</> : ''}
                      {words.length > 0 && p.stdCode && words.some((w) => p.stdCode!.toLowerCase().includes(w)) ? <span className="mono muted"> · {mark(p.stdCode)}</span> : null}
                    </span>
                    {peerOn.get(p.id) ? <span className="peer-dot" style={{ background: peerOn.get(p.id) }} title="Selected by someone else" /> : null}
                    {notesOn.get(p.id) ? <span className="note-badge" title={t('studio.notes')}>💬 {notesOn.get(p.id)}</span> : null}
                    {unplaced.has(p.id) && <span className="chip warn" title="In the Unplaced tray">tray</span>}
                    <span className="muted">×{p.qty}</span>
                    <button className="icon-btn" onClick={(e) => (e.stopPropagation(), toggleHide([p.id]))}>
                      {hidden.has(p.id) ? '◌' : '◉'}
                    </button>
                    <button className="icon-btn" title={lock ? `Locked by ${lock.userName}` : 'Lock'} onClick={(e) => (e.stopPropagation(), toggleLock([p.id]))}>
                      {lock ? '🔒' : '🔓'}
                    </button>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

function Layers() {
  const ui = useUi();
  const rev = useRevision(ui.activeRevisionId);
  if (!rev?.content) return <div className="muted">Click a frame to see its layers.</div>;
  const keyOf = (p: Part) => (ui.layerMode === 'team' ? `team:${p.teamOwner}` : ui.layerMode === 'material' ? `mat:${p.material ?? p.kind}` : `l1:${p.l1 ?? '—'}`);
  const layers = new Map<string, { label: string; color: string; count: number }>();
  for (const p of rev.content.parts) {
    const k = keyOf(p);
    const cur = layers.get(k);
    const label = ui.layerMode === 'team' ? TEAMS[p.teamOwner].label.en : ui.layerMode === 'material' ? (p.material ?? p.kind) : (p.l1 ?? '—');
    const color = ui.layerMode === 'team' ? TEAMS[p.teamOwner].color : materialColor(p);
    layers.set(k, { label, color, count: (cur?.count ?? 0) + 1 });
  }
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        {(['team', 'material', 'l1'] as LayerMode[]).map((m) => (
          <button key={m} className={`btn small ${ui.layerMode === m ? 'primary' : ''}`} onClick={() => useUi.setState({ layerMode: m })}>
            {m === 'l1' ? 'L1' : m}
          </button>
        ))}
      </div>
      {[...layers.entries()].map(([k, l]) => (
        <div key={k} className="tree-node">
          <span style={{ width: 12, height: 12, borderRadius: 3, background: l.color }} />
          <span className="grow ellipsis">{l.label}</span>
          <span className="muted">{l.count}</span>
          <button className="icon-btn" onClick={() => useUi.setState((s) => ({ layerHidden: { ...s.layerHidden, [k]: !s.layerHidden[k] } }))}>
            {ui.layerHidden[k] ? '◌' : '◉'}
          </button>
        </div>
      ))}
    </div>
  );
}
