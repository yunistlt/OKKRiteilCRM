
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

const INITIAL_RULES = [
    {
        code: 'short_call',
        name: 'Короткий звонок',
        description: 'Разговор состоялся, но был подозрительно коротким (менее 20 сек).',
        entity_type: 'call',
        severity: 'medium',
        condition_sql: "duration >= 5 AND duration < (params->>'threshold_sec')::int",
        parameters: { threshold_sec: 20 },
        is_active: true
    },
    {
        code: 'missed_incoming',
        name: 'Пропущенный входящий',
        description: 'Клиент звонил, но никто не взял трубку.',
        entity_type: 'call',
        severity: 'high',
        condition_sql: "flow = 'incoming' AND duration = 0",
        parameters: {},
        is_active: true
    },
    {
        code: 'answering_machine_dialog',
        name: 'Разговор с автоответчиком',
        description: 'Менеджер слушал автоответчик более 15 секунд (имитация работы).',
        entity_type: 'call',
        severity: 'high',
        condition_sql: "is_answering_machine = true AND duration > (params->>'threshold_sec')::int",
        parameters: { threshold_sec: 15 },
        is_active: true
    },
    {
        code: 'call_impersonation',
        name: 'Имитация звонка',
        description: 'Сброс звонка сразу после ответа (менее 5 сек).',
        entity_type: 'call',
        severity: 'high',
        condition_sql: "duration > 0 AND duration < (params->>'threshold_sec')::int AND is_answering_machine IS DISTINCT FROM true",
        parameters: { threshold_sec: 5 },
        is_active: true
    }
];

async function seedRules() {
    console.log('Seeding Rules into okk_rules...');

    for (const rule of INITIAL_RULES) {
        const { error } = await supabase
            .from('okk_rules')
            .upsert(rule, { onConflict: 'code' });

        if (error) {
            console.error(`Error seeding ${rule.code}:`, error.message);
        } else {
            console.log(`✅ Rule synced: ${rule.name}`);
        }
    }
}

seedRules();
