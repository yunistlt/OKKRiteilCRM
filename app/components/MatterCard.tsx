'use client';

// Карточка дела: текущее состояние сверху, вся история снизу.
//
// Журнал — не украшение: «последнее действие» в реестре берётся именно отсюда,
// поэтому запись события здесь же двигает стадию и следующий шаг. Иначе юрист
// заполняет одно и то же дважды, и реестр начинает расходиться с историей.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ATTENTION_LABELS,
  dictName,
  formatDate,
  formatDueHint,
  formatMoney,
  type Dictionaries,
  type MatterRowUi,
} from './matters-shared';
import RiskAmount from './RiskAmount';
import MatterEventForm from './MatterEventForm';
import MatterMoneyBlock from './MatterMoneyBlock';
import MatterLinkForm from './MatterLinkForm';

type Card = {
  matter: MatterRowUi;
  events: any[];
  links: any[];
  documents: any[];
  facts: any[];
};

export default function MatterCard({ id }: { id: number }) {
  const router = useRouter();
  const [card, setCard] = useState<Card | null>(null);
  const [dictionaries, setDictionaries] = useState<Dictionaries>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/legal/matters/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось открыть дело');
      setCard(payload);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

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
        // Без справочника покажем коды — раздел важнее красоты.
      }
    })();
  }, []);

  if (loading) return <div className="min-h-screen bg-gray-50 p-4 text-xs text-gray-500">Загружаем…</div>;
  if (error) return <div className="min-h-screen bg-gray-50 p-4"><div className="bg-red-50 p-2 text-xs text-red-700">{error}</div></div>;
  if (!card) return null;

  const { matter, events, links, documents } = card;
  const alerts = buildAlerts(matter);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
        <div className="flex items-baseline gap-3">
          <button onClick={() => router.push('/legal/matters')} className="text-xs font-semibold text-gray-500 hover:text-gray-900">
            ← Реестр дел
          </button>
          <h1 className="text-xl font-bold text-gray-900">Дело {matter.matter_no}</h1>
          <span className="bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800">
            {dictName(dictionaries, 'stage', matter.stage)}
          </span>
          <span className="text-xs text-gray-500">{dictName(dictionaries, 'status', matter.status)}</span>
        </div>
        <div className="text-xs text-gray-600">
          На кону: <RiskAmount risk={matter.risk} dictionaries={dictionaries} />
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="mb-3 bg-amber-50 p-2">
          {alerts.map((alert) => (
            <div key={alert} className="text-xs font-semibold text-amber-800">
              {alert}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Panel title="Следующее действие">
            <div className="flex flex-wrap items-baseline gap-3 text-sm">
              <span className="font-semibold text-gray-900">
                {matter.next_action || <span className="text-red-600">не задано</span>}
              </span>
              <span className="text-xs text-gray-500">
                {formatDate(matter.next_action_due)}{' '}
                <span className={matter.deadlines.actionOverdue ? 'text-red-600' : ''}>
                  {formatDueHint(matter.deadlines.actionDueInDays)}
                </span>
              </span>
            </div>
            <div className="mt-1 text-[11px] text-gray-400">
              Меняется записью события ниже — отдельной кнопки «изменить» нет намеренно.
            </div>
          </Panel>

          <Panel title="Суть спора">
            <Row label="Контрагент" value={matter.counterparty_name} extra={matter.counterparty_inn ? `ИНН ${matter.counterparty_inn}` : null} />
            <Row label="Представитель" value={matter.counterparty_rep} />
            <Row label="Наше юрлицо" value={matter.our_entity_inn} />
            <Row label="Сторона" value={dictName(dictionaries, 'matter_side', matter.matter_side)} />
            <Row label="Категория" value={dictName(dictionaries, 'category', matter.category)} />
            <Row label="Причина" value={dictName(dictionaries, 'cause', matter.cause)} />
            <Row label="Предмет" value={matter.subject} />
            <Row label="Наша позиция" value={matter.our_position} />
            <Row label="Договор" value={matter.contract_no} extra={matter.contract_date ? formatDate(matter.contract_date) : null} />
            <Row label="Заказ в CRM" value={matter.order_number} />
          </Panel>

          <Panel title="Журнал дела">
            <MatterEventForm matterId={matter.id} dictionaries={dictionaries} currentStage={matter.stage} onSaved={load} />

            {events.length === 0 && <div className="py-2 text-xs text-gray-500">Событий пока нет.</div>}

            <div className="mt-2">
              {events.map((event) => (
                <div key={event.id} className="border-b border-gray-100 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold text-gray-900">{formatDate(event.event_on)}</span>
                    <span className="bg-gray-100 px-1 text-[11px] font-semibold text-gray-700">
                      {dictName(dictionaries, 'event_kind', event.kind)}
                    </span>
                    <span className="text-sm text-gray-900">{event.title}</span>
                    {event.stage_after && (
                      <span className="text-[11px] text-blue-700">
                        стадия: {dictName(dictionaries, 'stage', event.stage_before)} → {dictName(dictionaries, 'stage', event.stage_after)}
                      </span>
                    )}
                  </div>
                  {event.description && <div className="mt-0.5 text-xs text-gray-600">{event.description}</div>}
                  {event.result && <div className="mt-0.5 text-xs text-gray-500">Результат: {event.result}</div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <MatterMoneyBlock matter={matter} dictionaries={dictionaries} onSaved={load} />

          <Panel title="Сроки">
            <Row label="Право требования" value={formatDate(matter.claim_right_on)} />
            <Row
              label="Давность истекает"
              value={formatDate(matter.deadlines.limitationUntil)}
              extra={matter.deadlines.limitationInDays !== null ? formatDueHint(matter.deadlines.limitationInDays) : null}
            />
            <Row label="Претензия получена" value={formatDate(matter.claim_received_on)} />
            <Row label="Срок ответа" value={formatDate(matter.claim_reply_due)} />
            <Row label="Ответ направлен" value={formatDate(matter.claim_replied_on)} />
            <Row label="Результат претензии" value={dictName(dictionaries, 'claim_result', matter.claim_result)} />
          </Panel>

          <Panel title="Стадии в других разделах">
            {links.length === 0 && (
              <div className="text-xs text-gray-500">
                Суд или исполнительное производство сюда подключаются связью — карточки остаются в своих разделах.
              </div>
            )}
            {links.map((link) => (
              <div key={link.id} className="border-b border-gray-100 py-1 text-xs">
                <span className="font-semibold text-gray-800">{LINK_LABELS[link.target_kind] || link.target_kind}</span>{' '}
                <span className="text-gray-600">№ {link.target_id}</span>
              </div>
            ))}
            <MatterLinkForm matterId={matter.id} onSaved={load} />
          </Panel>

          <Panel title="Документы">
            {documents.length === 0 && <div className="text-xs text-gray-500">Документов нет.</div>}
            {documents.map((doc) => (
              <div key={doc.id} className="border-b border-gray-100 py-1 text-xs">
                <div className="font-semibold text-gray-800">{doc.title || doc.file_name}</div>
                <div className="text-gray-500">{dictName(dictionaries, 'event_kind', doc.doc_kind) }</div>
              </div>
            ))}
            <div className="mt-1 text-[11px] text-amber-700">
              Загрузка документов и разбор ботом — в разработке, пока не работает.
            </div>
          </Panel>

          <Panel title="Ответственные">
            <Row label="Юрист" value={matter.responsible_user_id} />
            <Row label="От бизнеса" value={matter.business_owner} />
            <Row label="Подразделение" value={matter.business_unit} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

const LINK_LABELS: Record<string, string> = {
  court_case: 'Судебное дело',
  enforcement_case: 'Исполнительное производство',
  order: 'Заказ',
  payment: 'Платёж',
};

function buildAlerts(matter: MatterRowUi): string[] {
  const alerts: string[] = [];
  const state = matter.deadlines;

  if (state.limitationExpired) alerts.push(`${ATTENTION_LABELS.limitation_expired} — взыскание через суд больше невозможно`);
  else if (state.limitationSoon) alerts.push(`${ATTENTION_LABELS.limitation_soon}: ${formatDate(state.limitationUntil)}`);
  if (state.actionOverdue) alerts.push(ATTENTION_LABELS.action_overdue);
  if (state.replyOverdue) alerts.push(ATTENTION_LABELS.reply_overdue);
  if (state.actionMissing) alerts.push(ATTENTION_LABELS.action_missing);

  return alerts;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-3">
      <div className="mb-2 border-b border-gray-200 pb-1 text-xs font-bold uppercase tracking-wide text-gray-700">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, extra }: { label: string; value: any; extra?: string | null }) {
  return (
    <div className="flex gap-2 border-b border-gray-100 py-1 text-xs last:border-0">
      <div className="w-40 shrink-0 text-gray-500">{label}</div>
      <div className="text-gray-900">
        {value || <span className="text-gray-300">—</span>}
        {extra && <span className="ml-2 text-gray-400">{extra}</span>}
      </div>
    </div>
  );
}
