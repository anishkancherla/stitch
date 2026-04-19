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
  subconcept: string;
}

export interface LectureExtractionResult {
  // we don't need topic because professor will upload under the overarching concept
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
OVERARCHING subconcepts that students need to master after this lecture.

# HARD CONSTRAINT
Return AT MOST 5 subconcepts. Never more than 5. Target 3-5 entries.
Returning 6 or more is a failure. Returning narrow / overlapping topics is a
failure even if you stay under 5.

# THINK BEFORE YOU ANSWER
Before writing the JSON, internally do this:
  1. List every topic you see in the lecture.
  2. For each pair of topics, ask: "Are these two variations or instances of
     the same broader idea?" If yes, MERGE them under the broader idea.
  3. Repeat step 2 until no two remaining topics could be merged.
  4. If you still have more than 5, keep merging the two most related ones.

# GROUPING RULES (do not violate)
A subconcept must be a TOP-LEVEL section heading you would put on a syllabus,
NOT a slide title or sub-bullet. Variations, special cases, sub-techniques,
and individual examples MUST live inside a broader umbrella label.

Concrete merges that are MANDATORY when the corresponding pieces appear:
  * Big-O, Omega (Ω), Theta (Θ), little-o, little-omega, "comparing functions
    using limits", "common growth rates" -> ONE entry "Asymptotic Notation"
  * "RAM model", "counting operations", "time complexity intro",
    "asymptotic motivation", "practical analysis" -> ONE entry
    "Algorithm Analysis Basics"
  * Substitution method, recursion tree, Master Theorem -> ONE entry
    "Recurrence Solving"
  * Insertion sort, merge sort, quicksort, heapsort -> ONE entry
    "Sorting Algorithms"
  * BFS, DFS, Dijkstra, Bellman-Ford -> ONE entry "Graph Traversal" (or
    "Shortest Paths" if that's the lecture's framing)

# WHAT IS A FAILURE
BAD output (too granular — these are all the same umbrella):
  ["Big-O Notation", "Omega Notation", "Theta Notation",
   "Little-o and Little-omega Notation", "Comparing Functions Using Limits",
   "Common Growth Rate Classes", "Algebraic Rules for Asymptotic Notation"]
GOOD output for the SAME lecture:
  ["Algorithm Analysis Basics", "Asymptotic Notation",
   "Comparing Growth Rates", "Common Complexity Classes"]

# OUTPUT SCHEMA
Return JSON matching this schema exactly, with no markdown wrappers:
{
  "topic": "Short title for the whole lecture (optional).",
  "subconcepts": [
    { "label": "Asymptotic Notation", "description": "One sentence on what students should be able to do." }
  ]
}

# OTHER RULES
- Labels: 2-5 words, Title Case, noun phrases.
- Description: one sentence on what the student should be able to do across
  the entire umbrella (cover all merged sub-topics).
- Exclude administrative content (logistics, syllabus recap, agenda, "next
  week" preview, summary, Q&A, references).
- Entries must be unique. Order them in the order they appear in the lecture.

# FINAL CHECK (do this before returning)
Count entries. If > 5, merge until <= 5.
Re-read each label. If any two could plausibly live under one broader heading,
merge them. Only then return.
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
    max = 5,
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
