'use client';

import { useCallback, useEffect, useState } from 'react';

export type PanelKind = 'history' | 'files' | 'tasks';

interface HistoryItem {
    field_label?: string;
    field?: string;
    old_value?: string;
    new_value?: string;
    occurred_at?: string;
    user_data?: { firstName?: string; lastName?: string };
}

interface OrderSidePanelProps {
    kind: PanelKind;
    orderNumber: string;
    history?: HistoryItem[];
    onClose: () => void;
    onTasksChanged?: (done: number, total: number) => void;
}

const TITLES: Record<PanelKind, string> = {
    history: 'История заказа',
    files: 'Файлы',
    tasks: 'Задачи',
};

export default function OrderSidePanel({ kind, orderNumber, history, onClose, onTasksChanged }: OrderSidePanelProps) {
    return (
        <div className="border border-gray-300 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-900 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-white">{TITLES[kind]}</span>
                <button onClick={onClose} className="text-xs font-bold text-white hover:text-blue-300">Закрыть</button>
            </div>

            <div className="max-h-[420px] overflow-y-auto p-3">
                {kind === 'history' && <HistoryList items={history || []} />}
                {kind === 'files' && <FilesList orderNumber={orderNumber} />}
                {kind === 'tasks' && <TasksList orderNumber={orderNumber} onChanged={onTasksChanged} />}
            </div>
        </div>
    );
}

function HistoryList({ items }: { items: HistoryItem[] }) {
    if (!items.length) {
        return <p className="text-sm text-gray-500">Изменений по заказу пока не записано.</p>;
    }

    return (
        <ul className="divide-y divide-gray-100">
            {items.map((h, i) => (
                <li key={i} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-gray-900">{h.field_label || 'Изменение'}</span>
                        <span className="shrink-0 text-[11px] text-gray-400">
                            {h.occurred_at ? new Date(h.occurred_at).toLocaleString('ru-RU') : ''}
                        </span>
                    </div>
                    <p className="text-xs text-gray-700">
                        {h.old_value ? <span className="text-gray-400 line-through">{h.old_value}</span> : <span className="text-gray-400">пусто</span>}
                        <span className="mx-1 text-gray-400">→</span>
                        <span className="font-medium">{h.new_value || 'пусто'}</span>
                    </p>
                    <p className="text-[11px] text-gray-400">
                        {[h.user_data?.firstName, h.user_data?.lastName].filter(Boolean).join(' ') || 'Система'}
                    </p>
                </li>
            ))}
        </ul>
    );
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
            <p className="mb-2 border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
                Это опись вложений: сами файлы остались в почте rop@zmktlt.ru, у нас они не хранятся — открыть отсюда нельзя.
            </p>
            <ul className="divide-y divide-gray-100">
                {files.map((f, i) => (
                    <li key={i} className="py-2">
                        <p className="text-sm font-bold text-gray-900">{f.filename}</p>
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
