'use client';

import { uploadOrderFile } from '@/lib/orders/upload-order-file';

import { useCallback, useEffect, useState } from 'react';
import { openPickerOnClick } from '@/components/ui/openPickerOnClick';
import OrderMailPanel from '@/components/orders/OrderMailPanel';
import { orderFileHref } from '@/lib/orders/file-href';
import { fileKindLabel } from '@/lib/file-type';
import FilePreviewModal, { type PreviewFile } from '@/components/ui/FilePreviewModal';

export type PanelKind = 'history' | 'files' | 'tasks' | 'mail';

interface HistoryItem {
    field_label?: string;
    field?: string;
    old_value?: string;
    new_value?: string;
    old_status_code?: string | null;
    new_status_code?: string | null;
    occurred_at?: string;
    user_data?: { firstName?: string; lastName?: string };
}

export type StatusPalette = Record<string, { name: string; color: string | null }>;

interface OrderSidePanelProps {
    kind: PanelKind;
    orderNumber: string;
    history?: HistoryItem[];
    statusPalette?: StatusPalette;
    onClose: () => void;
    onTasksChanged?: (done: number, total: number) => void;
    onMailUnread?: (count: number) => void;
    /** Перечитать карточку — после того, как историю дотянули из RetailCRM. */
    onReload?: () => void;
    /** Открыть переписку заказа: по нажатию на источник файла. */
    onOpenMail?: (emailId?: string) => void;
}

const TITLES: Record<PanelKind, string> = {
    history: 'История заказа',
    files: 'Файлы',
    tasks: 'Задачи',
    mail: 'Переписка',
};

export default function OrderSidePanel({ kind, orderNumber, history, statusPalette, onClose, onTasksChanged, onMailUnread, onReload, onOpenMail }: OrderSidePanelProps) {
    return (
        <div className="border border-gray-300 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-900 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-white">{TITLES[kind]}</span>
                <button onClick={onClose} className="text-xs font-bold text-white hover:text-blue-300">Закрыть</button>
            </div>

            <div className={kind === 'mail' ? 'p-0' : 'max-h-[420px] overflow-y-auto p-3'}>
                {kind === 'history' && <HistoryList items={history || []} palette={statusPalette || {}} orderNumber={orderNumber} onReload={onReload} />}
                {kind === 'files' && <FilesList orderNumber={orderNumber} onOpenMail={onOpenMail} />}
                {kind === 'tasks' && <TasksList orderNumber={orderNumber} onChanged={onTasksChanged} />}
                {kind === 'mail' && <OrderMailPanel orderNumber={orderNumber} onUnread={onMailUnread} />}
            </div>
        </div>
    );
}

/**
 * История заказа — как в RetailCRM: две вкладки и таблица «параметр / было /
 * стало / кто / когда». Менеджеры читают историю там же и так же, и своя
 * выдумка тут только мешала бы (требование владельца 01.10.2026).
 */
