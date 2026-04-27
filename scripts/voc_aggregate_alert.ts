// scripts/voc_aggregate_alert.ts
// Скрипт для агрегации новых вопросов и алерта в Telegram

import { getNewQuestions, sendTelegramAlert } from '../lib/your-alert-modules'; // TODO: заменить на реальные модули

async function main() {
  // 1. Собрать новые вопросы за неделю
  const newQuestions = await getNewQuestions({ period: 'week' });
  // 2. Кластеризация и подсчёт частотности (упрощённо)
  const clusters = {};
  for (const q of newQuestions) {
    const key = q.intent_slug || q.text;
    clusters[key] = clusters[key] || [];
    clusters[key].push(q);
  }
  // 3. Сформировать алерт
  const alertText = Object.entries(clusters)
    .map(([intent, arr]) => `➕ ${arr.length} новых вопросов про "${intent}"`)
    .join('\n');
  // 4. Отправить алерт в Telegram
  await sendTelegramAlert(alertText);
  console.log('Alert sent!');
}

main().catch(console.error);
