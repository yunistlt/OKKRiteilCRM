/**
 * Наполнение РАГ-базы бота-продажника (dialog_knowledge) из транскрибаций звонков.
 *
 * Корпус: заказы, дошедшие до продажи (closing_status) за последние N месяцев (по умолч. 6),
 * и их транскрибированные звонки. Это целевой сигнал «как доводим до продажи».
 *
 * Пайплайн на каждый звонок:
 *   1) LLM-экстрактор: домен разговора + переопределение ролей по смыслу + извлечение юнитов.
 *   2) Карантин на уровне ЗВОНКА: если домен звонка спорный (рекламация/возврат/суд) —
 *      bot_can_answer=false для ВСЕХ его юнитов (бот не отвечает по спорам, передаёт юристу).
 *   3) Семантический дедуп: юнит с cosine>DEDUP к уже принятому (того же домена) отбрасывается.
 *   4) Эмбеддинг situation (по нему ищет бот) + upsert в dialog_knowledge.
 *
 * Использование:
 *   tsx scripts/seed_dialog_knowledge.ts            # полный прогон, окно 6 мес
 *   tsx scripts/seed_dialog_knowledge.ts --months 6 --limit 50   # ограничить число звонков
 */
import postgres from 'postgres';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { generateEmbedding } from '../lib/embeddings';

dotenv.config({ path: '.env.local' });

const MONTHS = Number(argVal('--months') ?? 6);
const LIMIT = argVal('--limit') ? Number(argVal('--limit')) : null;
const CONCURRENCY = 6;
const DEDUP = 0.92; // cosine выше — считаем тем же знанием

const BOT_DOMAINS = new Set(['продажа', 'товар', 'логистика_сроки']);
const DISPUTE_DOMAINS = new Set(['рекламация', 'возврат', 'суд_претензия']);
const VALID_DOMAINS = new Set([...BOT_DOMAINS, ...DISPUTE_DOMAINS, 'прочее']);

// LLM иногда кладёт type в domain — валидируем по списку из 7, иначе берём домен звонка.
function normalizeDomain(unitDomain: string | undefined, callDomain: string): string {
    if (unitDomain && VALID_DOMAINS.has(unitDomain)) return unitDomain;
    if (VALID_DOMAINS.has(callDomain)) return callDomain;
    return 'прочее';
}

