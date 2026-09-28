'use client';

// Окно просмотра документа карточки ИП.
//
// Юрист видел только имя файла и «ждёт разбора» — что в постановлении, проверить было
// нечем. Теперь файл открывается прямо в карточке: картинка показывается как картинка,
// PDF — читалкой браузера, остальное честно предлагается скачать.
import { useCallback, useEffect, useState } from 'react';

interface Props {
  documentId: number;
  name: string;
  onClose: () => void;
}

interface FileLink {
  url: string;
  file_name: string;
  content_type: string | null;
  file_size_bytes: number | null;
}

export default function EnforcementDocumentPreview({ documentId, name, onClose }: Props) {
  const [link, setLink] = useState<FileLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/legal/enforcement/documents/${documentId}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось открыть файл');
        if (!cancelled) setLink(payload);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Не удалось открыть файл');
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  // Esc закрывает — руки уже на клавиатуре, когда читаешь документ.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = useCallback(async () => {
    const response = await fetch(`/api/legal/enforcement/documents/${documentId}?download=1`);
    const payload = await response.json();
    if (response.ok) window.open(payload.url, '_blank', 'noopener');
  }, [documentId]);

  const kind = fileKind(link);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-5xl flex-col bg-white"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold uppercase text-gray-500">Документ</div>
            <div className="truncate text-sm font-semibold text-gray-900">{name}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={download}
              className="border border-gray-300 px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-900 hover:text-white"
            >
              Скачать
            </button>
            <button
              onClick={onClose}
              className="border border-gray-300 px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-900 hover:text-white"
            >
              Закрыть
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-gray-100">
          {error && <div className="m-3 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {!error && !link && <div className="p-4 text-xs text-gray-500">Открываем файл…</div>}

          {link && kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.url} alt={name} className="mx-auto max-w-full" />
          )}

          {link && kind === 'pdf' && (
            <iframe src={link.url} title={name} className="h-full w-full border-0" />
          )}

          {link && kind === 'other' && (
            <div className="p-4 text-xs text-gray-700">
              Такой файл браузер показать не умеет — {humanType(link)}. Нажмите «Скачать», чтобы открыть его на компьютере.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fileKind(link: FileLink | null): 'image' | 'pdf' | 'other' {
  if (!link) return 'other';
  const type = (link.content_type || '').toLowerCase();
  const name = (link.file_name || '').toLowerCase();

  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(name)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'other';
}

function humanType(link: FileLink): string {
  const name = (link.file_name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : null;
  const size = link.file_size_bytes ? `, ${Math.max(1, Math.round(link.file_size_bytes / 1024)).toLocaleString('ru-RU')} КБ` : '';
  return ext ? `${ext.toUpperCase()}${size}` : `тип не определён${size}`;
}
