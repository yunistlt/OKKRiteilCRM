'use client';

import { useCallback, useEffect, useState } from 'react';

type Kind = 'document' | 'email';

interface TemplateRow {
    id: string;
    code: string;
    name: string;
    subject?: string;
    body: string;
    orientation?: string;
    page_format?: string;
    active: boolean;
    sort_order: number;
}

const HINT = `Подстановки берутся из заказа RetailCRM — того же объекта, что в их справочнике.
Например: {{ order.number }}, {{ order.customer.name }}, {{ order.totalSumm | money }} ₽,
дата: {{ order.createdAt | date("d.m.Y") }}, перебор товаров:
{% for item in order.items %}{{ item.offer.name }} — {{ item.quantity }} шт.{% endfor %}`;

const EMPTY_DOCUMENT: Partial<TemplateRow> = {
    code: '',
    name: '',
    body: '<h1>Заказ №{{ order.number }}</h1>\n<p>Клиент: {{ order.customer.name }}</p>',
    orientation: 'portrait',
    page_format: 'A4',
    active: true,
    sort_order: 100,
};

const EMPTY_EMAIL: Partial<TemplateRow> = {
    code: '',
    name: '',
    subject: 'По заказу №{{ order.number }}',
    body: '<p>Здравствуйте!</p>\n<p>По вашему заказу №{{ order.number }}…</p>',
    active: true,
    sort_order: 100,
};

export default function TemplatesClient() {
    const [kind, setKind] = useState<Kind>('document');
    const [rows, setRows] = useState<Record<Kind, TemplateRow[]>>({ document: [], email: [] });
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Partial<TemplateRow> | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/settings/templates');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось загрузить шаблоны');
            setRows({ document: data.document || [], email: data.email || [] });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось загрузить шаблоны');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        if (!editing) return;
        setError(null);
        setSaving(true);
        try {
            const isNew = !editing.id;
            const res = await fetch(isNew ? '/api/settings/templates' : `/api/settings/templates/${editing.id}`, {
                method: isNew ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, ...editing }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error === 'code_taken'
                    ? 'Шаблон с таким кодом уже есть'
                    : (data.details?.[0]?.message || data.error || 'Не удалось сохранить'));
            }
            setEditing(null);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось сохранить');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (row: TemplateRow) => {
        if (!confirm(`Удалить шаблон «${row.name}»? Отменить будет нельзя.`)) return;
        await fetch(`/api/settings/templates/${row.id}?kind=${kind}`, { method: 'DELETE' });
        await load();
    };

    const list = rows[kind];

    return (
        <div className="p-4">
            <h1 className="mb-1 text-2xl font-black text-gray-900">Шаблоны документов и писем</h1>
            <p className="mb-4 text-sm text-gray-600">
                Печатные формы и письма собираются из шаблона и данных заказа — как в RetailCRM.
                Шаблоны оттуда переносятся почти без правок: синтаксис подстановок тот же.
            </p>

            <div className="mb-4 flex gap-px bg-gray-200">
                {(['document', 'email'] as Kind[]).map((k) => (
                    <button
                        key={k}
                        onClick={() => { setKind(k); setEditing(null); }}
                        className={`px-4 py-2 text-sm font-bold ${kind === k ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                    >
                        {k === 'document' ? 'Печатные формы' : 'Письма'}
                    </button>
                ))}
            </div>

            {error && <p className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button
                onClick={() => setEditing(kind === 'document' ? { ...EMPTY_DOCUMENT } : { ...EMPTY_EMAIL })}
                className="mb-4 bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
                + Новый шаблон
            </button>

            {editing && (
                <div className="mb-6 border border-gray-300 bg-gray-50 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Название (видит менеджер)">
                            <input
                                value={editing.name || ''}
                                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                placeholder="Счёт на оплату"
                                className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                            />
                        </Field>
                        <Field label="Код (латиницей, в адресе документа)">
                            <input
                                value={editing.code || ''}
                                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                                placeholder="invoice"
                                disabled={Boolean(editing.id)}
                                className="w-full border border-gray-300 px-2 py-1.5 font-mono text-sm focus:border-blue-600 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500"
                            />
                        </Field>
                    </div>

                    {kind === 'email' && (
                        <div className="mt-3">
                            <Field label="Тема письма">
                                <input
                                    value={editing.subject || ''}
                                    onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                                    className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                                />
                            </Field>
                        </div>
                    )}

                    {kind === 'document' && (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <Field label="Ориентация">
                                <select
                                    value={editing.orientation || 'portrait'}
                                    onChange={(e) => setEditing({ ...editing, orientation: e.target.value })}
                                    className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                                >
                                    <option value="portrait">Книжная</option>
                                    <option value="landscape">Альбомная</option>
                                </select>
                            </Field>
                            <Field label="Формат листа">
                                <select
                                    value={editing.page_format || 'A4'}
                                    onChange={(e) => setEditing({ ...editing, page_format: e.target.value })}
                                    className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                                >
                                    <option value="A4">A4</option>
                                    <option value="A5">A5</option>
                                </select>
                            </Field>
                        </div>
                    )}

                    <div className="mt-3">
                        <Field label={kind === 'document' ? 'Шаблон документа (HTML с подстановками)' : 'Текст письма (HTML с подстановками)'}>
                            <textarea
                                value={editing.body || ''}
                                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                                rows={14}
                                spellCheck={false}
                                className="w-full border border-gray-300 px-2 py-1.5 font-mono text-xs focus:border-blue-600 focus:outline-none"
                            />
                        </Field>
                        <pre className="mt-2 whitespace-pre-wrap border border-gray-200 bg-white px-2 py-1.5 text-[11px] leading-relaxed text-gray-600">{HINT}</pre>
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={editing.active !== false}
                            onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                        />
                        Показывать менеджерам
                    </label>

                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={save}
                            disabled={saving}
                            className="bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                        >
                            {saving ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                        <button
                            onClick={() => setEditing(null)}
                            className="border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-900 hover:text-white"
                        >
                            Отменить
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-gray-500">Загружаем…</p>
            ) : list.length === 0 ? (
                <p className="border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                    Шаблонов пока нет. Заведите первый — или перенесите готовый из RetailCRM, он заработает как есть.
                </p>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b-2 border-gray-900 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
                            <th className="py-2">Название</th>
                            <th className="py-2">Код</th>
                            <th className="py-2">Показывать</th>
                            <th className="py-2 text-right">Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map((row) => (
                            <tr key={row.id} className="border-b border-gray-100">
                                <td className="py-2 font-bold text-gray-900">{row.name}</td>
                                <td className="py-2 font-mono text-xs text-gray-600">{row.code}</td>
                                <td className="py-2">{row.active ? 'Да' : 'Нет'}</td>
                                <td className="py-2 text-right">
                                    <button
                                        onClick={() => setEditing(row)}
                                        className="mr-2 border border-gray-300 px-2 py-1 text-xs font-bold hover:bg-gray-900 hover:text-white"
                                    >
                                        Изменить
                                    </button>
                                    <button
                                        onClick={() => remove(row)}
                                        className="border border-red-300 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-600 hover:text-white"
                                    >
                                        Удалить
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">{label}</label>
            {children}
        </div>
    );
}
