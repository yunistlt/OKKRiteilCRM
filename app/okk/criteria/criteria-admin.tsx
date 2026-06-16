'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createCriterion, updateCriterion, deleteCriterion, toggleCriterion, reorderCriteria } from '@/app/actions/okk-criteria';

type Criterion = {
    key: string; label: string; category: string; type: string;
    agent: string | null; agent_emoji: string | null; eval_method: string;
    ai_prompt: string | null; params: any; scoring_basket: string | null;
    how_tip: string | null; data_tip: string | null; sort_order: number; is_active: boolean;
};

const EVAL_METHODS: Record<string, string> = {
    native: 'Системный (расчёт в коде)',
    ai_script: 'ИИ по диалогу (промпт)',
    field_filled: 'Поле заполнено',
    info: 'Справочная (без оценки)',
};
const BASKETS: Record<string, string> = { '': 'Не входит в балл', deal: 'Балл сделки', script: 'Балл скрипта' };
const TYPES: Record<string, string> = { bool: 'Да/Нет', text: 'Текст', num: 'Число' };

const inputCls = 'w-full border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-indigo-500 transition-colors';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1';

function CriterionRow({ c, index, total, onMove }: { c: Criterion; index: number; total: number; onMove: (i: number, dir: -1 | 1) => void }) {
    const router = useRouter();
    const [draft, setDraft] = useState<Criterion>(c);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const dirty = JSON.stringify(draft) !== JSON.stringify(c);

    const set = (k: keyof Criterion, v: any) => setDraft(d => ({ ...d, [k]: v }));

    const save = async () => {
        setBusy(true);
        try {
            await updateCriterion(c.key, {
                label: draft.label, category: draft.category, type: draft.type,
                agent: draft.agent, agent_emoji: draft.agent_emoji, eval_method: draft.eval_method,
                ai_prompt: draft.ai_prompt, scoring_basket: draft.scoring_basket || null,
                how_tip: draft.how_tip, data_tip: draft.data_tip,
            });
            router.refresh();
        } catch (e: any) { alert('Ошибка сохранения: ' + e.message); }
        finally { setBusy(false); }
    };

    const remove = async () => {
        if (!confirm(`Удалить критерий «${c.label}»? Колонка исчезнет из таблицы качества.`)) return;
        setBusy(true);
        try { await deleteCriterion(c.key); router.refresh(); }
        catch (e: any) { alert('Ошибка удаления: ' + e.message); setBusy(false); }
    };

    const toggle = async () => {
        setBusy(true);
        try { await toggleCriterion(c.key, !c.is_active); router.refresh(); }
        catch (e: any) { alert('Ошибка: ' + e.message); setBusy(false); }
    };

    return (
        <div className={`border rounded-xl p-3 ${c.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
            <div className="flex items-center gap-2">
                <div className="flex flex-col">
                    <button disabled={index === 0} onClick={() => onMove(index, -1)} className="text-gray-300 hover:text-gray-700 disabled:opacity-30 leading-none text-xs">▲</button>
                    <button disabled={index === total - 1} onClick={() => onMove(index, 1)} className="text-gray-300 hover:text-gray-700 disabled:opacity-30 leading-none text-xs">▼</button>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 truncate">{c.agent_emoji} {c.label}</span>
                        <span className="text-[10px] font-mono text-gray-400">{c.key}</span>
                        {c.scoring_basket && <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${c.scoring_basket === 'deal' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'}`}>{c.scoring_basket === 'deal' ? 'СДЕЛКА' : 'СКРИПТ'}</span>}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{EVAL_METHODS[c.eval_method] || c.eval_method}</span>
                        {c.eval_method === 'native' && <span className="text-[9px] text-amber-600 italic">расчёт в коде</span>}
                    </div>
                    <div className="text-[11px] text-gray-400">{c.category}</div>
                </div>
                <button onClick={toggle} disabled={busy} className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${c.is_active ? 'bg-green-600' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${c.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-indigo-600 p-1 text-sm" title="Редактировать">✏️</button>
                <button onClick={remove} disabled={busy} className="text-gray-400 hover:text-red-500 p-1 text-sm" title="Удалить">🗑️</button>
            </div>

            {open && (
                <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className={labelCls}>Название (в шапке колонки)</label>
                        <input value={draft.label} onChange={e => set('label', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Категория (группа)</label>
                        <input value={draft.category} onChange={e => set('category', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Тип значения</label>
                        <select value={draft.type} onChange={e => set('type', e.target.value)} className={inputCls}>
                            {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Метод оценки</label>
                        <select value={draft.eval_method} onChange={e => set('eval_method', e.target.value)} className={inputCls}>
                            {Object.entries(EVAL_METHODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Корзина итогового балла</label>
                        <select value={draft.scoring_basket || ''} onChange={e => set('scoring_basket', e.target.value)} className={inputCls}>
                            {Object.entries(BASKETS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Агент</label>
                        <input value={draft.agent || ''} onChange={e => set('agent', e.target.value)} placeholder="Максим / Семён / Игорь" className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Эмодзи агента</label>
                        <input value={draft.agent_emoji || ''} onChange={e => set('agent_emoji', e.target.value)} placeholder="🤓" className={inputCls} />
                    </div>
                    {draft.eval_method === 'ai_script' && (
                        <div className="col-span-2">
                            <label className={labelCls}>Инструкция (промпт) для ИИ</label>
                            <textarea value={draft.ai_prompt || ''} onChange={e => set('ai_prompt', e.target.value)} className={`${inputCls} min-h-[80px] resize-y`} placeholder="Что проверять в диалоге. true — выполнено, false — нет." />
                        </div>
                    )}
                    {draft.eval_method === 'field_filled' && (
                        <div className="col-span-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">
                            Метод «Поле заполнено» начнёт считаться после включения в движке (фаза 4). Сейчас критерий отобразится в таблице, но без автооценки.
                        </div>
                    )}
                    <div className="col-span-2">
                        <label className={labelCls}>Подсказка «как проверяется» (тултип)</label>
                        <input value={draft.how_tip || ''} onChange={e => set('how_tip', e.target.value)} className={inputCls} />
                    </div>
                    <div className="col-span-2 flex justify-end gap-2 pt-1">
                        <button onClick={() => setDraft(c)} disabled={!dirty || busy} className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-gray-700 disabled:opacity-40">Сбросить</button>
                        <button onClick={save} disabled={!dirty || busy} className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40">{busy ? 'Сохранение…' : 'Сохранить'}</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function AddForm({ onDone }: { onDone: () => void }) {
    const router = useRouter();
    const [d, setD] = useState({ key: '', label: '', category: '', type: 'bool', eval_method: 'ai_script', scoring_basket: '', agent: 'Максим', agent_emoji: '🤓', ai_prompt: '' });
    const [busy, setBusy] = useState(false);
    const set = (k: string, v: any) => setD(p => ({ ...p, [k]: v }));

    const create = async () => {
        setBusy(true);
        try {
            await createCriterion({ ...d, scoring_basket: d.scoring_basket || null });
            onDone();
            router.refresh();
        } catch (e: any) { alert('Ошибка: ' + e.message); setBusy(false); }
    };

    return (
        <div className="border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50/30 grid grid-cols-2 gap-3 mb-4">
            <div className="col-span-2 text-sm font-black text-indigo-900">Новый критерий</div>
            <div>
                <label className={labelCls}>Технический код (латиница)</label>
                <input value={d.key} onChange={e => set('key', e.target.value)} placeholder="script_my_check" className={`${inputCls} font-mono`} />
            </div>
            <div>
                <label className={labelCls}>Категория (группа)</label>
                <input value={d.category} onChange={e => set('category', e.target.value)} placeholder="В конце диалога" className={inputCls} />
            </div>
            <div className="col-span-2">
                <label className={labelCls}>Название (в шапке колонки)</label>
                <input value={d.label} onChange={e => set('label', e.target.value)} className={inputCls} />
            </div>
            <div>
                <label className={labelCls}>Метод оценки</label>
                <select value={d.eval_method} onChange={e => set('eval_method', e.target.value)} className={inputCls}>
                    {Object.entries(EVAL_METHODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </div>
            <div>
                <label className={labelCls}>Корзина балла</label>
                <select value={d.scoring_basket} onChange={e => set('scoring_basket', e.target.value)} className={inputCls}>
                    {Object.entries(BASKETS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </div>
            {d.eval_method === 'ai_script' && (
                <div className="col-span-2">
                    <label className={labelCls}>Инструкция (промпт) для ИИ</label>
                    <textarea value={d.ai_prompt} onChange={e => set('ai_prompt', e.target.value)} className={`${inputCls} min-h-[70px] resize-y`} placeholder="Что проверять в диалоге. true — выполнено, false — нет." />
                </div>
            )}
            <div className="col-span-2 flex justify-end gap-2">
                <button onClick={onDone} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-800">Отмена</button>
                <button onClick={create} disabled={busy} className="px-5 py-2 text-xs font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-40">{busy ? 'Создание…' : 'Создать критерий'}</button>
            </div>
        </div>
    );
}

export default function CriteriaAdmin({ initial }: { initial: Criterion[] }) {
    const router = useRouter();
    const [adding, setAdding] = useState(false);
    const list = [...initial].sort((a, b) => a.sort_order - b.sort_order);

    const move = async (i: number, dir: -1 | 1) => {
        const next = [...list];
        const j = i + dir;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        try { await reorderCriteria(next.map(c => c.key)); router.refresh(); }
        catch (e: any) { alert('Ошибка перестановки: ' + e.message); }
    };

    // группировка по категории для визуальных заголовков (порядок — по sort_order)
    const seen = new Set<string>();
    const categoryOrder: string[] = [];
    for (const c of list) if (!seen.has(c.category)) { seen.add(c.category); categoryOrder.push(c.category); }

    return (
        <div className="w-full px-4 py-6 md:px-6 md:py-8 max-w-4xl">
            <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                    <Link href="/okk" className="text-sm text-gray-500 hover:text-gray-900 mb-2 block">← Назад к таблице качества</Link>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Критерии «Контроля качества»</h1>
                    <p className="mt-2 text-sm text-gray-600">Добавляйте, редактируйте и отключайте критерии-колонки. Скрипт-критерии оцениваются ИИ по диалогу — промпт редактируется здесь.</p>
                </div>
                {!adding && (
                    <button onClick={() => setAdding(true)} className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md transition-colors">+ Добавить критерий</button>
                )}
            </div>

            {adding && <AddForm onDone={() => setAdding(false)} />}

            <div className="space-y-6">
                {categoryOrder.map(cat => (
                    <div key={cat}>
                        <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2 px-1">{cat}</h2>
                        <div className="space-y-2">
                            {list.filter(c => c.category === cat).map((c) => {
                                const globalIndex = list.findIndex(x => x.key === c.key);
                                return <CriterionRow key={c.key} c={c} index={globalIndex} total={list.length} onMove={move} />;
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-8 p-4 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-800">
                <span className="font-bold">Важно:</span> критерии с методом «Системный» считаются логикой в коде (привязка по тех. коду) — у них редактируются название/категория/порядок/видимость, но не сама проверка. Скрипт-критерии (ИИ по диалогу) полностью настраиваются промптом. Изменения влияют на таблицу качества и на итоговый балл (а значит и на зарплату) — меняйте осознанно.
            </div>
        </div>
    );
}
