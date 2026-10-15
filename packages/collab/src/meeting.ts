import * as Y from 'yjs';

export interface Summon {
  meetingId: string;
  by: string;
  at: number;
  view: unknown;
}

/** "Bring everyone here": the presenter writes a summon; every follower jumps to that view. */
export function bringEveryoneHere(doc: Y.Doc, s: Summon): void {
  doc.getMap<Summon>('meeting').set('summon', s);
}

export function onSummon(doc: Y.Doc, meetingId: string, fn: (s: Summon) => void): () => void {
  const m = doc.getMap<Summon>('meeting');
  const h = () => {
    const s = m.get('summon');
    if (s && s.meetingId === meetingId) fn(s);
  };
  m.observe(h);
  return () => m.unobserve(h);
}

/** Shared ink strokes for a meeting (live; the API persists them as notes when published). */
export function meetingInk(doc: Y.Doc, meetingId: string): Y.Array<{ id: string; userId: string; partId: string | null; points: [number, number, number][]; color: string; at: number }> {
  return doc.getArray(`ink:${meetingId}`);
}
