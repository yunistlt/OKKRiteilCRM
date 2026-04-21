import fetch from 'node-fetch';

export interface CounterpartyScoreResult {
  inn: string;
  risk_score: 'green' | 'yellow' | 'red';
  summary: string;
  raw_data: any;
}

/**
 * Проверка контрагента по ИНН через внешний API (заглушка для Dadata/FNS/Rusprofile)
 * @param inn ИНН контрагента
 */
export async function checkCounterpartyByInn(inn: string): Promise<CounterpartyScoreResult> {
  // TODO: заменить на реальный API
  // Пример запроса:
  // const resp = await fetch(`https://api.dadata.ru/v1/score?inn=${inn}`, { headers: { Authorization: 'Token ...' } });
  // const data = await resp.json();
  // ...обработка ответа...

  // Демонстрационная логика (заглушка)
  if (inn.endsWith('0')) {
    return {
      inn,
      risk_score: 'red',
      summary: 'Красный флаг: компания в стадии банкротства, 5 активных судов на сумму 2 млн руб.',
      raw_data: { bankrupt: true, court_cases: 5, sum: 2000000 }
    };
  } else if (inn.endsWith('5')) {
    return {
      inn,
      risk_score: 'yellow',
      summary: 'Жёлтый флаг: есть просрочки по налогам, 1 суд на 100 тыс.',
      raw_data: { bankrupt: false, court_cases: 1, sum: 100000 }
    };
  } else {
    return {
      inn,
      risk_score: 'green',
      summary: 'Зелёный флаг: проблем не обнаружено.',
      raw_data: { bankrupt: false, court_cases: 0, sum: 0 }
    };
  }
}
