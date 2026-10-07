'use client';

// Все письма компании одной лентой: входящие и исходящие. Почта у компании одна,
// и менеджеру нужно видеть переписку коллег — иначе не отличить дубль от нового
// клиента.
import { useCallback, useEffect, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import TextWithOrderLinks from '@/components/ui/TextWithOrderLinks';
import AttachmentList from '@/components/orders/AttachmentList';

/**
 * Ответить можно из заказа: письмо уходит с его номером в теме и ложится в
 * переписку заказа. Поэтому кнопка ведёт в карточку и сразу открывает ответ
 * на это письмо (просьба владельца 05.10.2026).
 */
function replyHref(mail: { orderNumber: string | null; partyEmail: string | null; subject: string | null }): string | null {
    if (!mail.orderNumber) return null;

    // Передаём адрес и тему, а не идентификатор письма: у списка писем и у
    // карточки заказа разные источники, и номера строк в них не совпадают.
    const params = new URLSearchParams({ order: mail.orderNumber });
    if (mail.partyEmail) params.set('replyTo', mail.partyEmail);
    if (mail.subject) params.set('replySubject', mail.subject);
    return `/orders?${params.toString()}`;
}

type Email = {
    id: string;
    direction: string;
    date: string | null;
    party: string | null;
    partyEmail: string | null;
    subject: string | null;
    body: string | null;
    typeLabel: string | null;
    orderNumber: string | null;
    attachments: boolean;
    /** Имена вложений: в ленте их видно и, если письмо по заказу, можно открыть. */
    attachmentList?: Array<{ name: string; size: number | null }>;
    emailId?: string | null;
    clientId: number | null;
    clientName: string | null;
    managerName: string | null;
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
    /**
     * Полный текст открытого письма. Список возит только первую строку: с
     * вёрсткой двести писем весили 6,2 МБ и раздел открывался секундами
     * (жалоба владельца 05.10.2026). Целиком письмо читают по одному — его и
     * догружаем по щелчку.
     */
    const [fullBody, setFullBody] = useState<{ id: string; body: string | null } | null>(null);

    useEffect(() => {
        if (!openId) { setFullBody(null); return; }
        let cancelled = false;
        void fetch(`/api/emails/body?id=${encodeURIComponent(openId)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (!cancelled) setFullBody({ id: openId, body: data?.body ?? null }); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [openId]);

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

            {/* Таблица, как в RetailCRM: тема, заказ, дата, клиент, тип,
                менеджер клиента и адрес. Тап по строке открывает письмо
                (просьба владельца 05.10.2026). */}
            <div className="overflow-x-auto border border-gray-200 bg-white">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                            <th className="px-3 py-2 font-semibold">Тема</th>
                            <th className="px-3 py-2 font-semibold">Заказ</th>
                            <th className="px-3 py-2 font-semibold whitespace-nowrap">Дата</th>
                            <th className="px-3 py-2 font-semibold">Клиент</th>
                            <th className="px-3 py-2 font-semibold">Тип</th>
                            <th className="px-3 py-2 font-semibold">Менеджер</th>
                            <th className="px-3 py-2 font-semibold">Отправитель</th>
                        </tr>
                    </thead>
                    <tbody>
                        {emails.map((mail) => (
                            <tr
                                key={mail.id}
                                onClick={() => setOpenId(mail.id)}
                                className="cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50"
                            >
                                <td className="px-3 py-2">
                                    <div className="flex items-start justify-between gap-2">
                                        {/* Номер заказа в теме — ссылка: закон
                                            проекта, номер кликабелен везде. */}
                                        <div className="font-semibold text-gray-900">
                                            <TextWithOrderLinks text={mail.subject || 'Без темы'} />
                                        </div>
                                        {replyHref(mail) && (
                                            <a
                                                href={replyHref(mail) as string}
                                                onClick={(e) => e.stopPropagation()}
                                                className="shrink-0 border border-blue-600 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                                            >
                                                Ответить
                                            </a>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {mail.body ? `${mail.body.slice(0, 120)}${mail.body.length > 120 ? '…' : ''}` : 'Текст письма не сохранён'}
                                    </div>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                    {mail.orderNumber ? <OrderNumberLink number={mail.orderNumber} /> : <span className="text-gray-400">—</span>}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(mail.date)}</td>
                                <td className="px-3 py-2">
                                    {mail.clientId ? (
                                        <a
                                            href={`/clients/${mail.clientId}`}
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-blue-700 hover:underline"
                                        >
                                            {mail.clientName}
                                        </a>
                                    ) : (
                                        <span className="text-gray-400">{mail.party || '—'}</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                    <span className={mail.direction === 'Входящее' ? 'text-green-700' : 'text-blue-700'}>
                                        {mail.direction}
                                    </span>
                                    {mail.typeLabel && <div className="text-xs text-gray-500">{mail.typeLabel}</div>}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-gray-700">{mail.managerName || '—'}</td>
                                <td className="px-3 py-2 text-gray-600">{mail.partyEmail || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Само письмо — окном поверх списка: читать его в строке таблицы
                невозможно. */}
            {openId && (() => {
                const mail = emails.find((m) => m.id === openId);
                if (!mail) return null;
                return (
                    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/30 p-6" onClick={() => setOpenId(null)}>
                        <div className="max-h-full w-full max-w-3xl overflow-auto border border-gray-300 bg-white" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
                                <div>
                                    <div className="font-semibold text-gray-900">
                                        <TextWithOrderLinks text={mail.subject || 'Без темы'} />
                                    </div>
                                    <div className="mt-1 text-xs text-gray-600">
                                        {mail.direction} · {formatDate(mail.date)} · {mail.partyEmail || '—'}
                                        {mail.managerName ? ` · менеджер: ${mail.managerName}` : ''}
                                    </div>
                                    {mail.orderNumber && (
                                        <div className="mt-1 text-xs">Заказ <OrderNumberLink number={mail.orderNumber} /></div>
                                    )}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {replyHref(mail) ? (
                                        <a
                                            href={replyHref(mail) as string}
                                            className="border border-blue-600 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                        >
                                            Ответить
                                        </a>
                                    ) : (
                                        <span className="text-[11px] text-gray-500">
                                            Письмо не привязано к заказу — ответить можно из его карточки
                                        </span>
                                    )}
                                    <button type="button" onClick={() => setOpenId(null)} className="border border-gray-300 px-3 py-1 text-xs text-gray-600">
                                        Закрыть
                                    </button>
                                </div>
                            </div>
                            <p className="whitespace-pre-line px-4 py-3 text-sm text-gray-800">
                                <TextWithOrderLinks
                                    text={
                                        (fullBody?.id === mail.id ? fullBody.body : null)
                                        || mail.body
                                        || 'Текст этого письма у нас не сохранён.'
                                    }
                                />
                            </p>

                            {/* Вложения письма: PDF и картинки открываются всплывающим
                                окном, остальное скачивается (решение владельца 05.10.2026).
                                Письмо без заказа — только имена: доступ к файлу проверяется
                                по заказу. */}
                            {mail.attachmentList?.length ? (
                                <div className="border-t border-gray-100 px-4 py-2">
                                    <AttachmentList
                                        files={mail.attachmentList}
                                        href={mail.orderNumber && mail.emailId
                                            ? (name: string) => `/api/orders/${encodeURIComponent(String(mail.orderNumber))}/files/download?emailId=${encodeURIComponent(String(mail.emailId))}&filename=${encodeURIComponent(name)}`
                                            : null}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
