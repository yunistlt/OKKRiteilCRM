import { NextResponse } from 'next/server';
import { runTelphinSync } from '@/lib/sync/telphin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const forceResync = searchParams.get('force') === 'true';

    const result = await runTelphinSync(forceResync);

    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json(result);
}
