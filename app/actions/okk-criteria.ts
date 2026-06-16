'use server'

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

async function ensureAdminAccess() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin'])) {
        throw new Error('Forbidden');
    }
}

const ALLOWED_FIELDS = [
    'label', 'category', 'group_color', 'cell_bg', 'type', 'agent', 'agent_emoji',
    'eval_method', 'ai_prompt', 'params', 'scoring_basket', 'how_tip', 'data_tip',
    'sort_order', 'is_active',
] as const;

function pickFields(data: Record<string, any>) {
    const out: Record<string, any> = {};
    for (const f of ALLOWED_FIELDS) {
        if (data[f] !== undefined) out[f] = data[f];
    }
    out.updated_at = new Date().toISOString();
    return out;
}

/** Все критерии (включая выключенные) в порядке отображения — для админки. */
export async function listAllCriteria() {
    await ensureAdminAccess();
    const { data, error } = await supabase
        .from('okk_criteria')
        .select('*')
        .order('sort_order', { ascending: true });
    if (error) {
        console.error('Error fetching criteria:', error);
        return [];
    }
    return data || [];
}

/** Создать критерий. key уникален (PK). Пустой scoring_basket → не участвует в балле. */
export async function createCriterion(data: Record<string, any>) {
    await ensureAdminAccess();

    const key = String(data.key || '').trim();
    if (!/^[a-z0-9_]+$/.test(key)) {
        throw new Error('Технический код: только латиница в нижнем регистре, цифры и подчёркивание.');
    }
    if (!String(data.label || '').trim()) throw new Error('Укажите название критерия.');
    if (!String(data.category || '').trim()) throw new Error('Укажите категорию.');

    // Новый критерий — в конец его категории по порядку.
    const { data: maxRow } = await supabase
        .from('okk_criteria')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
    const nextOrder = (maxRow?.sort_order ?? 0) + 10;

    const payload = {
        key,
        ...pickFields(data),
        sort_order: data.sort_order ?? nextOrder,
        is_active: data.is_active ?? true,
    };

    const { error } = await supabase.from('okk_criteria').insert([payload]);
    if (error) {
        if ((error as any).code === '23505') throw new Error(`Критерий с кодом «${key}» уже существует.`);
        throw new Error(error.message);
    }
    revalidatePath('/okk/criteria');
    revalidatePath('/okk');
}

/** Обновить поля критерия (кроме key). */
export async function updateCriterion(key: string, data: Record<string, any>) {
    await ensureAdminAccess();
    const { error } = await supabase
        .from('okk_criteria')
        .update(pickFields(data))
        .eq('key', key);
    if (error) throw new Error(error.message);
    revalidatePath('/okk/criteria');
    revalidatePath('/okk');
}

/** Вкл/выкл критерий (мягкое скрытие из таблицы и балла). */
export async function toggleCriterion(key: string, isActive: boolean) {
    await ensureAdminAccess();
    const { error } = await supabase
        .from('okk_criteria')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('key', key);
    if (error) throw new Error(error.message);
    revalidatePath('/okk/criteria');
    revalidatePath('/okk');
}

/** Удалить критерий (жёстко). Исторические значения в score_breakdown сохраняются как есть. */
export async function deleteCriterion(key: string) {
    await ensureAdminAccess();
    const { error } = await supabase.from('okk_criteria').delete().eq('key', key);
    if (error) throw new Error(error.message);
    revalidatePath('/okk/criteria');
    revalidatePath('/okk');
}

/** Массовая перестановка порядка: массив ключей в новом порядке → sort_order 10,20,30… */
export async function reorderCriteria(orderedKeys: string[]) {
    await ensureAdminAccess();
    const now = new Date().toISOString();
    for (let i = 0; i < orderedKeys.length; i++) {
        const { error } = await supabase
            .from('okk_criteria')
            .update({ sort_order: (i + 1) * 10, updated_at: now })
            .eq('key', orderedKeys[i]);
        if (error) throw new Error(error.message);
    }
    revalidatePath('/okk/criteria');
    revalidatePath('/okk');
}
