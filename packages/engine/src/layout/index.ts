import type { RevisionContent, WorkspaceSettings } from '@bom/domain';
import { DEFAULT_SETTINGS } from '@bom/domain';
import { ContentIndex, isGeometric } from '../model';
import { Placer } from './placer';
import { layoutCase } from './case';
import { layoutBed } from './bed';
import { layoutTable } from './table';
import type { Layout } from './types';

export * from './types';
export { instanceCount, Placer, MAX_TRIM_MM } from './placer';

/** Place every part. Unconfirmed matches (PRD §4) and parts without a role go to the Unplaced tray. */
export function computeLayout(content: RevisionContent, params: Record<string, number>, settings: WorkspaceSettings = DEFAULT_SETTINGS, opts: { requireConfirmed?: boolean } = {}): Layout {
  const ix = new ContentIndex(content);
  const pl = new Placer(ix);
  let rows: Layout['rows'] = [];
  let caseInfo: Layout['caseInfo'] = null;
  let bedInfo: Layout['bedInfo'] = null;

  switch (content.family) {
    case 'caseWithDrawers':
    case 'caseWithDoors':
    case 'bookcase': {
      const r = layoutCase(ix, params, settings, pl);
      rows = r.rows;
      caseInfo = r.caseInfo;
      break;
    }
    case 'bed':
    case 'bedComponent':
      bedInfo = layoutBed(ix, params, settings, pl, content.family).bedInfo;
      break;
    case 'table':
      layoutTable(ix, params, settings, pl);
      break;
    default:
      break;
  }
  pl.applyExplicit();

  // PRD §4: fuzzy / AI matches need a person to confirm before the part is placed.
  if (opts.requireConfirmed) {
    const unconfirmed = new Set(content.parts.filter((p) => p.match.status === 'fuzzy' || p.match.status === 'ai').map((p) => p.id));
    pl.removeWhere((inst) => unconfirmed.has(inst.partId) && inst.source === 'template');
  }

  const unconfirmedIds = new Set(content.parts.filter((p) => opts.requireConfirmed && (p.match.status === 'fuzzy' || p.match.status === 'ai')).map((p) => p.id));
  pl.collectUnplaced((p) =>
    unconfirmedIds.has(p.id)
      ? `Std Code match not confirmed (${p.match.status}${p.match.score ? ` ${Math.round(p.match.score * 100)}%` : ''})`
      : !p.role
        ? 'No placement role — set one in Properties'
        : `The ${content.family} template has no slot for this ${p.role} (or more pieces than the layout needs)`,
  );
  const bounds = pl.bounds();
  pl.layoutTray(bounds);

  return {
    family: content.family,
    instances: pl.instances,
    unplaced: pl.unplaced,
    nonGeometric: content.parts.filter((p) => !isGeometric(p)).map((p) => p.id),
    bounds,
    rows,
    requirements: pl.requirements,
    notes: pl.notes,
    caseInfo,
    bedInfo,
  };
}
