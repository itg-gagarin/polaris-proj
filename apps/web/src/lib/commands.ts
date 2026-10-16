/**
 * AutoCAD-style command line (PRD §5): MOVE, DIM, SECTION X 300, SET W 567 … Parsing is pure so it is
 * unit-tested; the editor executes the parsed command against the selection.
 */
import type { DimKey } from '@bom/domain';
import { parseMmInput } from '@bom/domain';
import type { Lens, Shading, Tool, ViewName } from './store';

export type Command =
  | { cmd: 'set-dim'; dim: DimKey; value: number }
  | { cmd: 'set-expr'; dim: DimKey; expr: string }
  | { cmd: 'set-field'; field: 'qty' | 'finishCode' | 'material' | 'hardwareSku' | 'notes'; value: string | number }
  | { cmd: 'move'; dx: number; dy: number; dz: number }
  | { cmd: 'rotate'; axis: 'x' | 'y' | 'z'; deg: number }
  | { cmd: 'section'; axis: 'x' | 'y' | 'z'; at: number }
  | { cmd: 'section-off' }
  | { cmd: 'explode'; amount: number }
  | { cmd: 'view'; view: ViewName }
  | { cmd: 'lens'; lens: Lens }
  | { cmd: 'shade'; shading: Shading }
  | { cmd: 'select'; query: string }
  | { cmd: 'hide' }
  | { cmd: 'show' }
  | { cmd: 'isolate' }
  | { cmd: 'dim' }
  | { cmd: 'lock' }
  | { cmd: 'unlock' }
  | { cmd: 'undo' }
  | { cmd: 'redo' }
  | { cmd: 'export'; format: 'pdf' | 'glb' | 'dxf' | 'step' | 'xlsx' | 'json' }
  | { cmd: 'grid'; mm: number }
  | { cmd: 'snap'; on: boolean }
  | { cmd: 'ortho'; on: boolean }
  | { cmd: 'tool'; tool: Tool }
  | { cmd: 'frame-selection' }
  | { cmd: 'mirror' }
  | { cmd: 'array'; count: number; step: number; axis: 'x' | 'y' | 'z' }
  | { cmd: 'help' };

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string };

const ALIASES: Record<string, string> = { M: 'MOVE', RO: 'ROTATE', SEC: 'SECTION', EX: 'EXPLODE', V: 'VIEW', SH: 'SHADE', SEL: 'SELECT', ISO: 'ISOLATE', Z: 'FRAME', '?': 'HELP' };
const DIM_ALIAS: Record<string, DimKey> = { T: 'T', THICK: 'T', THICKNESS: 'T', TEBAL: 'T', W: 'W', WIDTH: 'W', LEBAR: 'W', L: 'L', LENGTH: 'L', PANJANG: 'L' };
const FIELD_ALIAS: Record<string, 'qty' | 'finishCode' | 'material' | 'hardwareSku' | 'notes'> = { QTY: 'qty', FINISH: 'finishCode', MATERIAL: 'material', SKU: 'hardwareSku', NOTE: 'notes', NOTES: 'notes' };
const VIEWS: Record<string, ViewName> = { FRONT: 'front', BACK: 'back', SIDE: 'side', RIGHT: 'side', TOP: 'top', ISO: 'iso', '1': 'front', '3': 'side', '7': 'top', '0': 'iso' };
const LENSES: Lens[] = ['finished', 'none', 'painting', 'hardware', 'engineering', 'packing'];
const SHADINGS: Shading[] = ['solid', 'material', 'wireframe', 'xray'];
const TOOLS: Tool[] = ['hand', 'select', 'rect', 'diamond', 'ellipse', 'arrow', 'line', 'pencil', 'text', 'note', 'eraser', 'laser', 'move', 'rotate', 'resize', 'measure', 'dimension', 'section', 'explode', 'addPart'];

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = parseMmInput(s);
  return v === null || !Number.isFinite(v) ? null : v;
};
const onOff = (s: string | undefined): boolean | null => (s === undefined ? null : /^(on|1|yes|true)$/i.test(s) ? true : /^(off|0|no|false)$/i.test(s) ? false : null);

