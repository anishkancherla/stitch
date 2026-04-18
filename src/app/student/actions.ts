"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type JoinCourseState = { error: string } | { ok: true } | undefined;

export async function joinCourse(
  _prev: JoinCourseState,
  formData: FormData
): Promise<JoinCourseState> {
  const raw = String(formData.get("code") ?? "").trim();
  if (!raw) return { error: "Enter a join code." };
  if (raw.length > 16) return { error: "That doesn't look like a join code." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: courseId, error } = await supabase.rpc("enroll_with_code", {
    _code: raw,
  });

  if (error) return { error: error.message };
  if (!courseId) return { error: "No published course matches that code." };

  revalidatePath("/student", "page");
  return { ok: true };
}
