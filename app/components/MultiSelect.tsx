import React, { useState, useRef, useEffect } from 'react';

interface Option {
    value: string;
    label: string;
}

interface MultiSelectProps {
    options: Option[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
    placeholder: string;
    icon?: React.ReactNode;
}

export function MultiSelect({ options, selectedValues, onChange, placeholder, icon }: MultiSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [pendingValues, setPendingValues] = useState<string[]>(selectedValues);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // При открытии синхронизируем pending с применёнными значениями
    const handleOpen = () => {
        if (!isOpen) {
            setPendingValues(selectedValues);
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                // Закрытие без применения — сбрасываем pending к применённым
                setPendingValues(selectedValues);
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [selectedValues]);

    const toggleOption = (value: string) => {
        setPendingValues(prev =>
            prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
        );
    };

    const applyFilter = () => {
        onChange(pendingValues);
        setIsOpen(false);
    };

    const resetFilter = () => {
        setPendingValues([]);
        onChange([]);
        setIsOpen(false);
    };

    const isAllSelected = selectedValues.length === 0;
    const isAllPending = pendingValues.length === 0;
    const hasPendingChanges =
        pendingValues.length !== selectedValues.length ||
        pendingValues.some(v => !selectedValues.includes(v));

    return (
        <div className="relative flex-shrink-0" ref={dropdownRef}>
            <button
                type="button"
                onClick={handleOpen}
                className="flex items-center gap-1 pl-6 pr-5 py-1 bg-gray-50 border border-gray-100 rounded text-[10px] font-bold text-gray-600 hover:bg-gray-100 transition-all min-w-[120px] outline-none focus:ring-1 focus:ring-blue-400 w-full text-left"
            >
                {icon && (
                    <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none text-[10px]">
                        {icon}
                    </div>
                )}
                <span className="truncate flex-1">
                    {isAllSelected ? placeholder : `Выбрано: ${selectedValues.length}`}
                </span>
                <div className="absolute inset-y-0 right-1 flex items-center pointer-events-none">
                    <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
            </button>

            {isOpen && (
                <div className="absolute top-full mt-1 left-0 w-max min-w-[160px] bg-white border border-gray-100 rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto flex flex-col">
                    <div className="flex-1 overflow-y-auto">
                        <button
                            type="button"
                            onClick={resetFilter}
                            className={`w-full text-left px-3 py-1.5 text-[10px] font-bold hover:bg-gray-50 flex items-center gap-2 ${isAllPending ? 'text-blue-600' : 'text-gray-600'}`}
                        >
                            <div className={`w-3 h-3 rounded-sm border flex items-center justify-center ${isAllPending ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                                {isAllPending && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                            </div>
                            {placeholder}
                        </button>
                        {options.map((opt) => {
                            const isPending = pendingValues.includes(opt.value);
                            return (
                                <button
                                    type="button"
                                    key={opt.value}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        toggleOption(opt.value);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-[10px] font-bold hover:bg-gray-50 flex items-center gap-2 ${isPending ? 'text-blue-600 bg-blue-50/50' : 'text-gray-600'}`}
                                >
                                    <div className={`w-3 h-3 rounded-sm border flex items-center justify-center ${isPending ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                                        {isPending && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                    </div>
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="border-t border-gray-100 px-2 py-1.5">
                        <button
                            type="button"
                            onClick={applyFilter}
                            className={`w-full py-1 rounded text-[10px] font-bold transition-colors ${hasPendingChanges ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-100 text-gray-400 cursor-default'}`}
                        >
                            Применить
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
