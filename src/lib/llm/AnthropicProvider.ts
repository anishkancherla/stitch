import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, SyllabusExtractionResult } from './LLMProvider';

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
        {
          role: 'assistant',
          content: [{ type: 'text', text: '{' }],
        },
      ],
    } as any);

    const text = this.extractTextFromResponse(response);
    if (!text) {
      throw new Error('No text returned from Anthropic API');
    }

    // The prefilled '{' is not echoed back in the response, so re-prepend it
    // when the model continued from an opened object.
    const candidate = text.trimStart().startsWith('{') ? text : `{${text}`;
    const jsonString = this.extractJsonString(candidate);

    try {
      const parsed: SyllabusExtractionResult = JSON.parse(jsonString);
      return parsed;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(`Failed to parse JSON string returned by Anthropic: ${message}\nResponse: ${text}`);
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
