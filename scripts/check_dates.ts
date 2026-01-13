
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { supabase } from '@/utils/supabase';

async function checkMatchDates() {
    console.log('Checking recent matches...');

    // Get last 20 matches sorted by matched_at
    const { data: matches, error } = await supabase
        .from('call_order_matches')
        .select(`
            matched_at,
            raw_telphin_calls (started_at),
            retailcrm_order_id,
            orders (manager_id)
        `)
        .order('matched_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${matches.length} recent matches.`);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let inToday = 0;
    let inWeek = 0;

    matches.forEach((m: any) => {
        const callDate = new Date(m.raw_telphin_calls.started_at);
        const isToday = callDate >= oneDayAgo;
        const isWeek = callDate >= sevenDaysAgo;

        if (isToday) inToday++;
        if (isWeek) inWeek++;

        const managerId = (m.orders as any)?.manager_id;
        console.log(`Matched: ${m.matched_at} | Call: ${m.raw_telphin_calls.started_at} | Manager: ${managerId} | Age: ${((now.getTime() - callDate.getTime()) / 1000 / 3600).toFixed(1)}h | Today? ${isToday}`);
    });

    console.log('--- Summary ---');
    console.log(`Total Inspected: ${matches.length}`);
    console.log(`In Last 24h: ${inToday}`);
    console.log(`In Last 7d: ${inWeek}`);
}

checkMatchDates();
