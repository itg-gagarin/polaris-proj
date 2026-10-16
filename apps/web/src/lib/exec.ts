'use client';
import type { FrameItem, Part, PatchOp } from '@bom/domain';
import { makePatch, newId } from '@bom/domain';
import type { Command } from './commands';
import { HELP } from './commands';
import type { LiveWorkspace, RevisionLive } from './live';
import { useUi, FOCUS_FRAME } from './store';
import { download } from './api';

export interface ExecCtx {
  live: LiveWorkspace;
}

function activeRevision(live: LiveWorkspace): RevisionLive | null {
  const s = useUi.getState();
  const id = s.selection.revisionId ?? s.activeRevisionId;
  return id ? live.revision(id) : null;
}

/** The frame view commands act on: the active frame if it shows a model (3D or sheet), else the active revision's 3D frame. */
function activeFrame(live: LiveWorkspace): FrameItem | null {
  const s = useUi.getState();
  // One product in focus (simple layout): commands act on the focused 3D view.
  if (s.view !== 'board') return focusFrame(s.activeRevisionId);
  const f = live.items.find((i) => i.id === s.activeFrameId && i.kind === 'frame') as FrameItem | undefined;
  if (f && (f.type === 'viewport' || f.type === 'sheet')) return f;
  const revId = f?.revisionId ?? s.activeRevisionId;
  return (live.items.find((i) => i.kind === 'frame' && i.type === 'viewport' && i.revisionId === revId) as FrameItem | undefined) ?? f ?? null;
}

/** The synthetic frame the focused view renders (not stored on the board). */
export function focusFrame(revisionId: string | null): FrameItem {
  return { id: FOCUS_FRAME, kind: 'frame', type: 'viewport', rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, title: '', productId: null, revisionId, props: { shading: 'material' } };
}

function selectedParts(rev: RevisionLive | null): Part[] {
  const s = useUi.getState();
  if (!rev?.content || s.selection.revisionId !== rev.id) return [];
  const ids = new Set(s.selection.partIds);
  return rev.content.parts.filter((p) => ids.has(p.id));
}

