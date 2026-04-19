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
 * Lecture-level subconcepts. Each string becomes a heatmap cell under
 * (parent concept × this lecture). We don't carry a `topic` because the
 * professor uploads under an already-chosen overarching concept.
 */
export interface LectureExtractionResult {
  subconcepts: string[];
}

/**
 * Input for quiz generation. The `concept` is the umbrella topic for the
 * quiz; `subconcepts` are the lecture-level sub-topics the quiz must cover.
 */
export interface QuizGenerationInput {
  concept: string;
  subconcepts: string[];
}

export interface MCQQuestion {
  question: string;
  choices: string[];
  answer: string;
}

export interface FreeResponseQuestion {
  question: string;
  answer: string;
}

export interface QuizResult {
  questions: MCQQuestion[] | FreeResponseQuestion[];
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
Analyze this lecture and extract 3-5 overarching subconcepts students must master.

Return JSON with no markdown wrappers:
{
  "subconcepts": ["...", "..."]
}

Rules:
- HARD LIMIT: 3-5 entries. More than 5 is a failure.
- Labels are syllabus-level headings (2-5 words, Title Case), not slide titles.
- Merge related topics: Big-O/Omega/Theta/little-o/limit comparisons → "Asymptotic Notation". RAM model/operation counting/analysis motivation → "Algorithm Analysis Basics". Apply this logic to everything.
- If you have > 5, keep merging the two most related entries until you don't.
- Exclude logistics, policies, summaries, and Q&A slides.
- Order by appearance in the document.
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
   * Generate a short quiz for a single concept and its subconcepts.
   * @param input  The concept (umbrella topic) and the subconcepts to cover.
   * @param isMcq  When true, every question has 4 choices and a correct
   *               answer; when false/omitted, questions are free-response
   *               with a model answer.
   */
  abstract generateQuiz(
    input: QuizGenerationInput,
    isMcq?: boolean,
  ): Promise<QuizResult>;

  /**
   * Build the prompt for quiz generation. Kept on the base class so both
   * providers stay in sync on schema + rules.
   */
  protected buildQuizPrompt(
    input: QuizGenerationInput,
    isMcq: boolean,
  ): string {
    const subList = input.subconcepts
      .map((s, i) => `  ${i + 1}. ${s}`)
      .join('\n');

    const schema = isMcq
      ? `{
  "questions": [
    {
      "question": "...",
      "choices": ["...", "...", "...", "..."],
      "answer": "..."
    }
  ]
}`
      : `{
  "questions": [
    { "question": "...", "answer": "..." }
  ]
}`;

    const typeRules = isMcq
      ? `- Each question MUST have exactly 4 choices.
- "answer" MUST exactly match one of the entries in "choices".
- Distractors should be plausible, not obviously wrong.`
      : `- Each question is short-answer / free-response.
- "answer" should be a concise model answer (1-3 sentences).`;

    return `You are writing a short quiz for a college student studying the concept below.

Concept: ${input.concept}
Subconcepts to cover:
${subList}

Generate 5 questions that, together, cover the listed subconcepts.

Return JSON matching this schema exactly with no markdown wrappers:
${schema}

Rules:
- Output JSON only. No prose, no \`\`\` fences.
- Distribute questions across the subconcepts; don't pile them onto one.
- Questions should test understanding, not pure recall of trivia.
${typeRules}`;
  }

  /**
   * Validate + lightly normalize a parsed quiz response. Throws when the
   * shape is wrong so callers don't have to re-check.
   */
  protected normalizeQuizResult(parsed: unknown, isMcq: boolean): QuizResult {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Quiz response is not an object.');
    }
    const questions = (parsed as { questions?: unknown }).questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Quiz response missing non-empty `questions` array.');
    }

    if (isMcq) {
      const cleaned: MCQQuestion[] = questions.map((q, i) => {
        const obj = q as Partial<MCQQuestion>;
        if (
          typeof obj.question !== 'string' ||
          !Array.isArray(obj.choices) ||
          obj.choices.length !== 4 ||
          !obj.choices.every((c) => typeof c === 'string') ||
          typeof obj.answer !== 'string'
        ) {
          throw new Error(`MCQ question ${i} has invalid shape.`);
        }
        return {
          question: obj.question,
          choices: obj.choices,
          answer: obj.answer,
        };
      });
      return { questions: cleaned };
    }

    const cleaned: FreeResponseQuestion[] = questions.map((q, i) => {
      const obj = q as Partial<FreeResponseQuestion>;
      if (typeof obj.question !== 'string' || typeof obj.answer !== 'string') {
        throw new Error(`Free-response question ${i} has invalid shape.`);
      }
      return { question: obj.question, answer: obj.answer };
    });
    return { questions: cleaned };
  }

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
    const deduped: string[] = [];
    for (const raw of result.subconcepts ?? []) {
      const key = String(raw ?? '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(key);
      if (deduped.length >= max) break;
    }
    return { subconcepts: deduped };
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
