// scripts/voc_historical_mining.ts
// CLI-скрипт для исторического майнинга вопросов, претензий и замечаний из транскрипций

import { getTranscripts } from '../lib/your-db-module'; // TODO: заменить на реальный модуль
import { callOpenAI } from '../lib/your-openai-module'; // TODO: заменить на реальный модуль
import fs from 'fs';

// Лимиты для OpenAI
const BATCH_SIZE = 20; // максимум за раз
const MAX_TOTAL = 200; // максимум за запуск

async function main() {
  // 1. Получить последние 1000-3000 транскрипций
  const transcripts = (await getTranscripts({ limit: 2000 })).slice(0, MAX_TOTAL); // пример

  const results = [];
  let processed = 0;

  for (const t of transcripts) {
    if (processed >= MAX_TOTAL) break;
    try {
      // 2. Вызов OpenAI для извлечения вопросов, претензий, замечаний
      const aiResult = await callOpenAI({
        model: 'gpt-4o-mini',
        prompt: `Извлеки из текста вопросы, претензии и замечания клиентов. Верни JSON вида: {"questions":[], "claims":[], "remarks":[]}`,
        transcript: t.transcript,
      });
      results.push({ id: t.id, ...aiResult });
      processed++;
    } catch (e) {
      console.error('AI error for id', t.id, e);
    }
    if (processed % BATCH_SIZE === 0) {
      console.log(`Processed ${processed} / ${MAX_TOTAL}`);
    }
  }

  // 3. Сохранить результаты в JSON
  fs.writeFileSync('voc_historical_raw.json', JSON.stringify(results, null, 2));
  console.log('Done! Saved to voc_historical_raw.json');
}

main().catch(console.error);
