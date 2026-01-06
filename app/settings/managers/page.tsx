'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { saveManagerSettings } from './actions';
import Link from 'next/link';

export default function ManagerSettingsPage() {
    const [managers, setManagers] = useState<any[]>([]);
    const [controlledIds, setControlledIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [showSqlGuide, setShowSqlGuide] = useState(false);

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

    const handleSave = async () => {
        setSaving(true);
        try {
            const result = await saveManagerSettings(Array.from(controlledIds));
            if (result.success) {
                alert('Настройки сохранены успешно!');
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
        <div className="p-4 md:p-0 max-w-4xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10">
                <div>
                    <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight">Контроль Менеджеров</h1>
                    <p className="text-sm md:text-base text-gray-500 mt-2">Выберите сотрудников для детального анализа нарушений</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full sm:w-auto bg-blue-600 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-200 transition-all disabled:opacity-50"
                >
                    {saving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
            </div>

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

            <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/30">
                    <input
                        type="text"
                        placeholder="Поиск по имени или ID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white border-2 border-gray-100 rounded-2xl p-3 md:p-4 text-sm md:text-base text-gray-900 font-bold focus:border-blue-500 transition-all outline-none"
                    />
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[500px]">
                            <thead>
                                <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-black border-b border-gray-100 sticky top-0 bg-white">
                                    <th className="p-4 md:p-6">Контроль</th>
                                    <th className="p-4 md:p-6 text-center w-16">ID</th>
                                    <th className="p-4 md:p-6">ФИО Менеджера</th>
                                    <th className="p-4 md:p-6">RetailCRM</th>
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
