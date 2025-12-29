import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const TELPHIN_KEY = process.env.TELPHIN_APP_KEY;
const TELPHIN_SECRET = process.env.TELPHIN_APP_SECRET;

// Helper to get token if needed, or just standard API calls depending on Telphin's auth method.
// Assuming OAuth2 or similar based on "App Key/Secret".

async function getTelphinToken() {
    // Placeholder for token exchange logic
    // const res = await fetch('https://api.telphin.ru/oauth/token', ...)
    return "access_token_placeholder";
}

export async function GET() {
    if (!TELPHIN_KEY || !TELPHIN_SECRET) {
        return NextResponse.json({ error: 'Telphin config missing' }, { status: 500 });
    }

    try {
        // const token = await getTelphinToken();

        // Example: Fetch calls for today
        // This is a mock implementation as Telphin API details vary
        const mockCalls = [
            { id: 'call_1', duration: 120, status: 'success', manager_id: 'user_1', timestamp: new Date().toISOString() }
        ];

        // TODO: Replace with real fetch
        // const response = await fetch('https://api.telphin.ru/api/v1/calls/history', { 
        //     headers: { Authorization: `Bearer ${token}` } 
        // });

        const { error } = await supabase.from('calls').upsert(mockCalls);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, count: mockCalls.length });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
