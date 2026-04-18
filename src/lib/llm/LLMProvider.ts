export interface CourseConcept {
  label: string;
  description: string;
}


export interface SyllabusExtractionResult {
  course?: { name: string; code: string };
  concepts: CourseConcept[];
}

export abstract class LLMProvider {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Parse a syllabus document (like a PDF) to extract the course and covered concepts.
   * @param fileBase64 The file content as a base64 string
   * @param mimeType The mime type of the file (e.g. 'application/pdf')
   */
  abstract parseSyllabus(fileBase64: string, mimeType?: string): Promise<SyllabusExtractionResult>;
}
