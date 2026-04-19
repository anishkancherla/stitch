"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AvailabilityBlock = {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  /** "HH:MM" 24h, half-open interval [start, end) */
  startTime: string;
  endTime: string;
};

export type GetAvailabilityResult =
  | { ok: true; blocks: AvailabilityBlock[] }
  | { ok: false; error: string };

export async function getMyAvailability(): Promise<GetAvailabilityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  // RLS scopes this to the caller's own rows.
  const { data, error } = await supabase
    .from("user_availability")
    .select("day_of_week, start_time, end_time")
    .eq("user_id", user.id)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    blocks: (data ?? []).map((r) => ({
      dayOfWeek: r.day_of_week as number,
      // Postgres time → "HH:MM:SS"; trim seconds for the UI.
      startTime: (r.start_time as string).slice(0, 5),
      endTime: (r.end_time as string).slice(0, 5),
    })),
  };
}

export type SaveAvailabilityResult = { ok: true } | { ok: false; error: string };

/**
 * Replace the caller's manual availability with the given blocks. We do a
 * full delete + insert because the editor sends the whole grid back; partial
 * upserts would require client-side diffing for no real win at this scale.
 *
 * Source-filtered to 'manual' so a future gcal sync can coexist without
 * being clobbered by a profile save.
 */
export async function setMyAvailability(
  blocks: AvailabilityBlock[]
): Promise<SaveAvailabilityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Validate + canonicalise on the server. Caller is untrusted.
  for (const b of blocks) {
    if (b.dayOfWeek < 0 || b.dayOfWeek > 6) {
      return { ok: false, error: "invalid day_of_week" };
    }
    if (!/^\d{2}:\d{2}$/.test(b.startTime) || !/^\d{2}:\d{2}$/.test(b.endTime)) {
      return { ok: false, error: "invalid time format" };
    }
    if (b.endTime <= b.startTime) {
      return { ok: false, error: "block end must be after start" };
    }
  }

  const { error: delErr } = await supabase
    .from("user_availability")
    .delete()
    .eq("user_id", user.id)
    .eq("source", "manual");
  if (delErr) return { ok: false, error: delErr.message };

  if (blocks.length > 0) {
    const { error: insErr } = await supabase.from("user_availability").insert(
      blocks.map((b) => ({
        user_id: user.id,
        day_of_week: b.dayOfWeek,
        start_time: `${b.startTime}:00`,
        end_time: `${b.endTime}:00`,
        source: "manual",
      }))
    );
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidatePath("/profile");
  return { ok: true };
}
