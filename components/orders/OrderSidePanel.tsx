'use client';

import { useCallback, useEffect, useState } from 'react';

export type PanelKind = 'history' | 'files' | 'tasks';

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
}

const TITLES: Record<PanelKind, string> = {
    history: 'История заказа',
    files: 'Файлы',
    tasks: 'Задачи',
};

export default function OrderSidePanel({ kind, orderNumber, history, statusPalette, onClose, onTasksChanged }: OrderSidePanelProps) {
    return (
        <div className="border border-gray-300 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-900 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-white">{TITLES[kind]}</span>
                <button onClick={onClose} className="text-xs font-bold text-white hover:text-blue-300">Закрыть</button>
            </div>

            <div className="max-h-[420px] overflow-y-auto p-3">
                {kind === 'history' && <HistoryList items={history || []} palette={statusPalette || {}} />}
                {kind === 'files' && <FilesList orderNumber={orderNumber} />}
                {kind === 'tasks' && <TasksList orderNumber={orderNumber} onChanged={onTasksChanged} />}
            </div>
        </div>
    );
}

/**
 * История заказа — как в RetailCRM: две вкладки и таблица «параметр / было /
 * стало / кто / когда». Менеджеры читают историю там же и так же, и своя
 * выдумка тут только мешала бы (требование владельца 01.10.2026).
 */
function HistoryList({ items, palette }: { items: HistoryItem[]; palette: StatusPalette }) {
    const [tab, setTab] = useState<'status' | 'order'>('order');

    if (!items.length) {
        return <p className="text-sm text-gray-500">Изменений по заказу пока не записано.</p>;
    }

    const statusItems = items.filter((h) => h.field === 'status');
    const shown = tab === 'status' ? statusItems : items;

    return (
        <div>
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

function FilesList({ orderNumber }: { orderNumber: string }) {
    const [files, setFiles] = useState<any[] | null>(null);

    useEffect(() => {
        fetch(`/api/orders/${orderNumber}/files`)
            .then((r) => r.json())
            .then((d) => setFiles(d.files || []))
            .catch(() => setFiles([]));
    }, [orderNumber]);

    if (files === null) return <p className="text-sm text-gray-500">Загружаем…</p>;

    if (!files.length) {
        return <p className="text-sm text-gray-500">С письмами по этому заказу вложений не приходило.</p>;
    }

    const size = (bytes: number | null) => {
        if (!bytes) return '';
        return bytes > 1024 * 1024
            ? `${(bytes / 1024 / 1024).toFixed(1)} МБ`
            : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
    };

    return (
        <>
            <ul className="divide-y divide-gray-100">
                {files.map((f, i) => (
                    <li key={i} className="py-2">
                        {/* Файл открывается: при первом нажатии он докачивается из
                            письма и дальше отдаётся из нашего хранилища
                            (требование владельца 02.10.2026). */}
                        {f.downloadable !== false && f.emailId ? (
                            <a
                                href={`/api/orders/${orderNumber}/files/download?emailId=${encodeURIComponent(String(f.emailId))}&name=${encodeURIComponent(f.filename)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-bold text-blue-700 hover:underline"
                            >
                                {f.filename}
                            </a>
                        ) : (
                            <p className="text-sm font-bold text-gray-900">
                                {f.filename}
                                <span className="ml-2 text-[11px] font-normal text-amber-800">
                                    письма уже нет в ящике — открыть нельзя
                                </span>
                            </p>
                        )}
                        <p className="text-[11px] text-gray-500">
                            {size(f.size)}
                            {f.fromName || f.fromEmail ? ` · от ${f.fromName || f.fromEmail}` : ''}
                            {f.receivedAt ? ` · ${new Date(f.receivedAt).toLocaleDateString('ru-RU')}` : ''}
                        </p>
                    </li>
                ))}
            </ul>
        </>
    );
}

function TasksList({ orderNumber, onChanged }: { orderNumber: string; onChanged?: (done: number, total: number) => void }) {
    const [tasks, setTasks] = useState<any[] | null>(null);
    const [title, setTitle] = useState('');
    const [due, setDue] = useState('');
    const [saving, setSaving] = useState(false);

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
                body: JSON.stringify({ title: title.trim(), dueDate: due || null }),
            });
            setTitle('');
            setDue('');
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

    return (
        <>
            <div className="mb-3 flex gap-2">
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                    placeholder="Что нужно сделать"
                    className="flex-1 border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                />
                <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
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
                            <div className="min-w-0 flex-1">
                                <p className={`text-sm ${t.done ? 'text-gray-400 line-through' : 'font-medium text-gray-900'}`}>{t.title}</p>
                                <p className="text-[11px] text-gray-500">
                                    {t.due_date ? `Срок: ${new Date(t.due_date).toLocaleDateString('ru-RU')}` : 'Без срока'}
                                    {t.created_by ? ` · поставил ${t.created_by}` : ''}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
