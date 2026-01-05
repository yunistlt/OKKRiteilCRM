import { NextResponse } from 'next/server';
import { runRuleEngine } from '@/lib/rule-engine';

export const maxDuration = 300; // Allow 5 minutes execution

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { ruleId, days } = body;

        if (!ruleId || !days) {
            return NextResponse.json({ error: 'Missing ruleId or days' }, { status: 400 });
        }

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        console.log(`[Audit] Starting manual audit for rule ${ruleId} over past ${days} days...`);

        // Run engine for specific rule and range
        const count = await runRuleEngine(
            startDate.toISOString(),
            endDate.toISOString(),
            ruleId
        );

        return NextResponse.json({ success: true, message: 'Audit completed', count });
    } catch (e: any) {
        console.error('[Audit] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
