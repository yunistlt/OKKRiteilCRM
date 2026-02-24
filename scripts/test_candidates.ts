import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';
import { findOrderCandidatesByPhone } from '../lib/call-matching';

async function main() {
    console.log("Starting debug...");

    // Test the specific phone numbers
    const phonesToTest = ['+78432790489', '+79053167593'];

    for (const phone of phonesToTest) {
        console.log(`\nTesting Candidates for ${phone}:`);
        const candidates = await findOrderCandidatesByPhone(phone);
        console.log(`Candidates found: ${candidates.length}`);
        console.log(JSON.stringify(candidates, null, 2));
    }
}
main().catch(console.error);
