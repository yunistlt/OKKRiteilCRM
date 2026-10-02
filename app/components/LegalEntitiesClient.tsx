'use client';

// Карточки наших юрлиц. Название, ИНН и банковские реквизиты ведутся в
// RetailCRM — здесь только то, чего там нет: ставка НДС и подписанты.
import { useCallback, useEffect, useState } from 'react';

type Entity = {
    id: number;
    short_name: string;
    full_name: string | null;
    inn: string;
    kind: string | null;
    active: boolean;
    site_code: string | null;
    vat_percent: number | null;
    signer_name: string | null;
    seal_place: string | null;
    signer_title: string | null;
};

const KIND_NAMES: Record<string, string> = { ooo: 'ООО', ao: 'АО', ip: 'ИП' };

export default function LegalEntitiesClient() {
    const [entities, setEntities] = useState<Entity[]>([]);
    const [sites, setSites] = useState<Array<{ code: string; name: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<number | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/settings/legal-entities');
            const payload = await response.json();
            setEntities(payload.entities || []);
            setSites(payload.sites || []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    /**
     * Руководителя берём из ЕГРЮЛ, а не со слов (решение владельца
     * 02.10.2026): так в счёте стоит тот, кто вправе подписывать.
     */
    const [headsBusy, setHeadsBusy] = useState(false);

    const pullHeads = async () => {
        setHeadsBusy(true);
        setNote(null);
        try {
            const response = await fetch('/api/settings/legal-entities', { method: 'PUT' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось получить данные ЕГРЮЛ');

            const filled = (payload.updates || []).filter((row: any) => row.name);
            const missing = (payload.updates || []).filter((row: any) => !row.name);
            setNote([
                filled.length ? `Из ЕГРЮЛ: ${filled.map((row: any) => `${row.entity} — ${row.title || 'руководитель'} ${row.name}`).join('; ')}` : null,
                missing.length ? `Руками: ${missing.map((row: any) => `${row.entity} (${row.note})`).join('; ')}` : null,
            ].filter(Boolean).join('. '));
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setHeadsBusy(false);
        }
    };

    const change = (id: number, patch: Partial<Entity>) => {
        setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    };

    const save = async (entity: Entity) => {
        setSaving(entity.id);
        setNote(null);
        try {
            const response = await fetch('/api/settings/legal-entities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: entity.id,
                    vat_percent: entity.vat_percent,
                    site_code: entity.site_code,
                    signer_name: entity.signer_name,
                    signer_title: entity.signer_title,
                    seal_place: entity.seal_place,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось сохранить');
            setNote(`Сохранено: ${entity.short_name}`);
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <h1 className="text-xl font-bold text-gray-900">Наши юрлица</h1>
                <button
                    onClick={pullHeads}
                    disabled={headsBusy}
                    className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:text-gray-400"
                >
                    {headsBusy ? 'Смотрю ЕГРЮЛ…' : 'Подписанты из ЕГРЮЛ'}
                </button>
                {note && <span className="text-xs text-gray-600">{note}</span>}
            </div>

            <p className="mb-4 text-xs text-gray-500">
                Название, ИНН и банковские реквизиты ведутся в RetailCRM — здесь их не меняем.
                Ставка НДС задаётся тут: она разная у каждого юрлица и в документы идёт отсюда.
            </p>

            {loading && <div className="text-xs text-gray-500">Загружаю…</div>}

            <div className="grid gap-px bg-gray-200 lg:grid-cols-2">
                {entities.map((entity) => (
                    <div key={entity.id} className="bg-white p-4 text-xs">
                        <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-gray-100 pb-2">
                            <div>
                                <div className="text-base font-bold text-gray-900">{entity.short_name}</div>
                                <div className="text-gray-500">
                                    {KIND_NAMES[entity.kind || ''] || entity.kind || '—'} · ИНН {entity.inn}
                                    {!entity.active && ' · не действует'}
                                </div>
                            </div>
                            <button
                                onClick={() => save(entity)}
                                disabled={saving === entity.id}
                                className="bg-gray-900 px-3 py-1.5 font-semibold text-white hover:bg-gray-700 disabled:bg-gray-300"
                            >
                                {saving === entity.id ? 'Сохраняю…' : 'Сохранить'}
                            </button>
                        </div>

                        <label className="mb-3 block">
                            <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Ставка НДС, %</span>
                            <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={entity.vat_percent ?? ''}
                                onChange={(e) => change(entity.id, { vat_percent: e.target.value === '' ? null : Number(e.target.value) })}
                                placeholder="не задана"
                                className="w-full border border-gray-300 px-2 py-1"
                            />
                            <span className="mt-1 block text-[11px] text-gray-500">
                                Идёт в счета этого юрлица. Не задана — счёт выставляется без НДС.
                            </span>
                        </label>

                        <label className="mb-3 block">
                            <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Магазин в RetailCRM</span>
                            <select
                                value={entity.site_code ?? ''}
                                onChange={(e) => change(entity.id, { site_code: e.target.value || null })}
                                className="w-full border border-gray-300 px-2 py-1"
                            >
                                <option value="">не связан</option>
                                {sites.map((site) => (
                                    <option key={site.code} value={site.code}>{site.name} ({site.code})</option>
                                ))}
                            </select>
                            <span className="mt-1 block text-[11px] text-gray-500">
                                Откуда берутся банковские реквизиты для счёта.
                            </span>
                        </label>

                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Кто подписывает</span>
                                <input
                                    value={entity.signer_name ?? ''}
                                    onChange={(e) => change(entity.id, { signer_name: e.target.value })}
                                    className="w-full border border-gray-300 px-2 py-1"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Должность</span>
                                <input
                                    value={entity.signer_title ?? ''}
                                    onChange={(e) => change(entity.id, { signer_title: e.target.value })}
                                    className="w-full border border-gray-300 px-2 py-1"
                                />
                            </label>
                        </div>

                        <label className="mt-3 block">
                            <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">Место на печати</span>
                            <input
                                value={entity.seal_place ?? ''}
                                onChange={(e) => change(entity.id, { seal_place: e.target.value })}
                                placeholder="Россия, Самарская область, город Тольятти"
                                className="w-full border border-gray-300 px-2 py-1"
                            />
                            <span className="mt-1 block text-[11px] text-gray-500">
                                {entity.kind === 'ip'
                                    ? 'ИП работает без печати — у этого юрлица печать на счёт не ставится, только подпись.'
                                    : 'Идёт по нижней дуге печати. Из ЕГРЮЛ приходит заготовка, поправьте, если на вашей печати написано иначе.'}
                            </span>
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
}
