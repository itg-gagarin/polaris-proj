import * as Y from 'yjs';
import { boardItems, revisionMaps } from './schema';

/**
 * Per-user undo: Ctrl+Z only undoes your own changes, never someone else's (PRD §6, §9).
 * Each client tracks only transactions carrying its own origin.
 */
export function createUserUndo(doc: Y.Doc, revisionIds: string[], localOrigin: unknown): Y.UndoManager {
  const scopes = [boardItems(doc), ...revisionIds.map((id) => revisionMaps(doc, id).root)] as unknown as Y.AbstractType<Y.YEvent<Y.AbstractType<unknown>>>[];
  return new Y.UndoManager(scopes, { trackedOrigins: new Set([localOrigin]), captureTimeout: 400 });
}
