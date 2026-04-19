"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { GeminiProvider } from "@/lib/llm/GeminiProvider";

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
 * Gemini, get back a list of weekly concepts, and for each one create:
 *
 *   - a `concepts` row (heatmap row)
 *   - a `lectures` row     (heatmap column)
 *   - a `subconcepts` row that ties them together (heatmap cell)
 *
 * The `trg_backfill_mastery_subconcept` trigger then fans out a 0.5 mastery
 * row to every currently-enrolled student. Net effect: a fully-populated
 * initial heatmap, gray everywhere, ready to be moved by quizzes / manual
 * adjustments.
 *
 * To keep the action idempotent-ish, we refuse if the course already has any
 * concepts. Prof can delete them and re-upload if they want to re-init.
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

  // Gemini call. Read file → base64. Buffer.from(ArrayBuffer) is fine in Node.
  let parsed;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");
    const provider = new GeminiProvider();
    parsed = await provider.parseSyllabus(base64, mime);
  } catch (e) {
    return {
      ok: false,
      error: `Gemini failed to parse the syllabus: ${e instanceof Error ? e.message : String(e)}`,
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

  // Anchor lecture timestamps to a fake week-by-week schedule starting today.
  // Just gives `lectures.started_at` a stable order; doesn't matter for the
  // heatmap math, which uses the inserted order via `started_at` ASC.
  const weekStart = new Date();
  weekStart.setHours(9, 0, 0, 0);

  // Bulk insert concepts first, then look up their ids, then insert lectures
  // and subconcepts. We can't do all three in one round-trip because
  // subconcepts need both concept and lecture ids.
  const conceptRows = cleaned.map((c, i) => ({
    course_id: courseId,
    label: c.concept,
    position_y: i, // 0..N-1, top to bottom
  }));
  const { data: insertedConcepts, error: cErr } = await supabase
    .from("concepts")
    .insert(conceptRows)
    .select("id, label, position_y");
  if (cErr || !insertedConcepts) {
    return { ok: false, error: cErr?.message ?? "Failed to insert concepts." };
  }

  const lectureRows = cleaned.map((c, i) => {
    const ts = new Date(weekStart);
    ts.setDate(ts.getDate() + i * 7);
    return {
      course_id: courseId,
      title: `Week ${c.week || i + 1}: ${c.concept}`,
      uploaded_by: user.id,
      source_type: "text_upload" as const,
      started_at: ts.toISOString(),
      status: "ready" as const,
    };
  });
  const { data: insertedLectures, error: lErr } = await supabase
    .from("lectures")
    .insert(lectureRows)
    .select("id, title");
  if (lErr || !insertedLectures) {
    return { ok: false, error: lErr?.message ?? "Failed to insert lectures." };
  }

  // Pair them up. We inserted in the same order, but the DB doesn't guarantee
  // returned-row order matches insert order — so resort by position_y for
  // concepts and the title's "Week N" prefix for lectures.
  const sortedConcepts = [...insertedConcepts].sort(
    (a, b) => (a.position_y ?? 0) - (b.position_y ?? 0)
  );
  const lectureByTitle = new Map(insertedLectures.map((l) => [l.title, l.id]));

  const subconceptRows = cleaned.map((c, i) => {
    const concept = sortedConcepts[i];
    const lectureId = lectureByTitle.get(`Week ${c.week || i + 1}: ${c.concept}`);
    return {
      concept_id: concept.id,
      lecture_id: lectureId ?? null,
      label: c.concept,
    };
  });
  const { error: sErr } = await supabase.from("subconcepts").insert(subconceptRows);
  if (sErr) {
    return { ok: false, error: sErr.message };
  }

  // Mastery rows for enrolled students are inserted automatically by
  // `trg_backfill_mastery_subconcept` (SECURITY DEFINER), so we don't need
  // to touch user_subconcept_mastery here.

  revalidatePath(`/professor/courses/${courseId}`, "page");

  return { ok: true, conceptsCreated: cleaned.length };
}
