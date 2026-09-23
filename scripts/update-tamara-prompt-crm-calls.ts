/**
 * Говорим Тамаре, откуда брать звонки.
 *
 *   npx tsx scripts/update-tamara-prompt-crm-calls.ts --dry
 *   npx tsx scripts/update-tamara-prompt-crm-calls.ts
 *
 * Ей открыта вся база, и в ней два источника привязки звонка к заказу. Один —
 * от самой CRM, другой — наша догадка по номеру телефона. Не сказать об этом
 * значит получить уверенные выводы по выдуманным данным: на 22.09 наш матчинг
 * «нашёл» 79 заказов со звонком там, где CRM знает 56.
 */
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
    console.error('Нет DATABASE_URL в .env.local');
    process.exit(1);
}

const MARKER = 'ОТКУДА БЕРУТСЯ ЗВОНКИ.';

const SECTION = `ОТКУДА БЕРУТСЯ ЗВОНКИ. Привязку звонка к заказу знает сама RetailCRM: таблица retailcrm_calls, поля order_number, manager_rc_id, call_date, record_uuid. Это источник правды, и считать звонки по заказам надо по ней.

Таблица call_order_matches — наш собственный матчинг по номеру телефона, костыль на случай, когда в выгрузке CRM по заказу ничего нет. Он ошибается примерно в трети случаев: на 22 сентября он «нашёл» звонки по 79 заказам там, где CRM знает про 56, и разница — это выдуманные совпадения. Если считаешь по нему, говори об этом вслух и не выдавай результат за точный.

Ещё одна ловушка того же матчинга: в нём есть поле matched_at — это когда наша система сопоставила звонок с заказом, а не когда разговаривали. Дата разговора живёт в raw_telphin_calls.started_at и в retailcrm_calls.call_date. За тридцать дней у 1499 из 2365 сопоставлений эти даты расходились, средний отрыв — 99 часов. Считать активность по matched_at значит приписывать звонки чужим дням.`;

async function main() {
    const dry = process.argv.includes('--dry');
    const sql = postgres(DATABASE_URL!, { ssl: 'require' });
    try {
        const rows = await sql<{ system_prompt: string }[]>`
            SELECT system_prompt FROM ai_prompts WHERE key = 'shtab_tamara_chat' AND is_active = true
        `;
        if (rows.length === 0) throw new Error('Промпта shtab_tamara_chat нет или он выключен');
        const current = rows[0].system_prompt;
        if (current.includes(MARKER)) {
            console.log('Секция уже в промпте — ничего не меняю.');
            return;
        }
        const next = `${current.trimEnd()}\n\n${SECTION}`;
        console.log(`Было ${current.length} символов, станет ${next.length}.`);
        if (dry) {
            console.log('\n' + SECTION);
            return;
        }
        await sql`UPDATE ai_prompts SET system_prompt = ${next} WHERE key = 'shtab_tamara_chat'`;
        console.log('Промпт обновлён.');
    } finally {
        await sql.end();
    }
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
