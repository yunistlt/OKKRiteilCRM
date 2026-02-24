import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { processUnmatchedCalls } from '../lib/call-matching';

async function main() {
    await processUnmatchedCalls(200);
    console.log("Processing finished.");
}
main().catch(console.error);
