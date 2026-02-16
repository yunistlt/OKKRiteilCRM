
import { NextResponse } from 'next/server';
import { runRuleEngine } from '@/lib/rule-engine';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { logic, entity_type, days = 7 } = body;

        if (!logic) {
            return NextResponse.json({ error: 'Missing logic' }, { status: 400 });
        }

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // We create a "temporary" rule object to pass to the engine
        const tempRule = {
            code: 'dry_run_temp',
            name: 'Dry Run',
            entity_type: entity_type || 'event',
            logic: logic,
            severity: 'medium'
        };

        // Note: runRuleEngine normally fetches rules from DB. 
        // We need a way to run it with a provided rule object.
        // Let's check rule-engine.ts again to see if we can pass a rule object directly.
        // Actually, runRuleEngine always queries okk_rules.
        // I should probably export executeBlockRule or allow runRuleEngine to take an override.

        // RE-EVALUATING: I'll update runRuleEngine to accept an optional rule override.
        const violations = await runRuleEngine(
            startDate.toISOString(),
            endDate.toISOString(),
            undefined, // targetRuleId
            true,      // dryRun
            tempRule   // <--- New parameter needed
        );

        return NextResponse.json({
            success: true,
            violations,
            count: Array.isArray(violations) ? violations.length : 0
        });

    } catch (e: any) {
        console.error('[DryRun] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
