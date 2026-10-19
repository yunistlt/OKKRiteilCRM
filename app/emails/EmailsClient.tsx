'use client';

// Все письма компании одной лентой: входящие и исходящие. Почта у компании одна,
// и менеджеру нужно видеть переписку коллег — иначе не отличить дубль от нового
// клиента.
//
// Список сделан по золотому стандарту таблиц (golds/GOLD_UI_TABLES.md): состав,
// порядок и ширина колонок, порядок строк, масштаб и страницы внизу. Всё это
// запоминается за человеком на сервере и переезжает с ним на любой компьютер.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import TextWithOrderLinks from '@/components/ui/TextWithOrderLinks';
import AttachmentList from '@/components/orders/AttachmentList';
import ViewSettingsModal from '@/components/orders/ViewSettingsModal';
import { orderFileHref } from '@/lib/orders/file-href';
import { formatIntRu } from '@/lib/format';
import type { ViewItem } from '@/lib/orders-view';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';

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

type ColumnKey = 'subject' | 'order' | 'date' | 'manager' | 'client' | 'type' | 'party' | 'attachments';

const COLUMN_TITLES: Record<ColumnKey, string> = {
    subject: 'Тема',
    order: 'Заказ',
    date: 'Дата',
    manager: 'Менеджер',
    client: 'Клиент',
    type: 'Тип',
    party: 'Отправитель',
    attachments: 'Вложения',
};

/** Реестр для окна «Колонки»: что можно показать и что снять нельзя. */
const COLUMN_REGISTRY: ViewItem[] = [
    { key: 'subject', label: 'Тема', group: 'Основное', locked: true },
    { key: 'order', label: 'Заказ', group: 'Основное', locked: true },
    { key: 'date', label: 'Дата', group: 'Основное' },
    { key: 'manager', label: 'Менеджер', group: 'Кто ведёт' },
    { key: 'client', label: 'Клиент', group: 'Кто ведёт' },
    { key: 'type', label: 'Тип', group: 'Письмо' },
    { key: 'party', label: 'Отправитель', group: 'Письмо' },
    { key: 'attachments', label: 'Вложения', group: 'Письмо' },
];

const DEFAULT_COLUMNS: ColumnKey[] = ['subject', 'order', 'date', 'manager', 'client', 'type', 'party'];

/** По каким колонкам список правда умеет упорядочивать (закон §7.0). */
const SORTABLE: Partial<Record<ColumnKey, 'date' | 'subject' | 'party'>> = {
    date: 'date',
    subject: 'subject',
    party: 'party',
};

