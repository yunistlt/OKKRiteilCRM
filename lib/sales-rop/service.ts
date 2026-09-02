import { supabase } from '@/utils/supabase';
import { PRESALE_STATUSES, buildPlan, purchases } from '@/lib/sales-rop/rules';
import type { PresaleOrder, Task, Thresholds } from '@/lib/sales-rop/rules';
import {
    formatCallDay,
    formatDiscipline,
    formatEvening,
    formatEveningHeader,
    formatMorning,
    formatOwnerReport,
    formatPersonalPlan,
} from '@/lib/sales-rop/format';
import type { OwnerRow } from '@/lib/sales-rop/format';
import { updateExistingOrderInCrm } from '@/lib/retailcrm/leads';
import { analyzeClient } from '@/lib/sales-rop/analyst';
import { appendRopNote } from '@/lib/sales-rop/crm-note';
import { reviewCallDay } from '@/lib/sales-rop/call-review';
import type { EveningRow } from '@/lib/sales-rop/format';

// Сборка и отправка утреннего плана и вечернего разбора.
//
// Чат и бот берутся те же, в которые уже уходят оплаты: отдел продаж живёт в
// одном чате, и заводить второй — верный способ, чтобы половину сообщений
// никто не читал.

const CRM_BASE = (process.env.NEXT_PUBLIC_RETAILCRM_URL || process.env.RETAILCRM_URL || '').replace(/\/$/, '');

export type Settings = Thresholds & {
    chatId: string;
    enabled: boolean;
    monthPlan: number;
    setCrmDate: boolean;
    /** Писать ли рекомендацию РОПа в комментарий карточки заказа. */
    writeCrmNotes: boolean;
    /** Кого звать, когда менеджер заказа уволен или без ника. */
    orphanTelegram: string;
    morningGreeting: string;
    morningFarewell: string;
    /**
     * Кому слать планы. Пусто — всем, у кого нашлись задачи, включая уволенных
     * (их заказы уходят владельцу). Список нужен, чтобы утренняя рассылка была
     * разговором с отделом продаж, а не с половиной компании.
     */
    planManagerIds: number[];
    /**
     * Статусы, по которым менеджера не дёргаем. Тендер из его рук вышел:
     * предложение отправлено, дальше решает заказчик по своим срокам.
     */
    excludedStatuses: string[];
    deliverPlansToDm: boolean;
    summaryToGroup: boolean;
    /** Разбирать ли расшифровки звонков в вечернем отчёте. */
    reviewCalls: boolean;
    /** Личный чат владельца и выключатель его отчёта. */
    ownerChatId: string;
    ownerReport: boolean;
    /** Норма разговоров в день, минут. */
    talkMinutesTarget: number;
    /** Норма состоявшихся разговоров в день, одна на всех. */
    talksTarget: number;
    devPerDay: number;
    devMinOrders: number;
    devMinDays: number;
    devMaxDays: number;
    /** Показывать ли подсказку модели в блоке развития. */
    devInsightEnabled: boolean;
    disciplineDays: number;
    disciplineWarnPct: number;
    /** Конвейер: ночная парковка заявок в пул и выдача пачками. */
    queueEnabled: boolean;
    queuePoolManagerId: number;
    queueBatchSize: number;
    /** Кому включён конвейер. Пустой список — всем из плана. */
    queueManagerIds: number[];
};

