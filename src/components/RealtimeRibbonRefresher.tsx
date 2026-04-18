"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const RIBBON_TABLES = [
  // Mastery values: cell colors change.
  "user_subconcept_mastery",
  // Schema: new cells / groups appear (or disappear).
  "subconcepts",
  "lectures",
  "concepts",
] as const;

/**
 * Subscribes to Postgres change events on every table that influences the
 * ribbon and triggers a server re-render whenever any of them changes. The
 * server queries are RLS-gated, so each viewer only re-fetches what they're
 * already allowed to see.
 *
 * `scopeId` is only used to namespace the channel name (so multiple tabs
 * watching different courses don't share a channel). Filtering by course
 * happens server-side on refresh, not at the Realtime layer — keeps the
 * client code dumb and the filter logic in one place.
 *
 * Bursts of changes (e.g. a student rapid-firing +/-) are coalesced into a
 * single refresh per ~250 ms.
 */
export function RealtimeRibbonRefresher({ scopeId }: { scopeId: string }) {
  const router = useRouter();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        router.refresh();
      }, 250);
    };

    const channel = supabase.channel(`ribbon-${scopeId}`);
    for (const table of RIBBON_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh
      );
    }
    channel.subscribe();

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      supabase.removeChannel(channel);
    };
  }, [scopeId, router]);

  return null;
}
