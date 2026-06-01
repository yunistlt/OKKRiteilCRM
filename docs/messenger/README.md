# Корпоративный мессенджер

**Статус:** 🟡 92% готов к production (финализация)

## Описание

Внутренний мессенджер для коммуникации между менеджерами, поддержкой и аналитиками:

### Возможности
- **Direct чаты:** 1:1 переписка между пользователями
- **Group чаты:** Групповые обсуждения по проектам/отделам
- **Вложения:** Загрузка файлов с защищённым доступом
- **Real-time обновления:** Supabase Realtime для instant messaging
- **Push-уведомления:** Desktop и mobile notifications (PWA + Web Push)
- **Аватары:** User и group avatars с signed URL delivery
- **Непрочитанные:** Badge tracking и mark-as-read логика

### Архитектура доступа
- Читать/писать могут только участники чата
- Admin группы управляют добавлением/удалением участников
- Removed members теряют доступ к истории и вложениям
- Все проверки доступа выполняются явно на сервере (RLS + API validation)

## Готовность к релизу

| Компонент | Статус |
|-----------|--------|
| Безопасность API | ✅ Закрыто |
| Инфраструктура (RPC, bucket, realtime) | ✅ Закрыто |
| Direct чаты | ✅ Закрыто |
| Group чаты | ✅ Закрыто |
| Вложения | ✅ Закрыто |
| Push-уведомления (PWA + Web Push) | ✅ Закрыто |
| UX улучшения | ✅ Закрыто |
| Automated smoke tests | ✅ Закрыто |
| Manual smoke-check на production | 🟡 TODO |

## Чеклист перед релизом

- [ ] Automated smoke прошёл на deployed environment
- [ ] Manual smoke из production checklist закрыт
- [ ] Desktop push работает в фоне и открывает нужный чат
- [ ] Mobile push на Android и iPhone функционируют
- [ ] Все критичные сценарии пройдены в production-среде

## Документация

- [READINESS_PLAN.md](READINESS_PLAN.md) — полный план готовности с 6 этапами
- [ACCESS_MODEL.md](ACCESS_MODEL.md) — модель доступа и security rules
- [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) — практический runbook финального прогона
- [SMOKE_CHECK.md](SMOKE_CHECK.md) — production smoke-check чеклист

## Контакты

- **Владелец:** Team Messenger
- **Slack:** #messenger-development
