import { supabase } from '@/utils/supabase';

const ORDER_METHODS: Record<string, string> = {
    'shopping-cart': 'Через корзину',
    'app': 'На электронную почту',
    'carrotquest': 'CarrotQuest',
    'phone': 'По телефону',
    'live-chat': 'Онлайн-консультант (EnvyBox)',
    'vkontakte': 'ВКонтакте',
    'instagram': 'Instagram',
    'whatsapp': 'WhatsApp',
    'avito': 'Авито',
    'one-click': 'В один клик',
    'marquiz': 'MarQuiz',
    'price-decrease-request': 'Запрос каталога с сайта',
    'wantresult': 'Wantresult',
    'reanimatsiia-vozvrat-bazy': 'Реанимация / возврат базы',
    'postojany': 'Постоянный клиент',
    'baza': 'Наша база',
    'obzvon': 'Холод обзвон',
    'missed-call': 'Заказ обратного звонка',
    'pulstsen': 'ПульсЦен',
    'call-center': 'Колл-центр',
    'diler': 'Дилер',
    'avtoobzvon': 'Автообзвон',
    'sposob-oformleniia-kh-z': 'Способ оформления ХЗ',
};

const PRODUCT_CATEGORIES: Record<string, string> = {
    'mufelnye-pechi': 'Муфельные печи',
    'sush_shso': 'Сушильные шкафы',
    'sush_shs': 'Сушильные шкафы (ШС)',
    'sh_pe': 'Шкафы пекарские',
    'pechi-dlya-piccy': 'Печи для пиццы',
    'oborudovanie-dlya-obshchepita': 'Оборудование для общепита',
};

const CLIENT_CATEGORIES: Record<string, string> = {
    'trebuetsya-utochnit': 'Требуется уточнить',
    'vtorichnyi-klient': 'Вторичный клиент',
    'novyi-klient': 'Новый клиент',
    'partnerskii': 'Партнерский',
    'goszakupki': 'Госзакупки',
    'yang_scool': 'Янг Скул (Юр.лицо)',
};

export async function resolveRetailCRMLabel(
    field: 'orderMethod' | 'productCategory' | 'clientCategory' | 'status' | 'top3Price' | 'top3Timing' | 'top3Specs',
    code: string | null
): Promise<string> {
    if (!code) return 'Не указано';

    // 1. Try DB first (most accurate for dynamic labels)
    try {
        let entityType = '';
        let dictCode: string | null = null;

        if (field === 'orderMethod') entityType = 'orderMethod';
        else if (field === 'status') entityType = 'status';
        else if (field === 'productCategory') {
            entityType = 'customField';
            dictCode = 'kategoriya_klienta';
        } else if (field === 'clientCategory') {
            entityType = 'customField';
            dictCode = 'sfera_deiatelnosti';
        } else if (field.startsWith('top3')) {
            entityType = 'customField';
            dictCode = 'da_net';
        }

        const query = supabase
            .from('retailcrm_dictionaries')
            .select('item_name')
            .eq('entity_type', entityType)
            .eq('item_code', code);

        if (dictCode) {
            query.eq('dictionary_code', dictCode);
        }

        const { data } = await query.maybeSingle();
        if (data?.item_name) return data.item_name;

        // Dual-dictionary check for clientCategory
        if (field === 'clientCategory') {
            const { data: data2 } = await supabase
                .from('retailcrm_dictionaries')
                .select('item_name')
                .eq('entity_type', 'customField')
                .eq('dictionary_code', 'type_customer')
                .eq('item_code', code)
                .maybeSingle();
            if (data2?.item_name) return data2.item_name;
        }
    } catch (e) {
        // Probably table missing, proceed to static fallback
    }

    // 2. Try Static Mapping Fallback
    let mapping: Record<string, string> = {};
    switch (field) {
        case 'orderMethod': mapping = ORDER_METHODS; break;
        case 'productCategory': mapping = PRODUCT_CATEGORIES; break;
        case 'clientCategory': mapping = CLIENT_CATEGORIES; break;
    }

    if (mapping[code]) return mapping[code];

    // 3. Humanizer fallback
    return code
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
