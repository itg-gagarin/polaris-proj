'use client';
import { useState } from 'react';
import { useEditor, useLiveVersion, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { parseCommand } from '@/lib/commands';
import { runCommand } from '@/lib/exec';

export function BottomBar() {
  return (
    <footer className="bottombar">
      <Timeline />
      <CommandLine />
      <StatusBar />
    </footer>
  );
}

/** Revision timeline: scrub through the product's revisions; older ones show read-only in its frames. */
function Timeline() {
  const t = useT();
  const ui = useUi();
  const rev = useRevision(ui.activeRevisionId);
  const sibs = [...(rev?.bundle?.siblings ?? [])].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (!rev?.bundle) return <div className="timeline muted">{t('timeline.title')}: click a product frame</div>;
  return (
    <div className="timeline" aria-label="Revision timeline">
      <span className="muted">{t('timeline.title')}</span>
      {sibs.map((s) => (
        <button
          key={s.id}
          className={`tl-item ${s.id === rev.id ? 'current' : ''} ${ui.historyRevisionId === s.id ? 'viewing' : ''}`}
          onClick={() => useUi.setState({ historyRevisionId: s.id === rev.id || ui.historyRevisionId === s.id ? null : s.id })}
          title={`${s.state} · ${new Date(s.updatedAt).toLocaleString()}`}
        >
          {s.label}
          {s.branch ? ` (${s.branch.name})` : ''} · {s.state.replace('_', ' ')}
        </button>
      ))}
      {ui.historyRevisionId && (
        <button className="btn small" onClick={() => useUi.setState({ historyRevisionId: null })}>
          Back to live
        </button>
      )}
    </div>
  );
}

function CommandLine() {
  const t = useT();
  const { live } = useEditor();
  const [v, setV] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const run = () => {
    const r = parseCommand(v);
    if (!r.ok) return setMsg({ text: r.error, error: true });
    try {
      setMsg({ text: runCommand(r.command, { live }), error: false });
      setHist((h) => [v, ...h.filter((x) => x !== v)].slice(0, 30));
      setV('');
      setHi(-1);
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="cmdline">
      <span className="mono muted">›</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={t('cmd.placeholder')}
        aria-label="Command line"
        data-testid="command-line"
        onKeyDown={(e) => {
          if (e.key === 'Enter') run();
          if (e.key === 'ArrowUp' && hist.length) {
            const n = Math.min(hist.length - 1, hi + 1);
            setHi(n);
            setV(hist[n]);
          }
          if (e.key === 'ArrowDown') {
            const n = hi - 1;
            setHi(n);
            setV(n >= 0 ? hist[n] : '');
          }
          if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      {msg && <span className={msg.error ? 'chip fail' : 'muted'} style={{ maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-testid="command-result">{msg.text}</span>}
    </div>
  );
}

function StatusBar() {
  const t = useT();
  const ui = useUi();
  const { live } = useEditor();
  useLiveVersion();
  const rev = useRevision(ui.activeRevisionId);
  const a = rev?.analysis;
  const peers = live.peers().length + 1;
  return (
    <div className="statusbar" role="status">
      <span>{t('status.units')}</span>
      <button className={ui.snap ? 'on' : ''} onClick={() => useUi.setState({ snap: !ui.snap })} title="Object snaps (F3)">
        {t('status.snap')}
      </button>
      <button className={ui.ortho ? 'on' : ''} onClick={() => useUi.setState({ ortho: !ui.ortho })} title="Ortho lock (F8)">
        {t('status.ortho')}
      </button>
      <button onClick={() => useUi.setState({ gridMm: ui.gridMm === 1 ? 5 : ui.gridMm === 5 ? 10 : 1 })} title="Grid (1, 5 or 10 mm)">
        {t('status.grid')} {ui.gridMm} mm
      </button>
      <span>zoom {Math.round(ui.board.zoom * 100)}%</span>
      {ui.measure?.b && <span className="mono">measure ✓</span>}
      <span className="spacer" />
      {a && (
        <span className={a.summary.fail ? 'chip fail' : 'chip ok'} title={`${a.ms.toFixed(1)} ms`}>
          {t('status.checks', { fail: a.summary.fail, warn: a.summary.warn })} · {a.ms.toFixed(0)} ms
        </span>
      )}
      <span>{t('status.peers', { n: peers })}</span>
      <span>{!live.online ? t('status.offline') : live.saving ? t('status.saving') : t('status.saved')}</span>
      <span className="muted">{live.syncUrl ? 'sync: server' : 'sync: local tabs'}</span>
    </div>
  );
}
