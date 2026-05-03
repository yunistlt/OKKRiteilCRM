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
        let res = await fetch(url);

        // Some Telphin links require OAuth token. Use it as fallback, not as strict prerequisite.
        if ((res.status === 401 || res.status === 403) && !res.ok) {
            let token: string | null = null;
            try {
                token = await getTelphinToken();
            } catch {
                token = null;
            }

            if (token) {
                res = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });
            }
        }

        if (!res.ok) {
            throw new Error(`Audio fetch failed: ${res.status}`);
        }

        const blob = await res.blob();
        const response = new NextResponse(blob);

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
