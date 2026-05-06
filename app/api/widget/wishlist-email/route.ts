import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import nodemailer from 'nodemailer';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function createTransporter() {
    return nodemailer.createTransport({
        host: 'smtp.yandex.ru',
        port: 465,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,   // rop@zmktlt.ru
            pass: process.env.SMTP_PASS,   // пароль приложения Яндекс 360
        },
    });
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

function buildEmailHtml(products: string[]): string {
    const rows = products
        .map(p => `<tr><td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">📦 ${p}</td></tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Список просмотренных товаров ЗМК</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#10b981;padding:28px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Елена (ЗМК)</p>
            <p style="margin:4px 0 0;font-size:13px;color:#d1fae5;">Продуктолог • В сети</p>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 16px;font-size:16px;color:#1e293b;line-height:1.5;">
            Здравствуйте!<br><br>
            Вы просматривали эти товары на сайте ЗМК и попросили сохранить список, чтобы не потерять.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:10px 12px;text-align:left;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Товар</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <a href="https://zmktlt.ru" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:600;">
            Вернуться на сайт →
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
            Если у вас есть технические вопросы или нужен расчёт — просто ответьте на это письмо, я подберу подходящие модели.<br><br>
            С уважением,<br><strong>Елена</strong><br>Продуктолог ЗМК
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(req: Request) {
    const rateLimitResp = checkRateLimit(req, 'wishlist-email', { limit: 5, windowMs: 60_000 }, CORS_HEADERS);
    if (rateLimitResp) return rateLimitResp;

    try {
        const body = await req.json();
        const { visitorId, email, products } = body;

        // Honeypot
        if (body._hp && String(body._hp).length > 0) {
            return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
        }

        if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ error: 'Invalid email' }, { status: 400, headers: CORS_HEADERS });
        }
        if (!Array.isArray(products) || products.length === 0) {
            return NextResponse.json({ error: 'No products' }, { status: 400, headers: CORS_HEADERS });
        }
        // Sanitize inputs
        const safeEmail = email.trim().toLowerCase().substring(0, 320);
        const safeProducts: string[] = products.slice(0, 50).map((p: unknown) =>
            typeof p === 'string' ? p.replace(/[<>]/g, '').substring(0, 200) : ''
        ).filter(Boolean);

        // Fetch session id if available
        let sessionId: string | null = null;
        if (visitorId && typeof visitorId === 'string') {
            const { data: session } = await supabase
                .from('widget_sessions')
                .select('id')
                .eq('visitor_id', visitorId)
                .maybeSingle();
            sessionId = session?.id ?? null;
        }

        // Save the request to DB
        await supabase.from('widget_wishlist_requests').insert({
            visitor_id: visitorId ?? null,
            session_id: sessionId,
            email: safeEmail,
            products: safeProducts,
            status: 'pending',
        });

        // Передаём email в чат и помечаем сессию — Семён-Архивариус создаст лид в RetailCRM
        if (sessionId) {
            await Promise.all([
                // Записываем email в историю чата как сообщение пользователя — Семён его распознает
                supabase.from('widget_messages').insert({
                    session_id: sessionId,
                    role: 'user',
                    content: `Мой email для связи: ${safeEmail}`,
                }),
                // Флаг для lead-catcher cron — обработать эту сессию
                supabase.from('widget_sessions').update({ has_contacts: true }).eq('id', sessionId),
            ]);
        }

        // Send email via Yandex SMTP if credentials are configured
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        if (smtpUser && smtpPass) {
            const transporter = createTransporter();
            await transporter.sendMail({
                from: `"Елена (ЗМК)" <${smtpUser}>`,
                to: safeEmail,
                subject: 'Ваш список просмотренных товаров ЗМК',
                html: buildEmailHtml(safeProducts),
            });

            await supabase
                .from('widget_wishlist_requests')
                .update({ status: 'sent' })
                .eq('email', safeEmail)
                .eq('status', 'pending');
        }

        return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
    } catch (error: any) {
        console.error('[wishlist-email] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }
}
