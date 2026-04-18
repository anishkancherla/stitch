import { GoogleGenAI } from '@google/genai';
import {
  LLMProvider,
  SyllabusExtractionResult,
  LectureExtractionResult,
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

const LECTURE_PROMPT = `
You are analyzing a single university lecture (slides or notes). Extract the
LECTURE-LEVEL subconcepts that students need to master after this lecture.

Return JSON matching this schema exactly without any markdown wrappers:
{
  "topic": "Short 2-5 word title for the whole lecture, optional.",
  "subconcepts": [
    { "label": "Big-O notation", "description": "One sentence on what students should be able to do." }
  ]
}

Rules:
- Aim for 5-10 subconcepts. Fewer is OK if the lecture is genuinely narrow.
- Subconcept labels must be SECTION-level topics, not bullet-point details.
  GOOD: "Big-O notation", "Analyzing loops", "Space complexity"
  BAD:  "constant time", "linear time", "log n examples", "comparing fractions"
- Exclude administrative content (course logistics, syllabus recap, agenda
  slides, "next week" preview, summary, Q&A, references).
- Each label is 2-6 words, in title case.
- Description is a single sentence summarizing what the student should be
  able to do after this section.
- Order: same order they appear in the lecture.
`.trim();

export class GeminiProvider extends LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(model = 'gemini-2.5-flash') {
    super();
    // Defaulting to process.env.GEMINI_API_KEY
    // Using string index on process.env to avoid potential typescript issues
    const apiKey = process.env['GEMINI_API_KEY'] || '';
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async parseSyllabus(fileBase64: string, mimeType: string = 'application/pdf'): Promise<SyllabusExtractionResult> {
  const prompt = `
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

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: fileBase64,
                mimeType,
              },
            },
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No text returned from Gemini API");
    }

    try {
      const parsed: SyllabusExtractionResult = JSON.parse(text);
      return parsed;
    } catch (e: any) {
      throw new Error("Failed to parse JSON string returned by Gemini: " + e.message + "\\nResponse: " + text);
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
   * Image content from PPTX is dropped — for a 5-10 subconcept extraction
   * task the slide text is plenty.
   */
  async parseLecture(file: Blob, mimeType?: string): Promise<LectureExtractionResult> {
    const mt = mimeType || (file as File).type || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());

    let parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>;

    if (mt === "application/pdf") {
      parts = [
        { inlineData: { data: buf.toString("base64"), mimeType: mt } },
        { text: LECTURE_PROMPT },
      ];
    } else if (mt === PPTX_MIME) {
      const text = await extractPptxText(buf);
      parts = [
        {
          text:
            LECTURE_PROMPT +
            "\n\nLecture slides (extracted text, slide-by-slide):\n\n" +
            text,
        },
      ];
    } else if (mt === DOCX_MIME) {
      const text = await extractDocxText(buf);
      parts = [
        {
          text:
            LECTURE_PROMPT +
            "\n\nLecture document (extracted text):\n\n" +
            text,
        },
      ];
    } else if (mt.startsWith("text/")) {
      const text = extractPlainText(buf);
      parts = [
        {
          text:
            LECTURE_PROMPT +
            "\n\nLecture document (text):\n\n" +
            text,
        },
      ];
    } else {
      throw new Error(`Unsupported lecture MIME type: ${mt}`);
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No text returned from Gemini API");
    }

    try {
      const parsed = JSON.parse(text) as LectureExtractionResult;
      if (!Array.isArray(parsed.subconcepts)) {
        throw new Error("Response missing `subconcepts` array.");
      }
      return parsed;
    } catch (e: any) {
      throw new Error(
        "Failed to parse JSON string returned by Gemini: " + e.message + "\nResponse: " + text
      );
    }
  }
}
