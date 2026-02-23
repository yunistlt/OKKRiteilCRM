import { NextResponse } from 'next/server';
import { transcribeCall } from '@/lib/transcribe';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const { callId, recordingUrl } = await request.json();

        if (!callId || !recordingUrl) {
            return NextResponse.json({ error: 'Missing callId or recordingUrl' }, { status: 400 });
        }

        console.log(`[API Transcribe] Triggering for ${callId}...`);
        const transcript = await transcribeCall(callId, recordingUrl);

        return NextResponse.json({ success: true, transcript });
    } catch (e: any) {
        console.error('[API Transcribe] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
