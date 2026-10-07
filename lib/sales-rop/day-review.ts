import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import { runDayChecks, renderChecks, type DayChecks } from '@/lib/sales-rop/day-checks';

// ============================================================================
// Разбор вчерашнего дня менеджера: документ, который он читает до начала работы.
//
// Числа считает код, разговоры разбирает модель. Модель не считает ничего —
// ей достаётся вопрос «что происходило в разговоре», а не «сколько».
//
// Откуда что берём (проверено 07.10.2026, см. docs/read-gate/OVERVIEW.md):
// время, длительность и КТО ГОВОРИЛ — из Телфина; номер заказа — из RetailCRM.
// В retailcrm_calls время сдвинуто на час, а manager_rc_id это владелец
// заказа, а не говоривший: по нему в день менеджера попадают чужие разговоры.
// ============================================================================

/** Добавочный Телфина по менеджеру — кто на самом деле говорил. */
async function extensionByManager(managerId: number): Promise<string | null> {
    const { data } = await supabase
        .from('managers')
        .select('telphin_extension')
        .eq('id', managerId)
        .maybeSingle();
    const v = (data as any)?.telphin_extension;
    return v ? String(v).trim() : null;
}

const mskTime = (d: any) => new Date(new Date(d).getTime() + 3 * 3600e3).toISOString().slice(11, 16);

export type DayFacts = {
    talks: number;
    minutes: number;
    firstTalk: string | null;
    beforeLunch: number;
    withTranscript: number;
    inboundNoOrder: number;
};

/** Разговоры менеджера за день: сутки считаем по московскому календарю. */
async function loadDay(managerId: number, date: string) {
    const ext = await extensionByManager(managerId);
    if (!ext) return { ext: null, calls: [] as any[] };

    const from = new Date(`${date}T00:00:00+03:00`).toISOString();
    const to = new Date(`${date}T23:59:59+03:00`).toISOString();

    const { data } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, direction, duration_sec, transcript, record_uuids, raw_payload')
        .gte('started_at', from)
        .lte('started_at', to)
        .gte('duration_sec', 30);

    const mine = ((data ?? []) as any[]).filter((r) => {
        if (r.raw_payload?.result !== 'bridged') return false;
        const who = r.direction === 'outgoing' ? r.raw_payload?.from_username : r.raw_payload?.bridged_username;
        return String(who ?? '').endsWith(`*${ext}`);
    }).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));

    return { ext, calls: mine };
}

/**
 * Номер заказа по записи разговора — единственное, что берём из RetailCRM.
 *
 * Выбираем звонки ЗА ОКНО СУТОК, а не всю таблицу: без фильтра PostgREST
 * отдаёт первую тысячу строк, и совпадений не находится вовсе — в первом
 * прогоне заказы в разбор не попали именно поэтому. Окно берём с запасом в
 * сутки: время в retailcrm_calls сдвинуто, и у границы дня звонок уезжает.
 */
async function orderNumbersByCall(calls: any[], date: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!calls.length) return out;

    const from = new Date(`${date}T00:00:00+03:00`).getTime();
    const { data } = await supabase
        .from('retailcrm_calls')
        .select('record_uuid, order_number')
        .gte('call_date', new Date(from - 24 * 3600e3).toISOString())
        .lte('call_date', new Date(from + 48 * 3600e3).toISOString())
        .not('order_number', 'is', null);

    const byUuid = new Map<string, string>();
    for (const row of ((data ?? []) as any[])) {
        const rc = String(row.record_uuid ?? '').toLowerCase();
        if (rc) byUuid.set(rc, String(row.order_number));
    }

    for (const c of calls) {
        const uuids: string[] = Array.isArray(c.record_uuids) ? c.record_uuids : [];
        for (const u of uuids) {
            const low = String(u).toLowerCase();
            const hit = Array.from(byUuid.keys()).find((rc) => low.includes(rc));
            if (hit) { out.set(String(c.started_at), byUuid.get(hit)!); break; }
            if (out.has(String(c.started_at))) break;
        }
    }
    return out;
}

