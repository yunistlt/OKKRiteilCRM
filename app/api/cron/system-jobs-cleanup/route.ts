import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.cleanup';

/**
 * Срок хранения очереди системных заданий.
 *
 * У очереди не было срока хранения вовсе: за полгода накопилось 650 тыс. записей
 * на 505 МБ, из них 648 тыс. — про работу, сделанную давно. По этой таблице
 * четырнадцать воркеров скребут каждую минуту, выбирая себе задания, и чем она
 * толще, тем дороже каждый такой опрос (замер 16.10.2026 — 159 мс).
 *
 * ПОЧЕМУ МАЛЫМИ ПОРЦИЯМИ. 16.10.2026 разовая чистка большими кусками дважды
 * положила работу всему отделу: диск у базы такой, что массовое удаление
 * забивает его целиком, и список заказов переставал открываться. Поэтому здесь
 * порции маленькие, между ними проверяется, не замедлилась ли база, и при
 * первых признаках уборка сама останавливается до следующего раза. Не успели за
 * раз — не беда, доберём завтра.
 */

/** По сколько записей удаляем за раз. Маленькая порция — короткая блокировка. */
const BATCH = 200;
/** Сколько порций максимум за один запуск: дальше уступаем место людям. */
const MAX_BATCHES = 40;
/** Сколько дней держим выполненное: столько живёт защита от повторной обработки. */
const KEEP_DAYS = 14;
/** Заказы отдаются дольше — люди это уже чувствуют, останавливаемся. */
const ORDERS_LIMIT_MS = 1500;

/**
 * Типы заданий выключенных механизмов: подкачка из RetailCRM снята 05.10.2026,
 * новых таких заданий не появляется, и ключ от повторной обработки по ним уже
 * ничего не защищает. Их можно убирать независимо от срока.
 */
const МЁРТВЫЕ_ТИПЫ = [
    'retailcrm_order_delta_pull',
    'retailcrm_history_delta_pull',
    'retailcrm_order_upsert',
];

/** Сколько миллисекунд база отдаёт обычный список заказов. */
async function ordersResponseMs(): Promise<number> {
    const t0 = Date.now();
    await supabase
        .from('orders')
        .select('order_id')
        .is('crm_deleted_at', null)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(50);
    return Date.now() - t0;
}

/** Одна порция: сначала мёртвые типы, потом просто старое выполненное. */
async function deleteBatch(): Promise<number> {
    const granica = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();

    const { data: мёртвые } = await supabase
        .from('system_jobs')
        .select('id')
        .eq('status', 'completed')
        .in('job_type', МЁРТВЫЕ_ТИПЫ)
        .limit(BATCH);

    let ids = ((мёртвые ?? []) as any[]).map((r) => r.id);

    if (ids.length < BATCH) {
        const { data: старые } = await supabase
            .from('system_jobs')
            .select('id')
            .eq('status', 'completed')
            .lt('finished_at', granica)
            .limit(BATCH - ids.length);
        ids = ids.concat(((старые ?? []) as any[]).map((r) => r.id));
    }

    if (!ids.length) return 0;

    const { error } = await supabase.from('system_jobs').delete().in('id', ids);
    if (error) throw error;
    return ids.length;
}

export async function GET(req: NextRequest) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    const началось = Date.now();

    try {
        if (dryRun) {
            const { count } = await supabase
                .from('system_jobs')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'completed');
            return NextResponse.json({ ok: true, dryRun: true, выполненных: count ?? 0 });
        }

        let удалено = 0;
        let порций = 0;
        let остановка: string | null = null;

        for (; порций < MAX_BATCHES; порций++) {
            const сколько = await deleteBatch();
            if (!сколько) {
                остановка = 'убирать больше нечего';
                break;
            }
            удалено += сколько;

            const мс = await ordersResponseMs();
            if (мс > ORDERS_LIMIT_MS) {
                остановка = `база замедлилась (заказы ${мс} мс) — доберём в следующий раз`;
                break;
            }
        }

        const итог = {
            удалено,
            порций,
            остановка: остановка ?? 'выбран лимит порций за запуск',
            заняло_мс: Date.now() - началось,
        };
        await recordWorkerSuccess(WORKER_KEY, итог);
        return NextResponse.json({ ok: true, ...итог });
    } catch (e: any) {
        await recordWorkerFailure(WORKER_KEY, e?.message || String(e));
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}
