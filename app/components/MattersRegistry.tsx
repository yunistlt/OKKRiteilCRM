'use client';

// Реестр претензионно-исковой работы: строка = один спор, а не одна претензия.
// Наверху — шесть показателей и «что требует внимания»: руководитель открывает
// раздел и сразу видит, где нужно вмешаться, не листая весь реестр.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ATTENTION_LABELS,
  dictName,
  formatDate,
  formatDueHint,
  formatMoney,
  formatMoneyShort,
  type AttentionRow,
  type Dictionaries,
  type MatterRowUi,
} from './matters-shared';
import NewMatterForm from './NewMatterForm';
import RiskAmount from './RiskAmount';

type Summary = {
  total: number;
  open: number;
  needAttention: number;
  inCourt: number;
  inEnforcement: number;
  riskKopecks: number;
};

function Dash() {
  return <span className="text-gray-300">—</span>;
}

export default function MattersRegistry() {
  const router = useRouter();
  const [matters, setMatters] = useState<MatterRowUi[]>([]);
  const [attention, setAttention] = useState<AttentionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dictionaries, setDictionaries] = useState<Dictionaries>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/legal/matters${stageFilter ? `?stage=${stageFilter}` : ''}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось получить реестр дел');
      setMatters(payload.matters || []);
      setAttention(payload.attention || []);
      setSummary(payload.summary || null);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [stageFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/legal/matters/dictionaries');
        const payload = await response.json();
        if (response.ok) setDictionaries(payload.dictionaries || {});
      } catch {
        // Справочник не загрузился — покажем коды, но раздел не уроним.
      }
    })();
  }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return matters;
    return matters.filter((row) =>
      [row.matter_no, row.counterparty_name, row.counterparty_inn, row.subject, row.contract_no]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [matters, query]);

  const stages = dictionaries.stage || [];

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-gray-900">Претензионно-исковая работа</h1>
          <a href="/legal" className="text-xs font-semibold text-gray-500 hover:text-gray-900">
            Исполнительные производства →
          </a>
          <a href="/legal/helpdesk" className="text-xs font-semibold text-gray-500 hover:text-gray-900">
            Юридический помощник →
          </a>
        </div>
        <button
          onClick={() => setCreating((value) => !value)}
          className="bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700"
        >
          {creating ? 'Отменить' : '+ Новое дело'}
        </button>
      </div>

      {summary && (
        <div className="mb-3 grid grid-cols-2 gap-px bg-gray-200 md:grid-cols-6">
          <Tile label="Всего дел" value={String(summary.total)} />
          <Tile label="В работе" value={String(summary.open)} />
          <Tile label="Требуют действия" value={String(summary.needAttention)} tone={summary.needAttention > 0 ? 'warn' : undefined} />
          <Tile label="Суды" value={String(summary.inCourt)} />
          <Tile label="Исполнение" value={String(summary.inEnforcement)} />
          <Tile label="Финансовый риск" value={formatMoneyShort(summary.riskKopecks)} />
        </div>
      )}

      {creating && (
        <NewMatterForm
          dictionaries={dictionaries}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {attention.length > 0 && (
        <div className="mb-3 bg-white">
          <div className="border-b border-gray-200 px-2 py-2 text-xs font-bold uppercase tracking-wide text-gray-700">
            Что требует внимания
          </div>
          <table className="min-w-full text-xs">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-2 py-2">Дело</th>
                <th className="px-2 py-2">Контрагент</th>
                <th className="px-2 py-2">Что нужно сделать</th>
                <th className="px-2 py-2">Срок</th>
                <th className="px-2 py-2">Почему здесь</th>
                <th className="px-2 py-2 text-right">На кону</th>
              </tr>
            </thead>
            <tbody>
              {attention.map((item) => (
                <tr
                  key={item.matter.id}
                  onClick={() => router.push(`/legal/matters/${item.matter.id}`)}
                  className="cursor-pointer border-b border-gray-100 hover:bg-amber-50"
                >
                  <td className="px-2 py-2 font-semibold text-gray-900">{item.matter.matter_no}</td>
                  <td className="px-2 py-2">{item.matter.counterparty_name || <Dash />}</td>
                  <td className="px-2 py-2">{item.matter.next_action || <span className="text-red-600">не задано</span>}</td>
                  <td className="px-2 py-2">
                    {formatDate(item.matter.next_action_due)}
                    {item.matter.deadlines.actionDueInDays !== null && (
                      <span className={`ml-1 ${item.matter.deadlines.actionOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                        {formatDueHint(item.matter.deadlines.actionDueInDays)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {item.reasons.map((reason) => (
                      <span key={reason} className="mr-1 bg-amber-100 px-1 py-0.5 text-[11px] font-semibold text-amber-800">
                        {ATTENTION_LABELS[reason]}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <RiskAmount risk={item.matter.risk} dictionaries={dictionaries} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button
          onClick={() => setStageFilter('')}
          className={`px-3 py-1 text-xs font-semibold ${stageFilter === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
        >
          Все
        </button>
        {stages.map((stage) => (
          <button
            key={stage.code}
            onClick={() => setStageFilter(stage.code)}
            className={`px-3 py-1 text-xs font-semibold ${stageFilter === stage.code ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
          >
            {stage.name}
          </button>
        ))}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск: номер дела, контрагент, ИНН, суть"
          className="ml-auto w-72 border border-gray-300 px-2 py-1 text-xs"
        />
      </div>

      {error && <div className="mb-2 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="overflow-x-auto bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-2 py-2">Дело</th>
              <th className="px-2 py-2">Контрагент</th>
              <th className="px-2 py-2">Категория</th>
              <th className="px-2 py-2">Суть</th>
              <th className="px-2 py-2">Сторона</th>
              <th className="px-2 py-2">Стадия</th>
              <th className="px-2 py-2">Последнее действие</th>
              <th className="px-2 py-2">Следующее действие</th>
              <th className="px-2 py-2">Срок</th>
              <th className="px-2 py-2 text-right">На кону</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-2 py-4 text-center text-gray-500">
                  Загружаем…
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-4 text-center text-gray-500">
                  Дел пока нет. Первое заводится кнопкой «Новое дело».
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => router.push(`/legal/matters/${row.id}`)}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
              >
                <td className="px-2 py-2 font-semibold text-gray-900">{row.matter_no}</td>
                <td className="px-2 py-2">
                  {row.counterparty_name || <Dash />}
                  {row.counterparty_inn && <div className="text-[11px] text-gray-400">ИНН {row.counterparty_inn}</div>}
                </td>
                <td className="px-2 py-2">{dictName(dictionaries, 'category', row.category)}</td>
                <td className="max-w-xs truncate px-2 py-2" title={row.subject || ''}>
                  {row.subject || <Dash />}
                </td>
                <td className="px-2 py-2">{dictName(dictionaries, 'matter_side', row.matter_side)}</td>
                <td className="px-2 py-2">
                  <span className="bg-gray-100 px-1 py-0.5 font-semibold text-gray-800">
                    {dictName(dictionaries, 'stage', row.stage)}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {row.last_event ? (
                    <>
                      <div>{row.last_event.title}</div>
                      <div className="text-[11px] text-gray-400">{formatDate(row.last_event.event_on)}</div>
                    </>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 py-2">
                  {row.next_action || <span className="text-red-600">не задано</span>}
                </td>
                <td className="px-2 py-2">
                  {formatDate(row.next_action_due)}
                  {row.deadlines.actionOverdue && <div className="text-[11px] font-semibold text-red-600">просрочено</div>}
                  {row.deadlines.limitationSoon && <div className="text-[11px] font-semibold text-amber-700">давность на исходе</div>}
                  {row.deadlines.limitationExpired && <div className="text-[11px] font-semibold text-red-700">давность истекла</div>}
                </td>
                <td className="px-2 py-2 text-right">
                  <RiskAmount risk={row.risk} dictionaries={dictionaries} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-[11px] text-gray-400">
        Один конфликт — одно дело: претензия, суд и взыскание живут внутри него стадиями, а не отдельными строками.
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tone === 'warn' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
