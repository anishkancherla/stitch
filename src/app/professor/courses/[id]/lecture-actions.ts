"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { GeminiProvider } from "@/lib/llm/GeminiProvider";

export type UploadLectureState =
  | { ok: true; lectureTitle: string; subconceptsCreated: number }
  | { ok: false; error: string }
  | undefined;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // .docx
  "text/plain",
  "text/markdown",
]);
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB; PPTX with images can get chunky.

/**
 * Prof uploads a single lecture for one of their courses. The lecture file is
 * sent to Gemini (via the Files API, so PPTX / DOCX work), Gemini extracts
 * 5-10 lecture-level subconcepts under the prof-chosen parent concept, and
 * we persist:
 *
 *   - 1 new `lectures` row (becomes a new heatmap column on this course)
 *   - N new `subconcepts` rows under (chosen concept × new lecture)
 *
 * The existing `trg_backfill_mastery_subconcept` trigger then inserts a
 * default 0.5 mastery row for every currently-enrolled student on every new
 * subconcept. Both the prof's class heatmap and each student's individual
 * heatmap pick this up via the realtime refreshers.
 */
export async function uploadLecture(
  _prev: UploadLectureState,
  formData: FormData
): Promise<UploadLectureState> {
  const courseId = String(formData.get("courseId") ?? "").trim();
  const conceptId = String(formData.get("conceptId") ?? "").trim();
  const titleInput = String(formData.get("title") ?? "").trim();
  const file = formData.get("file");

  if (!courseId) return { ok: false, error: "Missing course id." };
  if (!conceptId) return { ok: false, error: "Pick a parent concept." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a lecture file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 30 MB.`,
    };
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      error: `Unsupported file type: ${mime}. Upload a PDF, PPTX, DOCX, or .txt.`,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership + concept-belongs-to-course check.
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) return { ok: false, error: "Course not found." };
  if (course.professor_id !== user.id) {
    return { ok: false, error: "You don't own this course." };
  }

  const { data: concept } = await supabase
    .from("concepts")
    .select("id, label, course_id")
    .eq("id", conceptId)
    .single();
  if (!concept || concept.course_id !== courseId) {
    return { ok: false, error: "Picked concept doesn't belong to this course." };
  }

  // Ask Gemini for subconcepts. Pass the File directly — Files API accepts
  // a Blob and infers from the explicit mimeType we hand it.
  let parsed;
  try {
    const provider = new GeminiProvider();
    parsed = await provider.parseLecture(file, mime);
  } catch (e) {
    return {
      ok: false,
      error: `Gemini failed to parse the lecture: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  // Normalize + dedupe by lower-cased label so Gemini hiccups don't double up.
  const seen = new Set<string>();
  const subconcepts = (parsed.subconcepts ?? [])
    .map((s) => ({
      label: String(s.label ?? "").trim(),
      description: s.description ? String(s.description).trim() : null,
    }))
    .filter((s) => {
      if (s.label.length === 0) return false;
      const key = s.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (subconcepts.length === 0) {
    return { ok: false, error: "Gemini didn't return any subconcepts." };
  }

  // Default the lecture title to the parsed topic, then the file name (sans
  // extension), then a fallback.
  const fallbackTitle = parsed.topic?.trim() || stripExt(file.name) || concept.label;
  const title = titleInput || fallbackTitle;

  // Insert lecture (new column).
  const { data: lecture, error: lErr } = await supabase
    .from("lectures")
    .insert({
      course_id: courseId,
      title,
      uploaded_by: user.id,
      source_type: "text_upload" as const,
      started_at: new Date().toISOString(),
      status: "ready" as const,
    })
    .select("id, title")
    .single();
  if (lErr || !lecture) {
    return { ok: false, error: lErr?.message ?? "Failed to insert lecture." };
  }

  // Insert subconcepts (N new cells under (concept, lecture)).
  const subRows = subconcepts.map((s) => ({
    concept_id: conceptId,
    lecture_id: lecture.id,
    label: s.label,
    description: s.description,
  }));
  const { error: sErr } = await supabase.from("subconcepts").insert(subRows);
  if (sErr) {
    // Best-effort cleanup so we don't leave an orphan empty lecture column.
    await supabase.from("lectures").delete().eq("id", lecture.id);
    return { ok: false, error: sErr.message };
  }

  // Mastery rows for every enrolled student are inserted by
  // trg_backfill_mastery_subconcept (SECURITY DEFINER) — no manual fanout.

  revalidatePath(`/professor/courses/${courseId}`, "page");
  // Student pages live at /student/courses/[id], also revalidate so anyone who
  // navigates there next hits fresh data (realtime sync handles open tabs).
  revalidatePath(`/student/courses/${courseId}`, "page");

  return {
    ok: true,
    lectureTitle: lecture.title,
    subconceptsCreated: subconcepts.length,
  };
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
