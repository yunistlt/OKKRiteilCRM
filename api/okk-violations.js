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
  try {
    const { violation_code, manager_id } = req.query;

    let query = supabase
      .from('okk_violations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (violation_code) {
      query = query.eq('violation_code', violation_code);
    }

    if (manager_id) {
      query = query.eq('manager_id', manager_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('OKK VIOLATIONS API ERROR:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({
      ok: true,
      violations: data || [],
    });
  } catch (e) {
    console.error('OKK VIOLATIONS API ERROR:', e);
    return res.status(500).json({ ok: false, error: e.toString() });
  }
}
