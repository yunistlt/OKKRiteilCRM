
import { supabase } from '../utils/supabase';

const defaultRules = [
    {
        code: 'rule_manager_comment_missing',
        name: 'Отсутствие объясняющего комментария',
        description: 'Проверка наличия объясняющего комментария при смене статуса (AI анализ смысла)',
        entity_type: 'event',
        condition_sql: "field_name = 'status' AND (om.full_order_context->>'manager_comment' IS NULL OR om.full_order_context->>'manager_comment' = '')",
        severity: 'medium',
        rule_type: 'semantic',
        is_active: true,
        semantic_prompt: "Проанализируй, объясняет ли комментарий менеджера причину смены статуса заказа на '{{new_value}}'. Комментарий должен быть актуальным и описывать действия или причины. Старые, неактуальные комментарии или отсутствие смысловой нагрузки (например 'ок', 'тест') считаются нарушением.",
        parameters: { manager_ids: [249, 98, 358, 10] }
    },
    {
        code: 'rule_next_contact_date_unjustified',
        name: 'Необоснованный перенос даты контакта',
        description: 'Проверка изменения даты следующего контакта на будущее без совершения звонков в этот день.',
        entity_type: 'event',
        condition_sql: "field_name = 'next_contact_date'",
        severity: 'high',
        rule_type: 'sql',
        is_active: true,
        parameters: { manager_ids: [249, 98, 358, 10] }
    },
    {
        code: 'rule_top3_fields_missing',
        name: 'Незаполненные ТОП-3 поля',
        description: 'Проверка заказов в статусе "Согласование параметров заказа" более 24 часов без заполнения полей ТОП3.',
        entity_type: 'event',
        condition_sql: "field_name = 'status' AND new_value = 'na-soglasovanii' AND occurred_at < NOW() - INTERVAL '24 hours' AND (om.full_order_context->>'ТОП3 Проходим ли по цене?' IS NULL OR om.full_order_context->>'ТОП3 Проходим по срокам?' IS NULL OR om.full_order_context->>'ТОП3 Проходим по тех. характеристикам?' IS NULL)",
        severity: 'critical',
        rule_type: 'sql',
        is_active: true,
        parameters: { manager_ids: [249, 98, 358, 10] }
    }
];

async function resetRules() {
    console.log('--- Resetting OKK Rules ---');

    // 1. Delete all existing violations (they refer to old rules)
    console.log('Clearing old violations...');
    const { error: violError } = await supabase.from('okk_violations').delete().neq('id', -1);
    if (violError) {
        console.error('Error deleting violations:', violError);
        return;
    }

    // 2. Delete all existing rules
    const { error: delError } = await supabase.from('okk_rules').delete().neq('code', 'VOID');
    if (delError) {
        console.error('Error deleting rules:', delError);
        return;
    }
    console.log('Old rules deleted.');

    // 2. Insert new rules
    const { error: insError } = await supabase.from('okk_rules').insert(defaultRules);
    if (insError) {
        console.error('Error inserting rules:', insError);
        return;
    }
    console.log('New rules initialized successfully.');
}

resetRules();
