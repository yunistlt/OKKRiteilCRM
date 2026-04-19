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
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            throw new Error(`Audio fetch failed: ${res.status}`);
        }

        const blob = await res.blob();
        const response = new NextResponse(blob);

        // Pass through content type
        const contentType = res.headers.get('content-type') || 'audio/mpeg';
        response.headers.set('Content-Type', contentType);
        Object.entries(NO_STORE_AUDIO_HEADERS).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;
    } catch (e: any) {
        console.error('[Proxy Audio] Error:', e);
        return NextResponse.json({ error: e.message }, {
            status: 500,
            headers: NO_STORE_AUDIO_HEADERS,
        });
    }
}
