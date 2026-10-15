import type { LayoutFamily } from '@bom/domain';

export interface ProductClass {
  category: string;
  subCategory: string;
  family: LayoutFamily;
  /** Legacy headers list beds as W × H × D, case goods as W × D × H. */
  headerOrder: 'WDH' | 'WHD';
}

/** Map a product description to the dictionary's category / sub-category and a layout family. */
export function classifyProduct(description: string): ProductClass {
  const d = description.toLowerCase();
  if (/night ?stand|bedside/.test(d)) return { category: 'Storage & Casegoods', subCategory: 'Nightstands', family: 'caseWithDrawers', headerOrder: 'WDH' };
  if (/chest/.test(d)) return { category: 'Storage & Casegoods', subCategory: 'Chest Of Drawers', family: 'caseWithDrawers', headerOrder: 'WDH' };
  if (/dresser/.test(d)) return { category: 'Storage & Casegoods', subCategory: 'Dressers', family: 'caseWithDrawers', headerOrder: 'WDH' };
  if (/vanity/.test(d)) return { category: 'Storage & Casegoods', subCategory: 'Vanity Cabinets', family: 'caseWithDoors', headerOrder: 'WDH' };
  if (/bookcase|book case/.test(d)) return { category: 'Storage & Casegoods', subCategory: 'Bookcases', family: 'bookcase', headerOrder: 'WDH' };
  if (/sideboard|buffet|server/.test(d)) return { category: 'Storage & Casegoods', subCategory: 'Sideboards or Buffet or Server', family: 'caseWithDoors', headerOrder: 'WDH' };
  if (/\bhb\b|headboard/.test(d)) return { category: 'Beds', subCategory: 'Headboard', family: 'bedComponent', headerOrder: 'WHD' };
  if (/\bfb\b|footboard/.test(d)) return { category: 'Beds', subCategory: 'Footboard', family: 'bedComponent', headerOrder: 'WHD' };
  if (/side rail|\brails?\b/.test(d)) return { category: 'Beds', subCategory: 'Rails', family: 'bedComponent', headerOrder: 'WHD' };
  if (/\bbed\b/.test(d)) return { category: 'Beds', subCategory: 'Panel Beds', family: 'bed', headerOrder: 'WHD' };
  if (/dining table/.test(d)) return { category: 'Tables', subCategory: 'Dining Tables', family: 'table', headerOrder: 'WDH' };
  if (/coffee table/.test(d)) return { category: 'Tables', subCategory: 'Coffee Table', family: 'table', headerOrder: 'WDH' };
  if (/table|desk/.test(d)) return { category: 'Tables', subCategory: 'Accent Tables', family: 'table', headerOrder: 'WDH' };
  if (/bench/.test(d)) return { category: 'Seating', subCategory: 'Bench dining', family: 'bench', headerOrder: 'WDH' };
  if (/chair|stool/.test(d)) return { category: 'Seating', subCategory: 'Side Dining Chairs', family: 'chair', headerOrder: 'WDH' };
  return { category: 'Unclassified', subCategory: 'Please specify', family: 'generic', headerOrder: 'WDH' };
}

export function slug(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function initials(s: string | null | undefined): string {
  return (s ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
}
