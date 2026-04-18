"use client";

import { useTransition } from "react";
import { bumpMastery } from "./actions";

export function MasteryControls({
  courseId,
  subconceptId,
}: {
  courseId: string;
  subconceptId: string;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await bumpMastery(courseId, subconceptId, -0.15);
          })
        }
        className="h-6 w-6 rounded-md border border-border bg-background text-xs text-foreground transition-colors hover:bg-zinc-50 disabled:opacity-40"
        aria-label="Decrease mastery"
      >
        −
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await bumpMastery(courseId, subconceptId, 0.15);
          })
        }
        className="h-6 w-6 rounded-md border border-border bg-background text-xs text-foreground transition-colors hover:bg-zinc-50 disabled:opacity-40"
        aria-label="Increase mastery"
      >
        +
      </button>
    </div>
  );
}
