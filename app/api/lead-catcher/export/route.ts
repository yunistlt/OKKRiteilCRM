import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function toCSV(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
    };
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ].join('\r\n');
}

export async function GET(req: NextRequest) {
    const managerSession = await getSession(req);
    if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'leads'; // leads | proposals | invoices
    const period = searchParams.get('period') || '30';
    const days = Math.min(Math.max(parseInt(period) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let csv = '';
    let filename = '';

    if (type === 'leads') {
        const { data } = await supabase
            .from('widget_sessions')
            .select('id, nickname, domain, geo_city, utm_source, utm_medium, utm_campaign, has_contacts, contact_name, contact_email, contact_phone, contact_company, interested_products, crm_order_id, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false });

        const rows = (data as any[] || []).map(s => ({
            ID:              s.id,
            Никнейм:         s.nickname || '',
            Сайт:            s.domain,
            Город:           s.geo_city || '',
            UTM_source:      s.utm_source || '',
            UTM_medium:      s.utm_medium || '',
            UTM_campaign:    s.utm_campaign || '',
            Контакт_есть:    s.has_contacts ? 'Да' : 'Нет',
            Имя:             s.contact_name || '',
            Email:           s.contact_email || '',
            Телефон:         s.contact_phone || '',
            Компания:        s.contact_company || '',
            Товары:          Array.isArray(s.interested_products) ? s.interested_products.join('; ') : '',
            CRM_заказ:       s.crm_order_id || '',
            Дата:            new Date(s.created_at).toLocaleString('ru-RU'),
        }));
        csv = toCSV(rows);
        filename = `leads-${period}d.csv`;
    } else if (type === 'proposals') {
        const { data } = await supabase
            .from('lead_proposals')
            .select('id, title, status, total_amount, discount_pct, sent_at, viewed_at, created_at, session_id')
            .gte('created_at', since)
            .order('created_at', { ascending: false });

        const rows = (data as any[] || []).map(p => ({
            ID:          p.id,
            Заголовок:   p.title,
            Статус:      p.status,
            Сумма_руб:   p.total_amount || 0,
            Скидка_пct:  p.discount_pct || 0,
            Отправлено:  p.sent_at ? new Date(p.sent_at).toLocaleString('ru-RU') : '',
            Просмотрено: p.viewed_at ? new Date(p.viewed_at).toLocaleString('ru-RU') : '',
            Создано:     new Date(p.created_at).toLocaleString('ru-RU'),
            Сессия_ID:   p.session_id || '',
        }));
        csv = toCSV(rows);
        filename = `proposals-${period}d.csv`;
    } else if (type === 'invoices') {
        const { data } = await supabase
            .from('lead_invoices')
            .select('id, invoice_number, title, status, total_amount, vat_pct, discount_pct, payer_name, payer_company, payer_inn, sent_at, paid_at, viewed_at, due_date, created_at, session_id')
            .gte('created_at', since)
            .order('created_at', { ascending: false });

        const rows = (data as any[] || []).map(i => ({
            Номер:         i.invoice_number,
            Заголовок:     i.title,
            Статус:        i.status,
            Сумма_руб:     i.total_amount || 0,
            НДС_пct:       i.vat_pct || 20,
            Скидка_пct:    i.discount_pct || 0,
            Плательщик:    i.payer_name || '',
            Организация:   i.payer_company || '',
            ИНН:           i.payer_inn || '',
            Срок_оплаты:   i.due_date || '',
            Отправлено:    i.sent_at ? new Date(i.sent_at).toLocaleString('ru-RU') : '',
            Оплачено:      i.paid_at ? new Date(i.paid_at).toLocaleString('ru-RU') : '',
            Просмотрено:   i.viewed_at ? new Date(i.viewed_at).toLocaleString('ru-RU') : '',
            Создано:       new Date(i.created_at).toLocaleString('ru-RU'),
        }));
        csv = toCSV(rows);
        filename = `invoices-${period}d.csv`;
    } else {
        return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
    }

    // UTF-8 BOM чтобы Excel открывал кириллицу
    const bom = '\uFEFF';
    return new NextResponse(bom + csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    });
}
