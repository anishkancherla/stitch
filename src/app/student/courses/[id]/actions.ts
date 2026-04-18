"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Demo helper. Bump the current student's mastery on one subconcept up or down.
 *  Stores a clamped score in [0, 1]. Logs nothing — this is for demoing only. */
export async function bumpMastery(
  courseId: string,
  subconceptId: string,
  delta: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await supabase
    .from("user_subconcept_mastery")
    .select("score")
    .eq("user_id", user.id)
    .eq("subconcept_id", subconceptId)
    .single();

  const current = row?.score ?? 0.5;
  const next = Math.max(0, Math.min(1, current + delta));

  await supabase
    .from("user_subconcept_mastery")
    .upsert(
      {
        user_id: user.id,
        subconcept_id: subconceptId,
        score: next,
        last_updated: new Date().toISOString(),
      },
      { onConflict: "user_id,subconcept_id" }
    );

  revalidatePath(`/student/courses/${courseId}`, "page");
  return { ok: true, score: next };
}
