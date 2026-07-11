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
  status: string;
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

const STATUS_STYLES: Record<string, string> = {
  pending_match: 'bg-amber-100 text-amber-800',
  matched: 'bg-emerald-100 text-emerald-800',
  manual: 'bg-blue-100 text-blue-800',
  ignored: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-800',
};

const TABS: Array<{ key: string; label: string }> = [
  { key: 'pending_match', label: 'Требуют разбора' },
  { key: 'matched', label: 'Привязанные' },
  { key: 'manual', label: 'Вручную' },
  { key: 'ignored', label: 'Пропущенные' },
  { key: '', label: 'Все' },
];

function formatMoney(kopecks: number, currency = 'RUB') {
  const rub = kopecks / 100;
  return rub.toLocaleString('ru-RU', { style: 'currency', currency, minimumFractionDigits: 2 });
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
      className="rounded-md bg-gray-700 px-2 py-1 text-xs font-semibold text-gray-100 hover:bg-gray-600"
    >
      {copied ? 'Скопировано ✓' : 'Копировать'}
    </button>
  );
}

// Окно с JSON + кнопкой копирования.
function ResultBox({ data, tone = 'gray' }: { data: unknown; tone?: 'gray' | 'green' }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="rounded-lg bg-gray-900 p-3">
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
  const [tab, setTab] = useState<string>('pending_match');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
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
      const url = tab ? `/api/payments/list?status=${tab}` : '/api/payments/list';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      setPayments(json.payments || []);
      setSummary(json.summary || {});
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

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight">Платежи «с точки»</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Банковские платежи (Точка) и их разнос по заказам. Неоднозначные — на ручной разбор.
        </p>
      </div>

      {/* Настройка вебхука Точки */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <button
          onClick={() => {
            setSetupOpen((v) => !v);
            if (!webhookInfo) loadWebhookStatus();
          }}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="font-semibold">⚙️ Подключение вебхука Точки</span>
          <span className="text-gray-400">{setupOpen ? '▲' : '▼'}</span>
        </button>

        {setupOpen && (
          <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
            <p className="text-sm text-gray-600">
              У Точки нет кнопки для вебхуков — адрес приёма подключается через её API.
              Кнопка ниже сделает это за вас (токен берётся из окружения сервера).
            </p>
            {webhookInfo?.our_webhook_url && (
              <div className="text-xs text-gray-500">
                Наш адрес приёма: <code className="rounded bg-gray-100 px-1">{webhookInfo.our_webhook_url}</code>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={webhookBusy}
                onClick={() => webhookAction('subscribe')}
                className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                Подключить вебхук
              </button>
              <button
                disabled={webhookBusy}
                onClick={() => webhookAction('test')}
                className="rounded-lg bg-gray-100 px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Тест доставки
              </button>
              <button
                disabled={webhookBusy}
                onClick={loadWebhookStatus}
                className="rounded-lg bg-gray-100 px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Проверить статус
              </button>
            </div>
            {webhookInfo && (
              <ResultBox data={webhookInfo.tochka ?? webhookInfo.result ?? webhookInfo} />
            )}

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
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-2 font-semibold">📥 Загрузить выписку за период</div>
        <p className="mb-3 text-sm text-gray-600">
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
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-500">По</span>
            <input
              type="date"
              value={backfillTo}
              onChange={(e) => setBackfillTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
            />
          </label>
          <button
            disabled={backfillBusy || !backfillFrom || !backfillTo}
            onClick={runBackfill}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {backfillBusy ? 'Загружаю…' : 'Загрузить'}
          </button>
        </div>
        {backfillResult && (
          <div className="mt-3">
            {backfillResult.needs_oauth && (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Выписка требует OAuth (JWT вернул 501). Нужно настроить OAuth+Consent в Точке.
              </div>
            )}
            {typeof backfillResult.ingested === 'number' && (
              <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Загружено платежей: {backfillResult.ingested}. Обнови список ниже.
              </div>
            )}
            <ResultBox data={backfillResult} />
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key || 'all'}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t.label}
            {t.key && summary[t.key] ? ` · ${summary[t.key]}` : ''}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto rounded-full bg-gray-100 px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
        >
          Обновить
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-16 text-center text-muted-foreground">Загрузка…</div>
      ) : payments.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">Платежей нет</div>
      ) : (
        <div className="space-y-4">
          {payments.map((p) => (
            <div key={p.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black">{formatMoney(p.amount_kopecks, p.currency)}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status] || 'bg-gray-100'}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                    {!p.signature_verified && (
                      <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700" title="Подпись вебхука не проверена — авто-проброс отключён">
                        подпись не проверена
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    {p.payer_name || 'Плательщик не указан'}
                    {p.payer_inn ? ` · ИНН ${p.payer_inn}` : ''}
                    {p.payment_date ? ` · ${p.payment_date}` : ''}
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div>Платёж #{p.document_number || p.external_payment_id}</div>
                  {p.matched_order_number && (
                    <div>
                      {crmOrderLink(crmUrl, p.matched_order_id, p.matched_order_number) ? (
                        <a
                          href={crmOrderLink(crmUrl, p.matched_order_id, p.matched_order_number)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-emerald-600 underline decoration-dotted hover:text-emerald-700"
                          title="Открыть заказ в RetailCRM"
                        >
                          Заказ №{p.matched_order_number} ↗
                        </a>
                      ) : (
                        <span className="text-emerald-600">Заказ №{p.matched_order_number}</span>
                      )}
                    </div>
                  )}
                  {p.retailcrm_synced_at && (
                    <div className="text-emerald-600">✓ в RetailCRM</div>
                  )}
                  {p.retailcrm_error && (
                    <div className="max-w-xs text-red-500" title={p.retailcrm_error}>ошибка CRM</div>
                  )}
                </div>
              </div>

              {p.purpose && (
                <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  <span className="text-gray-400">Назначение: </span>
                  {p.purpose}
                </div>
              )}

              {p.extracted_invoice_number && (
                <div className="mt-2 text-xs text-gray-500">
                  Извлечён номер счёта/заказа: <b>{p.extracted_invoice_number}</b>
                </div>
              )}

              {(p.status === 'pending_match' || p.status === 'failed') && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  {p.match_candidates && p.match_candidates.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-1 text-xs font-semibold text-gray-500">Кандидаты:</div>
                      <div className="flex flex-wrap gap-2">
                        {p.match_candidates.map((c, i) => (
                          <span key={i} className="inline-flex items-center overflow-hidden rounded-lg border border-violet-200 bg-violet-50">
                            <button
                              disabled={busyId === p.id}
                              onClick={() => assign(p.id, c.orderNumber)}
                              className="px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                              title={`Привязать к заказу №${c.orderNumber} (${c.reason})`}
                            >
                              №{c.orderNumber}
                              {c.totalKopecks != null ? ` · ${formatMoney(c.totalKopecks)}` : ''}
                            </button>
                            {crmOrderLink(crmUrl, c.orderId, c.orderNumber) && (
                              <a
                                href={crmOrderLink(crmUrl, c.orderId, c.orderNumber)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="border-l border-violet-200 px-2 py-1.5 text-violet-500 hover:bg-violet-100"
                                title="Открыть заказ в RetailCRM"
                              >
                                ↗
                              </a>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={manualNumber[p.id] || ''}
                      onChange={(e) => setManualNumber((m) => ({ ...m, [p.id]: e.target.value }))}
                      placeholder="Номер заказа вручную"
                      className="w-48 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
                    />
                    <button
                      disabled={busyId === p.id}
                      onClick={() => assign(p.id, manualNumber[p.id] || '')}
                      className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      Привязать
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() => ignore(p.id)}
                      className="rounded-lg bg-gray-100 px-4 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                    >
                      Пропустить
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
