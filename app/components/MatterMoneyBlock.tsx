'use client';

// Деньги по делу. Вводятся в рублях, хранятся в копейках: рубли с копейками
// в плавающей точке не живут, а это суммы, которые пойдут в суд.
import { useState } from 'react';
import { dictName, formatMoney, type Dictionaries, type MatterRowUi } from './matters-shared';
import RiskAmount from './RiskAmount';

const FIELDS = [
  'contract_amount_kopecks',
  'claim_amount_kopecks',
  'our_claim_amount_kopecks',
  'penalty_kopecks',
  'damages_kopecks',
  'state_duty_kopecks',
  'court_costs_kopecks',
  'settled_amount_kopecks',
  'recovered_kopecks',
  'paid_out_kopecks',
  'costs_recovered_kopecks',
] as const;

export default function MatterMoneyBlock({
  matter,
  dictionaries,
  onSaved,
}: {
  matter: MatterRowUi;
  dictionaries: Dictionaries;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of FIELDS) {
      const value = matter[field];
      initial[field] = value === null || value === undefined ? '' : String(Number(value) / 100);
    }
    return initial;
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {};
      for (const field of FIELDS) {
        const raw = draft[field]?.trim();
        payload[field] = raw ? Math.round(Number(raw.replace(/\s/g, '').replace(',', '.')) * 100) : null;
        if (raw && !Number.isFinite(payload[field])) throw new Error('Проверьте суммы: введено не число');
      }

      const response = await fetch(`/api/legal/matters/${matter.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Не удалось сохранить суммы');

      setEditing(false);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between border-b border-gray-200 pb-1">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-700">Деньги</span>
        <button onClick={() => setEditing((value) => !value)} className="text-[11px] font-semibold text-gray-500 hover:text-gray-900">
          {editing ? 'Отмена' : 'Изменить'}
        </button>
      </div>

      {FIELDS.map((field) => (
        <div key={field} className="flex items-center justify-between gap-2 border-b border-gray-100 py-1 text-xs last:border-0">
          <span className="text-gray-500">{dictName(dictionaries, 'money_field', field)}</span>
          {editing ? (
            <input
              value={draft[field]}
              onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))}
              className="w-28 border border-gray-300 px-1 py-0.5 text-right text-xs"
              placeholder="0"
            />
          ) : (
            <span className="font-semibold text-gray-900">{formatMoney(matter[field])}</span>
          )}
        </div>
      ))}

      {error && <div className="mt-2 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      {editing && (
        <button onClick={save} disabled={saving} className="mt-2 bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? 'Сохраняем…' : 'Сохранить суммы'}
        </button>
      )}

      <div className="mt-2 flex items-baseline justify-between border-t border-gray-200 pt-2">
        <span className="text-xs font-bold text-gray-700">На кону</span>
        <RiskAmount risk={matter.risk} dictionaries={dictionaries} />
      </div>
    </div>
  );
}
