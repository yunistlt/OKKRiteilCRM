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
    closing_status: 'Статус «закрытия» (вход в базу ФОТ)',
    permanent_client_threshold: 'Порог «постоянного клиента»',
    source_exclusions: 'Источники-исключения',
    tender_duplicate_rule: 'Дубль на тендер (вне знаменателя конверсии)',
    nds_normalization: 'Нормализация НДС',
    vat_policy: 'НДС по витрине (ЗВТО — без НДС)',
};

// Эти параметры редактируются ТОЛЬКО в блоках ролей (вкладка «Схемы (роли)») —
// именно блоки роли считают ЗП. Здесь они были «значениями по умолчанию» старой
// версии модуля и в расчёте фактически не участвуют, поэтому из базовых параметров
// убраны, чтобы одно значение не правилось в двух местах. В базовых параметрах
// остаются только сквозные настройки сбора данных/классификации, которых в ролях нет.
const ROLE_BLOCK_KEYS = new Set<string>([
    'oklad', 'rate_zayavka', 'k_quality_tiers', 'conv_bonus_tiers',
    'conv_min_zayavki', 'discount_bonus', 'duty_rate', 'k_team_tiers',
]);
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
            <p className="text-xs text-muted-foreground">Сквозные настройки сбора данных и классификации (статус закрытия, исключения, постоянный клиент, дубль на тендер, НДС). Оклад, ставки и тиры задаются в блоках ролей — вкладка «Схемы (роли)» выше. Меняются с указанной даты.</p>
            <div className="grid gap-2 md:grid-cols-2">
                {keys.filter((key) => !ROLE_BLOCK_KEYS.has(key)).map((key) => (
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
    // Дубль на тендер: статус-дубль + эталонные статусы (всё по именам из RetailCRM, не кодами).
    if (configKey === 'tender_duplicate_rule') {
        const ref: string[] = Array.isArray(value?.reference_statuses) ? value.reference_statuses : [];
        return (
            <div className="space-y-2">
                <div>
                    <label className="text-[11px] text-muted-foreground">Статус дубля (на тендер)</label>
                    <SelectByName options={dicts.statuses} value={value?.duplicate_status || ''} onChange={(code) => onChange({ ...value, duplicate_status: code })} placeholder="— выберите статус —" />
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Эталонные статусы (тендер / ожидание выхода)</label>
                    <MultiSelectByName options={dicts.statuses} selected={ref} onChange={(v) => onChange({ ...value, reference_statuses: v })} empty="статусы не выбраны" />
                </div>
            </div>
        );
    }
    // НДС определяется витриной, а не ставкой из карточки позиции: по умолчанию для всех
    // витрин default_vat_pct, для витрин-исключений (ЗВТО) — без НДС.
    if (configKey === 'vat_policy') {
        const exempt: string[] = Array.isArray(value?.exempt_sites) ? value.exempt_sites : [];
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">Ставка НДС по умолчанию, %</span>
                    <NumberInput value={value?.default_vat_pct ?? 0} emptyValue={0} maxFractionDigits={2} onChange={(v) => onChange({ ...value, default_vat_pct: v ?? 0 })} className={`${numCls} h-8 w-20 text-sm text-right`} />
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Витрины без НДС (код site, напр. ao-zvto)</label>
                    {exempt.map((s, i) => (
                        <div key={i} className="mt-1 flex items-center gap-1.5">
                            <Input value={s} onChange={(e) => onChange({ ...value, exempt_sites: exempt.map((x, idx) => (idx === i ? e.target.value : x)) })} className="h-8 w-48 text-sm" />
                            <button onClick={() => onChange({ ...value, exempt_sites: exempt.filter((_, idx) => idx !== i) })} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" className="mt-1 h-7" onClick={() => onChange({ ...value, exempt_sites: [...exempt, ''] })}><Plus className="mr-1 h-3.5 w-3.5" /> Витрина</Button>
                </div>
            </div>
        );
    }
    if (typeof value === 'number') return <NumberInput value={value} emptyValue={0} maxFractionDigits={2} onChange={(v) => onChange(v ?? 0)} className={`${numCls} h-8 w-40 text-sm text-right`} />;
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
