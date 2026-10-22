/**
 * Реестр колонок и полей фильтра — с повтором запроса.
 *
 * Зачем: выбор человека хранит ключи полей карточки заказа (`cf.<код>`), а
 * проверяются они по реестру. Если реестр не доехал (22.10.2026 из-за простоя
 * прокси), сохранённые поля считались «неизвестными» и молча исчезали из
 * панели — у Ирины пропал фильтр «Город доставки (менеджерам ОП)»
 * (доработка №38). Поэтому: три попытки, и если реестр так и не пришёл,
 * ЛУЧШЕ НЕ ТРОГАТЬ выбор, чем урезать его.
 */
export type RegistryKind = 'columns' | 'filters';

export async function fetchViewRegistry<T>(kind: RegistryKind): Promise<T[] | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const res = await fetch('/api/orders/view-fields');
            if (res.ok) {
                const data = await res.json();
                const list = data?.[kind];
                if (Array.isArray(list) && list.length) return list as T[];
            }
        } catch {
            // Связь моргнула — попробуем ещё раз.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    return null;
}
