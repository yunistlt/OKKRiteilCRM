import { NextResponse } from 'next/server';
import { analyzeViolations } from '@/lib/analysis';

export const dynamic = 'force-dynamic'; // Ensure this runs on every request

export async function GET() {
    try {
        const violations = await analyzeViolations();
        return NextResponse.json({ violations });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
