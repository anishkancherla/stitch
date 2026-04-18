import { readFileSync } from 'fs';
import { GeminiProvider } from '../src/lib/llm/GeminiProvider';
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
        
        console.log("Initializing GeminiProvider...");
        const provider = new GeminiProvider();
        
        console.log("Sending to Gemini API for processing... (this may take a moment)");
        console.time("Gemini Response Time");
        
        const result = await provider.parseSyllabus(fileBase64, 'application/pdf');
        
        console.timeEnd("Gemini Response Time");
        
        console.log("\\n=== PARSING RESULT ===");
        console.log(JSON.stringify(result, null, 2));

    } catch (error: any) {
        console.error("\\n!!! Error during execution !!!");
        console.error(error.message || error);
    }
}

main();
