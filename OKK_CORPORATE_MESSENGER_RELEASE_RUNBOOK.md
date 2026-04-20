# Корпоративный мессенджер: release runbook

Статус: практический runbook для финального прогона messenger перед закрытием release-checklist.

## 1. Что уже закрыто кодом

- Серверные проверки доступа на messages и attachments выполняются явно.
- Storage, realtime, push subscriptions и push runtime описаны миграциями в репозитории.
- Базовый messenger smoke automation уже существует в `npm run messenger:api-smoke`.
- Скрипт умеет проверять read-path, validation path, forbidden path, create/delete probe message.
- Скрипт умеет авторизоваться либо через bearer token, либо через обычный `/api/auth/login` и session cookies.
- При наличии расширенных env скрипт дополнительно умеет прогонять two-user direct flow, unread reset, attachment upload/download и group lifecycle.

## 2. Что ещё нельзя закрыть локально без deployed environment

- Реальную доставку desktop push в фоне.
- Реальную доставку mobile push на Android и iPhone.
- Ограничения iPhone/iPad, Android Chrome и desktop-браузеров в production.
- Поведение после реального deploy в GitHub -> Vercel -> Supabase цепочке.
- Фактическую observability-проверку по Vercel logs и delivery logs production-проекта.

## 3. Минимальные переменные для smoke

Смотри шаблон [scripts/messenger_api_smoke.env.example](scripts/messenger_api_smoke.env.example).

Обязательный минимум:

- `MESSENGER_BASE_URL`
- либо `MESSENGER_BEARER_TOKEN`
- либо `MESSENGER_LOGIN` + `MESSENGER_PASSWORD`
- `MESSENGER_CHAT_ID`
- `MESSENGER_FORBIDDEN_CHAT_ID`

Расширенный прогон для двухпользовательских сценариев:

- либо `MESSENGER_SECOND_BEARER_TOKEN`
- либо `MESSENGER_SECOND_LOGIN` + `MESSENGER_SECOND_PASSWORD`
- `MESSENGER_DIRECT_PARTICIPANT_ID`
- `MESSENGER_GROUP_PARTICIPANT_IDS`
- `MESSENGER_GROUP_EXTRA_PARTICIPANT_ID`

## 4. Рекомендуемый порядок финального прогона

1. Применить все messenger-миграции к целевому Supabase-проекту.
2. Убедиться, что в Vercel выставлены VAPID и Supabase env.
3. Запушить актуальную ветку в GitHub.
4. Дождаться deploy в Vercel именно того commit, который содержит messenger-изменения.
5. Подготовить либо bearer токены, либо username/password двух реальных пользователей, а также один chat id, где разрешён безопасный probe-run.
6. Заполнить env по шаблону.
7. Запустить `npm run messenger:api-smoke` на deployed URL.
8. После скрипта пройти manual browser/device smoke по [OKK_CORPORATE_MESSENGER_SMOKE_CHECK.md](OKK_CORPORATE_MESSENGER_SMOKE_CHECK.md).

## 5. Команда запуска

```bash
set -a
source scripts/messenger_api_smoke.env.example
set +a
npm run messenger:api-smoke
```

На практике лучше использовать отдельный локальный env-файл с реальными значениями, например:

```bash
cp scripts/messenger_api_smoke.env.example /tmp/messenger-smoke.env
$EDITOR /tmp/messenger-smoke.env
set -a
source /tmp/messenger-smoke.env
set +a
npm run messenger:api-smoke
```

## 6. Что считать успешным automated smoke

- Скрипт заканчивается без ошибки.
- В логах нет unexpected 401/403/500 кроме явно ожидаемых negative-path проверок.
- Двухпользовательский direct flow проходит с unread reset у второго пользователя.
- Attachment upload/download проходит через защищённый endpoint.
- Group rename, add/remove, delete и leave/promote flow проходят без ручных костылей.

## 7. Что считать успешным manual smoke

- Desktop push приходит в фоне и открывает нужный чат по click action.
- Mobile push приходит на Android и iPhone и ведёт в нужный чат.
- При открытом активном чате push suppression работает.
- Delivery audit пишет ожидаемые статусы в `messenger_push_delivery_logs`.
- Self-heal срабатывает после relogin и после очистки локальной browser subscription.
- Интерфейс остаётся корректным на mobile width и desktop width.

## 8. Когда план можно считать закрытым

- Automated smoke прошёл на deployed environment.
- Manual smoke из production checklist закрыт без критичных регрессий.
- Остались только явно зафиксированные accepted risks, либо их нет.
- После этого обновляется [OKK_CORPORATE_MESSENGER_READINESS_PLAN.md](OKK_CORPORATE_MESSENGER_READINESS_PLAN.md) и финальные пункты плана отмечаются как закрытые.