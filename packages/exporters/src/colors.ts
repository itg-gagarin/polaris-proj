/** Shared part colours (3D viewports, sheets, GLB). Material-ish colours by kind/role, team colours for lenses. */
import type { Part } from '@bom/domain';
import { TEAMS } from '@bom/domain';

const WOOD: Record<string, string> = {
  MAHOGANY: '#8a4b2a',
  'MIXWOOD (OFF-CUT MAHOGANY)': '#9c5e3c',
  PINE: '#d9b98b',
  'RED OAK': '#b5714b',
  JATI: '#a86b3c',
};
const PANEL: Record<string, string> = {
  'MDF E2': '#c8b79a',
  'MDF E1': '#cdbd9f',
  'PARTICLE BOARD E2': '#d4c4a0',
  'PARTICLE BOARD E1': '#d8c8a5',
  PLYWOOD: '#d6b98c',
  'LVL SENGON': '#e0c99a',
};

export function materialColor(p: Pick<Part, 'material' | 'kind' | 'role'>): string {
  if (p.kind === 'hardware') return p.role === 'slide' ? '#9ca3af' : '#6b7280';
  if (p.kind === 'packing') return '#b45309';
  if (p.material && WOOD[p.material]) return WOOD[p.material];
  if (p.material && PANEL[p.material]) return PANEL[p.material];
  return p.kind === 'solid' ? '#a0673f' : '#cbb894';
}

export function teamColor(team: keyof typeof TEAMS): string {
  return TEAMS[team].color;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
