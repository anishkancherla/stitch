import { GeminiProvider } from '../src/lib/llm/GeminiProvider';
import { AnthropicProvider } from '../src/lib/llm/AnthropicProvider';
import { LLMProvider, QuizGenerationInput } from '../src/lib/llm/LLMProvider';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(__dirname, '../.env') });

const MOCK_INPUT: QuizGenerationInput = {
    concept: 'Algorithms',
    subconcepts: [
        'Asymptotic Notation',
        'Divide and Conquer',
        'Dynamic Programming',
    ],
};

async function runQuiz(provider: LLMProvider, isMcq: boolean) {
    const label = `${provider.name} ${isMcq ? 'MCQ' : 'FRQ'} Response Time`;
    console.log(`\n--- ${provider.name} | isMcq=${isMcq} ---`);
    console.time(label);
    const result = await provider.generateQuiz(MOCK_INPUT, isMcq);
    console.timeEnd(label);
    console.log(JSON.stringify(result, null, 2));
    console.log(`Returned ${result.questions.length} question(s).`);
}

type Mode = 'mcq' | 'frq' | 'both';
type ProviderName = 'gemini' | 'anthropic';

const PROVIDERS: ProviderName[] = ['gemini', 'anthropic'];
const MODES: Mode[] = ['mcq', 'frq', 'both'];

function parseArgs(argv: string[]): { providerName: ProviderName; mode: Mode } {
    let providerName: ProviderName = 'gemini';
    let mode: Mode = 'both';
    for (const raw of argv) {
        const a = raw.toLowerCase();
        if ((PROVIDERS as string[]).includes(a)) {
            providerName = a as ProviderName;
        } else if ((MODES as string[]).includes(a)) {
            mode = a as Mode;
        } else {
            console.error(`Unknown argument: ${raw}`);
            console.error('Usage: npx tsx scripts/testGenerateQuiz.ts [gemini|anthropic] [mcq|frq|both]');
            process.exit(1);
        }
    }
    return { providerName, mode };
}

async function main() {
    const { providerName, mode: modeArg } = parseArgs(process.argv.slice(2));

    const provider: LLMProvider =
        providerName === 'anthropic' ? new AnthropicProvider() : new GeminiProvider();

    console.log(`Initializing ${provider.name}Provider...`);
    console.log('Mock input:');
    console.log(JSON.stringify(MOCK_INPUT, null, 2));

    try {
        if (modeArg === 'mcq' || modeArg === 'both') {
            await runQuiz(provider, true);
        }
        if (modeArg === 'frq' || modeArg === 'both') {
            await runQuiz(provider, false);
        }
    } catch (error: any) {
        console.error('\n!!! Error during execution !!!');
        console.error(error.message || error);
        process.exit(1);
    }
}

main();