export function buildFacts(calls: any[], orderOf: Map<string, string>): DayFacts {
    const withT = calls.filter((c) => c.transcript && String(c.transcript).trim());
    return {
        talks: calls.length,
        minutes: Math.round(calls.reduce((s, c) => s + (c.duration_sec || 0), 0) / 60),
        firstTalk: calls.length ? mskTime(calls[0].started_at) : null,
        beforeLunch: calls.filter((c) => Number(mskTime(c.started_at).slice(0, 2)) < 13).length,
        withTranscript: withT.length,
        inboundNoOrder: calls.filter((c) => c.direction !== 'outgoing' && !orderOf.get(String(c.started_at))).length,
    };
}

/**
 * Что про клиента уже известно.
 *
 * Требование владельца 07.10.2026: не требовать вопросов, ответ на которые уже
 * есть. Постоянного клиента не спрашивают, чем он занимается — это раздражает
 * человека и выставляет менеджера тем, кто не читал историю. Поэтому модели
 * подаём, что в карточке уже заполнено и сколько у клиента покупок.
 */
async function knownAboutOrders(orderNumbers: string[]) {
    if (!orderNumbers.length) return new Map<string, any>();

    const { data: orders } = await supabase
        .from('orders')
        .select('number, totalsumm, status, customer_name, client_id, raw_payload')
        .in('number', orderNumbers);

    const { data: statuses } = await supabase
        .from('crm_statuses')
        .select('external_code, name')
        .not('external_code', 'is', null);
    const statusName = new Map(((statuses ?? []) as any[]).map((s) => [s.external_code, s.name]));

    const out = new Map<string, any>();
    for (const o of ((orders ?? []) as any[])) {
        const cf = o.raw_payload?.customFields ?? {};
        const clientId = o.client_id ?? (o.raw_payload?.customer?.id ?? null);
        let deals = 0;
        if (clientId) {
            const { count } = await supabase
                .from('orders')
                .select('order_id', { count: 'exact', head: true })
                .eq('client_id', clientId)
                .in('status', ['send-assembling', 'otgruzen', 'complete', 'delivering', 'send-to-delivery']);
            deals = count ?? 0;
        }
        out.set(String(o.number), {
            номер: String(o.number),
            клиент: o.customer_name ?? null,
            сумма: Number(o.totalsumm ?? 0),
            статус: statusName.get(o.status) ?? o.status,
            покупок_у_клиента: deals,
            тип_клиента: deals >= 2 ? 'постоянный' : 'новый',
            уже_известно: {
                сфера_деятельности: cf.sfera_deiatelnosti ?? null,
                регион: o.raw_payload?.delivery?.address?.region ?? null,
                контактное_лицо: o.raw_payload?.contact?.firstName ?? null,
                инн: o.raw_payload?.contragent?.INN ?? null,
            },
        });
    }
    return out;
}

