import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

function createTransporter() {
    return nodemailer.createTransport({
        host: 'smtp.yandex.ru',
        port: 465,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpUser || !smtpPass) return false;

    try {
        const transporter = createTransporter();
        await transporter.sendMail({ from: `"Елена (ЗМК)" <${smtpUser}>`, to, subject, html });
        return true;
    } catch (e) {
        console.error('[lead-reminders] sendEmail error:', e);
        return false;
    }
}

// ── Шаблон письма реактивации ─────────────────────────────────────────────
function buildReactivationEmail(products: string[]): string {
    const rows = products.length > 0
        ? products.map(p => `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">📦 ${p}</td></tr>`).join('')
        : '<tr><td style="padding:8px 12px;color:#94a3b8;">Товары не указаны</td></tr>';

    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Мы ещё здесь — ЗМК</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="background:#10b981;padding:28px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Елена (ЗМК)</p>
          <p style="margin:4px 0 0;font-size:13px;color:#d1fae5;">Продуктолог • В сети</p>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 16px;font-size:16px;color:#1e293b;line-height:1.5;">
            Здравствуйте!<br><br>
            Несколько дней назад вы интересовались оборудованием ЗМК. Мы всё ещё здесь и готовы помочь с подбором и расчётом.
          </p>
          ${products.length > 0 ? `
          <p style="margin:0 0 10px;font-size:14px;color:#64748b;">Вы просматривали:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <tbody>${rows}</tbody>
          </table>` : ''}
          <a href="https://zmktlt.ru" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:600;">
            Вернуться на сайт →
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
            Просто ответьте на это письмо, и я сразу займусь вашим запросом.<br><br>
            С уважением,<br><strong>Елена</strong><br>Продуктолог ЗМК
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Шаблон уведомления менеджеру ──────────────────────────────────────────
function buildManagerAlertEmail(type: 'abandoned_cart' | 'no_manager_reply', session: any): string {
    const title = type === 'abandoned_cart'
        ? '🛒 Горячий лид — смотрел товары, контакт не оставил'
        : '⏰ Клиент ждёт ответа уже > 4 часов';

    const products = (session.interested_products as string[] | null)?.join(', ') || '—';
    const adminUrl = `https://okk.zmksoft.com/okk/lead-catcher`;

    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="background:#1e293b;padding:28px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">OKK — Ловец Лидов</p>
          <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">${title}</p>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <tr style="background:#f8fafc;"><th colspan="2" style="padding:10px 12px;text-align:left;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Данные посетителя</th></tr>
            <tr><td style="padding:8px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;width:140px;">Никнейм</td><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #f1f5f9;">${session.nickname || 'Аноним'}</td></tr>
            <tr><td style="padding:8px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Город</td><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #f1f5f9;">${session.geo_city || '—'}</td></tr>
            <tr><td style="padding:8px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Сайт</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">${session.domain || '—'}</td></tr>
            <tr><td style="padding:8px 12px;color:#64748b;font-size:13px;">Товары</td><td style="padding:8px 12px;">${products}</td></tr>
          </table>
          <a href="${adminUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:600;">
            Открыть в Ловце Лидов →
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
    try {
        ensureAuthorized(req);

        const managerEmail = process.env.MANAGER_NOTIFICATION_EMAIL || process.env.SMTP_USER;
        const results = { abandoned_cart: 0, no_manager_reply: 0, reactivation: 0, errors: 0 };

        // ── Сценарий 1: Брошенные товары (нет контакта, > 24ч) ───────────────
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: abandonedSessions } = await supabase
            .from('widget_sessions')
            .select('id, nickname, domain, geo_city, interested_products, utm_source')
            .eq('has_contacts', false)
            .not('interested_products', 'is', null)
            .lt('created_at', cutoff24h)
            .limit(20);

        for (const session of abandonedSessions || []) {
            // Проверяем нет ли уже такого напоминания
            const { data: existing } = await supabase
                .from('lead_reminders')
                .select('id')
                .eq('session_id', session.id)
                .eq('type', 'abandoned_cart')
                .single();
            if (existing) continue;

            // Записываем напоминание
            const { error: insertErr } = await supabase.from('lead_reminders').insert({
                session_id: session.id,
                type: 'abandoned_cart',
                manager_email: managerEmail || null,
                status: 'pending',
            });
            if (insertErr) { results.errors++; continue; }

            // Отправляем уведомление менеджеру
            if (managerEmail) {
                const sent = await sendEmail(
                    managerEmail,
                    `🛒 Горячий лид — ${session.nickname || 'Аноним'} смотрел товары`,
                    buildManagerAlertEmail('abandoned_cart', session)
                );
                await supabase.from('lead_reminders').update({
                    status: sent ? 'sent' : 'failed',
                    sent_at: sent ? new Date().toISOString() : null,
                }).eq('session_id', session.id).eq('type', 'abandoned_cart');

                if (sent) results.abandoned_cart++;
            }
        }

        // ── Сценарий 2: Нет ответа менеджера > 4 часов ──────────────────────
        const cutoff4h = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

        // Ищем сессии, где последнее сообщение от user и оно > 4ч назад
        const { data: staleSessions } = await supabase
            .from('widget_sessions')
            .select('id, nickname, domain, geo_city, interested_products')
            .eq('is_human_takeover', false)
            .lt('updated_at', cutoff4h)
            .limit(20);

        for (const session of staleSessions || []) {
            const { data: existing } = await supabase
                .from('lead_reminders')
                .select('id')
                .eq('session_id', session.id)
                .eq('type', 'no_manager_reply')
                .single();
            if (existing) continue;

            // Проверяем что последнее сообщение именно от пользователя
            const { data: lastMsg } = await supabase
                .from('widget_messages')
                .select('role, created_at')
                .eq('session_id', session.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (!lastMsg || lastMsg.role !== 'user') continue;
            if (new Date(lastMsg.created_at).getTime() > Date.now() - 4 * 60 * 60 * 1000) continue;

            await supabase.from('lead_reminders').insert({
                session_id: session.id,
                type: 'no_manager_reply',
                manager_email: managerEmail || null,
                status: 'pending',
            });

            if (managerEmail) {
                const sent = await sendEmail(
                    managerEmail,
                    `⏰ Клиент ${session.nickname || 'Аноним'} ждёт ответа > 4 часов`,
                    buildManagerAlertEmail('no_manager_reply', session)
                );
                await supabase.from('lead_reminders').update({
                    status: sent ? 'sent' : 'failed',
                    sent_at: sent ? new Date().toISOString() : null,
                }).eq('session_id', session.id).eq('type', 'no_manager_reply');

                if (sent) results.no_manager_reply++;
            }
        }

        // ── Сценарий 3: Реактивация (лид > 7 дней без движения, есть email) ─
        const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data: coldSessions } = await supabase
            .from('widget_sessions')
            .select('id, nickname, domain, interested_products, contact_email')
            .eq('has_contacts', true)
            .not('contact_email', 'is', null)
            .lt('updated_at', cutoff7d)
            .limit(20);

        for (const session of (coldSessions || []) as any[]) {
            if (!session.contact_email) continue;

            const { data: existing } = await supabase
                .from('lead_reminders')
                .select('id')
                .eq('session_id', session.id)
                .eq('type', 'reactivation')
                .single();
            if (existing) continue;

            await supabase.from('lead_reminders').insert({
                session_id: session.id,
                type: 'reactivation',
                recipient_email: session.contact_email,
                status: 'pending',
            });

            const products = (session.interested_products as string[] | null) || [];
            const sent = await sendEmail(
                session.contact_email,
                'Мы всё ещё здесь — ЗМК',
                buildReactivationEmail(products)
            );

            await supabase.from('lead_reminders').update({
                status: sent ? 'sent' : 'failed',
                sent_at: sent ? new Date().toISOString() : null,
            }).eq('session_id', session.id).eq('type', 'reactivation');

            if (sent) results.reactivation++;
        }

        console.log('[lead-reminders] cron done:', results);
        return NextResponse.json({ ok: true, results });

    } catch (error: any) {
        const isUnauth = error.message === 'Unauthorized';
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: isUnauth ? 401 : 500 }
        );
    }
}
