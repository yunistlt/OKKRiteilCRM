import { NextResponse } from 'next/server';
import { checkCounterpartyByInn } from '@/lib/legal-counterparty-check';

async function logCounterpartyCheck(inn: string, userId: string | null) {
  void inn;
  void userId;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const inn = body?.inn;
    const userId = body?.userId || null;

    if (!inn) {
      return NextResponse.json({ error: 'INN is required' }, { status: 400 });
    }

    await logCounterpartyCheck(inn, userId);
    const result = await checkCounterpartyByInn(inn);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to check counterparty' }, { status: 500 });
  }
}