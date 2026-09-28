'use client';

// Заведение дела. Полей намеренно мало: из опыта карточек ИП — форму на 30 полей
// не заполняют, раздел умирает. Остальное дозаполняется в карточке и ботом из документов.
import { useState } from 'react';
import type { Dictionaries } from './matters-shared';

type Props = {
  dictionaries: Dictionaries;
  onCreated: () => void;
};

export default function NewMatterForm({ dictionaries, onCreated }: Props) {
  const [form, setForm] = useState({
    counterparty_name: '',
    counterparty_inn: '',
    matter_side: 'respondent',
    category: '',
    subject: '',
    contract_no: '',
    order_number: '',
    next_action: '',
    next_action_due: '',
    claim_right_on: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {};
      for (const [key, value] of Object.entries(form)) {
        if (String(value).trim()) payload[key] = String(value).trim();
      }

      const response = await fetch('/api/legal/matters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Не удалось создать дело');

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 bg-white p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-700">Новое дело</div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Field label="Контрагент">
          <input
            value={form.counterparty_name}
            onChange={(event) => set('counterparty_name', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
            placeholder="ООО «Ромашка»"
          />
        </Field>

        <Field label="ИНН контрагента">
          <input
            value={form.counterparty_inn}
            onChange={(event) => set('counterparty_inn', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
            placeholder="10 или 12 цифр"
          />
        </Field>

        <Field label="Сторона спора">
          <select
            value={form.matter_side}
            onChange={(event) => set('matter_side', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
          >
            {(dictionaries.matter_side || []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Категория">
          <select
            value={form.category}
            onChange={(event) => set('category', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">—</option>
            {(dictionaries.category || []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Договор">
          <input
            value={form.contract_no}
            onChange={(event) => set('contract_no', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
          />
        </Field>

        <Field label="Заказ в CRM">
          <input
            value={form.order_number}
            onChange={(event) => set('order_number', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
            placeholder="номер заказа"
          />
        </Field>

        <Field label="Суть спора" wide>
          <input
            value={form.subject}
            onChange={(event) => set('subject', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
            placeholder="Одно-два предложения: чего хотят и почему"
          />
        </Field>

        <Field label="Право требования возникло">
          <input
            type="date"
            value={form.claim_right_on}
            onChange={(event) => set('claim_right_on', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
          />
        </Field>

        <Field label="Следующее действие">
          <input
            value={form.next_action}
            onChange={(event) => set('next_action', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
            placeholder="Что делаем дальше"
          />
        </Field>

        <Field label="Срок действия">
          <input
            type="date"
            value={form.next_action_due}
            onChange={(event) => set('next_action_due', event.target.value)}
            className="w-full border border-gray-300 px-2 py-1 text-xs"
          />
        </Field>
      </div>

      {error && <div className="mt-2 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Завести дело'}
        </button>
        <span className="text-[11px] text-gray-400">
          Номер дела присвоится автоматически и больше не изменится.
        </span>
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'md:col-span-2' : ''}`}>
      <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}
