"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/joinCode";

export type CreateCourseState = { error: string } | undefined;

export async function createCourse(
  _prev: CreateCourseState,
  formData: FormData
): Promise<CreateCourseState> {
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!code || !name) return { error: "Both code and name are required." };
  if (code.length > 32) return { error: "Course code is too long." };
  if (name.length > 200) return { error: "Course name is too long." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("courses")
    .insert({ code, name, professor_id: user.id, status: "draft" })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/professor", "page");
  redirect(`/professor/courses/${data.id}`);
}

export async function publishCourse(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Generate a unique join code. Retry a few times in the rare case of
  // collision against the join_code unique index.
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < 5) {
    const join_code = generateJoinCode(6);
    const { error } = await supabase
      .from("courses")
      .update({ status: "published", join_code })
      .eq("id", courseId)
      .eq("professor_id", user.id);

    if (!error) {
      revalidatePath(`/professor/courses/${courseId}`, "page");
      revalidatePath("/professor", "page");
      return { ok: true as const };
    }
    lastError = error;
    // 23505 = unique_violation; retry on collision, fail otherwise.
    if (!String(error.code).includes("23505")) break;
    attempt++;
  }

  return { ok: false as const, error: String(lastError) };
}

export async function deleteCourse(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("courses")
    .delete()
    .eq("id", courseId)
    .eq("professor_id", user.id);

  revalidatePath("/professor", "page");
  redirect("/professor");
}
