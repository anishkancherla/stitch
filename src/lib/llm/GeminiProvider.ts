import { GoogleGenAI } from '@google/genai';
import { LLMProvider, SyllabusExtractionResult } from './LLMProvider';

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
}
