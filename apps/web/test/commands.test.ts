import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/lib/commands';

describe('command line (PRD §5)', () => {
  it('parses the PRD examples', () => {
    expect(parseCommand('SET W 567')).toEqual({ ok: true, command: { cmd: 'set-dim', dim: 'W', value: 567 } });
    expect(parseCommand('section x 300')).toEqual({ ok: true, command: { cmd: 'section', axis: 'x', at: 300 } });
    expect(parseCommand('MOVE -120')).toEqual({ ok: true, command: { cmd: 'move', dx: -120, dy: 0, dz: 0 } });
    expect(parseCommand('DIM')).toEqual({ ok: true, command: { cmd: 'dim' } });
  });
  it('accepts expressions, Indonesian dim names and 0.1 mm input', () => {
    expect(parseCommand('SET L =case.width/2 - 22.5')).toEqual({ ok: true, command: { cmd: 'set-expr', dim: 'L', expr: '=case.width/2 - 22.5' } });
    expect(parseCommand('set panjang 590.5')).toEqual({ ok: true, command: { cmd: 'set-dim', dim: 'L', value: 590.5 } });
    expect(parseCommand('SET FINISH F-12 walnut')).toEqual({ ok: true, command: { cmd: 'set-field', field: 'finishCode', value: 'F-12 walnut' } });
  });
  it('rejects bad input with a usable message', () => {
    expect(parseCommand('SET W abc')).toMatchObject({ ok: false, error: /not a size/ });
    expect(parseCommand('SET QTY 1.5')).toMatchObject({ ok: false });
    expect(parseCommand('EXPLODE 2')).toMatchObject({ ok: false });
    expect(parseCommand('FOO')).toMatchObject({ ok: false, error: /Unknown command/ });
  });
  it('view, lens, shading, toggles, export', () => {
    expect(parseCommand('VIEW 7')).toMatchObject({ command: { cmd: 'view', view: 'top' } });
    expect(parseCommand('LENS painting')).toMatchObject({ command: { cmd: 'lens', lens: 'painting' } });
    expect(parseCommand('SHADE x-ray')).toMatchObject({ command: { cmd: 'shade', shading: 'xray' } });
    expect(parseCommand('ORTHO on')).toMatchObject({ command: { cmd: 'ortho', on: true } });
    expect(parseCommand('EXPORT step')).toMatchObject({ command: { cmd: 'export', format: 'step' } });
    expect(parseCommand('ARRAY 5 76 x')).toMatchObject({ command: { cmd: 'array', count: 5, step: 76, axis: 'x' } });
  });
});