function argVal(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const EXTRACTOR_PROMPT = `Ты — методист отдела продаж завода металлоконструкций (ЗМК). Анализируешь расшифровку телефонного разговора и извлекаешь переносимые знания для базы.

ВАЖНО ПРО РОЛИ: метки "Менеджер:"/"Клиент:" в тексте часто НЕВЕРНЫ — определяй роли сам по смыслу.
- МЕНЕДЖЕР — представляется от компании ("Компания ЗМК", "ЗМК, добрый день"), отвечает про товар/заказ/цену, ведёт сделку.
- КЛИЕНТ — звонящий с запросом/проблемой.
- Если кто есть кто неясно — role_confidence:"low" (units оставь пустым).

ДОМЕН разговора (primary_domain) — один из:
- "продажа" — выбор/обсуждение покупки, возражения, цена, закрытие сделки.
- "товар" — характеристики/ассортимент/что производим/что перепродаём.
- "логистика_сроки" — сроки изготовления, доставка, отгрузка.
- "рекламация" — жалоба на качество/брак/недокомплект полученного.
- "возврат" — требование вернуть деньги, отказ от заказа с деньгами.
- "суд_претензия" — упоминание суда, юриста, официальной претензии, неустойки.
- "прочее" — маршрутизация ("соедините с…"), спам, пустое.

При любом признаке спора (суд, претензия, юрист, неустойка, «верните деньги», брак) ставь спорный домен, даже если разговор начинался про товар.

ИЗВЛЕЧЕНИЕ units — массив переносимых единиц знания. ЖЁСТКО: бери юнит ТОЛЬКО если ответ менеджера несёт ПЕРЕНОСИМУЮ ценность — конкретный факт о товаре/сроке/цене, отработку возражения, аргумент, приём закрытия, ИЛИ (для спорных доменов) явный сигнал ситуации.
НЕ бери: "Да"/"Нет"/"Здравствуйте"/"секунду", статусную болтовню про один заказ ("отправила на рассмотрение", "запрошу логистов"), всё что не пригодится в ДРУГОМ разговоре. Если переносимого нет — units:[]. Лучше 0 юнитов, чем мусор.
Каждый unit:
- domain: один из доменов выше.
- type: краткий тип ("возражение_цена","характеристика_товара","ассортимент","срок_изготовления","доставка","гарантия","сигнал_рекламации","сигнал_возврата","сигнал_суд","приём_закрытия").
- customer_utterance: суть реплики клиента, чисто перефразируй как реальную фразу (по ней векторный поиск).
- manager_response: что полезного сказал менеджер.
- comment: чем ценно (1 фраза).

Ответь СТРОГО JSON: {"primary_domain":"...","roles_swapped":bool,"role_confidence":"high"|"low","units":[...]}`;

type Unit = { domain: string; type?: string; customer_utterance: string; manager_response: string; comment?: string };
type Extraction = { primary_domain: string; roles_swapped?: boolean; role_confidence: string; units?: Unit[] };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extract(transcript: string, eventId: number): Promise<Extraction> {
    const r = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: EXTRACTOR_PROMPT },
            { role: 'user', content: `Звонок ${eventId}:\n\n${transcript}` },
        ],
    });
    return JSON.parse(r.choices[0].message.content || '{}');
}

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot; // эмбеддинги OpenAI уже L2-нормализованы
}

