import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider extends LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(model = 'claude-sonnet-4-5') {
    super('Anthropic');
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to your .env file.');
    }
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async parseSyllabus(
    fileBase64: string,
    mimeType: string = 'application/pdf',
  ): Promise<SyllabusExtractionResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: this.syllabusPrompt },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: fileBase64,
              },
            },
          ],
        },
        // Prefill the assistant turn so Claude continues raw JSON
        // instead of wrapping with prose or ```json fences.
        { role: 'assistant', content: [{ type: 'text', text: '{' }] },
      ],
    } as any);

    const text = this.extractTextFromResponse(response);
    if (!text) {
      throw new Error('No text returned from Anthropic API');
    }

    const candidate = text.trimStart().startsWith('{') ? text : `{${text}`;
    const jsonString = this.extractJsonString(candidate);

    try {
      return JSON.parse(jsonString) as SyllabusExtractionResult;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(`Failed to parse JSON string returned by Anthropic: ${message}\nResponse: ${text}`);
    }
  }

  /**
   * Parse a single lecture file into lecture-level subconcepts.
   *
   * Anthropic accepts PDFs natively as `document` blocks; PPTX/DOCX are not
   * supported, so we unzip them and pass the extracted text as a plain
   * `text` block (same fallback path as Gemini).
   */
  async parseLecture(file: Blob, mimeType?: string): Promise<LectureExtractionResult> {
    const mt = mimeType || (file as File).type || 'application/octet-stream';
    const buf = Buffer.from(await file.arrayBuffer());

    type Block =
      | { type: 'text'; text: string }
      | {
          type: 'document';
          source: { type: 'base64'; media_type: string; data: string };
        };
    let content: Block[];

    if (mt === 'application/pdf') {
      content = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: mt,
            data: buf.toString('base64'),
          },
        },
        { type: 'text', text: this.lecturePrompt },
      ];
    } else if (mt === PPTX_MIME) {
      const text = await extractPptxText(buf);
      content = [
        {
          type: 'text',
          text:
            this.lecturePrompt +
            '\n\nLecture slides (extracted text, slide-by-slide):\n\n' +
            text,
        },
      ];
    } else if (mt === DOCX_MIME) {
      const text = await extractDocxText(buf);
      content = [
        {
          type: 'text',
          text:
            this.lecturePrompt +
            '\n\nLecture document (extracted text):\n\n' +
            text,
        },
      ];
    } else if (mt.startsWith('text/')) {
      const text = extractPlainText(buf);
      content = [
        {
          type: 'text',
          text:
            this.lecturePrompt + '\n\nLecture document (text):\n\n' + text,
        },
      ];
    } else {
      throw new Error(`Unsupported lecture MIME type: ${mt}`);
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: [
        { role: 'user', content },
        { role: 'assistant', content: [{ type: 'text', text: '{' }] },
      ],
    } as any);

    const text = this.extractTextFromResponse(response);
    if (!text) {
      throw new Error('No text returned from Anthropic API');
    }
    const candidate = text.trimStart().startsWith('{') ? text : `{${text}`;
    const jsonString = this.extractJsonString(candidate);

    try {
      const parsed = JSON.parse(jsonString) as LectureExtractionResult;
      if (!Array.isArray(parsed.subconcepts)) {
        throw new Error('Response missing `subconcepts` array.');
      }
      return this.normalizeLectureResult(parsed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(
        `Failed to parse JSON string returned by Anthropic: ${message}\nResponse: ${text}`,
      );
    }
  }

  private extractTextFromResponse(response: unknown): string {
    if (!response || typeof response !== 'object') {
      return '';
    }

    const content = (response as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((block) => {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }
}