const RULES = `ПРАВИЛА РАЗБОРА
Пять блоков, в каждом максимум 2 балла, итог 0–10:
1. Контакт и цель — представилась, назвала компанию, сказала зачем звонит.
2. Выявление задачи — поняла, что нужно и к какому сроку.
3. Квалификация — тип закупки, сроки, регион, объём, роль собеседника, проходная цена.
4. Цена и возражения — назвала цену с аргументом, отработала «дорого» и «долго».
5. Следующий шаг — конкретное действие с датой, зафиксировано.

НЕ ТРЕБУЙ ТОГО, ЧТО УЖЕ ИЗВЕСТНО. Если клиент постоянный или в карточке уже
заполнены сфера деятельности, регион, контакт — вопросы об этом задавать не
нужно, и снимать за них баллы нельзя. В таком случае пункт помечается как
неприменимый: в поле na пиши причину («клиент постоянный, 4 покупки»), а балл
за блок ставь по тому, что ОСТАЛОСЬ проверить.

КАЖДОЕ ЗАМЕЧАНИЕ — РОВНО ТРИ ЧАСТИ: что было (дословная цитата), как лучше
(готовая фраза целиком, которую можно произнести), к чему приведёт (деньги,
срок или риск сделки). Без третьей части замечание не выпускать.

ЗАПРЕЩЕНО: обороты «не всегда», «иногда», «не в полной мере» и любые
обобщения без цитаты; выдуманные суммы; советы вида «проведите квалификацию»
вместо готовой фразы; перекладывание работы на клиента («уточните, пожалуйста,
детали») — предлагай решение сам и задавай один конкретный вопрос.
Обязательно отметь, что сделано хорошо: разбор без единого плюса перестают читать.

ГЛАВНОЕ ПРАВИЛО. Нельзя сказать «так делать нельзя» и на этом остановиться.
У каждого замечания обязана быть готовая фраза в поле say — слово в слово, как
менеджер произнесёт её клиенту. Не «уточните детали доставки» (это перекладывает
работу на клиента), а «Руслан, отправляем в картоне и гофроплёнке, доставка
транспортной компанией за наш счёт до терминала в вашем городе. Какой терминал
вам удобнее?» — сначала решение, потом один конкретный вопрос.
Замечание без такой фразы бесполезно, человек не узнает, что ему делать.

НЕ ПИШИ ЧИСЛА И СУММЫ. Их уже посчитал и показал код, а ты портишь формат
(«8,025,804.59 рублей»). Ссылайся на заказ по номеру: «по заказу 54566».`;

/** Разбор дня в разметке статей справки — её рисует шлюз чтения. */
export function renderReview(
    data: any,
    facts: DayFacts,
    managerName: string,
    date: string,
    known?: Map<string, any>,
    checks?: DayChecks,
): string {
    const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
    const parts: string[] = [];

    parts.push(`== Коротко`);
    parts.push(`- Балл дня: ${data.score} из 10`);
    parts.push(`- ${facts.talks} разговоров, ${facts.minutes} минут в трубке`);
    if (facts.firstTalk) parts.push(`- Первый разговор в ${facts.firstTalk}`);
    if (facts.inboundNoOrder) parts.push(`- Входящих без заведённой заявки: ${facts.inboundNoOrder}`);
    if (facts.withTranscript < facts.talks) {
        parts.push(`- Не разобрано: нет расшифровки у ${facts.talks - facts.withTranscript} разговоров`);
    }

    const checkLines = checks ? renderChecks(checks) : [];
    if (checkLines.length) {
        parts.push(`## Проверено системой`);
        parts.push(...checkLines);
    }

    parts.push(`## Главное за день`);
    parts.push(String(data.summary ?? ''));

    if (Array.isArray(data.blocks) && data.blocks.length) {
        parts.push(`## Из чего сложился балл`);
        for (const b of data.blocks) {
            parts.push(b.na
                ? `- **${b.name}** — не оценивался: ${b.na}`
                : `- **${b.name}** — ${b.score} из ${b.max}. ${b.why ?? ''}`);
        }
    }

    for (const o of (Array.isArray(data.orders) ? data.orders : [])) {
        /**
         * Шапку заказа берём из нашей базы, а не из ответа модели.
         *
         * В первом же прогоне модель написала «заказ №54.665, УСМ
         * Екатеринбург, статус в процессе», тогда как это 54665, УБРиР,
         * «Передано в производство». Клиент и сумма — факты, их код знает
         * точно; модели оставляем только разбор разговора.
         */
        const num = String(o.number ?? '').replace(/\D/g, '');
        const fact = known?.get(num);
        const client = fact?.клиент ?? null;
        const amount = fact?.сумма ?? null;
        const status = fact?.статус ?? null;
        parts.push(`## Заказ №${num}${client ? ` — ${client}` : ''}${amount ? ` — ${rub(amount)}` : ''}`);
        if (status) parts.push(`Статус: ${status}`);
        for (const g of (o.good ?? [])) parts.push(`- Хорошо: ${g}`);
        for (const b of (o.bad ?? [])) parts.push(`- Стоило денег: ${b}`);
        if (o.quote) parts.push(`?? Из разговора: «${o.quote}»`);
        if (o.consequence) parts.push(`!! К чему приведёт: ${o.consequence}`);
        (o.todo ?? []).forEach((t: string, i: number) => parts.push(`${i + 1}. ${t}`));
        if (o.say) parts.push(`?? Что сказать: «${o.say}»`);
    }

    if (Array.isArray(data.lost_leads) && data.lost_leads.length) {
        parts.push(`## Звонили, а заявки нет`);
        for (const l of data.lost_leads) {
            parts.push(`### ${l.time}`);
            if (l.quote) parts.push(`?? Из разговора: «${l.quote}»`);
            for (const m of (l.missed ?? [])) parts.push(`- Не прозвучало: ${m}`);
            if (l.say) parts.push(`?? Что сказать при перезвоне: «${l.say}»`);
        }
    }

    if (Array.isArray(data.today) && data.today.length) {
        parts.push(`## Три задачи на сегодня`);
        data.today.forEach((t: string, i: number) => parts.push(`${i + 1}. ${t}`));
    }

    parts.push(`## Откуда цифры`);
    parts.push(`Время и длительность — из телефонии, номера заказов — из CRM. Разбор за ${date}, ${managerName}. Если считаете замечание несправедливым — скажите руководителю, разберём по записи.`);

    // Разметка статей требует пустую строку между блоками, иначе плашки не
    // рисуются и документ выглядит простынёй (golds/GOLD_HELP_ARTICLES.md).
    return parts.join('\n\n');
}

