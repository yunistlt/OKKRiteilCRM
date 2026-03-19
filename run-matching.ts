import { config } from 'dotenv';
config({ path: '.env.local' });
import { processUnmatchedCalls } from './lib/call-matching';

async function test() {
    console.log("Running processUnmatchedCalls...");
    const matches = await processUnmatchedCalls(50);
    console.log("Matched calls:", matches);
}
test();
