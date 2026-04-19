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
}
