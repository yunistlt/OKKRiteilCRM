// lib/knowledge-base.ts
// Вспомогательная функция для получения топ-FAQ
import { supabase } from '@/utils/supabase';

export async function getTopFaq({ limit = 20 }: { limit?: number }) {
  const { data, error } = await supabase
    .from('knowledge_base_qa')
    .select('intent_slug, category, question_variants, answer_website, frequency_score, type, tags')
    .eq('is_active', true)
    .order('frequency_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