export function parseCommand(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Type a command, or HELP' };
  const [head0, ...rest] = raw.split(/\s+/);
  const head = ALIASES[head0.toUpperCase()] ?? head0.toUpperCase();
  const arg = (i: number) => rest[i];
  const ARG = (i: number) => rest[i]?.toUpperCase();
  const err = (e: string): ParseResult => ({ ok: false, error: e });
  const ok = (command: Command): ParseResult => ({ ok: true, command });

  switch (head) {
    case 'SET': {
      const what = ARG(0);
      const valueText = rest.slice(1).join(' ');
      if (!what || !valueText) return err('SET <T|W|L|QTY|FINISH|MATERIAL|SKU|NOTE> <value>');
      const dim = DIM_ALIAS[what];
      if (dim) {
        if (valueText.startsWith('=')) return ok({ cmd: 'set-expr', dim, expr: valueText });
        const v = num(valueText);
        if (v === null || v <= 0) return err(`"${valueText}" is not a size in mm`);
        return ok({ cmd: 'set-dim', dim, value: v });
      }
      const field = FIELD_ALIAS[what];
      if (!field) return err(`Unknown field ${what}`);
      if (field === 'qty') {
        const q = Number(valueText);
        if (!Number.isInteger(q) || q < 0) return err('Quantity must be a whole number');
        return ok({ cmd: 'set-field', field, value: q });
      }
      return ok({ cmd: 'set-field', field, value: valueText });
    }
    case 'MOVE': {
      const [dx, dy, dz] = [num(arg(0)) ?? NaN, num(arg(1) ?? '0') ?? NaN, num(arg(2) ?? '0') ?? NaN];
      if ([dx, dy, dz].some(Number.isNaN)) return err('MOVE <dx> [dy] [dz] in mm');
      return ok({ cmd: 'move', dx, dy, dz });
    }
    case 'ROTATE': {
      const axis = arg(0)?.toLowerCase();
      const deg = Number(arg(1) ?? '90');
      if (axis !== 'x' && axis !== 'y' && axis !== 'z') return err('ROTATE <X|Y|Z> [degrees]');
      if (!Number.isFinite(deg)) return err('Degrees must be a number');
      return ok({ cmd: 'rotate', axis, deg });
    }
    case 'SECTION': {
      if (ARG(0) === 'OFF') return ok({ cmd: 'section-off' });
      const axis = arg(0)?.toLowerCase();
      const at = num(arg(1));
      if ((axis !== 'x' && axis !== 'y' && axis !== 'z') || at === null) return err('SECTION <X|Y|Z> <mm> or SECTION OFF');
      return ok({ cmd: 'section', axis, at });
    }
    case 'EXPLODE': {
      if (ARG(0) === 'OFF') return ok({ cmd: 'explode', amount: 0 });
      const a = arg(0) === undefined ? 1 : Number(arg(0));
      if (!Number.isFinite(a) || a < 0 || a > 1) return err('EXPLODE <0..1> or OFF');
      return ok({ cmd: 'explode', amount: a });
    }
    case 'VIEW': {
      const v = VIEWS[ARG(0) ?? ''];
      return v ? ok({ cmd: 'view', view: v }) : err('VIEW <FRONT|SIDE|TOP|BACK|ISO>');
    }
    case 'LENS': {
      const l = arg(0)?.toLowerCase() as Lens | undefined;
      return l && LENSES.includes(l) ? ok({ cmd: 'lens', lens: l }) : err(`LENS <${LENSES.join('|').toUpperCase()}>`);
    }
    case 'SHADE': {
      const s = (arg(0)?.toLowerCase() === 'x-ray' ? 'xray' : arg(0)?.toLowerCase()) as Shading | undefined;
      return s && SHADINGS.includes(s) ? ok({ cmd: 'shade', shading: s }) : err(`SHADE <${SHADINGS.join('|').toUpperCase()}>`);
    }
    case 'SELECT':
      return rest.length ? ok({ cmd: 'select', query: rest.join(' ') }) : err('SELECT <name or Std Code>');
    case 'HIDE':
      return ok({ cmd: 'hide' });
    case 'SHOW':
      return ok({ cmd: 'show' });
    case 'ISOLATE':
      return ok({ cmd: 'isolate' });
    case 'DIM':
    case 'MEASURE':
      return ok({ cmd: 'dim' });
    case 'LOCK':
      return ok({ cmd: 'lock' });
    case 'UNLOCK':
      return ok({ cmd: 'unlock' });
    case 'UNDO':
    case 'U':
      return ok({ cmd: 'undo' });
    case 'REDO':
      return ok({ cmd: 'redo' });
    case 'EXPORT': {
      const f = arg(0)?.toLowerCase();
      const formats = ['pdf', 'glb', 'dxf', 'step', 'xlsx', 'json'] as const;
      return f && (formats as readonly string[]).includes(f) ? ok({ cmd: 'export', format: f as (typeof formats)[number] }) : err('EXPORT <PDF|GLB|DXF|STEP|XLSX|JSON>');
    }
    case 'GRID': {
      const mm = num(arg(0));
      return mm && mm > 0 ? ok({ cmd: 'grid', mm }) : err('GRID <mm>');
    }
    case 'SNAP':
    case 'ORTHO': {
      const on = onOff(arg(0));
      if (on === null) return err(`${head} ON|OFF`);
      return ok(head === 'SNAP' ? { cmd: 'snap', on } : { cmd: 'ortho', on });
    }
    case 'TOOL': {
      const t = TOOLS.find((x) => x.toLowerCase() === arg(0)?.toLowerCase());
      return t ? ok({ cmd: 'tool', tool: t }) : err(`TOOL <${TOOLS.join('|')}>`);
    }
    case 'FRAME':
      return ok({ cmd: 'frame-selection' });
    case 'MIRROR':
      return ok({ cmd: 'mirror' });
    case 'ARRAY': {
      const count = Number(arg(0));
      const step = num(arg(1));
      const axis = (arg(2)?.toLowerCase() ?? 'x') as 'x' | 'y' | 'z';
      if (!Number.isInteger(count) || count < 2 || step === null || !['x', 'y', 'z'].includes(axis)) return err('ARRAY <count> <step mm> [X|Y|Z]');
      return ok({ cmd: 'array', count, step, axis });
    }
    case 'HELP':
      return ok({ cmd: 'help' });
    default:
      return err(`Unknown command ${head0}. Type HELP.`);
  }
}

export const HELP = [
  'SET W 567 · SET L =case.width/2 - 22.5 · SET FINISH F-12 · SET QTY 4',
  'MOVE -120 0 0 · ROTATE Y 90 · MIRROR · ARRAY 5 76 X',
  'SECTION X 300 · SECTION OFF · EXPLODE 0.5 · VIEW FRONT · LENS PAINTING · SHADE XRAY',
  'SELECT drawer front · HIDE · SHOW · ISOLATE · DIM (gap between 2 selected) · LOCK · UNLOCK',
  'UNDO · REDO · EXPORT PDF|GLB|DXF|STEP|XLSX · GRID 5 · SNAP ON · ORTHO OFF · TOOL measure',
];
