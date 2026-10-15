import type { Awareness } from 'y-protocols/awareness';

/** What each person shares live (PRD §9 multiplayer, meeting presenter view). */
export interface PresenceState {
  user: { id: string; name: string; color: string; team: string };
  /** Board coordinates. */
  cursor: { x: number; y: number } | null;
  selection: string[];
  /** Active frame and its camera, so others can follow. */
  view: { frameId: string | null; camera: { position: [number, number, number]; target: [number, number, number] } | null; board: { x: number; y: number; zoom: number } } | null;
  /** Meeting: the lead drives the shared view. */
  presenting: { meetingId: string } | null;
  following: string | null;
  laser: { x: number; y: number } | null;
  /** Live ink stroke being drawn (synced < 500 ms target). */
  ink: { points: [number, number, number][]; color: string } | null;
}

export function setPresence(aw: Awareness, patch: Partial<PresenceState>): void {
  const cur = (aw.getLocalState() as PresenceState | null) ?? ({ cursor: null, selection: [], view: null, presenting: null, following: null, laser: null, ink: null } as unknown as PresenceState);
  aw.setLocalState({ ...cur, ...patch });
}

export function peers(aw: Awareness): (PresenceState & { clientId: number })[] {
  const out: (PresenceState & { clientId: number })[] = [];
  aw.getStates().forEach((s, clientId) => {
    if (clientId !== aw.clientID && s && (s as PresenceState).user) out.push({ ...(s as PresenceState), clientId });
  });
  return out;
}

/** Follow mode: the view of the person you follow (or the presenter). */
export function followedView(aw: Awareness, userId: string): PresenceState['view'] {
  return peers(aw).find((p) => p.user.id === userId)?.view ?? null;
}

export function presenter(aw: Awareness, meetingId: string): (PresenceState & { clientId: number }) | null {
  return peers(aw).find((p) => p.presenting?.meetingId === meetingId) ?? null;
}
