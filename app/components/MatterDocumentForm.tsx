'use client';

// Загрузка документа в дело: претензия, отзыв, иск, решение.
//
// Вид документа и направление выбирает человек — по ним потом собирается
// хронология спора, и ошибка здесь искажает всю картину дела.
import { useState } from 'react';

const DOC_KINDS: Array<{ code: string; label: string }> = [
    { code: 'pretenziya', label: 'Претензия' },
    { code: 'otvet', label: 'Ответ на претензию' },
    { code: 'dogovor', label: 'Договор' },
    { code: 'akt', label: 'Акт' },
    { code: 'isk', label: 'Исковое заявление' },
    { code: 'otzyv', label: 'Отзыв на иск' },
    { code: 'reshenie', label: 'Решение суда' },
    { code: 'list', label: 'Исполнительный лист' },
    { code: 'other', label: 'Другое' },
];

export default function MatterDocumentForm({ matterId, onSaved }: { matterId: number; onSaved: () => void }) {
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [docKind, setDocKind] = useState('pretenziya');
    const [direction, setDirection] = useState('in');
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const submit = async () => {
        if (!file) {
            setNote('Выберите файл');
            return;
        }
        setSaving(true);
        setNote(null);
        try {
            const body = new FormData();
            body.append('file', file);
            body.append('docKind', docKind);
            body.append('direction', direction);
            if (title.trim()) body.append('title', title.trim());

            const response = await fetch(`/api/legal/matters/${matterId}/documents`, { method: 'POST', body });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Документ не загрузился');
            setNote(payload.note || 'Документ загружен.');
            setFile(null);
            setTitle('');
            onSaved();
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="mt-2 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
                Приложить документ
            </button>
        );
    }

    return (
        <div className="mt-2 border border-gray-200 bg-gray-50 p-2">
            <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs"
                accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
            />
            <div className="mt-2 flex flex-wrap gap-2">
                <select value={docKind} onChange={(e) => setDocKind(e.target.value)} className="border border-gray-200 px-2 py-1 text-xs">
                    {DOC_KINDS.map((k) => (
                        <option key={k.code} value={k.code}>{k.label}</option>
                    ))}
                </select>
                <select value={direction} onChange={(e) => setDirection(e.target.value)} className="border border-gray-200 px-2 py-1 text-xs">
                    <option value="in">Получили</option>
                    <option value="out">Отправили</option>
                </select>
            </div>
            <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Название (необязательно)"
                className="mt-2 w-full border border-gray-200 px-2 py-1 text-xs"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={saving} onClick={submit} className="bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {saving ? 'Загружаю…' : 'Загрузить'}
                </button>
                <button type="button" onClick={() => { setOpen(false); setNote(null); }} className="border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
                    Закрыть
                </button>
                {note && <span className="text-xs text-gray-600">{note}</span>}
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
                До 25 МБ. Текст документа прочитается сразу — по нему потом ищутся цитаты и факты дела.
            </p>
        </div>
    );
}
