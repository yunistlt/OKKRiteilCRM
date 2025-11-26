// api/okk-sync-managers.js
import { createClient } from '@supabase/supabase-js';

const {
  RETAILCRM_API_KEY,
  RETAILCRM_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!RETAILCRM_API_KEY || !RETAILCRM_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[okk-sync-managers] Missing required env vars');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  try {
    // 1. Тянем всех пользователей из RetailCRM (их немного)
    const LIMIT = 100;
    let page = 1;
    let totalPages = 1;
    const allUsers = [];

    do {
      const url =
        `${RETAILCRM_BASE_URL}/api/v5/users` +
        `?apiKey=${encodeURIComponent(RETAILCRM_API_KEY)}` +
        `&limit=${LIMIT}` +
        `&page=${page}`;

      console.log('[okk-sync-managers] Fetch page', page, 'url:', url);

      const resp = await fetch(url);
      const json = await resp.json();

      if (!json.success) {
        console.error('[okk-sync-managers] RetailCRM users error:', json);
        res
          .status(502)
          .json({ error: 'RetailCRM users error', details: json.errorMsg || json });
        return;
      }

      const users = json.users || [];
      totalPages = json.pagination?.totalPageCount || 1;
      allUsers.push(...users);

      page += 1;
    } while (page <= totalPages);

    console.log('[okk-sync-managers] Total users from RetailCRM:', allUsers.length);

    if (!allUsers.length) {
      res.status(200).json({
        success: true,
        message: 'No users received from RetailCRM',
        totalRetailUsers: 0,
      });
      return;
    }

    // 2. Готовим payload для okk_users
    const payload = allUsers.map((u) => {
      const fio =
        [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ') || null;

      return {
        // ключ из RetailCRM
        retailcrm_user_id: u.id,
        // человекочитаемое имя
        name: fio || u.fio || u.login || null,
        email: u.email || null,
        is_active: u.isDeleted ? false : true,
        role: u.role || u.groupName || null,
        raw: u,
      };
    });

    // 3. upsert в okk_users по retailcrm_user_id
    const { error: upsertError } = await supabase
      .from('okk_users')
      .upsert(payload, { onConflict: 'retailcrm_user_id' });

    if (upsertError) {
      console.error('[okk-sync-managers] Supabase upsert okk_users error:', upsertError);
      res.status(500).json({
        error: 'Supabase upsert okk_users error',
        details: upsertError.message,
      });
      return;
    }

    // 4. Обновляем okk_sync_state для типа "managers"
    const { error: syncStateError } = await supabase.from('okk_sync_state').upsert(
      {
        sync_type: 'managers',
        last_page: 1,
        is_completed: true,
      },
      { onConflict: 'sync_type' }
    );

    if (syncStateError) {
      console.error('[okk-sync-managers] Supabase upsert okk_sync_state error:', syncStateError);
      // это не критично для самих данных, поэтому не роняю ответ
    }

    res.status(200).json({
      success: true,
      message: 'Managers sync completed',
      totalRetailUsers: allUsers.length,
      upserted: payload.length,
    });
  } catch (err) {
    console.error('[okk-sync-managers] Fatal error:', err);
    res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}
