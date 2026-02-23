import { NextResponse } from 'next/server';
import { getTelphinToken } from '@/lib/telphin';

export const dynamic = 'force-dynamic';

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

        return response;
    } catch (e: any) {
        console.error('[Proxy Audio] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
