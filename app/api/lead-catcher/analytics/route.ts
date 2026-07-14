import { NextResponse } from 'next/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

// Каналы захвата («ловцы»). Атрибуция на уровне сессии, приоритет сверху вниз:
//   call  — сессия инициировала заявку на обратный звонок (widget_callback_requests)
//   cart  — сессия оставила корзину на email (widget_wishlist_requests, exit-intent)
//   chat  — всё остальное: обычный диалог с Еленой
// Проверено на боевой БД: пересечения call/cart на уровне сессии отсутствуют.
const CHANNEL_CASE = `
    CASE
        WHEN cb.session_id IS NOT NULL THEN 'call'
        WHEN wl.session_id IS NOT NULL THEN 'cart'
        ELSE 'chat'
    END`;

const CHANNEL_JOINS = `
    LEFT JOIN (SELECT DISTINCT session_id FROM widget_callback_requests WHERE session_id IS NOT NULL) cb ON cb.session_id = s.id
    LEFT JOIN (SELECT DISTINCT session_id FROM widget_wishlist_requests WHERE session_id IS NOT NULL) wl ON wl.session_id = s.id`;

type ChannelKey = 'chat' | 'call' | 'cart';
const CHANNELS: ChannelKey[] = ['chat', 'call', 'cart'];

interface Metrics { dialogs: number; contacts: number; orders: number; conversion: number; }

function emptyMetrics(): Metrics { return { dialogs: 0, contacts: 0, orders: 0, conversion: 0 }; }

// Конверсия = заказы / обращения. Единая метрика для всех каналов: для call/cart
// контакт захватывается по построению (заявка = контакт), поэтому осмысленна
// именно конверсия в заказ, а не в контакт.
function withConversion(dialogs: number, contacts: number, orders: number): Metrics {
    const conversion = dialogs > 0 ? parseFloat(((orders / dialogs) * 100).toFixed(2)) : 0;
    return { dialogs, contacts, orders, conversion };
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || 'week'; // 'week' | 'month' | 'quarter' | 'year'

    if (!connectionString) {
        return NextResponse.json({ error: 'Database connection string missing' }, { status: 500 });
    }

    let intervalTrunc = 'day';
    let intervalBack = '7 days';

    if (range === 'month') {
        intervalTrunc = 'day';
        intervalBack = '30 days';
    } else if (range === 'quarter') {
        intervalTrunc = 'week';
        intervalBack = '90 days';
    } else if (range === 'year') {
        intervalTrunc = 'week';
        intervalBack = '365 days';
    }

    const sql = postgres(connectionString);

    try {
        // 1) Итоги за всё время по каждому каналу (для карточек KPI и матрицы сравнения).
        const totalRows = await sql.unsafe(`
            SELECT
                ${CHANNEL_CASE} AS channel,
                COUNT(*)::int AS dialogs,
                COUNT(*) FILTER (WHERE s.has_contacts = true)::int AS contacts,
                COUNT(*) FILTER (WHERE s.crm_order_id IS NOT NULL)::int AS orders
            FROM widget_sessions s
            ${CHANNEL_JOINS}
            GROUP BY 1
        `);

        // 2) Динамика по периодам и каналам за выбранный диапазон (для графика).
        const seriesRows = await sql.unsafe(`
            SELECT
                date_trunc('${intervalTrunc}', s.created_at)::date AS period_start,
                ${CHANNEL_CASE} AS channel,
                COUNT(*)::int AS dialogs,
                COUNT(*) FILTER (WHERE s.has_contacts = true)::int AS contacts,
                COUNT(*) FILTER (WHERE s.crm_order_id IS NOT NULL)::int AS orders
            FROM widget_sessions s
            ${CHANNEL_JOINS}
            WHERE s.created_at >= NOW() - CAST('${intervalBack}' AS INTERVAL)
            GROUP BY 1, 2
            ORDER BY 1 ASC
        `);

        // 3) Последние захваченные контакты (для таблицы) с меткой канала.
        const contactRows = await sql.unsafe(`
            SELECT
                s.id, s.nickname, s.contact_name, s.contact_phone, s.contact_email,
                s.geo_city, s.domain, s.crm_order_id, s.created_at,
                ${CHANNEL_CASE} AS channel
            FROM widget_sessions s
            ${CHANNEL_JOINS}
            WHERE s.has_contacts = true
            ORDER BY s.created_at DESC
            LIMIT 50
        `);

        // ---- Собираем итоги ----
        const totals: Record<string, Metrics> = {
            all: emptyMetrics(), chat: emptyMetrics(), call: emptyMetrics(), cart: emptyMetrics(),
        };
        let allD = 0, allC = 0, allO = 0;
        for (const r of totalRows) {
            const ch = r.channel as ChannelKey;
            totals[ch] = withConversion(r.dialogs, r.contacts, r.orders);
            allD += r.dialogs; allC += r.contacts; allO += r.orders;
        }
        totals.all = withConversion(allD, allC, allO);

        // ---- Собираем динамику: пивот по периодам ----
        const byPeriod = new Map<string, Record<string, { dialogs: number; contacts: number; orders: number }>>();
        for (const r of seriesRows) {
            const key = new Date(r.period_start).toISOString().slice(0, 10);
            if (!byPeriod.has(key)) {
                byPeriod.set(key, {
                    chat: { dialogs: 0, contacts: 0, orders: 0 },
                    call: { dialogs: 0, contacts: 0, orders: 0 },
                    cart: { dialogs: 0, contacts: 0, orders: 0 },
                });
            }
            const bucket = byPeriod.get(key)!;
            bucket[r.channel] = { dialogs: r.dialogs, contacts: r.contacts, orders: r.orders };
        }

        const points = Array.from(byPeriod.entries()).map(([iso, bucket]) => {
            const dateObj = new Date(iso);
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const label = `${day}.${month}`;

            let d = 0, c = 0, o = 0;
            const perChannel: Record<string, Metrics> = {};
            for (const ch of CHANNELS) {
                const m = bucket[ch];
                perChannel[ch] = withConversion(m.dialogs, m.contacts, m.orders);
                d += m.dialogs; c += m.contacts; o += m.orders;
            }
            const all = withConversion(d, c, o);

            return {
                label,
                // Плоские поля для обратной совместимости (агрегат по всем каналам).
                dialogs: all.dialogs, contacts: all.contacts, orders: all.orders, conversion: all.conversion,
                all,
                chat: perChannel.chat, call: perChannel.call, cart: perChannel.cart,
            };
        });

        // ---- Контакты ----
        const contacts = contactRows.map((r: any) => ({
            id: r.id,
            nickname: r.nickname,
            contact_name: r.contact_name,
            contact_phone: r.contact_phone,
            contact_email: r.contact_email,
            geo_city: r.geo_city,
            domain: r.domain,
            crm_order_id: r.crm_order_id,
            created_at: r.created_at,
            channel: r.channel as ChannelKey,
        }));

        return NextResponse.json({ totals, points, contacts });
    } catch (err: any) {
        console.error('Analytics Fetch Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        await sql.end();
    }
}
