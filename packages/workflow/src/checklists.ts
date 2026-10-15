import type { ChecklistItem, Team } from '@bom/domain';

/** Default lane checklists (PRD §9). Items with ruleIds are pre-answered from the check results. */
export const DEFAULT_CHECKLISTS: Partial<Record<Team, ChecklistItem[]>> = {
  design: [
    { id: 'overall', text: { en: 'Overall W × D × H matches the brief', id: 'Ukuran W × D × H sesuai brief' }, ruleIds: ['overall-dimensions'] },
    { id: 'fronts-align', text: { en: 'Fronts align', id: 'Muka laci sejajar' }, ruleIds: ['fronts-align', 'front-width', 'front-stack-height'] },
    { id: 'reveals', text: { en: 'Reveals consistent', id: 'Celah (reveal) konsisten' }, ruleIds: ['front-width'] },
  ],
  engineering: [
    { id: 'clashes', text: { en: 'Zero unwaived clashes', id: 'Tidak ada tabrakan yang belum di-waive' }, ruleIds: ['clash'] },
    { id: 'joints', text: { en: 'Joints declared', id: 'Sambungan sudah dideklarasikan' } },
    { id: 'quantities', text: { en: 'Quantities match', id: 'Jumlah sesuai' }, ruleIds: ['quantity', 'missing-parts'] },
  ],
  finishing: [
    { id: 'finish-faces', text: { en: 'Colour and finish code on every visible face', id: 'Kode warna & finishing di setiap sisi terlihat' }, ruleIds: ['finish-coverage'] },
    { id: 'veneer-direction', text: { en: 'Veneer direction set', id: 'Arah serat veneer ditentukan' } },
    { id: 'sample', text: { en: 'Sample colour approved', id: 'Warna sampel disetujui' } },
  ],
  assembly: [
    { id: 'sequence', text: { en: 'Assembly sequence set per sub-assembly', id: 'Urutan rakit per sub-rakitan ditentukan' } },
    { id: 'reachable', text: { en: 'Every joint reachable with tools', id: 'Setiap sambungan dapat dijangkau alat' } },
    { id: 'jigs', text: { en: 'Jigs listed', id: 'Jig sudah didaftar' } },
  ],
  hardware: [
    { id: 'sku', text: { en: 'Every hardware line has a SKU', id: 'Setiap hardware punya SKU' }, ruleIds: ['hardware-completeness'] },
    { id: 'slide-fit', text: { en: 'Slide length fits the box and the case', id: 'Panjang rel sesuai laci dan badan' }, ruleIds: ['runner-length', 'drawer-box-vs-slide'] },
    { id: 'bungkus', text: { en: 'Hardware Bungkus pack list complete', id: 'Daftar Hardware Bungkus lengkap' } },
  ],
  packing: [
    { id: 'skid', text: { en: 'Skid and crate sized', id: 'Ukuran skid dan peti sesuai' }, ruleIds: ['packing'] },
    { id: 'kd', text: { en: 'Knock-down parts listed', id: 'Part knock-down didaftar' } },
    { id: 'packed', text: { en: 'Packed dimensions set', id: 'Ukuran packing ditentukan' } },
  ],
  qc: [
    { id: 'tolerances', text: { en: 'Tolerances set', id: 'Toleransi ditentukan' } },
    { id: 'tip-over', text: { en: 'Tip-over requirement checked for the target market', id: 'Persyaratan anti-tip dicek untuk pasar tujuan' }, ruleIds: ['tip-over'] },
  ],
};

export function checklistFor(team: Team): ChecklistItem[] {
  return DEFAULT_CHECKLISTS[team] ?? [];
}

/** Pre-answer checklist items from findings: an item with rules is ticked when none of its rules has an unwaived failure. */
export function autoAnswers(team: Team, findings: { ruleId: string; severity: string; waived?: unknown }[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of checklistFor(team)) {
    if (!item.ruleIds) continue;
    out[item.id] = !findings.some((f) => item.ruleIds!.includes(f.ruleId) && f.severity === 'fail' && !f.waived);
  }
  return out;
}
