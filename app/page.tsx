"use client";
import React, { useEffect, useState } from 'react';

interface Violation {
    managerId: string;
    type: string;
    details: string;
    timestamp: string;
}

export default function Dashboard() {
    const [violations, setViolations] = useState<Violation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // In a real app, you'd fetch this from an API route that uses lib/analysis.ts
        // For now we simulate or assume client-side logic possible if RLS allows, 
        // but better to fetch from /api/analysis

        async function loadData() {
            try {
                const res = await fetch('/api/analysis');
                if (!res.ok) throw new Error('Failed to fetch analysis');
                const data = await res.json();
                setViolations(data.violations || []);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, []);

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <header style={{ marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                <h1 style={{ fontSize: '2rem', margin: 0 }}>OKK Dashboard</h1>
                <p style={{ color: '#666' }}>Quality Control & Monitoring</p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>

                {/* Stats Card */}
                <div style={{ padding: '1.5rem', borderRadius: '12px', background: '#f8f9fa', border: '1px solid #e9ecef' }}>
                    <h3>Total Violations (24h)</h3>
                    <p style={{ fontSize: '3rem', fontWeight: 'bold', color: '#dc3545', margin: '0' }}>{violations.length}</p>
                </div>

                {/* Sync Status Card */}
                <div style={{ padding: '1.5rem', borderRadius: '12px', background: '#f8f9fa', border: '1px solid #e9ecef' }}>
                    <h3>System Status</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28a745' }}></span>
                        <span>RetailCRM Connected</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28a745' }}></span>
                        <span>Telphin Connected</span>
                    </div>
                </div>

            </div>

            <h2 style={{ marginTop: '3rem' }}>Violation Feed</h2>
            {loading ? (
                <p>Loading analysis...</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
                            <th style={{ padding: '1rem' }}>Type</th>
                            <th style={{ padding: '1rem' }}>Manager</th>
                            <th style={{ padding: '1rem' }}>Details</th>
                            <th style={{ padding: '1rem' }}>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {violations.map((v, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '1rem' }}>
                                    <span style={{
                                        background: v.type === 'MISSED_CALL' ? '#ffebe9' : '#fff8c5',
                                        color: v.type === 'MISSED_CALL' ? '#cf222e' : '#9a6700',
                                        padding: '4px 8px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: '500'
                                    }}>
                                        {v.type.replace(/_/g, ' ')}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem' }}>{v.managerId}</td>
                                <td style={{ padding: '1rem' }}>{v.details}</td>
                                <td style={{ padding: '1rem', color: '#666' }}>{new Date(v.timestamp).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
