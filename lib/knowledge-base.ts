// lib/knowledge-base.ts
// Вспомогательная функция для получения топ-FAQ
import { sql } from '@vercel/postgres'; // или ваш клиент

export async function getTopFaq({ limit = 20 }: { limit?: number }) {
  const { rows } = await sql`
    select intent_slug, category, question_variants, answer_website, frequency_score, type, tags
    from knowledge_base_qa
    where is_active = true
    order by frequency_score desc
    limit ${limit}
  `;
  return rows;
}
