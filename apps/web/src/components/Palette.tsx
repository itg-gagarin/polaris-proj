'use client';
import { useMemo, useState } from 'react';
import { useEditor, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { parseCommand } from '@/lib/commands';
import { runCommand } from '@/lib/exec';
import { MARKUP_TOOLS, MODEL_TOOLS } from './Toolbar';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const recent: string[] = [];

/** Command palette (Ctrl+K): every command by name, plus recently used (PRD §6). */
export function Palette() {
  const t = useT();
  const { live } = useEditor();
  const open = useUi((s) => s.paletteOpen);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const cmd = (c: string) => () => {
    const r = parseCommand(c);
    if (r.ok) {
      try {
        useUi.getState().toast(runCommand(r.command, { live }));
      } catch (e) {
        useUi.getState().toast((e as Error).message, 'error');
      }
    }
  };
  const entries: Entry[] = useMemo(
    () => [
      ...[...MARKUP_TOOLS, ...MODEL_TOOLS].map((x) => ({ id: `tool-${x.tool}`, label: t(x.label), hint: x.key, run: () => useUi.setState({ tool: x.tool }) })),
      { id: 'ai', label: t('top.aiOptimize'), run: () => (useUi.setState({ rightTab: 'ai', rightOpen: true }), window.dispatchEvent(new CustomEvent('bom:run-ai'))) },
      { id: 'import', label: t('top.import'), run: () => useUi.setState({ importOpen: true }) },
      { id: 'review', label: t('dock.review'), run: () => useUi.setState({ rightTab: 'review', rightOpen: true }) },
      { id: 'meeting', label: t('top.meeting'), run: () => useUi.setState({ rightTab: 'meeting', rightOpen: true }) },
      { id: 'comments', label: t('dock.comments'), run: () => useUi.setState({ rightTab: 'comments', rightOpen: true }) },
      ...['VIEW FRONT', 'VIEW SIDE', 'VIEW TOP', 'VIEW ISO', 'LENS PAINTING', 'LENS HARDWARE', 'LENS ENGINEERING', 'LENS PACKING', 'LENS NONE', 'SHADE SOLID', 'SHADE MATERIAL', 'SHADE WIREFRAME', 'SHADE XRAY', 'EXPLODE 0.6', 'EXPLODE OFF', 'SECTION OFF', 'HIDE', 'SHOW', 'ISOLATE', 'LOCK', 'UNLOCK', 'DIM', 'UNDO', 'REDO', 'EXPORT PDF', 'EXPORT XLSX', 'EXPORT GLB', 'EXPORT DXF', 'EXPORT STEP', 'MIRROR', 'HELP'].map((c) => ({ id: c, label: c, run: cmd(c) })),
    ],
    [t, live], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!open) return null;
  const qq = q.toLowerCase();
  const list = (q ? entries.filter((e) => e.label.toLowerCase().includes(qq)) : [...recent.map((r) => entries.find((e) => e.id === r)).filter(Boolean) as Entry[], ...entries.filter((e) => !recent.includes(e.id))]).slice(0, 14);
  const close = () => (useUi.setState({ paletteOpen: false }), setQ(''), setI(0));
  const go = (e: Entry) => {
    recent.splice(0, recent.length, e.id, ...recent.filter((x) => x !== e.id).slice(0, 6));
    close();
    e.run();
  };
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal palette" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="body">
          <input
            autoFocus
            className="input"
            style={{ width: '100%' }}
            placeholder={t('palette.placeholder')}
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setI((x) => Math.min(list.length - 1, x + 1));
              if (e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1));
              if (e.key === 'Enter') {
                if (list[i]) go(list[i]);
                else if (q) (close(), cmd(q)());
              }
              if (e.key === 'Escape') close();
              e.stopPropagation();
            }}
          />
          <div style={{ marginTop: 8 }}>
            {list.map((e, n) => (
              <div key={e.id} className="palette-item" aria-selected={n === i} onPointerEnter={() => setI(n)} onClick={() => go(e)}>
                <span className="grow">{e.label}</span>
                {e.hint && <span className="kbd">{e.hint}</span>}
              </div>
            ))}
            {!list.length && q && <div className="muted">Enter runs “{q}” as a command</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
