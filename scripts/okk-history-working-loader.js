// public/scripts/okk-history-working-loader.js

const BATCH_SIZE = 30;
const INTERVAL_MS = 2 * 60 * 1000; // каждые 2 минуты

/**
 * Получаем все рабочие заказы из Supabase через наш API:
 * /api/retailcrm-working-count  — уже существует, возвращает список ID
 */
async function getWorkingOrders() {
  try {
    const resp = await fetch('/api/retailcrm-working-count');
    if (!resp.ok) return [];

    const json = await resp.json();

    // json.orders = [{ retailcrm_order_id: 50162 }, ...]
    return json.orders?.map(o => o.retailcrm_order_id).filter(Boolean) || [];
  } catch (e) {
    console.error('[working-loader] Ошибка получения рабочих заказов', e);
    return [];
  }
}

/** Режем массив на пачки */
function chunk(list, size) {
  const result = [];
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size));
  }
  return result;
}

/** Дергаем API синка истории по пачке */
async function syncBatch(batch) {
  try {
    const url = `/api/okk-sync-order-history-working?orderIds=${batch.join(',')}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      console.error('[working-loader] Ошибка синка пачки', batch);
      return;
    }

    await resp.json();
  } catch (e) {
    console.error('[working-loader] Сбой при синке пачки', e);
  }
}

/** Основной процесс */
async function runWorkingHistorySync() {
  console.log('[working-loader] Запуск...');

  const ids = await getWorkingOrders();
  if (!ids.length) {
    console.log('[working-loader] Нет рабочих заказов');
    return;
  }

  const batches = chunk(ids, BATCH_SIZE);

  for (const batch of batches) {
    console.log(`[working-loader] Синк пачки (${batch.length})`, batch);
    await syncBatch(batch);

    // Пауза, чтобы не словить лимиты RetailCRM
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('[working-loader] Готово.');
}

/** Авто-запуск каждые 2 минуты */
setInterval(runWorkingHistorySync, INTERVAL_MS);

/** И один запуск сразу */
runWorkingHistorySync();
