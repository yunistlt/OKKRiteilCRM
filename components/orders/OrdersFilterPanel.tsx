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
        <div className="bg-white px-6 pb-4">
            <button onClick={() => setOpen((v) => !v)} className="mb-3 text-sm text-blue-600 hover:underline">
                {open ? 'Свернуть фильтр ⌃' : 'Развернуть фильтр ⌄'}
            </button>

            {open && (
                <>
                    <div className="grid gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-5">
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
                                <div className="flex gap-2">
                                    {[{ v: 'vip', l: 'VIP' }, { v: 'bad', l: 'BAD' }].map((m) => (
                                        <button
                                            key={m.v}
                                            onClick={() => set({ marks: draft.marks.includes(m.v) ? draft.marks.filter((x) => x !== m.v) : [...draft.marks, m.v] })}
                                            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
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
                                <div className="flex items-center gap-2">
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
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
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
                    </div>

                    <div className="mt-5 flex flex-wrap items-start gap-3">
                        <button
                            onClick={() => onApply(draft)}
                            className="rounded-md border border-gray-300 bg-gray-50 px-6 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                        >
                            Применить
                        </button>
                        <button
                            onClick={() => { setDraft(EMPTY_FILTER); onApply(EMPTY_FILTER); }}
                            title="Сбросить фильтр"
                            className="rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-lg leading-none text-red-500 hover:bg-gray-100"
                        >
                            ✕
                        </button>
                        <button
                            onClick={() => setFieldsOpen(true)}
                            title="Выбрать поля фильтра"
                            className="px-2 py-2 text-xl leading-none text-blue-600 hover:text-blue-700"
                        >
                            ⚙
                        </button>

                        {(presets.length > 0 || !isFilterEmpty(draft)) && (
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                                {presets.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => { const next = { ...EMPTY_FILTER, ...p.filters } as OrdersFilter; setDraft(next); onApply(next); }}
                                        title={p.owner_user_id ? 'Личный фильтр' : 'Общий фильтр отдела'}
                                        className="text-sm text-gray-700 hover:text-blue-600"
                                    >
                                        {p.name}
                                    </button>
                                ))}
                                {!isFilterEmpty(draft) && (
                                    <button onClick={savePreset} className="ml-auto text-sm text-blue-600 hover:underline">
                                        Сохранить фильтр
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </>
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
            <label className="mb-1.5 block text-sm text-gray-500">{label}</label>
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
    );
}

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
    return (
        <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none" />
            <span className="text-gray-400">—</span>
            <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none" />
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
                className="w-full truncate rounded-md border border-gray-300 px-3 py-2 text-left text-sm hover:border-blue-500"
            >
                <span className={selected.length ? 'text-gray-800' : 'text-gray-400'}>{label}</span>
            </button>
            {open && (
                <div className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {options.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-gray-500">Значений нет</p>
                    ) : (
                        options.map((o) => (
                            <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(o.value)}
                                    onChange={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
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
