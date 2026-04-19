import { GoogleGenAI } from '@google/genai';
import {
  LLMProvider,
  SyllabusExtractionResult,
  LectureExtractionResult,
  QuizGenerationInput,
  QuizResult,
} from './LLMProvider';
import {
  extractPptxText,
  extractDocxText,
  extractPlainText,
} from './officeText';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class GeminiProvider extends LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(model = 'gemini-2.5-flash') {
    super('Gemini');
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async parseSyllabus(
    fileBase64: string,
    mimeType: string = 'application/pdf',
  ): Promise<SyllabusExtractionResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: this.syllabusPrompt },
            { inlineData: { data: fileBase64, mimeType } },
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) {
      throw new Error('No text returned from Gemini API');
    }

    const jsonString = this.extractJsonString(text);
    try {
      return JSON.parse(jsonString) as SyllabusExtractionResult;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(`Failed to parse JSON string returned by Gemini: ${message}\nResponse: ${text}`);
    }
  }

  /**
   * Parse a single lecture file into lecture-level subconcepts.
   *
   * Why two paths:
   *   - PDFs → sent directly via `inlineData`. Gemini reads them natively,
   *     including diagrams.
   *   - PPTX / DOCX → Gemini's API rejects these MIME types even via the
   *     Files API (returns 400 "Unsupported MIME type"). So we unzip them
   *     server-side, pull the visible text out of the slide / paragraph XML,
   *     and feed that as a plain text prompt instead.
   *   - text/* → just decoded as UTF-8.
   *
   * Image content from PPTX is dropped — for a 3-5 subconcept extraction
   * task the slide text is plenty.
   */
  async parseLecture(file: Blob, mimeType?: string): Promise<LectureExtractionResult> {
    const mt = mimeType || (file as File).type || 'application/octet-stream';
    const buf = Buffer.from(await file.arrayBuffer());

    let parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>;

    if (mt === 'application/pdf') {
      parts = [
        { inlineData: { data: buf.toString('base64'), mimeType: mt } },
        { text: this.lecturePrompt },
      ];
    } else if (mt === PPTX_MIME) {
      const text = await extractPptxText(buf);
      parts = [
        {
          text:
            this.lecturePrompt +
            '\n\nLecture slides (extracted text, slide-by-slide):\n\n' +
            text,
        },
      ];
    } else if (mt === DOCX_MIME) {
      const text = await extractDocxText(buf);
      parts = [
        {
          text:
            this.lecturePrompt +
            '\n\nLecture document (extracted text):\n\n' +
            text,
        },
      ];
    } else if (mt.startsWith('text/')) {
      const text = extractPlainText(buf);
      parts = [
        {
          text:
            this.lecturePrompt + '\n\nLecture document (text):\n\n' + text,
        },
      ];
    } else {
      throw new Error(`Unsupported lecture MIME type: ${mt}`);
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts }],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) {
      throw new Error('No text returned from Gemini API');
    }

    try {
      const parsed = JSON.parse(text) as LectureExtractionResult;
      if (!Array.isArray(parsed.subconcepts)) {
        throw new Error('Response missing `subconcepts` array.');
      }
      return this.normalizeLectureResult(parsed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(
        `Failed to parse JSON string returned by Gemini: ${message}\nResponse: ${text}`,
      );
    }
  }

  /**
   * Generate stand-in `subconcept_materials` content for a single subconcept
   * when we don't have the original lecture file to extract from. Used by
   * `scripts/backfillMaterials.ts` to retroactively fill in summary +
   * key_points after the fact (e.g. lectures uploaded before the materials
   * pipeline existed). Output schema mirrors a single entry from
   * `LectureExtractionResult.materials` so downstream consumers don't
   * notice the difference.
   */
  async backfillSubconceptMaterials(args: {
    courseLabel: string;
    conceptLabel: string;
    subconceptLabel: string;
  }): Promise<{ summary: string; keyPoints: string[] }> {
    const prompt = `You are filling in lecture materials for a college course because the original lecture file is no longer available. Write content a student would expect to see in a standard lecture on this exact subtopic.

Course: ${args.courseLabel}
Concept (week's umbrella topic): ${args.conceptLabel}
Subconcept to cover: ${args.subconceptLabel}

Return JSON with no markdown wrappers:
{
  "summary": "<1-2 sentence plain-prose explanation>",
  "key_points": ["<bullet>", "<bullet>", "<bullet>", "<bullet>", "<bullet>"]
}

Rules:
- "summary" is 1-2 sentences. Plain prose, no headings, no markdown.
- Exactly 5 short key_points strings. Each is a self-contained claim, formula, definition, example, or pitfall.
- Preserve formulas exactly (e.g. "f(n) = O(g(n))").
- No filler ("This is important"). No meta ("see slide 12"). No questions. No "Note that...".
- Treat "${args.subconceptLabel}" as the precise subtopic — don't drift to the broader concept.
- Output JSON only. No prose, no \`\`\` fences.`;

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) {
      throw new Error('No text returned from Gemini API');
    }

    const jsonString = this.extractJsonString(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(
        `Failed to parse JSON returned by Gemini: ${message}\nResponse: ${text}`,
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Backfill response is not an object');
    }
    const obj = parsed as { summary?: unknown; key_points?: unknown; keyPoints?: unknown };
    const summary = String(obj.summary ?? '').trim();
    const kpRaw = Array.isArray(obj.keyPoints) ? obj.keyPoints : obj.key_points;
    const keyPoints = Array.isArray(kpRaw)
      ? kpRaw
          .map((kp) => String(kp ?? '').trim())
          .filter((kp) => kp.length > 0)
          .slice(0, 7)
      : [];

    if (!summary && keyPoints.length === 0) {
      throw new Error('Backfill response had neither summary nor key_points');
    }

    return { summary, keyPoints };
  }

  async generateQuiz(
    input: QuizGenerationInput,
    isMcq: boolean = false,
  ): Promise<QuizResult> {
    const prompt = this.buildQuizPrompt(input, isMcq);

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) {
      throw new Error('No text returned from Gemini API');
    }

    const jsonString = this.extractJsonString(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(
        `Failed to parse JSON string returned by Gemini: ${message}\nResponse: ${text}`,
      );
    }
    return this.normalizeQuizResult(parsed, isMcq);
  }
}
