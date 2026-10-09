// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { formatEventValue, MAIL_FEED_FIELD_PATTERNS } from '@/lib/order-events';
import { buildFieldLabelResolver } from '@/lib/order-field-labels';
import { loadOrderCalls } from '@/lib/own-crm/order-calls';
import { resolveOrderRef } from '@/lib/own-crm/order-ref';
import { loadOrderMail } from '@/lib/own-crm/order-mail';
import { clientCardIdForOrder } from '@/lib/own-crm/clients';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    try {
        // 1. Fetch Order Details (Basic info)
        // Номер или идентификатор — разбирает одно место на весь проект.
        const ref = await resolveOrderRef(id);
        if (!ref) {
            return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select(`
                *,
                managers ( first_name, last_name, email )
            `)
            .eq('id', ref.id)
            .single();

        if (orderError) throw orderError;

        // 2. Звонки заказа — все разговоры, о которых знаем: см. lib/own-crm/order-calls.ts.
        const calls = await loadOrderCalls({
            orderNumber: String(order.number ?? order.order_id),
            orderRowId: Number(order.id),
        });

        // 3. Коммуникации (письма, сообщения, комментарии) — из истории заказа
        //    (order_history_log; raw_order_events заморожена, см. lib/order-events.ts)
        const { data: events } = await supabase
            .from('order_history_log')
            .select('field, old_value, new_value, occurred_at')
            .eq('retailcrm_order_id', order.order_id)
            .or(MAIL_FEED_FIELD_PATTERNS.map((p) => `field.ilike.${p}`).join(','))
            .order('occurred_at', { ascending: false })
            .limit(10);

        // Лента «Письма и сообщения»: настоящая переписка из своих таблиц
        // (входящие Катерины и письма, отправленные из карточки) плюс
        // email-события истории RetailCRM. Комментарии менеджера сюда не
        // попадают — у них своё поле (замечания Евгении 02.10.2026).
        const fieldLabel = await buildFieldLabelResolver();
        const mail = await loadOrderMail({
            orderNumber: String(order.number ?? order.order_id),
            orderId: order.order_id,
        });

        /**
         * Советы бота-РОПа по заказу: текст лежит в задаче дня, отдельной
         * таблицы под них нет и не нужно. Карточка показывает их своим окном
         * рядом с комментарием менеджера (решение владельца 05.10.2026).
         */
        const { data: ropTasks } = await supabase
            .from('sales_rop_task')
            .select('plan_date, reason_text, note_written_at')
            .eq('order_id', order.order_id)
            .not('reason_text', 'is', null)
            .order('plan_date', { ascending: false })
            .limit(10);

        const ropNotes = ((ropTasks ?? []) as any[])
            .filter((row) => String(row.reason_text ?? '').trim())
            .map((row) => ({ date: row.plan_date, text: String(row.reason_text).trim() }));

        /**
         * Название компании заказчика. В заказе `customer` часто лежит одним
         * идентификатором — у своих заявок там только `{id, type}`, — и поле
         * «Компания» в карточке показывало прочерк, хотя карточка клиента
         * заполнена (Лена Парфёнова 05.10.2026, заказ 900048). Берём название
         * оттуда, где оно живёт, — из карточки клиента.
         */
        const customerId = (order as any).raw_payload?.customer?.id ?? (order as any).customer?.id ?? null;
        /**
         * Какую карточку открывать по кнопкам «карточка заказчика» и «править в
         * карточке клиента». Заказ бывает заведён на живого человека, а не на
         * компанию — тогда это компания, где он контактное лицо (см.
         * lib/own-crm/clients.ts). Нет и её — отдаём null, карточка объясняет
         * менеджеру, что завести.
         */
        const clientCardId = await clientCardIdForOrder(customerId);
        let clientCompanyName: string | null = null;
        if (clientCardId) {
            const { data: client } = await supabase
                .from('clients')
                .select('company_name, "legalName", full_name')
                .eq('id', String(clientCardId))
                .maybeSingle();
            const row = client as any;
            clientCompanyName = row?.company_name || row?.legalName || row?.full_name || null;
        }

        const emails = [
            ...mail.map((entry) => ({
                id: entry.id,
                date: entry.date,
                type: entry.party ? `${entry.type} · ${entry.party}` : entry.type,
                fieldCode: entry.source,
                text: entry.text,
                // Тема и текст письма — карточка показывает именно их. Без этих
                // полей лента писала «Без темы» и «текст не сохранён», хотя
                // письмо лежало в базе целиком.
                subject: entry.subject,
                body: entry.body,
                party: entry.party,
                partyEmail: entry.partyEmail,
                attachments: entry.attachments,
                // Сами файлы: имя, размер и письмо, из которого качать.
                attachmentList: entry.attachmentList,
                emailId: entry.emailId,
                source: entry.source,
            })),
            ...((events ?? []).map((e) => ({
                id: `history-${e.occurred_at}-${e.field}`,
                date: e.occurred_at,
                type: fieldLabel(e.field),
                fieldCode: e.field,
                text: formatEventValue(e.new_value),
                subject: null,
                body: null,
                attachments: 0,
                attachmentList: [],
                emailId: null,
                source: 'retailcrm',
            }))),
        ].sort((left, right) => String(right.date ?? '').localeCompare(String(left.date ?? '')));

        // 4. История изменений заказа — канонический order_history_log
        const { data: rawHistory } = await supabase
            .from('order_history_log')
            .select('field, old_value, new_value, occurred_at, user_data')
            .eq('retailcrm_order_id', order.order_id)
            .order('occurred_at', { ascending: false });

        // Автора изменения CRM отдаёт как {id}; имя подставляем из справочника
        // менеджеров, иначе в интерфейсе будет голый код (закон: только
        // человеческий язык).
        const historyUserIds = Array.from(
            new Set(((rawHistory as any[]) ?? [])
                .map((h) => h.user_data?.id)
                .filter((id: any) => id != null)
                .map(Number)),
        );
        const userNames = new Map<number, { firstName: string; lastName: string }>();
        if (historyUserIds.length) {
            const { data: mgrs } = await supabase
                .from('managers')
                .select('id, first_name, last_name')
                .in('id', historyUserIds);
            for (const m of (mgrs as any[]) ?? []) {
                userNames.set(Number(m.id), { firstName: m.first_name || '', lastName: m.last_name || '' });
            }
        }


        // Статусы в истории лежат кодами ('novyi-1'). Человеку нужен их русский
        // вид и цвет — как в RetailCRM (закон: в интерфейсе только человеческий язык).
        const [{ data: statusDict }, { data: ownStatusRows }, { data: ownGroupRows }] = await Promise.all([
            supabase.from('retailcrm_dictionaries').select('item_code, item_name').eq('entity_type', 'status'),
            supabase.from('crm_statuses').select('external_code, group_id'),
            supabase.from('crm_status_groups').select('id, color'),
        ]);

        const groupColor = new Map<string, string | null>(
            ((ownGroupRows as any[]) ?? []).map((g) => [String(g.id), g.color || null]),
        );
        const statusPalette: Record<string, { name: string; color: string | null }> = {};
        for (const row of ((statusDict as any[]) ?? [])) {
            statusPalette[row.item_code] = { name: row.item_name || row.item_code, color: null };
        }
        for (const row of ((ownStatusRows as any[]) ?? [])) {
            const code = row.external_code;
            if (!code) continue;
            statusPalette[code] = {
                name: statusPalette[code]?.name ?? code,
                color: groupColor.get(String(row.group_id)) ?? null,
            };
        }

        const asStatus = (value: string) => statusPalette[value]?.name ?? value;

        const history = ((rawHistory as any[]) ?? []).map((h) => ({
            field: h.field,
            field_label: fieldLabel(h.field),
            old_value: h.field === 'status' ? asStatus(formatEventValue(h.old_value)) : formatEventValue(h.old_value),
            new_value: h.field === 'status' ? asStatus(formatEventValue(h.new_value)) : formatEventValue(h.new_value),
            old_status_code: h.field === 'status' ? formatEventValue(h.old_value) || null : null,
            new_status_code: h.field === 'status' ? formatEventValue(h.new_value) || null : null,
            user_data: h.user_data?.id != null
                ? userNames.get(Number(h.user_data.id)) ?? { firstName: 'RetailCRM', lastName: '' }
                : { firstName: 'Система', lastName: '' },
            occurred_at: h.occurred_at,
        }));

        // 5. Fetch AI Priority Analysis
        const { data: priority } = await supabase
            .from('order_priorities')
            .select('*')
            .eq('order_id', order.id) // This is the internal UUID (orders.id), check if table uses internal id
            .maybeSingle();

        // 6. Fetch Anna's Insights
        const { data: metrics } = await supabase
            .from('order_metrics')
            .select('insights')
            .eq('retailcrm_order_id', order.order_id)
            .maybeSingle();

        // Цвет статуса — тот же источник, что у списка заказов: цвета уже
        // назначены людьми, выдумывать свои нельзя.
        const { data: statusRow } = await supabase
            .from('statuses')
            .select('color, name, group_name')
            .eq('code', order.status)
            .maybeSingle();

        // Return structured data
        return NextResponse.json({
            // Палитра статусов — для плашек в истории, как в RetailCRM.
            statusPalette,
            statusColor: groupColor.get(String(((ownStatusRows as any[]) ?? []).find((r) => r.external_code === order.status)?.group_id)) || (statusRow as any)?.color || null,
            statusName: (statusRow as any)?.name || null,
            statusGroup: (statusRow as any)?.group_name || null,
            order: {
                ...order,
                manager_name: order.managers ? `${order.managers.first_name || ''} ${order.managers.last_name || ''}`.trim() : 'Не определен'
            },
            priority: priority, // Return priority data
            insights: metrics?.insights || null,
            calls,
            emails: emails,
            ropNotes,
            clientCompanyName,
            clientCardId,
            history: history || [],
            raw_payload: order.raw_payload
        });

    } catch (e: any) {
        console.error('Order Details Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
