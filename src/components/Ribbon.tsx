"use client";

import { useState } from "react";
import {
  cellColorClass,
  cellRingClass,
  LEGEND_STEPS,
  type RibbonGroup,
} from "@/lib/ribbon";

export interface RibbonProps {
  groups: RibbonGroup[];
  /** Pre-rendered actions per subconcept (keyed by subconcept id). RSC-safe:
   *  React elements are serializable across the server/client boundary,
   *  functions are not. */
  cellActions?: Record<string, React.ReactNode>;
  emptyState?: React.ReactNode;
  /** Optional label above the strip (e.g. "Your mastery", "Class average"). */
  caption?: React.ReactNode;
}

function fallbackFormat(v: number): string {
  return v.toFixed(2);
}

export function Ribbon({ groups, cellActions, emptyState, caption }: RibbonProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const totalCells = groups.reduce((n, g) => n + g.cells.length, 0);
  if (totalCells === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-zinc-50 px-5 py-12 text-center">
        {emptyState ?? (
          <p className="text-sm text-muted">
            No subconcepts yet. Once a lecture is uploaded, the ribbon renders
            here.
          </p>
        )}
      </div>
    );
  }

  // Find the selected cell across all groups (small N — flat scan is fine).
  const selected = (() => {
    if (!selectedId) return null;
    for (const g of groups) {
      const c = g.cells.find((cc) => cc.subconceptId === selectedId);
      if (c) return { cell: c, group: g };
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      <div className="w-fit max-w-full overflow-x-auto rounded-2xl border border-border bg-background p-4">
        {caption && (
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">
            {caption}
          </div>
        )}

        {/* Concept labels above each group. The label width is locked to the
            group's cell-strip width below, so it doesn't drift if the strip
            wraps or gets compact. */}
        <div className="flex items-end gap-4">
          {groups.map((g) => (
            <ConceptLabel key={g.conceptId} group={g} />
          ))}
        </div>

        {/* Cells row — each group is its own flex container with thin gaps,
            then a wider gap between groups + a left border to mark divisions. */}
        <div className="mt-1 flex items-stretch gap-4">
          {groups.map((g, gi) => (
            <div
              key={g.conceptId}
              className={[
                "flex gap-px",
                gi > 0 ? "border-l border-border pl-4" : "",
              ].join(" ")}
            >
              {g.cells.map((c) => {
                const isSelected = selectedId === c.subconceptId;
                return (
                  <button
                    key={c.subconceptId}
                    type="button"
                    onClick={() =>
                      setSelectedId(isSelected ? null : c.subconceptId)
                    }
                    title={tooltip(g.conceptLabel, c.label, c.value, c.displayValue)}
                    aria-label={`${g.conceptLabel}: ${c.label}`}
                    className={[
                      "h-8 w-5 rounded-[3px] transition-all",
                      cellColorClass(c.value),
                      "hover:scale-110 cursor-pointer",
                      isSelected
                        ? `ring-2 ring-offset-1 scale-110 ${cellRingClass(c.value)}`
                        : "",
                    ].join(" ")}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
          {LEGEND_STEPS.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span
                className={`block h-3 w-3 rounded-[3px] ${cellColorClass(s.value)}`}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Cell detail panel */}
      {selected && (
        <div className="rounded-2xl border border-border bg-zinc-50 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted">
                {selected.group.conceptLabel}
              </p>
              <h3 className="mt-0.5 font-display text-xl text-foreground">
                {selected.cell.label}
              </h3>
              {selected.cell.lectureTitle && (
                <p className="mt-0.5 text-xs text-muted">
                  From {selected.cell.lectureTitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-sm text-muted hover:text-foreground"
              aria-label="Close"
            >
              Close
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span
              className={`block h-4 w-4 shrink-0 rounded-[3px] ${cellColorClass(selected.cell.value)}`}
            />
            <span className="font-mono text-sm text-foreground">
              {selected.cell.value === null
                ? "—"
                : selected.cell.displayValue ?? fallbackFormat(selected.cell.value)}
            </span>
            {cellActions?.[selected.cell.subconceptId] && (
              <div className="ml-auto">
                {cellActions[selected.cell.subconceptId]}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConceptLabel({ group }: { group: RibbonGroup }) {
  // Cell width 20px (w-5) + gap 1px between cells; matches the row below so
  // the label sits directly over its strip.
  const widthPx = group.cells.length * 20 + Math.max(group.cells.length - 1, 0);
  return (
    <div
      style={{ width: widthPx }}
      className="truncate text-[10px] font-medium uppercase tracking-wider text-muted"
      title={group.conceptLabel}
    >
      {group.conceptLabel}
    </div>
  );
}

function tooltip(
  conceptLabel: string,
  cellLabel: string,
  value: number | null,
  displayValue: string | undefined
): string {
  if (value === null) return `${conceptLabel} · ${cellLabel} — no signal`;
  return `${conceptLabel} · ${cellLabel} — ${displayValue ?? fallbackFormat(value)}`;
}
