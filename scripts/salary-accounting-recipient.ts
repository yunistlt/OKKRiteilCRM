// Разовая настройка получателей расчётной ведомости ЗП.
//
//   npx tsx scripts/salary-accounting-recipient.ts list
//       — показать, кто писал боту (getUpdates): id + ник, чтобы взять chat_id.
//   npx tsx scripts/salary-accounting-recipient.ts set "Анна Марусовская" 123456789 a_marusovskaya
//       — записать получателя в salary_config (ключ accounting_recipients).
//
// Почему так: Bot API не умеет писать в личку по @username — нужен числовой
// chat_id, а он появляется только после того, как человек нажал Start у бота.
import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const TOKEN = process.env.TELEGRAM_SALARY_BOT_TOKEN
    || process.env.TELEGRAM_PAYMENTS_BOT_TOKEN
    || process.env.TELEGRAM_BOT_TOKEN;

async function list() {
    if (!TOKEN) throw new Error('Нет токена бота в .env.local');
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    const json: any = await res.json();
    if (!json.ok) throw new Error(JSON.stringify(json));
    const seen = new Map<string, string>();
    for (const u of json.result ?? []) {
        const chat = u.message?.chat || u.my_chat_member?.chat;
        if (!chat) continue;
        seen.set(String(chat.id), `${chat.type} ${[chat.first_name, chat.last_name, chat.title].filter(Boolean).join(' ')} ${chat.username ? '@' + chat.username : ''}`);
    }
    if (!seen.size) console.log('Пусто. Пусть получатель напишет боту /start и повтори.');
    for (const [id, who] of seen) console.log(`${id}\t${who}`);
}

async function set(name: string, chatId: string, username?: string) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('Нет DATABASE_URL');
    const sql = postgres(url, { ssl: 'require' });
    const [prev] = await sql`
        select value from salary_config where key = 'accounting_recipients'
        order by effective_from desc limit 1`;
    const list = Array.isArray(prev?.value) ? prev.value : [];
    const next = [...list.filter((r: any) => String(r.chat_id) !== String(chatId)), { name, chat_id: String(chatId), ...(username ? { username: username.replace(/^@/, '') } : {}) }];
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    await sql`
        insert into salary_config (key, value, effective_from, note, created_by)
        values ('accounting_recipients', ${sql.json(next)}, ${effectiveFrom}, 'получатели ведомости ЗП', 'script')
        on conflict (key, effective_from) do update set value = excluded.value, note = excluded.note`;
    console.log('Записано:', JSON.stringify(next, null, 2));
    await sql.end();
}

const [cmd, ...rest] = process.argv.slice(2);
const run = cmd === 'list' ? list() : cmd === 'set' ? set(rest[0], rest[1], rest[2]) : Promise.reject(new Error('Команды: list | set "ФИО" chat_id [ник]'));
run.catch((e) => { console.error(e.message); process.exit(1); });
