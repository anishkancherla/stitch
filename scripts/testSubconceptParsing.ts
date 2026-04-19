import { readFileSync } from 'fs';
import { GeminiProvider } from '../src/lib/llm/GeminiProvider';
import { AnthropicProvider } from '../src/lib/llm/AnthropicProvider';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(__dirname, '../.env') });

const MIME_BY_EXT: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
};

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Please provide a path to a lecture file (PDF, PPTX, DOCX, TXT).');
        console.error('Usage: npx tsx scripts/testSubconceptParsing.ts <path-to-file> [anthropic|gemini]');
        process.exit(1);
    }

    const filePath = args[0];
    const providerName = (args[1] ?? 'anthropic').toLowerCase();

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) {
        console.error(`Unsupported file extension: ${ext}`);
        process.exit(1);
    }

    try {
        console.log(`Reading file from: ${filePath} (mime: ${mimeType})`);
        const buf = readFileSync(filePath);
        const blob = new Blob([buf], { type: mimeType });

        const provider = providerName === 'gemini'
            ? new GeminiProvider()
            : new AnthropicProvider();

        console.log(`Initializing ${provider.name}Provider...`);
        console.log(`Sending to ${provider.name} API for processing... (this may take a moment)`);
        const timerLabel = `${provider.name} Response Time`;
        console.time(timerLabel);

        const result = await provider.parseLecture(blob, mimeType);

        console.timeEnd(timerLabel);

        console.log(`\n=== ${provider.name.toUpperCase()} LECTURE RESULT ===`);
        console.log(JSON.stringify(result, null, 2));
        console.log(`\nReturned ${result.subconcepts.length} subconcept(s).`);

    } catch (error: any) {
        console.error('\n!!! Error during execution !!!');
        console.error(error.message || error);
    }
}

main();