/** Run a parsed command against the selection / active frame. Returns a message for the command line. */
export function runCommand(cmd: Command, { live }: ExecCtx): string {
  const ui = useUi.getState();
  const rev = activeRevision(live);
  const parts = selectedParts(rev);
  const frame = activeFrame(live);
  const needParts = () => {
    if (!rev || !parts.length) throw new Error('Select one or more parts first');
  };
  const view = frame ? ui.frameView(frame.id, frame.props) : null;
  const setView = (p: Parameters<typeof ui.setFrameView>[1]) => {
    if (!frame) throw new Error('Click a 3D or sheet frame first');
    ui.setFrameView(frame.id, p);
  };
  switch (cmd.cmd) {
    case 'set-dim':
      needParts();
      rev!.edit(makePatch(parts.map((p) => ({ op: 'setDim', partId: p.id, dim: cmd.dim, value: cmd.value })), `SET ${cmd.dim} ${cmd.value} on ${parts.length} part(s)`));
      return `${cmd.dim} = ${cmd.value} mm on ${parts.length} part(s)`;
    case 'set-expr':
      needParts();
      rev!.edit(makePatch(parts.map((p) => ({ op: 'setExpr', partId: p.id, dim: cmd.dim, expr: cmd.expr })), `SET ${cmd.dim} ${cmd.expr}`));
      return `${cmd.dim} follows ${cmd.expr}`;
    case 'set-field':
      needParts();
      rev!.edit(makePatch(parts.map((p) => ({ op: 'setField', partId: p.id, field: cmd.field, value: cmd.value })), `SET ${cmd.field} ${cmd.value}`));
      return `${cmd.field} = ${cmd.value}`;
    case 'move':
    case 'rotate': {
      needParts();
      const a = rev!.analysis;
      const ops: PatchOp[] = [];
      for (const p of parts) {
        const insts = a?.layout.instances.filter((i) => i.partId === p.id) ?? [];
        for (const i of insts) {
          const cur = p.instanceTransforms[i.index] ?? { position: { x: i.min.x, y: i.min.y, z: i.min.z }, rotation: { ...i.rotation } };
          const next = cmd.cmd === 'move' ? { ...cur, position: { x: cur.position.x + cmd.dx, y: cur.position.y + cmd.dy, z: cur.position.z + cmd.dz } } : { ...cur, rotation: { ...cur.rotation, [cmd.axis]: (cur.rotation[cmd.axis] + cmd.deg) % 360 } };
          ops.push({ op: 'setTransform', partId: p.id, instance: i.index, transform: next });
        }
      }
      rev!.edit(makePatch(ops, cmd.cmd === 'move' ? `MOVE ${cmd.dx} ${cmd.dy} ${cmd.dz}` : `ROTATE ${cmd.axis} ${cmd.deg}`));
      return `${cmd.cmd === 'move' ? 'Moved' : 'Rotated'} ${parts.length} part(s)`;
    }
    case 'section':
      setView({ section: { axis: cmd.axis, at: cmd.at } });
      return `Section ${cmd.axis.toUpperCase()} at ${cmd.at} mm`;
    case 'section-off':
      setView({ section: null });
      return 'Section off';
    case 'explode':
      setView({ explode: cmd.amount });
      return `Explode ${cmd.amount}`;
    case 'view':
      setView({ view: cmd.view, frameNonce: (view?.frameNonce ?? 0) + 1 });
      return `View ${cmd.view}`;
    case 'lens':
      setView({ lens: cmd.lens });
      return `Lens ${cmd.lens}`;
    case 'shade':
      setView({ shading: cmd.shading });
      return `Shading ${cmd.shading}`;
    case 'select': {
      if (!rev?.content) throw new Error('Open a revision first');
      const q = cmd.query.toLowerCase();
      const ids = rev.content.parts.filter((p) => `${p.name} ${p.originalName} ${p.stdCode ?? ''}`.toLowerCase().includes(q)).map((p) => p.id);
      ui.select(rev.id, ids);
      return `${ids.length} part(s) selected`;
    }
    case 'hide':
      needParts();
      useUi.setState((s) => ({ hidden: { ...s.hidden, [rev!.id]: [...new Set([...(s.hidden[rev!.id] ?? []), ...parts.map((p) => p.id)])] } }));
      return `Hid ${parts.length}`;
    case 'show':
      if (rev) useUi.setState((s) => ({ hidden: { ...s.hidden, [rev.id]: [] }, isolated: { ...s.isolated, [rev.id]: null } }));
      return 'All shown';
    case 'isolate':
      needParts();
      useUi.setState((s) => ({ isolated: { ...s.isolated, [rev!.id]: parts.map((p) => p.id) } }));
      return `Isolated ${parts.length}`;
    case 'dim': {
      if (!rev?.analysis || parts.length !== 2) throw new Error('Select exactly two parts to measure the clear gap');
      const box = (id: string) => {
        const is = rev.analysis!.layout.instances.filter((i) => i.partId === id);
        return { min: { x: Math.min(...is.map((i) => i.min.x)), y: Math.min(...is.map((i) => i.min.y)), z: Math.min(...is.map((i) => i.min.z)) }, max: { x: Math.max(...is.map((i) => i.max.x)), y: Math.max(...is.map((i) => i.max.y)), z: Math.max(...is.map((i) => i.max.z)) } };
      };
      const [a, b] = [box(parts[0].id), box(parts[1].id)];
      const gap = (['x', 'y', 'z'] as const).map((ax) => Math.max(0, Math.max(a.min[ax], b.min[ax]) - Math.min(a.max[ax], b.max[ax])));
      const msg = `Gap ${parts[0].name} ↔ ${parts[1].name}: X ${gap[0].toFixed(1)} · Y ${gap[1].toFixed(1)} · Z ${gap[2].toFixed(1)} mm`;
      ui.toast(msg, 'info');
      return msg;
    }
    case 'lock':
      needParts();
      rev!.lock(parts.map((p) => p.id));
      return `Locked ${parts.length}`;
    case 'unlock':
      if (rev) rev.unlock(parts.length ? parts.map((p) => p.id) : undefined);
      return 'Unlocked';
    case 'undo':
    case 'redo': {
      const target = rev?.undo && (cmd.cmd === 'undo' ? rev.undo.canUndo() : rev.undo.canRedo()) ? rev.undo : live.boardUndo;
      if (!target) return 'Nothing to undo';
      cmd.cmd === 'undo' ? target.undo() : target.redo();
      return cmd.cmd === 'undo' ? 'Undone (your own changes only)' : 'Redone';
    }
    case 'export':
      if (!rev) throw new Error('Open a revision first');
      download(`/api/revisions/${rev.id}/export?format=${cmd.format}`);
      return `Exporting ${cmd.format.toUpperCase()}`;
    case 'grid':
      useUi.setState({ gridMm: cmd.mm });
      return `Grid ${cmd.mm} mm`;
    case 'snap':
      useUi.setState({ snap: cmd.on });
      return `Snap ${cmd.on ? 'on' : 'off'}`;
    case 'ortho':
      useUi.setState({ ortho: cmd.on });
      return `Ortho ${cmd.on ? 'on' : 'off'}`;
    case 'tool':
      useUi.setState({ tool: cmd.tool });
      return `Tool ${cmd.tool}`;
    case 'frame-selection':
      setView({ frameNonce: (view?.frameNonce ?? 0) + 1 });
      return 'Framed';
    case 'mirror': {
      needParts();
      // Left/right pairs (Kanan/Kiri): duplicate as the mirrored position, or flip an existing pair's asymmetry flag.
      const ops: PatchOp[] = [];
      for (const p of parts) {
        const pos = (p.position ?? '').toLowerCase();
        const mirrored = /kanan|right/.test(pos) ? 'Kiri' : /kiri|left/.test(pos) ? 'Kanan' : null;
        if (!mirrored) continue;
        const exists = rev!.content!.parts.some((q) => q.stdCode === p.stdCode && q.assemblyId === p.assemblyId && (q.position ?? '').toLowerCase() === mirrored.toLowerCase());
        if (!exists) ops.push({ op: 'addPart', part: { ...p, id: newId('part'), position: mirrored, name: p.name.replace(/kanan|kiri/i, mirrored), originalName: `${p.originalName} (${mirrored})`, instanceTransforms: {} } });
      }
      if (!ops.length) throw new Error('Mirror works on parts with a Kanan/Kiri (right/left) position whose pair is missing');
      rev!.edit(makePatch(ops, `MIRROR ${ops.length} part(s)`));
      return `Mirrored ${ops.length}`;
    }
    case 'array': {
      needParts();
      const p = parts[0];
      const insts = rev!.analysis?.layout.instances.filter((i) => i.partId === p.id) ?? [];
      const base = insts[0];
      if (!base) throw new Error('The part has no placed instance');
      const ops: PatchOp[] = [{ op: 'setField', partId: p.id, field: 'qty', value: cmd.count }];
      for (let k = 0; k < cmd.count; k++) {
        const pos = { x: base.min.x, y: base.min.y, z: base.min.z };
        pos[cmd.axis] += k * cmd.step;
        ops.push({ op: 'setTransform', partId: p.id, instance: k, transform: { position: pos, rotation: { ...base.rotation } } });
      }
      rev!.edit(makePatch(ops, `ARRAY ${cmd.count} × ${cmd.step} ${cmd.axis.toUpperCase()}`));
      return `Array of ${cmd.count}`;
    }
    case 'help':
      return HELP.join('   |   ');
  }
}
