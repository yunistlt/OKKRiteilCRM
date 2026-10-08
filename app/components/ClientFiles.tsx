'use client';

/**
 * Файлы в карточке клиента.
 *
 * Для нашей компании это её документы: устав, ЕГРЮЛ, ИНН, карточка
 * предприятия, отчётность — то, что раньше рассылали ссылкой на Яндекс.Диск.
 * Клиенту даём свою ссылку /docs/<код>.
 *
 * Решение владельца 08.10.2026: отдельного раздела не заводить — признак
 * «наше юрлицо» галочкой прямо здесь, и файлы тут же.
 */
import { useCallback, useEffect, useState } from 'react';

type Doc = { id: number; fileName: string; folder: string | null; size: number | null; isPublic: boolean };
type Entity = { id: number; name: string };

const size = (bytes: number | null): string => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

export default function ClientFiles({ clientId }: { clientId: string }) {
    const [ours, setOurs] = useState(false);
    const [slug, setSlug] = useState<string | null>(null);
    const [files, setFiles] = useState<Doc[]>([]);
    const [entities, setEntities] = useState<Entity[]>([]);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await fetch(`/api/clients/${clientId}/files`);
        const data = await res.json().catch(() => null);
        setOurs(Boolean(data?.ours));
        setSlug(data?.slug ?? null);
        setFiles(data?.files ?? []);
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    /** Список наших юрлиц нужен только в момент, когда ставят галочку. */
    const loadEntities = async () => {
        if (entities.length) return;
        const res = await fetch('/api/settings/legal-entities');
        const data = await res.json().catch(() => null);
        setEntities(((data?.entities || data || []) as any[])
            .map((e) => ({ id: Number(e.id), name: String(e.short_name || e.full_name || e.inn) })));
    };

    const markOurs = async (entityId: number | null) => {
        setBusy(true);
        setNote(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/files`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ourLegalEntityId: entityId }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Не сохранилось');
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    const upload = async (file: File) => {
        setBusy(true);
        setNote(null);
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch(`/api/clients/${clientId}/files`, { method: 'POST', body: form });
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Файл не загрузился');
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    const change = async (fileId: number, patch: { isPublic?: boolean; deleted?: boolean }) => {
        await fetch(`/api/clients/${clientId}/files`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId, ...patch }),
        });
        await load();
    };

    return (
        <>
            <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                Файлы
            </div>

            <div className="px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2">
                    <input
                        type="checkbox"
                        checked={ours}
                        disabled={busy}
                        onChange={async (e) => {
                            if (!e.target.checked) return markOurs(null);
                            await loadEntities();
                            setOurs(true);
                        }}
                    />
                    <span>Наше юрлицо</span>
                </label>

                {/* Поставили галочку, но юрлицо ещё не выбрано — спрашиваем какое:
                    их у нас несколько, и документы у каждого свои. */}
                {ours && !slug && (
                    <div className="mt-2">
                        <select
                            defaultValue=""
                            disabled={busy}
                            onChange={(e) => e.target.value && markOurs(Number(e.target.value))}
                            className="w-full border border-gray-300 px-2 py-1"
                        >
                            <option value="">Выберите, какое это юрлицо…</option>
                            {entities.map((entity) => (
                                <option key={entity.id} value={entity.id}>{entity.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {ours && slug && (
                    <>
                        <p className="mt-2 text-gray-600">
                            Ссылка для клиента:{' '}
                            <a href={`/docs/${slug}`} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">
                                /docs/{slug}
                            </a>
                            <span className="ml-2 text-gray-400">видно клиенту: {files.filter((f) => f.isPublic).length} из {files.length}</span>
                        </p>

                        {!files.length && <p className="mt-2 text-gray-500">Документов нет. Загрузите устав, ЕГРЮЛ, ИНН и карточку предприятия.</p>}

                        <ul className="mt-2 max-h-72 overflow-y-auto">
                            {files.map((file) => (
                                <li key={file.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-b-0">
                                    <input
                                        type="checkbox"
                                        checked={file.isPublic}
                                        onChange={() => change(file.id, { isPublic: !file.isPublic })}
                                        title="Виден клиенту по ссылке"
                                    />
                                    <span className="min-w-0 flex-1 truncate" title={file.fileName}>
                                        {file.folder ? <span className="text-gray-400">{file.folder} / </span> : null}
                                        {file.fileName}
                                    </span>
                                    <span className="shrink-0 text-gray-400">{size(file.size)}</span>
                                    <button
                                        onClick={() => change(file.id, { deleted: true })}
                                        className="shrink-0 font-semibold text-gray-500 hover:underline"
                                    >
                                        убрать
                                    </button>
                                </li>
                            ))}
                        </ul>

                        <label className={`mt-2 block cursor-pointer border border-gray-300 px-2 py-1 text-center font-semibold ${busy ? 'text-gray-400' : 'text-gray-700 hover:bg-gray-100'}`}>
                            {busy ? 'Загружаю…' : 'Добавить документ'}
                            <input
                                type="file"
                                className="hidden"
                                disabled={busy}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (file) void upload(file);
                                }}
                            />
                        </label>
                    </>
                )}

                {!ours && (
                    <p className="mt-1 text-gray-500">
                        Отметьте, если это одна из наших компаний: тогда здесь появятся её документы и ссылка для клиента.
                    </p>
                )}

                {note && <p className="mt-1 text-red-700">{note}</p>}
            </div>
        </>
    );
}
