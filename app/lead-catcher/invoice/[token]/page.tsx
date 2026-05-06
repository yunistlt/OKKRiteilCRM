import { supabase } from '@/utils/supabase';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface InvoiceItem {
    name: string;
    description?: string;
    quantity: number;
    price: number;
    unit?: string;
}

async function getInvoice(token: string) {
    const { data, error } = await supabase
        .from('lead_invoices')
        .select('*')
        .eq('token', token)
        .single();
    if (error || !data) return null;
    return data;
}

function formatMoney(n: number) {
    return n.toLocaleString('ru-RU') + ' ₽';
}

export default async function InvoicePage({ params }: { params: { token: string } }) {
    const invoice = await getInvoice(params.token);
    if (!invoice) notFound();

    // Трекинг просмотра
    if (!invoice.viewed_at) {
        await supabase
            .from('lead_invoices')
            .update({ viewed_at: new Date().toISOString() })
            .eq('token', params.token);
    }

    const items: InvoiceItem[] = Array.isArray(invoice.items) ? invoice.items : [];
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const discountAmt = Math.round(subtotal * ((invoice.discount_pct || 0) / 100));
    const total = subtotal - discountAmt;
    const vatPct = invoice.vat_pct || 20;
    const vatAmt = Math.round(total * vatPct / (100 + vatPct));

    const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('ru-RU') : null;
    const createdAt = new Date(invoice.created_at).toLocaleDateString('ru-RU');

    // Реквизиты продавца (из env или заглушки)
    const seller = {
        name:    process.env.INVOICE_SELLER_NAME    || 'ООО «ЗМК»',
        inn:     process.env.INVOICE_SELLER_INN     || '—',
        kpp:     process.env.INVOICE_SELLER_KPP     || '—',
        bank:    process.env.INVOICE_SELLER_BANK    || '—',
        bik:     process.env.INVOICE_SELLER_BIK     || '—',
        ks:      process.env.INVOICE_SELLER_KS      || '—',
        rs:      process.env.INVOICE_SELLER_RS      || '—',
        address: process.env.INVOICE_SELLER_ADDRESS || '—',
    };

    const statusColors: Record<string, string> = {
        draft:             'bg-gray-100 text-gray-600',
        sent:              'bg-blue-100 text-blue-700',
        awaiting_payment:  'bg-yellow-100 text-yellow-700',
        paid:              'bg-green-100 text-green-700',
        cancelled:         'bg-red-100 text-red-700',
        overdue:           'bg-orange-100 text-orange-700',
    };
    const statusLabels: Record<string, string> = {
        draft:             'Черновик',
        sent:              'Отправлен',
        awaiting_payment:  'Ожидает оплаты',
        paid:              '✅ Оплачен',
        cancelled:         'Отменён',
        overdue:           'Просрочен',
    };

    const isPaid = invoice.status === 'paid';
    const isCancelled = invoice.status === 'cancelled';

    return (
        <div className="min-h-screen bg-gray-50 py-10 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Шапка */}
                <div className="bg-white rounded-2xl shadow-sm border p-8 mb-6">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                                    <span className="text-white font-black text-sm">З</span>
                                </div>
                                <span className="font-bold text-gray-900">ЗМК — Завод Металлоконструкций</span>
                            </div>
                            <p className="text-xs text-gray-400 ml-11">zmktlt.ru</p>
                        </div>
                        <span className={`text-xs px-3 py-1 rounded-full font-semibold ${statusColors[invoice.status] || 'bg-gray-100 text-gray-500'}`}>
                            {statusLabels[invoice.status] || invoice.status}
                        </span>
                    </div>

                    <div className="border-t pt-4">
                        <h1 className="text-xl font-black text-gray-900 mb-1">
                            Счёт № {invoice.invoice_number}
                        </h1>
                        <p className="text-sm font-medium text-gray-600 mb-3">{invoice.title}</p>
                        <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                            <span>Выставлен: {createdAt}</span>
                            {dueDate && (
                                <span className={invoice.status === 'overdue' ? 'text-orange-600 font-semibold' : ''}>
                                    Срок оплаты: <strong>{dueDate}</strong>
                                </span>
                            )}
                            {isPaid && invoice.paid_at && (
                                <span className="text-green-600 font-semibold">
                                    Оплачен: {new Date(invoice.paid_at).toLocaleDateString('ru-RU')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Плательщик */}
                {(invoice.payer_company || invoice.payer_name) && (
                    <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Плательщик</h3>
                        <div className="space-y-1.5 text-sm">
                            {invoice.payer_company && (
                                <div className="flex gap-3">
                                    <span className="text-gray-400 w-24 shrink-0">Организация</span>
                                    <span className="font-semibold text-gray-900">{invoice.payer_company}</span>
                                </div>
                            )}
                            {invoice.payer_name && (
                                <div className="flex gap-3">
                                    <span className="text-gray-400 w-24 shrink-0">Контакт</span>
                                    <span className="text-gray-700">{invoice.payer_name}</span>
                                </div>
                            )}
                            {invoice.payer_inn && (
                                <div className="flex gap-3">
                                    <span className="text-gray-400 w-24 shrink-0">ИНН / КПП</span>
                                    <span className="text-gray-700">{invoice.payer_inn}{invoice.payer_kpp ? ` / ${invoice.payer_kpp}` : ''}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Таблица позиций */}
                <div className="bg-white rounded-2xl shadow-sm border overflow-hidden mb-6">
                    <div className="bg-gray-900 px-6 py-4">
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider">Состав счёта</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b bg-gray-50">
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Наименование</th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Кол-во</th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Цена</th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Сумма</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item: InvoiceItem, idx: number) => (
                                    <tr key={idx} className={`border-b last:border-0 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                                        <td className="px-6 py-4 text-sm text-gray-400">{idx + 1}</td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{item.name}</div>
                                            {item.description && <div className="text-xs text-gray-400 mt-0.5">{item.description}</div>}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-right text-gray-700">
                                            {item.quantity} {item.unit || 'шт.'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-right text-gray-700">{formatMoney(item.price)}</td>
                                        <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900">{formatMoney(item.price * item.quantity)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="border-t px-6 py-4 bg-gray-50">
                        <div className="flex flex-col items-end gap-1">
                            <div className="flex justify-between w-60 text-sm text-gray-500">
                                <span>Подытог</span>
                                <span>{formatMoney(subtotal)}</span>
                            </div>
                            {(invoice.discount_pct || 0) > 0 && (
                                <div className="flex justify-between w-60 text-sm text-red-500">
                                    <span>Скидка {invoice.discount_pct}%</span>
                                    <span>−{formatMoney(discountAmt)}</span>
                                </div>
                            )}
                            <div className="flex justify-between w-60 text-sm text-gray-400">
                                <span>В т.ч. НДС {vatPct}%</span>
                                <span>{formatMoney(vatAmt)}</span>
                            </div>
                            <div className="flex justify-between w-60 bg-gray-900 text-white rounded-xl px-4 py-2 mt-1">
                                <span className="font-bold text-sm">Итого к оплате</span>
                                <span className="font-black text-emerald-400">{formatMoney(total)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Банковские реквизиты */}
                {!isCancelled && !isPaid && (
                    <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Реквизиты для оплаты</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                            {[
                                ['Получатель',      seller.name],
                                ['ИНН / КПП',       `${seller.inn} / ${seller.kpp}`],
                                ['Банк',            seller.bank],
                                ['БИК',             seller.bik],
                                ['Корр. счёт (к/с)', seller.ks],
                                ['Расч. счёт (р/с)', seller.rs],
                            ].map(([label, value], i) => (
                                <div key={i} className="flex gap-2">
                                    <span className="text-gray-400 min-w-[110px] shrink-0">{label}</span>
                                    <span className="font-semibold text-gray-900 break-all">{value}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
                            В назначении платежа укажите: <strong>Счёт № {invoice.invoice_number}</strong>
                        </div>
                    </div>
                )}

                {/* Оплачен */}
                {isPaid && (
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-6 text-center">
                        <div className="text-4xl mb-2">✅</div>
                        <p className="font-bold text-green-800 text-lg">Счёт оплачен</p>
                        {invoice.paid_at && (
                            <p className="text-sm text-green-600">{new Date(invoice.paid_at).toLocaleDateString('ru-RU')}</p>
                        )}
                    </div>
                )}

                {/* Кнопки */}
                <div className="flex flex-col sm:flex-row gap-3">
                    {invoice.pdf_url && (
                        <a
                            href={invoice.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 bg-gray-900 text-white text-center py-3 px-6 rounded-xl font-semibold text-sm hover:bg-gray-800 transition"
                        >
                            📄 Скачать PDF
                        </a>
                    )}
                    <a
                        href="https://zmktlt.ru"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 bg-emerald-500 text-white text-center py-3 px-6 rounded-xl font-semibold text-sm hover:bg-emerald-600 transition"
                    >
                        Перейти на сайт →
                    </a>
                </div>

                <p className="text-center text-xs text-gray-400 mt-6">
                    ЗМК • zmktlt.ru • Счёт № {invoice.invoice_number}
                    {dueDate ? ` • Срок оплаты: ${dueDate}` : ''}
                </p>
            </div>
        </div>
    );
}
