import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { applyPaymentsListFilter, parsePaymentsListFilter } from '@/lib/payments/list-filter';
import {
  PAYMENT_CONFIDENCE_LABELS,
  PAYMENT_MATCH_METHOD_LABELS,
  PAYMENT_PROJECT_LABELS,
  PAYMENT_SOURCE_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/lib/payments/labels';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EXPORT_COLUMNS =
  'payment_date, amount_kopecks, currency, status, project, source, payer_name, payer_inn, ' +
  'recipient_name, recipient_inn, purpose, document_number, extracted_invoice_number, ' +
  'matched_order_number, match_method, match_confidence, retailcrm_payment_id, created_at';

const MAX_ROWS = 20000;

/** Дата платежа как дата (Excel сам покажет её в локальном формате), пустое — прочерком. */
function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/payments/export — выгрузка списка платежей в .xlsx по текущему фильтру
 * (вкладка + период), теми же правилами, что и `/api/payments/list`.
 * Файл открывается и в Excel, и в Google Таблицах.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const filter = parsePaymentsListFilter(searchParams);

    const { data, error } = await applyPaymentsListFilter(
      supabase
        .from('point_payments')
        .select(EXPORT_COLUMNS)
        .order('payment_date', { ascending: false })
        .limit(MAX_ROWS),
      filter,
    );
    if (error) throw error;
    const rows = (data || []) as any[];

    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const ws = wb.addWorksheet('Платежи');

    ws.columns = [
      { header: 'Дата', key: 'date', width: 12 },
      { header: 'Сумма, ₽', key: 'amount', width: 16 },
      { header: 'Статус', key: 'status', width: 20 },
      { header: 'Направление', key: 'project', width: 16 },
      { header: 'Банк', key: 'source', width: 10 },
      { header: 'Плательщик', key: 'payer', width: 38 },
      { header: 'ИНН плательщика', key: 'payerInn', width: 16 },
      { header: 'Получатель', key: 'recipient', width: 28 },
      { header: 'ИНН получателя', key: 'recipientInn', width: 16 },
      { header: 'Назначение', key: 'purpose', width: 60 },
      { header: 'Документ', key: 'document', width: 12 },
      { header: 'Номер счёта из назначения', key: 'invoice', width: 16 },
      { header: 'Заказ', key: 'order', width: 12 },
      { header: 'Как определён', key: 'method', width: 18 },
      { header: 'Уверенность', key: 'confidence', width: 14 },
      { header: 'Платёж в RetailCRM', key: 'crmPayment', width: 18 },
      { header: 'Загружен', key: 'created', width: 18 },
    ];

    rows.forEach((r) => {
      ws.addRow({
        date: toDate(r.payment_date),
        amount: (Number(r.amount_kopecks) || 0) / 100,
        status: PAYMENT_STATUS_LABELS[r.status] || r.status,
        project: r.project ? PAYMENT_PROJECT_LABELS[r.project] || r.project : '—',
        source: PAYMENT_SOURCE_LABELS[r.source] || r.source,
        payer: r.payer_name || '—',
        payerInn: r.payer_inn || '—',
        recipient: r.recipient_name || '—',
        recipientInn: r.recipient_inn || '—',
        purpose: r.purpose || '—',
        document: r.document_number || '—',
        invoice: r.extracted_invoice_number || '—',
        order: r.matched_order_number || '—',
        method: r.match_method ? PAYMENT_MATCH_METHOD_LABELS[r.match_method] || r.match_method : '—',
        confidence: r.match_confidence
          ? PAYMENT_CONFIDENCE_LABELS[r.match_confidence] || r.match_confidence
          : '—',
        crmPayment: r.retailcrm_payment_id || '—',
        created: toDate(r.created_at),
      });
    });

    // Итоговая строка — то же «итого», что видно на экране.
    const totalRub = rows.reduce((sum, r) => sum + (Number(r.amount_kopecks) || 0), 0) / 100;
    const total = ws.addRow({ date: `Итого: ${rows.length}`, amount: totalRub });
    total.font = { bold: true };

    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    ws.getColumn('amount').numFmt = '# ##0.00';
    ws.getColumn('date').numFmt = 'dd.mm.yyyy';
    ws.getColumn('created').numFmt = 'dd.mm.yyyy hh:mm';
    ws.getColumn('purpose').alignment = { wrapText: true, vertical: 'top' };

    const buffer = await wb.xlsx.writeBuffer();

    const periodPart = filter.dateFrom || filter.dateTo ? `_${filter.dateFrom || '…'}_${filter.dateTo || '…'}` : '';
    const tabPart = filter.review ? '_razbor' : filter.project || filter.status || 'vse';
    const filename = `payments_${tabPart}${periodPart}.xlsx`;

    return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
