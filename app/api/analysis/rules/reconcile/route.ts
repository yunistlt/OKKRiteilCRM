// @ts-nocheck
import { NextResponse } from 'next/server';
import { executeRuleEngineRange, getRuleEngineFallbackHours } from '@/lib/rule-engine-execution';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_FALLBACK_HOURS = getRuleEngineFallbackHours();

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        const now = new Date();
        const lookback = new Date(now.getTime() - DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000);

        const start = searchParams.get('start') || lookback.toISOString();
        const end = searchParams.get('end') || now.toISOString();
        const targetRule = searchParams.get('rule');

        const result = await executeRuleEngineRange({
            start,
            end,
            targetRuleId: targetRule || undefined,
        });

        return NextResponse.json({
            success: true,
            mode: 'fallback_reconcile',
            ...result,
        });
    } catch (e: any) {
        console.error('[RuleEngine Reconcile] Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}