"use client";

import { useEffect, useId, useState } from "react";
import {
  cellColorClass,
  cellHex,
  conceptAggregate,
  LEGEND_STEPS,
  type RibbonCell,
  type RibbonGroup,
} from "@/lib/ribbon";

/** What's currently in focus on the ribbon. Drives contextual UI below
 *  (the matching panel on student pages). */
export type RibbonFocus = {
  conceptId: string;
  conceptLabel: string;
  subconceptId: string | null;
  subconceptLabel: string | null;
};

export interface RibbonProps {
  groups: RibbonGroup[];
  /** Pre-rendered actions per subconcept (keyed by subconcept id). RSC-safe:
   *  React elements are serializable across the server/client boundary,
   *  functions are not. */
  cellActions?: Record<string, React.ReactNode>;
  emptyState?: React.ReactNode;
  /** Optional label above the strip (e.g. "Your mastery", "Class average"). */
  caption?: React.ReactNode;
  /** Fires whenever the focused concept/subconcept changes. Null when the
   *  user collapses the active concept. The Ribbon stays uncontrolled —
   *  parents just observe focus, they don't drive it. */
  onFocusChange?: (focus: RibbonFocus | null) => void;
}

function fmt(v: number): string {
  return v.toFixed(2);
}

// How many "flex units" the expanded concept claims relative to a collapsed
// peer. With 4 concepts and EXPAND=4, the expanded one takes 4/(4+3)=~57%
// of the bar; with 8, it takes 4/(4+7)=~36%. Keeps the rest readable.
const EXPAND_GROW = 4;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const ANIM_MS = 400;

