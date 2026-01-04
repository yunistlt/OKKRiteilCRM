
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

export async function createRule(ruleData: any) {
    const { error } = await supabase
        .from('okk_rules')
        .insert([ruleData]);

    if (error) throw new Error(error.message);
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
