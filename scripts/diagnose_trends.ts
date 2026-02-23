import { supabase } from '../utils/supabase';

async function diagnose() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    console.log('Checking from:', twentyFourHoursAgo);

    // 1. Matches
    const { data: matched, error: e1 } = await supabase
        .from('call_order_matches')
        .select('matched_at')
        .gte('matched_at', twentyFourHoursAgo);

    console.log('Recent matches count (matched_at):', matched?.length || 0);

    // 2. Transcriptions
    const { data: transcribed, error: e2 } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, transcript')
        .gte('started_at', twentyFourHoursAgo);

    console.log('Recent calls count:', transcribed?.length || 0);
    console.log('Recent transcripts count:', transcribed?.filter(t => t.transcript).length || 0);

    // 3. Evaluations
    const { data: evals, error: e3 } = await supabase
        .from('okk_order_scores')
        .select('eval_date')
        .gte('eval_date', twentyFourHoursAgo);

    console.log('Recent evaluations count:', evals?.length || 0);
}

diagnose();
