// Сквозное доказательство: бот отвечает С ОПОРОЙ на знания из dialog_knowledge.
// Транспорт — postgres (как seed/verify), RPC и промпт — те же, что в lib/sales-bot.
import postgres from 'postgres';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 2 });
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const RESPONDER_SYS = 'Ты — менеджер по продажам завода металлоконструкций (ЗМК). Общаешься с клиентом вежливо, по-деловому, кратко. Опирайся на приёмы из похожих успешных разговоров и на факты заказа, если они даны. НЕ выдумывай цены, сроки, характеристики, наличие — если точных данных нет, скажи, что уточнишь, и задай уточняющий вопрос. НЕ обсуждай возвраты денег, претензии, брак, суды — это ведёт юрист. Цель — вести клиента к покупке.';

async function answer(message) {
    const emb = (await openai.embeddings.create({ model: 'text-embedding-3-small', input: message })).data[0].embedding;
    const hits = await sql`SELECT domain, type, situation, response, round(similarity::numeric,3) sim
        FROM match_dialog_knowledge(${'[' + emb.join(',') + ']'}::vector, 0.42, 5, true, null)`;
    const kctx = hits.length
        ? hits.map((h, i) => `${i + 1}. [${h.domain}/${h.type ?? ''}] Клиент: ${h.situation}\nМенеджер: ${h.response}`).join('\n\n')
        : 'Похожих ситуаций в базе не нашлось.';
    const user = `Сообщение клиента: ${message}\n\nПохожие успешные разговоры:\n${kctx}\n\nКонтекст заказа клиента:\nЗаказ не определён.\n\nИстория диалога:\nНачало диалога.`;
    const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 320,
        messages: [{ role: 'system', content: RESPONDER_SYS }, { role: 'user', content: user }],
    });
    return { reply: c.choices[0].message.content.trim(), hits };
}

try {
    for (const m of ['Какой срок изготовления сушильных шкафов?', 'Доставите до Москвы и сколько это будет стоить?']) {
        const { reply, hits } = await answer(m);
        console.log('\n' + '═'.repeat(72));
        console.log('Клиент:', m);
        console.log('🟢 Бот:', reply);
        console.log('  опирался на', hits.length, 'приёмов:');
        hits.slice(0, 3).forEach(h => console.log(`    · [${h.domain} ${h.sim}] ${h.situation.slice(0, 50)} → ${h.response.slice(0, 55)}`));
    }
} catch (e) { console.error(e.message); } finally { await sql.end(); }
