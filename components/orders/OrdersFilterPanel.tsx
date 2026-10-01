'use client';

import { useEffect, useState } from 'react';
import ViewSettingsModal from './ViewSettingsModal';
import { EMPTY_FILTER, isFilterEmpty, type OrdersFilter } from '@/lib/orders-filter';
import { FILTER_FIELDS, DEFAULT_FILTER_FIELDS, normalizeSelection } from '@/lib/orders-view';

interface Option { value: string; label: string }

interface OrdersFilterPanelProps {
    value: OrdersFilter;
    managers: Option[];
    statuses: Option[];
    onApply: (filter: OrdersFilter) => void;
}

interface Preset { id: string; name: string; filters: Partial<OrdersFilter>; owner_user_id: string | null }

/**
 * Панель фильтров списка заказов — повторяет экран «Заказы» RetailCRM: те же поля,
 * тот же порядок, полоса сохранённых фильтров справа и шестерёнка выбора полей.
 */
export default function OrdersFilterPanel({ value, managers, statuses, onApply }: OrdersFilterPanelProps) {
    const [open, setOpen] = useState(true);
    const [draft, setDraft] = useState<OrdersFilter>(value);
    const [options, setOptions] = useState<{ categories: Option[]; sferas: Option[] }>({ categories: [], sferas: [] });
    const [presets, setPresets] = useState<Preset[]>([]);
    const [fields, setFields] = useState<string[]>(DEFAULT_FILTER_FIELDS);
    const [fieldsOpen, setFieldsOpen] = useState(false);

    useEffect(() => { setDraft(value); }, [value]);

    useEffect(() => {
        fetch('/api/okk/filter-options')
            .then((r) => r.json())
            .then((d) => setOptions({ categories: d.categories || [], sferas: d.sferas || [] }))
            .catch(() => undefined);

        fetch('/api/settings/view?viewKey=orders.filters')
            .then((r) => r.json())
            .then((d) => setFields(normalizeSelection(d.settings?.items, FILTER_FIELDS, DEFAULT_FILTER_FIELDS)))
            .catch(() => undefined);

        loadPresets();
    }, []);

    const loadPresets = () => {
        fetch('/api/okk/filter-presets')
            .then((r) => r.json())
            .then((d) => setPresets(d.presets || []))
            .catch(() => undefined);
    };

    const saveFields = async (next: string[]) => {
        setFields(next);
        setFieldsOpen(false);
        await fetch('/api/settings/view', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewKey: 'orders.filters', settings: { items: next } }),
        }).catch(() => undefined);
    };

    const set = (patch: Partial<OrdersFilter>) => setDraft({ ...draft, ...patch });

    const savePreset = async () => {
        const name = prompt('Название фильтра — например «Заказы на завтра»');
        if (!name?.trim()) return;
        await fetch('/api/okk/filter-presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), filters: draft, shared: true }),
        }).catch(() => undefined);
        loadPresets();
    };

    const show = (key: string) => fields.includes(key);

    return (
        /* Высоту не режем: прокрутка внутри шапки неудобна, а полей человек
           выбирает столько, сколько ему нужно. Держим плотность — мелкие
           подписи, узкие поля, шесть колонок (решение владельца 01.10.2026). */
        <div className="flex flex-col bg-white px-4 pb-2">
            <button onClick={() => setOpen((v) => !v)} className="mb-1 shrink-0 self-start text-[11px] uppercase tracking-wide text-blue-600 hover:underline">
                {open ? 'Свернуть фильтр ⌃' : 'Развернуть фильтр ⌄'}
            </button>

            {open && (
                <div className="flex flex-col">
                    <div className="grid gap-x-3 gap-y-1.5 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7">
                        {show('number') && (
                            <Field label="Номер заказа"><Text value={draft.number} onChange={(v) => set({ number: v })} /></Field>
                        )}
                        {show('customer') && (
                            <Field label="Покупатель"><Text value={draft.customer} onChange={(v) => set({ customer: v })} placeholder="ФИО или телефон или email" /></Field>
                        )}
                        {show('managers') && (
                            <Field label="Менеджеры"><Multi options={managers} selected={draft.managers} onChange={(v) => set({ managers: v })} /></Field>
                        )}
                        {show('marks') && (
                            <Field label="Пометки">
                                <div className="flex gap-1">
                                    {[{ v: 'vip', l: 'VIP' }, { v: 'bad', l: 'BAD' }].map((m) => (
                                        <button
                                            key={m.v}
                                            onClick={() => set({ marks: draft.marks.includes(m.v) ? draft.marks.filter((x) => x !== m.v) : [...draft.marks, m.v] })}
                                            className={`px-2 py-1 text-[11px] font-semibold ${
                                                draft.marks.includes(m.v) ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-500 hover:bg-gray-50'
                                            }`}
                                        >
                                            {m.l}
                                        </button>
                                    ))}
                                </div>
                            </Field>
                        )}
                        {show('sum') && (
                            <Field label="Сумма заказа, ₽">
                                <div className="flex items-center gap-1">
                                    <Text value={draft.sumFrom} onChange={(v) => set({ sumFrom: v })} placeholder="от" />
                                    <span className="text-gray-400">—</span>
                                    <Text value={draft.sumTo} onChange={(v) => set({ sumTo: v })} placeholder="до" />
                                </div>
                            </Field>
                        )}
                        {show('statuses') && (
                            <Field label="Статус заказа"><Multi options={statuses} selected={draft.statuses} onChange={(v) => set({ statuses: v })} /></Field>
                        )}
                        {show('categories') && (
                            <Field label="Категория товара*"><Multi options={options.categories} selected={draft.categories} onChange={(v) => set({ categories: v })} /></Field>
                        )}
                        {show('sferas') && (
                            <Field label="Сфера деятельности*"><Multi options={options.sferas} selected={draft.sferas} onChange={(v) => set({ sferas: v })} /></Field>
                        )}
                        {show('control') && (
                            <Field label="КОНТРОЛЬ">
                                <select
                                    value={draft.control}
                                    onChange={(e) => set({ control: e.target.value })}
                                    className="w-full border border-gray-300 px-2 py-1 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                                >
                                    <option value="">Любой</option>
                                    <option value="yes">На контроле</option>
                                    <option value="no">Без контроля</option>
                                </select>
                            </Field>
                        )}
                        {show('contragent') && (
                            <Field label="Наименование контрагента"><Text value={draft.contragent} onChange={(v) => set({ contragent: v })} /></Field>
                        )}
                        {show('contact') && (
                            <Field label="Дата следующего контакта">
                                <DateRange from={draft.contactFrom} to={draft.contactTo} onFrom={(v) => set({ contactFrom: v })} onTo={(v) => set({ contactTo: v })} />
                            </Field>
                        )}
                        {show('created') && (
                            <Field label="Дата оформления заказа">
                                <DateRange from={draft.createdFrom} to={draft.createdTo} onFrom={(v) => set({ createdFrom: v })} onTo={(v) => set({ createdTo: v })} />
                            </Field>
                        )}
                        {show('purchase') && (
                            <Field label="В каком месяце планируете закупку?">
                                <DateRange from={draft.purchaseFrom} to={draft.purchaseTo} onFrom={(v) => set({ purchaseFrom: v })} onTo={(v) => set({ purchaseTo: v })} />
                            </Field>
                        )}
                        {show('managerComment') && (
                            <Field label="Комментарий оператора"><Text value={draft.managerComment} onChange={(v) => set({ managerComment: v })} /></Field>
                        )}
                        {show('customerComment') && (
                            <Field label="Комментарий клиента"><Text value={draft.customerComment} onChange={(v) => set({ customerComment: v })} /></Field>
                        )}
                        {show('overdueOnly') && (
                            <Field label="Норматив времени">
                                <label className="flex cursor-pointer items-center gap-1.5 py-1 text-xs text-gray-800">
                                    <input
                                        type="checkbox"
                                        checked={draft.overdueOnly}
                                        onChange={(e) => set({ overdueOnly: e.target.checked })}
                                        className="h-3.5 w-3.5 border-gray-300 text-blue-600"
                                    />
                                    Только просроченные
                                </label>
                            </Field>
                        )}
                    </div>

                    <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
                        <button
                            onClick={() => onApply(draft)}
                            className="border border-gray-300 bg-gray-50 px-4 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-100"
                        >
                            Применить
                        </button>
                        <button
                            onClick={() => { setDraft(EMPTY_FILTER); onApply(EMPTY_FILTER); }}
                            title="Сбросить фильтр"
                            className="border border-gray-300 bg-gray-50 px-2 py-1 text-sm leading-none text-red-500 hover:bg-gray-100"
                        >
                            ✕
                        </button>
                        <button
                            onClick={() => setFieldsOpen(true)}
                            title="Выбрать поля фильтра"
                            className="px-1 py-1 text-base leading-none text-blue-600 hover:text-blue-700"
                        >
                            ⚙
                        </button>

                        {(presets.length > 0 || !isFilterEmpty(draft)) && (
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 border border-gray-200 bg-gray-50 px-2 py-1">
                                {presets.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => { const next = { ...EMPTY_FILTER, ...p.filters } as OrdersFilter; setDraft(next); onApply(next); }}
                                        title={p.owner_user_id ? 'Личный фильтр' : 'Общий фильтр отдела'}
                                        className="text-xs text-gray-700 hover:text-blue-600"
                                    >
                                        {p.name}
                                    </button>
                                ))}
                                {!isFilterEmpty(draft) && (
                                    <button onClick={savePreset} className="ml-auto text-xs text-blue-600 hover:underline">
                                        Сохранить фильтр
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {fieldsOpen && (
                <ViewSettingsModal
                    title="Фильтры"
                    registry={FILTER_FIELDS}
                    selected={fields}
                    defaults={DEFAULT_FILTER_FIELDS}
                    onSave={saveFields}
                    onClose={() => setFieldsOpen(false)}
                />
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="mb-0.5 block truncate text-[10px] uppercase tracking-wide text-gray-500" title={label}>{label}</label>
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
            className="w-full border border-gray-300 px-2 py-1 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
    );
}

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
    return (
        <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-full min-w-0 border border-gray-300 px-1 py-1 text-xs text-gray-800 focus:border-blue-500 focus:outline-none" />
            <span className="text-[10px] text-gray-400">—</span>
            <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-full min-w-0 border border-gray-300 px-1 py-1 text-xs text-gray-800 focus:border-blue-500 focus:outline-none" />
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
                className="w-full truncate border border-gray-300 px-2 py-1 text-left text-xs hover:border-blue-500"
            >
                <span className={selected.length ? 'text-gray-800' : 'text-gray-400'}>{label}</span>
            </button>
            {open && (
                <div className="absolute z-30 mt-0.5 max-h-60 w-full min-w-[220px] overflow-y-auto border border-gray-200 bg-white shadow-lg">
                    {options.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-gray-500">Значений нет</p>
                    ) : (
                        options.map((o) => (
                            <label key={o.value} className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-gray-800 hover:bg-gray-50">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(o.value)}
                                    onChange={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                                    className="h-3.5 w-3.5 border-gray-300 text-blue-600"
                                />
                                <span className="truncate">{o.label}</span>
                            </label>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
