'use client';

import { useCallback, useEffect, useState } from 'react';

interface Candidate {
  orderId: number | null;
  orderNumber: string;
  totalKopecks: number | null;
  status: string | null;
  payerInn: string | null;
  reason: string;
}

interface Payment {
  id: number;
  source: string;
  external_payment_id: string;
  amount_kopecks: number;
  currency: string;
  payment_date: string | null;
  purpose: string | null;
  document_number: string | null;
  payer_name: string | null;
  payer_inn: string | null;
  recipient_name: string | null;
  recipient_inn: string | null;
  status: string;
  project: string | null;
  match_method: string | null;
  match_confidence: string | null;
  extracted_invoice_number: string | null;
  match_candidates: Candidate[] | null;
  matched_order_number: string | null;
  matched_order_id: number | null;
  retailcrm_payment_id: string | null;
  retailcrm_synced_at: string | null;
  retailcrm_error: string | null;
  signature_verified: boolean;
  reviewed_by: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending_match: 'Требуют разбора',
  matched: 'Привязанные',
  manual: 'Привязаны вручную',
  ignored: 'Пропущенные',
  failed: 'Ошибка',
};

// Плоские квадратные бейджи статуса (Metro): сплошная заливка, без скруглений.
const STATUS_STYLES: Record<string, string> = {
  pending_match: 'bg-amber-100 text-amber-800',
  matched: 'bg-emerald-100 text-emerald-800',
  manual: 'bg-blue-100 text-blue-800',
  ignored: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-800',
};

// Человекочитаемые имена источников платежа (в UI — только они, не коды).
const SOURCE_LABELS: Record<string, string> = {
  tochka: 'Точка',
  tbank: 'Т-Банк',
};

const SOURCE_STYLES: Record<string, string> = {
  tochka: 'bg-indigo-100 text-indigo-800',
  tbank: 'bg-yellow-100 text-yellow-800',
};

const PROJECT_LABELS: Record<string, string> = {
  zmktl: 'ЗМКТЛ',
  stolyarka: 'Столярка',
  consulting: 'ПО/Консалтинг',
};

// Вкладки: по проектам (kind='project') и по статусам (kind='status').
type Tab = { kind: 'project' | 'status' | 'review'; value: string; label: string };
const TABS: Tab[] = [
  { kind: 'project', value: 'zmktl', label: 'ЗМКТЛ' },
  { kind: 'project', value: 'stolyarka', label: 'Столярка' },
  { kind: 'project', value: 'consulting', label: 'ПО/Консалтинг' },
  { kind: 'review', value: '', label: 'Требуют разбора' },
  { kind: 'status', value: 'ignored', label: 'Пропущенные' },
  { kind: 'status', value: '', label: 'Все' },
];

// Сумма с разделителями разрядов и копейками (ru-RU) — «484 898,30 ₽».
function formatMoney(kopecks: number, currency = 'RUB') {
  const rub = kopecks / 100;
  return rub.toLocaleString('ru-RU', { style: 'currency', currency, minimumFractionDigits: 2 });
}

// Прочерк для пустых ячеек (ЗАКОН таблиц).
function Dash() {
  return <span className="text-gray-300">—</span>;
}

// Кнопка «скопировать в один клик» для окон с результатом.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard недоступен */
        }
      }}
      className="bg-gray-700 px-2 py-1 text-xs font-semibold text-gray-100 hover:bg-gray-600"
    >
      {copied ? 'Скопировано ✓' : 'Копировать'}
    </button>
  );
}

// Окно с JSON + кнопкой копирования.
function ResultBox({ data, tone = 'gray' }: { data: unknown; tone?: 'gray' | 'green' }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="border border-gray-800 bg-gray-900 p-3">
      <div className="mb-2 flex justify-end">
        <CopyButton text={text} />
      </div>
      <pre className={`max-h-64 overflow-auto text-xs ${tone === 'green' ? 'text-emerald-200' : 'text-gray-100'}`}>
        {text}
      </pre>
    </div>
  );
}

