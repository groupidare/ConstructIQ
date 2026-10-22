import type { Phase } from '@/types/project';

// Generated measurements and BOQ rows go to the project's own phases by
// work type, matched by name the same way the ML document parser recognises
// phases (PHASE_KEYWORDS). A work type with no matching phase falls back to
// the project's first phase and is flagged so the wizard can highlight it.
export const WORK_TYPES = ['Walling', 'Finishing', 'Framing', 'Roofing', 'Structural'] as const;
export type WorkType = typeof WORK_TYPES[number];

export interface PhaseChoice { phaseId: number | null; fallback: boolean }

export function matchPhases(phases: Phase[]): Record<WorkType, PhaseChoice> {
  const ordered = [...phases].sort((a, b) => a.order - b.order);
  const first = ordered[0]?.id ?? null;
  return Object.fromEntries(WORK_TYPES.map(type => {
    const hit = ordered.find(p => p.name.toLowerCase().includes(type.toLowerCase()));
    return [type, hit ? { phaseId: hit.id, fallback: false } : { phaseId: first, fallback: first != null }];
  })) as Record<WorkType, PhaseChoice>;
}

// Measurements: walls are Walling; floor, ceiling and openings are Finishing.
export function measurementWorkType(elementType: string): WorkType {
  return elementType === 'Wall' ? 'Walling' : 'Finishing';
}

// BOQ rows: masonry/plaster → Walling, ceiling framing → Framing, roof →
// Roofing, concrete work → Structural; finishes (tiles, adhesive, grout,
// boards, paint, doors, windows) → Finishing.
export function boqRowWorkType(text: string): WorkType {
  const t = text.toLowerCase();
  if (/\bchb\b|hollow block|plaster|skim coat|masonry/.test(t)) return 'Walling';
  if (/framing|furring|metal stud|carrying channel|\btrack\b/.test(t)) return 'Framing';
  if (/\broof/.test(t)) return 'Roofing';
  if (/\bslab\b|\bbeam\b|\bcolumn\b|footing|rebar|deformed bar|concrete pour/.test(t)) return 'Structural';
  return 'Finishing';
}

// "GROUND FLOOR PLAN" → GF, "SECOND FLOOR PLAN" → 2F … (default GF).
export function floorPrefix(drawingTitle: string | null | undefined): string {
  const t = (drawingTitle ?? '').toUpperCase();
  const words: [RegExp, string][] = [
    [/\b(SECOND|2ND)\b/, '2F'], [/\b(THIRD|3RD)\b/, '3F'], [/\b(FOURTH|4TH)\b/, '4F'],
    [/\b(FIFTH|5TH)\b/, '5F'], [/\b(MEZZANINE)\b/, 'MZ'], [/\b(BASEMENT)\b/, 'B1'], [/\bROOF\b/, 'RF'],
  ];
  return words.find(([re]) => re.test(t))?.[1] ?? 'GF';
}
