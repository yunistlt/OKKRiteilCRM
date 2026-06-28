'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { saveManagerSettings, getSalaryRoster, saveSalaryRoster, saveManagerExtensions } from './actions';
import Link from 'next/link';

type RosterInfo = { inSalary: boolean; candidates: { code: string; name: string }[]; resolvedName: string | null; needsChoice: boolean };

export default function ManagerSettingsPage() {
    const [managers, setManagers] = useState<any[]>([]);
    const [controlledIds, setControlledIds] = useState<Set<number>>(new Set());
    const [salaryIds, setSalaryIds] = useState<Set<number>>(new Set());
    const [roster, setRoster] = useState<Record<number, RosterInfo>>({});
    const [roleChoice, setRoleChoice] = useState<Record<number, string>>({}); // managerId → выбранная схема (для 2+ ролей)
    const [extensions, setExtensions] = useState<Record<number, string>>({}); // managerId → добавочный Телфина
    const [origExtensions, setOrigExtensions] = useState<Record<number, string>>({}); // исходные значения для диффа
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [showSqlGuide, setShowSqlGuide] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    useEffect(() => {
        async function load() {
            try {
                // 1. Fetch all managers
                const mRes = await fetch('/api/managers');
                const mData = await mRes.json();

                // 2. Fetch controlled settings
                const sRes = await fetch('/api/managers/controlled');
                const sData = await sRes.json();

                setManagers(mData || []);
                setControlledIds(new Set((sData || []).map((s: any) => s.id)));

                // Добавочные Телфина (для AI-секретаря)
                const extMap: Record<number, string> = {};
                for (const m of (mData || [])) extMap[m.id] = m.telphin_extension || '';
                setExtensions(extMap);
                setOrigExtensions(extMap);

                // 3. Реестр ЗП (участие + роль из групп RetailCRM)
                const rosterRows = await getSalaryRoster();
                const rMap: Record<number, RosterInfo> = {};
                const sIds = new Set<number>();
                const choices: Record<number, string> = {};
                for (const r of rosterRows) {
                    rMap[r.managerId] = { inSalary: r.inSalary, candidates: r.candidates, resolvedName: r.resolvedName, needsChoice: r.needsChoice };
                    if (r.inSalary) sIds.add(r.managerId);
                    if (r.resolved) choices[r.managerId] = r.resolved;
                }
                setRoster(rMap);
                setSalaryIds(sIds);
                setRoleChoice(choices);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    const filteredManagers = useMemo(() => {
        return managers.filter(m =>
            `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes(search.toLowerCase()) ||
            m.id.toString().includes(search)
        );
    }, [managers, search]);

    const handleToggle = (id: number) => {
        const next = new Set(controlledIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setControlledIds(next);
    };

    const toggleSalary = (id: number) => {
        setSalaryIds((prev) => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };

    const handleExtensionChange = (id: number, value: string) => {
        setExtensions((prev) => ({ ...prev, [id]: value.replace(/[^0-9]/g, '') }));
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveMessage('');
        try {
            // Реестр ЗП: участники + выбор роли для конфликтных (2+ кандидата)
            const choices = Array.from(salaryIds)
                .filter((id) => (roster[id]?.candidates.length ?? 0) > 1 && roleChoice[id])
                .map((id) => ({ managerId: id, schemeCode: roleChoice[id] }));
            const salaryRes = await saveSalaryRoster(Array.from(salaryIds), choices);
            if (!salaryRes.success && salaryRes.errorType !== 'TABLE_MISSING') {
                alert('Ошибка сохранения реестра ЗП: ' + (salaryRes.error || 'неизвестная'));
            }

            // Добавочные Телфина — сохраняем только изменённые
            const changedExt = Object.keys(extensions)
                .map(Number)
                .filter((id) => (extensions[id] || '') !== (origExtensions[id] || ''))
                .map((id) => ({ managerId: id, extension: extensions[id] || '' }));
            if (changedExt.length > 0) {
                const extRes = await saveManagerExtensions(changedExt);
                if (extRes.success) {
                    setOrigExtensions((prev) => ({ ...prev, ...Object.fromEntries(changedExt.map((c) => [c.managerId, c.extension])) }));
                } else if (extRes.errorType === 'COLUMN_MISSING') {
                    alert('Поле «Доб. Телфин» не создано в БД. Примените миграцию 20260628_telphin_secretary.sql');
                } else {
                    alert('Ошибка сохранения добавочных: ' + (extRes.error || 'неизвестная'));
                }
            }

            const result = await saveManagerSettings(Array.from(controlledIds));
            if (result.success) {
                const created = Array.isArray(result.createdAccounts) ? result.createdAccounts : [];
                const skipped = Array.isArray(result.skippedAccounts) ? result.skippedAccounts : [];
                if (created.length > 0) {
                    setSaveMessage(`Настройки сохранены. Созданы учётки ОКК: ${created.join(', ')}.`);
                } else {
                    setSaveMessage(`Настройки сохранены. Новые учётки не требовались${skipped.length > 0 ? '.' : '.'}`);
                }
                setShowSqlGuide(false);
            } else if (result.errorType === 'TABLE_MISSING') {
                setShowSqlGuide(true);
            } else {
                alert('Ошибка при сохранении: ' + (result.error || 'Неизвестная ошибка'));
            }
        } catch (e) {
            alert('Критическая ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <div className="text-gray-500 font-bold">Загружаем список менеджеров...</div>
        </div>
    );

    return (
        <div className="w-full px-4 py-6 md:px-6 md:py-8">
            {/* Compact Header */}
            <div className="flex flex-col gap-4 mb-6">
                {/* Mobile-first text */}
                <p className="text-sm text-gray-500 font-medium">
                    «Контроль» — анализ нарушений. «В ЗП» — участие в расчёте зарплаты (роль приходит из групп RetailCRM; при нескольких ролях выберите нужную). «Доб. Телфин» — внутренний номер для перевода звонка AI-секретарём (пусто = не настроено, перевод на оператора).
                </p>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm md:w-auto md:px-8"
                >
                    {saving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
            </div>

            {saveMessage && (
                <div className="mb-4 rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
                    {saveMessage}
                </div>
            )}

            {showSqlGuide && (
                <div className="mb-8 p-4 md:p-8 bg-amber-50 border-2 border-amber-200 rounded-3xl animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex flex-col md:flex-row items-start gap-4">
                        <div className="text-3xl">⚠️</div>
                        <div>
                            <h3 className="text-lg md:text-xl font-bold text-amber-900 mb-2">Таблица не создана в базе данных</h3>
                            <p className="text-amber-800 text-xs md:text-sm mb-6 leading-relaxed">
                                Для сохранения настроек контроля необходимо создать таблицу `manager_settings` в вашем Supabase.
                                Пожалуйста, скопируйте этот SQL-запрос и выполните его в **SQL Editor** панели Supabase:
                            </p>
                            <div className="relative group">
                                <pre className="bg-white p-4 md:p-6 rounded-2xl text-[10px] md:text-[11px] font-mono text-gray-800 border border-amber-200 overflow-x-auto select-all">
                                    {`CREATE TABLE IF NOT EXISTS manager_settings (
    id int8 PRIMARY KEY REFERENCES managers(id) ON DELETE CASCADE,
    is_controlled boolean DEFAULT false,
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE manager_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public full access" ON manager_settings USING (true) WITH CHECK (true);
GRANT ALL ON manager_settings TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload config';`}
                                </pre>
                            </div>
                            <p className="mt-4 text-[10px] md:text-xs font-bold text-amber-900 italic">
                                После выполнения запроса попробуйте нажать кнопку «Сохранить» еще раз.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl md:rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-100 bg-gray-50/50">
                    <input
                        type="text"
                        placeholder="Поиск..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm text-gray-900 focus:border-blue-500 transition-all outline-none"
                    />
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                    {/* Mobile List View */}
                    <div className="md:hidden divide-y divide-gray-100">
                        {filteredManagers.map((m) => (
                            <div key={m.id} className="p-3 flex items-center justify-between active:bg-gray-50" onClick={() => handleToggle(m.id)}>
                                <div className="flex items-center gap-3 overflow-hidden">
                                    {/* Toggle */}
                                    <div className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${controlledIds.has(m.id) ? 'bg-blue-600' : 'bg-gray-200'}`}>
                                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${controlledIds.has(m.id) ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </div>

                                    <div className="flex flex-col min-w-0">
                                        <span className="text-sm font-bold text-gray-900 truncate">
                                            {m.first_name} {m.last_name}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400">ID: {m.id}</span>
                                            {m.active ? (
                                                <span className="text-[10px] text-green-600 font-medium">Активен</span>
                                            ) : (
                                                <span className="text-[10px] text-gray-400">He активен</span>
                                            )}
                                            {m.has_okk_access ? (
                                                <span className="text-[10px] text-blue-600 font-medium">Доступ: {m.okk_username || 'есть'}</span>
                                            ) : (
                                                <span className="text-[10px] text-amber-600 font-medium">Нет доступа</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" onClick={() => toggleSalary(m.id)} title="Участвует в ЗП" className="flex items-center gap-1">
                                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">ЗП</span>
                                        <div className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${salaryIds.has(m.id) ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${salaryIds.has(m.id) ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </div>
                                    </button>
                                    {salaryIds.has(m.id) && (roster[m.id]?.candidates.length ?? 0) > 1 ? (
                                        <select value={roleChoice[m.id] ?? ''} onChange={(e) => setRoleChoice((prev) => ({ ...prev, [m.id]: e.target.value }))} className="border border-gray-300 rounded px-1 py-0.5 text-[10px]">
                                            <option value="">— роль —</option>
                                            {(roster[m.id]?.candidates ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                                        </select>
                                    ) : salaryIds.has(m.id) && roster[m.id]?.resolvedName ? (
                                        <span className="text-[9px] text-gray-500">{roster[m.id]?.resolvedName}</span>
                                    ) : null}
                                    <div className="flex items-center gap-1">
                                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Доб.</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={extensions[m.id] ?? ''}
                                            onChange={(e) => handleExtensionChange(m.id, e.target.value)}
                                            placeholder="—"
                                            className="w-16 border border-gray-300 rounded px-1 py-0.5 text-[10px] tabular-nums outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[500px]">
                            <thead>
                                <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100 sticky top-0 bg-white">
                                    <th className="p-4 md:p-6">Контроль</th>
                                    <th className="p-4 md:p-6 text-center w-16">ID</th>
                                    <th className="p-4 md:p-6">ФИО Менеджера</th>
                                    <th className="p-4 md:p-6">RetailCRM</th>
                                    <th className="p-4 md:p-6">Доступ в ОКК</th>
                                    <th className="p-4 md:p-6">В ЗП / Роль</th>
                                    <th className="p-4 md:p-6">Доб. Телфин</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredManagers.map((m) => (
                                    <tr key={m.id} className="hover:bg-blue-50/20 transition-all duration-200 cursor-pointer" onClick={() => handleToggle(m.id)}>
                                        <td className="p-4 md:p-6 w-32">
                                            <div className="flex items-center justify-center">
                                                <div className={`w-10 h-5 md:w-12 md:h-6 rounded-full p-1 transition-all duration-300 ${controlledIds.has(m.id) ? 'bg-blue-600' : 'bg-gray-200'}`}>
                                                    <div className={`w-3 h-3 md:w-4 md:h-4 bg-white rounded-full transition-all duration-300 ${controlledIds.has(m.id) ? 'translate-x-5 md:translate-x-6' : 'translate-x-0'}`}></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 md:p-6 font-bold text-gray-400 tabular-nums text-center text-xs md:text-sm">
                                            {m.id}
                                        </td>
                                        <td className="p-4 md:p-6 font-black text-gray-900 uppercase tracking-tight text-xs md:text-sm">
                                            {m.first_name} {m.last_name}
                                        </td>
                                        <td className="p-4 md:p-6 text-center sm:text-left">
                                            {m.active ? (
                                                <span className="bg-green-50 text-green-700 px-2 py-1 md:px-3 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-green-600/20">Активен</span>
                                            ) : (
                                                <span className="bg-gray-50 text-gray-400 px-2 py-1 md:px-3 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-gray-600/10">Не активен</span>
                                            )}
                                        </td>
                                        <td className="p-4 md:p-6 text-xs md:text-sm">
                                            {m.has_okk_access ? (
                                                <span className="bg-blue-50 text-blue-700 px-2 py-1 md:px-3 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-blue-600/20">
                                                    {m.okk_username || 'Доступ создан'}
                                                </span>
                                            ) : (
                                                <span className="bg-amber-50 text-amber-700 px-2 py-1 md:px-3 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest ring-1 ring-amber-600/20">
                                                    Нет доступа
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 md:p-6" onClick={(e) => e.stopPropagation()}>
                                            {(() => {
                                                const info = roster[m.id];
                                                const cands = info?.candidates ?? [];
                                                const inSal = salaryIds.has(m.id);
                                                return (
                                                    <div className="flex items-center gap-3">
                                                        <button type="button" onClick={() => toggleSalary(m.id)} title="Участвует в расчёте ЗП">
                                                            <div className={`w-10 h-5 md:w-12 md:h-6 rounded-full p-1 transition-all duration-300 ${inSal ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                                                                <div className={`w-3 h-3 md:w-4 md:h-4 bg-white rounded-full transition-all duration-300 ${inSal ? 'translate-x-5 md:translate-x-6' : 'translate-x-0'}`}></div>
                                                            </div>
                                                        </button>
                                                        {!inSal ? null : cands.length === 0 ? (
                                                            <span className="text-[10px] text-amber-600 font-medium">нет роли из групп RetailCRM</span>
                                                        ) : cands.length === 1 ? (
                                                            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-full text-[10px] font-bold">{info?.resolvedName || cands[0].name}</span>
                                                        ) : (
                                                            <select
                                                                value={roleChoice[m.id] ?? ''}
                                                                onChange={(e) => setRoleChoice((prev) => ({ ...prev, [m.id]: e.target.value }))}
                                                                className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
                                                            >
                                                                <option value="">— выберите роль —</option>
                                                                {cands.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                                                            </select>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="p-4 md:p-6" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={extensions[m.id] ?? ''}
                                                onChange={(e) => handleExtensionChange(m.id, e.target.value)}
                                                placeholder="не настроено"
                                                className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-xs tabular-nums focus:border-blue-500 outline-none"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
