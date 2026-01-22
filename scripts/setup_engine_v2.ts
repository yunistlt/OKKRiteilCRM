
import { supabase } from '../utils/supabase';

async function setupV2() {
    console.log('--- Setting up Rule Engine v2 ---');

    // 1. We cannot easily create tables via Supabase JS client (it's for data, not DDL).
    // However, we can use RPC if available, or just check if we can insert into okk_rules first.
    // In this environment, I'll assume the user might need to run SQL manually if I can't.
    // BUT! I can try to use a trick: check if 'logic' column exists by trying to select it.

    console.log('Checking okk_rules schema...');
    const { data: colCheck, error: colError } = await supabase.from('okk_rules').select('logic').limit(1);

    if (colError && colError.message.includes('column "logic" does not exist')) {
        console.log('IMPORTANT: Please run the following SQL in Supabase SQL Editor:');
        console.log(`
            -- 1. Create Blocks Library Table
            CREATE TABLE IF NOT EXISTS okk_block_definitions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                code TEXT UNIQUE NOT NULL,
                type TEXT NOT NULL, -- trigger, condition, action
                name TEXT NOT NULL,
                description TEXT,
                ai_prompt TEXT,
                params_schema JSONB DEFAULT '{}'::jsonb,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- 2. Add logic column to okk_rules
            ALTER TABLE okk_rules ADD COLUMN IF NOT EXISTS logic JSONB;
        `);
        // I will wait for user to confirm or try to proceed if I can find a way to run SQL.
        // For now, I'll seed the blocks assuming the table exists or will be created.
    }

    const initialBlocks = [
        {
            code: 'status_change',
            type: 'trigger',
            name: 'Смена статуса',
            description: 'Срабатывает при переходе заказа в указанный статус или из него.',
            ai_prompt: 'Используй этот триггер для отслеживания смены статусов. Параметры: target_status (код статуса), direction (to/from).',
            params_schema: {
                fields: [
                    { name: 'target_status', type: 'string', description: 'Код целевого статуса' },
                    { name: 'direction', type: 'enum', options: ['to', 'from'], default: 'to' }
                ]
            }
        },
        {
            code: 'field_empty',
            type: 'condition',
            name: 'Пустое поле',
            description: 'Проверяет, что указанное поле (например, комментарий) не заполнено.',
            ai_prompt: 'Используй для проверки отсутствия комментариев или данных в полях CRM. Параметры: field_path (например, manager_comment).',
            params_schema: {
                fields: [
                    { name: 'field_path', type: 'string', description: 'Путь к полю (например, manager_comment)' }
                ]
            }
        },
        {
            code: 'time_elapsed',
            type: 'condition',
            name: 'Прошло времени',
            description: 'Проверка, что с момента события прошло более X часов.',
            ai_prompt: 'Используй для контроля задержек и застоя заказов. Параметры: hours (число).',
            params_schema: {
                fields: [
                    { name: 'hours', type: 'number', description: 'Количество часов задержки' }
                ]
            }
        },
        {
            code: 'call_exists',
            type: 'condition',
            name: 'Наличие звонка',
            description: 'Проверяет наличие успешного звонка в заданном интервале времени.',
            ai_prompt: 'Используй, чтобы проверить, звонил ли менеджер клиенту. Параметры: window_hours (интервал поиска).',
            params_schema: {
                fields: [
                    { name: 'window_hours', type: 'number', description: 'Окно поиска звонка в часах' },
                    { name: 'min_duration', type: 'number', description: 'Мин. длительность в сек' }
                ]
            }
        },
        {
            code: 'semantic_check',
            type: 'condition',
            name: 'Смысловой анализ (AI)',
            description: 'Глубокий анализ текста (комментария или транскрипта) через GPT.',
            ai_prompt: 'Используй для проверки качества текста, вежливости или наличия конкретных смыслов. Параметры: prompt (текст инструкции для ИИ).',
            params_schema: {
                fields: [
                    { name: 'prompt', type: 'string', description: 'Инструкция для анализа' }
                ]
            }
        }
    ];

    console.log('Seeding initial blocks...');
    for (const block of initialBlocks) {
        const { error } = await supabase.from('okk_block_definitions').upsert(block, { onConflict: 'code' });
        if (error) {
            console.error(`Error seeding block ${block.code}:`, error.message);
        } else {
            console.log(`Block ${block.code} seeded.`);
        }
    }

    console.log('--- Setup V2 Finished ---');
}

setupV2();
