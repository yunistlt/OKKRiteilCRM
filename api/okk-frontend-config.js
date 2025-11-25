// /api/okk-frontend-config.js
export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({
      success: false,
      error: "Supabase config is not set on server (SUPABASE_URL / SUPABASE_ANON_KEY)",
    });
    return;
  }

  res.status(200).json({
    success: true,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
}
