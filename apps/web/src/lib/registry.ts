'use client';
/**
 * Frames register how to find a part on screen (projector) and which part is under a point (picker),
 * in board coordinates. Markup pinned to a part asks the projector every frame, so it moves with the
 * part (PRD §5, §6); a new note asks the picker so it pins where it lands.
 */
export type BoardPoint = { x: number; y: number };
export type Projector = (partId: string) => BoardPoint | null;
export type Picker = (p: BoardPoint) => { partId: string; revisionId: string } | null;

export const projectors = new Map<string, Projector>();
export const pickers = new Map<string, Picker>();
/** Frames that can take a camera from follow mode / "Bring everyone here". */
export const cameraSetters = new Map<string, (cam: { position: [number, number, number]; target: [number, number, number] }) => void>();
