import { config } from 'dotenv';
config({ path: '.env.local' });
import { findOrderCandidatesByPhone } from './lib/call-matching';

async function test() {
    const candidates = await findOrderCandidatesByPhone('+79299259612');
    console.log("Candidates:", candidates);
}
test();
