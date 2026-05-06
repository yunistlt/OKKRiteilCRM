import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

// ── Транспорт SMTP ───────────────────────────────────────────────────────────
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

// ── Email-шаблон КП для клиента ──────────────────────────────────────────────
function buildProposalEmail(opts: {
    clientName?: string;
    title: string;
    publicUrl: string;
    pdfUrl?: string;
    validUntil?: string;
    managerName?: string;
}): string {
    const { clientName, title, publicUrl, pdfUrl, validUntil, managerName = 'Менеджер ЗМК' } = opts;
    const greeting = clientName ? `Здравствуйте, ${clientName}!` : 'Здравствуйте!';
    const validText = validUntil
        ? `<p style="margin:0 0 8px;font-size:13px;color:#ef4444;">⏳ Предложение действует до: <strong>${new Date(validUntil).toLocaleDateString('ru-RU')}</strong></p>`
        : '';

    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="background:#10b981;padding:28px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">ЗМК — Завод Металлоконструкций</p>
          <p style="margin:4px 0 0;font-size:13px;color:#d1fae5;">Коммерческое предложение</p>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7;">
            Мы подготовили для вас коммерческое предложение: <strong>${title}</strong>.
            Нажмите кнопку ниже, чтобы просмотреть его онлайн.
          </p>
          ${validText}
          <a href="${publicUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;margin-bottom:16px;">
            Открыть коммерческое предложение →
          </a>
          ${pdfUrl ? `
          <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
            Также можно <a href="${pdfUrl}" style="color:#10b981;text-decoration:none;font-weight:600;">скачать PDF-версию</a>.
          </p>` : ''}
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:24px 0;">
          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
            Если есть вопросы — просто ответьте на это письмо или позвоните нам.<br><br>
            С уважением,<br><strong>${managerName}</strong><br>ЗМК • zmktlt.ru
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Добавить комментарий к заказу в RetailCRM ─────────────────────────────────
async function addCrmOrderNote(orderId: number, text: string) {
    try {
        const url = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
        const key = process.env.RETAILCRM_API_KEY;
        const site = process.env.RETAILCRM_SITE;
        if (!url || !key) return;

        const body = new URLSearchParams();
        body.append('note', JSON.stringify({ text, managerId: null }));
        body.append('order', JSON.stringify({ id: orderId }));
        if (site) body.append('site', site);

        await fetch(`${url.replace(/\/+$/, '')}/api/v5/orders/${orderId}/notes/create?apiKey=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
    } catch (e) {
        console.error('[proposals/send] addCrmOrderNote error:', e);
    }
}

// ── POST /api/lead-catcher/proposals/[id]/send ───────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const managerSession = await getSession(req);
        if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const proposalId = params.id;

        // Получаем КП со всеми нужными данными
        const { data: proposal, error: fetchErr } = await supabase
            .from('lead_proposals')
            .select('*, widget_sessions(contact_email, contact_name, contact_company, nickname, crm_order_id)')
            .eq('id', proposalId)
            .single();

        if (fetchErr || !proposal) {
            return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
        }
        if (proposal.status === 'accepted' || proposal.status === 'rejected') {
            return NextResponse.json({ error: 'Cannot resend accepted/rejected proposal' }, { status: 400 });
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com';
        const publicUrl = `${appUrl}/lead-catcher/proposal/${proposal.token}`;

        const session = proposal.widget_sessions as any;
        const clientEmail = session?.contact_email;
        const clientName = session?.contact_name || session?.nickname;

        // Отправляем email клиенту (если есть email)
        let emailSent = false;
        if (clientEmail) {
            const smtpUser = process.env.SMTP_USER;
            const smtpPass = process.env.SMTP_PASS;
            if (smtpUser && smtpPass) {
                try {
                    const transporter = createTransporter();
                    await transporter.sendMail({
                        from: `"Елена (ЗМК)" <${smtpUser}>`,
                        to: clientEmail,
                        subject: `Коммерческое предложение: ${proposal.title}`,
                        html: buildProposalEmail({
                            clientName,
                            title: proposal.title,
                            publicUrl,
                            pdfUrl: proposal.pdf_url || undefined,
                            validUntil: proposal.valid_until || undefined,
                            managerName: managerSession.user.email,
                        }),
                    });
                    emailSent = true;
                } catch (e) {
                    console.error('[proposals/send] email error:', e);
                }
            }
        }

        // Обновляем статус КП → 'sent'
        const { error: updateErr } = await supabase
            .from('lead_proposals')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                crm_note: emailSent ? `Email отправлен на ${clientEmail}` : 'Email не отправлен (нет адреса)',
            })
            .eq('id', proposalId);

        if (updateErr) throw updateErr;

        // Добавляем комментарий к заказу в RetailCRM
        if (session?.crm_order_id) {
            const note = `КП отправлено: "${proposal.title}"\nСсылка: ${publicUrl}${proposal.pdf_url ? `\nPDF: ${proposal.pdf_url}` : ''}`;
            await addCrmOrderNote(Number(session.crm_order_id), note);
        }

        return NextResponse.json({
            success: true,
            email_sent: emailSent,
            public_url: publicUrl,
        });
    } catch (e: any) {
        console.error('[proposals/send] POST error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
