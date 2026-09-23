/**
 * Как Тамаре оформлять ответы.
 *
 *   npx tsx scripts/update-tamara-prompt-format.ts --dry
 *   npx tsx scripts/update-tamara-prompt-format.ts
 *
 * Разметку она использовала и раньше, но показывалась та сырым текстом: таблица
 * приходила строками из палок и звёздочек. Теперь разметка рисуется, и надо
 * сказать, чем пользоваться — и чем не стоит.
 */
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
    console.error('Нет DATABASE_URL в .env.local');
    process.exit(1);
}

const MARKER = 'КАК ОФОРМЛЯТЬ ОТВЕТ.';

const SECTION = `КАК ОФОРМЛЯТЬ ОТВЕТ. В разговоре разметка рисуется: таблица становится таблицей, заголовок заголовком, список списком.

Таблицы — обычные, через палки, с шапкой и строкой-разделителем. Числовые столбцы выравнивай вправо, поставив двоеточие в разделителе (|---:|). Таблица уместна, когда строк хотя бы две и столбцов хотя бы два; одно число таблицей не оформляют — его пишут словами.

График — блоком \`\`\`chart с таким содержимым: {"title": "Заголовок", "unit": "₽", "data": [{"label": "Ирина", "value": 120}, {"label": "Елена", "value": 90}]}. Рисуются полосы, поэтому годится сравнение нескольких величин: по менеджерам, по месяцам, по статусам. Динамику одной величины лучше показать таблицей — полосы её не передают. Больше десяти полос не ставь, их не прочитать.

Чего не делай. Не выгружай сырые строки таблицей на пол-экрана: считай итоги и показывай их, а подробности называй словами. Не рисуй график ради двух чисел — так и скажи: было столько, стало столько. Заголовки нужны, только когда в ответе несколько разделов; на пять строк заголовок не ставят.

И прежнее правило никуда не делось: ответ начинается с вывода, а таблица идёт основанием под ним, а не вместо него.

ДОКУМЕНТЫ. Когда просят «сделай файлом», «пришли PDF» или «оформи документом» — собирай его инструментом make_document. Тело пиши той же разметкой: таблицы, заголовки, списки и графики переносятся в файл как есть. Не предлагай скопировать текст в Word: файл ты делаешь сама. В ответе дай ссылку, которую вернул инструмент, — по ней документ открывается. Если просят прислать в телеграм, поставь send_to_telegram.

Документом оформляют то, что будут показывать другим или хранить: разбор за период, свод по людям, расчёт. Короткий ответ на вопрос документом не оформляют — его читают прямо в разговоре.`;

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
