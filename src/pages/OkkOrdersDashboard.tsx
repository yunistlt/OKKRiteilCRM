// /src/pages/OkkOrdersDashboard.tsx
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

type OkkOrder = {
  id: string
  retailcrm_order_id: number
  number: string
  current_status: string
  created_at_crm: string
  status_updated_at_crm: string
  summ: number | null
  manager_id: string | null
  manager_retailcrm_id: number | null
  paid: boolean | null
}

type ControlledStatus = {
  status: string
}

function calcAgeInStatusHours(statusUpdatedAt: string): number {
  const updated = new Date(statusUpdatedAt).getTime()
  const now = Date.now()
  const diffMs = now - updated
  return Math.floor(diffMs / (1000 * 60 * 60))
}

export default function OkkOrdersDashboard() {
  const [orders, setOrders] = useState<OkkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1. Берём рабочие статусы
        const { data: statuses, error: statusesError } = await supabase
          .from<ControlledStatus>('okk_sla_status')
          .select('status')
          .eq('is_controlled', true)

        if (statusesError) {
          throw statusesError
        }

        const statusList = (statuses || []).map((s) => s.status)

        if (statusList.length === 0) {
          setOrders([])
          return
        }

        // 2. Тянем заказы в этих статусах
        const { data: ordersData, error: ordersError } = await supabase
          .from<OkkOrder>('okk_orders')
          .select(
            'id, retailcrm_order_id, number, current_status, created_at_crm, status_updated_at_crm, summ, manager_id, manager_retailcrm_id, paid'
          )
          .in('current_status', statusList)
          .order('status_updated_at_crm', { ascending: true })
          .limit(500)

        if (ordersError) {
          throw ordersError
        }

        setOrders(ordersData || [])
      } catch (e: any) {
        console.error(e)
        setError(e.message || 'Ошибка загрузки данных')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  if (loading) {
    return <div style={{ padding: 24 }}>Загружаю заказы…</div>
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: 'red' }}>
        Ошибка загрузки: {error}
      </div>
    )
  }

  if (orders.length === 0) {
    return <div style={{ padding: 24 }}>В рабочих статусах сейчас нет заказов.</div>
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 16 }}>Рабочая воронка ОКК</h1>
      <p style={{ marginBottom: 16, color: '#555' }}>
        Показаны заказы в 12 рабочих статусах. Отсортировано по времени последнего изменения статуса.
      </p>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 14,
        }}
      >
        <thead>
          <tr>
            <th style={th}>№</th>
            <th style={th}>Статус</th>
            <th style={th}>Сумма</th>
            <th style={th}>Оплачен</th>
            <th style={th}>Менеджер (CRM)</th>
            <th style={th}>Создан в CRM</th>
            <th style={th}>В статусе, часов</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const ageHours = calcAgeInStatusHours(o.status_updated_at_crm)
            return (
              <tr key={o.id}>
                <td style={td}>{o.number}</td>
                <td style={td}>{o.current_status}</td>
                <td style={td}>{o.summ ?? '—'}</td>
                <td style={td}>{o.paid ? 'Да' : 'Нет'}</td>
                <td style={td}>{o.manager_retailcrm_id ?? '—'}</td>
                <td style={td}>{new Date(o.created_at_crm).toLocaleString()}</td>
                <td style={td}>{ageHours}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #ddd',
  padding: '8px 6px',
  background: '#f5f7fb',
  fontWeight: 600,
}

const td: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: '6px 6px',
}