async function main() {
    const sql = postgres(process.env.DATABASE_URL || process.env.POSTGRES_URL!, { ssl: 'require', max: 4 });
    try {
        const cfg = await sql`SELECT DISTINCT ON (key) key, value FROM salary_config WHERE effective_from<=now() ORDER BY key, effective_from DESC`;
        const closing = (Object.fromEntries(cfg.map((r: any) => [r.key, r.value])) as any).closing_status.code as string;
        console.log(`closing_status=${closing}, окно=${MONTHS} мес\n`);

        // Выигранные заказы за окно + их транскрибированные звонки
        const calls = await sql<{ event_id: number; order_number: string; totalsumm: number | null; transcript: string }[]>`
            WITH closed AS (
              SELECT o.order_id, o.number, o.totalsumm,
                COALESCE(
                  (SELECT min(h.occurred_at) FROM order_history_log h
                     WHERE h.retailcrm_order_id=o.order_id AND h.field='status'
                       AND h.new_value LIKE ${'%"code":"' + closing + '"%'}),
                  CASE WHEN o.status=${closing} THEN NULLIF(o.raw_payload->>'statusUpdatedAt','')::timestamptz END
                ) AS closed_at
              FROM orders o
              WHERE o.status=${closing} OR EXISTS (
                SELECT 1 FROM order_history_log h WHERE h.retailcrm_order_id=o.order_id AND h.field='status'
                  AND h.new_value LIKE ${'%"code":"' + closing + '"%'})
            ),
            won AS (SELECT number, totalsumm FROM closed WHERE closed_at >= now() - (${MONTHS} || ' months')::interval)
            SELECT DISTINCT ON (rt.event_id) rt.event_id, rc.order_number, w.totalsumm, rt.transcript
            FROM won w
            JOIN retailcrm_calls rc ON rc.order_number = w.number
            JOIN raw_telphin_calls rt ON EXISTS (SELECT 1 FROM unnest(rt.record_uuids) u WHERE right(replace(u,'-',''),32)=rc.record_uuid)
            WHERE rt.transcription_status='completed' AND rt.transcript IS NOT NULL AND length(rt.transcript) > 250
            ORDER BY rt.event_id
            ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

        console.log(`Звонков к обработке: ${calls.length}\n`);

        const accepted: { domain: string; emb: number[] }[] = [];
        let totalUnits = 0, botUnits = 0, lawyerUnits = 0, dropped = 0, dedup = 0, skippedCalls = 0;
        const domainCnt: Record<string, number> = {};

        // Обработка пачками с ограниченной конкуренцией
        for (let i = 0; i < calls.length; i += CONCURRENCY) {
            const batch = calls.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(async (c) => {
                try { return { c, res: await extract(c.transcript, c.event_id) }; }
                catch (e: any) { console.log(`  call ${c.event_id}: ОШИБКА ${e.message}`); return null; }
            }));

            for (const item of results) {
                if (!item) continue;
                const { c, res } = item;
                const callDispute = DISPUTE_DOMAINS.has(res.primary_domain);
                if (res.role_confidence === 'low' || !res.units?.length) { skippedCalls++; continue; }

                let idx = 0;
                for (const u of res.units) {
                    if (!u.customer_utterance || !u.manager_response) { dropped++; continue; }
                    const domain = normalizeDomain(u.domain, res.primary_domain);
                    // Карантин на уровне звонка: спорный звонок → ничего боту
                    const botCanAnswer = BOT_DOMAINS.has(domain) && !callDispute;
                    const emb = await generateEmbedding(u.customer_utterance);
                    // Семантический дедуп в пределах домена
                    const dup = accepted.some((a) => a.domain === domain && cosine(a.emb, emb) > DEDUP);
                    if (dup) { dedup++; continue; }
                    accepted.push({ domain, emb });

                    const slug = `dialog:${c.event_id}:${idx++}`;
                    await sql`
                        INSERT INTO public.dialog_knowledge
                          (slug, domain, type, bot_can_answer, situation, response, outcome, source_call_id, source_order, tags, metadata, embedding)
                        VALUES (${slug}, ${domain}, ${u.type ?? null}, ${botCanAnswer},
                                ${u.customer_utterance}, ${u.manager_response},
                                ${`выигранная сделка, заказ ${c.order_number}${c.totalsumm ? `, сумма ${c.totalsumm}` : ''}`},
                                ${c.event_id}, ${c.order_number},
                                ${sql.array([domain, u.type ?? ''].filter(Boolean))},
                                ${sql.json({ comment: u.comment ?? null, call_domain: res.primary_domain })},
                                ${'[' + emb.join(',') + ']'})
                        ON CONFLICT (slug) DO UPDATE SET
                          domain=EXCLUDED.domain, type=EXCLUDED.type, bot_can_answer=EXCLUDED.bot_can_answer,
                          situation=EXCLUDED.situation, response=EXCLUDED.response, outcome=EXCLUDED.outcome,
                          tags=EXCLUDED.tags, metadata=EXCLUDED.metadata, embedding=EXCLUDED.embedding,
                          version=public.dialog_knowledge.version+1, updated_at=now()`;

                    totalUnits++;
                    domainCnt[domain] = (domainCnt[domain] || 0) + 1;
                    if (botCanAnswer) botUnits++; else lawyerUnits++;
                }
            }
            console.log(`  обработано ${Math.min(i + CONCURRENCY, calls.length)}/${calls.length} | юнитов: ${totalUnits} (дедуп откинул ${dedup})`);
        }

        console.log('\n' + '─'.repeat(60));
        console.log('ГОТОВО');
        console.log('  звонков:', calls.length, '| без юнитов (мусор/роли неясны):', skippedCalls);
        console.log('  юнитов записано:', totalUnits, '| дедуп откинул:', dedup, '| битых:', dropped);
        console.log('  🟢 bot_can_answer:', botUnits, '| 🔴 к юристу:', lawyerUnits);
        console.log('  по доменам:', domainCnt);
    } finally {
        await sql.end();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
