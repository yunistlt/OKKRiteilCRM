'use client';

// Подключение к делу суда или исполнительного производства.
//
// Связь ставит человек и только человек: ошибочная привязка тянет в дело чужие
// суммы, а руководитель увидит неверный риск. Поэтому автоподбора здесь нет —
// есть поиск и явный выбор.
import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from './matters-shared';

type Candidate = {
  id: number | string;
  case_number: string | null;
  title: string;
  subtitle: string;
  amount: number | null;
};

export default function MatterLinkForm({ matterId, onSaved }: { matterId: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [courtCases, setCourtCases] = useState<Candidate[]>([]);
  const [enforcementCases, setEnforcementCases] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/legal/matters/links?q=${encodeURIComponent(query)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось получить список');

      setCourtCases(
        (payload.court_cases || []).map((row: any) => ({
          id: row.id,
          case_number: row.case_number,
          title: row.case_number || `Дело ${row.id}`,
          subtitle: [row.court_name, row.plaintiff, row.defendant].filter(Boolean).join(' · '),
          amount: row.amount_kopecks ?? null,
        })),
      );

      setEnforcementCases(
        (payload.enforcement_cases || []).map((row: any) => ({
          id: row.id,
          case_number: row.case_number,
          title: row.case_number || `Карточка ${row.id}`,
          subtitle: [row.debtor_name, row.claimant_name].filter(Boolean).join(' · '),
          amount: row.debt_amount_kopecks ?? null,
        })),
      );

      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [query]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const link = async (kind: string, targetId: string | number) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/legal/matters/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matter_id: matterId, target_kind: kind, target_id: String(targetId) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Не удалось связать');

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
      <button onClick={() => setOpen(true)} className="mt-2 text-[11px] font-semibold text-gray-600 hover:text-gray-900">
        + Подключить суд или производство
      </button>
    );
  }

  return (
    <div className="mt-2 border border-gray-200 p-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Поиск: номер дела, сторона"
        className="mb-2 w-full border border-gray-300 px-2 py-1 text-xs"
      />

      {error && <div className="mb-2 bg-red-50 p-1 text-[11px] text-red-700">{error}</div>}

      <Group
        title="Судебные дела"
        items={courtCases}
        disabled={saving}
        onPick={(id) => link('court_case', id)}
        empty="Судебных дел пока нет — они приезжают письмами подписки «Электронного стража»."
      />

      <Group
        title="Исполнительные производства"
        items={enforcementCases}
        disabled={saving}
        onPick={(id) => link('enforcement_case', id)}
        empty="Карточек производств нет."
      />

      <button onClick={() => setOpen(false)} className="mt-1 text-[11px] font-semibold text-gray-500 hover:text-gray-900">
        Закрыть
      </button>
    </div>
  );
}

function Group({
  title,
  items,
  disabled,
  onPick,
  empty,
}: {
  title: string;
  items: Candidate[];
  disabled: boolean;
  onPick: (id: string | number) => void;
  empty: string;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">{title}</div>
      {items.length === 0 && <div className="text-[11px] text-gray-400">{empty}</div>}
      {items.map((item) => (
        <button
          key={`${title}-${item.id}`}
          disabled={disabled}
          onClick={() => onPick(item.id)}
          className="block w-full border-b border-gray-100 py-1 text-left text-xs hover:bg-gray-50 disabled:opacity-50"
        >
          <span className="font-semibold text-gray-900">{item.title}</span>
          {item.amount !== null && <span className="ml-2 text-gray-600">{formatMoney(item.amount)}</span>}
          {item.subtitle && <span className="block text-[11px] text-gray-500">{item.subtitle}</span>}
        </button>
      ))}
    </div>
  );
}
