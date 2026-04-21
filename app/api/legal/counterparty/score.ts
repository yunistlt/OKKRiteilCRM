import { NextApiRequest, NextApiResponse } from 'next';
import { checkCounterpartyByInn } from '../../../lib/legal-counterparty-check';

// Логирование запроса (минимально)
async function logCounterpartyCheck(inn: string, userId: string | null) {
  // TODO: Запись в legal_audit_log (через Supabase SDK или pg)
  // await supabase.from('legal_audit_log').insert({ action: 'counterparty_check', entity: 'inn', entity_id: null, performed_by: userId, details: { inn } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { inn, userId } = req.body;
  if (!inn) {
    return res.status(400).json({ error: 'INN is required' });
  }
  await logCounterpartyCheck(inn, userId || null);
  const result = await checkCounterpartyByInn(inn);
  res.status(200).json(result);
}