// Ссылка на карточку заказа в RetailCRM (по внутреннему id, иначе по номеру).
function crmOrderLink(crmUrl: string, orderId: number | null, orderNumber?: string | null): string | null {
  if (!crmUrl) return null;
  if (orderId) return `${crmUrl}/orders/${orderId}/edit`;
  if (orderNumber) return `${crmUrl}/orders/${encodeURIComponent(orderNumber)}/edit?by=number`;
  return null;
}

export default function PaymentsPage() {
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.kind === 'review') || TABS[0]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [projectSummary, setProjectSummary] = useState<Record<string, number>>({});
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [crmUrl, setCrmUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [manualNumber, setManualNumber] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Настройка вебхука Точки (у Точки нет UI — подключаем через её API нашим сервером).
  const [setupOpen, setSetupOpen] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);

  const loadWebhookStatus = useCallback(async () => {
    setWebhookBusy(true);
    try {
      const res = await fetch('/api/payments/subscribe', { cache: 'no-store' });
      setWebhookInfo(await res.json());
    } catch (e: any) {
      setWebhookInfo({ error: e.message });
    } finally {
      setWebhookBusy(false);
    }
  }, []);

  // Загрузка выписки за период (бэкофилл).
  const [backfillFrom, setBackfillFrom] = useState('');
  const [backfillTo, setBackfillTo] = useState('');
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<any>(null);

  // Разовый бэкофилл получателя по счетам Точки.
  const [tochkaRecipBusy, setTochkaRecipBusy] = useState(false);
  const [tochkaRecipResult, setTochkaRecipResult] = useState<any>(null);

  async function fillTochkaRecipients() {
    setTochkaRecipBusy(true);
    setTochkaRecipResult(null);
    try {
      const res = await fetch('/api/payments/tochka/recipients', { method: 'POST' });
      const json = await res.json();
      setTochkaRecipResult(json);
      if (res.ok) await load();
    } catch (e: any) {
      setTochkaRecipResult({ error: e.message });
    } finally {
      setTochkaRecipBusy(false);
    }
  }

  async function runBackfill() {
    if (!backfillFrom || !backfillTo) return;
    setBackfillBusy(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/payments/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: backfillFrom, to: backfillTo }),
      });
      const json = await res.json();
      setBackfillResult(json);
      if (res.ok) await load();
    } catch (e: any) {
      setBackfillResult({ error: e.message });
    } finally {
      setBackfillBusy(false);
    }
  }

  // Т-Банк: проверка связи + ручная загрузка выписки за период.
  const [tbankOpen, setTbankOpen] = useState(false);
  const [tochkaOpen, setTochkaOpen] = useState(false);
  const [tbankStatus, setTbankStatus] = useState<any>(null);
  const [tbankStatusBusy, setTbankStatusBusy] = useState(false);
  const [tbankFrom, setTbankFrom] = useState('');
  const [tbankTo, setTbankTo] = useState('');
  const [tbankBusy, setTbankBusy] = useState(false);
  const [tbankResult, setTbankResult] = useState<any>(null);

  async function checkTbank() {
    setTbankStatusBusy(true);
    setTbankStatus(null);
    try {
      const res = await fetch('/api/payments/tbank/status', { cache: 'no-store' });
      setTbankStatus(await res.json());
    } catch (e: any) {
      setTbankStatus({ error: e.message });
    } finally {
      setTbankStatusBusy(false);
    }
  }

  async function probeTbank() {
    setTbankStatusBusy(true);
    setTbankStatus(null);
    try {
      const res = await fetch('/api/payments/tbank/probe?days=3', { cache: 'no-store' });
      setTbankStatus(await res.json());
    } catch (e: any) {
      setTbankStatus({ error: e.message });
    } finally {
      setTbankStatusBusy(false);
    }
  }

  async function runTbankBackfill() {
    if (!tbankFrom || !tbankTo) return;
    setTbankBusy(true);
    setTbankResult(null);
    try {
      const res = await fetch('/api/payments/tbank/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: tbankFrom, to: tbankTo }),
      });
      const json = await res.json();
      setTbankResult(json);
      if (res.ok) await load();
    } catch (e: any) {
      setTbankResult({ error: e.message });
    } finally {
      setTbankBusy(false);
    }
  }

  async function webhookAction(action: 'subscribe' | 'test') {
    setWebhookBusy(true);
    try {
      const res = await fetch('/api/payments/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      setWebhookInfo(await res.json());
    } catch (e: any) {
      setWebhookInfo({ error: e.message });
    } finally {
      setWebhookBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        tab.kind === 'review'
          ? '?review=1'
          : tab.value
            ? `?${tab.kind === 'project' ? 'project' : 'status'}=${tab.value}`
            : '';
      const res = await fetch(`/api/payments/list${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      setPayments(json.payments || []);
      setSummary(json.summary || {});
      setProjectSummary(json.projectSummary || {});
      setReviewCount(json.reviewCount || 0);
      setCrmUrl(json.crm_url || '');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(paymentId: number, orderNumber: string) {
    if (!orderNumber?.trim()) return;
    setBusyId(paymentId);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_number: orderNumber.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка привязки');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function ignore(paymentId: number) {
    setBusyId(paymentId);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const actionable = (s: string) => s === 'pending_match' || s === 'failed';

  return (
    // Полноэкранная flex-колонка: панели/вкладки зафиксированы, скроллится только тело таблицы.
    <div className="flex h-full min-h-0 flex-col bg-white text-gray-900">
      {/* Шапка + панели (фиксированы) */}
      <div className="shrink-0 border-b border-gray-200">
        <div className="px-4 pt-4 pb-3">
          <h1 className="text-xl font-black tracking-tight">Платежи «с точки»</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Банковские платежи (Точка) и их разнос по заказам. Неоднозначные — на ручной разбор.
          </p>
        </div>

        {/* Точка — счета и выписка (сворачивается) */}
        <div className="border-t border-gray-200">
          <button
            onClick={() => setTochkaOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
          >
            <span className="text-sm font-semibold">🟣 Точка — счета и выписка</span>
            <span className="text-gray-400">{tochkaOpen ? '▲' : '▼'}</span>
          </button>
        {tochkaOpen && (
        <div className="bg-gray-50">
        {/* Подключение вебхука Точки (сервисное) */}
        <div className="border-t border-gray-200">
          <button
            onClick={() => {
              setSetupOpen((v) => !v);
              if (!webhookInfo) loadWebhookStatus();
            }}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
          >
            <span className="text-sm font-semibold">⚙️ Подключение вебхука Точки</span>
            <span className="text-gray-400">{setupOpen ? '▲' : '▼'}</span>
          </button>

          {setupOpen && (
            <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-600">
                У Точки нет кнопки для вебхуков — адрес приёма подключается через её API.
                Кнопка ниже сделает это за вас (токен берётся из окружения сервера).
              </p>
              {webhookInfo?.our_webhook_url && (
                <div className="text-xs text-gray-500">
                  Наш адрес приёма: <code className="bg-gray-200 px-1">{webhookInfo.our_webhook_url}</code>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={webhookBusy}
                  onClick={() => webhookAction('subscribe')}
                  className="bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Подключить вебхук
                </button>
                <button
                  disabled={webhookBusy}
                  onClick={() => webhookAction('test')}
                  className="border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Тест доставки
                </button>
                <button
                  disabled={webhookBusy}
                  onClick={loadWebhookStatus}
                  className="border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Проверить статус
                </button>
              </div>
              {webhookInfo && <ResultBox data={webhookInfo.tochka ?? webhookInfo.result ?? webhookInfo} />}

              {webhookInfo?.last_webhook && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-gray-500">
                    Последний вебхук, полученный от Точки ({webhookInfo.last_webhook.updated_at}):
                  </div>
                  <ResultBox data={webhookInfo.last_webhook} tone="green" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Загрузка выписки за период */}
        <div className="border-t border-gray-200 px-4 py-3">
          <div className="mb-1 text-sm font-semibold">📥 Загрузить выписку за период</div>
          <p className="mb-3 text-sm text-gray-500">
            Подтягивает исторические платежи из банковской выписки Точки. Требует OAuth-доступа
            (по обычному ключу выписка может вернуть 501).
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-gray-500">С</span>
              <input
                type="date"
                value={backfillFrom}
                onChange={(e) => setBackfillFrom(e.target.value)}
                className="border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-gray-500">По</span>
              <input
                type="date"
                value={backfillTo}
                onChange={(e) => setBackfillTo(e.target.value)}
                className="border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
              />
            </label>
            <button
              disabled={backfillBusy || !backfillFrom || !backfillTo}
              onClick={runBackfill}
              className="bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {backfillBusy ? 'Загружаю…' : 'Загрузить'}
            </button>
          </div>
          {backfillResult && (
            <div className="mt-3 space-y-2">
              {backfillResult.needs_oauth && (
                <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Выписка требует OAuth (JWT вернул 501). Нужно настроить OAuth+Consent в Точке.
                </div>
              )}
              {typeof backfillResult.ingested === 'number' && (
                <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Загружено платежей: {backfillResult.ingested}. Обнови список ниже.
                </div>
              )}
              <ResultBox data={backfillResult} />
            </div>
          )}

          {/* Разовый бэкофилл получателя (наше юрлицо) по счетам Точки */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              disabled={tochkaRecipBusy}
              onClick={fillTochkaRecipients}
              className="border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              title="Проставить наименование юрлица-получателя по счёту (из API Точки) для существующих платежей"
            >
              {tochkaRecipBusy ? 'Заполняю…' : 'Заполнить получателей'}
            </button>
            {tochkaRecipResult && (
              <div className="mt-2 space-y-2">
                {typeof tochkaRecipResult.updated === 'number' && (
                  <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Проставлен получатель: {tochkaRecipResult.updated} платеж(ей).
                  </div>
                )}
                <ResultBox data={tochkaRecipResult} />
              </div>
            )}
          </div>
        </div>
        </div>
        )}
        </div>

        {/* Т-Банк — счета и выписка */}
        <div className="border-t border-gray-200">
          <button
            onClick={() => setTbankOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
          >
            <span className="text-sm font-semibold">🏦 Т-Банк — счета и выписка</span>
            <span className="text-gray-400">{tbankOpen ? '▲' : '▼'}</span>
          </button>

          {tbankOpen && (
            <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-600">
                Работает по токену (<code className="bg-gray-200 px-1">TBANK_API_TOKEN</code>). Выписка
                тянется <b>автоматически по крону</b> раз в 15 минут. Ниже — ручная проверка связи и
                загрузка выписки за произвольный период.
              </p>

              {/* Проверка связи + диагностика полей */}
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={tbankStatusBusy}
                  onClick={checkTbank}
                  className="bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {tbankStatusBusy ? 'Проверяю…' : 'Проверить связь'}
                </button>
                <button
                  disabled={tbankStatusBusy}
                  onClick={probeTbank}
                  className="border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  title="Показать сырьё первых операций рядом с нормализованным видом — сверить имена полей"
                >
                  Диагностика полей
                </button>
              </div>

              {tbankStatus && (
                <div className="space-y-2">
                  {tbankStatus.configured === false && (
                    <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Токен Т-Банка не задан. Добавьте <code className="bg-amber-100 px-1">TBANK_API_TOKEN</code> в
                      переменные окружения Vercel.
                    </div>
                  )}
                  {tbankStatus.connected === true && (
                    <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      Связь есть. Доступно счетов: {tbankStatus.accounts_count}.
                    </div>
                  )}
                  {tbankStatus.connected === false && tbankStatus.configured && (
                    <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Токен задан, но банк ответил ошибкой (см. ниже).
                    </div>
                  )}
                  <ResultBox data={tbankStatus} />
                </div>
              )}

              {/* Ручная загрузка выписки за период */}
              <div className="border-t border-gray-200 pt-3">
                <div className="mb-1 text-sm font-semibold">📥 Загрузить выписку Т-Банка за период</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-gray-500">С</span>
                    <input
                      type="date"
                      value={tbankFrom}
                      onChange={(e) => setTbankFrom(e.target.value)}
                      className="border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-gray-500">По</span>
                    <input
                      type="date"
                      value={tbankTo}
                      onChange={(e) => setTbankTo(e.target.value)}
                      className="border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                  </label>
                  <button
                    disabled={tbankBusy || !tbankFrom || !tbankTo}
                    onClick={runTbankBackfill}
                    className="bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {tbankBusy ? 'Загружаю…' : 'Загрузить'}
                  </button>
                </div>
                {tbankResult && (
                  <div className="mt-3 space-y-2">
                    {typeof tbankResult.ingested === 'number' && (
                      <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Загружено платежей: {tbankResult.ingested}
                        {typeof tbankResult.matched === 'number' ? ` · привязано: ${tbankResult.matched}` : ''}
                        {typeof tbankResult.pending === 'number' ? ` · на разбор: ${tbankResult.pending}` : ''}.
                      </div>
                    )}
                    <ResultBox data={tbankResult} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Вкладки: проекты (ЗМКТЛ/Столярка/ПО) + статусы */}
        <div className="flex flex-wrap items-center gap-1 border-t border-gray-200 px-4 py-2">
          {TABS.map((t) => {
            const active = tab.kind === t.kind && tab.value === t.value;
            const count =
              t.kind === 'review'
                ? reviewCount
                : t.kind === 'project'
                  ? projectSummary[t.value]
                  : t.value
                    ? summary[t.value]
                    : 0;
            return (
              <button
                key={`${t.kind}:${t.value || 'all'}`}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t.label}
                {count ? ` · ${count}` : ''}
              </button>
            );
          })}
          <button
            onClick={load}
            className="ml-auto border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Обновить
          </button>
        </div>

        {error && <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      </div>

      {/* Тело: единственный скролл-контейнер */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="py-16 text-center text-gray-400">Загрузка…</div>
        ) : payments.length === 0 ? (
          <div className="py-16 text-center text-gray-400">Платежей нет</div>
        ) : (
          <table className="w-full min-w-[1200px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3 text-right">Сумма</th>
                <th className="px-4 py-3">Плательщик</th>
                <th className="px-4 py-3">Получатель</th>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Назначение</th>
                <th className="px-4 py-3">Заказ</th>
                <th className="px-4 py-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const link = crmOrderLink(crmUrl, p.matched_order_id, p.matched_order_number);
                // Столярка/консалтинг не привязываются к заказам ЗМКТЛ — без «Привязать».
                const isForeign = p.project === 'stolyarka' || p.project === 'consulting';
                return (
                  <tr key={p.id} className="border-b border-gray-100 odd:bg-white even:bg-gray-50 hover:bg-blue-50">
                    {/* Статус */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`inline-block px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status] || 'bg-gray-100'}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                        <span
                          className={`inline-block px-2 py-0.5 text-[11px] font-semibold ${SOURCE_STYLES[p.source] || 'bg-gray-100 text-gray-600'}`}
                          title="Источник платежа"
                        >
                          {SOURCE_LABELS[p.source] || p.source}
                        </span>
                        {p.project && (
                          <span
                            className="inline-block bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                            title="Проект"
                          >
                            {PROJECT_LABELS[p.project] || p.project}
                          </span>
                        )}
                      </div>
                      {!p.signature_verified && (
                        <span
                          className="mt-1 block w-fit bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700"
                          title="Подпись вебхука не проверена — авто-проброс отключён"
                        >
                          подпись не проверена
                        </span>
                      )}
                    </td>

                    {/* Сумма */}
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top font-bold tabular-nums">
                      {formatMoney(p.amount_kopecks, p.currency)}
                    </td>

                    {/* Плательщик */}
                    <td className="px-4 py-3 align-top">
                      <div className="min-w-[180px] max-w-[260px] break-words">
                        {p.payer_name || <Dash />}
                      </div>
                      {p.payer_inn && <div className="text-xs text-gray-500">ИНН {p.payer_inn}</div>}
                    </td>

                    {/* Получатель (наше юрлицо) */}
                    <td className="px-4 py-3 align-top">
                      <div className="min-w-[180px] max-w-[260px] break-words">
                        {p.recipient_name || <Dash />}
                      </div>
                      {p.recipient_inn && <div className="text-xs text-gray-500">ИНН {p.recipient_inn}</div>}
                    </td>

                    {/* Дата */}
                    <td className="whitespace-nowrap px-4 py-3 align-top text-gray-600">
                      {p.payment_date || <Dash />}
                    </td>

                    {/* Назначение */}
                    <td className="px-4 py-3 align-top">
                      {p.purpose ? (
                        <div className="min-w-[280px] max-w-[440px] break-words text-gray-700">
                          {p.purpose}
                        </div>
                      ) : (
                        <Dash />
                      )}
                      <div className="mt-0.5 text-xs text-gray-400">
                        Платёж #{p.document_number || p.external_payment_id}
                      </div>
                    </td>

                    {/* Заказ + состояние проброса в CRM */}
                    <td className="px-4 py-3 align-top">
                      {p.matched_order_number ? (
                        link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-600 underline decoration-dotted hover:text-blue-800"
                            title="Открыть заказ в RetailCRM"
                          >
                            №{p.matched_order_number} ↗
                          </a>
                        ) : (
                          <span className="font-semibold text-gray-700">№{p.matched_order_number}</span>
                        )
                      ) : (
                        <Dash />
                      )}
                      {p.retailcrm_synced_at && <div className="mt-0.5 text-xs text-emerald-600">✓ в RetailCRM</div>}
                      {p.retailcrm_error && (
                        <div className="mt-0.5 max-w-[180px] truncate text-xs text-red-500" title={p.retailcrm_error}>
                          ошибка CRM
                        </div>
                      )}
                    </td>

                    {/* Действия (ручной разбор) */}
                    <td className="px-4 py-3 align-top">
                      {actionable(p.status) ? (
                        <div className="space-y-2">
                          {!isForeign && p.match_candidates && p.match_candidates.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {p.match_candidates.map((c, i) => {
                                const cLink = crmOrderLink(crmUrl, c.orderId, c.orderNumber);
                                return (
                                  <span key={i} className="inline-flex items-center border border-blue-200 bg-blue-50">
                                    <button
                                      disabled={busyId === p.id}
                                      onClick={() => assign(p.id, c.orderNumber)}
                                      className="px-2 py-1 text-xs text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                                      title={`Привязать к заказу №${c.orderNumber} (${c.reason})`}
                                    >
                                      №{c.orderNumber}
                                      {c.totalKopecks != null ? ` · ${formatMoney(c.totalKopecks)}` : ''}
                                    </button>
                                    {cLink && (
                                      <a
                                        href={cLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="border-l border-blue-200 px-1.5 py-1 text-blue-500 hover:bg-blue-100"
                                        title="Открыть заказ в RetailCRM"
                                      >
                                        ↗
                                      </a>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {!isForeign && (
                              <>
                                <input
                                  value={manualNumber[p.id] || ''}
                                  onChange={(e) => setManualNumber((m) => ({ ...m, [p.id]: e.target.value }))}
                                  placeholder="Номер заказа"
                                  className="w-36 border border-gray-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none"
                                />
                                <button
                                  disabled={busyId === p.id}
                                  onClick={() => assign(p.id, manualNumber[p.id] || '')}
                                  className="bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Привязать
                                </button>
                              </>
                            )}
                            <button
                              disabled={busyId === p.id}
                              onClick={() => ignore(p.id)}
                              className="border border-gray-300 bg-white px-3 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                            >
                              Пропустить
                            </button>
                          </div>
                        </div>
                      ) : (
                        <Dash />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
