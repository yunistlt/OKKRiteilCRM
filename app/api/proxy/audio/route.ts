import { NextResponse } from 'next/server';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';

const NO_STORE_AUDIO_HEADERS = {
    'Cache-Control': 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing audio URL' }, { status: 400 });
    }

    try {
        const token = await getTelphinToken();

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            throw new Error(`Telphin Proxy Failed: ${res.status} ${res.statusText}`);
        }

        // Forward the audio stream
        const contentType = res.headers.get('Content-Type') || 'audio/mpeg';
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
            headers: {
                'Content-Type': contentType,
                ...NO_STORE_AUDIO_HEADERS,
            }
        });

    } catch (e: any) {
        console.error('[AudioProxy] Error:', e);
        return NextResponse.json({ error: e.message }, {
            status: 500,
            headers: NO_STORE_AUDIO_HEADERS,
        });
    }
}
