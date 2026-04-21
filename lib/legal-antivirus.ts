// Модуль антивирусной проверки для contract review
// TODO: заменить mock на реальную интеграцию (например, ClamAV)
import { supabase } from '@/utils/supabase';

export type AntivirusScanResult = {
  status: 'clean' | 'infected' | 'error';
  details?: string;
};

// MOCK: всегда возвращает clean, но если имя файла содержит "virus" — infected
export async function scanContractFile(storageBucket: string, storagePath: string): Promise<AntivirusScanResult> {
  if (storagePath.toLowerCase().includes('virus')) {
    return { status: 'infected', details: 'Обнаружен тестовый вирус по имени файла.' };
  }
  // Здесь будет реальная интеграция с ClamAV или другим движком
  return { status: 'clean' };
}

// Обновляет статус scan_status и error в legal_contract_reviews
export async function updateContractScanStatus(reviewId: number, scanStatus: 'clean' | 'infected' | 'error', error?: string) {
  await supabase.from('legal_contract_reviews')
    .update({ scan_status: scanStatus, analysis_error: error || null, updated_at: new Date().toISOString() })
    .eq('id', reviewId);
}
