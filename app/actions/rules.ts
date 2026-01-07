
'use server'

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

export async function getRules() {
    const { data, error } = await supabase
        .from('okk_rules')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error fetching rules:', error);
        return [];
    }
    return data;
}

export async function getRuleStats() {
    const { data, error } = await supabase
        .from('okk_violations')
        .select('rule_code');

    if (error) {
        console.error('Error fetching rule stats:', error);
        return {};
    }

    // Count violations per rule
    const stats: Record<string, number> = {};
    data?.forEach((v: any) => {
        if (v.rule_code) {
            stats[v.rule_code] = (stats[v.rule_code] || 0) + 1;
        }
    });

    return stats;
}

export async function updateRuleStatus(code: string, isActive: boolean) {
    const { error } = await supabase
        .from('okk_rules')
        .update({ is_active: isActive })
        .eq('code', code);

    if (error) throw new Error(error.message);
    revalidatePath('/settings/rules');
}

export async function updateRuleParams(code: string, params: any) {
    const { error } = await supabase
        .from('okk_rules')
        .update({ parameters: params })
        .eq('code', code);

    if (error) throw new Error(error.message);
    revalidatePath('/settings/rules');
}

export async function getViolations(limit = 100) {
    const { data, error } = await supabase
        .from('okk_violations')
        .select(`
            id,
            violation_time,
            details,
            severity,
            rule_code,
            okk_rules ( name ),
            managers ( name, email ),
            call_id,
            order_id
        `)
        .order('violation_time', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching violations:', error);
        return [];
    }
    return data;
}

export async function createRule(ruleData: any, historyDays = 0) {
    // 1. If history requested, set initial status in parameters
    const initialParams = ruleData.parameters || {};
    if (historyDays > 0) {
        initialParams.audit_status = 'running';
        initialParams.audit_days = historyDays;
    }

    const { error, data } = await supabase
        .from('okk_rules')
        .insert([{ ...ruleData, parameters: initialParams }])
        .select()
        .single();

    if (error) throw new Error(error.message);

    // 2. If history check requested, trigger background audit
    if (historyDays > 0 && data) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://okk-riteil-crm-aqwq.vercel.app'; // Fallback to current prod URL if env missing
        fetch(`${baseUrl}/api/rules/audit-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ruleId: data.code, // IMPORTANT: Use string code, not numeric id
                days: historyDays
            })
        }).catch(err => console.error('Failed to trigger background audit:', err));
    }

    revalidatePath('/settings/rules');
}

export async function deleteRule(code: string) {
    const { error } = await supabase
        .from('okk_rules')
        .delete()
        .eq('code', code);

    if (error) throw new Error(error.message);
    revalidatePath('/settings/rules');
}
