import { GoogleGenAI } from '@google/genai';
import { LLMProvider, SyllabusExtractionResult } from './LLMProvider';

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

  async parseSyllabus(fileBase64: string, mimeType: string = 'application/pdf'): Promise<SyllabusExtractionResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: this.syllabusPrompt },
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

    const jsonString = this.extractJsonString(text);

    try {
      const parsed: SyllabusExtractionResult = JSON.parse(jsonString);
      return parsed;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown JSON parse error';
      throw new Error(`Failed to parse JSON string returned by Gemini: ${message}\nResponse: ${text}`);
    }
  }
}
