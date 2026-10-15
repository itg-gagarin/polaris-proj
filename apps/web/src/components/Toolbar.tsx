'use client';
import { useState } from 'react';
import type { FrameItem, FrameType } from '@bom/domain';
import { newId } from '@bom/domain';
import { useEditor, useT } from '@/lib/editor';
import { useUi, type Tool } from '@/lib/store';
import type { MsgKey } from '@/lib/i18n';
import { Icon } from './Icon';

export const MARKUP_TOOLS: { tool: Tool; key: string; label: MsgKey }[] = [
  { tool: 'hand', key: 'H', label: 'tool.hand' },
  { tool: 'select', key: 'V', label: 'tool.select' },
  { tool: 'rect', key: 'R', label: 'tool.rect' },
  { tool: 'diamond', key: 'D', label: 'tool.diamond' },
  { tool: 'ellipse', key: 'O', label: 'tool.ellipse' },
  { tool: 'arrow', key: 'A', label: 'tool.arrow' },
  { tool: 'line', key: 'L', label: 'tool.line' },
  { tool: 'pencil', key: 'P', label: 'tool.pencil' },
  { tool: 'text', key: 'T', label: 'tool.text' },
  { tool: 'note', key: 'N', label: 'tool.note' },
  { tool: 'eraser', key: 'E', label: 'tool.eraser' },
];

export const MODEL_TOOLS: { tool: Tool; key: string; label: MsgKey }[] = [
  { tool: 'move', key: 'W', label: 'tool.move' },
  { tool: 'rotate', key: '⇧R', label: 'tool.rotate' },
  { tool: 'resize', key: 'S', label: 'tool.resize' },
  { tool: 'measure', key: 'M', label: 'tool.measure' },
  { tool: 'dimension', key: '⇧D', label: 'tool.dimension' },
  { tool: 'section', key: 'X', label: 'tool.section' },
  { tool: 'explode', key: '⇧X', label: 'tool.explode' },
  { tool: 'addPart', key: '⇧A', label: 'tool.addPart' },
];

/** Floating tool bar (PRD §6): Excalidraw keys for markup, then model tools after a divider. */
export function Toolbar() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  const locked = useUi((s) => s.toolLocked);
  const [more, setMore] = useState(false);
  const { live } = useEditor();
  const addFrame = (type: FrameType) => {
    const s = useUi.getState();
    const ref = live.items.find((i) => i.id === s.activeFrameId) as FrameItem | undefined;
    const revId = s.activeRevisionId ?? ref?.revisionId ?? null;
    const productId = ref?.productId ?? null;
    const b = s.board;
    const f: FrameItem = { id: newId('frame'), kind: 'frame', type, rect: { x: Math.round((-b.x + 120) / b.zoom), y: Math.round((-b.y + 120) / b.zoom), w: type === 'bom' ? 1100 : 760, h: 520 }, z: 1, title: `${t(`frame.${type}` as MsgKey)}${ref ? ` · ${ref.title.split('·').pop()?.trim()}` : ''}`, productId, revisionId: revId, props: type === 'compare' ? {} : {} };
    live.writeItems((m) => m.set(f.id, f));
    setMore(false);
  };
  const btn = (x: { tool: Tool; key: string; label: MsgKey }) => (
    <button key={x.tool} className="tool" aria-pressed={tool === x.tool} title={`${t(x.label)} (${x.key})`} aria-label={t(x.label)} onClick={() => useUi.setState({ tool: x.tool })} data-testid={`tool-${x.tool}`}>
      <Icon name={x.tool} />
      <span className="key">{x.key.replace('⇧', '')}</span>
    </button>
  );
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <button className="tool" aria-pressed={locked} title={`${t('tool.lock')} (Q)`} aria-label={t('tool.lock')} onClick={() => useUi.setState({ toolLocked: !locked })}>
        <Icon name="lock" />
        <span className="key">Q</span>
      </button>
      {MARKUP_TOOLS.map(btn)}
      <div style={{ position: 'relative' }}>
        <button className="tool" aria-label="More" title="More: laser pointer, frames" onClick={() => setMore((m) => !m)}>
          <Icon name="more" />
        </button>
        {more && (
          <div className="col" style={{ position: 'absolute', top: 40, left: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: 6, boxShadow: 'var(--shadow)', minWidth: 180, zIndex: 50 }}>
            <button className="btn ghost" onClick={() => (useUi.setState({ tool: 'laser' }), setMore(false))}>
              <Icon name="laser" /> {t('tool.laser')}
            </button>
            <div className="section-title">{t('tool.frame')}</div>
            {(['viewport', 'sheet', 'bom', 'compare', 'findings', 'assumptions'] as FrameType[]).map((ft) => (
              <button key={ft} className="btn ghost" onClick={() => addFrame(ft)}>
                <Icon name="frame" /> {t(`frame.${ft}` as MsgKey)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tool-divider" />
      {MODEL_TOOLS.map(btn)}
    </div>
  );
}
