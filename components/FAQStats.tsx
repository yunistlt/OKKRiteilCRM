import React, { useEffect, useState } from 'react';

interface Stat {
  type: string;
  count: number;
}

interface StatsResponse {
  stats: Stat[];
  total: number;
}

export const FAQStats: React.FC = () => {
  const [stats, setStats] = useState<Stat[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/faq/stats')
      .then((res) => res.json())
      .then((data: StatsResponse) => {
        setStats(data.stats);
        setTotal(Number(data.total));
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Загрузка статистики...</div>;

  return (
    <div style={{ maxWidth: 400, margin: '24px 0', padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
      <h3>Статистика базы знаний</h3>
      <div>Всего записей: <b>{total}</b></div>
      <ul>
        {stats.map((s) => (
          <li key={s.type}>
            <b>{s.type}</b>: {s.count}
          </li>
        ))}
      </ul>
    </div>
  );
};
