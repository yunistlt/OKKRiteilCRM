'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// Человекочитаемые подписи ключей конфига
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
    permanent_client_threshold: 'Порог «постоянного клиента» (оплаченных заказов)',
    source_exclusions: 'Источники-исключения (не входящие с сайта)',
    category_pech_vto_map: 'Категории каталога → печь/ВТО',
    nds_normalization: 'Нормализация НДС (для выручки отдела)',
};

const todayStr = () => new Date().toISOString().slice(0, 10);

type ConfigState = Record<string, any>;

export default function SalarySettingsPage() {
    const [config, setConfig] = useState<ConfigState>({});
    const [effDates, setEffDates] = useState<Record<string, string>>({});
    const [keys, setKeys] = useState<string[]>([]);
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
        } catch (e: any) {
            toast({ title: 'Ошибка загрузки конфига', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const setValue = (key: string, value: any) => setConfig((c) => ({ ...c, [key]: value }));

    const save = async (key: string) => {
        setSavingKey(key);
        try {
            const res = await fetch('/api/salary/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value: config[key], effectiveFrom: effDates[key] }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
            toast({ title: 'Сохранено', description: `${KEY_LABELS[key] || key} (с ${effDates[key]})` });
        } catch (e: any) {
            toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
        } finally {
            setSavingKey(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl space-y-4 p-4">
            <div>
                <h1 className="text-2xl font-semibold">Настройки мотивации</h1>
                <p className="text-sm text-muted-foreground">
                    Все ставки, пороги и тиры. Меняются с указанной даты — прошлые периоды считаются по своей версии.
                </p>
            </div>

            {keys.map((key) => (
                <Card key={key}>
                    <CardHeader>
                        <CardTitle className="text-base">{KEY_LABELS[key] || key}</CardTitle>
                        <CardDescription className="font-mono text-xs">{key}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <KeyEditor configKey={key} value={config[key]} onChange={(v) => setValue(key, v)} />
                        <div className="flex items-center gap-2 border-t pt-3">
                            <label className="text-xs text-muted-foreground">Действует с</label>
                            <Input
                                type="date"
                                value={effDates[key] || todayStr()}
                                onChange={(e) => setEffDates((d) => ({ ...d, [key]: e.target.value }))}
                                className="h-9 w-40"
                            />
                            <Button size="sm" onClick={() => save(key)} disabled={savingKey === key} className="ml-auto">
                                {savingKey === key ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="mr-2 h-4 w-4" />
                                )}
                                Сохранить
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

// ── Редакторы по форме значения ─────────────────────────────────────────────

function KeyEditor({ configKey, value, onChange }: { configKey: string; value: any; onChange: (v: any) => void }) {
    // Скаляры-числа
    if (typeof value === 'number') {
        return (
            <Input
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                className="w-48"
            />
        );
    }

    // Тировые шкалы: [{min, k}] или [{min, bonus}]
    if (Array.isArray(value) && value.length && typeof value[0] === 'object' && 'min' in value[0]) {
        const valueField = 'k' in value[0] ? 'k' : 'bonus';
        return <TierEditor rows={value} valueField={valueField} onChange={onChange} />;
    }

    // Списки строк: source_exclusions, category_pech_vto_map
    if (Array.isArray(value)) {
        return (
            <StringListEditor items={value as string[]} onChange={onChange} />
        );
    }

    // rate_zayavka: {new, permanent, pech_vto}
    if (configKey === 'rate_zayavka') {
        return (
            <div className="grid grid-cols-3 gap-3">
                {(['new', 'permanent', 'pech_vto'] as const).map((f) => (
                    <div key={f}>
                        <label className="text-xs text-muted-foreground">
                            {f === 'new' ? 'Новый' : f === 'permanent' ? 'Постоянный' : 'Печь/ВТО'}
                        </label>
                        <Input
                            type="number"
                            value={value[f]}
                            onChange={(e) => onChange({ ...value, [f]: Number(e.target.value) })}
                        />
                    </div>
                ))}
            </div>
        );
    }

    // discount_bonus: {metric, comparator, threshold, bonus}
    if (configKey === 'discount_bonus') {
        return (
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-muted-foreground">Метрика</label>
                    <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={value.metric || ''}
                        onChange={(e) => onChange({ ...value, metric: e.target.value })}
                    >
                        <option value="avg_order_discount_pct">Средневзвеш. % скидки по заказам</option>
                        <option value="share_orders_no_discount">Доля заказов без скидки, %</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Условие</label>
                    <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={value.comparator}
                        onChange={(e) => onChange({ ...value, comparator: e.target.value })}
                    >
                        <option value="lte">≤ порога</option>
                        <option value="gte">≥ порога</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Порог</label>
                    <Input type="number" value={value.threshold} onChange={(e) => onChange({ ...value, threshold: Number(e.target.value) })} />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Бонус (₽)</label>
                    <Input type="number" value={value.bonus} onChange={(e) => onChange({ ...value, bonus: Number(e.target.value) })} />
                </div>
            </div>
        );
    }

    // closing_status: {code}
    if (configKey === 'closing_status') {
        return (
            <div>
                <label className="text-xs text-muted-foreground">Код статуса RetailCRM</label>
                <Input value={value.code || ''} onChange={(e) => onChange({ ...value, code: e.target.value })} className="font-mono" />
            </div>
        );
    }

    // nds_normalization: {rules: [{vat_pct, divisor}]}
    if (configKey === 'nds_normalization') {
        const rules = value.rules || [];
        const update = (i: number, field: 'vat_pct' | 'divisor', v: number) => {
            const next = rules.map((r: any, idx: number) => (idx === i ? { ...r, [field]: v } : r));
            onChange({ rules: next });
        };
        return (
            <div className="space-y-2">
                {rules.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">НДС %</span>
                        <Input type="number" value={r.vat_pct} onChange={(e) => update(i, 'vat_pct', Number(e.target.value))} className="w-24" />
                        <span className="text-xs text-muted-foreground">делитель</span>
                        <Input type="number" step="0.01" value={r.divisor} onChange={(e) => update(i, 'divisor', Number(e.target.value))} className="w-24" />
                        <Button variant="ghost" size="icon" onClick={() => onChange({ rules: rules.filter((_: any, idx: number) => idx !== i) })}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => onChange({ rules: [...rules, { vat_pct: 0, divisor: 1 }] })}>
                    <Plus className="mr-2 h-4 w-4" /> Правило
                </Button>
            </div>
        );
    }

    // Фолбэк — не должно срабатывать при актуальной схеме
    return <pre className="rounded bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

function TierEditor({ rows, valueField, onChange }: { rows: any[]; valueField: 'k' | 'bonus'; onChange: (v: any[]) => void }) {
    const update = (i: number, field: string, v: number) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
    return (
        <div className="space-y-2">
            <div className="flex gap-2 text-xs text-muted-foreground">
                <span className="w-32">от (min)</span>
                <span className="w-32">{valueField === 'k' ? 'коэффициент' : 'бонус, ₽'}</span>
            </div>
            {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Input type="number" value={r.min} onChange={(e) => update(i, 'min', Number(e.target.value))} className="w-32" />
                    <Input type="number" step={valueField === 'k' ? '0.01' : '1'} value={r[valueField]} onChange={(e) => update(i, valueField, Number(e.target.value))} className="w-32" />
                    <Button variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => onChange([...rows, { min: 0, [valueField]: 0 }])}>
                <Plus className="mr-2 h-4 w-4" /> Тир
            </Button>
        </div>
    );
}

function StringListEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
    return (
        <div className="space-y-2">
            {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Input value={it} onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))} className="font-mono" />
                    <Button variant="ghost" size="icon" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => onChange([...items, ''])}>
                <Plus className="mr-2 h-4 w-4" /> Значение
            </Button>
        </div>
    );
}
