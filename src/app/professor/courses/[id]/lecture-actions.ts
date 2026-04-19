"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { OpenAIProvider } from "@/lib/llm/OpenAIProvider";

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

  // Ask OpenAI for subconcepts. Pass the File directly — the provider
  // routes it (PDF inline, PPTX/DOCX extracted to text first).
  let parsed;
  try {
    const provider = new OpenAIProvider();
    parsed = await provider.parseLecture(file, mime);
  } catch (e) {
    return {
      ok: false,
      error: `OpenAI failed to parse the lecture: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  // The provider already hard-caps + dedupes; this is just a defensive
  // belt-and-suspenders pass in case anything slipped through. We carry
  // materials alongside so the (label, summary, key_points) triples stay
  // aligned even after this filter.
  const seen = new Set<string>();
  const subconcepts: string[] = [];
  const materials: { summary: string; keyPoints: string[] }[] = [];
  const parsedSubs = parsed.subconcepts ?? [];
  const parsedMats = parsed.materials ?? [];
  for (let i = 0; i < parsedSubs.length; i++) {
    const label = String(parsedSubs[i] ?? "").trim();
    if (label.length === 0) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    subconcepts.push(label);
    const mat = parsedMats[i];
    materials.push({
      summary: mat?.summary ?? "",
      keyPoints: Array.isArray(mat?.keyPoints) ? mat.keyPoints : [],
    });
  }

  if (subconcepts.length === 0) {
    return { ok: false, error: "Gemini didn't return any subconcepts." };
  }

  // Default lecture title to the file name (sans extension), then the parent
  // concept label as a last-ditch fallback. Subconcept extraction no longer
  // returns a separate "topic" field.
  const fallbackTitle = stripExt(file.name) || concept.label;
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

  // Insert subconcepts (N new cells under (concept, lecture)). We need the
  // returned ids back to attach materials, so use `select`.
  const subRows = subconcepts.map((label) => ({
    concept_id: conceptId,
    lecture_id: lecture.id,
    label,
    description: null,
  }));
  const { data: insertedSubs, error: sErr } = await supabase
    .from("subconcepts")
    .insert(subRows)
    .select("id, label");
  if (sErr || !insertedSubs) {
    // Best-effort cleanup so we don't leave an orphan empty lecture column.
    await supabase.from("lectures").delete().eq("id", lecture.id);
    return { ok: false, error: sErr?.message ?? "Failed to insert subconcepts." };
  }

  // Persist per-subconcept materials. Match by label since the insert
  // doesn't guarantee return order. Materials missing from the LLM (empty
  // summary AND empty key_points) are skipped — defaulting to '' / '[]'
  // would just be noise. Failure to persist materials is non-fatal: the
  // lecture + subconcepts are already committed and the planner falls
  // back to label-only grounding when materials are absent.
  const matByLabel = new Map<string, { summary: string; keyPoints: string[] }>();
  for (let i = 0; i < subconcepts.length; i++) {
    matByLabel.set(subconcepts[i].toLowerCase(), materials[i]);
  }
  const matRows = insertedSubs
    .map((row) => {
      const m = matByLabel.get(String(row.label ?? "").toLowerCase());
      if (!m) return null;
      if (!m.summary && m.keyPoints.length === 0) return null;
      return {
        subconcept_id: row.id as string,
        summary: m.summary,
        key_points: m.keyPoints,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (matRows.length > 0) {
    const { error: mErr } = await supabase
      .from("subconcept_materials")
      .insert(matRows);
    if (mErr) {
      console.warn("[uploadLecture] failed to persist materials:", mErr.message);
    }
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
