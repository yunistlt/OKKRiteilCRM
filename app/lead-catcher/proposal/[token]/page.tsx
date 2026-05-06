import { supabase } from '@/utils/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ProposalItem {
    name: string;
    description?: string;
    quantity: number;
    price: number;
    unit?: string;
}

async function getProposal(token: string) {
    const { data, error } = await supabase
        .from('lead_proposals')
        .select('*')
        .eq('token', token)
        .single();
    if (error || !data) return null;
    return data;
}

function formatMoney(n: number) {
    return n.toLocaleString('ru-RU') + ' ₽';
}

export default async function ProposalPage({ params }: { params: { token: string } }) {
    const proposal = await getProposal(params.token);
    if (!proposal) notFound();

    // Фиксируем просмотр (если ещё не открывали)
    if (!proposal.viewed_at) {
        await supabase
            .from('lead_proposals')
            .update({ viewed_at: new Date().toISOString(), status: proposal.status === 'sent' ? 'viewed' : proposal.status })
            .eq('token', params.token);
    }

    const items: ProposalItem[] = Array.isArray(proposal.items) ? proposal.items : [];
    const subtotal = items.reduce((s: number, i: ProposalItem) => s + i.price * i.quantity, 0);
    const discountAmt = Math.round(subtotal * ((proposal.discount_pct || 0) / 100));
    const total = subtotal - discountAmt;

    const validUntil = proposal.valid_until
        ? new Date(proposal.valid_until).toLocaleDateString('ru-RU')
        : null;

    const statusColors: Record<string, string> = {
        draft: 'bg-gray-100 text-gray-600',
        sent: 'bg-blue-100 text-blue-700',
        viewed: 'bg-yellow-100 text-yellow-700',
        accepted: 'bg-green-100 text-green-700',
        rejected: 'bg-red-100 text-red-700',
    };
    const statusLabels: Record<string, string> = {
        draft: 'Черновик',
        sent: 'Отправлено',
        viewed: 'Просмотрено',
        accepted: 'Принято',
        rejected: 'Отклонено',
    };

    return (
        <div className="min-h-screen bg-gray-50 py-10 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Шапка */}
                <div className="bg-white rounded-2xl shadow-sm border p-8 mb-6">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                                    <span className="text-white font-black text-sm">З</span>
                                </div>
                                <span className="font-bold text-gray-900">ЗМК — Завод Металлоконструкций</span>
                            </div>
                            <p className="text-xs text-gray-400 ml-11">zmktlt.ru</p>
                        </div>
                        <span className={`text-xs px-3 py-1 rounded-full font-semibold ${statusColors[proposal.status] || 'bg-gray-100 text-gray-500'}`}>
                            {statusLabels[proposal.status] || proposal.status}
                        </span>
                    </div>

                    <h1 className="text-2xl font-black text-gray-900 mb-2">{proposal.title}</h1>
                    <div className="flex gap-4 text-xs text-gray-400">
                        <span>Дата: {new Date(proposal.created_at).toLocaleDateString('ru-RU')}</span>
                        {validUntil && <span>Действует до: <strong className="text-gray-600">{validUntil}</strong></span>}
                    </div>

                    {proposal.intro && (
                        <div className="mt-6 p-4 bg-emerald-50 border-l-4 border-emerald-500 rounded-r-lg text-sm text-gray-700 leading-relaxed">
                            {proposal.intro}
                        </div>
                    )}
                </div>

                {/* Таблица позиций */}
                <div className="bg-white rounded-2xl shadow-sm border overflow-hidden mb-6">
                    <div className="bg-gray-900 px-6 py-4">
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider">Состав предложения</h2>
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
                                {items.map((item: ProposalItem, idx: number) => (
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

                    {/* Итого */}
                    <div className="border-t px-6 py-4 bg-gray-50">
                        <div className="flex flex-col items-end gap-1">
                            <div className="flex justify-between w-56 text-sm text-gray-500">
                                <span>Подытог</span>
                                <span>{formatMoney(subtotal)}</span>
                            </div>
                            {proposal.discount_pct > 0 && (
                                <div className="flex justify-between w-56 text-sm text-red-500">
                                    <span>Скидка {proposal.discount_pct}%</span>
                                    <span>−{formatMoney(discountAmt)}</span>
                                </div>
                            )}
                            <div className="flex justify-between w-56 bg-gray-900 text-white rounded-xl px-4 py-2 mt-1">
                                <span className="font-bold">Итого с НДС</span>
                                <span className="font-black text-emerald-400">{formatMoney(total)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Условия */}
                <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Условия предложения</h3>
                    <ul className="space-y-2 text-sm text-gray-600">
                        {[
                            'Цены указаны с учётом НДС',
                            'Срок изготовления уточняется при заказе',
                            'Доставка по России — по тарифам перевозчика',
                            'Бесплатная онлайн-настройка и запуск оборудования',
                            'Гарантия 12 месяцев с момента поставки',
                        ].map((c, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <span className="text-emerald-500 mt-0.5">•</span>
                                <span>{c}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Действия */}
                <div className="flex flex-col sm:flex-row gap-3">
                    {proposal.pdf_url && (
                        <a
                            href={proposal.pdf_url}
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
                    ЗМК • zmktlt.ru •{' '}
                    {validUntil ? `Предложение действительно до ${validUntil}` : 'Актуальность уточняйте у менеджера'}
                </p>
            </div>
        </div>
    );
}
