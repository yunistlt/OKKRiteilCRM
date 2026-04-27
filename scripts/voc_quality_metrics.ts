// Пример метрик качества извлечения для VoC
// scripts/voc_quality_metrics.ts

import { getExtractedQuestions, getGroundTruth } from '../lib/your-metrics-modules'; // TODO: заменить на реальные модули

async function main() {
  const extracted = await getExtractedQuestions({ period: 'week' });
  const groundTruth = await getGroundTruth({ period: 'week' });

  // Precision, Recall, F1
  const tp = extracted.filter(q => groundTruth.includes(q)).length;
  const fp = extracted.length - tp;
  const fn = groundTruth.length - tp;
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  const f1 = 2 * precision * recall / (precision + recall);

  console.log(`Precision: ${precision.toFixed(2)}`);
  console.log(`Recall: ${recall.toFixed(2)}`);
  console.log(`F1: ${f1.toFixed(2)}`);
}

main().catch(console.error);
