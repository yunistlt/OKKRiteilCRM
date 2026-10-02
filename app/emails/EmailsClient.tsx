'use client';

// Все письма компании одной лентой: входящие и исходящие. Почта у компании одна,
// и менеджеру нужно видеть переписку коллег — иначе не отличить дубль от нового
// клиента.
import { useCallback, useEffect, useState } from 'react';

type Email = {
    id: string;
    direction: string;
    date: string | null;
    party: string | null;
    subject: string | null;
    body: string | null;
    typeLabel: string | null;
    orderNumber: string | null;
    attachments: boolean;
};

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function EmailsClient() {
    const [emails, setEmails] = useState<Email[]>([]);
    const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);
    const [direction, setDirection] = useState('all');
    const [type, setType] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ direction, limit: '200' });
            if (type) params.set('type', type);
            if (query) params.set('search', query);
            const res = await fetch(`/api/emails?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось получить письма');
            setEmails(data.emails || []);
            setTypes(data.types || []);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [direction, type, query]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-xl font-semibold text-gray-900">Письма</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Вся переписка компании: входящие с общего ящика и письма, отправленные из CRM.
                </p>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                {[
                    { code: 'all', label: 'Все' },
                    { code: 'in', label: 'Входящие' },
                    { code: 'out', label: 'Исходящие' },
                ].map((d) => (
                    <button
                        key={d.code}
                        type="button"
                        onClick={() => setDirection(d.code)}
                        className={`px-3 py-1.5 text-sm font-semibold ${
                            direction === d.code ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
                        }`}
                    >
                        {d.label}
                    </button>
                ))}
                <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="border border-gray-200 px-3 py-1.5 text-sm text-gray-700"
                >
                    <option value="">Любой тип письма</option>
                    {types.map((t) => (
                        <option key={t.code} value={t.code}>{t.label}</option>
                    ))}
                </select>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        setQuery(search.trim());
                    }}
                    className="flex items-center gap-2"
                >
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Тема или адрес"
                        className="w-56 border border-gray-200 px-3 py-1.5 text-sm"
                    />
                    <button type="submit" className="border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700">
                        Найти
                    </button>
                </form>
            </div>

            {error && <p className="mb-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {loading && <p className="text-sm text-gray-500">Загружаю…</p>}
            {!loading && emails.length === 0 && <p className="bg-white px-4 py-6 text-sm text-gray-500">Писем не найдено.</p>}

            <div className="divide-y divide-gray-100 border border-gray-200 bg-white">
                {emails.map((mail) => {
                    const open = openId === mail.id;
                    return (
                        <div key={mail.id} className="px-4 py-3">
                            <button type="button" onClick={() => setOpenId(open ? null : mail.id)} className="block w-full text-left">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="text-sm font-semibold text-gray-900">{mail.subject || 'Без темы'}</span>
                                    <span className="text-xs text-gray-500">{formatDate(mail.date)}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                                    <span className={mail.direction === 'Входящее' ? 'text-green-700' : 'text-blue-700'}>
                                        {mail.direction === 'Входящее' ? '↓' : '↑'} {mail.direction}
                                    </span>
                                    <span>{mail.party || '—'}</span>
                                    {mail.typeLabel && <span>{mail.typeLabel}</span>}
                                    {mail.orderNumber && <span>Заказ {mail.orderNumber}</span>}
                                    {mail.attachments && <span>с вложениями</span>}
                                </div>
                                {!open && (
                                    <p className="mt-1 text-xs text-gray-500">
                                        {mail.body ? `${mail.body.slice(0, 160)}${mail.body.length > 160 ? '…' : ''}` : 'Текст письма не сохранён'}
                                    </p>
                                )}
                            </button>
                            {open && (
                                <p className="mt-2 whitespace-pre-line border-t border-gray-100 pt-2 text-sm text-gray-800">
                                    {mail.body || 'Текст этого письма у нас не сохранён.'}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
