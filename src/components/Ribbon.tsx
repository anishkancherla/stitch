"use client";

import { useEffect, useId, useRef, useState } from "react";
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

// Layout sizing.
//
// Concepts now use *fixed pixel widths* instead of flex-grow, so labels
// always render at a readable size and the ribbon is allowed to overflow
// the viewport horizontally (with a scrollbar). The previous flex-grow
// model was crushing labels like "Recursion and Divide-and-Conquer" into
// 60px columns where they truncated to "RECURSIO…".
//
// COLLAPSED_W_PX is comfortable for the longest concept names in CS 161
// (allows two short lines of wrapping when needed). EXPANDED_PER_SUB_PX
// is per-subconcept so an expanded concept grows to fit its kids; the
// min/max clamp keeps tiny concepts from being awkwardly small and big
// ones from blowing past a comfortable click target.
const COLLAPSED_W_PX = 150;
const EXPANDED_PER_SUB_PX = 95;
const EXPANDED_MIN_W_PX = 400;
const EXPANDED_MAX_W_PX = 800;
// Gap between adjacent chunks (before / expanded / after) when something
// is expanded. Read as: this is how much breathing room the expanded
// concept gets from its neighbours so it visually pops out instead of
// looking like one continuous bar.
const CHUNK_GAP_PX = 16;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const ANIM_MS = 400;

function widthFor(g: RibbonGroup, isExpanded: boolean): number {
  if (!isExpanded) return COLLAPSED_W_PX;
  const target = g.cells.length * EXPANDED_PER_SUB_PX;
  return Math.min(EXPANDED_MAX_W_PX, Math.max(EXPANDED_MIN_W_PX, target));
}

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

        <RibbonScrollSurface
          groups={groups}
          expandedId={expandedId}
          selectedSubId={selectedSubId}
          filterId={filterId}
          onToggle={toggleConcept}
          onSelectSub={(id) =>
            setSelectedSubId(id === selectedSubId ? null : id)
          }
        />

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
// Scroll surface + flat single-row layout
//
// The ribbon is horizontally scrollable. We render labels and bar pieces
// as ONE flat row each (not chunked DOM), so every column is a stable
// React node and width / margin / transform transitions actually play
// instead of snapping. When a concept expands:
//
//   - its column's width animates from COLLAPSED_W_PX → expanded width
//   - it gains marginLeft/marginRight = CHUNK_GAP_PX, which animates
//     neighbours apart so the expanded section visually pops out of the
//     strip rather than just stretching in place
//   - its bar piece lifts (translateY) and gets a soft drop-shadow,
//     reinforcing the "this just rose up to be inspected" feel
//
// We also scroll-into-view-center the expanded column so the user never
// has to pan to find it, even when they clicked a far-edge concept.
// ---------------------------------------------------------------------------

interface RibbonScrollSurfaceProps {
  groups: RibbonGroup[];
  expandedId: string | null;
  selectedSubId: string | null;
  filterId: string;
  onToggle: (id: string) => void;
  onSelectSub: (id: string) => void;
}

type ColumnLayout = {
  group: RibbonGroup;
  isExpanded: boolean;
  /** Pixel width of this column at the current state. */
  width: number;
  /** Gap on the left side — non-zero only on the expanded column when it
   *  has a left neighbour, so the gap "belongs to" the popped-out
   *  section and doesn't double up across siblings. */
  marginLeft: number;
  /** Mirror of marginLeft for the right side. */
  marginRight: number;
  /** True for the very first column overall. Suppresses the inter-column
   *  divider on its left edge. */
  isFirstOverall: boolean;
  /** True if the LEFT edge of this column should look like a chunk
   *  boundary (rounded corner, no divider). Either the column is
   *  expanded, the previous column is expanded, or this is the first
   *  column overall. */
  isLeftBoundary: boolean;
  /** Mirror of isLeftBoundary for the right edge. */
  isRightBoundary: boolean;
};

