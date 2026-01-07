import { NextResponse } from 'next/server';
import { runRuleEngine } from '@/lib/rule-engine';
import { supabase } from '@/utils/supabase';

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

        // Update status to running
        const { data: rule } = await supabase.from('okk_rules').select('parameters').eq('code', ruleId).single();
        const currentParams = rule?.parameters || {};
        await supabase.from('okk_rules').update({
            parameters: { ...currentParams, audit_status: 'running', audit_at: new Date().toISOString() }
        }).eq('code', ruleId);

        // Run engine for specific rule and range
        const count = await runRuleEngine(
            startDate.toISOString(),
            endDate.toISOString(),
            ruleId
        );

        // Update status to completed
        await supabase.from('okk_rules').update({
            parameters: { ...currentParams, audit_status: 'completed', audit_at: new Date().toISOString() }
        }).eq('code', ruleId);

        return NextResponse.json({ success: true, message: 'Audit completed', count });
    } catch (e: any) {
        console.error('[Audit] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
