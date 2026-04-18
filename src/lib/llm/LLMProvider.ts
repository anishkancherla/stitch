/**
 * One row in the heatmap. Gemini is prompted to return one concept per week,
 * so we keep the week number around for ordering and lecture titles.
 */
export interface CourseConcept {
  week: number;
  concept: string;
}

export interface SyllabusExtractionResult {
  course?: { name: string; code: string };
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