export type ReviewResult = { ok: boolean; reason?: string; score?: number; body?: string };

/**
 * Замечание без готовой фразы — брак.
 *
 * Требование владельца 07.10.2026: «мы обязательно должны говорить менеджеру,
 * как правильно сказать, а не только что так нельзя». Поэтому сначала просим
 * модель дописать недостающие фразы, а если и со второго раза их нет — такое
 * замечание из разбора убираем. Голая критика хуже молчания: человек уходит
 * виноватым и без инструкции.
 */
async function fillMissingPhrases(data: any, client: any): Promise<{ data: any; dropped: number }> {
    const holes: Array<{ kind: 'order' | 'lead'; key: string; bad: string[] }> = [];
    for (const o of (Array.isArray(data.orders) ? data.orders : [])) {
        if (!String(o.say ?? '').trim() && (o.bad ?? []).length) {
            holes.push({ kind: 'order', key: String(o.number ?? ''), bad: o.bad });
        }
    }
    for (const l of (Array.isArray(data.lost_leads) ? data.lost_leads : [])) {
        if (!String(l.say ?? '').trim()) {
            holes.push({ kind: 'lead', key: String(l.time ?? ''), bad: l.missed ?? [] });
        }
    }
    if (!holes.length) return { data, dropped: 0 };

    try {
        const res = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: [{
                role: 'user',
                content: `Для каждого замечания напиши готовую фразу, которую менеджер произнесёт клиенту слово в слово. Сначала решение от себя, потом ОДИН конкретный вопрос. Не перекладывай работу на клиента («уточните детали» запрещено). Верни JSON {"phrases":[{"key":"","say":""}]}.\n\n${JSON.stringify(holes)}`,
            }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
        });
        const got = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        const byKey = new Map<string, string>(
            (got.phrases ?? []).map((p: any) => [String(p.key), String(p.say ?? '')]),
        );
        for (const o of (data.orders ?? [])) {
            if (!String(o.say ?? '').trim()) o.say = byKey.get(String(o.number ?? '')) ?? '';
        }
        for (const l of (data.lost_leads ?? [])) {
            if (!String(l.say ?? '').trim()) l.say = byKey.get(String(l.time ?? '')) ?? '';
        }
    } catch {
        // Не дописалось — ниже такие замечания просто не попадут в разбор.
    }

    let dropped = 0;
    for (const o of (data.orders ?? [])) {
        if (!String(o.say ?? '').trim() && (o.bad ?? []).length) { dropped += o.bad.length; o.bad = []; o.consequence = null; }
    }
    data.lost_leads = (data.lost_leads ?? []).filter((l: any) => {
        if (String(l.say ?? '').trim()) return true;
        dropped += 1;
        return false;
    });
    return { data, dropped };
}

