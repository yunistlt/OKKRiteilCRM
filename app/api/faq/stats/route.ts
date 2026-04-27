import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
  // Получить статистику по вопросам, претензиям, замечаниям
  const { rows } = await sql`
    select type, count(*) as count
    from knowledge_base_qa
    group by type
  `;
  // Общий счётчик
  const { rows: totalRows } = await sql`
    select count(*) as total from knowledge_base_qa
  `;
  return NextResponse.json({
    stats: rows,
    total: totalRows[0]?.total || 0,
  });
}
