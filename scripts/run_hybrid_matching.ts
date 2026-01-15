
// Mocking the environment for the library execution
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lywtzgntmibdpgoijbty.supabase.co';
// We need the service role key ideally, butanon key works for RLS if policies allow insert.
// Usually matching needs Service Role.
// I will override the supabase client in the script or hope the lib uses the one from utils which uses env vars.
// The lib uses `import { supabase } from '@/utils/supabase';`
// I can't easily execute that via ts-node without setting up aliases.

// PLAN B: Copy the ESSENTIAL logic into this script to run it once.
// This guarantees it works.

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Use SERVICE ROLE KEY for matching rights if available, else ANON
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- UTILS ---
function normalizePhone(phone: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return null;
    return digits;
}

// --- LOGIC ---
async function matchCallToOrders(call: any) {
    const clientPhone = call.direction === 'incoming' ? call.from_number : call.to_number;
    const normalized = normalizePhone(clientPhone);
    if (!normalized) return [];

    const suffix = normalized.slice(-7);

    // Find candidates
    const { data: phoneEvents } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, phone, additional_phone, occurred_at')
        .or(`phone_normalized.like.%${suffix},additional_phone_normalized.like.%${suffix}`)
        .order('occurred_at', { ascending: false })
        .limit(20);

    if (!phoneEvents || phoneEvents.length === 0) return [];

    const matches: any[] = [];
    const candidates = new Set(phoneEvents.map((e: any) => e.retailcrm_order_id));

    // Get orders details (created_at) for candidates
    const { data: orders } = await supabase
        .from('orders')
        .select('id, created_at, customer_phones')
        .in('id', Array.from(candidates));

    if (!orders) return [];

    for (const order of orders) {
        const orderTime = new Date(order.created_at).getTime();
        const callTime = new Date(call.started_at).getTime();
        const diffSec = Math.abs(callTime - orderTime) / 1000;

        // 48 hours = 172800 sec
        if (diffSec <= 172800) {
            matches.push({
                telphin_call_id: call.telphin_call_id,
                retailcrm_order_id: order.id,
                match_type: 'by_partial_phone', // Using safe existing enum
                confidence_score: 0.85,
                explanation: `Match 48h window (Script Fix): ${Math.round(diffSec / 3600)}h diff`,
                matching_factors: {
                    phone_match: true,
                    time_diff_sec: diffSec,
                    source: 'script_fix'
                }
            });
        }
    }
    return matches;
}

async function run() {
    console.log('--- Running 48h Matching Fix ---');

    // 1. Get recent unmatched calls (last 7 days to cover the reported issues)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentCalls } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .gte('started_at', sevenDaysAgo.toISOString())
        .order('started_at', { ascending: false })
        .limit(200);

    if (!recentCalls) return;

    // We process ALL recent calls to fix stolen/bad matches
    const unmatched = recentCalls;
    console.log(`Processing ${unmatched.length} recent calls...`);

    let newMatchesCount = 0;

    for (const call of unmatched) {
        const matches = await matchCallToOrders(call);
        if (matches.length > 0) {
            const best = matches[0]; // take first
            console.log(`✅ MATCH FOUND! Call ${call.telphin_call_id} -> Order ${best.retailcrm_order_id} (${best.explanation})`);

            // Save
            const { error } = await supabase.from('call_order_matches').insert({
                telphin_call_id: best.telphin_call_id,
                retailcrm_order_id: best.retailcrm_order_id,
                match_type: best.match_type,
                confidence_score: best.confidence_score,
                explanation: best.explanation,
                matching_factors: best.matching_factors,
                rule_id: 'script_fix_v1'
            });

            if (error) console.error('Save Error:', error.message);
            else newMatchesCount++;
        }
    }

    console.log(`\nDone. Created ${newMatchesCount} new matches.`);
}

run();
