/**
 * Кого ночная сверка отправляет на переоценку баллов ОКК.
 *
 * ПОЧЕМУ НЕ ВЕСЬ РАБОЧИЙ СПИСОК. До 17.10.2026 сверка брала все заказы в рабочих
 * статусах подряд — 1 377 штук каждую ночь, случилось по ним что-нибудь или нет.
 * Пересчитывать нетронутый заказ бессмысленно: оценка выйдет ровно та же, что
 * вчера. Так очередь и набила 1 159 работ, которые некому было разобрать.
 *
 * Сплошной обход был затычкой: триггеры «статус изменился» и «комментарий
 * добавлен» жили в приёме из RetailCRM, а приём выключили 05.10.2026, когда ОКК
 * стала единственной системой учёта.
 *
 * Теперь ночью переоцениваются двое:
 *   события — заказы, по которым за сутки был звонок, смена статуса, комментарий
 *             или правка; свежие события первыми;
 *   план    — заказы завтрашнего плана дня: утром по ним выдадут совет, и он
 *             должен опираться на свежую оценку, а не на недельной давности.
 */
import { supabase } from '@/utils/supabase';
import { localToday } from '@/lib/sales-rop/local-day';
import { runMorning } from '@/lib/sales-rop/service';

/** За какой срок считаем, что по заказу было событие. Сутки с запасом на вечер пятницы. */
export const EVENT_WINDOW_HOURS = 30;

/**
 * Сколько записей истории просматриваем. За сутки их бывает 300–700 на 70–100
 * заказов; две тысячи — потолок с троекратным запасом, чтобы не тянуть лишнего.
 */
export const EVENT_SCAN_LIMIT = 2000;

/**
 * Заказы, по которым за сутки что-то произошло. Один заказ — один раз, даже если
 * его правили десять раз за вечер. Свежие события впереди: вчерашний разговор
 * важнее позавчерашнего.
 */
export async function getOrdersWithRecentEvents(
    offset: number,
    limit: number,
    now: Date = new Date(),
): Promise<number[]> {
    const since = new Date(now.getTime() - EVENT_WINDOW_HOURS * 3600 * 1000).toISOString();

    const { data, error } = await supabase
        .from('order_history_log')
        .select('retailcrm_order_id, occurred_at')
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(EVENT_SCAN_LIMIT);

    if (error) {
        throw error;
    }

    const seen = new Set<number>();
    const ordered: number[] = [];

    for (const row of (data || []) as Array<{ retailcrm_order_id: number | null }>) {
        const orderId = Number(row.retailcrm_order_id);
        if (!Number.isFinite(orderId) || orderId <= 0 || seen.has(orderId)) continue;
        seen.add(orderId);
        ordered.push(orderId);
    }

    return ordered.slice(offset, offset + limit);
}

/**
 * Заказы завтрашнего плана дня.
 *
 * Замер 17.10.2026: из 53 задач вчерашнего плана у 42 заказов оценка была старше
 * недели, у трёх её не было вовсе, свежей — у шести. План считается вхолостую
 * (`dryRun`): состав известен, но ничего не пишется и никому не отправляется.
 */
export async function getPlannedOrderIds(now: Date = new Date()): Promise<number[]> {
    // Сверка идёт поздним вечером, план нужен на наступающий день: шесть часов
    // вперёд переводят любой её заход в завтрашнюю заводскую дату.
    const planDate = localToday(new Date(now.getTime() + 6 * 3600 * 1000));
    const preview = await runMorning(planDate, { dryRun: true });

    return preview.orderIds || [];
}
