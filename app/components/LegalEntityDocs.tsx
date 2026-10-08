'use client';

/**
 * Документы юрлица: устав, ЕГРЮЛ, ИНН, карточка предприятия.
 *
 * Раньше менеджер отправлял клиенту ссылку на Яндекс.Диск. Теперь документы
 * лежат у нас, а клиент получает ссылку на наш сайт — её видно здесь же и
 * можно скопировать в письмо (требование владельца 08.10.2026).
 *
 * Публичным считается не всё: рядом с уставом на Диске лежали налоговые
 * декларации и договор аренды. Что показывать клиенту — решает человек
 * галочкой «виден клиенту».
 */
import { useCallback, useEffect, useState } from 'react';

type Doc = {
    id: number;
    fileName: string;
    folder: string | null;
    size: number | null;
    isPublic: boolean;
};

const size = (bytes: number | null): string => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

export default function LegalEntityDocs({ entityId }: { entityId: number }) {
    const [files, setFiles] = useState<Doc[] | null>(null);
    const [slug, setSlug] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await fetch(`/api/settings/legal-entities/files?entityId=${entityId}`);
        const data = await res.json().catch(() => null);
        setFiles(data?.files ?? []);
        setSlug(data?.slug ?? null);
    }, [entityId]);

    useEffect(() => { if (open) void load(); }, [open, load]);

    const upload = async (file: File) => {
        setBusy(true);
        setNote(null);
        try {
            const form = new FormData();
            form.append('entityId', String(entityId));
            form.append('file', file);
            const res = await fetch('/api/settings/legal-entities/files', { method: 'POST', body: form });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'Файл не загрузился');
            await load();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setBusy(false);
        }
    };

    const change = async (id: number, patch: { isPublic?: boolean; deleted?: boolean }) => {
        await fetch('/api/settings/legal-entities/files', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...patch }),
        });
        await load();
    };

    const link = slug ? `/docs/${slug}` : null;
    const publicCount = (files ?? []).filter((f) => f.isPublic).length;

    return (
        <div className="mt-3 border border-gray-200 p-2">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-baseline justify-between gap-2 text-left"
            >
                <span className="text-[11px] uppercase tracking-wide text-gray-500">Документы компании</span>
                <span className="text-[11px] font-semibold text-blue-700">{open ? 'свернуть' : 'открыть'}</span>
            </button>

            {open && (
                <div className="mt-2">
                    {link ? (
                        <p className="mb-2 text-[11px] text-gray-600">
                            Ссылка для клиента:{' '}
                            <a href={link} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">
                                {link}
                            </a>
                            {files !== null && <span className="ml-2 text-gray-400">видно клиенту: {publicCount}</span>}
                        </p>
                    ) : (
                        <p className="mb-2 text-[11px] text-amber-800">
                            Нет короткого кода для ссылки — задайте `public_slug` в карточке юрлица.
                        </p>
                    )}

                    {files === null && <p className="text-[11px] text-gray-500">Смотрим…</p>}
                    {files !== null && !files.length && (
                        <p className="text-[11px] text-gray-500">Документов нет. Загрузите устав, ЕГРЮЛ, ИНН и карточку предприятия.</p>
                    )}

                    <ul className="max-h-56 overflow-y-auto">
                        {(files ?? []).map((file) => (
                            <li key={file.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-b-0">
                                <input
                                    type="checkbox"
                                    checked={file.isPublic}
                                    onChange={() => change(file.id, { isPublic: !file.isPublic })}
                                    title="Виден клиенту по ссылке"
                                />
                                <span className="min-w-0 flex-1 truncate text-[12px]" title={file.fileName}>
                                    {file.folder ? <span className="text-gray-400">{file.folder} / </span> : null}
                                    {file.fileName}
                                </span>
                                <span className="shrink-0 text-[11px] text-gray-400">{size(file.size)}</span>
                                <button
                                    onClick={() => change(file.id, { deleted: true })}
                                    className="shrink-0 text-[11px] font-semibold text-gray-500 hover:underline"
                                >
                                    убрать
                                </button>
                            </li>
                        ))}
                    </ul>

                    <label className={`mt-2 block cursor-pointer border border-gray-300 px-2 py-1 text-center text-[11px] font-semibold ${busy ? 'text-gray-400' : 'text-gray-700 hover:bg-gray-100'}`}>
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

                    {note && <p className="mt-1 text-[11px] text-red-700">{note}</p>}
                </div>
            )}
        </div>
    );
}
