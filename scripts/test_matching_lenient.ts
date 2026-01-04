
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { processUnmatchedCalls } from '../lib/call-matching';

async function testLenient() {
    console.log('Testing Lenient Matching (5 digits)...');

    // Process 100 calls
    const matches = await processUnmatchedCalls(100);

    console.log(`Found ${matches} new matches.`);
}

testLenient();
