export interface CourseConcept {
  week: number;
  concept: string;
}


export interface SyllabusExtractionResult {
  concepts: CourseConcept[];
}

export interface SubconceptExtractionResult {
  subconcepts: string[];
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

protected readonly subconceptPrompt: string = `
You are analyzing a lecture document (e.g. slides or notes). Identify the
high-level subconcepts that this document covers under its overarching topic.

HARD CONSTRAINT: Return AT MOST 5 subconcepts. Never more than 5.
Target 3-5 entries. If your initial list has more than 5, you MUST iteratively
merge the most closely related ones under a broader umbrella label until
5 or fewer remain. Do not return 6+ under any circumstance.

Return JSON matching this schema exactly without any markdown wrappers:
{
  "subconcepts": [
    "..."
  ]
}

Rules:
- Each label should be a short noun phrase of roughly 2-4 words, Title Case.
- A subconcept must represent a major section of the lecture (multiple slides
  or a whole module), not a single slide, example, or definition.
- Aggressively GROUP related variants under one umbrella label. Examples:
    * Big-O, Omega, Theta, little-o, little-omega -> "Asymptotic Notation"
    * Substitution method, recursion tree, Master Theorem -> "Recurrence Solving"
    * Insertion sort, merge sort, quicksort details -> "Sorting Algorithms"
- DO NOT list individual algorithms, theorems, proof techniques, or examples
  as their own subconcepts. They belong inside a broader label.
- Exclude administrative content, logistics, tools, course policies, reading
  assignments, and generic section headers like "Introduction" or "Summary".
- Entries must be unique. Order them roughly by appearance in the document.
- If no substantive subconcepts are present, return an empty array.

FINAL CHECK before returning: count the entries. If count > 5, merge again.
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
   * Parse a lecture document (like a PDF of slides) to extract the specific
   * subconcepts that the document covers.
   * @param fileBase64 The file content as a base64 string
   * @param mimeType The mime type of the file (e.g. 'application/pdf')
   */
  abstract parseSubconcepts(fileBase64: string, mimeType?: string): Promise<SubconceptExtractionResult>;

  /**
   * Defensively extract a JSON object string from raw model output.
   * Strips optional ```json ... ``` fences and slices from the first '{'
   * to the last '}' so JSON.parse won't choke on prose or fences.
   */
  /**
   * Hard cap subconcept results. Models occasionally exceed prompt limits;
   * this guarantees the contract.
   */
  protected normalizeSubconcepts(
    result: SubconceptExtractionResult,
    max = 5,
  ): SubconceptExtractionResult {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const raw of result.subconcepts ?? []) {
      const label = String(raw).trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(label);
      if (deduped.length >= max) break;
    }
    return { subconcepts: deduped };
  }

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
