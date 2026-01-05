'use client';

import { useState } from 'react';
import { saveSettingsBatch } from './actions';

// We define this interface to match what's passed from the server page
export interface StatusItem {
    code: string;
    name: string;
    is_active?: boolean;
    is_working: boolean;
    is_transcribable: boolean;
    ordering: number;
    group_name: string;
}

interface StatusListProps {
    initialStatuses: StatusItem[];
    counts?: Record<string, number>;
}

export default function StatusList({ initialStatuses, counts = {} }: StatusListProps) {
    // ... (rest of state logic)

    const [statuses, setStatuses] = useState<StatusItem[]>(initialStatuses);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // NOTE: We track 'hasChanges' locally if we want to show visual cues, 
    // but the buttons remain active regardless.
    const [hasChanges, setHasChanges] = useState(false);

    // Local handler: updates UI state immediately for responsiveness
    function handleLocalToggle(code: string) {
        setHasChanges(true);
        setStatuses(prev => prev.map(s =>
            s.code === code ? { ...s, is_working: !s.is_working } : s
        ));
    }

    function handleTranscriptionToggle(code: string) {
        setHasChanges(true);
        setStatuses(prev => prev.map(s =>
            s.code === code ? { ...s, is_transcribable: !s.is_transcribable } : s
        ));
    }

    async function handleSave() {
        if (isSaving) return;
        setIsSaving(true);
        setSaveError(null);

        try {
            // Prepare payload
            const payload = statuses.map(s => ({
                code: s.code,
                is_working: s.is_working,
                is_transcribable: s.is_transcribable
            }));

            const result = await saveSettingsBatch(payload);

            if (!result.success) {
                throw new Error(result.error);
            }

            // On success, reset dirty state
            setHasChanges(false);

            // Redirect to home as requested workflow
            // Using window.location to ensure full refresh/navigation
            window.location.href = '/';

        } catch (err: any) {
            console.error('Save Failed:', err);
            setSaveError(`Не удалось сохранить: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    }

    const grouped: Record<string, StatusItem[]> = {};
    statuses.forEach(s => {
        if (s.is_active === false) return;
        const g = s.group_name || 'Без группы';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push(s);
    });

    const groupNames = Object.keys(grouped).sort();

    const styles = {
        container: {
            maxWidth: '1000px', margin: '0 auto', padding: '30px',
            fontFamily: 'system-ui, sans-serif', color: '#333', backgroundColor: '#fff', minHeight: '100vh',
        },
        header: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '1px solid #eee', paddingBottom: '20px'
        },
        saveButtonTop: {
            padding: '10px 20px',
            backgroundColor: '#0070f3', // Always blue/active
            color: '#fff',
            border: 'none', borderRadius: '6px',
            cursor: 'pointer', // Always pointer
            fontWeight: 600,
            transition: 'background 0.2s'
        },
        group: { marginBottom: '25px', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' },
        groupHeader: { backgroundColor: '#f8f9fa', padding: '12px 20px', fontWeight: 600, color: '#444', borderBottom: '1px solid #eee' },
        item: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', backgroundColor: '#fff' },
        itemActive: { backgroundColor: '#f0f9ff' },
        checkbox: { marginRight: '15px', width: '20px', height: '20px', cursor: 'pointer' },
        footer: { marginTop: '40px', display: 'flex', justifyContent: 'center', paddingBottom: '40px' },
        saveButton: {
            padding: '16px 48px',
            backgroundColor: '#0070f3',
            color: '#fff', border: 'none', borderRadius: '8px',
            fontSize: '18px', fontWeight: 600,
            cursor: isSaving ? 'wait' : 'pointer',
            boxShadow: '0 4px 14px rgba(0,118,255,0.39)',
            opacity: isSaving ? 0.7 : 1
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h1>Настройка статусов</h1>
                {/* Top Save Button - ALWAYS ACTIVE */}
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                        ...styles.saveButtonTop,
                        cursor: isSaving ? 'wait' : 'pointer'
                    }}
                >
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
            </div>

            {saveError && (
                <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                    {saveError}
                </div>
            )}

            <div>
                {groupNames.map(group => (
                    <div key={group} style={styles.group}>
                        <div style={styles.groupHeader}>{group}</div>
                        <div>
                            {grouped[group].map(status => (
                                <div key={status.code}
                                    style={{ ...styles.item, ...(status.is_working || status.is_transcribable ? styles.itemActive : {}) }}
                                >
                                    {/* 1. Working Toggle */}
                                    <div
                                        onClick={() => handleLocalToggle(status.code)}
                                        style={{ display: 'flex', alignItems: 'center', marginRight: '30px', minWidth: '120px' }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={status.is_working}
                                            readOnly
                                            style={styles.checkbox}
                                        />
                                        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: status.is_working ? '#0070f3' : '#999' }}>
                                            Анализ
                                        </span>
                                    </div>

                                    {/* 2. Transcription Toggle */}
                                    <div
                                        onClick={() => handleTranscriptionToggle(status.code)}
                                        style={{ display: 'flex', alignItems: 'center', marginRight: '40px', minWidth: '140px' }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={status.is_transcribable}
                                            readOnly
                                            style={styles.checkbox}
                                        />
                                        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: status.is_transcribable ? '#7c3aed' : '#999' }}>
                                            Транскрибация
                                        </span>
                                    </div>

                                    {/* 3. Status Info */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {status.name}
                                            {(counts[status.code] || 0) > 0 && (
                                                <span style={{
                                                    backgroundColor: '#e5e7eb',
                                                    color: '#374151',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '12px',
                                                    fontWeight: 600
                                                }}>
                                                    {counts[status.code]}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#888' }}>{status.code}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div style={styles.footer}>
                {/* Bottom Save Button - ALWAYS ACTIVE */}
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={styles.saveButton}
                >
                    {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
            </div>
        </div>
    );
}