export function Ribbon({
  groups,
  cellActions,
  emptyState,
  caption,
  onFocusChange,
}: RibbonProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  // Unique per-instance so multiple ribbons on the same page don't collide
  // on the SVG filter id.
  const filterId = `ribbon-fabric-${useId().replace(/:/g, "")}`;

  // Surface focus changes to the parent. Concept-level focus fires on
  // expand; subconcept focus fires when a sub-bar inside the expanded
  // concept is clicked. Collapsing emits null.
  useEffect(() => {
    if (!onFocusChange) return;
    if (!expandedId) {
      onFocusChange(null);
      return;
    }
    const g = groups.find((gg) => gg.conceptId === expandedId);
    if (!g) return;
    const sub =
      selectedSubId
        ? g.cells.find((c) => c.subconceptId === selectedSubId) ?? null
        : null;
    onFocusChange({
      conceptId: g.conceptId,
      conceptLabel: g.conceptLabel,
      subconceptId: sub?.subconceptId ?? null,
      subconceptLabel: sub?.label ?? null,
    });
  }, [expandedId, selectedSubId, groups, onFocusChange]);

  // Only show the empty-state when there are NO concepts at all. Concepts
  // without subconcepts (no lecture uploaded yet) still render — as a grey
  // segment — so the user can see the full week-by-week shape of the course.
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-zinc-50 px-5 py-12 text-center">
        {emptyState ?? (
          <p className="text-sm text-muted">
            No concepts yet. Upload a syllabus to populate the ribbon.
          </p>
        )}
      </div>
    );
  }

  function toggleConcept(conceptId: string) {
    // Empty groups (no subconcepts yet) are non-interactive — there's nothing
    // to expand into.
    const g = groups.find((gg) => gg.conceptId === conceptId);
    if (!g || g.cells.length === 0) return;
    setExpandedId((curr) => (curr === conceptId ? null : conceptId));
    // Drop the sub-detail whenever the focused concept changes/closes.
    setSelectedSubId(null);
  }

  const selected = (() => {
    if (!selectedSubId) return null;
    for (const g of groups) {
      const c = g.cells.find((cc) => cc.subconceptId === selectedSubId);
      if (c) return { cell: c, group: g };
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      {/* Inline SVG defs — feTurbulence overlaid on the ribbon for a subtle
          fabric grain. The filter is referenced via url(#filterId) on the
          bar container below. */}
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id={filterId}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="3"
              stitchTiles="stitch"
              result="noise"
            />
            <feColorMatrix
              in="noise"
              type="matrix"
              // collapse to a transparent darkness that we'll multiply onto
              // the source — gives gentle "weave" shadowing without washing
              // colour out
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0.18 0"
              result="grain"
            />
            <feComposite in="grain" in2="SourceGraphic" operator="in" result="masked" />
            <feBlend in="SourceGraphic" in2="masked" mode="multiply" />
          </filter>
        </defs>
      </svg>

      <div className="rounded-2xl border border-border bg-background p-4">
        {caption && (
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">
            {caption}
          </div>
        )}

        {/* Concept labels — stretched in lockstep with the bar segments below
            so they stay aligned through expand/collapse. */}
        <div className="flex w-full items-end gap-0">
          {groups.map((g) => {
            const isExpanded = g.conceptId === expandedId;
            return (
              <div
                key={g.conceptId}
                style={{
                  flexGrow: isExpanded ? EXPAND_GROW : 1,
                  flexBasis: 0,
                  transition: `flex-grow ${ANIM_MS}ms ${EASE}`,
                }}
                className="min-w-0 px-2"
              >
                <div
                  className={[
                    "truncate text-center text-[10px] font-medium uppercase tracking-wider",
                    isExpanded ? "text-foreground" : "text-muted",
                  ].join(" ")}
                  title={g.conceptLabel}
                >
                  {g.conceptLabel}
                </div>
              </div>
            );
          })}
        </div>

        {/* The bar. SVG turbulence filter + overflow-hidden so the inner
            sub-bars don't bleed past the rounded ends. */}
        <div
          className="mt-1.5 flex h-12 w-full overflow-hidden rounded-md ring-1 ring-border/50"
          style={{ filter: `url(#${filterId})` }}
        >
          {groups.map((g, i) => (
            <ConceptSegment
              key={g.conceptId}
              group={g}
              isFirst={i === 0}
              isExpanded={g.conceptId === expandedId}
              expandGrow={EXPAND_GROW}
              onToggle={() => toggleConcept(g.conceptId)}
              selectedSubId={selectedSubId}
              onSelectSub={(id) => setSelectedSubId(id === selectedSubId ? null : id)}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-3 text-[11px] text-muted">
          {LEGEND_STEPS.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span
                className={`block h-3 w-3 rounded-[3px] ${cellColorClass(s.value)}`}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Sub-detail panel, only when a subconcept is picked from inside an
          expanded concept. Keeps the +/- mastery actions reachable. */}
      {selected && (
        <div className="rounded-2xl border border-border bg-zinc-50 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs uppercase tracking-[0.18em] text-muted">
                {selected.group.conceptLabel}
              </p>
              <h3 className="mt-0.5 truncate font-display text-xl text-foreground">
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
              onClick={() => setSelectedSubId(null)}
              className="text-sm text-muted hover:text-foreground"
              aria-label="Close"
            >
              Close
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span
              className="block h-4 w-4 shrink-0 rounded-[3px]"
              style={{ backgroundColor: cellHex(selected.cell.value) }}
            />
            <span className="font-mono text-sm text-foreground">
              {selected.cell.value === null
                ? "—"
                : selected.cell.displayValue ?? fmt(selected.cell.value)}
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

// ---------------------------------------------------------------------------
// One concept segment: aggregate-color background that fades out as the
// per-subconcept sub-bars fade in on expand. Both layers are absolutely
// positioned so the segment's own width animates without a layout reflow
// under the bars.
// ---------------------------------------------------------------------------

interface ConceptSegmentProps {
  group: RibbonGroup;
  isFirst: boolean;
  isExpanded: boolean;
  expandGrow: number;
  onToggle: () => void;
  selectedSubId: string | null;
  onSelectSub: (id: string) => void;
}

function ConceptSegment({
  group,
  isFirst,
  isExpanded,
  expandGrow,
  onToggle,
  selectedSubId,
  onSelectSub,
}: ConceptSegmentProps) {
  const aggregate = conceptAggregate(group);
  const aggregateHex = cellHex(aggregate);
  const isEmpty = group.cells.length === 0;
  const aggregateLabel = isEmpty
    ? "not covered yet"
    : aggregate === null
    ? "no signal yet"
    : `aggregate ${fmt(aggregate)}`;

  return (
    <div
      style={{
        flexGrow: isExpanded ? expandGrow : 1,
        flexBasis: 0,
        transition: `flex-grow ${ANIM_MS}ms ${EASE}`,
      }}
      className={[
        "relative h-full min-w-0",
        // 1px concept divider — left border on every segment except the
        // first. The fabric filter modulates it slightly, so it blends
        // into the weave instead of looking pasted on.
        isFirst ? "" : "border-l border-black/15",
      ].join(" ")}
    >
      {/* Aggregate colour layer — visible when collapsed, fades on expand.
          Empty groups (no lecture uploaded yet) are inert: no click handler,
          default cursor, and the aria-label tells you why. */}
      <button
        type="button"
        onClick={isEmpty ? undefined : onToggle}
        disabled={isEmpty}
        title={`${group.conceptLabel} — ${aggregateLabel}`}
        aria-label={
          isEmpty
            ? `${group.conceptLabel}, ${aggregateLabel}.`
            : `${group.conceptLabel}, ${aggregateLabel}. ${
                isExpanded ? "Collapse" : "Expand to see subconcepts"
              }`
        }
        className={`absolute inset-0 ${isEmpty ? "cursor-default" : "cursor-pointer"}`}
        style={{
          backgroundColor: aggregateHex,
          opacity: isExpanded ? 0 : 1,
          transition: `opacity ${ANIM_MS}ms ${EASE}`,
        }}
      />

      {/* Sub-bar layer — the per-subconcept slices, only interactive when
          expanded. We keep them mounted and just toggle opacity so the
          colour transition is smooth in both directions. */}
      <div
        className="absolute inset-0 flex"
        style={{
          opacity: isExpanded ? 1 : 0,
          pointerEvents: isExpanded ? "auto" : "none",
          transition: `opacity ${ANIM_MS}ms ${EASE}`,
        }}
      >
        {group.cells.map((c, i) => (
          <SubBar
            key={c.subconceptId}
            cell={c}
            isFirst={i === 0}
            isSelected={selectedSubId === c.subconceptId}
            onClick={() => onSelectSub(c.subconceptId)}
          />
        ))}
      </div>

      {/* Collapse handle: clicking the expanded segment's background also
          collapses it. Sits below the sub-bars so it doesn't steal their
          clicks. */}
      {isExpanded && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Collapse ${group.conceptLabel}`}
          className="absolute inset-0 -z-10 cursor-pointer"
        />
      )}
    </div>
  );
}

// One sub-bar inside an expanded concept. 1px divider between siblings, and
// a subtle inset ring when selected to show which subconcept the detail
// panel is describing.
function SubBar({
  cell,
  isFirst,
  isSelected,
  onClick,
}: {
  cell: RibbonCell;
  isFirst: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const valueText =
    cell.value === null ? "no signal" : cell.displayValue ?? fmt(cell.value);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${cell.label} — ${valueText}`}
      aria-label={`${cell.label}, ${valueText}`}
      className={[
        "h-full min-w-0 flex-1 cursor-pointer transition-[box-shadow]",
        isFirst ? "" : "border-l border-black/15",
        isSelected ? "shadow-[inset_0_0_0_2px_rgba(0,0,0,0.55)]" : "",
      ].join(" ")}
      style={{ backgroundColor: cellHex(cell.value) }}
    />
  );
}