export async function loadSettings(): Promise<Settings> {
    const { data, error } = await supabase.from('sales_rop_settings').select('key, value');
    if (error) throw new Error(error.message);
    const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
    const num = (key: string, fallback: number) => {
        const v = Number(map.get(key));
        return Number.isFinite(v) ? v : fallback;
    };

    return {
        // Пустая настройка означает «шли туда же, куда оплаты», а не «молчи»:
        // отдельный чат для плана продаж пока не нужен.
        chatId: String(map.get('telegram_chat_id') || process.env.TELEGRAM_PAYMENTS_CHAT_ID || ''),
        enabled: String(map.get('enabled') ?? 'true') === 'true',
        tasksPerManager: num('tasks_per_manager', 7),
        invoiceStaleDays: num('invoice_stale_days', 2),
        dealStaleDays: num('deal_stale_days', 3),
        bigDealAmount: num('big_deal_amount', 1_000_000),
        bigDealSilenceDays: num('big_deal_silence_days', 7),
        freshOverdueDays: num('fresh_overdue_days', 30),
        dailyTarget: num('daily_target_tasks', 12),
        minAlways: num('min_always_tasks', 3),
        coldPerDay: num('cold_per_day', 2),
        monthPlan: num('month_plan', 13_000_000),
        setCrmDate: String(map.get('set_crm_contact_date') ?? 'true') === 'true',
        writeCrmNotes: String(map.get('write_crm_notes') ?? 'true') === 'true',
        orphanTelegram: String(map.get('orphan_telegram') || ''),
        morningGreeting: String(map.get('morning_greeting') || ''),
        morningFarewell: String(map.get('morning_farewell') || ''),
        deliverPlansToDm: String(map.get('deliver_plans_to_dm') ?? 'true') === 'true',
        summaryToGroup: String(map.get('summary_to_group') ?? 'true') === 'true',
        reviewCalls: String(map.get('review_calls') ?? 'true') === 'true',
        ownerChatId: String(map.get('owner_chat_id') || ''),
        ownerReport: String(map.get('owner_report') ?? 'true') === 'true',
        talkMinutesTarget: num('talk_minutes_target', 120),
        talksTarget: num('talks_target', 35),
        excludedStatuses: String(map.get('plan_excluded_statuses') || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        planManagerIds: String(map.get('plan_manager_ids') || '')
            .split(',')
            .map((x) => Number(x.trim()))
            .filter((x) => Number.isFinite(x) && x > 0),
        devPerDay: num('dev_per_day', 2),
        devMinOrders: num('dev_min_orders', 2),
        devMinDays: num('dev_min_days', 30),
        devMaxDays: num('dev_max_days', 540),
        devInsightEnabled: String(map.get('dev_insight_enabled') ?? 'false') === 'true',
        disciplineDays: num('discipline_days', 7),
        disciplineWarnPct: num('discipline_warn_pct', 80),
        queueEnabled: String(map.get('queue_enabled') ?? 'false') === 'true',
        queuePoolManagerId: num('queue_pool_manager_id', 102),
        queueBatchSize: num('queue_batch_size', 2),
        queueManagerIds: String(map.get('queue_manager_ids') || '')
            .split(',')
            .map((x) => Number(x.trim()))
            .filter((x) => Number.isFinite(x) && x > 0),
    };
}

/** Заказы, которые ещё могут стать деньгами. Мёртвые статусы сюда не попадают. */
export async function loadPresaleOrders(): Promise<
    Array<PresaleOrder & { managerName: string; telegram: string; site: string; managerActive: boolean }>
> {
    const { data, error } = await supabase.rpc('sales_rop_presale_orders');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
        orderId: Number(r.order_id),
        number: String(r.number ?? ''),
        client: r.client ?? '',
        statusCode: r.status_code,
        statusName: r.status_name ?? r.status_code,
        amount: Number(r.amount ?? 0),
        managerId: r.manager_id === null ? null : Number(r.manager_id),
        contactDate: r.contact_date,
        lastTouchAt: r.last_touch_at,
        managerName: r.manager_name || 'без менеджера',
        telegram: r.telegram_username || '',
        site: r.site || '',
        managerActive: Boolean(r.manager_active),
    }));
}

/** Личные чаты менеджеров: заполняются, когда человек сам напишет боту. */
async function loadDirectChats(): Promise<Map<number, string>> {
    const { data } = await supabase
        .from('sales_rop_manager')
        .select('manager_id, telegram_chat_id')
        .not('telegram_chat_id', 'is', null);
    return new Map(((data ?? []) as any[]).map((r) => [Number(r.manager_id), String(r.telegram_chat_id)]));
}

