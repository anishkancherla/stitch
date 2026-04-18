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
}
