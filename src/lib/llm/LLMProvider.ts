/**
 * One row in the heatmap. Gemini is prompted to return one concept per week,
 * so we keep the week number around for ordering and lecture titles.
 */
export interface CourseConcept {
  week: number;
  concept: string;
}

export interface SyllabusExtractionResult {
  concepts: CourseConcept[];
}

/**
 * One subconcept extracted from a single lecture. These become heatmap cells
 * under (parent concept × this lecture).
 */
export interface LectureSubconcept {
  label: string;
  description?: string;
}

export interface LectureExtractionResult {
  /** Optional best guess at the lecture's overall topic, for UI display only. */
  topic?: string;
  subconcepts: LectureSubconcept[];
}

export abstract class LLMProvider {
  readonly name: string;

  protected readonly syllabusPrompt: string = `
You are analyzing a course syllabus. Extract the single overarching topic for each week.

Return JSON matching this schema exactly without any markdown wrappers:
{
  "concepts": [
    { "week": 1, "concept": "..." }
  ]
}

Rules:
- Exactly ONE concept per week
- The concept should be the week's headline topic (e.g., "Binary Search Trees", not sub-details)
- Exclude tools, languages, policies, and administrative topics
- There should be exactly as many entries as there are weeks in the syllabus
`;

  protected readonly lecturePrompt: string = `
You are analyzing a single university lecture (slides or notes). Extract the
LECTURE-LEVEL subconcepts that students need to master after this lecture.

HARD CONSTRAINT: Return AT MOST 10 subconcepts. Never more than 10.
Target 5-8 entries. If your initial list has more than 10, you MUST iteratively
merge the most closely related ones under a broader umbrella label until
10 or fewer remain. Do not return 11+ under any circumstance.

Return JSON matching this schema exactly without any markdown wrappers:
{
  "topic": "Short title for the whole lecture (optional).",
  "subconcepts": [
    { "label": "Big-O Notation", "description": "One sentence on what students should be able to do." }
  ]
}

Rules:
- Each label is a short noun phrase, roughly 2-6 words, in Title Case.
- A subconcept must represent a SECTION of the lecture (multiple slides or a
  whole module), not a single slide, example, or definition.
- Aggressively GROUP related variants under one umbrella label. Examples:
    * Big-O, Omega, Theta, little-o, little-omega -> "Asymptotic Notation"
    * Substitution method, recursion tree, Master Theorem -> "Recurrence Solving"
    * Insertion sort, merge sort, quicksort details -> "Sorting Algorithms"
- DO NOT list individual algorithms, theorems, proof techniques, or examples
  as their own subconcepts. They belong inside a broader label.
  GOOD: "Big-O Notation", "Analyzing Loops", "Space Complexity"
  BAD:  "Constant Time", "Linear Time", "Log N Examples", "Comparing Fractions"
- Description is a single sentence summarizing what the student should be able
  to do after this section.
- Exclude administrative content (course logistics, syllabus recap, agenda
  slides, "next week" preview, summary, Q&A, references).
- Entries must be unique. Order them in the order they appear in the lecture.

FINAL CHECK before returning: count the entries. If count > 10, merge again.
`;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Parse a syllabus document (like a PDF) to extract the course and covered concepts.
   * @param fileBase64 The file content as a base64 string
   * @param mimeType The mime type of the file (e.g. 'application/pdf')
   */
  abstract parseSyllabus(fileBase64: string, mimeType?: string): Promise<SyllabusExtractionResult>;

  /**
   * Parse a single lecture (PDF, PPTX, etc.) and extract the lecture-level
   * subconcepts students should master. The provider is responsible for
   * uploading large / non-inline-supported file types via the appropriate
   * vendor API (e.g. Gemini Files API for PPTX).
   *
   * @param file The raw lecture file as a Blob/File.
   * @param mimeType MIME type override; if absent we fall back to file.type.
   */
  abstract parseLecture(file: Blob, mimeType?: string): Promise<LectureExtractionResult>;

  /**
   * Hard cap + dedupe lecture results. Models occasionally exceed prompt
   * limits; this guarantees the contract and centralizes the cleanup that
   * every caller would otherwise repeat.
   */
  protected normalizeLectureResult(
    result: LectureExtractionResult,
    max = 10,
  ): LectureExtractionResult {
    const seen = new Set<string>();
    const deduped: LectureSubconcept[] = [];
    for (const raw of result.subconcepts ?? []) {
      const label = String(raw?.label ?? '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const description = raw?.description ? String(raw.description).trim() : undefined;
      deduped.push(description ? { label, description } : { label });
      if (deduped.length >= max) break;
    }
    return {
      topic: result.topic?.trim() || undefined,
      subconcepts: deduped,
    };
  }

  /**
   * Defensively extract a JSON object string from raw model output.
   * Strips optional ```json ... ``` fences and slices from the first '{'
   * to the last '}' so JSON.parse won't choke on prose or fences.
   */
  protected extractJsonString(text: string): string {
    const fenced = text
      .trim()
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      return fenced;
    }
    return fenced.slice(start, end + 1);
  }
}
