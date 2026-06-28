'use client';

import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

// Блюр-оверлей поверх расчётки, когда мотивацию меняли после последнего расчёта.
// Родитель должен быть position: relative. Кнопка «ПЕРЕСЧИТАТЬ» — только тем, кто может
// пересчитывать (admin/rop); менеджеру показываем пояснение без кнопки.
export default function RecalcOverlay({
    canRecalc,
    recalculating,
    onRecalc,
}: {
    canRecalc: boolean;
    recalculating: boolean;
    onRecalc: () => void;
}) {
    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/50 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md border border-red-300 bg-white p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center bg-red-100">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <div className="mb-1 text-lg font-semibold text-gray-900">Мотивация изменена</div>
                <p className="mb-4 text-sm text-muted-foreground">
                    Параметры расчёта зарплаты менялись после последнего расчёта — показанные суммы устарели.
                    {canRecalc
                        ? ' Пересчитайте зарплату, чтобы увидеть актуальные значения.'
                        : ' Зарплата будет пересчитана руководителем.'}
                </p>
                {canRecalc && (
                    <Button
                        onClick={onRecalc}
                        disabled={recalculating}
                        className="h-12 w-full bg-red-600 text-base font-semibold text-white hover:bg-red-700"
                    >
                        {recalculating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
                        ПЕРЕСЧИТАТЬ
                    </Button>
                )}
            </div>
        </div>
    );
}
