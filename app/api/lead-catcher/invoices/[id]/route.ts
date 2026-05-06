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

// ── PATCH: сменить статус (в т.ч. отметить оплаченным) ─────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const managerSession = await getSession(req);
        if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { status, manager_notes } = await req.json();
        const allowed = ['draft', 'sent', 'awaiting_payment', 'paid', 'cancelled', 'overdue'];
        if (status && !allowed.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const update: Record<string, any> = {};
        if (status) update.status = status;
        if (manager_notes !== undefined) update.manager_notes = manager_notes;
        if (status === 'paid' && !update.paid_at) update.paid_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('lead_invoices')
            .update(update)
            .eq('id', params.id)
            .select('id, invoice_number, status, paid_at')
            .single();

        if (error) throw error;
        return NextResponse.json({ success: true, invoice: data });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// ── POST /api/lead-catcher/invoices/[id]/send — отправить счёт клиенту ──────
// (маршрут send вынесен в отдельный файл, здесь только PATCH)
