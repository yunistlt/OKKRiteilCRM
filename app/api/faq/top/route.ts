// app/api/faq/top/route.ts
import { NextResponse } from 'next/server';
import { getTopFaq } from '@/lib/knowledge-base';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Получить топ-20 активных вопросов, отсортированных по частотности
  const faqs = await getTopFaq({ limit: 20 });
  return NextResponse.json(faqs);
}
