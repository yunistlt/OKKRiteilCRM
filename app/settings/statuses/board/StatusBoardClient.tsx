'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface CrmStatus {
    id: string;
    code: string;
    name: string;
    group_id: string | null;
    color: string | null;
    ordering: number;
    norm_days: number | null;
    is_working: boolean;
    active: boolean;
    external_code: string | null;
}

interface CrmGroup {
    id: string;
    code: string;
    name: string;
    color: string | null;
    ordering: number;
    active: boolean;
}

/**
 * Экран статусов будущей внутренней CRM: матрица переходов, а вся настройка —
 * внутри неё. Клик по статусу открывает его карточку, клик по группе — состав группы.
 */
export default function StatusBoardClient() {
    const [statuses, setStatuses] = useState<CrmStatus[]>([]);
    const [groups, setGroups] = useState<CrmGroup[]>([]);
    const [pairs, setPairs] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const [editStatus, setEditStatus] = useState<Partial<CrmStatus> | null>(null);
    const [editGroup, setEditGroup] = useState<Partial<CrmGroup> | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/crm-statuses');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось загрузить статусы');
            setStatuses(data.statuses || []);
            setGroups(data.groups || []);
            setPairs(new Set(data.transitions || []));
            setDirty(false);
        } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Не удалось загрузить статусы');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const ordered = useMemo(() => {
        const groupOrder = new Map(groups.map((g) => [g.id, g.ordering]));
        return statuses
            .filter((s) => s.active)
            .sort((a, b) => {
                const ga = a.group_id ? groupOrder.get(a.group_id) ?? 999 : 999;
                const gb = b.group_id ? groupOrder.get(b.group_id) ?? 999 : 999;
                return ga - gb || a.ordering - b.ordering || a.name.localeCompare(b.name);
            });
    }, [statuses, groups]);

    const groupOf = (s: CrmStatus) => groups.find((g) => g.id === s.group_id);

    const toggle = (from: string, to: string) => {
        if (from === to) return;
        setPairs((prev) => {
            const next = new Set(prev);
            const key = `${from}>${to}`;
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
        setDirty(true);
    };

    const saveTransitions = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch('/api/crm-statuses', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'transitions', pairs: Array.from(pairs) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.details || data.error || 'Не удалось сохранить');
            setDirty(false);
            setMessage(`Переходы сохранены: ${data.saved}`);
        } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Не удалось сохранить');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-6 text-sm text-gray-500">Загружаем статусы…</div>;

    return (
        <div className="flex h-full min-h-0 flex-col bg-white">
            <div className="px-6 pt-5">
                <h1 className="text-2xl font-semibold text-gray-900">Статусы и переходы</h1>
                <p className="mt-1 max-w-3xl text-sm text-gray-500">
                    Это статусы нашей будущей CRM — отдельные от RetailCRM. Строка: из какого статуса
                    переходим, колонка: в какой. Галочка разрешает переход. Клик по статусу открывает его
                    настройку, клик по группе — состав группы.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => setEditStatus({ name: '', ordering: 100, is_working: true, active: true })}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        + Статус
                    </button>
                    <button
                        onClick={() => setEditGroup({ name: '', ordering: 100, active: true })}
                        className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        + Группа
                    </button>

                    {ordered.length > 1 && (
                        <>
                            <button
                                onClick={() => {
                                    const next = new Set<string>();
                                    for (const a of ordered) for (const b of ordered) if (a.id !== b.id) next.add(`${a.id}>${b.id}`);
                                    setPairs(next);
                                    setDirty(true);
                                }}
                                className="text-sm text-green-700 hover:underline"
                            >
                                ✓ Заполнить все
                            </button>
                            <button onClick={() => { setPairs(new Set()); setDirty(true); }} className="text-sm text-red-600 hover:underline">
                                ✕ Сбросить все
                            </button>
                            <button
                                onClick={saveTransitions}
                                disabled={saving || !dirty}
                                className="rounded-md bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-500"
                            >
                                {saving ? 'Сохраняем…' : 'Сохранить переходы'}
                            </button>
                        </>
                    )}

                    {dirty && <span className="text-sm text-amber-700">Есть несохранённые изменения</span>}
                    {message && <span className="text-sm text-gray-600">{message}</span>}
                </div>
            </div>

            {groups.length > 0 && (
                <div className="mt-4 px-6">
                    <p className="mb-2 text-sm text-gray-500">Группы статусов — клик открывает настройку и состав</p>
                    <div className="flex flex-wrap gap-2">
                        {groups.map((g) => (
                            <button
                                key={g.id}
                                onClick={() => setEditGroup(g)}
                                style={{ backgroundColor: g.color || '#f1f5f9' }}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:border-blue-500 hover:text-blue-700"
                            >
                                {g.name} <span className="text-gray-500">{statuses.filter((s) => s.group_id === g.id).length}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 min-h-0 flex-1 overflow-auto px-6 pb-6">
                {ordered.length === 0 ? (
                    <p className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                        Статусов пока нет. Заведите первый кнопкой «+ Статус» — или перенесите текущий набор
                        из RetailCRM разовым скриптом <code className="font-mono">scripts/seed-own-statuses.mjs</code>:
                        он скопирует статусы и проставит метку соответствия, но живой связи с их синком не создаст.
                    </p>
                ) : (
                    <table className="border-collapse text-sm">
                        <thead>
                            <tr>
                                <th className="sticky left-0 z-20 border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-normal text-gray-500">
                                    Начальный \ Конечный
                                </th>
                                {ordered.map((s) => (
                                    <th
                                        key={s.id}
                                        className="border border-gray-200 p-0 align-bottom"
                                        style={{ backgroundColor: s.color || groupOf(s)?.color || '#f8fafc', minWidth: 112, maxWidth: 112 }}
                                    >
                                        <button
                                            onClick={() => setEditStatus(s)}
                                            title="Настроить статус"
                                            className="block h-full w-full px-2 py-2 text-left text-xs font-medium leading-snug text-gray-800 hover:underline"
                                        >
                                            {s.name}
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ordered.map((from) => (
                                <tr key={from.id}>
                                    <th
                                        className="sticky left-0 z-10 border border-gray-200 p-0 text-left"
                                        style={{ backgroundColor: from.color || groupOf(from)?.color || '#f8fafc', minWidth: 220, maxWidth: 220 }}
                                    >
                                        <div className="px-3 py-2">
                                            <button
                                                onClick={() => setEditStatus(from)}
                                                title="Настроить статус"
                                                className="block w-full text-left text-xs font-medium leading-snug text-gray-800 hover:underline"
                                            >
                                                {from.name}
                                            </button>
                                            <span className="mt-0.5 block text-[10px] font-normal text-gray-500">
                                                {groupOf(from) ? (
                                                    <button
                                                        onClick={() => setEditGroup(groupOf(from)!)}
                                                        title="Настроить группу"
                                                        className="text-gray-500 underline decoration-dotted hover:text-blue-600"
                                                    >
                                                        {groupOf(from)!.name}
                                                    </button>
                                                ) : 'Без группы'}
                                                {from.norm_days != null ? ` · норматив ${from.norm_days} дн.` : ''}
                                            </span>
                                        </div>
                                    </th>
                                    {ordered.map((to) => (
                                        <td key={to.id} className={`border border-gray-200 text-center ${from.id === to.id ? 'bg-gray-100' : ''}`}>
                                            {from.id !== to.id && (
                                                <input
                                                    type="checkbox"
                                                    checked={pairs.has(`${from.id}>${to.id}`)}
                                                    onChange={() => toggle(from.id, to.id)}
                                                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
                                                />
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

            </div>

            {editStatus && (
                <StatusModal
                    status={editStatus}
                    groups={groups}
                    onClose={() => setEditStatus(null)}
                    onSaved={() => { setEditStatus(null); load(); }}
                />
            )}

            {editGroup && (
                <GroupModal
                    group={editGroup}
                    statuses={statuses}
                    onClose={() => setEditGroup(null)}
                    onSaved={() => { setEditGroup(null); load(); }}
                />
            )}
        </div>
    );
}

function StatusModal({ status, groups, onClose, onSaved }: {
    status: Partial<CrmStatus>;
    groups: CrmGroup[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState<Partial<CrmStatus>>(status);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isNew = !status.id;

    const save = async () => {
        if (!draft.name?.trim()) { setError('Название обязательно.'); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/crm-statuses', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: 'status',
                    id: draft.id,
                    name: draft.name.trim(),
                    groupId: draft.group_id ?? null,
                    color: draft.color ?? null,
                    ordering: draft.ordering ?? 100,
                    normDays: draft.norm_days ?? null,
                    isWorking: draft.is_working ?? true,
                    active: draft.active ?? true,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error === 'code_taken' ? 'Статус с таким кодом уже есть' : (data.details || data.error || 'Не удалось сохранить'));
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось сохранить');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!draft.id || !confirm(`Удалить статус «${draft.name}»? Его переходы тоже исчезнут.`)) return;
        await fetch(`/api/crm-statuses?kind=status&id=${draft.id}`, { method: 'DELETE' });
        onSaved();
    };

    return (
        <Modal title={isNew ? 'Новый статус' : draft.name || 'Статус'} onClose={onClose}>
            <div className="grid gap-4 md:grid-cols-2">
                <Labeled label="Название">
                    <input
                        value={draft.name ?? ''}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </Labeled>
                <Labeled label="Группа">
                    <select
                        value={draft.group_id ?? ''}
                        onChange={(e) => setDraft({ ...draft, group_id: e.target.value || null })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="">Без группы</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                </Labeled>
                <Labeled label="Порядок в группе">
                    <input
                        type="number"
                        value={draft.ordering ?? 100}
                        onChange={(e) => setDraft({ ...draft, ordering: Number(e.target.value) })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </Labeled>
                <Labeled label="Норматив времени в статусе, дней">
                    <input
                        type="number"
                        min={0}
                        placeholder="не задан"
                        value={draft.norm_days ?? ''}
                        onChange={(e) => setDraft({ ...draft, norm_days: e.target.value === '' ? null : Number(e.target.value) })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </Labeled>
                <Labeled label="Цвет">
                    <div className="flex items-center gap-2">
                        <input
                            type="color"
                            value={draft.color || '#eef2f7'}
                            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                            className="h-9 w-14 cursor-pointer rounded border border-gray-300"
                        />
                        <button onClick={() => setDraft({ ...draft, color: null })} className="text-sm text-blue-600 hover:underline">
                            Цвет группы
                        </button>
                    </div>
                </Labeled>
            </div>

            <div className="mt-4 space-y-2">
                <Check label="Рабочий статус — заказ считается в работе" checked={draft.is_working ?? true} onChange={(v) => setDraft({ ...draft, is_working: v })} />
                <Check label="Используется" checked={draft.active ?? true} onChange={(v) => setDraft({ ...draft, active: v })} />
            </div>

            {draft.external_code && (
                <p className="mt-3 text-xs text-gray-500">Соответствует статусу RetailCRM: <code className="font-mono">{draft.external_code}</code></p>
            )}

            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex items-center gap-3">
                <button onClick={save} disabled={saving} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500">
                    {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Отменить</button>
                {!isNew && <button onClick={remove} className="ml-auto text-sm text-red-600 hover:underline">Удалить статус</button>}
            </div>
        </Modal>
    );
}

function GroupModal({ group, statuses, onClose, onSaved }: {
    group: Partial<CrmGroup>;
    statuses: CrmStatus[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState<Partial<CrmGroup>>(group);
    const [members, setMembers] = useState<string[]>(statuses.filter((s) => s.group_id === group.id).map((s) => s.id));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isNew = !group.id;

    const save = async () => {
        if (!draft.name?.trim()) { setError('Название обязательно.'); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/crm-statuses', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: 'group',
                    id: draft.id,
                    name: draft.name.trim(),
                    color: draft.color ?? null,
                    ordering: draft.ordering ?? 100,
                    active: draft.active ?? true,
                    members,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.details || data.error || 'Не удалось сохранить');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось сохранить');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!draft.id || !confirm(`Удалить группу «${draft.name}»? Статусы останутся, но без группы.`)) return;
        await fetch(`/api/crm-statuses?kind=group&id=${draft.id}`, { method: 'DELETE' });
        onSaved();
    };

    return (
        <Modal title={isNew ? 'Новая группа' : `Группа «${draft.name}»`} onClose={onClose}>
            <div className="grid gap-4 md:grid-cols-3">
                <Labeled label="Название">
                    <input
                        value={draft.name ?? ''}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </Labeled>
                <Labeled label="Порядок">
                    <input
                        type="number"
                        value={draft.ordering ?? 100}
                        onChange={(e) => setDraft({ ...draft, ordering: Number(e.target.value) })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </Labeled>
                <Labeled label="Цвет">
                    <input
                        type="color"
                        value={draft.color || '#eef2f7'}
                        onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                        className="h-9 w-full cursor-pointer rounded border border-gray-300"
                    />
                </Labeled>
            </div>

            <p className="mb-2 mt-4 text-sm text-gray-500">Состав группы — снятые останутся без группы</p>
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-gray-200">
                {statuses.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">Статусов пока нет.</p>}
                {statuses.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50">
                        <input
                            type="checkbox"
                            checked={members.includes(s.id)}
                            onChange={() => setMembers((prev) => prev.includes(s.id) ? prev.filter((c) => c !== s.id) : [...prev, s.id])}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        />
                        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: s.color || '#e5e7eb' }} />
                        <span className="flex-1">{s.name}</span>
                        {s.group_id && s.group_id !== group.id && <span className="text-xs text-gray-400">сейчас в другой группе</span>}
                    </label>
                ))}
            </div>

            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex items-center gap-3">
                <button onClick={save} disabled={saving} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500">
                    {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Отменить</button>
                {!isNew && <button onClick={remove} className="ml-auto text-sm text-red-600 hover:underline">Удалить группу</button>}
            </div>
        </Modal>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
                </div>
                {children}
            </div>
        </div>
    );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="mb-1.5 block text-sm text-gray-500">{label}</label>
            {children}
        </div>
    );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
            {label}
        </label>
    );
}
