'use client';

// Сумма на кону с раскрытием по клику.
//
// ЗАКОН проекта: любое названное число раскладывается до исходных данных по
// первому вопросу. Поэтому «580 000 ₽» здесь — не итог из воздуха, а кнопка:
// нажал и видишь, из чего он собран и что вычлось.
import { useState } from 'react';
import { dictName, formatMoney, type Dictionaries, type RiskPartRow } from './matters-shared';

type Props = {
  risk: { totalKopecks: number; parts: RiskPartRow[]; side: string };
  dictionaries: Dictionaries;
};

export default function RiskAmount({ risk, dictionaries }: Props) {
  const [open, setOpen] = useState(false);

  if (!risk || risk.parts.length === 0) {
    return <span className="text-gray-300">—</span>;
  }

  return (
    <span className="relative inline-block">
      <button
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="font-semibold text-gray-900 underline decoration-dotted underline-offset-2 hover:text-blue-700"
        title="Показать, из чего складывается"
      >
        {formatMoney(risk.totalKopecks)}
      </button>

      {open && (
        <span
          onClick={(event) => event.stopPropagation()}
          className="absolute right-0 z-20 mt-1 block w-72 border border-gray-300 bg-white p-2 text-left text-xs shadow-none"
        >
          <span className="mb-1 block font-bold text-gray-700">Из чего складывается</span>
          {risk.parts.map((part) => (
            <span key={part.field} className="flex justify-between border-b border-gray-100 py-0.5">
              <span className="text-gray-600">
                {part.adds ? '+ ' : '− '}
                {dictName(dictionaries, 'money_field', part.field)}
              </span>
              <span className="font-semibold text-gray-900">{formatMoney(part.kopecks)}</span>
            </span>
          ))}
          <span className="mt-1 flex justify-between font-bold text-gray-900">
            <span>Итого на кону</span>
            <span>{formatMoney(risk.totalKopecks)}</span>
          </span>
          <span className="mt-1 block text-[11px] text-gray-400">
            {risk.side === 'claimant'
              ? 'Требуем мы: показано недополученное, взысканное уже вычтено.'
              : 'Требуют с нас: показана возможная потеря, урегулированное вычтено.'}
          </span>
        </span>
      )}
    </span>
  );
}