function RibbonScrollSurface({
  groups,
  expandedId,
  selectedSubId,
  filterId,
  onToggle,
  onSelectSub,
}: RibbonScrollSurfaceProps) {
  // Build column descriptors once and share them between the labels row
  // and the bar row, so the two rows can never drift out of alignment.
  const columns: ColumnLayout[] = groups.map((g, i) => {
    const isExp = g.conceptId === expandedId;
    const prevExp =
      i > 0 && groups[i - 1].conceptId === expandedId;
    const nextExp =
      i < groups.length - 1 && groups[i + 1].conceptId === expandedId;
    return {
      group: g,
      isExpanded: isExp,
      width: widthFor(g, isExp),
      marginLeft: isExp && i > 0 ? CHUNK_GAP_PX : 0,
      marginRight: isExp && i < groups.length - 1 ? CHUNK_GAP_PX : 0,
      isFirstOverall: i === 0,
      isLeftBoundary: isExp || prevExp || i === 0,
      isRightBoundary: isExp || nextExp || i === groups.length - 1,
    };
  });

  const expandedRef = useRef<HTMLDivElement | null>(null);
  // Centre the expanded column in the scroll viewport whenever it
  // changes. `inline: 'center'` is the magic — the default `nearest`
  // won't move the viewport if any part of the element is already
  // visible, which feels broken when you click a concept whose left
  // edge is on screen but whose subconcepts unfurl off the right edge.
  useEffect(() => {
    if (expandedId && expandedRef.current) {
      expandedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [expandedId]);

  return (
    // -mx-4 / px-4 trick: lets the scrollbar sit flush with the card
    // edge while keeping the contents visually inset by the card padding.
    // pt-2 / pb-3 leave room for the lift transform + shadow without the
    // card clipping them.
    <div className="-mx-4 overflow-x-auto px-4 pb-3 pt-2">
      <div className="inline-block min-w-full">
        {/* Labels row. break-words + leading-tight let long concept
            names wrap onto two lines instead of truncating — fixes the
            original "RECURSIO…" bug. Each label uses the same width and
            margin transitions as its bar piece below, so they slide
            together as the expanded column grows. */}
        <div className="flex items-end">
          {columns.map((col) => (
            <div
              key={col.group.conceptId}
              style={{
                width: `${col.width}px`,
                marginLeft: `${col.marginLeft}px`,
                marginRight: `${col.marginRight}px`,
                transition: `width ${ANIM_MS}ms ${EASE}, margin ${ANIM_MS}ms ${EASE}, transform ${ANIM_MS}ms ${EASE}`,
                transform: col.isExpanded ? "translateY(-2px)" : "translateY(0)",
              }}
              className="shrink-0 px-2"
            >
              <div
                className={[
                  "text-center text-[11px] font-medium uppercase tracking-wider leading-tight break-words",
                  col.isExpanded ? "text-foreground" : "text-muted",
                ].join(" ")}
                title={col.group.conceptLabel}
              >
                {col.group.conceptLabel}
              </div>
            </div>
          ))}
        </div>

        {/* Bar row. The SVG turbulence filter is applied at the row
            level so the noise pattern stays continuous across all
            columns (applying per-segment would create visible seams
            between adjacent collapsed pieces). Individual ConceptColumn
            components own their backgrounds, rounded corners, and the
            lift/shadow when expanded. */}
        <div
          className="mt-2 flex items-stretch"
          style={{ filter: `url(#${filterId})` }}
        >
          {columns.map((col) => (
            <ConceptColumn
              key={col.group.conceptId}
              column={col}
              innerRef={col.isExpanded ? expandedRef : undefined}
              selectedSubId={selectedSubId}
              onToggle={() => onToggle(col.group.conceptId)}
              onSelectSub={onSelectSub}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One concept column: aggregate-color background that fades out as the
// per-subconcept sub-bars fade in on expand. Both layers are absolutely
// positioned inside an h-12 box so the column's own width animates
// without reflowing the layers under the bars.
//
// Chunk-edge rounding + the lift transform are driven by the parent
// surface via the ColumnLayout descriptor — this component just renders
// what it's told.
// ---------------------------------------------------------------------------

interface ConceptColumnProps {
  column: ColumnLayout;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  selectedSubId: string | null;
  onSelectSub: (id: string) => void;
}

function ConceptColumn({
  column,
  innerRef,
  onToggle,
  selectedSubId,
  onSelectSub,
}: ConceptColumnProps) {
  const { group, isExpanded, width, marginLeft, marginRight } = column;
  const aggregate = conceptAggregate(group);
  const aggregateHex = cellHex(aggregate);
  const isEmpty = group.cells.length === 0;
  const aggregateLabel = isEmpty
    ? "not covered yet"
    : aggregate === null
    ? "no signal yet"
    : `aggregate ${fmt(aggregate)}`;

  // Inter-column divider: only show on the LEFT edge when this column
  // sits flush against another collapsed sibling (i.e. it isn't a chunk
  // boundary). At a chunk boundary we want a clean rounded edge instead.
  const showLeftDivider = !column.isLeftBoundary && !column.isFirstOverall;

  return (
    <div
      ref={innerRef}
      style={{
        width: `${width}px`,
        marginLeft: `${marginLeft}px`,
        marginRight: `${marginRight}px`,
        // Lift the expanded column slightly so it visually rises out
        // of the strip. translateY + drop-shadow + a near-imperceptible
        // scale together read as "this just lifted off the page".
        transform: isExpanded
          ? "translateY(-3px) scale(1.005)"
          : "translateY(0) scale(1)",
        // Drop-shadow as a CSS filter (instead of box-shadow) so it
        // lives in the same filter chain as the parent's SVG turbulence
        // and renders cleanly underneath the column's rounded corners.
        filter: isExpanded
          ? "drop-shadow(0 8px 16px rgba(0,0,0,0.12)) drop-shadow(0 2px 4px rgba(0,0,0,0.06))"
          : "none",
        transition: `width ${ANIM_MS}ms ${EASE}, margin ${ANIM_MS}ms ${EASE}, transform ${ANIM_MS}ms ${EASE}, filter ${ANIM_MS}ms ${EASE}`,
        // willChange hint keeps the transform on the GPU compositor
        // layer so the lift doesn't repaint the noise filter every
        // frame — noticeable smoothness win on lower-end machines.
        willChange: "width, margin, transform, filter",
      }}
      className={[
        "relative h-12 shrink-0 overflow-hidden",
        column.isLeftBoundary ? "rounded-l-md" : "",
        column.isRightBoundary ? "rounded-r-md" : "",
        // The 1px concept divider becomes part of the segment's own
        // left border, so adjacent collapsed columns share a clean
        // hairline. The fabric filter modulates it slightly so it
        // blends into the weave instead of looking pasted on.
        showLeftDivider ? "border-l border-black/15" : "",
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
