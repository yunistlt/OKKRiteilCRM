// @ts-nocheck
import { NextResponse } from 'next/server';
import { executeRuleEngineRange, getRuleEngineFallbackHours, isRealtimeRuleEngineEnabled } from '@/lib/rule-engine-execution';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_FALLBACK_HOURS = getRuleEngineFallbackHours();

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';
        const hasExplicitWindow = searchParams.has('start') || searchParams.has('end') || searchParams.has('rule');

        if (isRealtimeRuleEngineEnabled() && !force && !hasExplicitWindow) {
            return NextResponse.json({
                success: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production rule flow. Use explicit start/end/rule or force=true for emergency fallback reconcile.',
            });
        }

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