export async function buildDayReview(managerId: number, managerName: string, date: string): Promise<ReviewResult> {
    if (!isOpenAIConfigured()) return { ok: false, reason: 'Модель не настроена' };

    const { ext, calls } = await loadDay(managerId, date);
    if (!ext) return { ok: false, reason: 'У менеджера не указан добавочный телефонии' };
    if (!calls.length) return { ok: false, reason: 'Разговоров за день нет' };

    const orderOf = await orderNumbersByCall(calls, date);
    const facts = buildFacts(calls, orderOf);

    const withT = calls.filter((c) => c.transcript && String(c.transcript).trim());
    if (!withT.length) return { ok: false, reason: 'Ни одного расшифрованного разговора' };

    const orderNumbers = Array.from(new Set(Array.from(orderOf.values())));
    const known = await knownAboutOrders(orderNumbers);

    const dialogs = withT.map((c) => {
        const num = orderOf.get(String(c.started_at)) ?? null;
        return {
            время: mskTime(c.started_at),
            тип: c.direction === 'outgoing' ? 'исходящий' : 'входящий',
            секунд: c.duration_sec,
            заказ: num,
            про_клиента: num ? known.get(num) ?? null : null,
            расшифровка: String(c.transcript).slice(0, 4000),
        };
    });

    const checks = await runDayChecks(managerId, date, calls, orderNumbers);

    const prompt = `Ты — руководитель отдела продаж завода металлоконструкций. Разбираешь вчерашний день менеджера по расшифровкам разговоров. Обращение на «вы», по-русски, без жаргона.

${RULES}

ФАКТЫ ДНЯ (посчитаны кодом, не меняй их): ${JSON.stringify(facts)}

ПРОВЕРКИ СИСТЕМЫ (это уже установленные факты, проверять их не надо — объясни,
чем они грозят, и дай фразу): ${JSON.stringify(checks)}

Про дату следующего контакта: то, что она стоит в карточке, НЕ значит, что она
прозвучала в разговоре. Балл за «следующий шаг» ставь по тому, услышал ли
клиент конкретную договорённость вслух.

РАЗГОВОРЫ (разбери каждый, где есть что сказать): ${JSON.stringify(dialogs)}

Верни СТРОГО JSON:
{"score": число 0-10, "summary": "2-3 предложения: главный вывод и главная потеря с суммой",
 "blocks": [{"name":"","score":число,"max":2,"why":"с цитатой","na":"причина, если пункт неприменим"}],
 "orders": [{"number":"","amount":число|null,"client":"","status":"","good":[],"bad":[],"quote":"","consequence":"","todo":[],"say":""}],
 "lost_leads": [{"time":"","quote":"","missed":[],"say":""}],
 "today": ["3 задачи на сегодня"]}`;

    const client = getOpenAIClient();
    const res = await client!.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
    });

    // Расход на модель виден в общем учёте, а не только в счёте OpenAI.
    await recordAiUsage({
        agentId: AiAgent.SALES_ANALYST,
        model: 'gpt-4o',
        usage: res.usage,
        purpose: `разбор дня ${date}, менеджер ${managerId}`,
    }).catch(() => null);

    let data: any;
    try {
        data = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    } catch {
        return { ok: false, reason: 'Модель вернула не JSON' };
    }

    const filled = await fillMissingPhrases(data, client);
    const body = renderReview(filled.data, facts, managerName, date, known, checks);
    const { error } = await supabase
        .from('sales_rop_day_review')
        .upsert({
            manager_id: managerId,
            review_date: date,
            title: 'Разбор вчерашнего дня',
            body,
        }, { onConflict: 'manager_id,review_date' });
    if (error) return { ok: false, reason: error.message };

    return { ok: true, score: data.score, body };
}
