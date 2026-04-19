"use client";

import { useState } from "react";
import { Ribbon, type RibbonFocus, type RibbonProps } from "@/components/Ribbon";
import { MatchPanel } from "@/components/MatchPanel";

export interface StudentRibbonProps extends RibbonProps {
  courseId: string;
}

/**
 * Student-facing wrapper around <Ribbon>. Owns the focus state so we can
 * mount the contextual <MatchPanel> below the ribbon whenever a concept
 * is expanded. Re-mounts the panel when the focused concept changes
 * (and re-fetches inside the panel when the subconcept changes).
 */
export function StudentRibbon({ courseId, ...ribbonProps }: StudentRibbonProps) {
  const [focus, setFocus] = useState<RibbonFocus | null>(null);

  return (
    <div className="space-y-4">
      <Ribbon {...ribbonProps} onFocusChange={setFocus} />

      {focus && (
        // key by conceptId so React resets the panel state (loading
        // skeleton flashes) when you swap concepts; subconcept changes
        // re-fetch but keep the same panel mount.
        <MatchPanel
          key={focus.conceptId}
          courseId={courseId}
          conceptId={focus.conceptId}
          subconceptId={focus.subconceptId}
          conceptLabel={focus.conceptLabel}
          subconceptLabel={focus.subconceptLabel}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}
