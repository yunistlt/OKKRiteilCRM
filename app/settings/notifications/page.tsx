'use client';

import React, { useEffect, useMemo, useState } from 'react';

// Уведомления: куда уходит каждый тип сообщения.
//
// Раньше адресат был зашит в место отправки, и правка маршрута оплат уводила
// заодно чужие сообщения (28.09.2026 оплаты уехали из общего чата в личку).
// Здесь адресат — свойство типа сообщения, и меняется он по одному типу.

type Route = {
  code: string;
  name: string;
  description: string;
  group: string;
  bot: string;
  target: string;
  targetFixed: boolean;
  chatId: string | null;
  threadId: string | null;
  enabled: boolean;
};

const TARGETS: Record<string, string> = {
  group_sales: 'Общий чат отдела продаж',
  owner_dm: 'Владельцу в личку',
  manager_dm: 'Менеджеру в личку',
  accounting: 'Бухгалтерия',
  project_stolyarka: 'Чат проекта «Столярка»',
  project_consulting: 'Чат проекта «ПО/Консалтинг»',
};

const GROUPS: Record<string, string> = {
  payments: 'Оплаты',
  sales: 'Продажи',
  quality: 'Качество и регламенты',
  system: 'Система',
  salary: 'Зарплата',
};

const GROUP_ORDER = ['payments', 'sales', 'quality', 'system', 'salary'];

export default function NotificationsSettingsPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/notifications');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Не удалось загрузить');
      setRoutes(json.routes ?? []);
      setError('');
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (route: Route, patch: Partial<Route>) => {
    const next = { ...route, ...patch };
    setRoutes((rs) => rs.map((r) => (r.code === route.code ? next : r)));
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: next.code,
          target: next.target,
          chatId: next.chatId,
          threadId: next.threadId,
          enabled: next.enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Не удалось сохранить');
      setSaved(next.name);
      setTimeout(() => setSaved(''), 2000);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      load();
    }
  };

  const byGroup = useMemo(() => {
    const map = new Map<string, Route[]>();
    for (const r of routes) map.set(r.group, [...(map.get(r.group) ?? []), r]);
    return map;
  }, [routes]);

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <div style={{ fontSize: 13, color: '#777', margin: '0 0 16px' }}>
        Каждый тип сообщения уходит своему адресату. Меняется по одному типу — остальные
        сообщения при этом не переезжают.
      </div>

      {error && (
        <div style={{ background: '#fdecea', color: '#a00', padding: '8px 10px', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ background: '#edf7ed', color: '#256029', padding: '8px 10px', fontSize: 13, marginBottom: 12 }}>
          Сохранено: {saved}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#666', fontSize: 13 }}>Загружаем…</div>
      ) : (
        GROUP_ORDER.filter((g) => (byGroup.get(g) ?? []).length > 0).map((group) => (
          <section key={group} style={{ marginBottom: 20 }}>
            <h2
              style={{
                fontSize: 13,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                background: '#111',
                color: '#fff',
                padding: '5px 10px',
                margin: '0 0 1px',
              }}
            >
              {GROUPS[group] ?? group}
            </h2>

            {(byGroup.get(group) ?? []).map((r) => (
              <div
                key={r.code}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(240px, 2fr) minmax(200px, 1fr) minmax(150px, 1fr) 100px',
                  gap: 12,
                  borderBottom: '1px solid #e5e5e5',
                  padding: '8px 10px',
                  alignItems: 'start',
                  opacity: r.enabled ? 1 : 0.55,
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{r.description}</div>
                </div>

                <div>
                  {r.targetFixed ? (
                    <div style={{ fontSize: 13, padding: '6px 0' }}>
                      {TARGETS[r.target] ?? r.target}
                      <div style={{ fontSize: 11, color: '#999' }}>адресат не меняется</div>
                    </div>
                  ) : (
                    <select
                      value={r.target}
                      onChange={(e) => save(r, { target: e.target.value })}
                      style={{
                        width: '100%',
                        fontSize: 13,
                        padding: '5px 6px',
                        border: '1px solid #ccc',
                        borderRadius: 0,
                        background: '#fff',
                      }}
                    >
                      {Object.entries(TARGETS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <input
                    value={r.chatId ?? ''}
                    placeholder="свой чат (необязательно)"
                    onChange={(e) =>
                      setRoutes((rs) =>
                        rs.map((x) => (x.code === r.code ? { ...x, chatId: e.target.value || null } : x)),
                      )
                    }
                    onBlur={(e) => save(r, { chatId: e.target.value || null })}
                    style={{
                      width: '100%',
                      fontSize: 13,
                      padding: '5px 6px',
                      border: '1px solid #ccc',
                      borderRadius: 0,
                    }}
                  />
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    Пусто — адрес берётся по роли адресата
                  </div>
                </div>

                <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', paddingTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => save(r, { enabled: e.target.checked })}
                  />
                  Шлём
                </label>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
