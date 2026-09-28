'use client';

// Реестр исполнительных производств — по сути CRM по ИП: строка = производство.
// Новая строка заводится прямо в таблице, файлы грузятся и отсюда, и из карточки.
// Клик по строке открывает карточку.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ENFORCEMENT_STATUSES, ENFORCEMENT_STATUS_LABELS } from '@/lib/legal-enforcement/types';
import {
  ENFORCEMENT_STATUS_STYLES,
  PROJECT_LABELS,
  formatDate,
  formatMoney,
  humanFieldValue,
  type EnforcementCase,
} from './enforcement-shared';

function Dash() {
  return <span className="text-gray-300">—</span>;
}

export default function EnforcementRegistry() {
  const router = useRouter();
  const [cases, setCases] = useState<EnforcementCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/legal/enforcement${statusFilter ? `?status=${statusFilter}` : ''}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось получить реестр');
      setCases(payload.cases || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cases;
    return cases.filter((row) =>
      [row.case_number, row.debtor_name, row.debtor_inn, row.claimant_name, row.court_case_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [cases, query]);

  const totals = useMemo(
    () => ({
      debt: rows.reduce((sum, row) => sum + (Number(row.debt_amount_kopecks) || 0), 0),
      review: rows.filter((row) => (row.pending_facts || 0) > 0).length,
    }),
    [rows],
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-gray-900">Исполнительные производства</h1>
          <a href="/legal/helpdesk" className="text-xs font-semibold text-gray-500 hover:text-gray-900">
            Юридический помощник и договоры →
          </a>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          <span>
            Производств: <span className="font-semibold text-gray-900">{rows.length}</span>
          </span>
          <span>
            Долг всего: <span className="font-semibold text-gray-900">{formatMoney(totals.debt)}</span>
          </span>
          <span>
            Требуют проверки: <span className="font-semibold text-amber-700">{totals.review}</span>
          </span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button
          onClick={() => setStatusFilter('')}
          className={`px-3 py-1 text-xs font-semibold ${statusFilter === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
        >
          Все
        </button>
        {ENFORCEMENT_STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1 text-xs font-semibold ${statusFilter === status ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
          >
            {ENFORCEMENT_STATUS_LABELS[status]}
          </button>
        ))}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск: номер, должник, ИНН, взыскатель"
          className="ml-auto w-72 border border-gray-300 px-2 py-1 text-xs"
        />
      </div>

      {error && <div className="mb-2 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-x-auto bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-2 py-2">Номер ИП</th>
              <th className="px-2 py-2">Должник</th>
              <th className="px-2 py-2">Взыскатель</th>
              <th className="px-2 py-2">Основание</th>
              <th className="px-2 py-2 text-right">Долг</th>
              <th className="px-2 py-2">Возбуждено</th>
              <th className="px-2 py-2">Статус</th>
              <th className="px-2 py-2">На проверке</th>
              <th className="px-2 py-2">Документы</th>
            </tr>
          </thead>
          <tbody>
            <NewCaseRow onCreated={load} />

            {loading && (
              <tr>
                <td colSpan={9} className="px-2 py-4 text-center text-gray-500">
                  Загружаем…
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-4 text-center text-gray-500">
                  {statusFilter || query
                    ? 'По этому отбору производств нет. Снимите фильтр или очистите поиск.'
                    : 'Производств нет. Заведите строку сверху и загрузите документы — остальное заполнит бот.'}
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => router.push(`/legal/enforcement/${row.id}`)}
                className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
              >
                <td className="px-2 py-2 font-semibold text-gray-900">{row.case_number || <Dash />}</td>
                <td className="px-2 py-2">
                  {row.debtor_name || <Dash />}
                  {row.project && <span className="ml-1 text-gray-400">· {PROJECT_LABELS[row.project] || row.project}</span>}
                </td>
                <td className="px-2 py-2">{row.claimant_name || <Dash />}</td>
                <td className="px-2 py-2">{humanFieldValue('ground', row.ground)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.debt_amount_kopecks)}</td>
                <td className="px-2 py-2">{formatDate(row.started_on)}</td>
                <td className="px-2 py-2">
                  <span className={`px-2 py-1 text-[10px] font-bold uppercase ${ENFORCEMENT_STATUS_STYLES[row.status] || 'bg-gray-100 text-gray-700'}`}>
                    {ENFORCEMENT_STATUS_LABELS[row.status as keyof typeof ENFORCEMENT_STATUS_LABELS] || row.status}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {(row.pending_facts || 0) > 0 ? (
                    <span className="bg-amber-100 px-2 py-1 font-bold text-amber-800">{row.pending_facts}</span>
                  ) : (
                    <Dash />
                  )}
                </td>
                {/* Клик по ячейке загрузки не должен открывать карточку. */}
                <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <span className={(row.documents_count || 0) > 0 ? 'text-gray-700' : 'text-gray-300'}>
                      {(row.documents_count || 0) > 0 ? `${row.documents_count} шт.` : '—'}
                    </span>
                    <RowUpload caseId={row.id} onUploaded={load} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Строка открывается по клику. Файлы принимаются в любом виде: PDF, Word, картинка или скан, а также архивы ZIP и RAR —
        архив бот распакует сам. После загрузки разбор ставится в очередь автоматически.
      </p>
    </div>
  );
}

/** Строка создания прямо в таблице: минимум полей, остальное достанет бот. */
function NewCaseRow({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ debtor_name: '', debtor_inn: '', project: '', case_number: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/legal/enforcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtor_name: form.debtor_name || null,
          debtor_inn: form.debtor_inn || null,
          project: form.project || null,
          case_number: form.case_number || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось создать строку');
      setForm({ debtor_name: '', debtor_inn: '', project: '', case_number: '' });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="border-t border-gray-200 bg-gray-50">
        <td className="px-2 py-1">
          <input
            value={form.case_number}
            onChange={(event) => setForm({ ...form, case_number: event.target.value })}
            placeholder="номер ИП, если есть"
            className="w-full min-w-[7rem] border border-gray-300 px-2 py-1 text-xs"
          />
        </td>
        <td className="px-2 py-1">
          {/* На узком экране поля встают в столбик: в строку они схлопывались до нечитаемых. */}
          <div className="flex flex-col gap-1 sm:flex-row">
            <input
              value={form.debtor_name}
              onChange={(event) => setForm({ ...form, debtor_name: event.target.value })}
              placeholder="юрлицо группы"
              className="w-full min-w-[9rem] border border-gray-300 px-2 py-1 text-xs"
            />
            <input
              value={form.debtor_inn}
              onChange={(event) => setForm({ ...form, debtor_inn: event.target.value })}
              placeholder="ИНН"
              className="w-full min-w-[7rem] border border-gray-300 px-2 py-1 text-xs sm:w-28"
            />
          </div>
        </td>
        <td className="px-2 py-1" colSpan={2}>
          <select
            value={form.project}
            onChange={(event) => setForm({ ...form, project: event.target.value })}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">проект не выбран</option>
            {Object.entries(PROJECT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1 text-gray-400" colSpan={4}>
          заполнит бот из документов
        </td>
        <td className="px-2 py-1">
          <button
            onClick={create}
            disabled={busy}
            className="w-full bg-gray-900 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Создаём…' : '+ Добавить'}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={9} className="bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

/** Загрузка файла из строки реестра — не открывая карточку. */
function RowUpload({ caseId, onUploaded }: { caseId: number; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const upload = async (files: FileList) => {
    setBusy(true);
    setNote(null);
    try {
      for (const file of Array.from(files)) {
        await uploadEnforcementFile(caseId, file);
      }
      setNote('загружено');
      onUploaded();
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 4000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50"
      >
        {busy ? 'Гружу…' : '+ файл'}
      </button>
      {note && <span className="text-xs text-gray-500">{note}</span>}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) void upload(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** Общий порядок загрузки: подписанная ссылка → файл в хранилище → отметка о загрузке. */
export async function uploadEnforcementFile(caseId: number, file: File) {
  const prepare = await fetch('/api/legal/enforcement/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      case_id: caseId,
      file_name: file.name,
      file_type: file.type || guessTypeByName(file.name),
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
      error: put.ok ? null : `Хранилище вернуло ${put.status}`,
    }),
  });

  if (!put.ok) throw new Error('Файл не загрузился в хранилище');
}

/** Браузер не всегда знает тип файла (особенно у .zip из архиватора). */
function guessTypeByName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.rar')) return 'application/vnd.rar';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}
