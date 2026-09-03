'use client';

import { useEffect, useState } from 'react';
import { EMPTY_FILTER, isFilterEmpty, type OrdersFilter } from '@/lib/orders-filter';

interface Option { value: string; label: string }

interface OrdersFilterPanelProps {
    value: OrdersFilter;
    managers: Option[];
    statuses: Option[];
    onApply: (filter: OrdersFilter) => void;
}

interface Preset { id: string; name: string; filters: Partial<OrdersFilter>; owner_user_id: string | null }

/**
 * Панель фильтров списка заказов — перенос экрана «Заказы» RetailCRM.
 * Поля и порядок повторяют их панель, чтобы менеджеры не переучивались.
 */
export default function OrdersFilterPanel({ value, managers, statuses, onApply }: OrdersFilterPanelProps) {
    const [open, setOpen] = useState(true);
    const [draft, setDraft] = useState<OrdersFilter>(value);
    const [options, setOptions] = useState<{ categories: Option[]; sferas: Option[] }>({ categories: [], sferas: [] });
    const [presets, setPresets] = useState<Preset[]>([]);
    const [savingPreset, setSavingPreset] = useState(false);

    useEffect(() => { setDraft(value); }, [value]);

    useEffect(() => {
        fetch('/api/okk/filter-options')
            .then((r) => r.json())
            .then((d) => setOptions({ categories: d.categories || [], sferas: d.sferas || [] }))
            .catch(() => undefined);
        loadPresets();
    }, []);

    const loadPresets = () => {
        fetch('/api/okk/filter-presets')
            .then((r) => r.json())
            .then((d) => setPresets(d.presets || []))
            .catch(() => undefined);
    };

    const set = (patch: Partial<OrdersFilter>) => setDraft({ ...draft, ...patch });

    const savePreset = async () => {
        const name = prompt('Название фильтра — как в панели RetailCRM, например «Заказы на завтра»');
        if (!name?.trim()) return;
        setSavingPreset(true);
        try {
            await fetch('/api/okk/filter-presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), filters: draft, shared: true }),
            });
            loadPresets();
        } finally {
            setSavingPreset(false);
        }
    };

    const applyPreset = (preset: Preset) => {
        const next = { ...EMPTY_FILTER, ...preset.filters } as OrdersFilter;
        setDraft(next);
        onApply(next);
    };

    return (
        <div className="border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between px-3 py-2">
                <button onClick={() => setOpen((v) => !v)} className="text-xs font-black uppercase tracking-widest text-gray-500 hover:text-gray-900">
                    {open ? 'Свернуть фильтр' : 'Развернуть фильтр'}
                </button>
                {!isFilterEmpty(value) && (
                    <span className="bg-blue-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">Фильтр применён</span>
                )}
            </div>

            {open && (
                <div className="px-3 pb-3">
                    <div className="grid gap-x-3 gap-y-2 md:grid-cols-3 lg:grid-cols-5">
                        <Field label="Номер заказа">
                            <Text value={draft.number} onChange={(v) => set({ number: v })} />
                        </Field>
                        <Field label="Покупатель">
                            <Text value={draft.customer} onChange={(v) => set({ customer: v })} placeholder="ФИО или телефон или email" />
                        </Field>
                        <Field label="Менеджеры">
                            <Multi options={managers} selected={draft.managers} onChange={(v) => set({ managers: v })} />
                        </Field>
                        <Field label="Пометки">
                            <div className="flex gap-1">
                                {[{ v: 'vip', l: 'VIP' }, { v: 'bad', l: 'BAD' }].map((m) => (
                                    <button
                                        key={m.v}
                                        onClick={() => set({ marks: draft.marks.includes(m.v) ? draft.marks.filter((x) => x !== m.v) : [...draft.marks, m.v] })}
                                        className={`px-2 py-1.5 text-xs font-bold ${draft.marks.includes(m.v) ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                                    >
                                        {m.l}
                                    </button>
                                ))}
                            </div>
                        </Field>
                        <Field label="Сумма заказа, ₽">
                            <div className="flex items-center gap-1">
                                <Text value={draft.sumFrom} onChange={(v) => set({ sumFrom: v })} placeholder="от" />
                                <span className="text-gray-400">–</span>
                                <Text value={draft.sumTo} onChange={(v) => set({ sumTo: v })} placeholder="до" />
                            </div>
                        </Field>

                        <Field label="Статус заказа">
                            <Multi options={statuses} selected={draft.statuses} onChange={(v) => set({ statuses: v })} />
                        </Field>
                        <Field label="Категория товара">
                            <Multi options={options.categories} selected={draft.categories} onChange={(v) => set({ categories: v })} />
                        </Field>
                        <Field label="Сфера деятельности">
                            <Multi options={options.sferas} selected={draft.sferas} onChange={(v) => set({ sferas: v })} />
                        </Field>
                        <Field label="Контроль">
                            <select
                                value={draft.control}
                                onChange={(e) => set({ control: e.target.value })}
                                className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                            >
                                <option value="">Любой</option>
                                <option value="yes">На контроле</option>
                                <option value="no">Без контроля</option>
                            </select>
                        </Field>
                        <Field label="Наименование контрагента">
                            <Text value={draft.contragent} onChange={(v) => set({ contragent: v })} />
                        </Field>

                        <Field label="Дата следующего контакта">
                            <DateRange from={draft.contactFrom} to={draft.contactTo} onFrom={(v) => set({ contactFrom: v })} onTo={(v) => set({ contactTo: v })} />
                        </Field>
                        <Field label="Дата оформления заказа">
                            <DateRange from={draft.createdFrom} to={draft.createdTo} onFrom={(v) => set({ createdFrom: v })} onTo={(v) => set({ createdTo: v })} />
                        </Field>
                        <Field label="В каком месяце планируете закупку">
                            <DateRange from={draft.purchaseFrom} to={draft.purchaseTo} onFrom={(v) => set({ purchaseFrom: v })} onTo={(v) => set({ purchaseTo: v })} />
                        </Field>
                        <Field label="Комментарий оператора">
                            <Text value={draft.managerComment} onChange={(v) => set({ managerComment: v })} />
                        </Field>
                        <Field label="Комментарий клиента">
                            <Text value={draft.customerComment} onChange={(v) => set({ customerComment: v })} />
                        </Field>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button onClick={() => onApply(draft)} className="bg-gray-900 px-4 py-2 text-sm font-black text-white hover:bg-blue-600">
                            Применить
                        </button>
                        <button
                            onClick={() => { setDraft(EMPTY_FILTER); onApply(EMPTY_FILTER); }}
                            className="border border-gray-300 px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-900 hover:text-white"
                        >
                            Сбросить
                        </button>
                        <button
                            onClick={savePreset}
                            disabled={savingPreset || isFilterEmpty(draft)}
                            className="border border-blue-600 px-3 py-2 text-sm font-bold text-blue-600 hover:bg-blue-600 hover:text-white disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
                        >
                            Сохранить фильтр
                        </button>

                        {presets.length > 0 && <span className="mx-1 h-5 w-px bg-gray-200" />}

                        {presets.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => applyPreset(p)}
                                title={p.owner_user_id ? 'Личный фильтр' : 'Общий фильтр отдела'}
                                className="border border-gray-300 px-2 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-900 hover:text-white"
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
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

function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
        />
    );
}

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
    return (
        <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-full border border-gray-300 px-1.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none" />
            <span className="text-gray-400">–</span>
            <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-full border border-gray-300 px-1.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none" />
        </div>
    );
}

function Multi({ options, selected, onChange }: { options: Option[]; selected: string[]; onChange: (v: string[]) => void }) {
    const [open, setOpen] = useState(false);
    const label = selected.length === 0
        ? 'Выберите значения'
        : options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(', ') || `Выбрано: ${selected.length}`;

    return (
        <div className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full truncate border border-gray-300 px-2 py-1.5 text-left text-sm hover:border-blue-600"
            >
                <span className={selected.length ? 'text-gray-900' : 'text-gray-400'}>{label}</span>
            </button>
            {open && (
                <div className="absolute z-30 mt-1 max-h-64 w-full min-w-[220px] overflow-y-auto border border-gray-300 bg-white">
                    {options.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-gray-500">Значений нет</p>
                    ) : (
                        options.map((o) => (
                            <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-blue-600 hover:text-white">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(o.value)}
                                    onChange={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                                />
                                {o.label}
                            </label>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
