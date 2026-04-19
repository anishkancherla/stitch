"use client";

import { CardRow } from "@/lib/spaces";

interface Props {
  cards: CardRow[];
  memberNames: Record<string, string>;
  viewerUserId: string;
  /** Highlight cards belonging to the active step. */
  currentSubconceptId?: string;
}

/**
 * Top-of-room "what we're tackling today" board. Per the spec it's
 * spatial, not a linear bar — every weak card across both students gets
 * its own tile, color-coded by status.
 *
 * If the same subconcept is weak for both students, two cards render —
 * one per target — so each can flip independently.
 */
export function WeakAreasBoard({
  cards,
  memberNames,
  viewerUserId,
  currentSubconceptId,
}: Props) {
  if (cards.length === 0) {
    return null;
  }

  const greens = cards.filter((c) => c.status === "green").length;

  return (
    <section className="rounded-3xl border border-border bg-background p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-inter text-base font-semibold tracking-tight text-foreground">
          Weak areas board
        </h2>
        <p className="font-mono text-xs text-muted">
          {greens} / {cards.length} cleared
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => {
          const targetIsViewer = c.targetUserId === viewerUserId;
          const ownerLabel = targetIsViewer
            ? "You"
            : memberNames[c.targetUserId] ?? "Partner";
          const isActive = c.subconceptId === currentSubconceptId;
          const styles = cardStyles(c.status);
          return (
            <li
              key={`${c.subconceptId}-${c.targetUserId}`}
              className={`relative rounded-2xl border p-3.5 transition-all ${styles.bg} ${
                isActive
                  ? "ring-2 ring-offset-1 ring-foreground/40"
                  : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {/* Colored dot — same chip language as the step kicker. */}
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] opacity-70">
                  {c.conceptLabel}
                </p>
              </div>
              <p className="mt-1 truncate text-sm font-medium">
                {c.subconceptLabel}
              </p>
              <p className="mt-2.5 flex items-center justify-between text-[10px]">
                <span className="opacity-70">{ownerLabel}</span>
                <span className="font-mono uppercase tracking-wider">
                  {c.status}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function cardStyles(status: CardRow["status"]): {
  bg: string;
  dot: string;
} {
  switch (status) {
    case "green":
      return {
        bg: "border-emerald-200 bg-emerald-50 text-emerald-900",
        dot: "bg-emerald-500",
      };
    case "attempted":
      return {
        bg: "border-amber-200 bg-amber-50 text-amber-900",
        dot: "bg-amber-500",
      };
    case "red":
    default:
      return {
        bg: "border-rose-200 bg-rose-50 text-rose-900",
        dot: "bg-rose-500",
      };
  }
}
