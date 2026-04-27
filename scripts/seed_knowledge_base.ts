// scripts/seed_knowledge_base.ts
// CLI-скрипт для сидирования эталонных вопросов/ответов в knowledge_base_qa

import fs from 'fs';
import { insertKnowledgeBaseEntry } from '../lib/your-db-module'; // TODO: заменить на реальный модуль

async function main() {
  // 1. Загрузка кластеризованных данных
  const clusters = JSON.parse(fs.readFileSync('top_customer_questions_clustered.json', 'utf-8'));

  for (const cluster of clusters) {
    try {
      // Пример структуры: cluster.intent_slug, cluster.category, cluster.examples, cluster.answer_website, cluster.answer_consultant, cluster.frequency_score, cluster.type, cluster.tags
      await insertKnowledgeBaseEntry({
        intent_slug: cluster.intent_slug,
        category: cluster.category,
        question_variants: cluster.examples,
        answer_website: cluster.answer_website,
        answer_consultant: cluster.answer_consultant,
        frequency_score: cluster.frequency_score,
        is_active: true,
        type: cluster.type,
        tags: cluster.tags || [],
      });
      console.log(`Seeded: ${cluster.intent_slug}`);
    } catch (e) {
      console.error('Seed error:', cluster.intent_slug, e);
    }
  }
  console.log('Seeding complete!');
}

main().catch(console.error);
