/**
 * Звонки, которые идут прямо сейчас, — для всплывающего окна.
 *
 * Жалоба Евгении Матвеевой 07.10.2026: «оповещения по звонкам приходят с
 * задержкой примерно в минуту после окончания звонка. Можно сделать так, чтобы
 * оповещение выскакивало на экране мгновенно, в момент, когда клиент звонит?
 * Иначе мы в момент звонка не понимаем, кто звонит».
 *
 * Почему окно не всплывало. Оно слушало изменения таблицы `active_calls`
 * напрямую из браузера, а браузер подключается к базе АНОНИМНО: вход в ОКК
 * свой, в Supabase Auth мы не логинимся. Читать `active_calls` разрешено
 * только роли authenticated — анонимный слушатель не получал ни одного
 * события. Работал только опрос раз в минуту по УЖЕ ЗАВЕРШЁННЫМ звонкам
 * (`/api/calls/alerts`), отсюда и «через минуту после окончания».
 *
 * Поэтому отдаём звонки своим маршрутом: здесь есть наша сессия, и кому
 * показывать звонок, решает сервер, а не браузер. Анонимный доступ к номерам
 * клиентов открывать не стали — ключ браузера публичный.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { ordersByPhone } from '@/lib/call-binding';
import { callStillFresh, dropStaleCalls } from '@/lib/calls/active-call';

export const dynamic = 'force-dynamic';

/**
 * Заказы клиента по номеру — ненадолго в памяти.
 *
 * Окно звонка спрашивает нас раз в две секунды, а пока телефон звонит, ответ
 * не меняется: держим минуту, чтобы не гонять один и тот же запрос полтора
 * десятка раз за звонок.
 */
/**
 * Чистка зависших строк: не чаще раза в полминуты.
 *
 * Окно спрашивает нас каждые две секунды у каждого открытого ОКК — удалять на
 * каждый заход незачем, а повисший звонок столько времени потерпит.
 */
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 30_000;

async function sweepStale(): Promise<void> {
    if (Date.now() - lastSweepAt < SWEEP_EVERY_MS) return;
    lastSweepAt = Date.now();
    await dropStaleCalls().catch(() => 0);
}

const ordersCache = new Map<string, { at: number; orders: Array<{ orderId: number; number: string }> }>();
const ORDERS_CACHE_MS = 60_000;

async function clientOrders(phone: string): Promise<Array<{ orderId: number; number: string }>> {
    const key = phone.replace(/\D/g, '').slice(-10);
    if (!key) return [];

    const hit = ordersCache.get(key);
    if (hit && Date.now() - hit.at < ORDERS_CACHE_MS) return hit.orders;

    const found = await ordersByPhone(phone, 3).catch(() => []);
    const orders = found.map((order) => ({ orderId: order.orderId, number: order.number }));
    ordersCache.set(key, { at: Date.now(), orders });
    return orders;
}

export async function GET() {
    const session = await enrichSessionWithManagerIdentity(await getSession());
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    /**
     * Окно звонка — тому, у кого звонит телефон.
     *
     * Руководителю и ОКК показываем звонки всего отдела: им нужна картина
     * целиком (решение владельца 05.10.2026). Владельцу — нет: он просил
     * убрать всплывающие звонки отдела (09.10.2026), а свой телефон у него
     * по добавочному и так увидит.
     */
    const seeAll = hasAnyRole(session, ['okk', 'rop']);

    let extension: string | null = null;
    const managerId = session.user.retail_crm_manager_id;
    if (managerId) {
        const { data } = await supabase
            .from('managers')
            .select('telphin_extension')
            .eq('id', managerId)
            .maybeSingle();
        const value = (data as any)?.telphin_extension;
        extension = value ? String(value).trim() : null;
    }

    await sweepStale();

    const { data: rows } = await supabase
        .from('active_calls')
        .select('telphin_call_id, direction, from_number, to_number, extension_number, extensions, is_queue, client_name, client_id, order_id, order_number, status, started_at, legs')
        .order('started_at', { ascending: false })
        .limit(10);

    const calls = ((rows ?? []) as any[]).filter((call) => {
        /**
         * Звонок, который уже не идёт, не показываем, даже если строка ещё не
         * удалена: чистка идёт раз в полминуты, а окно спрашивает каждые две
         * секунды (жалоба Евгении Матвеевой 13.10.2026 — окна получасовой
         * давности лезли при каждом действии).
         */
        if (call.status === 'ended') return false;
        // Пока открыта хоть одна нога, звонок идёт — даже если события
        // «трубку подняли» Телфин не прислал (решение владельца 15.10.2026).
        if (!callStillFresh(call)) return false;

        if (seeAll) return true;
        // Очередь звонит у нескольких сразу — окно видят все, кто в ней.
        if (call.is_queue) return true;
        if (!extension) return false;
        // Перевод по внутреннему: окно видит и тот, кому звонили сначала, и
        // тот, на кого перевели.
        const all: string[] = Array.isArray(call.extensions) ? call.extensions : [];
        return all.includes(extension) || call.extension_number === extension;
    });

    /**
     * Заказы клиента, если звонок ни к одному не привязан.
     *
     * Автопривязка срабатывает, только когда заказ один: у постоянного клиента
     * их семь, и окно писало «Заказов не найдено» — хотя заказы есть, просто
     * выбрать должен человек (Лена Парфёнова 12.10.2026, звонила по заказу
     * 54607). Берём несколько последних, чтобы менеджер ткнул в нужный, не
     * открывая список.
     */
    const withOrders = await Promise.all(calls.map(async (call: any) => {
        if (call.order_number) return call;

        const phone = String(call.from_number ?? '').trim();
        if (!phone) return call;

        return { ...call, client_orders: await clientOrders(phone) };
    }));

    return NextResponse.json({ calls: withOrders, extension, seeAll });
}
