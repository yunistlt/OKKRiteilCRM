import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Диагностика: показывает, какие переменные транскрибации реально видит прод-функция.
// Значения НЕ раскрываются полностью (только факт наличия + короткий префикс URL).
export async function GET() {
  const sttUrl = process.env.STT_URL;
  return NextResponse.json({
    stt_url_set: !!sttUrl,
    stt_url_prefix: sttUrl ? sttUrl.slice(0, 18) : null,
    stt_token_set: !!process.env.STT_TOKEN,
    openai_set: !!process.env.OPENAI_API_KEY,
    mode: sttUrl ? 'self_hosted_stt' : 'openai_fallback',
  });
}
