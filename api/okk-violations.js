// api/okk-violations.js
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('okk_violations')
      .select(
        'id, order_id, manager_id, violation_type, severity, detected_at, details'
      )
      .order('detected_at', { ascending: false })
      .limit(3000);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      violations: data || [],
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, error: String(err.message || err) });
  }
}
