'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// База стилей текстового инпута (как у <Input>), чтобы NumberInput выглядел идентично.
const numCls = 'flex h-10 w-full rounded-none border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const KEY_LABELS: Record<string, string> = {
    oklad: 'Оклад (₽/мес)',
    rate_zayavka: 'Ставка за закрытую заявку (₽)',
    k_quality_tiers: 'К_качества — тиры по скорингу',
    conv_bonus_tiers: 'Конв-бонус — тиры по конверсии',
    conv_min_zayavki: 'Минимум заявок для допуска к конв-бонусу',
    discount_bonus: 'Бонус за скидочную дисциплину',
    duty_rate: 'Ставка дежурства (₽/смена)',
    k_team_tiers: 'К_команды — тиры по выручке отдела',
    closing_status: 'Статус «закрытия» (вход в базу ФОТ)',
    permanent_client_threshold: 'Порог «постоянного клиента»',
    source_exclusions: 'Источники-исключения',
    nds_normalization: 'Нормализация НДС',
};
const todayStr = () => new Date().toISOString().slice(0, 10);

type Opt = { code: string; name: string };
type Dicts = { statuses: Opt[]; orderMethods: Opt[]; categories: Opt[] };

export default function BaseConfigTab() {
    const [config, setConfig] = useState<Record<string, any>>({});
    const [effDates, setEffDates] = useState<Record<string, string>>({});
    const [keys, setKeys] = useState<string[]>([]);
    const [dicts, setDicts] = useState<Dicts>({ statuses: [], orderMethods: [], categories: [] });
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const { toast } = useToast();

    const fetchConfig = useCallback(async () => {
        try {
            const res = await fetch('/api/salary/config?asOf=' + todayStr());
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setConfig(data.config);
            setKeys(data.keys);
            const dates: Record<string, string> = {};
            for (const k of data.keys) dates[k] = todayStr();
            setEffDates(dates);
            const dRes = await fetch('/api/salary/dictionaries').then((r) => r.json()).catch(() => null);
            if (dRes && !dRes.error) setDicts({ statuses: dRes.statuses ?? [], orderMethods: dRes.orderMethods ?? [], categories: dRes.categories ?? [] });
        } catch (e: any) {
            toast({ title: 'Ошибка загрузки конфига', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);
    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    const setValue = (key: string, value: any) => setConfig((c) => ({ ...c, [key]: value }));
    const save = async (key: string) => {
        setSavingKey(key);
        try {
            const res = await fetch('/api/salary/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: config[key], effectiveFrom: effDates[key] }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
            toast({ title: 'Сохранено', description: `${KEY_LABELS[key] || key} (с ${effDates[key]})` });
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setSavingKey(null);
        }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    return (
        <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Базовые параметры для сбора данных (статус закрытия, исключения, НДС) и значения по умолчанию. Меняются с указанной даты.</p>
            <div className="grid gap-2 md:grid-cols-2">
                {keys.map((key) => (
                    <div key={key} className="border p-3">
                        <div className="mb-2 flex items-baseline gap-2">
                            <span className="text-sm font-semibold">{KEY_LABELS[key] || key}</span>
                        </div>
                        <KeyEditor configKey={key} value={config[key]} onChange={(v) => setValue(key, v)} dicts={dicts} />
                        <div className="mt-2 flex items-center gap-2 border-t pt-2">
                            <label className="text-[11px] text-muted-foreground">с</label>
                            <Input type="date" value={effDates[key] || todayStr()} onChange={(e) => setEffDates((d) => ({ ...d, [key]: e.target.value }))} className="h-8 w-36 text-xs" />
                            <Button size="sm" onClick={() => save(key)} disabled={savingKey === key} className="ml-auto h-8">
                                {savingKey === key ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />} Сохранить
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function KeyEditor({ configKey, value, onChange, dicts }: { configKey: string; value: any; onChange: (v: any) => void; dicts: Dicts }) {
    // Поля-справочники — выбор по именам из RetailCRM, не коды (закон).
    if (configKey === 'closing_status') {
        return <SelectByName options={dicts.statuses} value={value?.code || ''} onChange={(code) => onChange({ ...value, code })} placeholder="— выберите статус —" />;
    }
    if (configKey === 'source_exclusions') {
        return <MultiSelectByName options={dicts.orderMethods} selected={Array.isArray(value) ? value : []} onChange={onChange} empty="источники не выбраны" />;
    }
    if (typeof value === 'number') return <NumberInput value={value} emptyValue={0} maxFractionDigits={2} onChange={(v) => onChange(v ?? 0)} className={`${numCls} h-8 w-40 text-sm text-right`} />;
    if (Array.isArray(value) && value.length && typeof value[0] === 'object' && 'min' in value[0]) {
        const valueField = 'k' in value[0] ? 'k' : 'bonus';
        return <TierEditor rows={value} valueField={valueField as 'k' | 'bonus'} onChange={onChange} />;
    }
    if (Array.isArray(value)) return <StringListEditor items={value as string[]} onChange={onChange} />;
    if (configKey === 'rate_zayavka') {
        return (
            <div className="grid grid-cols-2 gap-2">
                {(['new', 'permanent'] as const).map((f) => (
                    <div key={f}>
                        <label className="text-[11px] text-muted-foreground">{f === 'new' ? 'Новый' : 'Постоянный'}</label>
                        <NumberInput value={value[f]} emptyValue={0} maxFractionDigits={2} onChange={(v) => onChange({ ...value, [f]: v ?? 0 })} className={`${numCls} h-8 text-sm text-right`} />
                    </div>
                ))}
            </div>
        );
    }
    if (configKey === 'discount_bonus') {
        return (
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="text-[11px] text-muted-foreground">Метрика</label>
                    <select className="h-8 w-full border border-input bg-background px-2 text-xs" value={value.metric || ''} onChange={(e) => onChange({ ...value, metric: e.target.value })}>
                        <option value="avg_order_discount_pct">Средневзв. % скидки</option>
                        <option value="share_orders_no_discount">Доля без скидки, %</option>
                    </select>
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Условие</label>
                    <select className="h-8 w-full border border-input bg-background px-2 text-xs" value={value.comparator} onChange={(e) => onChange({ ...value, comparator: e.target.value })}>
                        <option value="lte">≤ порога</option>
                        <option value="gte">≥ порога</option>
                    </select>
                </div>
                <div><label className="text-[11px] text-muted-foreground">Порог</label><NumberInput value={value.threshold} emptyValue={0} maxFractionDigits={2} onChange={(v) => onChange({ ...value, threshold: v ?? 0 })} className={`${numCls} h-8 text-sm text-right`} /></div>
                <div><label className="text-[11px] text-muted-foreground">Бонус (₽)</label><NumberInput value={value.bonus} emptyValue={0} onChange={(v) => onChange({ ...value, bonus: v ?? 0 })} className={`${numCls} h-8 text-sm text-right`} /></div>
            </div>
        );
    }
    if (configKey === 'nds_normalization') {
        const rules = value.rules || [];
        const update = (i: number, field: 'vat_pct' | 'divisor', v: number) => onChange({ rules: rules.map((r: any, idx: number) => (idx === i ? { ...r, [field]: v } : r)) });
        return (
            <div className="space-y-1.5">
                {rules.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">НДС%</span>
                        <NumberInput value={r.vat_pct} emptyValue={0} onChange={(v) => update(i, 'vat_pct', v ?? 0)} className={`${numCls} h-8 w-20 text-sm text-right`} />
                        <span className="text-[11px] text-muted-foreground">÷</span>
                        <NumberInput value={r.divisor} emptyValue={0} maxFractionDigits={2} onChange={(v) => update(i, 'divisor', v ?? 0)} className={`${numCls} h-8 w-20 text-sm text-right`} />
                        <button onClick={() => onChange({ rules: rules.filter((_: any, idx: number) => idx !== i) })} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                ))}
                <Button variant="outline" size="sm" className="h-7" onClick={() => onChange({ rules: [...rules, { vat_pct: 0, divisor: 1 }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Правило</Button>
            </div>
        );
    }
    return <pre className="bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

function TierEditor({ rows, valueField, onChange }: { rows: any[]; valueField: 'k' | 'bonus'; onChange: (v: any[]) => void }) {
    const update = (i: number, field: string, v: number) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
    return (
        <div className="space-y-1.5">
            <div className="flex gap-1.5 text-[11px] text-muted-foreground"><span className="w-24">от (min)</span><span className="w-24">{valueField === 'k' ? 'коэфф.' : 'бонус ₽'}</span></div>
            {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <NumberInput value={r.min} emptyValue={0} onChange={(v) => update(i, 'min', v ?? 0)} className={`${numCls} h-8 w-24 text-sm text-right`} />
                    <NumberInput value={r[valueField]} emptyValue={0} maxFractionDigits={valueField === 'k' ? 2 : 0} onChange={(v) => update(i, valueField, v ?? 0)} className={`${numCls} h-8 w-24 text-sm text-right`} />
                    <button onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
            ))}
            <Button variant="outline" size="sm" className="h-7" onClick={() => onChange([...rows, { min: 0, [valueField]: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" /> Тир</Button>
        </div>
    );
}

function StringListEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
    return (
        <div className="space-y-1.5">
            {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <Input value={it} onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))} className="h-8 font-mono text-xs" />
                    <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
            ))}
            <Button variant="outline" size="sm" className="h-7" onClick={() => onChange([...items, ''])}><Plus className="mr-1 h-3.5 w-3.5" /> Значение</Button>
        </div>
    );
}

// Выбор одного значения по имени из справочника RetailCRM (значение хранится кодом).
function SelectByName({ options, value, onChange, placeholder }: { options: { code: string; name: string }[]; value: string; onChange: (code: string) => void; placeholder?: string }) {
    const known = options.some((o) => o.code === value);
    return (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full border border-input bg-background px-2 text-sm">
            <option value="">{placeholder || '— выберите —'}</option>
            {!known && value ? <option value={value}>{value} (нет в справочнике)</option> : null}
            {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
        </select>
    );
}

// Выбор нескольких значений по именам из справочника RetailCRM (хранятся кодами).
function MultiSelectByName({ options, selected, onChange, empty }: { options: { code: string; name: string }[]; selected: string[]; onChange: (v: string[]) => void; empty?: string }) {
    const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
    const nameByCode = new Map(options.map((o) => [o.code, o.name]));
    const orphans = selected.filter((c) => !nameByCode.has(c)); // коды, которых уже нет в справочнике
    return (
        <div className="space-y-1">
            <div className="max-h-44 space-y-0.5 overflow-y-auto border p-1.5">
                {options.length === 0 ? <div className="text-[11px] text-muted-foreground">Справочник пуст — выполните синк RetailCRM.</div> : null}
                {options.map((o) => (
                    <label key={o.code} className="flex cursor-pointer items-center gap-2 text-xs">
                        <input type="checkbox" checked={selected.includes(o.code)} onChange={() => toggle(o.code)} className="h-3.5 w-3.5 accent-primary" />
                        <span>{o.name}</span>
                    </label>
                ))}
            </div>
            {orphans.length > 0 && (
                <div className="text-[10px] text-amber-600">Нет в справочнике (снимутся при сохранении): {orphans.join(', ')}</div>
            )}
            <div className="text-[10px] text-muted-foreground">{selected.length ? `Выбрано: ${selected.length}` : (empty || 'ничего не выбрано')}</div>
        </div>
    );
}
