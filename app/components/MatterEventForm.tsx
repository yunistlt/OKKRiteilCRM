'use client';

// Запись события в журнал. Здесь же — новая стадия и следующий шаг: одно
// действие человека вместо трёх, и журнал физически не может разойтись с карточкой.
import { useState } from 'react';
import type { Dictionaries } from './matters-shared';

type Props = {
  matterId: number;
  dictionaries: Dictionaries;
  currentStage: string;
  onSaved: () => void;
};

export default function MatterEventForm({ matterId, dictionaries, currentStage, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: 'note',
    title: '',
    description: '',
    result: '',
    event_on: new Date().toISOString().slice(0, 10),
    stage_after: '',
    next_action: '',
    next_action_due: '',
  });

  const set = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        matter_id: matterId,
        kind: form.kind,
        title: form.title.trim(),
        event_on: form.event_on,
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.result.trim()) payload.result = form.result.trim();
      if (form.stage_after && form.stage_after !== currentStage) payload.stage_after = form.stage_after;
      if (form.next_action.trim()) payload.next_action = form.next_action.trim();
      if (form.next_action_due) payload.next_action_due = form.next_action_due;

      const response = await fetch('/api/legal/matters/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Не удалось записать событие');

      setForm((prev) => ({ ...prev, title: '', description: '', result: '', next_action: '', next_action_due: '' }));
      setOpen(false);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700">
        + Записать действие
      </button>
    );
  }

  return (
    <div className="border border-gray-200 p-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="block">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Дата</span>
          <input type="date" value={form.event_on} onChange={(e) => set('event_on', e.target.value)} className="w-full border border-gray-300 px-2 py-1 text-xs" />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Что произошло</span>
          <select value={form.kind} onChange={(e) => set('kind', e.target.value)} className="w-full border border-gray-300 px-2 py-1 text-xs">
            {(dictionaries.event_kind || []).map((item) => (
              <option key={item.code} value={item.code}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Новая стадия</span>
          <select value={form.stage_after} onChange={(e) => set('stage_after', e.target.value)} className="w-full border border-gray-300 px-2 py-1 text-xs">
            <option value="">не меняется</option>
            {(dictionaries.stage || []).map((item) => (
              <option key={item.code} value={item.code}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-3">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Кратко</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Например: направлен ответ на претензию" className="w-full border border-gray-300 px-2 py-1 text-xs" />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Подробности</span>
          <input value={form.description} onChange={(e) => set('description', e.target.value)} className="w-full border border-gray-300 px-2 py-1 text-xs" />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Результат</span>
          <input value={form.result} onChange={(e) => set('result', e.target.value)} className="w-full border border-gray-300 px-2 py-1 text-xs" />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Следующее действие</span>
          <input value={form.next_action} onChange={(e) => set('next_action', e.target.value)} placeholder="Что делаем дальше" className="w-full border border-gray-300 px-2 py-1 text-xs" />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">Срок</span>
          <input type="date" value={form.next_action_due} onChange={(e) => set('next_action_due', e.target.value)} className="w-full border border-gray-300 px-2 py-1 text-xs" />
        </label>
      </div>

      {error && <div className="mt-2 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={saving || !form.title.trim()} className="bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? 'Сохраняем…' : 'Записать'}
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
          Отмена
        </button>
      </div>
    </div>
  );
}
