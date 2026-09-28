'use client';

// Карточка исполнительного производства: поля, документы, что нашёл бот с
// доказательством, связанные платежи, статус. Открывается из реестра.
import { useCallback, useEffect, useState } from 'react';
import {
  ENFORCEMENT_DOC_KIND_LABELS,
  ENFORCEMENT_FIELD_LABELS,
  ENFORCEMENT_STATUS_LABELS,
} from '@/lib/legal-enforcement/types';
import { isArchiveName } from '@/lib/archive/names';
import { ENFORCEMENT_STATUS_STYLES, formatDate, formatMoney, humanFieldValue } from './enforcement-shared';
import EnforcementDocumentPreview from './EnforcementDocumentPreview';
import type { Doc, EnforcementCase, Fact, PaymentLink, PaymentRow } from './enforcement-shared';

export default function EnforcementCaseCard({ caseId }: { caseId: number }) {
  const [data, setData] = useState<{
    case: EnforcementCase;
    documents: Doc[];
    facts: Fact[];
    payment_links: PaymentLink[];
    payments: PaymentRow[];
    outgoing_payments_available: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: number; name: string } | null>(null);

  /** Отправляет только поля карточки; суммы вводятся рублями, на сервере хранятся в копейках. */
  const saveFields = useCallback(async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/legal/enforcement/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось сохранить');
      setEditing(false);
      await load();
    } catch (e: any) {
      setSaveError(e?.message || 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
    // load объявлен ниже и стабилен между отрисовками — ссылка на него здесь безопасна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, draft]);

  /** Файл лежит в закрытом хранилище — сперва берём короткоживущую подписанную ссылку. */
  const downloadDocument = useCallback(async (documentId: number) => {
    try {
      const response = await fetch(`/api/legal/enforcement/documents/${documentId}?download=1`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось открыть файл');
      window.open(payload.url, '_blank', 'noopener');
    } catch (e: any) {
      setError(e?.message || 'Не удалось открыть файл');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/legal/enforcement/${caseId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось открыть карточку');
      setData(payload);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (url: string, body: any, method: 'POST' | 'PATCH' = 'POST') => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Действие не выполнено');
      await load();
      return payload;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <div className="mt-3 bg-white p-3 text-xs text-gray-500">{error || 'Открываем карточку…'}</div>;
  }

  const suggested = data.facts.filter((fact) => fact.state === 'suggested');
  const confirmed = data.facts.filter((fact) => fact.state === 'confirmed');
  const paymentById = new Map(data.payments.map((payment) => [payment.id, payment]));

  return (
    <div className="mt-3 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
          {data.case.is_sample && (
            <span className="bg-violet-600 px-2 py-[2px] text-[10px] font-black uppercase text-white">образец / тест</span>
          )}
          Карточка № {data.case.case_number || `без номера (внутр. ${data.case.id})`}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-1 text-[10px] font-bold uppercase ${ENFORCEMENT_STATUS_STYLES[data.case.status] || 'bg-gray-100'}`}>
            {ENFORCEMENT_STATUS_LABELS[data.case.status as keyof typeof ENFORCEMENT_STATUS_LABELS] || data.case.status}
          </span>
          <span className="text-gray-500">
            Разбор: {data.case.parse_status === 'completed' ? 'готов' : data.case.parse_status === 'failed' ? 'ошибка' : data.case.parse_status === 'idle' ? 'не запускался' : 'в работе'}
          </span>
        </div>
      </div>

      {error && <div className="m-3 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      {data.case.parse_error && (
        <div className="m-3 bg-amber-50 p-2 text-xs text-amber-800">Замечания разбора: {data.case.parse_error}</div>
      )}

      <div className="grid gap-3 p-3 lg:grid-cols-2">
        <section>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-bold uppercase text-gray-500">Поля карточки</div>
            {!editing ? (
              <button
                onClick={() => {
                  // В правку отдаём то, что видно: суммы — рублями, остальное как есть.
                  const start: Record<string, string> = {};
                  for (const field of Object.keys(ENFORCEMENT_FIELD_LABELS)) {
                    start[field] = toInputValue(field, data.case[field]);
                  }
                  setDraft(start);
                  setSaveError(null);
                  setEditing(true);
                }}
                className="border border-gray-300 px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-900 hover:text-white"
              >
                Изменить
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={() => { setEditing(false); setSaveError(null); }}
                  disabled={busy}
                  className="border border-gray-300 px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Отменить
                </button>
                <button
                  onClick={saveFields}
                  disabled={busy}
                  className="bg-gray-900 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            )}
          </div>

          {saveError && (
            <div className="mb-1 border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">{saveError}</div>
          )}

          <table className="min-w-full text-xs">
            <tbody>
              {Object.entries(ENFORCEMENT_FIELD_LABELS).map(([field, label]) => (
                <tr key={field} className="border-t border-gray-100">
                  <td className="w-1/2 px-2 py-1 text-gray-500">{label}</td>
                  <td className="px-2 py-1 font-semibold text-gray-900">
                    {editing ? (
                      <input
                        value={draft[field] ?? ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={field.endsWith('_kopecks') ? 'рубли' : field.endsWith('_on') || field.startsWith('debt_period') ? 'ГГГГ-ММ-ДД' : ''}
                        className="w-full border border-gray-300 px-1 py-0.5 text-xs font-normal focus:border-gray-900 focus:outline-none"
                      />
                    ) : (
                      humanFieldValue(field, data.case[field])
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-bold uppercase text-gray-500">Документы</div>
            <button
              onClick={() => act('/api/legal/enforcement/parse', { case_id: caseId })}
              disabled={busy}
              className="bg-gray-900 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
            >
              Расшифровать документы
            </button>
          </div>
          <UploadDocument caseId={caseId} onUploaded={load} />
          <table className="mt-2 min-w-full text-xs">
            <tbody>
              {data.documents.length === 0 && (
                <tr>
                  <td className="px-2 py-2 text-gray-500">Документов нет — загрузите постановление, требование или приказ.</td>
                </tr>
              )}
              {data.documents.map((doc) => (
                <tr key={doc.id} className="border-t border-gray-100">
                  <td className="px-2 py-1">
                    <div className="font-semibold text-gray-900">{doc.title || doc.file_name}</div>
                    <div className="text-gray-500">
                      {doc.doc_kind
                        ? ENFORCEMENT_DOC_KIND_LABELS[doc.doc_kind as keyof typeof ENFORCEMENT_DOC_KIND_LABELS] || doc.doc_kind
                        : 'вид не определён'}
                      {' · '}
                      {doc.upload_status === 'uploaded' ? 'загружен' : doc.upload_status === 'failed' ? 'ошибка загрузки' : 'загружается'}
                      {' · '}
                      {doc.extract_status === 'completed' && isArchiveName(doc.file_name)
                        ? String(doc.extract_warnings?.archive || 'архив распакован')
                        : doc.extract_status === 'completed'
                        ? `текст распознан (${doc.raw_text_length.toLocaleString('ru-RU')} симв.)`
                        : doc.extract_status === 'manual_review_required'
                          ? 'текст не распознан, нужна ручная проверка'
                          : doc.extract_status === 'failed'
                            ? 'разбор не удался'
                            : 'ждёт разбора'}
                    </div>

                    {doc.upload_status === 'uploaded' && !isArchiveName(doc.file_name) && (
                      <div className="mt-1 flex gap-2">
                        <button
                          onClick={() => setPreview({ id: doc.id, name: doc.title || doc.file_name })}
                          className="border border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-900 hover:text-white"
                        >
                          Посмотреть
                        </button>
                        <button
                          onClick={() => downloadDocument(doc.id)}
                          className="border border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-900 hover:text-white"
                        >
                          Скачать
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="border-t border-gray-200 p-3">
        <div className="mb-1 text-xs font-bold uppercase text-gray-500">
          Что нашёл бот — подтвердите спорное ({suggested.length})
        </div>
        {suggested.length === 0 && <div className="text-xs text-gray-500">Непроверенных предложений нет.</div>}
        <div className="divide-y divide-gray-100">
          {suggested.map((fact) => (
            <FactRow key={fact.id} fact={fact} busy={busy} onDecide={(body) => act('/api/legal/enforcement/facts', body)} />
          ))}
        </div>

        {confirmed.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-gray-600">
              Подтверждённые поля с доказательством ({confirmed.length})
            </summary>
            <div className="mt-1 divide-y divide-gray-100">
              {confirmed.map((fact) => (
                <div key={fact.id} className="py-1 text-xs">
                  <span className="font-semibold text-gray-900">{ENFORCEMENT_FIELD_LABELS[fact.field] || fact.field}</span>
                  {': '}
                  {humanFieldValue(fact.field, fact.value_text)}
                  {fact.quote && <div className="mt-1 bg-gray-50 p-1 text-gray-600">«{fact.quote}»</div>}
                  <div className="text-gray-400">
                    источник: {fact.extractor === 'human' ? 'правка человека' : fact.extractor === 'ai' ? 'ИИ-разбор' : 'шаблон документа'}
                    {fact.confirmed_by ? ` · подтвердил ${fact.confirmed_by}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="border-t border-gray-200 p-3">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs font-bold uppercase text-gray-500">Связанные платежи</div>
          <button
            onClick={() => act('/api/legal/enforcement/payments', { case_id: caseId })}
            disabled={busy}
            className="bg-gray-800 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
          >
            Подобрать платежи
          </button>
        </div>

        {!data.outgoing_payments_available && (
          <div className="mb-2 bg-amber-50 p-2 text-xs text-amber-800">
            <span className="font-bold">В разработке:</span> списаний в базе платежей пока нет — и Точка, и Т-Банк
            загружают только приход. Пока расходы не включены в загрузку выписки, подбор почти всегда вернёт пусто;
            связь можно только проверить глазами.
          </div>
        )}

        {data.payment_links.length === 0 && <div className="text-xs text-gray-500">Связей и предложений нет.</div>}
        <div className="divide-y divide-gray-100">
          {data.payment_links.map((link) => {
            const payment = paymentById.get(link.payment_id);
            return (
              <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs">
                <div>
                  <span className="font-semibold text-gray-900">{formatMoney(payment?.amount_kopecks)}</span>
                  {' · '}
                  {formatDate(payment?.payment_date)}
                  {' · '}
                  {payment?.payer_name || 'плательщик не указан'}
                  <div className="text-gray-500">{payment?.purpose || 'назначение не указано'}</div>
                  {link.match_reason?.reasons && (
                    <div className="text-gray-400">Похоже, потому что: {link.match_reason.reasons.join('; ')}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">
                    {link.link_state === 'confirmed' ? 'связь подтверждена' : link.link_state === 'rejected' ? 'отклонено' : 'предложение бота'}
                  </span>
                  {link.link_state === 'suggested' && (
                    <>
                      <button
                        onClick={() => act('/api/legal/enforcement/payments', { case_id: caseId, payment_id: link.payment_id, decision: 'confirm' }, 'PATCH')}
                        disabled={busy}
                        className="bg-emerald-700 px-2 py-1 font-bold text-white disabled:opacity-50"
                      >
                        Это оно
                      </button>
                      <button
                        onClick={() => act('/api/legal/enforcement/payments', { case_id: caseId, payment_id: link.payment_id, decision: 'reject' }, 'PATCH')}
                        disabled={busy}
                        className="bg-gray-200 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
                      >
                        Не то
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 border-t border-gray-200 p-3 text-xs">
        <span className="font-bold uppercase text-gray-500">Статус карточки:</span>
        <button
          onClick={() => act('/api/legal/enforcement/status', { case_id: caseId, status: 'confirmed' })}
          disabled={busy}
          className="bg-emerald-700 px-2 py-1 font-bold text-white disabled:opacity-50"
        >
          Подтверждено
        </button>
        <button
          onClick={() => act('/api/legal/enforcement/status', { case_id: caseId, status: 'in_fd_report' })}
          disabled={busy}
          className="bg-blue-700 px-2 py-1 font-bold text-white disabled:opacity-50"
        >
          Учтено в ФД-отчёте
        </button>
        <button
          onClick={() => act('/api/legal/enforcement/status', { case_id: caseId, status: 'closed' })}
          disabled={busy}
          className="bg-gray-700 px-2 py-1 font-bold text-white disabled:opacity-50"
        >
          Закрыто
        </button>
        <button
          onClick={() => act('/api/legal/enforcement/status', { case_id: caseId, is_sample: !data.case.is_sample }, 'PATCH')}
          disabled={busy}
          className={`px-2 py-1 font-bold disabled:opacity-50 ${data.case.is_sample ? 'bg-gray-200 text-gray-700' : 'bg-violet-600 text-white'}`}
        >
          {data.case.is_sample ? 'Снять пометку «образец»' : 'Пометить как образец / тест'}
        </button>
        <span className="text-gray-500">
          Перевод в «Подтверждено» и «Учтено в ФД-отчёте» закрыт, пока остались непроверенные поля.
          Образцы видны в реестре, но в суммы долга не входят.
        </span>
      </section>

      {preview && (
        <EnforcementDocumentPreview
          documentId={preview.id}
          name={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function FactRow({
  fact,
  busy,
  onDecide,
}: {
  fact: Fact;
  busy: boolean;
  onDecide: (body: any) => Promise<any>;
}) {
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(fact.value_text || '');

  const sure = (fact.confidence || 0) >= 0.75 && !fact.conflicts_with;

  return (
    <div className="py-2 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-gray-900">{ENFORCEMENT_FIELD_LABELS[fact.field] || fact.field}</span>
          {': '}
          <span className="font-bold">{humanFieldValue(fact.field, fact.value_text)}</span>
          <span className={`ml-2 px-2 py-[2px] text-[10px] font-bold uppercase ${sure ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {sure ? 'уверен' : 'не уверен'}
          </span>
          <span className="ml-2 text-gray-400">
            {fact.extractor === 'ai' ? 'ИИ-разбор' : 'шаблон документа'}
            {fact.confidence !== null ? ` · уверенность ${(Number(fact.confidence) * 100).toFixed(0)}%` : ''}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onDecide({ fact_id: fact.id, decision: 'confirm' })}
            disabled={busy}
            className="bg-emerald-700 px-2 py-1 font-bold text-white disabled:opacity-50"
          >
            Подтвердить
          </button>
          <button onClick={() => setEdit((prev) => !prev)} className="bg-gray-200 px-2 py-1 font-semibold text-gray-700">
            Исправить
          </button>
          <button
            onClick={() => onDecide({ fact_id: fact.id, decision: 'reject' })}
            disabled={busy}
            className="bg-gray-200 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
          >
            Не то
          </button>
        </div>
      </div>

      {fact.conflicts_with && <div className="mt-1 bg-amber-50 p-1 text-amber-800">Конфликт: {fact.conflicts_with}</div>}
      {fact.quote && <div className="mt-1 bg-gray-50 p-1 text-gray-600">Основание в документе: «{fact.quote}»</div>}

      {edit && (
        <div className="mt-1 flex gap-1">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="flex-1 border border-gray-300 px-2 py-1"
            placeholder="Правильное значение"
          />
          <button
            onClick={() => onDecide({ fact_id: fact.id, decision: 'confirm', corrected_value: value })}
            disabled={busy}
            className="bg-gray-900 px-2 py-1 font-bold text-white disabled:opacity-50"
          >
            Сохранить моё значение
          </button>
        </div>
      )}
    </div>
  );
}

function UploadDocument({ caseId, onUploaded }: { caseId: number; onUploaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const prepare = await fetch('/api/legal/enforcement/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          file_name: file.name,
          file_type: file.type || 'application/pdf',
          file_size: file.size,
        }),
      });
      const prepared = await prepare.json();
      if (!prepare.ok) throw new Error(prepared.error || 'Не удалось подготовить загрузку');

      const put = await fetch(prepared.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      await fetch('/api/legal/enforcement/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: prepared.document.id,
          upload_status: put.ok ? 'uploaded' : 'failed',
          error: put.ok ? null : `Storage вернул ${put.status}`,
        }),
      });

      if (!put.ok) throw new Error('Файл не загрузился в хранилище');
      onUploaded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept=".pdf,.doc,.docx,.txt,image/*"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
        className="w-full border border-dashed border-gray-300 p-2 text-xs"
      />
      {busy && <div className="mt-1 text-xs text-gray-500">Загружаем файл и ставим разбор в очередь…</div>}
      {error && <div className="mt-1 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}

/** Значение поля для ввода: копейки показываем рублями, пустое — пустой строкой. */
function toInputValue(field: string, value: any): string {
  if (value === null || value === undefined) return '';
  if (field.endsWith('_kopecks')) {
    const kopecks = Number(value);
    return Number.isFinite(kopecks) ? String(kopecks / 100) : '';
  }
  return String(value);
}