function HistoryList({ items, palette, orderNumber, onReload }: {
    items: HistoryItem[];
    palette: StatusPalette;
    orderNumber: string;
    onReload?: () => void;
}) {
    const [tab, setTab] = useState<'status' | 'order'>('order');

    const statusItems = items.filter((h) => h.field === 'status');
    const shown = tab === 'status' ? statusItems : items;

    return (
        <div>
            <ImportFromRetailCrm orderNumber={orderNumber} onReload={onReload} />

            {!items.length ? (
                <p className="text-sm text-gray-500">Изменений по заказу пока не записано.</p>
            ) : (
            <>
            <div className="mb-2 flex gap-4 border-b border-gray-200">
                {([
                    ['status', `Изменения статуса (${statusItems.length})`],
                    ['order', `Изменения заказа (${items.length})`],
                ] as const).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`-mb-px border-b-2 px-1 pb-2 text-sm font-bold ${
                            tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {shown.length === 0 ? (
                <p className="py-3 text-sm text-gray-500">Здесь пока пусто.</p>
            ) : (
                <table className="w-full table-fixed text-left">
                    <thead>
                        <tr className="border-b border-gray-300 bg-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                            <th className="w-1/5 px-2 py-1.5">Изменённый параметр</th>
                            <th className="w-1/5 px-2 py-1.5">Старое значение</th>
                            <th className="w-1/5 px-2 py-1.5">Новое значение</th>
                            <th className="w-1/5 px-2 py-1.5">Кем изменено</th>
                            <th className="w-1/5 px-2 py-1.5">Время изменения</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((h, i) => (
                            <tr key={i} className="border-b border-gray-100 align-top">
                                <td className="px-2 py-2 text-[12px] font-semibold text-gray-900">{h.field_label || 'Изменение'}</td>
                                <td className="px-2 py-2 text-[12px] text-gray-700">
                                    <Value text={h.old_value} statusCode={h.old_status_code} palette={palette} />
                                </td>
                                <td className="px-2 py-2 text-[12px] text-gray-900">
                                    <Value text={h.new_value} statusCode={h.new_status_code} palette={palette} />
                                </td>
                                <td className="px-2 py-2 text-[12px] text-gray-700">
                                    {[h.user_data?.firstName, h.user_data?.lastName].filter(Boolean).join(' ') || 'Система'}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-[12px] text-gray-600">
                                    {h.occurred_at ? new Date(h.occurred_at).toLocaleString('ru-RU') : ''}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            </>
            )}
        </div>
    );
}

/**
 * Кнопка «Скачать историю из ритейла».
 *
 * Полная история переносилась к нам только с 01.01.2025 — у заказов старше
 * видны одни смены статуса. Массовую докачку владелец отменил (15.10.2026):
 * тянем по одному заказу, когда он понадобился. Скачивание ничего не затирает,
 * добавляются только недостающие записи, поэтому нажимать можно сколько угодно.
 */
function ImportFromRetailCrm({ orderNumber, onReload }: { orderNumber: string; onReload?: () => void }) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const run = async () => {
        setBusy(true);
        setNote(null);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/history-import`, { method: 'POST' });
            const data = await res.json();

            if (!res.ok) {
                setNote(data?.error || 'Не получилось скачать историю.');
                return;
            }

            if (data.added > 0) {
                setNote(`Добавлено записей: ${data.added}. Уже было: ${data.existed}.`);
                onReload?.();
            } else if (data.fetched === 0) {
                setNote('В RetailCRM истории по этому заказу нет.');
            } else {
                setNote(`Новых записей нет — все ${data.fetched} уже у нас.`);
            }
        } catch (e: any) {
            setNote(`Не получилось скачать историю: ${e?.message || 'неизвестная ошибка'}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-gray-200 pb-3">
            <button
                onClick={run}
                disabled={busy}
                className="bg-gray-900 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-black disabled:opacity-50"
            >
                {busy ? 'Скачиваю…' : 'Скачать историю из ритейла'}
            </button>
            {note && <span className="text-[12px] text-gray-700">{note}</span>}
        </div>
    );
}

/** Значение в истории: статус — цветной плашкой, остальное текстом. */
function Value({ text, statusCode, palette }: { text?: string; statusCode?: string | null; palette: StatusPalette }) {
    if (!text) {
        return <span className="text-gray-400">—</span>;
    }

    const status = statusCode ? palette[statusCode] : undefined;
    if (status) {
        return (
            <span
                className="inline-block px-2 py-0.5 text-[11px] font-bold"
                style={{ backgroundColor: status.color || '#eef2f7', color: readableOn(status.color || '#eef2f7') }}
            >
                {status.name}
            </span>
        );
    }

    return <span className="whitespace-pre-line break-words">{text}</span>;
}

/** Белый или почти чёрный поверх цвета статуса — по яркости фона. */
function readableOn(hex: string): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return '#111827';
    const value = parseInt(match[1], 16);
    const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
    return luminance > 0.6 ? '#111827' : '#ffffff';
}

function FilesList({ orderNumber, onOpenMail }: { orderNumber: string; onOpenMail?: (emailId?: string) => void }) {
    /** Какой файл сейчас смотрим во всплывающем окне. */
    const [preview, setPreview] = useState<PreviewFile | null>(null);
    const [files, setFiles] = useState<any[] | null>(null);
    // Приложить файл руками (просьба Евгении 02.10.2026: счёт выставлен в
    // RetailCRM, а нужен при заказе в ОКК).
    const [busy, setBusy] = useState(false);
    /** Поиск файла по всем заказам: паспорт изделия нужен чаще, чем файл заказа. */
    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [found, setFound] = useState<Array<{ id: number; orderNumber: string; name: string }> | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(() => {
        fetch(`/api/orders/${encodeURIComponent(orderNumber)}/files`)
            .then((r) => r.json())
            .then((d) => setFiles(d.files || []))
            .catch(() => setFiles([]));
    }, [orderNumber]);

    useEffect(() => { load(); }, [load]);

    /** Найти файл по названию во всех заказах. */
    const searchFiles = async () => {
        if (searchQuery.trim().length < 3) {
            setNote('Введите хотя бы три буквы названия');
            return;
        }

        setSearching(true);
        setNote(null);
        try {
            const res = await fetch(`/api/files/search?q=${encodeURIComponent(searchQuery.trim())}`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Поиск не отработал');
            setFound(payload.files ?? []);
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setSearching(false);
        }
    };

    /**
     * Взять найденный файл в этот заказ.
     *
     * Копируем только запись: сам файл уже лежит в хранилище, второй раз его
     * заливать незачем.
     */
    const attachFound = async (fileId: number) => {
        setBusy(true);
        setNote(null);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'copy', fileId }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось приложить файл');
            setNote(payload.message || 'Файл приложен к заказу');
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    /**
     * Забрать в заказ вложения его писем.
     *
     * У старых сделок счёт, КП и сертификаты остались только в письмах:
     * RetailCRM такие вложения в API не отдаёт, и перенос файлов их не увидел.
     * Ищем письма по нашему тегу темы и кладём вложения в файлы заказа.
     */
    const pullFromMail = async () => {
        setBusy(true);
        setNote('Смотрю почту по этому заказу…');
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/files/from-mail`, { method: 'POST' });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Файлы из почты забрать не удалось');
            setNote(payload.message || 'Готово');
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    const upload = async (file: File) => {
        setBusy(true);
        setNote(null);
        try {
            await uploadOrderFile(orderNumber, file);
            setNote(`Приложен: ${file.name}`);
            load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (fileId: number, name: string) => {
        // Файл не удаляется — уходит в архив и остаётся в разделе «Файлы»
        // (ЗАКОН владельца 12.10.2026).
        if (!confirm(`Отправить «${name}» в архив? Файл останется в системе, но уйдёт из списка заказа.`)) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/files/upload?fileId=${fileId}`, { method: 'DELETE' });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось отправить файл в архив');
            load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    const size = (bytes: number | null) => {
        if (!bytes) return '';
        return bytes > 1024 * 1024
            ? `${(bytes / 1024 / 1024).toFixed(1)} МБ`
            : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
    };

    return (
        <>
            <div className="mb-2 flex flex-wrap items-center gap-3">
                <label className={`cursor-pointer border border-gray-300 px-3 py-1.5 text-xs font-semibold ${busy ? 'text-gray-400' : 'text-gray-700 hover:bg-gray-100'}`}>
                    {busy ? 'Загружаю…' : 'Приложить файл'}
                    <input
                        type="file"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) upload(file);
                        }}
                    />
                </label>
                <button
                    onClick={() => void pullFromMail()}
                    disabled={busy}
                    className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
                    title="Вложения писем по этому заказу — счета, КП, ТЗ — лягут в файлы заказа"
                >
                    Забрать файлы из почты
                </button>
                <span className="text-[11px] text-gray-500">до 25 МБ; видно всем, кто работает с заказом</span>
                {note && <span className="text-[11px] text-gray-700">{note}</span>}
            </div>

            {/**
             * Поиск файла по всем заказам.
             *
             * Женя Матвеева 12.10.2026: «нужен паспорт на шкаф ШСО-22М, он точно
             * есть в заказах, но найти не могу». Паспорта на месте, просто
             * лежат каждый в своём заказе — и добраться до них можно было,
             * только помня номер.
             */}
            <div className="mb-3 border border-gray-200 bg-gray-50 p-2">
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void searchFiles(); }}
                        placeholder="Найти файл во всех заказах: «ШСО-22М», «паспорт»"
                        className="min-w-[14rem] flex-1 border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                        onClick={() => void searchFiles()}
                        disabled={searching}
                        className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
                    >
                        {searching ? 'Ищем…' : 'Найти'}
                    </button>
                </div>

                {found !== null && (
                    found.length ? (
                        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                            {found.map((file) => (
                                <li key={file.id} className="flex items-baseline justify-between gap-2 text-xs">
                                    <button
                                        onClick={() => setPreview({
                                            href: orderFileHref({ orderNumber: file.orderNumber, fileId: file.id }),
                                            name: file.name,
                                            origin: `Заказ ${file.orderNumber}`,
                                        })}
                                        className="truncate text-left font-semibold text-blue-700 hover:underline"
                                        title={file.name}
                                    >
                                        {file.name}
                                    </button>
                                    <span className="shrink-0 text-gray-500">
                                        заказ {file.orderNumber}
                                        {' · '}
                                        <button
                                            onClick={() => void attachFound(file.id)}
                                            disabled={busy}
                                            className="font-semibold text-blue-700 hover:underline disabled:text-gray-300"
                                        >
                                            приложить сюда
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-2 text-xs text-gray-500">Ничего не нашли — попробуйте часть названия изделия.</p>
                    )
                )}
            </div>

            {files === null ? (
                <p className="text-sm text-gray-500">Загружаем…</p>
            ) : !files.length ? (
                <p className="text-sm text-gray-500">
                    Файлов по этому заказу нет: вложения в письмах не приходили, руками ничего не прикладывали.
                </p>
            ) : (
                /**
                 * Таблица как в RetailCRM: формат, название с размером, источник
                 * и дата (требование владельца 28.10.2026 — «сделай 1 в 1»).
                 * Раньше строки шли списком в две линии, и глазу было не за что
                 * зацепиться: имя, вес и «приложил …» сливались в кашу.
                 */
                <table className="w-full table-fixed border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            <th className="w-[55%] py-1.5 pr-2 font-semibold">Название файла</th>
                            <th className="w-[25%] py-1.5 pr-2 font-semibold">Источник</th>
                            <th className="w-[20%] py-1.5 font-semibold">Дата</th>
                        </tr>
                    </thead>
                    <tbody>
                        {files.map((f, i) => {
                            const openable = f.source === 'manual' || (f.downloadable !== false && f.emailId);
                            const href = f.source === 'manual'
                                ? orderFileHref({ orderNumber, fileId: f.fileId })
                                : orderFileHref({ orderNumber, emailId: String(f.emailId), name: f.filename });

                            return (
                                <tr key={f.source === 'manual' ? `m${f.fileId}` : `e${i}`} className="group border-b border-gray-100 align-top">
                                    <td className="py-2 pr-2">
                                        <div className="flex items-baseline gap-2">
                                            <span className="shrink-0 border border-gray-300 px-1 py-0.5 text-[10px] font-bold text-gray-600">
                                                {fileKindLabel(f.filename, f.contentType)}
                                            </span>
                                            {openable ? (
                                                <button
                                                    onClick={() => setPreview({ href, name: f.filename, contentType: f.contentType, origin: f.origin })}
                                                    className="truncate text-left font-semibold text-blue-700 hover:underline"
                                                    title={f.filename}
                                                >
                                                    {f.filename}
                                                </button>
                                            ) : (
                                                <span className="truncate font-semibold text-gray-900" title={f.filename}>
                                                    {f.filename}
                                                </span>
                                            )}
                                            <span className="shrink-0 text-xs text-gray-500">{size(f.size)}</span>
                                        </div>
                                        {!openable && (
                                            <span className="text-[11px] text-amber-800">письма уже нет в ящике — открыть нельзя</span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-2 text-xs text-gray-600">
                                        {/* Источник открывает переписку заказа — там то самое
                                            письмо. У файлов, перенесённых из RetailCRM, письма
                                            у нас нет, и открывать нечего: остаётся подписью. */}
                                        {onOpenMail && (f.source === 'email' || f.mailId) ? (
                                            <button
                                                onClick={() => onOpenMail(f.source === 'email' ? String(f.emailId) : String(f.mailId))}
                                                className="block max-w-full truncate text-left font-semibold text-blue-700 hover:underline"
                                                title={`Открыть переписку: ${f.origin || ''}`}
                                            >
                                                {f.origin || 'Письмо'}
                                            </button>
                                        ) : (
                                            <span className="block truncate" title={f.origin || ''}>{f.origin || '—'}</span>
                                        )}
                                    </td>
                                    <td className="py-2 text-xs text-gray-600">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span>
                                                {f.receivedAt
                                                    ? `${new Date(f.receivedAt).toLocaleDateString('ru-RU')} ${new Date(f.receivedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                                                    : '—'}
                                            </span>
                                            {f.source === 'manual' && (
                                                <button
                                                    onClick={() => remove(f.fileId, f.filename)}
                                                    disabled={busy}
                                                    className="invisible shrink-0 font-semibold text-gray-500 hover:underline group-hover:visible disabled:text-gray-300"
                                                    title="Файл уйдёт в архив и останется в разделе «Файлы»"
                                                >
                                                    в архив
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
        </>
    );
}

function TasksList({ orderNumber, onChanged }: { orderNumber: string; onChanged?: (done: number, total: number) => void }) {
    const [tasks, setTasks] = useState<any[] | null>(null);
    const [title, setTitle] = useState('');
    const [due, setDue] = useState('');
    const [dueTime, setDueTime] = useState('');
    const [saving, setSaving] = useState(false);
    /** Какую задачу правим и что в её полях. */
    const [editing, setEditing] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDue, setEditDue] = useState('');
    const [editTime, setEditTime] = useState('');

    const load = useCallback(async () => {
        const res = await fetch(`/api/orders/${orderNumber}/tasks`);
        const data = await res.json();
        setTasks(data.tasks || []);
        onChanged?.(data.done ?? 0, data.total ?? 0);
    }, [orderNumber, onChanged]);

    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (!title.trim() || saving) return;
        setSaving(true);
        try {
            await fetch(`/api/orders/${orderNumber}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), dueDate: due || null, dueTime: dueTime || null }),
            });
            setTitle('');
            setDue('');
            setDueTime('');
            await load();
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (task: any) => {
        await fetch(`/api/orders/${orderNumber}/tasks`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: task.id, done: !task.done }),
        });
        await load();
    };

    /**
     * Правка задачи на месте.
     *
     * Елена Парфёнова 08.10.2026: забыла поставить время, задача сохранилась,
     * а поправить нельзя — только удалить и завести заново.
     */
    const startEdit = (task: any) => {
        setEditing(task.id);
        setEditTitle(task.title || '');
        setEditDue(task.due_date ? String(task.due_date).slice(0, 10) : '');
        setEditTime(task.due_time ? String(task.due_time).slice(0, 5) : '');
    };

    const saveEdit = async () => {
        if (!editing || !editTitle.trim() || saving) return;
        setSaving(true);
        try {
            await fetch(`/api/orders/${orderNumber}/tasks`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editing,
                    title: editTitle.trim(),
                    dueDate: editDue || null,
                    dueTime: editDue ? (editTime || null) : null,
                }),
            });
            setEditing(null);
            await load();
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            {/* Переносим по месту: на узкой панели четыре поля в одну строку
                сжимали текст задачи до нечитаемого. */}
            <div className="mb-3 flex flex-wrap gap-2">
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                    placeholder="Что нужно сделать"
                    className="min-w-[12rem] flex-1 border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                />
                <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    onClick={openPickerOnClick}
                    className="cursor-pointer border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                />
                {/* Время срока: «перезвонить в 14:30», а не «сегодня» (просьба
                    Ирины Гордеевой 05.10.2026). Без даты время смысла не имеет.

                    Список часов и минут по клику не открываем: Ирина Гордеева
                    28.10.2026 (доработка №62) — «поставьте, пожалуйста, чтобы
                    время можно было вносить вручную, а не выбирать из списка
                    часов и минут, неудобно». Клик теперь ставит курсор, время
                    набирается с клавиатуры; кому нужен список — есть иконка
                    часов в самом поле. У даты календарь оставляем: там выбор
                    мышью быстрее набора. */}
                <input
                    type="time"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    disabled={!due}
                    title={due ? 'Во сколько — можно набрать с клавиатуры' : 'Сначала выберите дату'}
                    className="border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none disabled:cursor-default disabled:bg-gray-100 disabled:text-gray-400"
                />
                <button
                    onClick={add}
                    disabled={!title.trim() || saving}
                    className="bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500"
                >
                    Добавить
                </button>
            </div>

            {tasks === null ? (
                <p className="text-sm text-gray-500">Загружаем…</p>
            ) : tasks.length === 0 ? (
                <p className="text-sm text-gray-500">Задач по заказу нет.</p>
            ) : (
                <ul className="divide-y divide-gray-100">
                    {tasks.map((t) => (
                        <li key={t.id} className="flex items-start gap-2 py-2">
                            <input
                                type="checkbox"
                                checked={t.done}
                                onChange={() => toggle(t)}
                                className="mt-1"
                            />
                            {editing === t.id ? (
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap gap-2">
                                        <input
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveEdit();
                                                if (e.key === 'Escape') setEditing(null);
                                            }}
                                            autoFocus
                                            className="min-w-[10rem] flex-1 border border-gray-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none"
                                        />
                                        <input
                                            type="date"
                                            value={editDue}
                                            onChange={(e) => setEditDue(e.target.value)}
                                            onClick={openPickerOnClick}
                                            className="cursor-pointer border border-gray-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none"
                                        />
                                        <input
                                            type="time"
                                            value={editTime}
                                            onChange={(e) => setEditTime(e.target.value)}
                                            disabled={!editDue}
                                            title={editDue ? 'Во сколько — можно набрать с клавиатуры' : 'Сначала выберите дату'}
                                            className="border border-gray-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none disabled:cursor-default disabled:bg-gray-100 disabled:text-gray-400"
                                        />
                                    </div>
                                    <div className="mt-1 flex gap-3">
                                        <button
                                            onClick={saveEdit}
                                            disabled={!editTitle.trim() || saving}
                                            className="text-[11px] font-semibold text-blue-700 hover:underline disabled:text-gray-300"
                                        >
                                            Сохранить
                                        </button>
                                        <button
                                            onClick={() => setEditing(null)}
                                            className="text-[11px] font-semibold text-gray-500 hover:underline"
                                        >
                                            Отмена
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="min-w-0 flex-1">
                                    <p className={`text-sm ${t.done ? 'text-gray-400 line-through' : 'font-medium text-gray-900'}`}>{t.title}</p>
                                    <p className="text-[11px] text-gray-500">
                                        {t.due_date
                                            ? `Срок: ${new Date(t.due_date).toLocaleDateString('ru-RU')}${t.due_time ? ` в ${String(t.due_time).slice(0, 5)}` : ''}`
                                            : 'Без срока'}
                                        {t.created_by ? ` · поставил ${t.created_by}` : ''}
                                        {' · '}
                                        <button onClick={() => startEdit(t)} className="font-semibold text-blue-700 hover:underline">
                                            изменить
                                        </button>
                                    </p>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
