/**
 * Карточка заказа для ЦехУспеха — ТОЛЬКО ПРОСМОТР.
 *
 * Открывается по подписанной ссылке, которую выдаёт сам ЦехУспех (решение владельца 04.10.2026):
 * учётки сотрудникам завода у нас не заводятся.
 *
 * Отдаём САМОСТОЯТЕЛЬНУЮ страницу, а не экран ОКК: обычная страница приложения приезжает вместе
 * с меню, шапкой и чатом консультанта, а смотрящему из цеха виден ровно его заказ и больше ничего.
 * Поэтому это обработчик, который сам собирает HTML, — ни ссылок в другие разделы, ни форм,
 * ни кнопок сохранения. Подпись и срок проверяются в lib/own-crm/tseh-view-link.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkViewLink } from '@/lib/own-crm/tseh-view-link';
import { loadOrderView, type OrderView } from '@/lib/own-crm/tseh-view-order';

export const dynamic = 'force-dynamic';

const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');
const dash = (s: unknown) => (s === null || s === undefined || s === '' ? '—' : esc(s));

const CSS = `
*{box-sizing:border-box}
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#222;background:#fff;margin:0}
.wrap{max-width:900px;margin:24px auto;padding:0 16px}
.kicker{font-size:12px;color:#777}
h1{font-size:22px;margin:4px 0 16px}
h1 .sub{font-size:14px;color:#777;font-weight:400}
.grid{display:grid;grid-template-columns:220px 1fr;gap:6px 16px;margin-bottom:24px}
.grid .k{color:#777}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
thead tr{background:#f6f6f6}
.num{text-align:right;white-space:nowrap}
.total{font-weight:600}
.note{margin-top:28px;font-size:12px;color:#999}
.msg{max-width:560px;margin:80px auto;padding:24px}
.msg p{color:#555}
@media (max-width:600px){.grid{grid-template-columns:1fr;gap:2px 0}.grid .k{margin-top:10px}}
`;

function page(title: string, body: string) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function denied(title: string, text: string, status: number) {
    return new NextResponse(page(title, `<div class="msg"><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`), {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

function render(o: OrderView) {
    const rows =
        o.items.length === 0
            ? '<tr><td colspan="4">—</td></tr>'
            : o.items
                  .map(
                      (it) =>
                          `<tr><td>${dash(it.name)}</td><td class="num">${it.quantity.toLocaleString('ru-RU')}</td>` +
                          `<td class="num">${money(it.price)}</td><td class="num">${money(it.sum)}</td></tr>`,
                  )
                  .join('');

    const field = (k: string, v: string) => `<div class="k">${k}</div><div>${v}</div>`;

    return page(
        `Заказ № ${o.number}`,
        `<div class="wrap">
  <div class="kicker">ОКК · просмотр заказа</div>
  <h1>Заказ № ${esc(o.number)}${o.tsehOrderNo ? ` <span class="sub">· в ЦехУспехе № ${esc(o.tsehOrderNo)}</span>` : ''}</h1>
  <div class="grid">
    ${field('Заказчик', dash(o.customer))}
    ${field('ИНН / КПП', dash([o.customerInn, o.customerKpp].filter(Boolean).join(' / ')))}
    ${field('Адрес', dash(o.customerAddress))}
    ${field('Менеджер', dash(o.managerName))}
    ${field('Статус', dash(o.status))}
    ${field('Срок изготовления', o.productionDays ? `${o.productionDays} раб. дн.` : '—')}
    ${field('Условия отгрузки', dash(o.shippingTerms))}
    ${field('Передан в производство', date(o.sentToProductionAt))}
  </div>
  <table>
    <thead><tr><th>Наименование</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="total" colspan="3">Итого</td><td class="num total">${money(o.total)}</td></tr></tfoot>
  </table>
  ${o.managerComment ? `<section style="margin-top:20px"><div class="k" style="color:#777">Комментарий менеджера</div><div style="white-space:pre-wrap">${esc(o.managerComment)}</div></section>` : ''}
  <p class="note">Страница только для просмотра. Чтобы изменить заказ, обратитесь к менеджеру${o.managerName ? ` (${esc(o.managerName)})` : ''}.</p>
</div>`,
    );
}

export async function GET(req: NextRequest, { params }: { params: { number: string } }) {
    const number = decodeURIComponent(params.number);
    const check = checkViewLink(number, req.nextUrl.searchParams.get('exp'), req.nextUrl.searchParams.get('sig'));

    if (!check.ok) {
        if (check.reason === 'expired') {
            return denied(
                'Ссылка устарела',
                'Ссылка на заказ действует 15 минут. Вернитесь в карточку заказа в ЦехУспехе и нажмите переход в ОКК ещё раз.',
                410,
            );
        }
        return denied('Ссылка не действует', 'Открыть заказ по этой ссылке нельзя. Перейдите из карточки заказа в ЦехУспехе.', 403);
    }

    const order = await loadOrderView(number);
    if (!order) return denied('Заказ не найден', `В ОКК нет заказа № ${number}.`, 404);

    return new NextResponse(render(order), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
