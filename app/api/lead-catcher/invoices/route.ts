import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { generateInvoicePDF, InvoiceData, ProposalItem } from '@/lib/pdf-generator';
import { logError } from '@/lib/error-monitor';

export const dynamic = 'force-dynamic';

// ── GET: список счётов по session_id ────────────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(req.url);
        const sessionId = searchParams.get('session_id');
        if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

        const { data, error } = await supabase
            .from('lead_invoices')
            .select('id, invoice_number, title, total_amount, status, token, pdf_url, due_date, sent_at, paid_at, created_at')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return NextResponse.json({ invoices: data });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// ── POST: создать счёт ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const managerSession = await getSession(req);
        if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json();
        const {
            session_id,
            proposal_id,
            title,
            items,
            discount_pct = 0,
            vat_pct = 20,
            due_date,
            payer_name,
            payer_company,
            payer_inn,
            payer_kpp,
            payer_address,
        } = body;

        if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'items required' }, { status: 400 });
        }

        // Автономный номер счёта: ЗМК-YYYY-NNNN
        const year = new Date().getFullYear();
        const { data: seqData } = await supabase.rpc('nextval', { seq_name: 'lead_invoice_seq' }).single() as any;
        const seqNum = seqData ?? Math.floor(Math.random() * 9000) + 1000;
        const invoiceNumber = `ЗМК-${year}-${String(seqNum).padStart(4, '0')}`;

        // Считаем итог
        const subtotal = (items as ProposalItem[]).reduce((s, i) => s + i.price * i.quantity, 0);
        const discountAmt = Math.round(subtotal * (discount_pct / 100));
        const totalAmount = subtotal - discountAmt;

        // Сохраняем счёт
        const { data: invoice, error: insertErr } = await supabase
            .from('lead_invoices')
            .insert({
                session_id,
                proposal_id: proposal_id || null,
                invoice_number: invoiceNumber,
                title: title || 'Счёт на оплату',
                items,
                discount_pct,
                vat_pct,
                total_amount: totalAmount,
                due_date: due_date || null,
                payer_name: payer_name || null,
                payer_company: payer_company || null,
                payer_inn: payer_inn || null,
                payer_kpp: payer_kpp || null,
                payer_address: payer_address || null,
                status: 'draft',
                created_by: managerSession.user.email,
            })
            .select('*')
            .single();

        if (insertErr) throw insertErr;

        // Генерируем PDF
        try {
            const pdfData: InvoiceData = {
                invoice_number: invoiceNumber,
                title: invoice.title,
                items,
                discount_pct,
                vat_pct,
                due_date: due_date || undefined,
                payer_name: payer_name || undefined,
                payer_company: payer_company || undefined,
                payer_inn: payer_inn || undefined,
                payer_kpp: payer_kpp || undefined,
                payer_address: payer_address || undefined,
            };

            const pdfBuffer = await generateInvoicePDF(pdfData);
            const fileName = `invoices/${invoice.token}.pdf`;

            const { error: uploadErr } = await supabase.storage
                .from('okk-assets')
                .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });

            if (!uploadErr) {
                const { data: urlData } = supabase.storage.from('okk-assets').getPublicUrl(fileName);
                await supabase.from('lead_invoices').update({ pdf_url: urlData.publicUrl }).eq('id', invoice.id);
                invoice.pdf_url = urlData.publicUrl;
            }
        } catch (pdfErr) {
            logError('invoices/pdf', pdfErr);
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com';
        const publicUrl = `${appUrl}/lead-catcher/invoice/${invoice.token}`;

        return NextResponse.json({ success: true, invoice: { ...invoice, public_url: publicUrl } });
    } catch (e: any) {
        logError('invoices/POST', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
