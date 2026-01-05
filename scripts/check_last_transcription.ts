
import * as dotenv from 'dotenv';
// Load .env.local just in case shared client needs it, though it has fallback
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');

import { supabase } from '../utils/supabase';

async function checkLastTranscription() {
    console.log('Checking for latest transcription...');

    // 1. Try to find calls with a transcript in raw_payload
    const { data: calls, error } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, started_at, ingested_at, raw_payload')
        .not('raw_payload->transcript', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Error fetching calls:', error);
        return;
    }

    if (!calls || calls.length === 0) {
        console.log('No transcripts found in raw_telphin_calls (raw_payload->transcript is null for all).');

        // Check if there is another table?
        console.log('Checking alternative locations...');

        // 2. Also check if there's a specific "transcriptions" table
        const { error: tableError } = await supabase.from('transcriptions').select('*').limit(1);
        if (tableError && tableError.message.includes('relation "public.transcriptions" does not exist')) {
            console.log('(Confirmed: table "transcriptions" does not exist)');
        } else if (!tableError) {
            console.log('!!! Table "transcriptions" DOES exist. Fetching latest from there...');
            const { data: tData } = await supabase.from('transcriptions').select('*').order('created_at', { ascending: false }).limit(1);
            console.log('Latest from "transcriptions" table:', tData);
        }

    } else {
        const call = calls[0];
        console.log('--- Latest Transcribed Call ---');
        console.log('ID:', call.telphin_call_id);
        console.log('Call Started:', call.started_at);
        console.log('Ingested At:', call.ingested_at);

        const transcript = call.raw_payload.transcript;
        if (typeof transcript === 'string') {
            console.log('Transcript Preview:', transcript.substring(0, 100) + '...');
        } else {
            console.log('Transcript Object:', JSON.stringify(transcript).substring(0, 100));
        }
    }

    // 3. Check ABSOLUTE latest ingestion
    const { data: latestRaw } = await supabase
        .from('raw_telphin_calls')
        .select('ingested_at, started_at')
        .order('ingested_at', { ascending: false })
        .limit(1);

    if (latestRaw && latestRaw.length > 0) {
        console.log('\n--- ABSOLUTE LATEST INGESTION ---');
        console.log('Ingested At:', latestRaw[0].ingested_at);
        console.log('Call Started:', latestRaw[0].started_at);
    }
}

checkLastTranscription();
