// Drop-in replacement for GeminiProvider that runs everything through
// OpenAI. Same `LLMProvider` contract — same prompts (inherited from the
// base class), same returned shapes — so the two professor upload paths
// (`syllabus-actions.ts` and `lecture-actions.ts`) just instantiate this
// instead and don't notice the swap.
//
// File handling:
//   - PDFs go inline as a base64 data URL via OpenAI's `file` content
//     type. gpt-4o / gpt-4o-mini both ingest PDFs natively in chat
//     completions, so we don't need a separate text extractor.
//   - PPTX / DOCX / text are extracted to plain text first (same path
//     as the Gemini provider) and fed in as text content. OpenAI's PDF
//     ingestion path doesn't accept those MIME types either, so this is
//     the right move regardless.

import OpenAI from "openai";
import {
  LLMProvider,
  SyllabusExtractionResult,
  LectureExtractionResult,
  QuizGenerationInput,
  QuizResult,
} from "./LLMProvider";
import {
  extractPptxText,
  extractDocxText,
  extractPlainText,
} from "./officeText";
import { DEFAULT_MODEL } from "./openaiClient";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class OpenAIProvider extends LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(model: string = DEFAULT_MODEL) {
    super("OpenAI");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Add it to .env.local.");
    }
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async parseSyllabus(
    fileBase64: string,
    mimeType: string = "application/pdf",
  ): Promise<SyllabusExtractionResult> {
    const text = await this.callWithPdf(
      this.syllabusPrompt,
      fileBase64,
      mimeType,
      "syllabus.pdf",
    );

    const jsonString = this.extractJsonString(text);
    try {
      return JSON.parse(jsonString) as SyllabusExtractionResult;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown JSON parse error";
      throw new Error(
        `Failed to parse JSON returned by OpenAI: ${message}\nResponse: ${text}`,
      );
    }
  }

  /**
   * Parse a single lecture into lecture-level subconcepts + per-subconcept
   * materials. Mirrors GeminiProvider.parseLecture but routes file content
   * through OpenAI:
   *   - PDF       → inline base64 via the `file` content part
   *   - PPTX/DOCX → unzip + extract slide/paragraph XML server-side, send as text
   *   - text/*    → decode as UTF-8, send as text
   */
  async parseLecture(
    file: Blob,
    mimeType?: string,
  ): Promise<LectureExtractionResult> {
    const mt = mimeType || (file as File).type || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());

    let text: string;
    if (mt === "application/pdf") {
      text = await this.callWithPdf(
        this.lecturePrompt,
        buf.toString("base64"),
        mt,
        "lecture.pdf",
      );
    } else if (mt === PPTX_MIME) {
      const extracted = await extractPptxText(buf);
      text = await this.callTextOnly(
        this.lecturePrompt +
          "\n\nLecture slides (extracted text, slide-by-slide):\n\n" +
          extracted,
      );
    } else if (mt === DOCX_MIME) {
      const extracted = await extractDocxText(buf);
      text = await this.callTextOnly(
        this.lecturePrompt +
          "\n\nLecture document (extracted text):\n\n" +
          extracted,
      );
    } else if (mt.startsWith("text/")) {
      const extracted = extractPlainText(buf);
      text = await this.callTextOnly(
        this.lecturePrompt + "\n\nLecture document (text):\n\n" + extracted,
      );
    } else {
      throw new Error(`Unsupported lecture MIME type: ${mt}`);
    }

    try {
      const parsed = JSON.parse(this.extractJsonString(text)) as LectureExtractionResult;
      if (!Array.isArray(parsed.subconcepts)) {
        throw new Error("Response missing `subconcepts` array.");
      }
      return this.normalizeLectureResult(parsed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown JSON parse error";
      throw new Error(
        `Failed to parse JSON returned by OpenAI: ${message}\nResponse: ${text}`,
      );
    }
  }

  /**
   * AI-invented fallback content for `subconcept_materials` when the
   * original lecture file isn't available. Used only by the backfill
   * scripts; the live demo never hits this path.
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

    const text = await this.callTextOnly(prompt);

    const jsonString = this.extractJsonString(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown JSON parse error";
      throw new Error(
        `Failed to parse JSON returned by OpenAI: ${message}\nResponse: ${text}`,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Backfill response is not an object");
    }
    const obj = parsed as {
      summary?: unknown;
      key_points?: unknown;
      keyPoints?: unknown;
    };
    const summary = String(obj.summary ?? "").trim();
    const kpRaw = Array.isArray(obj.keyPoints) ? obj.keyPoints : obj.key_points;
    const keyPoints = Array.isArray(kpRaw)
      ? kpRaw
          .map((kp) => String(kp ?? "").trim())
          .filter((kp) => kp.length > 0)
          .slice(0, 7)
      : [];

    if (!summary && keyPoints.length === 0) {
      throw new Error("Backfill response had neither summary nor key_points");
    }

    return { summary, keyPoints };
  }

  async generateQuiz(
    input: QuizGenerationInput,
    isMcq: boolean = false,
  ): Promise<QuizResult> {
    const prompt = this.buildQuizPrompt(input, isMcq);
    const text = await this.callTextOnly(prompt);

    const jsonString = this.extractJsonString(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown JSON parse error";
      throw new Error(
        `Failed to parse JSON returned by OpenAI: ${message}\nResponse: ${text}`,
      );
    }
    return this.normalizeQuizResult(parsed, isMcq);
  }

  // -------------------------------------------------------------------------
  // Internal call helpers. Both force JSON output via response_format.
  // -------------------------------------------------------------------------

  private async callTextOnly(prompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });
    const text = res.choices[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenAI");
    return text;
  }

  private async callWithPdf(
    prompt: string,
    fileBase64: string,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename,
                file_data: `data:${mimeType};base64,${fileBase64}`,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });
    const text = res.choices[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenAI");
    return text;
  }
}
