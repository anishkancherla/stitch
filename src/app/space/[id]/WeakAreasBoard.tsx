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
    <section className="rounded-2xl border border-border bg-background p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Weak areas board
        </h2>
        <p className="font-mono text-[11px] text-muted">
          {greens} / {cards.length} cleared
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => {
          const targetIsViewer = c.targetUserId === viewerUserId;
          const ownerLabel = targetIsViewer
            ? "You"
            : memberNames[c.targetUserId] ?? "Partner";
          const isActive = c.subconceptId === currentSubconceptId;
          return (
            <li
              key={`${c.subconceptId}-${c.targetUserId}`}
              className={`relative rounded-xl border p-3 transition-colors ${cardBg(c.status)} ${
                isActive ? "ring-2 ring-foreground/40" : ""
              }`}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider opacity-70">
                {c.conceptLabel}
              </p>
              <p className="mt-0.5 truncate text-sm font-medium">
                {c.subconceptLabel}
              </p>
              <p className="mt-2 flex items-center justify-between text-[10px]">
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

function cardBg(status: CardRow["status"]): string {
  switch (status) {
    case "green":
      return "border-emerald-300 bg-emerald-50 text-emerald-900";
    case "attempted":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "red":
    default:
      return "border-rose-300 bg-rose-50 text-rose-900";
  }
}
