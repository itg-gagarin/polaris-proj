import type { StdPart } from '@bom/domain';
import { writeWorkbook } from '@bom/sheets';
import { formatAxisMap } from './axis';

/** Write the dictionary back to .xlsx with the new Axis Map / Default Role / Owner Team columns, for the dictionary owner. */
export function exportDictionary(entries: StdPart[]): Promise<Uint8Array> {
  return writeWorkbook([
    {
      name: 'Std Names',
      preamble: [['FU Standard SG Names — Level 1 and Level 2 (with Axis Map, Default Role, Owner Team)'], [`Exported by Furniture BOM Studio · ${entries.length} entries`]],
      columns: [
        { header: 'Category', key: 'category', width: 22 },
        { header: 'Sub-category', key: 'subCategory', width: 26 },
        { header: 'Std Code', key: 'stdCode', width: 12 },
        { header: 'Level', key: 'level', width: 6 },
        { header: 'L1 (Head)', key: 'l1', width: 24 },
        { header: 'L2', key: 'l2', width: 24 },
        { header: 'Standard SG Name', key: 'name', width: 26 },
        { header: 'English Alias', key: 'nameEn', width: 20 },
        { header: '# FGs Using', key: 'fgsUsing', width: 10 },
        { header: '# SG Lines', key: 'sgLines', width: 10 },
        { header: 'Positions Seen', key: 'positions', width: 24 },
        { header: 'Variants Seen', key: 'variants', width: 24 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'Original Names Merged (examples)', key: 'mergedNames', width: 40 },
        { header: 'Axis Map', key: 'axisMap', width: 14 },
        { header: 'Default Role', key: 'defaultRole', width: 16 },
        { header: 'Owner Team', key: 'ownerTeam', width: 12 },
      ],
      rows: entries.map((e) => ({
        ...e,
        l2: e.l2,
        positions: e.positions.join(' / '),
        variants: e.variants.join('; '),
        mergedNames: e.mergedNames.join('; '),
        axisMap: formatAxisMap(e.axisMap) || null,
        defaultRole: e.defaultRole,
        ownerTeam: e.ownerTeam,
        nameEn: e.nameEn ?? null,
      })),
    },
  ]);
}
