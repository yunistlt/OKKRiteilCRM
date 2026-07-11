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

export default function PaymentsPage() {
  const [tab, setTab] = useState<string>('pending_match');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [manualNumber, setManualNumber] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

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
                    <div className="text-emerald-600">Заказ №{p.matched_order_number}</div>
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
                          <button
                            key={i}
                            disabled={busyId === p.id}
                            onClick={() => assign(p.id, c.orderNumber)}
                            className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                            title={c.reason}
                          >
                            №{c.orderNumber}
                            {c.totalKopecks != null ? ` · ${formatMoney(c.totalKopecks)}` : ''}
                          </button>
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
