import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Стартовые шаблоны: чтобы раздел не встречал пустым экраном и было с чего копировать.
// Подстановки — поля объекта заказа RetailCRM, они же лежат у нас в orders.raw_payload.

const ORDER_SHEET = `<div style="max-width:720px">
  <div style="display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px">
    <div><strong style="font-size:18px">Лист заказа №{{ order.number }}</strong></div>
    <div>{{ order.createdAt | date("d.m.Y") }}</div>
  </div>

  <table style="margin-top:12px">
    <tr><td style="padding:2px 12px 2px 0;color:#666">Клиент</td><td><strong>{{ order.customer.name or order.firstName }}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Телефон</td><td>{{ order.phone }}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Почта</td><td>{{ order.email }}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Доставка</td><td>{{ order.delivery.address.text }}</td></tr>
  </table>

  <table style="margin-top:16px;border-top:1px solid #111">
    <thead>
      <tr style="border-bottom:1px solid #111;text-align:left">
        <th style="padding:6px 4px">Товар</th>
        <th style="padding:6px 4px;width:70px">Кол-во</th>
        <th style="padding:6px 4px;width:110px;text-align:right">Цена</th>
        <th style="padding:6px 4px;width:120px;text-align:right">Сумма</th>
      </tr>
    </thead>
    <tbody>
      {% for item in order.items %}
      <tr style="border-bottom:1px solid #ddd">
        <td style="padding:6px 4px">{{ item.offer.name }}</td>
        <td style="padding:6px 4px">{{ item.quantity }}</td>
        <td style="padding:6px 4px;text-align:right">{{ item.initialPrice | money }}</td>
        <td style="padding:6px 4px;text-align:right">{{ (item.initialPrice * item.quantity) | money }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>

  <p style="margin-top:12px;text-align:right;font-size:15px">
    <strong>Итого: {{ order.totalSumm | money }} ₽</strong>
  </p>

  <p style="margin-top:24px;color:#666;font-size:11px">Менеджер: {{ order.managerComment }}</p>
</div>`;

const CONFIRMATION_BODY = `<p>Здравствуйте, {{ order.firstName }}!</p>
<p>Мы получили вашу заявку №{{ order.number }} от {{ order.createdAt | date("d.m.Y") }}. Состав:</p>
<ul>
{% for item in order.items %}  <li>{{ item.offer.name }} — {{ item.quantity }} шт.</li>
{% endfor %}</ul>
<p>Сумма заказа: {{ order.totalSumm | money }} ₽.</p>
<p>Если что-то нужно поправить — ответьте на это письмо, мы всё учтём.</p>`;

const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await client.connect();

await client.query(
    `INSERT INTO public.document_templates (code, name, body, sort_order)
     VALUES ($1, $2, $3, 10) ON CONFLICT (code) DO NOTHING`,
    ['order-sheet', 'Лист заказа', ORDER_SHEET]
);

await client.query(
    `INSERT INTO public.email_templates (code, name, subject, body, sort_order)
     VALUES ($1, $2, $3, $4, 10) ON CONFLICT (code) DO NOTHING`,
    ['order-confirmation', 'Подтверждение заявки', 'Ваша заявка №{{ order.number }} принята', CONFIRMATION_BODY]
);

const docs = await client.query('SELECT code, name FROM public.document_templates ORDER BY sort_order');
const mails = await client.query('SELECT code, name FROM public.email_templates ORDER BY sort_order');
console.log('Печатные формы:', docs.rows.map((r) => `${r.name} (${r.code})`).join(', ') || 'нет');
console.log('Шаблоны писем:', mails.rows.map((r) => `${r.name} (${r.code})`).join(', ') || 'нет');

await client.end();
