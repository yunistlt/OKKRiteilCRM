
import React, { useState, useEffect } from 'react';

export interface ChecklistItem {
    description: string;
    weight: number;
}

export interface ChecklistSection {
    section: string;
    items: ChecklistItem[];
}

interface ChecklistEditorProps {
    checklist: ChecklistSection[];
    onChange: (checklist: ChecklistSection[]) => void;
}

export default function ChecklistEditor({ checklist, onChange }: ChecklistEditorProps) {
    const [sections, setSections] = useState<ChecklistSection[]>(checklist || []);

    const totalWeight = sections.reduce((sum, section) =>
        sum + (section.items ? section.items.reduce((s, item) => s + (item.weight || 0), 0) : 0), 0);

    const updateSections = (newSections: ChecklistSection[]) => {
        setSections(newSections);
        onChange(newSections);
    };

    const addSection = () => {
        updateSections([...sections, { section: '', items: [] }]);
    };

    const updateSectionName = (index: number, name: string) => {
        const newSections = [...sections];
        newSections[index].section = name;
        updateSections(newSections);
    };

    const deleteSection = (index: number) => {
        if (confirm('Удалить раздел и все его пункты?')) {
            const newSections = [...sections];
            newSections.splice(index, 1);
            updateSections(newSections);
        }
    };

    const addItem = (sectionIndex: number) => {
        const newSections = [...sections];
        if (!newSections[sectionIndex].items) newSections[sectionIndex].items = [];
        newSections[sectionIndex].items.push({ description: '', weight: 10 });
        updateSections(newSections);
    };

    const updateItem = (sectionIndex: number, itemIndex: number, field: keyof ChecklistItem, value: any) => {
        const newSections = [...sections];
        newSections[sectionIndex].items[itemIndex] = {
            ...newSections[sectionIndex].items[itemIndex],
            [field]: value
        };
        updateSections(newSections);
    };

    const deleteItem = (sectionIndex: number, itemIndex: number) => {
        const newSections = [...sections];
        newSections[sectionIndex].items.splice(itemIndex, 1);
        updateSections(newSections);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">Чек-лист (Регламент)</h3>
                <div className={`px-3 py-1 rounded-lg text-xs font-bold ${totalWeight === 100 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    Сумма баллов: {totalWeight}% {totalWeight !== 100 && '(должно быть 100%)'}
                </div>
            </div>

            {sections.map((section, sIndex) => (
                <div key={sIndex} className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 p-4 relative group">
                    <div className="flex items-center gap-2 mb-3">
                        <input
                            value={section.section}
                            onChange={(e) => updateSectionName(sIndex, e.target.value)}
                            className="bg-transparent font-bold text-gray-700 border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none transition-all flex-1 py-1"
                            placeholder="Название раздела (напр. Приветствие)"
                        />
                        <button
                            onClick={() => deleteSection(sIndex)}
                            className="text-gray-300 hover:text-red-500 transition-colors p-1 opacity-0 group-hover:opacity-100"
                            title="Удалить раздел"
                        >
                            🗑️
                        </button>
                    </div>

                    <div className="space-y-2 pl-2 border-l-2 border-gray-100">
                        {section.items && section.items.map((item, iIndex) => (
                            <div key={iIndex} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-100 shadow-sm">
                                <span className="text-gray-300 font-bold text-xs w-4">{iIndex + 1}.</span>
                                <input
                                    value={item.description}
                                    onChange={(e) => updateItem(sIndex, iIndex, 'description', e.target.value)}
                                    className="flex-1 text-sm outline-none placeholder-gray-300 min-w-0"
                                    placeholder="Описание критерия"
                                />
                                <div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded border border-gray-100 w-24 shrink-0">
                                    <input
                                        type="number"
                                        value={item.weight}
                                        onChange={(e) => updateItem(sIndex, iIndex, 'weight', parseInt(e.target.value) || 0)}
                                        className="w-12 bg-transparent text-right font-bold text-xs outline-none"
                                    />
                                    <span className="text-[10px] text-gray-400 font-medium">%</span>
                                </div>
                                <button
                                    onClick={() => deleteItem(sIndex, iIndex)}
                                    className="text-gray-300 hover:text-red-400 transition-colors px-1"
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={() => addItem(sIndex)}
                        className="mt-3 w-full border border-dashed border-gray-200 text-gray-400 py-2 rounded-lg text-[10px] uppercase font-bold hover:bg-white hover:text-indigo-500 hover:border-indigo-200 transition-all"
                    >
                        + Добавить критерий
                    </button>
                </div>
            ))}

            <button
                onClick={addSection}
                className="w-full bg-indigo-50 text-indigo-600 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2 border border-indigo-100 dashed"
            >
                ➕ Новый раздел
            </button>
        </div>
    );
}
