'use client';
import { useMemo, useState } from 'react';
import type { RevisionContent } from '@bom/domain';
import { applyPatch, makePatch } from '@bom/domain';
import { useEditor, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api, ApiError } from '@/lib/api';

interface Preview {
  products: { sheet: string; format: string; product: { code: string; name: string; category: string; subCategory: string; family: string }; revisionLabel: string; content: RevisionContent; warnings: string[] }[];
  skippedSheets: { name: string; reason: string }[];
  workbookNotes: string[];
}

const SETTLED = new Set(['code', 'exact', 'confirmed', 'manual']);

/**
 * Import with the match preview (PRD §4): exact matches settle, fuzzy/AI ones need a person;
 * password-protected workbooks decrypt in the request and nothing is stored until "Create products".
 */
export function ImportDialog() {
  const t = useT();
  const open = useUi((s) => s.importOpen);
  const { me, live, reloadBoot } = useEditor();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pick, setPick] = useState(0);
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const cur = preview?.products[pick];
  const unsettled = useMemo(() => (cur ? cur.content.parts.filter((p) => !SETTLED.has(p.match.status)) : []), [cur]);
  if (!open) return null;
  const close = () => {
    useUi.setState({ importOpen: false });
    setPreview(null);
    setFile(null);
    setPassword('');
    setError(null);
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    if (password) fd.append('password', password);
    try {
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new ApiError(res.status, j.error);
      setPreview(j as Preview);
      setInclude(Object.fromEntries((j as Preview).products.map((_, i) => [i, true])));
      setPick(0);
    } catch (e) {
      const msg = (e as Error).message;
      if (/password/i.test(msg)) setNeedPassword(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };
  const updateContent = (i: number, content: RevisionContent) => setPreview((p) => p && { ...p, products: p.products.map((x, n) => (n === i ? { ...x, content } : x)) });
  const confirm = (partId: string, code: string, name: string) => {
    if (!cur) return;
    const patch = makePatch([{ op: 'setField', partId, field: 'stdCode', value: code }, { op: 'setField', partId, field: 'name', value: name }, { op: 'setField', partId, field: 'match', value: { ...cur.content.parts.find((p) => p.id === partId)!.match, status: 'confirmed', confirmedBy: me.id } }], 'confirm match', 'import');
    updateContent(pick, applyPatch(cur.content, patch).content);
  };
  const confirmGood = () => {
    if (!cur) return;
    let c = cur.content;
    for (const p of c.parts) {
      const best = p.match.candidates[0];
      if (!SETTLED.has(p.match.status) && best && best.score >= 0.7) c = applyPatch(c, makePatch([{ op: 'setField', partId: p.id, field: 'stdCode', value: best.stdCode }, { op: 'setField', partId: p.id, field: 'match', value: { ...p.match, status: 'confirmed', confirmedBy: me.id } }], 'confirm all', 'import')).content;
    }
    updateContent(pick, c);
  };
  const commit = async () => {
    if (!preview || !file) return;
    setBusy(true);
    try {
      const items = preview.products.filter((_, i) => include[i]).map((p) => ({ product: p.product, revisionLabel: p.revisionLabel, content: p.content }));
      const r = await api<{ created: { productId: string; revisionId: string; code: string }[] }>('/api/import/commit', { method: 'POST', json: { items, boardId: live.boardId, fileName: file.name } });
      useUi.getState().toast(`Imported ${r.created.length} product(s)`, 'success');
      await reloadBoot();
      close();
      // The board row changed on the server; in local mode pull the new frames in.
      const board = await api<{ board: { items: never[] } }>(`/api/boards/${live.boardId}`);
      live.writeItems((m) => board.board.items.forEach((it: { id: string }) => !m.has(it.id) && m.set(it.id, it as never)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-label={t('import.title')} data-testid="import-dialog">
        <header>
          {t('import.title')}
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            ✕
          </button>
        </header>
        <div className="body">
          {!preview && (
            <div className="col" style={{ maxWidth: 520 }}>
              <label className="col">
                {t('import.file')}
                <input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="import-file" />
              </label>
              {(needPassword || password) && (
                <label className="col">
                  {t('import.password')}
                  <input className="input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
              {!needPassword && (
                <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setNeedPassword(true)}>
                  The workbook has a password
                </button>
              )}
              <div className="muted" style={{ fontSize: 12 }}>The standard format (PRD §4) and the legacy breakdown form are detected per sheet. Costing columns are never read. The file and its password are not stored.</div>
              {error && <div className="chip fail" style={{ whiteSpace: 'normal' }}>{error}</div>}
            </div>
          )}
          {preview && (
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12 }}>
              <div>
                {preview.products.map((p, i) => {
                  const n = p.content.parts.filter((x) => !SETTLED.has(x.match.status)).length;
                  return (
                    <div key={i} className={`tree-node ${i === pick ? 'selected' : ''}`} onClick={() => setPick(i)}>
                      <input type="checkbox" checked={!!include[i]} onChange={(e) => setInclude((s) => ({ ...s, [i]: e.target.checked }))} onClick={(e) => e.stopPropagation()} />
                      <span className="grow ellipsis" title={p.product.name}>
                        {p.product.code}
                      </span>
                      {n ? <span className="chip warn">{n}</span> : <span className="chip ok">✓</span>}
                    </div>
                  );
                })}
                {preview.skippedSheets.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Skipped: {preview.skippedSheets.map((s) => `${s.name} (${s.reason})`).join('; ')}</div>}
              </div>
              {cur && (
                <div>
                  <div className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                    <strong>{cur.product.name}</strong>
                    <span className="chip">{cur.format}</span>
                    <span className="chip">
                      {cur.product.category} / {cur.product.subCategory}
                    </span>
                    <span className="chip">Rev {cur.revisionLabel}</span>
                    <span className="spacer" />
                    {unsettled.length > 0 && <span className="chip warn">{t('import.unsettled', { n: unsettled.length })}</span>}
                    <button className="btn small" onClick={confirmGood}>
                      {t('import.confirmAll')}
                    </button>
                  </div>
                  {cur.warnings.length > 0 && <div className="banner">{cur.warnings.join(' · ')}</div>}
                  <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
                    <table className="grid">
                      <thead>
                        <tr>
                          <th>L1</th>
                          <th>Name as imported</th>
                          <th>Match</th>
                          <th>Std Code</th>
                          <th>Candidates</th>
                          <th className="num">Qty</th>
                          <th className="num">T × W × L</th>
                          <th>Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cur.content.parts.map((p) => (
                          <tr key={p.id} className={SETTLED.has(p.match.status) ? '' : 'warn'}>
                            <td className="muted">{p.l1 ?? ''}</td>
                            <td>{p.originalName}</td>
                            <td>
                              <span className={`chip ${SETTLED.has(p.match.status) ? 'ok' : p.match.status === 'unmatched' ? 'fail' : 'warn'}`}>{p.match.status}</span>
                            </td>
                            <td className="mono">{p.stdCode ?? '—'}</td>
                            <td>
                              {!SETTLED.has(p.match.status) &&
                                p.match.candidates.slice(0, 3).map((c) => (
                                  <button key={c.stdCode} className="btn small" style={{ marginRight: 4 }} onClick={() => confirm(p.id, c.stdCode, c.name)} title={`score ${c.score.toFixed(2)}`}>
                                    {c.stdCode} {c.name} ({c.score.toFixed(2)})
                                  </button>
                                ))}
                            </td>
                            <td className="num">{p.qty}</td>
                            <td className="num mono">
                              {p.dims.T} × {p.dims.W} × {p.dims.L}
                            </td>
                            <td className="muted">{p.role ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <footer>
          {!preview ? (
            <button className="btn primary" disabled={!file || busy} onClick={upload} data-testid="import-preview">
              {busy ? t('common.loading') : t('import.preview')}
            </button>
          ) : (
            <>
              {error && <span className="chip fail">{error}</span>}
              <button className="btn" onClick={() => setPreview(null)}>
                ←
              </button>
              <button className="btn primary" disabled={busy || !Object.values(include).some(Boolean)} onClick={commit} data-testid="import-commit">
                {t('import.commit')} ({Object.values(include).filter(Boolean).length})
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
