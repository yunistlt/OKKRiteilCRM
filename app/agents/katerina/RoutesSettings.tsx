'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface RouteRow {
    department: string;
    label: string;
    email: string | null;
    is_active: boolean;
}

interface Props {
    initialRoutes: RouteRow[];
    initialCreateOrders: boolean;
    initialForwardEnabled: boolean;
    initialOrderBlocklist: string[];
    canEdit: boolean;
}

export default function RoutesSettings({ initialRoutes, initialCreateOrders, initialForwardEnabled, initialOrderBlocklist, canEdit }: Props) {
    const router = useRouter();
    const [routes, setRoutes] = useState<RouteRow[]>(initialRoutes.map((r) => ({ ...r, email: r.email || '' })));
    const [createOrders, setCreateOrders] = useState(initialCreateOrders);
    const [forwardEnabled, setForwardEnabled] = useState(initialForwardEnabled);
    const [blocklist, setBlocklist] = useState((initialOrderBlocklist || []).join('\n'));
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const setEmail = (dep: string, email: string) =>
        setRoutes((rs) => rs.map((r) => (r.department === dep ? { ...r, email } : r)));
    const setActive = (dep: string, is_active: boolean) =>
        setRoutes((rs) => rs.map((r) => (r.department === dep ? { ...r, is_active } : r)));

    async function save() {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch('/api/agents/katerina/routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routes: routes.map((r) => ({ department: r.department, email: r.email?.trim() || '', is_active: r.is_active })),
                    create_orders: createOrders,
                    forward_enabled: forwardEnabled,
                    order_blocklist: blocklist.split('\n').map((s) => s.trim()).filter(Boolean),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Ошибка сохранения');
            setMsg({ kind: 'ok', text: 'Сохранено' });
            router.refresh();
        } catch (e: any) {
            setMsg({ kind: 'err', text: e?.message || 'Ошибка сохранения' });
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="mt-6 border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Настройки пересылки</div>
            <p className="mt-1 text-xs text-slate-500">
                Адреса отделов, куда Катерина пересылает письма по содержанию. Пока адрес пуст или отдел выключен —
                письмо помечается «нужна ручная обработка» и не пересылается.
            </p>

            {/* Режимы */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className={`flex items-center justify-between gap-3 border border-slate-200 px-4 py-3 ${canEdit ? '' : 'opacity-60'}`}>
                    <span className="text-sm font-bold text-slate-800">Создание заказов по заявкам</span>
                    <input type="checkbox" className="h-4 w-4" checked={createOrders} disabled={!canEdit} onChange={(e) => setCreateOrders(e.target.checked)} />
                </label>
                <label className={`flex items-center justify-between gap-3 border border-slate-200 px-4 py-3 ${canEdit ? '' : 'opacity-60'}`}>
                    <span className="text-sm font-bold text-slate-800">Пересылка писем в отделы</span>
                    <input type="checkbox" className="h-4 w-4" checked={forwardEnabled} disabled={!canEdit} onChange={(e) => setForwardEnabled(e.target.checked)} />
                </label>
            </div>

            {/* Адреса отделов */}
            <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 pr-4">Отдел</th>
                            <th className="py-2 pr-4">Адрес для пересылки</th>
                            <th className="py-2 pr-4 text-center">Включён</th>
                        </tr>
                    </thead>
                    <tbody>
                        {routes.map((r) => (
                            <tr key={r.department} className="border-b border-slate-50">
                                <td className="py-2 pr-4 font-bold text-slate-800">{r.label}</td>
                                <td className="py-2 pr-4">
                                    <input
                                        type="email"
                                        value={r.email || ''}
                                        disabled={!canEdit}
                                        onChange={(e) => setEmail(r.department, e.target.value)}
                                        placeholder="отдел@компания.ру"
                                        className="w-full max-w-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-500"
                                    />
                                </td>
                                <td className="py-2 pr-4 text-center">
                                    <input type="checkbox" className="h-4 w-4" checked={r.is_active} disabled={!canEdit} onChange={(e) => setActive(r.department, e.target.checked)} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Исключения на создание заказов */}
            <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="text-sm font-bold text-slate-800">Не создавать заказы по письмам от этих адресов</div>
                <p className="mt-1 text-xs text-slate-500">
                    По одному адресу или домену в строке (например <code className="bg-slate-100 px-1">dmto@pharmperspectiva.ru</code> или
                    {' '}<code className="bg-slate-100 px-1">pharmperspectiva.ru</code>). Письмо от такого отправителя
                    Катерина разберёт как обычно (и при необходимости перешлёт в отдел), но заказ создавать не будет —
                    для тендерных робо-рассылок и других нежелательных источников.
                </p>
                <textarea
                    value={blocklist}
                    disabled={!canEdit}
                    onChange={(e) => setBlocklist(e.target.value)}
                    rows={4}
                    placeholder={'dmto@pharmperspectiva.ru\nexample-tenders.ru'}
                    className="mt-3 w-full max-w-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
            </div>

            {canEdit ? (
                <div className="mt-5 flex items-center gap-3">
                    <button
                        onClick={save}
                        disabled={saving}
                        className="border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                        {saving ? 'Сохраняю…' : 'Сохранить'}
                    </button>
                    {msg ? (
                        <span className={`text-sm font-bold ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</span>
                    ) : null}
                </div>
            ) : (
                <p className="mt-4 text-xs text-slate-400">Изменять настройки могут администратор и РОП.</p>
            )}
        </section>
    );
}