async function sendToChat(chatId: string, text: string): Promise<void> {
    const token = process.env.TELEGRAM_PAYMENTS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chatId) return;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }),
    });
    if (!res.ok) throw new Error(`Telegram → ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Задачи на развитие клиента: кому что ещё можно продать.
 *
 * Цель — 300 постоянных клиентов со средним чеком 3 млн в год, и достигается она
 * не потоком заявок, а базой: клиент, третий год берущий один и тот же шкаф, —
 * это недоработанный клиент, а не лояльный.
 *
 * Предлагаем только то, что в этой же сфере деятельности уже покупают другие:
 * назвать клиенту товар, которого мы не делаем, хуже, чем не позвонить.
 */
async function loadDevelopmentTasks(
    settings: Settings,
    plannedOrderIds: Set<number>,
    /** Сколько задач не хватает каждому до нормы дня. */
    shortfallByManager: Map<number | null, number>,
): Promise<Task[]> {
    const { data, error } = await supabase.rpc('sales_dev_candidates', {
        p_min_orders: settings.devMinOrders,
        p_min_days_since: settings.devMinDays,
        p_max_days_since: settings.devMaxDays,
    });
    if (error) throw new Error(error.message);

    const byManager = new Map<number | null, Task[]>();
    const rows = ((data ?? []) as any[])
        .filter((r) => Array.isArray(r.suggest_categories) && r.suggest_categories.length > 0)
        .sort((a, b) => Number(b.total_amount) - Number(a.total_amount));

    for (const r of rows) {
        const managerId = r.manager_id === null ? null : Number(r.manager_id);
        const list = byManager.get(managerId) ?? [];

        // Обычно развитие идёт малой дозой сверх плана. Но если у менеджера
        // кончились живые заказы — а такое бывает, когда его портфель это
        // тендеры, — день добирается клиентами на обзвон: пустой день хуже, чем
        // работа вдолгую.
        // Как и с остывшими: день полон — развитие подождёт до завтра.
        const room = shortfallByManager.get(managerId) ?? 0;
        if (room === 0) continue;
        const need = Math.max(settings.devPerDay, room);
        if (list.length >= need) continue;

        const orderId = Number(r.last_order_id);
        // Один заказ — одна строка в плане: если по нему уже есть срочная
        // задача, развитие подождёт до следующего дня.
        if (plannedOrderIds.has(orderId)) continue;

        const own = (r.own_categories ?? []).filter((c: string) => c !== 'Прочее' && c !== 'Доставка');
        // Второй слой: модель читает досье клиента — покупки, комментарии
        // менеджеров, расшифровки звонков — и говорит, о чём разговаривать.
        // Код к этому моменту уже решил, КОГО трогать; модель отвечает только на
        // вопрос О ЧЁМ, и её молчание плана не ломает.
        //
        // Выключено настройкой, пока модель не знает продукт: на первом прогоне
        // она советовала предложить фланцы клиенту, купившему сушильные шкафы, —
        // формально это соседняя категория, а по делу вещи из разных миров.
        // Совет, выдающий незнание товара, роняет доверие ко всему сообщению.
        const insight = settings.devInsightEnabled ? await analyzeClient(r.client_key).catch(() => null) : null;

        list.push({
            orderId,
            number: String(r.last_order_number ?? ''),
            client: r.client_name ?? '',
            statusCode: 'development',
            statusName: 'Развитие',
            amount: Number(r.total_amount ?? 0),
            managerId,
            reasonCode: 'development',
            reasonText:
                `${purchases(Number(r.orders_count))} на ${Math.round(Number(r.total_amount)).toLocaleString('ru-RU')} ₽, ` +
                `последняя ${r.days_since} дн назад. Берёт: ${own.join(', ') || 'не разобрано'}. ` +
                `В сфере «${r.sphere_name}» такие клиенты берут ещё: ${(r.suggest_categories ?? []).join(', ')}` +
                (insight
                    ? `\n   💡 ${insight.opportunity}` +
                      (insight.talkTrack ? `\n   Начать так: ${insight.talkTrack}` : '') +
                      (insight.evidence ? `\n   Основание: ${insight.evidence}` : '') +
                      (insight.caution ? `\n   Осторожно: ${insight.caution}` : '')
                    : ' — спросить, нужно ли'),
            weight: Number(r.total_amount ?? 0),
        });
        byManager.set(managerId, list);
    }

    return Array.from(byManager.values()).flat();
}

/**
 * Обзвон базы: клиенты, которые покупали и давно молчат.
 *
 * Берётся только когда день не набрался ничем другим. Это не «работа ради
 * работы»: у менеджера с сухим портфелем выбор между пустым днём и разговором с
 * бывшим клиентом — а второе иногда возвращает заказ.
 */
async function loadReactivationTasks(
    settings: Settings,
    plannedOrderIds: Set<number>,
    shortfallByManager: Map<number | null, number>,
): Promise<Task[]> {
    const need = Array.from(shortfallByManager.entries()).filter(([, n]) => n > 0);
    if (need.length === 0) return [];

    const { data, error } = await supabase.rpc('sales_dev_candidates', {
        p_min_orders: 1,
        p_min_days_since: settings.devMaxDays,
        p_max_days_since: 1200,
    });
    if (error) return [];

    const byManager = new Map<number | null, Task[]>();
    const rows = ((data ?? []) as any[]).sort((a, b) => Number(b.total_amount) - Number(a.total_amount));

    for (const r of rows) {
        const managerId = r.manager_id === null ? null : Number(r.manager_id);
        const want = shortfallByManager.get(managerId) ?? 0;
        if (want <= 0) continue;

        const list = byManager.get(managerId) ?? [];
        if (list.length >= want) continue;

        const orderId = Number(r.last_order_id);
        if (plannedOrderIds.has(orderId)) continue;

        list.push({
            orderId,
            number: String(r.last_order_number ?? ''),
            client: r.client_name ?? '',
            statusCode: 'reactivation',
            statusName: 'Обзвон базы',
            amount: Number(r.total_amount ?? 0),
            managerId,
            reasonCode: 'reactivation',
            reasonText:
                `${purchases(Number(r.orders_count))} на ${Math.round(Number(r.total_amount)).toLocaleString('ru-RU')} ₽, ` +
                `последняя ${r.days_since} дн назад. Позвонить, узнать планы`,
            weight: Number(r.total_amount ?? 0),
        });
        byManager.set(managerId, list);
    }

    return Array.from(byManager.values()).flat();
}

/**
 * Сообщить владельцу, что прогон упал.
 *
 * Сегодня утренний план не ушёл из-за ошибки в коде, и узнали мы об этом от
 * человека, который ждал сообщений. Молчащий бот неотличим от бота, у которого
 * нет работы, — поэтому о своей поломке он обязан сказать сам.
 */
export async function notifyOwnerFailure(where: string, error: string): Promise<void> {
    try {
        const settings = await loadSettings();
        const chat = settings.ownerChatId || settings.chatId;
        if (!chat) return;
        await sendToChat(
            chat,
            `⚠️ Бот-РОП: ${where} не отработал.\n\nОшибка: ${String(error).slice(0, 300)}\n\n` +
                'Планы и отчёты сегодня не ушли. Запустить вручную можно повторным вызовом крона.',
        );
    } catch {
        // Если и это не отправилось — молчим: падать на уведомлении о падении
        // было бы совсем нелепо.
    }
}

export type MorningResult = {
    date: string;
    managers: number;
    tasks: number;
    crmSet: number;
    notesWritten: number;
    notesSkipped: number;
    sent: boolean;
};

/**
 * Ставит дату следующего контакта в карточке заказа.
 *
 * Пишем через тот же orders/edit, что и остальной проект: он единственный
 * доступен ключу и, главное, требует РЕАЛЬНЫЙ site заказа — при чужом site
 * RetailCRM отвечает «Not found», и запись молча не происходит.
 *
 * Ошибка одного заказа не должна отменять рассылку: план в чате полезен и без
 * записи в CRM, а провал виден в crm_error.
 */
async function setContactDate(
    orderId: number,
    site: string,
    date: string,
    currentDate?: string | null,
): Promise<{ ok: boolean; error?: string }> {
    // Второй рубеж поверх правил отбора: дату, назначенную на будущее, не
    // перезаписываем никогда. Даже если заказ попал в план по ошибке, стереть
    // договорённость с клиентом нельзя.
    if (currentDate && currentDate.slice(0, 10) > date) {
        return { ok: false, error: 'дата контакта назначена на будущее — не трогаем' };
    }

    try {
        const res = await updateExistingOrderInCrm(orderId, { customFields: { data_kontakta: date } }, site || undefined);
        return res.success ? { ok: true } : { ok: false, error: res.errorMsg || 'RetailCRM отказал' };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

export async function runMorning(today: string, opts: { dryRun?: boolean } = {}): Promise<MorningResult & { preview: string[] }> {
    const settings = await loadSettings();

    // Профили клиентов пересчитываются раз в сутки, здесь: разбор позиций всех
    // заказов за три года занимает минуты, и делать это на каждый запрос нельзя.
    if (!opts.dryRun) {
        // Запрос Supabase — thenable, а не Promise: .catch() у него появляется
        // только после await, и цепочка «rpc(...).catch(...)» падает на ровном
        // месте. Ошибка вылезла в первый же боевой прогон.
        try {
            await supabase.rpc('sales_refresh_client_profiles');
        } catch {
            // Профили суточной давности лучше, чем сорванная рассылка.
        }
    }

    const all = await loadPresaleOrders();
    const orders = all.filter((o) => !settings.excludedStatuses.includes(o.statusCode));
    // Поток новых заявок по факту: их разбирают в тот же день, и место под них
    // резервируется раньше нашего плана.
    const { data: intakeRows } = await supabase.rpc('sales_rop_daily_intake', { p_days: 30 });
    const intake = new Map<number | null, number>(
        ((intakeRows ?? []) as any[]).map((r) => [r.manager_id === null ? null : Number(r.manager_id), Number(r.per_day)]),
    );

    const plan = buildPlan(orders, today, settings, intake);

    // Развитие добавляется после основного плана: сначала то, что горит.
    const plannedIds = new Set<number>();
    const shortfall = new Map<number | null, number>();
    for (const [managerId, tasks] of Array.from(plan.entries())) {
        for (const t of tasks) plannedIds.add(t.orderId);
        shortfall.set(
            managerId,
            Math.max(0, settings.dailyTarget - tasks.length - Math.round(intake.get(managerId) ?? 0)),
        );
    }

    for (const dev of await loadDevelopmentTasks(settings, plannedIds, shortfall)) {
        const list = plan.get(dev.managerId) ?? [];
        list.push(dev);
        plan.set(dev.managerId, list);
        plannedIds.add(dev.orderId);
        shortfall.set(dev.managerId, Math.max(0, (shortfall.get(dev.managerId) ?? 0) - 1));
    }

    // Если и развития не хватило — добираем обзвоном базы. Клиентов, которые
    // когда-то покупали и давно молчат, хватает всегда; умного повода для
    // звонка тут нет, и притворяться, что он есть, не надо: «давно не покупали»
    // это честная причина позвонить.
    for (const task of await loadReactivationTasks(settings, plannedIds, shortfall)) {
        const list = plan.get(task.managerId) ?? [];
        list.push(task);
        plan.set(task.managerId, list);
        plannedIds.add(task.orderId);
    }

    const nameById = new Map<number | null, { name: string; tg: string }>();
    for (const o of orders) {
        // Уволенный менеджер или менеджер без ника: заказы у него настоящие, а
        // адресата нет. Такой блок уходит владельцу, иначе его не делает никто.
        const orphan = !o.managerActive || !o.telegram;
        nameById.set(o.managerId, {
            name: orphan ? `${o.managerName} (менеджер неактивен)` : o.managerName,
            tg: orphan ? settings.orphanTelegram : o.telegram,
        });
    }

    const preview: string[] = [];
    const rows: any[] = [];
    const planned: Task[] = [];

    // Группируем по адресату, а не по менеджеру: заказы пятерых уволенных
    // достаются одному человеку, и пять отдельных сообщений подряд с его тегом —
    // это способ добиться, чтобы их не читали.
    const byRecipient = new Map<string, { name: string; tg: string; tasks: Task[]; managerId: number | null }>();
    for (const [managerId, tasks] of Array.from(plan.entries())) {
        if (tasks.length === 0) continue;
        if (settings.planManagerIds.length > 0 && (managerId === null || !settings.planManagerIds.includes(managerId))) {
            continue;
        }
        const who = nameById.get(managerId) ?? { name: 'без менеджера', tg: '' };
        const key = who.tg || who.name;
        const bucket = byRecipient.get(key) ?? { name: who.name, tg: who.tg, tasks: [], managerId };
        bucket.tasks.push(...tasks);
        byRecipient.set(key, bucket);
    }

    for (const bucket of Array.from(byRecipient.values())) {
        preview.push(
            formatMorning(
                { managerId: bucket.managerId, managerName: bucket.name, telegramUsername: bucket.tg, tasks: bucket.tasks },
                CRM_BASE,
                { greeting: settings.morningGreeting, farewell: settings.morningFarewell, date: new Date(today) },
            ),
        );
        for (const t of bucket.tasks) {
            rows.push(taskRow(today, t));
            planned.push(t);
        }
    }

    if (!opts.dryRun && rows.length > 0) {
        // Сохраняем ДО отправки: вечером сверяется то, что просили утром, а не
        // то, что подошло бы под правило вечером.
        const { error } = await supabase.from('sales_rop_task').upsert(rows, { onConflict: 'plan_date,order_id' });
        if (error) throw new Error(error.message);
    }

    // Дата следующего контакта в карточке заказа. План должен всплыть у
    // менеджера на его рабочем экране в RetailCRM, а не только в чате: в чат
    // заглядывают, а в CRM работают.
    let crmSet = 0;
    let notesWritten = 0;
    // Сколько раз промолчали: предыдущий совет висит нетронутым.
    let notesSkipped = 0;
    if (!opts.dryRun && settings.setCrmDate) {
        const siteById = new Map(orders.map((o) => [o.orderId, o.site]));
        const contactByOrder = new Map(orders.map((o) => [o.orderId, o.contactDate]));
        for (const t of planned) {
            // Тем, у кого контакт и так назначен на сегодня, писать нечего.
            if (t.reasonCode === 'contact_today') continue;
            const res = await setContactDate(
                t.orderId,
                siteById.get(t.orderId) || '',
                today,
                contactByOrder.get(t.orderId),
            );
            if (res.ok) crmSet += 1;

            // И сама рекомендация — в комментарий карточки. Менеджер работает в
            // заказе, а не в переписке: то, что надо сделать, должно лежать там,
            // куда он смотрит, когда открывает клиента.
            if (settings.writeCrmNotes) {
                const note = await appendRopNote(t.orderId, t.reasonText, new Date(today));
                if (note.ok) {
                    notesWritten += 1;
                    // Отмечаем момент записи: по нему в следующий раз решается,
                    // была ли работа после нашего совета.
                    await supabase
                        .from('sales_rop_task')
                        .update({ note_written_at: new Date().toISOString() })
                        .eq('plan_date', today)
                        .eq('order_id', t.orderId);
                } else if (note.skipped === 'not-worked') {
                    notesSkipped += 1;
                }
            }
            await supabase
                .from('sales_rop_task')
                .update({ crm_date_set: res.ok, crm_error: res.error ?? null })
                .eq('plan_date', today)
                .eq('order_id', t.orderId);
        }
    }

    // Одно сообщение на человека — приветствие и пожелание уже внутри него.
    const messages = preview;
    const direct = settings.deliverPlansToDm ? await loadDirectChats() : new Map<number, string>();

    let sent = false;
    if (!opts.dryRun && settings.enabled) {
        for (const bucket of Array.from(byRecipient.values())) {
            const text = messages[Array.from(byRecipient.values()).indexOf(bucket)];
            const dm = bucket.managerId !== null ? direct.get(bucket.managerId) : undefined;
            // Нет личного чата — план всё равно уходит в общий: человек не должен
            // остаться без работы из-за того, что не написал боту.
            const target = dm || settings.chatId;
            if (target && text) await sendToChat(target, text);
        }

        // В общий чат — короткая сводка: кто сколько получил. Подробности там
        // превращают рабочий чат в ленту, куда проваливаются оплаты.
        if (settings.summaryToGroup && settings.chatId && byRecipient.size > 0) {
            const lines = ['📋 Планы на сегодня разосланы:'];
            for (const b of Array.from(byRecipient.values())) {
                const live = b.tasks.filter((t) => t.reasonCode !== 'cold');
                const sum = live.reduce((s, t) => s + t.amount, 0);
                const who = b.tg ? `@${b.tg.replace(/^@/, '')}` : b.name;
                const where = b.managerId !== null && direct.has(b.managerId) ? '' : ' (плана в личке нет — смотри выше)';
                lines.push(`${who} — ${live.length} шт. на ${Math.round(sum).toLocaleString('ru-RU')} ₽${where}`);
            }
            await sendToChat(settings.chatId, lines.join('\n'));
        }
        sent = true;
    }

    return { date: today, managers: preview.length, tasks: rows.length, crmSet, notesWritten, notesSkipped, sent, preview: messages };
}

function taskRow(date: string, t: Task) {
    return {
        plan_date: date,
        manager_id: t.managerId,
        order_id: t.orderId,
        order_number: t.number,
        client: t.client,
        status_code: t.statusCode,
        status_name: t.statusName,
        amount: t.amount,
        reason_code: t.reasonCode,
        reason_text: t.reasonText,
        weight: t.weight,
    };
}

/**
 * Касание — любой след работы по заказу за день: комментарий менеджера, смена
 * статуса, перенос даты контакта, звонок или письмо. Специально широко: цель
 * не поймать за руку, а увидеть, что заказом занимались.
 */
export async function detectTouches(date: string): Promise<Map<number, string>> {
    const { data, error } = await supabase.rpc('sales_rop_touches', { p_date: date });
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((r: any) => [Number(r.order_id), String(r.touch_kind)]));
}

export type EveningResult = { date: string; checked: number; touched: number; sent: boolean; preview: string[] };

export async function runEvening(today: string, opts: { dryRun?: boolean } = {}): Promise<EveningResult> {
    const settings = await loadSettings();

    const { data: tasks, error } = await supabase
        .from('sales_rop_task')
        .select('*')
        .eq('plan_date', today);
    if (error) throw new Error(error.message);
    // Задач может не быть — например, план не запускался или день выходной.
    // Владельцу отчёт всё равно нужен: цифры дня и звонки существуют независимо
    // от того, ставили ли мы кому-то задачи.

    const touches = await detectTouches(today);
    const orders = await loadPresaleOrders();
    const who = new Map<number | null, { name: string; tg: string }>();
    for (const o of orders) who.set(o.managerId, { name: o.managerName, tg: o.telegram });

    const byManager = new Map<number | null, EveningRow[]>();
    const ownerRows: OwnerRow[] = [];
    let touchedCount = 0;

    for (const t of tasks as any[]) {
        const kind = touches.get(Number(t.order_id)) ?? null;
        if (kind) touchedCount += 1;
        const row: EveningRow = {
            orderId: Number(t.order_id),
            number: t.order_number,
            client: t.client,
            statusCode: t.status_code,
            statusName: t.status_name,
            amount: Number(t.amount),
            managerId: t.manager_id === null ? null : Number(t.manager_id),
            reasonCode: t.reason_code,
            reasonText: t.reason_text,
            weight: Number(t.weight),
            touched: Boolean(kind),
            touchKind: kind,
        };
        const list = byManager.get(row.managerId) ?? [];
        list.push(row);
        byManager.set(row.managerId, list);
    }

    if (!opts.dryRun) {
        for (const [, rows] of Array.from(byManager.entries())) {
            for (const r of rows) {
                await supabase
                    .from('sales_rop_task')
                    .update({ touched: r.touched, touch_kind: r.touchKind, checked_at: new Date().toISOString() })
                    .eq('plan_date', today)
                    .eq('order_id', r.orderId);
            }
        }
    }

    const facts = await dayFacts(today, settings.monthPlan);
    const preview = [facts];

    // Срез по звонкам — каждому в личку, вместе с его разбором задач. В общий
    // чат это не идёт: сравнивать людей по числу звонков бессмысленно, у одного
    // крупные сделки и длинные разговоры, у другого поток мелких.
    const [{ data: callRows }, { data: baseRows }] = await Promise.all([
        supabase.rpc('sales_rop_call_day', { p_date: today }),
        supabase.rpc('sales_rop_call_baseline', { p_days: 14 }),
    ]);
    const callsById = new Map(((callRows ?? []) as any[]).map((r) => [String(r.manager_id), r]));
    const baseById = new Map(((baseRows ?? []) as any[]).map((r) => [String(r.manager_id), r]));

    // Личные планы: своя цифра, а не общая по отделу. 13,5 млн человек на себя не
    // примеряет, свои 5 154 000 — примеряет.
    const personalPlans = await loadPersonalPlans(today);
    const personalSold = await loadMonthSoldByManager(today);
    const workdaysLeft = workdaysLeftInMonth(today);
    for (const [managerId, rows] of Array.from(byManager.entries())) {
        const w = who.get(managerId) ?? { name: 'без менеджера', tg: '' };
        const plan = managerId === null ? null : (personalPlans.get(managerId) ?? null);
        const personal = plan
            ? formatPersonalPlan({ sold: personalSold.get(managerId as number) ?? 0, plan, workdaysLeft })
            : null;
        const own =
            formatEvening({ managerName: w.name, telegramUsername: w.tg, rows }, CRM_BASE) +
            (personal ? `\n\n${personal}` : '');
        const call = managerId === null ? null : callsById.get(String(managerId));
        const base = managerId === null ? null : baseById.get(String(managerId));

        // Разбор содержания: сколько из звонков были разговорами, сколько
        // закончились договорённостью и что стоит доделать. Счётчик без этого
        // обманывает — сорок звонков выглядят работой, а половина из них гудки.
        // Разговоры считаются по расшифровкам, а не по длительности: минуту
        // слушать автоответчик — не работа, и в норму это попадать не должно.
        const review = managerId === null ? null : await reviewCallDay(today, String(managerId)).catch(() => null);

        if (call) {
            ownerRows.push({
                managerName: w.name,
                tasksTotal: rows.length,
                tasksDone: rows.filter((r) => r.touched).length,
                amountUntouched: rows.filter((r) => !r.touched).reduce((s, r) => s + r.amount, 0),
                calls: Number(call.calls_total),
                talks: review ? review.realTalks : Number(call.talks),
                machine: review?.machineCalls ?? 0,
                minutes: Number(call.talk_minutes),
            });
        }

        preview.push(
            call
                ? `${own}\n\n${formatCallDay({
                      calls: Number(call.calls_total),
                      // Подтверждённые расшифровкой, а не «дольше 20 секунд».
                      talks: review ? review.realTalks : Number(call.talks),
                      machine: review?.machineCalls,
                      noAnswer: review?.noAnswerCalls,
                      noRecord: review?.noRecordCalls,
                      outgoing: Number(call.outgoing),
                      incoming: Number(call.incoming),
                      minutes: Number(call.talk_minutes),
                      firstCall: call.first_call ?? null,
                      lastCall: call.last_call ?? null,
                      avgCalls: base ? Number(base.avg_calls) : null,
                      avgTalks: base ? Number(base.avg_talks) : null,
                      avgMinutes: base ? Number(base.avg_minutes) : null,
                      targetMinutes: settings.talkMinutesTarget,
                      targetTalks: settings.talksTarget,
                  })}${review?.text ? `\n\n${review.text}` : ''}`
                : own,
        );
    }

    // Дисциплина печатается каждый вечер: показатель, который видят раз в
    // неделю, ни на что не влияет — а этот прямо определяет, сколько заявок
    // человек получит завтра.
    {
        const { data: disc } = await supabase.rpc('sales_rop_discipline', { p_days: settings.disciplineDays });
        const rows = ((disc ?? []) as any[]).map((r) => {
            const w = who.get(r.manager_id === null ? null : Number(r.manager_id));
            return {
                managerName: r.manager_name || w?.name || 'без менеджера',
                telegramUsername: w?.tg || '',
                tasksTotal: Number(r.tasks_total),
                tasksTouched: Number(r.tasks_touched),
                donePct: Number(r.done_pct ?? 0),
                amountUntouched: Number(r.amount_untouched ?? 0),
            };
        });
        const text = formatDiscipline(rows, settings.disciplineWarnPct, settings.disciplineDays);
        if (text) preview.push(text);
    }

    // Менеджеры, у которых сегодня были звонки, но не было задач из плана: их
    // день тоже состоялся, и в отчёте владельцу они должны быть. Иначе выходной
    // или несработавший утренний прогон выглядит как «никто не работал».
    const covered = new Set(ownerRows.map((r) => r.managerName));
    for (const [managerId, call] of Array.from(callsById.entries())) {
        if (settings.planManagerIds.length > 0 && !settings.planManagerIds.includes(Number(managerId))) continue;
        const name = String((call as any).manager_name ?? '');
        if (!name || covered.has(name)) continue;

        const review = settings.reviewCalls ? await reviewCallDay(today, String(managerId)).catch(() => null) : null;
        ownerRows.push({
            managerName: name,
            tasksTotal: 0,
            tasksDone: 0,
            amountUntouched: 0,
            calls: Number((call as any).calls_total),
            talks: review ? review.realTalks : Number((call as any).talks),
            machine: review?.machineCalls ?? 0,
            minutes: Number((call as any).talk_minutes),
        });
    }

    // Вечерний разбор тоже уходит в личку: подробности в общем чате — это лента.
    const direct = settings.deliverPlansToDm ? await loadDirectChats() : new Map<number, string>();

    // Отчёт владельцу: отдел целиком и то, что требует его решения.
    const { data: att } = await supabase.rpc('sales_rop_attention');
    const attention = ((att ?? []) as any[])[0] ?? {};
    const ownerText = formatOwnerReport({
        date: today,
        header: facts,
        rows: ownerRows,
        invoicesToday: Number(/Счетов выставлено: (\d+)/.exec(facts)?.[1] ?? 0),
        overdueContacts: Number(attention.overdue_contacts ?? 0),
        overdueAmount: Number(attention.overdue_amount ?? 0),
        staleInvoices: Number(attention.stale_invoices ?? 0),
    });

    let sent = false;
    if (!opts.dryRun && settings.enabled) {
        for (const [managerId, rows] of Array.from(byManager.entries())) {
            const dm = managerId === null ? undefined : direct.get(managerId);
            const text = preview[Array.from(byManager.keys()).indexOf(managerId) + 1];
            if (text) await sendToChat(dm || settings.chatId, text);
        }

        if (settings.ownerReport && settings.ownerChatId) await sendToChat(settings.ownerChatId, ownerText);
        sent = true;
    }

    preview.push(ownerText);

    return { date: today, checked: (tasks as any[]).length, touched: touchedCount, sent, preview };
}

/**
 * План отдела на месяц — из «Настройки мотивации → Планы» (salary_plan), там же,
 * где его ставит владелец, и там же, откуда его берёт ведомость ЗП.
 *
 * Раньше бот читал собственную настройку month_plan: она не менялась по месяцам,
 * интерфейса не имела, и 02.09.2026 отчёт показал 13 млн, когда на сентябрь был
 * поставлен план 13,5 млн. Одна цифра в двух местах — это всегда расхождение,
 * замеченное человеком, а не системой.
 *
 * Настройка month_plan остаётся запасной: если план на месяц ещё не заведён,
 * отчёт должен выйти с прежним числом, а не с нулём.
 */
/** Личные планы менеджеров на месяц — оттуда же, из «Настройки мотивации → Планы». */
async function loadPersonalPlans(today: string): Promise<Map<number, number>> {
    const date = new Date(today);
    const { data, error } = await supabase
        .from('salary_plan')
        .select('manager_id, target')
        .eq('year', date.getUTCFullYear())
        .eq('month', date.getUTCMonth() + 1)
        .eq('metric', 'revenue_no_vat')
        .not('manager_id', 'is', null);
    if (error) return new Map();
    const out = new Map<number, number>();
    for (const r of (data ?? []) as any[]) {
        const target = Number(r.target);
        if (Number.isFinite(target) && target > 0) out.set(Number(r.manager_id), target);
    }
    return out;
}

/** Сколько каждый уже сделал за месяц: та же выручка без НДС, что и в общем плане. */
async function loadMonthSoldByManager(today: string): Promise<Map<number, number>> {
    const { data, error } = await supabase.rpc('sales_rop_month_by_manager', { p_date: today });
    if (error) return new Map();
    return new Map(((data ?? []) as any[]).map((r) => [Number(r.manager_id), Number(r.sold_sum ?? 0)]));
}

/** Рабочих дней до конца месяца, не считая сегодняшний: он уже прожит. */
function workdaysLeftInMonth(today: string): number {
    const date = new Date(today);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    let left = 0;
    for (let d = date.getUTCDate() + 1; d <= last.getUTCDate(); d += 1) {
        const wd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), d)).getUTCDay();
        if (wd !== 0 && wd !== 6) left += 1;
    }
    return left;
}

async function loadMonthPlan(today: string, fallback: number): Promise<number> {
    const date = new Date(today);
    const { data, error } = await supabase
        .from('salary_plan')
        .select('target')
        .eq('year', date.getUTCFullYear())
        .eq('month', date.getUTCMonth() + 1)
        .eq('metric', 'revenue_no_vat')
        .is('manager_id', null)
        .maybeSingle();
    if (error || !data) return fallback;
    const target = Number((data as any).target);
    return Number.isFinite(target) && target > 0 ? target : fallback;
}

async function dayFacts(today: string, monthPlanFallback: number): Promise<string> {
    const { data, error } = await supabase.rpc('sales_rop_day_facts', { p_date: today });
    if (error) throw new Error(error.message);
    const f = (data ?? [])[0] ?? {};
    const monthPlan = await loadMonthPlan(today, monthPlanFallback);

    return formatEveningHeader({
        date: new Date(today).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
        invoicesToday: Number(f.invoices_count ?? 0),
        invoicesSum: Number(f.invoices_sum ?? 0),
        soldToday: Number(f.sold_count ?? 0),
        soldSum: Number(f.sold_sum ?? 0),
        monthSold: Number(f.month_sold ?? 0),
        monthPlan,
        workdaysLeft: workdaysLeftInMonth(today),
    });
}