const VIEW_KEY = 'emails.layout';
const PAGE_SIZES = [20, 50, 100];
const ZOOM_MIN = 50;
const ZOOM_MAX = 130;
const ZOOM_STEP = 10;

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function EmailsClient() {
    const [emails, setEmails] = useState<Email[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [types, setTypes] = useState<Array<{ code: string; label: string }>>([]);
    const [direction, setDirection] = useState('all');
    /**
     * Чьи письма смотрим (ТЗ §9, этап 4):
     * «Вся почта» — как было, «Мои» — личная лента по моим заказам,
     * «Разбор» — входящие, которые ни к какому заказу не привязались.
     */
    const [scope, setScope] = useState<'all' | 'mine' | 'unlinked'>('all');
    const [stats, setStats] = useState<{ period: string; total: number; linked: number; share: number; unlinked: number } | null>(null);
    /** Номер заказа, который человек вписал письму в «Разборе». */
    const [linking, setLinking] = useState<Record<string, string>>({});
    const [linkNote, setLinkNote] = useState<string | null>(null);
    const [type, setType] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);

    // Раскладка таблицы — за человеком на сервере, закон §7.
    const [sort, setSort] = useState<{ key: 'date' | 'subject' | 'party'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
    const [widths, setWidths] = useState<Record<string, number>>({});
    const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
    const [columnsOpen, setColumnsOpen] = useState(false);
    const [zoom, setZoom] = useState(100);
    const [dragKey, setDragKey] = useState<ColumnKey | null>(null);
    const [overKey, setOverKey] = useState<ColumnKey | null>(null);
    /** Пока раскладка не пришла с сервера, не перетираем её своими значениями. */
    const layoutLoaded = useRef(false);

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

    useEffect(() => {
        fetch(`/api/settings/view?viewKey=${VIEW_KEY}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((payload) => {
                const saved = payload?.settings;
                if (saved) {
                    if (saved.widths && typeof saved.widths === 'object') setWidths(saved.widths);
                    // Порядок строк берём, только если по этой колонке список
                    // правда умеет упорядочивать: иначе остаёмся на дате.
                    if (['date', 'subject', 'party'].includes(saved.sort?.key)) {
                        setSort({ key: saved.sort.key, dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' });
                    }
                    if (PAGE_SIZES.includes(Number(saved.pageSize))) setPageSize(Number(saved.pageSize));
                    if (Array.isArray(saved.columns) && saved.columns.length) {
                        const known = saved.columns.filter((key: string): key is ColumnKey => key in COLUMN_TITLES);
                        if (known.length) setColumns(known);
                    }
                    if (Number.isFinite(Number(saved.zoom))) setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(saved.zoom))));
                }
                layoutLoaded.current = true;
            })
            .catch(() => { layoutLoaded.current = true; });
    }, []);

    type Layout = {
        widths?: Record<string, number>;
        sort?: { key: 'date' | 'subject' | 'party'; dir: 'asc' | 'desc' };
        pageSize?: number;
        columns?: ColumnKey[];
        zoom?: number;
    };

    const saveLayout = useCallback((next: Layout) => {
        if (!layoutLoaded.current) return;
        fetch('/api/settings/view', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                viewKey: VIEW_KEY,
                settings: {
                    widths: next.widths ?? widths,
                    sort: next.sort ?? sort,
                    pageSize: next.pageSize ?? pageSize,
                    columns: next.columns ?? columns,
                    zoom: next.zoom ?? zoom,
                },
            }),
        }).catch(() => undefined);
    }, [widths, sort, pageSize, columns, zoom]);

    const toggleSort = (key: ColumnKey) => {
        const field = SORTABLE[key];
        if (!field) return;
        const next: { key: 'date' | 'subject' | 'party'; dir: 'asc' | 'desc' } = sort.key === field
            ? { key: field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
            : { key: field, dir: 'asc' };
        setSort(next);
        setPage(1);
        saveLayout({ sort: next });
    };

    /** Тянем правый край заголовка — меняем ширину колонки (минимум 80 px). */
    const startResize = (event: React.MouseEvent, key: string) => {
        event.preventDefault();
        event.stopPropagation();
        const th = (event.currentTarget as HTMLElement).closest('th');
        if (!th) return;
        const startX = event.clientX;
        const startWidth = th.getBoundingClientRect().width;
        const move = (e: MouseEvent) => {
            const width = Math.max(80, Math.round(startWidth + e.clientX - startX));
            setWidths((current) => ({ ...current, [key]: width }));
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            setWidths((current) => { saveLayout({ widths: current }); return current; });
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    };

    /** Перетащили заголовок — колонка встала на место того, над которым отпустили. */
    const dropColumn = (target: ColumnKey) => {
        if (!dragKey || dragKey === target) { setDragKey(null); setOverKey(null); return; }
        const next = columns.filter((key) => key !== dragKey);
        next.splice(next.indexOf(target), 0, dragKey);
        setColumns(next);
        saveLayout({ columns: next });
        setDragKey(null);
        setOverKey(null);
    };

    const changeZoom = useCallback((value: number) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
        setZoom(next);
        saveLayout({ zoom: next });
    }, [saveLayout]);

    // Ctrl/Cmd + «=» / «−» / «0» — как в Google Таблицах; системный зум перехватываем.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.key === '=' || e.key === '+') { e.preventDefault(); changeZoom(zoom + ZOOM_STEP); }
            else if (e.key === '-' || e.key === '_') { e.preventDefault(); changeZoom(zoom - ZOOM_STEP); }
            else if (e.key === '0') { e.preventDefault(); changeZoom(100); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [zoom, changeZoom]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                direction,
                scope,
                page: String(page),
                pageSize: String(pageSize),
                sort: sort.key,
                dir: sort.dir,
            });
            if (type) params.set('type', type);
            if (query) params.set('search', query);
            const res = await fetch(`/api/emails?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось получить письма');
            setEmails(data.emails || []);
            setTypes(data.types || []);
            setStats(data.stats || null);
            setTotal(typeof data.total === 'number' ? data.total : null);
            setHasMore(Boolean(data.hasMore));
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [direction, type, query, scope, page, pageSize, sort]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Привязать письмо к заказу руками.
     *
     * Автоматика не всегда находит заказ: клиент снёс тему, написал с другого
     * адреса, переслал через коллегу. Тогда это работа человека, и она должна
     * быть видимой, а не теряться в общей ленте (ТЗ §3).
     */
    const linkToOrder = async (emailId: string) => {
        const orderNumber = String(linking[emailId] ?? '').trim();
        if (!orderNumber) {
            setLinkNote('Впишите номер заказа.');
            return;
        }

        setLinkNote(null);
        try {
            const res = await fetch('/api/emails/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailId, orderNumber }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось привязать письмо');

            setLinkNote(payload.message);
            setLinking((prev) => ({ ...prev, [emailId]: '' }));
            await load();
        } catch (e: any) {
            setLinkNote(e.message);
        }
    };

    const visible = useMemo(() => columns.filter((key) => key in COLUMN_TITLES), [columns]);
    const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
    const filtersOn = direction !== 'all' || Boolean(type || search || query);

    /** Содержимое одной ячейки строки. */
    const cell = (key: ColumnKey, mail: Email) => {
        if (key === 'subject') {
            return (
                <>
                    <div className="flex items-start justify-between gap-2">
                        {/* Номер заказа в теме — ссылка: закон проекта, номер
                            кликабелен везде. */}
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
                        {/* Начало письма длиннее: по одной строке нельзя было
                            понять, о чём письмо и кому оно (просьба Евгении
                            Матвеевой 19.10.2026). */}
                        {mail.body ? `${mail.body.slice(0, 300)}${mail.body.length > 300 ? '…' : ''}` : 'Текст письма не сохранён'}
                    </div>
                </>
            );
        }
        if (key === 'order') {
            if (mail.orderNumber) return <OrderNumberLink number={mail.orderNumber} />;
            if (scope === 'unlinked' && mail.emailId) {
                /* Разбор: человек говорит, чей это заказ. */
                return (
                    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                            value={linking[mail.emailId] ?? ''}
                            onChange={(e) => setLinking((prev) => ({ ...prev, [mail.emailId as string]: e.target.value }))}
                            placeholder="№ заказа"
                            className="w-24 border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                            type="button"
                            onClick={() => void linkToOrder(mail.emailId as string)}
                            className="border border-blue-600 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                        >
                            Привязать
                        </button>
                    </span>
                );
            }
            return <span className="text-gray-400">—</span>;
        }
        if (key === 'date') return formatDate(mail.date);
        if (key === 'manager') return mail.managerName || <span className="text-gray-400">—</span>;
        if (key === 'client') {
            return mail.clientId ? (
                <a
                    href={`/clients/${mail.clientId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-blue-700 hover:underline"
                >
                    {mail.clientName}
                </a>
            ) : (
                <span className="text-gray-400">{mail.party || '—'}</span>
            );
        }
        if (key === 'type') {
            return (
                <>
                    <span className={mail.direction === 'Входящее' ? 'text-green-700' : 'text-blue-700'}>
                        {mail.direction}
                    </span>
                    {mail.typeLabel && <div className="text-xs text-gray-500">{mail.typeLabel}</div>}
                </>
            );
        }
        if (key === 'attachments') {
            const count = mail.attachmentList?.length ?? 0;
            return count ? formatIntRu(count) : <span className="text-gray-400">—</span>;
        }
        return mail.partyEmail || <span className="text-gray-400">—</span>;
    };

    return (
        // Скроллится только таблица: шапка, вкладки, фильтры и страницы стоят
        // на месте (закон §1 золотого стандарта).
        <div className="flex h-full min-h-0 flex-1 flex-col p-6">
            <div className="mb-4">
                <h1 className="text-xl font-semibold text-gray-900">Письма</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Вся переписка компании: входящие с общего ящика и письма, отправленные из CRM.
                </p>
            </div>

            {/* Чьи письма: вся почта, мои или разбор непривязанных. */}
            <div className="mb-3 flex flex-wrap items-center gap-px bg-gray-200">
                {[
                    { code: 'all' as const, label: 'Вся почта' },
                    { code: 'mine' as const, label: 'Мои' },
                    { code: 'unlinked' as const, label: 'Разбор' },
                ].map((s) => (
                    <button
                        key={s.code}
                        type="button"
                        onClick={() => { setScope(s.code); setPage(1); }}
                        data-ui-audit={`emails-scope-${s.code}`}
                        className={`px-4 py-2 text-sm font-bold ${
                            scope === s.code ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {scope === 'mine' && (
                <p className="mb-3 bg-white px-3 py-2 text-sm text-gray-600">
                    Письма по заказам, которые ведёте вы. Пусто — значит по вашим заказам переписки нет.
                </p>
            )}

            {scope === 'unlinked' && (
                <div className="mb-3 bg-white px-3 py-2 text-sm text-gray-700">
                    <p>
                        Письма, которые не нашли свой заказ. Впишите номер — письмо встанет в переписку
                        заказа, и его вложения появятся в его файлах. Спам, служебные и предложения
                        поставщиков сюда не попадают — их видно во «Всей почте» по типу письма.
                    </p>
                    {stats && (
                        <p className="mt-1 text-gray-500">
                            Сами привязались {stats.share}% писем {stats.period}: {formatIntRu(stats.linked)} из{' '}
                            {formatIntRu(stats.total)}. Ждут разбора: {formatIntRu(stats.unlinked)}.
                        </p>
                    )}
                    {linkNote && <p className="mt-1 font-semibold text-blue-800">{linkNote}</p>}
                </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
                {[
                    { code: 'all', label: 'Все' },
                    { code: 'in', label: 'Входящие' },
                    { code: 'out', label: 'Исходящие' },
                ].map((d) => (
                    <button
                        key={d.code}
                        type="button"
                        onClick={() => { setDirection(d.code); setPage(1); }}
                        className={`px-3 py-1.5 text-sm font-semibold ${
                            direction === d.code ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700'
                        }`}
                    >
                        {d.label}
                    </button>
                ))}
                <select
                    value={type}
                    onChange={(e) => { setType(e.target.value); setPage(1); }}
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
                        setPage(1);
                    }}
                    className="flex items-center gap-2"
                >
                    {/* Крестик внутри поля: очистить поиск одним нажатием, не
                        выделяя набранное (просьба Елены Парфёновой 14.10.2026).
                        Esc делает то же — так привычнее тем, кто с клавиатуры. */}
                    <div className="relative">
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape' && search) {
                                    e.preventDefault();
                                    setSearch('');
                                    setQuery('');
                                    setPage(1);
                                }
                            }}
                            placeholder="Тема или адрес"
                            className={`w-56 border border-gray-200 py-1.5 pl-3 text-sm ${search ? 'pr-7' : 'pr-3'}`}
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => { setSearch(''); setQuery(''); setPage(1); }}
                                title="Очистить поиск"
                                aria-label="Очистить поиск"
                                className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 text-base leading-none text-gray-400 hover:text-gray-700"
                            >
                                ×
                            </button>
                        )}
                    </div>
                    <button type="submit" className="border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700">
                        Найти
                    </button>
                </form>
                {/* Снять весь отбор одним нажатием — требование золотого
                    стандарта таблиц (§5, решение владельца 14.10.2026).
                    Появляется, только когда есть что снимать. */}
                <ClearFiltersButton
                    active={filtersOn}
                    onClear={() => { setDirection('all'); setType(''); setSearch(''); setQuery(''); setPage(1); }}
                    className="py-1.5 text-sm"
                />

                <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                    {total !== null && <span>{filtersOn ? 'найдено' : 'всего'} {formatIntRu(total)}</span>}
                    <button
                        type="button"
                        onClick={() => setColumnsOpen(true)}
                        className="border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        Колонки
                    </button>
                    {/* Масштаб таблицы — золото §6. */}
                    <span className="flex items-center border border-gray-300">
                        <button type="button" onClick={() => changeZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} className="px-2 py-1 font-semibold hover:bg-gray-200 disabled:text-gray-300">−</button>
                        <button type="button" onClick={() => changeZoom(100)} className="px-1 py-1 tabular-nums" title="Вернуть 100%">{zoom}%</button>
                        <button type="button" onClick={() => changeZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} className="px-2 py-1 font-semibold hover:bg-gray-200 disabled:text-gray-300">+</button>
                    </span>
                </span>
            </div>

            {error && <p className="mb-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            {/* Таблица, как в RetailCRM: тема, заказ, дата, клиент, тип,
                менеджер клиента и адрес. Тап по строке открывает письмо
                (просьба владельца 05.10.2026). */}
            <div className="min-h-0 flex-1 overflow-auto border border-gray-200 bg-white">
                {/* Масштаб вешаем на саму таблицу: иначе ломается прилипшая шапка. */}
                <table className="min-w-full text-sm" style={{ zoom: `${zoom}%` }}>
                    <thead className="sticky top-0 z-10 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <tr>
                            {visible.map((key) => (
                                <th
                                    key={key}
                                    draggable
                                    onDragStart={() => setDragKey(key)}
                                    onDragOver={(e) => { e.preventDefault(); setOverKey(key); }}
                                    onDrop={() => dropColumn(key)}
                                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                                    className={`relative cursor-move border-b border-gray-200 px-3 py-2 align-top font-semibold ${overKey === key && dragKey && dragKey !== key ? 'border-l-2 border-l-blue-500' : ''}`}
                                    style={widths[key] ? { width: widths[key], minWidth: widths[key] } : undefined}
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggleSort(key)}
                                        disabled={!SORTABLE[key]}
                                        className="flex min-w-0 items-center gap-1 text-left uppercase hover:text-gray-900 disabled:cursor-default"
                                        title={SORTABLE[key] ? 'Упорядочить по этой колонке' : 'По этой колонке список не упорядочивается'}
                                    >
                                        <span className="min-w-0 truncate">{COLUMN_TITLES[key]}</span>
                                        {SORTABLE[key] && (
                                            <span className="shrink-0 text-gray-400">
                                                {sort.key === SORTABLE[key] ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                                            </span>
                                        )}
                                    </button>
                                    {/* Ширину тянут за правый край заголовка — закон §7.0. */}
                                    <span
                                        onMouseDown={(e) => startResize(e, key)}
                                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-blue-400"
                                    />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={visible.length} className="px-3 py-6 text-center text-sm text-gray-500">Загружаю…</td></tr>
                        )}
                        {!loading && emails.length === 0 && (
                            <tr><td colSpan={visible.length} className="px-3 py-6 text-center text-sm text-gray-500">Писем не найдено.</td></tr>
                        )}
                        {!loading && emails.map((mail, index) => (
                            <tr
                                key={mail.id}
                                onClick={() => setOpenId(mail.id)}
                                className={`cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50 ${index % 2 ? 'bg-gray-50' : ''}`}
                            >
                                {visible.map((key) => (
                                    <td
                                        key={key}
                                        className={`px-3 py-2 ${key === 'date' || key === 'manager' || key === 'order' ? 'whitespace-nowrap' : ''} ${key === 'party' ? 'break-all' : ''} ${key === 'attachments' ? 'text-right' : ''} ${key === 'subject' ? '' : 'text-gray-600'}`}
                                    >
                                        {cell(key, mail)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Страницы внизу — золото §6: размер страницы и переход по ним. */}
            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 text-xs text-gray-600">
                <div className="flex items-center gap-2">
                    <span>Строк на странице</span>
                    {PAGE_SIZES.map((size) => (
                        <button
                            key={size}
                            type="button"
                            onClick={() => { setPageSize(size); setPage(1); saveLayout({ pageSize: size }); }}
                            className={`px-2 py-1 font-semibold ${pageSize === size ? 'bg-gray-900 text-white' : 'hover:bg-gray-200'}`}
                        >
                            {size}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-1 font-semibold hover:bg-gray-200 disabled:text-gray-300"
                    >
                        ← Назад
                    </button>
                    <span>
                        {pages === null
                            ? `страница ${formatIntRu(page)}`
                            : `страница ${formatIntRu(page)} из ${formatIntRu(pages)}`}
                    </span>
                    <button
                        type="button"
                        disabled={pages === null ? !hasMore : page >= pages}
                        onClick={() => setPage((p) => p + 1)}
                        className="px-2 py-1 font-semibold hover:bg-gray-200 disabled:text-gray-300"
                    >
                        Вперёд →
                    </button>
                </div>
            </div>

            {columnsOpen && (
                <ViewSettingsModal
                    title="Колонки"
                    registry={COLUMN_REGISTRY}
                    selected={columns}
                    defaults={DEFAULT_COLUMNS}
                    onSave={(next) => {
                        const known = next.filter((key): key is ColumnKey => key in COLUMN_TITLES);
                        setColumns(known);
                        saveLayout({ columns: known });
                        setColumnsOpen(false);
                    }}
                    onResetLayout={() => {
                        const base = { key: 'date' as const, dir: 'desc' as const };
                        setSort(base);
                        setWidths({});
                        setColumns(DEFAULT_COLUMNS);
                        setZoom(100);
                        saveLayout({ sort: base, widths: {}, columns: DEFAULT_COLUMNS, zoom: 100 });
                    }}
                    onClose={() => setColumnsOpen(false)}
                />
            )}

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
                                            ? (name: string) => orderFileHref({
                                                orderNumber: String(mail.orderNumber),
                                                emailId: String(mail.emailId),
                                                name,
                                            })
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
