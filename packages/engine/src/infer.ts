/**
 * Parameters and assumptions inferred from an imported BOM. Everything inferred is shown in the
 * Assumptions panel with its source and confidence; a person can override it (source 'user').
 */
import type { Assumption, Parameter, RevisionContent, WorkspaceSettings, Confidence } from '@bom/domain';
import { DEFAULT_SETTINGS } from '@bom/domain';
import { ContentIndex } from './model';

const p = (key: string, value: number, note: string, expr: string | null = null, source: Parameter['source'] = 'inferred'): Parameter => ({ key, expr, value, source, note });
const a = (key: string, value: Assumption['value'], confidence: Confidence, note: string, source: Assumption['source'] = 'inferred'): Assumption => ({ key, value, source, confidence, note });

export interface Inferred {
  parameters: Record<string, Parameter>;
  assumptions: Record<string, Assumption>;
}

export function inferParameters(content: RevisionContent, settings: WorkspaceSettings = DEFAULT_SETTINGS): Inferred {
  const t = settings.thresholds;
  const parameters: Record<string, Parameter> = {
    reveal: p('reveal', t.reveal, 'Gap around inset fronts (workspace setting)', null, 'default'),
    slideClearance: p('slideClearance', t.slideClearance, 'Side-mount slide clearance per side (workspace setting; brand dependent)', null, 'default'),
    grooveAllowance: p('grooveAllowance', t.grooveAllowance, 'Panel edge in a groove (workspace setting)', null, 'default'),
  };
  const assumptions: Record<string, Assumption> = {};
  const size = content.header.productSize;
  const markets = content.header.markets;
  assumptions.market = markets.length
    ? a('market', markets.join(','), 'high', 'From the BOM header', 'inferred')
    : a('market', 'unknown', 'low', 'Target market not given — needed for tip-over and compliance checks (PRD §14)', 'default');

  const ix = new ContentIndex(content);
  if (content.family === 'caseWithDrawers' || content.family === 'caseWithDoors' || content.family === 'bookcase') {
    const legF = ix.first('legFront');
    const legB = ix.first('legBack');
    const prof = ix.first('sideInnerProfile');
    const sideAsm = ix.asmRole('sideAssembly')[0];
    const topAsm = ix.asmRole('top')[0];
    const W = size?.W ?? topAsm?.dims?.L ?? ix.first('top')?.dims.L ?? 600;
    const D = size?.D ?? topAsm?.dims?.W ?? ix.first('top')?.dims.W ?? 450;
    const legH = legF?.dims.L ?? sideAsm?.dims?.L ?? (size ? size.H - 20 : 700);
    const topT = (ix.first('top')?.dims.T ?? 18) + (ix.first('topThickener')?.dims.T ?? 0);
    Object.assign(parameters, {
      'case.width': p('case.width', W, size ? 'Product size (header)' : 'From the top panel'),
      'case.depth': p('case.depth', D, size ? 'Product size (header)' : 'From the top panel'),
      'case.height': p('case.height', size?.H ?? legH + topT, size ? 'Product size (header)' : 'Legs + top'),
      'leg.width': p('leg.width', legF?.dims.T ?? sideAsm?.dims?.T ?? 18, legF ? `Front leg "${legF.originalName}" T` : 'Side thickness'),
      'leg.depth': p('leg.depth', legF?.dims.W ?? 0, 'Front leg W'),
      'leg.backWidth': p('leg.backWidth', legB?.dims.T ?? legF?.dims.T ?? 0, 'Back leg T'),
      'leg.backDepth': p('leg.backDepth', legB?.dims.W ?? legF?.dims.W ?? 0, 'Back leg W'),
      'leg.height': p('leg.height', legH, legF ? `Front leg "${legF.originalName}" L` : 'Side assembly'),
      'side.thickness': p('side.thickness', sideAsm?.dims?.T ?? legF?.dims.T ?? 18, 'Side assembly T'),
      'profile.width': p('profile.width', prof?.dims.W ?? 0, prof ? `Inner front profile "${prof.originalName}" W` : 'No inner front profile'),
      'opening.width': p('opening.width', 0, 'Clear width of the drawer opening between the front profiles', 'case.width - 2*leg.width - 2*profile.width'),
      'opening.height': p('opening.height', prof?.dims.L ?? legH - topT, prof ? 'Inner front profile length (rails + fronts zone)' : 'Leg height minus top'),
      'rail.thickness': p('rail.thickness', ix.first('frontRail')?.dims.T ?? 18, 'Front rail T'),
      'stile.width': p('stile.width', ix.first('frontStile')?.dims.W ?? 0, 'Front stile W'),
      'top.thickness': p('top.thickness', topT, 'Top panel + thickener'),
    });
    const front = ix.first('drawerFront');
    const fb = ix.first('drawerBoxFrontBack');
    const side = ix.first('drawerSide');
    const bottom = ix.first('drawerBottom');
    if (front) {
      assumptions.frontStyle = a('frontStyle', 'inset', 'medium', 'Inferred: fronts are narrower than the opening (no note says overlay)');
      if (front.dims.L > (W - 2 * (legF?.dims.T ?? 0))) assumptions.frontStyle = a('frontStyle', 'overlay', 'medium', 'Inferred: fronts are wider than the opening');
    }
    if (fb && side) {
      // Box construction: which variant lets the bottom sit in grooves? (bottom L ≈ inner width + 2 × groove)
      const inside = fb.dims.L - 2 * side.dims.T + 2 * t.grooveAllowance;
      const outside = fb.dims.L + 2 * t.grooveAllowance;
      const fitInside = bottom ? Math.abs(bottom.dims.L - inside) : 0;
      const fitOutside = bottom ? Math.abs(bottom.dims.L - outside) : 1;
      const v = fitInside <= fitOutside ? 'sides-inside' : 'sides-outside';
      assumptions.boxJoint = a('boxJoint', v, bottom ? 'medium' : 'low', `Inferred from the drawer bottom width (${bottom?.dims.L ?? '—'} mm): ${v === 'sides-inside' ? 'front/back run full width, sides between them' : 'sides run full depth, front/back between them'}`);
    }
    const setup = `${content.header.setup ?? ''} ${content.header.sheetNote ?? ''}`.toLowerCase();
    if (ix.qty('slide') || /side mount|full ext/.test(setup)) {
      assumptions.slideType = a('slideType', /side mount/.test(setup) ? 'side-mount full extension' : 'side-mount', /side mount/.test(setup) ? 'high' : 'medium', content.header.setup ? `Header SET UP: ${content.header.setup}` : 'Slides on the BOM');
    }
    if (ix.qty('counterWeight') || ix.asmRole('counterweight').length) assumptions.counterweight = a('counterweight', true, 'high', 'Counterweight panel on the BOM');
  }

  if (content.family === 'bed' || content.family === 'bedComponent') {
    const desc = `${content.header.description ?? ''}`.toLowerCase();
    const sizeKey = /cal(ifornia)?[- ]?king/.test(desc) ? 'cal-king' : /king/.test(desc) ? 'king' : /queen/.test(desc) ? 'queen' : /full|double/.test(desc) ? 'full' : /twin|single/.test(desc) ? 'twin' : null;
    assumptions.mattressSize = sizeKey
      ? a('mattressSize', sizeKey, 'high', `From the product name "${content.header.description}"`)
      : a('mattressSize', 'queen', 'low', 'No bed size in the name — assumed queen');
    const m = t.mattresses[String(assumptions.mattressSize.value)];
    parameters['mattress.width'] = p('mattress.width', m?.W ?? 1524, `US ${assumptions.mattressSize.value} mattress (workspace setting)`, null, 'default');
    parameters['mattress.length'] = p('mattress.length', m?.L ?? 2032, `US ${assumptions.mattressSize.value} mattress (workspace setting)`, null, 'default');
    const railAsm = ix.asmRole('sideRails')[0];
    const ledger = ix.first('slatLedger');
    parameters['rail.envelope'] = p('rail.envelope', railAsm?.dims?.T ?? (ix.first('bedRail')?.dims.T ?? 18) + 2 * (ix.first('railLining')?.dims.T ?? 0), 'Side rail assembly thickness');
    parameters['ledger.protrusion'] = p('ledger.protrusion', ledger?.dims.W ?? 0, ledger ? `Slat ledger "${ledger.originalName}" W` : 'No slat ledger on the BOM');
    parameters['rail.inset'] = p('rail.inset', 0, 'Rail outer face set in from the headboard post outer face', null, 'default');
    assumptions.railAttachment = a('railAttachment', 'outer faces flush with posts', 'low', 'Rails line up with the outer face of the headboard/footboard posts; ledger protrudes inward by its width');
    assumptions.mattressSupport = a('mattressSupport', 'unknown', 'low', 'Slats only, or slats + foundation / bunkie board? Decides the slat-gap rule (verify with the mattress maker)', 'default');
    const supportLeg = ix.first('slatSupportLeg');
    parameters['slat.height'] = p('slat.height', supportLeg?.dims.L ?? 250, supportLeg ? 'Top of the centre support legs' : 'Typical slat height (assumed)');
  }
  return { parameters, assumptions };
}

/** Fill in parameters/assumptions without overwriting anything a person set. */
export function withInferred(content: RevisionContent, settings: WorkspaceSettings = DEFAULT_SETTINGS): RevisionContent {
  const inf = inferParameters(content, settings);
  const parameters = { ...inf.parameters };
  for (const [k, v] of Object.entries(content.parameters)) if (v.source === 'user' || !(k in parameters)) parameters[k] = v;
  const assumptions = { ...inf.assumptions };
  for (const [k, v] of Object.entries(content.assumptions)) if (v.source === 'user' || !(k in assumptions)) assumptions[k] = v;
  return { ...content, parameters, assumptions };
}
