import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { scanContractFile, updateContractScanStatus } from '@/lib/legal-antivirus';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'legal_contract_scan';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureAuthorized(req);
    // Найти все ревью со scan_status = 'pending' (ограничим 10 за раз)
    const { data: reviews, error } = await supabase
      .from('legal_contract_reviews')
      .select('id, storage_bucket, storage_path')
      .eq('scan_status', 'pending')
      .limit(10);
    if (error) throw error;
    if (!reviews || reviews.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0 });
    }
    let scanned = 0;
    for (const review of reviews) {
      const result = await scanContractFile(review.storage_bucket, review.storage_path);
      await updateContractScanStatus(review.id, result.status, result.details);
      scanned++;
    }
    return NextResponse.json({ ok: true, scanned });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
