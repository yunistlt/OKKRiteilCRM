// scripts/voc_clusterizer.ts
// CLI-скрипт для кластеризации вопросов, претензий и замечаний

import fs from 'fs';
import { callOpenAI } from '../lib/your-openai-module'; // TODO: заменить на реальный модуль

// Лимиты для OpenAI
const BATCH_SIZE = 20; // максимум за раз
const MAX_TOTAL = 200; // максимум за запуск

async function main() {
  // 1. Загрузка сырых данных
  const raw = JSON.parse(fs.readFileSync('voc_historical_raw.json', 'utf-8'));
  const allItems = [];

  // 2. Собрать все вопросы, претензии, замечания в один массив с типом
  for (const entry of raw) {
    (entry.questions || []).forEach(q => allItems.push({ type: 'question', text: q }));
    (entry.claims || []).forEach(q => allItems.push({ type: 'claim', text: q }));
    (entry.remarks || []).forEach(q => allItems.push({ type: 'remark', text: q }));
  }

  // 3. Кластеризация через OpenAI (батчами, с лимитом)
  const clusters = [];
  for (let i = 0; i < Math.min(allItems.length, MAX_TOTAL); i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    const prompt = `Сгруппируй по смыслу следующие фразы клиентов (укажи тип, кластер, частотность, примеры):\n${batch.map(i => `[${i.type}] ${i.text}`).join('\n')}`;
    const aiResult = await callOpenAI({
      model: 'gpt-4o',
      prompt: prompt
    });
    clusters.push(aiResult);
    console.log(`Clustered ${i + batch.length} / ${Math.min(allItems.length, MAX_TOTAL)}`);
  }

  // 4. Сохранить результат
  fs.writeFileSync('top_customer_questions_clustered.json', JSON.stringify(clusters, null, 2));
  console.log('Done! Saved to top_customer_questions_clustered.json');
}

main().catch(console.error);
