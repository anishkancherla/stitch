// Pure helpers for the ribbon. No React, no DB.
//
// A ribbon is one row of cells per subconcept, grouped by parent concept,
// chronological by lecture order within each group. We never emit "empty"
// cells — only subconcepts that actually exist show up.

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
 *   - Concepts that have zero subconcepts after filtering are dropped — no
 *     empty groups in the output.
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
    if (inGroup.length === 0) continue;

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
