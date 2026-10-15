export const TEAM_IDS = [
  'design',
  'engineering',
  'finishing',
  'assembly',
  'hardware',
  'packing',
  'qc',
  'ppic',
  'buyer',
] as const;
export type Team = (typeof TEAM_IDS)[number];

export interface TeamInfo {
  id: Team;
  label: { en: string; id: string };
  color: string;
  /** What the team owns (PRD section 2). */
  scope: string;
  /** External teams (buyer) never edit. */
  external?: boolean;
  /** Teams that can hold a review lane. */
  reviewLane: boolean;
}

export const TEAMS: Record<Team, TeamInfo> = {
  design: { id: 'design', label: { en: 'Design / R&D', id: 'Desain / R&D' }, color: '#3b82f6', scope: 'Overall dimensions, proportions, visible parts, fronts, top', reviewLane: true },
  engineering: { id: 'engineering', label: { en: 'Engineering', id: 'Engineering' }, color: '#8b5cf6', scope: 'Joinery, carcass, runners, internal parts, tolerances, clashes', reviewLane: true },
  finishing: { id: 'finishing', label: { en: 'Colour & finishing', id: 'Warna & finishing' }, color: '#ec4899', scope: 'Colour, finish code per visible face, sheen, veneer direction, sanding spec', reviewLane: true },
  assembly: { id: 'assembly', label: { en: 'Process assembly', id: 'Proses perakitan' }, color: '#f59e0b', scope: 'Assembly sequence, sub-assemblies, jigs, fixing order, hard-to-assemble parts', reviewLane: true },
  hardware: { id: 'hardware', label: { en: 'Hardware', id: 'Hardware' }, color: '#10b981', scope: 'Slides, hinges, knobs and handles, connectors, screws, Hardware Bungkus', reviewLane: true },
  packing: { id: 'packing', label: { en: 'Packing', id: 'Packing' }, color: '#a16207', scope: 'Pallet skid, crate, carton, knock-down state, protection', reviewLane: true },
  qc: { id: 'qc', label: { en: 'QC', id: 'QC' }, color: '#ef4444', scope: 'Checks list, tolerances, sample photos from the floor', reviewLane: true },
  ppic: { id: 'ppic', label: { en: 'PPIC / Production', id: 'PPIC / Produksi' }, color: '#64748b', scope: 'Cut list, material take-off, revision release', reviewLane: false },
  buyer: { id: 'buyer', label: { en: 'Buyer / customer', id: 'Buyer / pelanggan' }, color: '#0ea5e9', scope: 'Appearance and overall dimensions only', external: true, reviewLane: false },
};

export const ROLE_IDS = ['viewer', 'reviewer', 'editor', 'lead', 'admin'] as const;
export type Role = (typeof ROLE_IDS)[number];

export const MEETING_ROLES = ['lead', 'noteTaker', 'participant'] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];
