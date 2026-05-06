import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

function createTransporter() {
    return nodemailer.createTransport({
        host: 'smtp.yandex.ru', port: 465, secure: true,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
}

function buildInvoiceEmail(opts: {
    clientName?: string;
    invoiceNumber: string;
    title: string;
    totalAmount: number;
    publicUrl: string;
    pdfUrl?: string;
    dueDate?: string;
}): string {
    const { clientName, invoiceNumber, title, totalAmount, publicUrl, pdfUrl, dueDate } = opts;
    const greeting = clientName ? `Здравствуйте, ${clientName}!` : 'Здравствуйте!';
    const total = totalAmount.toLocaleString('ru-RU') + ' ₽';
    const dueText = dueDate
        ? `<p style="margin:0 0 12px;font-size:13px;color:#ef4444;">⏰ Срок оплаты: <strong>${new Date(dueDate).toLocaleDateString('ru-RU')}</strong></p>`
        : '';

    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Счёт № ${invoiceNumber}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="background:#0f172a;padding:28px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">ЗМК — Завод Металлоконструкций</p>
          <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Счёт № ${invoiceNumber}</p>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 12px;font-size:14px;color:#475569;line-height:1.7;">
            Выставлен счёт на оплату: <strong>${title}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 16px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Номер счёта</td>
              <td style="padding:10px 16px;font-size:13px;font-weight:700;border-bottom:1px solid #e2e8f0;text-align:right;">${invoiceNumber}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:13px;color:#64748b;">Сумма к оплате</td>
              <td style="padding:10px 16px;font-size:16px;font-weight:800;color:#0f172a;text-align:right;">${total}</td>
            </tr>
          </table>
          ${dueText}
          <a href="${publicUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;margin-bottom:12px;">
            Открыть счёт →
          </a>
          ${pdfUrl ? `<p style="margin:0 0 8px;font-size:13px;color:#64748b;">
            Скачать PDF: <a href="${pdfUrl}" style="color:#10b981;text-decoration:none;font-weight:600;">${invoiceNumber}.pdf</a>
          </p>` : ''}
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0;">
          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
            Оплата производится банковским переводом по реквизитам, указанным в счёте.<br>
            Если есть вопросы — просто ответьте на это письмо.<br><br>
            С уважением,<br><strong>Менеджер ЗМК</strong><br>zmktlt.ru
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const managerSession = await getSession(req);
        if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { data: invoice, error: fetchErr } = await supabase
            .from('lead_invoices')
            .select('*, widget_sessions(contact_email, contact_name, nickname, crm_order_id)')
            .eq('id', params.id)
            .single();

        if (fetchErr || !invoice) {
            return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
        }
        if (invoice.status === 'paid' || invoice.status === 'cancelled') {
            return NextResponse.json({ error: 'Cannot resend paid/cancelled invoice' }, { status: 400 });
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com';
        const publicUrl = `${appUrl}/lead-catcher/invoice/${invoice.token}`;

        const ws = invoice.widget_sessions as any;
        const clientEmail = ws?.contact_email;
        const clientName = ws?.contact_name || ws?.nickname;

        let emailSent = false;
        if (clientEmail) {
            const smtpUser = process.env.SMTP_USER;
            const smtpPass = process.env.SMTP_PASS;
            if (smtpUser && smtpPass) {
                try {
                    const transporter = createTransporter();
                    await transporter.sendMail({
                        from: `"Менеджер ЗМК" <${smtpUser}>`,
                        to: clientEmail,
                        subject: `Счёт на оплату № ${invoice.invoice_number} — ЗМК`,
                        html: buildInvoiceEmail({
                            clientName,
                            invoiceNumber: invoice.invoice_number,
                            title: invoice.title,
                            totalAmount: invoice.total_amount,
                            publicUrl,
                            pdfUrl: invoice.pdf_url || undefined,
                            dueDate: invoice.due_date || undefined,
                        }),
                    });
                    emailSent = true;
                } catch (e) {
                    console.error('[invoices/send] email error:', e);
                }
            }
        }

        await supabase
            .from('lead_invoices')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                crm_note: emailSent ? `Email отправлен на ${clientEmail}` : 'Email не отправлен (нет адреса)',
            })
            .eq('id', params.id);

        // Комментарий в RetailCRM
        if (ws?.crm_order_id) {
            try {
                const url = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
                const key = process.env.RETAILCRM_API_KEY;
                const site = process.env.RETAILCRM_SITE;
                if (url && key) {
                    const body = new URLSearchParams();
                    body.append('note', JSON.stringify({
                        text: `Счёт № ${invoice.invoice_number} выставлен на ${invoice.total_amount.toLocaleString('ru-RU')} ₽\nСсылка: ${publicUrl}${invoice.pdf_url ? `\nPDF: ${invoice.pdf_url}` : ''}`,
                    }));
                    body.append('order', JSON.stringify({ id: ws.crm_order_id }));
                    if (site) body.append('site', site);
                    await fetch(`${url.replace(/\/+$/, '')}/api/v5/orders/${ws.crm_order_id}/notes/create?apiKey=${key}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: body.toString(),
                    });
                }
            } catch (e) {
                console.error('[invoices/send] CRM note error:', e);
            }
        }

        return NextResponse.json({ success: true, email_sent: emailSent, public_url: publicUrl });
    } catch (e: any) {
        console.error('[invoices/send] error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
