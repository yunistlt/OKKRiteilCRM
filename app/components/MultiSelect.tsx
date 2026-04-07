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
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleOption = (value: string) => {
        if (selectedValues.includes(value)) {
            onChange(selectedValues.filter(v => v !== value));
        } else {
            const safeSelected = Array.isArray(selectedValues) ? selectedValues : [];
            onChange([...safeSelected, value]);
        }
    };

    const isAllSelected = selectedValues.length === 0;

    return (
        <div className="relative flex-shrink-0" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
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
                <div className="absolute top-full mt-1 left-0 w-max min-w-[160px] bg-white border border-gray-100 rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                    <button
                        type="button"
                        onClick={() => {
                            onChange([]);
                            setIsOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[10px] font-bold hover:bg-gray-50 flex items-center gap-2 ${isAllSelected ? 'text-blue-600' : 'text-gray-600'}`}
                    >
                        <div className={`w-3 h-3 rounded-sm border flex items-center justify-center ${isAllSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                            {isAllSelected && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        {placeholder}
                    </button>
                    {options.map((opt) => {
                        const isSelected = selectedValues.includes(opt.value);
                        return (
                            <button
                                type="button"
                                key={opt.value}
                                onClick={(e) => {
                                    e.preventDefault();
                                    toggleOption(opt.value);
                                }}
                                className={`w-full text-left px-3 py-1.5 text-[10px] font-bold hover:bg-gray-50 flex items-center gap-2 ${isSelected ? 'text-blue-600 bg-blue-50/50' : 'text-gray-600'}`}
                            >
                                <div className={`w-3 h-3 rounded-sm border flex items-center justify-center ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                                    {isSelected && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                </div>
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
