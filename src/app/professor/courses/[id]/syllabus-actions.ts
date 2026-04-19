"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { OpenAIProvider } from "@/lib/llm/OpenAIProvider";

export type UploadSyllabusState =
  | { ok: true; conceptsCreated: number }
  | { ok: false; error: string }
  | undefined;

const ALLOWED_MIME = new Set([
  "application/pdf",
  // Gemini also handles plain text + a few other doc types, but we keep the
  // demo focused on PDFs. Add more here if needed later.
]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap on the file itself.

/**
 * Prof uploads a syllabus PDF for one of their courses. We hand the file to
 * Gemini, get back a list of weekly concepts, and create one `concepts` row
 * per week. That's it — no lectures, no subconcepts, no mastery rows.
 *
 * The ribbon then renders one grey row per concept until a real lecture is
 * uploaded for that week. Uploading a lecture (`lecture-actions.uploadLecture`)
 * is what brings a row to life: it creates the `lectures` row + per-subconcept
 * rows + their `subconcept_materials`, and the
 * `trg_backfill_mastery_subconcept` trigger fans out a 0.5 mastery row per
 * enrolled student.
 *
 * To keep the action idempotent-ish, we refuse if the course already has any
 * concepts. Prof can delete the course (or its concepts) and re-upload if they
 * want to re-init.
 */
export async function uploadSyllabus(
  _prev: UploadSyllabusState,
  formData: FormData
): Promise<UploadSyllabusState> {
  const courseId = String(formData.get("courseId") ?? "").trim();
  const file = formData.get("file");

  if (!courseId) return { ok: false, error: "Missing course id." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a PDF to upload." };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`,
    };
  }
  const mime = file.type || "application/pdf";
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, error: `Unsupported file type: ${mime}. Upload a PDF.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership + emptiness check up front so we don't pay for Gemini if we're
  // going to reject anyway.
  const { data: course, error: courseErr } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (courseErr || !course) return { ok: false, error: "Course not found." };
  if (course.professor_id !== user.id) {
    return { ok: false, error: "You don't own this course." };
  }

  const { count: existingConcepts, error: countErr } = await supabase
    .from("concepts")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  if (countErr) return { ok: false, error: countErr.message };
  if ((existingConcepts ?? 0) > 0) {
    return {
      ok: false,
      error:
        "Course already has concepts. Delete the course (or its concepts) before uploading a fresh syllabus.",
    };
  }

  // OpenAI call. Read file → base64. Buffer.from(ArrayBuffer) is fine in Node.
  let parsed;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");
    const provider = new OpenAIProvider();
    parsed = await provider.parseSyllabus(base64, mime);
  } catch (e) {
    return {
      ok: false,
      error: `OpenAI failed to parse the syllabus: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Normalize + dedupe. Sort by week so position_y is meaningful.
  const cleaned = (parsed.concepts ?? [])
    .map((c) => ({
      week: Number((c as { week?: number }).week ?? 0) || 0,
      concept: String((c as { concept?: string }).concept ?? "").trim(),
    }))
    .filter((c) => c.concept.length > 0)
    .sort((a, b) => a.week - b.week);

  if (cleaned.length === 0) {
    return { ok: false, error: "Gemini didn't return any concepts." };
  }

  // Concepts only. No placeholder lectures or subconcepts — those get created
  // by `uploadLecture` once the prof actually uploads slides for that week.
  // Until then the row stays grey in the ribbon (no cells to color).
  const conceptRows = cleaned.map((c, i) => ({
    course_id: courseId,
    label: c.concept,
    position_y: i, // 0..N-1, top to bottom
  }));
  const { error: cErr } = await supabase.from("concepts").insert(conceptRows);
  if (cErr) {
    return { ok: false, error: cErr.message };
  }

  revalidatePath(`/professor/courses/${courseId}`, "page");

  return { ok: true, conceptsCreated: cleaned.length };
}
