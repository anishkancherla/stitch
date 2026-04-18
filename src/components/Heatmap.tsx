"use client";

import { useMemo, useState } from "react";
import {
  cellColorClass,
  cellKey,
  cellRingClass,
  LEGEND_STEPS,
  type HeatmapCell,
  type HeatmapConcept,
  type HeatmapLecture,
} from "@/lib/heatmap";

export interface HeatmapProps {
  concepts: HeatmapConcept[];
  lectures: HeatmapLecture[];
  cells: HeatmapCell[];
  /** Format the value shown in tooltips/details (e.g. "0.62" or "38% struggling"). */
  formatValue?: (v: number) => string;
  /** Pre-rendered actions per subconcept (keyed by subconcept id). Server
   *  Components can build these as JSX and pass them in — React elements are
   *  serializable across the server/client boundary, but functions are not. */
  subconceptActions?: Record<string, React.ReactNode>;
  emptyState?: React.ReactNode;
}

const DEFAULT_FORMAT = (v: number) => v.toFixed(2);

export function Heatmap({
  concepts,
  lectures,
  cells,
  formatValue = DEFAULT_FORMAT,
  subconceptActions,
  emptyState,
}: HeatmapProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const cellMap = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of cells) m.set(cellKey(c.conceptId, c.lectureId), c);
    return m;
  }, [cells]);

  const conceptById = useMemo(() => {
    const m = new Map<string, HeatmapConcept>();
    for (const c of concepts) m.set(c.id, c);
    return m;
  }, [concepts]);

  const lectureById = useMemo(() => {
    const m = new Map<string, HeatmapLecture>();
    for (const l of lectures) m.set(l.id, l);
    return m;
  }, [lectures]);

  if (concepts.length === 0 || lectures.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-zinc-50 px-5 py-12 text-center">
        {emptyState ?? (
          <p className="text-sm text-muted">
            No concepts or lectures yet. Once they exist, the heatmap renders
            here.
          </p>
        )}
      </div>
    );
  }

  const selectedCell = selected ? cellMap.get(selected) ?? null : null;
  const selectedConcept = selectedCell
    ? conceptById.get(selectedCell.conceptId)
    : null;
  const selectedLecture = selectedCell
    ? lectureById.get(selectedCell.lectureId)
    : null;

  // Grid sizing — first column = concept label (fixed-ish), rest = fixed cells.
  // Fixed cell width keeps the heatmap compact instead of stretching to fill.
  const cols = `minmax(7rem, 11rem) repeat(${lectures.length}, 1.75rem)`;

  return (
    <div className="space-y-4">
      <div className="w-fit max-w-full overflow-x-auto rounded-2xl border border-border bg-background p-3">
        {/* Header row: blank + lecture labels */}
        <div
          className="grid items-end gap-1"
          style={{ gridTemplateColumns: cols }}
        >
          <div />
          {lectures.map((l) => (
            <div
              key={l.id}
              className="text-center text-[11px] font-medium uppercase tracking-wider text-muted"
              title={l.title ?? l.label}
            >
              {l.label}
            </div>
          ))}
        </div>

        {/* Concept rows */}
        <div className="mt-2 space-y-1">
          {concepts.map((c) => (
            <div
              key={c.id}
              className="grid items-center gap-1"
              style={{ gridTemplateColumns: cols }}
            >
              <div
                className="truncate pr-3 text-right text-xs text-foreground"
                title={c.label}
              >
                {c.label}
              </div>
              {lectures.map((l) => {
                const k = cellKey(c.id, l.id);
                const cell = cellMap.get(k);
                const value = cell?.value ?? null;
                const isSelected = selected === k;
                const covered = value !== null;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSelected(isSelected ? null : k)}
                    disabled={!covered && !isSelected}
                    className={[
                      "h-7 w-7 rounded-[3px] transition-all",
                      cellColorClass(value),
                      covered ? "cursor-pointer hover:opacity-80" : "cursor-default",
                      isSelected
                        ? `ring-2 ring-offset-1 ${cellRingClass(value)}`
                        : "",
                    ].join(" ")}
                    title={
                      covered
                        ? `${c.label} · ${l.label} — ${formatValue(value!)} (${cell!.subconcepts.length} subconcept${cell!.subconcepts.length === 1 ? "" : "s"})`
                        : `${c.label} · ${l.label} — not covered`
                    }
                    aria-label={`${c.label}, ${l.label}`}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-end gap-2 text-[11px] text-muted">
          <span>{LEGEND_STEPS[1].label}</span>
          <div className="flex items-center gap-0.5">
            {LEGEND_STEPS.slice(1).map((s, i) => (
              <span
                key={i}
                className={`block h-3 w-3 rounded-[3px] ${cellColorClass(s.value)}`}
                title={s.label}
              />
            ))}
          </div>
          <span>{LEGEND_STEPS[LEGEND_STEPS.length - 1].label}</span>
          <span className="ml-3 inline-flex items-center gap-1">
            <span className="block h-3 w-3 rounded-[3px] bg-zinc-100 ring-1 ring-zinc-200" />
            Not covered
          </span>
        </div>
      </div>

      {/* Cell detail panel */}
      {selectedCell && selectedConcept && selectedLecture && (
        <div className="rounded-2xl border border-border bg-zinc-50 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted">
                {selectedLecture.title ?? selectedLecture.label}
              </p>
              <h3 className="mt-0.5 font-display text-xl text-foreground">
                {selectedConcept.label}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-muted hover:text-foreground"
              aria-label="Close"
            >
              Close
            </button>
          </div>

          {selectedCell.value !== null ? (
            <p className="mt-1 text-sm text-muted">
              Cell average:{" "}
              <span className="font-mono text-foreground">
                {formatValue(selectedCell.value)}
              </span>{" "}
              · {selectedCell.subconcepts.length} subconcept
              {selectedCell.subconcepts.length === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              No subconcepts under this concept were covered in this lecture.
            </p>
          )}

          {selectedCell.subconcepts.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {selectedCell.subconcepts.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2"
                >
                  <span
                    className={`block h-3.5 w-3.5 shrink-0 rounded-[3px] ${cellColorClass(s.value)}`}
                  />
                  <span className="flex-1 text-sm text-foreground">
                    {s.label}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {s.value === null ? "—" : formatValue(s.value)}
                  </span>
                  {subconceptActions?.[s.id]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
