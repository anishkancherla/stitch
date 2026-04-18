// Pure helpers for the heatmap. No React, no DB.

export type SubconceptCell = {
  id: string;
  label: string;
  value: number | null;
};

export type HeatmapCell = {
  conceptId: string;
  lectureId: string;
  /** 0..1 where 1 is the "best" outcome under whatever metric is being shown.
   *  null = this (concept, lecture) pair has no subconcepts → not covered. */
  value: number | null;
  subconcepts: SubconceptCell[];
};

export type HeatmapConcept = { id: string; label: string };
export type HeatmapLecture = { id: string; label: string; title?: string };

// ---------------------------------------------------------------------------
// Colors. Always pass a value where 1 = good (green), 0 = bad (red).
// For "% struggling" pass 1 - frac_struggling.
// ---------------------------------------------------------------------------

export function cellColorClass(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "bg-zinc-100";
  if (value < 0.2) return "bg-rose-300";
  if (value < 0.4) return "bg-orange-200";
  if (value < 0.6) return "bg-amber-200";
  if (value < 0.8) return "bg-lime-300";
  return "bg-emerald-400";
}

export function cellRingClass(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "ring-zinc-200";
  if (value < 0.2) return "ring-rose-400";
  if (value < 0.4) return "ring-orange-300";
  if (value < 0.6) return "ring-amber-300";
  if (value < 0.8) return "ring-lime-400";
  return "ring-emerald-500";
}

// Five intensity buckets for the legend, plus "not covered".
export const LEGEND_STEPS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "Not covered" },
  { value: 0.1, label: "Weak" },
  { value: 0.3, label: "Developing" },
  { value: 0.5, label: "Mid" },
  { value: 0.7, label: "Decent" },
  { value: 0.9, label: "Strong" },
];

// ---------------------------------------------------------------------------
// Aggregation. Same shape works for student-personal and prof-class.
// ---------------------------------------------------------------------------

export type SubconceptInput = {
  id: string;
  label: string;
  concept_id: string;
  lecture_id: string | null;
};

/** Aggregate per-subconcept values into the (concept × lecture) grid.
 *  `getValue` returns null if the value is missing → cell treats as 0.5
 *  for the average, but the subconcept itself shows null in the side panel. */
export function buildCells(
  concepts: HeatmapConcept[],
  lectures: HeatmapLecture[],
  subconcepts: SubconceptInput[],
  getValue: (subconceptId: string) => number | null
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const c of concepts) {
    for (const l of lectures) {
      const inCell = subconcepts.filter(
        (s) => s.concept_id === c.id && s.lecture_id === l.id
      );
      if (inCell.length === 0) {
        cells.push({
          conceptId: c.id,
          lectureId: l.id,
          value: null,
          subconcepts: [],
        });
        continue;
      }
      const subs: SubconceptCell[] = inCell.map((s) => ({
        id: s.id,
        label: s.label,
        value: getValue(s.id),
      }));
      const numeric = subs
        .map((s) => (s.value === null ? 0.5 : s.value))
        .filter((v) => Number.isFinite(v));
      const avg = numeric.length
        ? numeric.reduce((a, b) => a + b, 0) / numeric.length
        : null;
      cells.push({
        conceptId: c.id,
        lectureId: l.id,
        value: avg,
        subconcepts: subs.sort((a, b) => a.label.localeCompare(b.label)),
      });
    }
  }
  return cells;
}

export function cellKey(conceptId: string, lectureId: string): string {
  return `${conceptId}::${lectureId}`;
}
