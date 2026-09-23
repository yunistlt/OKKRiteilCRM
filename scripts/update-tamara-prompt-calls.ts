/**
 * Дописывает в промпт разговора Тамары предупреждения про звонки и письма.
 *
 *   npx tsx scripts/update-tamara-prompt-calls.ts --dry
 *   npx tsx scripts/update-tamara-prompt-calls.ts
 *
 * Эти таблицы открыли ей, чтобы отвечать на «а звонок вообще был». Но на них
 * легко ошибиться уверенно: роли в расшифровке путаются, один разговор даёт
 * несколько строк, привязка к заказу врёт в трети случаев. Уверенная ошибка
 * здесь дороже отсутствия ответа — по этим словам владелец разговаривает с
 * людьми.
 *
 * Дописывает в конец и ничего не делает, если секция уже там: промпт правят
 * руками в админке.
 */
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
    console.error('Нет DATABASE_URL в .env.local');
    process.exit(1);
}

const MARKER = 'ЗВОНКИ И ПИСЬМА.';

const SECTION = `ЗВОНКИ И ПИСЬМА. Запись в карточке заказа — это то, что менеджер написал о себе сам. Независимое подтверждение работы есть только в звонках и письмах: raw_telphin_calls (кто кому звонил, когда, сколько длился, запись и расшифровка в колонке transcript), call_order_matches (привязка звонка к заказу), incoming_emails (входящие письма с текстом). Когда спрашивают «связывался ли», «был ли звонок», «на основании чего это записано» — иди туда, а не отвечай, что данных нет.

На этих данных легко ошибиться уверенно, поэтому:
— Расшифровка есть не у каждого звонка, смотри transcription_status. «Расшифровки нет» значит «содержание неизвестно», а не «разговора не было».
— Роли в расшифровке размечены ненадёжно: кто менеджер, а кто клиент, путается. Говори «в разговоре прозвучало», а не «менеджер сказал».
— Один разговор даёт несколько строк: звонок через очередь звонит нескольким сразу, каждая попытка — своя строка. Считая звонки, схлопывай по номеру и времени в пределах двух минут, иначе насчитаешь втрое больше.
— Кто говорил — не обязательно чей заказ. Называй обоих: кто разговаривал и за кем заказ.
— Привязка звонка к заказу ошибается примерно в трети случаев. Если вывод держится на ней — скажи это и сверь по номеру телефона клиента.
— Не нашла подтверждения — говори «независимого подтверждения не нашла», а не «работы не было»: менеджер мог позвонить с мобильного, а клиент написать на личную почту. Разница между этими двумя фразами — разговор с человеком о его работе.`;

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
            console.log('\n--- что добавится ---\n');
            console.log(SECTION);
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
