/**
 * Оповещения отдельной страницей — раздел рядом с письмами и звонками
 * (решение владельца 05.10.2026). Колокольчик остаётся для быстрого взгляда,
 * а сюда заходят разобрать накопившееся.
 */
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

export default function NotificationsPage() {
    return <NotificationsClient />;
}
