import { readFileSync } from 'fs';
import { GeminiProvider } from '../src/lib/llm/GeminiProvider';
import { AnthropicProvider } from '../src/lib/llm/AnthropicProvider';
import { config } from 'dotenv';
import * as path from 'path';

// Load variables from .env
config({ path: path.resolve(__dirname, '../.env') });

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Please provide a path to a PDF file.");
        console.error("Usage: npx tsx scripts/testSyllabusParsing.ts <path-to-pdf>");
        process.exit(1);
    }

    const pdfPath = args[0];

    try {
        console.log(`Reading PDF from: ${pdfPath}`);
        const fileBuffer = readFileSync(pdfPath);
        const fileBase64 = fileBuffer.toString('base64');
        console.log(`Base64 conversion successful. (Length: ${fileBase64.length} chars)`);

        // Swap providers here as needed.
        // const provider = new GeminiProvider();
        const provider = new AnthropicProvider();

        console.log(`Initializing ${provider.name}Provider...`);
        console.log(`Sending to ${provider.name} API for processing... (this may take a moment)`);
        const timerLabel = `${provider.name} Response Time`;
        console.time(timerLabel);

        const result = await provider.parseSyllabus(fileBase64, 'application/pdf');

        console.timeEnd(timerLabel);

        console.log(`\n=== ${provider.name.toUpperCase()} PARSING RESULT ===`);
        console.log(JSON.stringify(result, null, 2));

    } catch (error: any) {
        console.error("\n!!! Error during execution !!!");
        console.error(error.message || error);
    }
}

main();
