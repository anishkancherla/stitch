// Pure helpers for the ribbon. No React, no DB.
//
// A ribbon is one row of cells per subconcept, grouped by parent concept,
// chronological by lecture order within each group. Concepts with no
// subconcepts yet (i.e. no lecture uploaded) are kept as empty groups so the
// ribbon shows a grey segment for that week instead of dropping the column.

export type RibbonCell = {
  subconceptId: string;
  label: string;
  /** 0..1 where 1 = "best" under whatever metric is being shown.
   *  null = no signal yet (rare; default mastery seeds at 0.5). */
  value: number | null;
  /** Pre-formatted text for tooltips/details. RSC-safe: server bakes the
   *  string before passing across the boundary. */
  displayValue?: string;
  /** Lecture title, for the cell tooltip + detail panel "From X" line. */
  lectureTitle?: string;
};

export type RibbonGroup = {
  conceptId: string;
  conceptLabel: string;
  cells: RibbonCell[];
};

// ---------------------------------------------------------------------------
// Colors. Always pass a value where 1 = good (green), 0 = bad (red).
// Three-tier palette per ribbon spec §8 — coarser than the heatmap on
// purpose so threads (Phase 2) read clearly against the cells.
// ---------------------------------------------------------------------------

export function cellColorClass(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "bg-zinc-200";
  if (value < 0.4) return "bg-rose-400";
  if (value <= 0.7) return "bg-amber-300";
  return "bg-emerald-400";
}

export function cellRingClass(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "ring-zinc-300";
  if (value < 0.4) return "ring-rose-500";
  if (value <= 0.7) return "ring-amber-400";
  return "ring-emerald-500";
}

// Continuous red→yellow→green hex on [0..1]. Lets the new ribbon paint
// segments with inline backgroundColor (CSS classes can't hold the SVG
// turbulence-friendly continuous gradient).
export function cellHex(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "#e4e4e7"; // zinc-200
  const v = Math.max(0, Math.min(1, value));
  // Two-stop interpolation: 0 → rose, 0.5 → amber, 1 → emerald.
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [251, 113, 133]], // rose-400
    [0.5, [252, 211, 77]], //  amber-300
    [1.0, [52, 211, 153]], //  emerald-400
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const t = (v - lo[0]) / span;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
  return `rgb(${r} ${g} ${b})`;
}

// Mean of defined cell values; null if the whole concept has no signal yet.
export function conceptAggregate(group: RibbonGroup): number | null {
  let sum = 0;
  let n = 0;
  for (const c of group.cells) {
    if (c.value !== null && !Number.isNaN(c.value)) {
      sum += c.value;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

export const LEGEND_STEPS: Array<{ value: number | null; label: string }> = [
  { value: 0.2, label: "Weak" },
  { value: 0.55, label: "Mid" },
  { value: 0.85, label: "Strong" },
];

// ---------------------------------------------------------------------------
// Group builder. Same shape works for solo (student-personal) and the
// aggregated class ribbon — caller just supplies a different value lookup.
// ---------------------------------------------------------------------------

export type SubconceptInput = {
  id: string;
  label: string;
  concept_id: string;
  lecture_id: string | null;
};

export type ConceptInput = {
  id: string;
  label: string;
};

export type LectureMeta = {
  id: string;
  title: string;
  /** ISO timestamp; we sort cells within a concept group by this. */
  orderKey: string;
};

/**
 * Convert (concepts, subconcepts, lectures) into the grouped ribbon shape.
 *
 * Rules per ribbon spec §3.2:
 *   - One cell per subconcept (never aggregated into a concept×lecture cell).
 *   - Subconcepts grouped by parent concept; concepts in the order given.
 *   - Within a group, cells are chronological by lecture order, with
 *     subconcepts of the same lecture broken by label (stable).
 *   - Concepts with zero subconcepts ARE kept and emitted with `cells: []`.
 *     The Ribbon renders them as a grey segment (no signal), which is what
 *     we want for weeks where the prof hasn't uploaded a lecture yet.
 */
export function buildGroups(
  concepts: ConceptInput[],
  subconcepts: SubconceptInput[],
  lectures: LectureMeta[],
  getValue: (subconceptId: string) => number | null,
  formatValue: (v: number) => string = (v) => v.toFixed(2)
): RibbonGroup[] {
  const lectureById = new Map<string, LectureMeta>();
  for (const l of lectures) lectureById.set(l.id, l);

  const subsByConcept = new Map<string, SubconceptInput[]>();
  for (const s of subconcepts) {
    if (!subsByConcept.has(s.concept_id)) subsByConcept.set(s.concept_id, []);
    subsByConcept.get(s.concept_id)!.push(s);
  }

  const groups: RibbonGroup[] = [];
  for (const c of concepts) {
    const inGroup = subsByConcept.get(c.id) ?? [];
    if (inGroup.length === 0) {
      groups.push({ conceptId: c.id, conceptLabel: c.label, cells: [] });
      continue;
    }

    const cells: RibbonCell[] = inGroup
      .map((s) => {
        const lecture = s.lecture_id
          ? lectureById.get(s.lecture_id)
          : undefined;
        const v = getValue(s.id);
        return {
          subconceptId: s.id,
          label: s.label,
          value: v,
          displayValue: v === null ? undefined : formatValue(v),
          lectureTitle: lecture?.title,
          orderKey: lecture?.orderKey ?? "\uffff", // unscheduled → end
          tieKey: s.label,
        };
      })
      .sort((a, b) => {
        if (a.orderKey !== b.orderKey) {
          return a.orderKey < b.orderKey ? -1 : 1;
        }
        return a.tieKey.localeCompare(b.tieKey);
      })
      .map(({ orderKey: _o, tieKey: _t, ...cell }) => cell);

    groups.push({ conceptId: c.id, conceptLabel: c.label, cells });
  }
  return groups;
}
