import AIRouterPanel from '@/components/AIRouterPanel';

export default function AIToolsPage() {
    return (
        <div className="container mx-auto py-8 px-4 max-w-6xl">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">AI Инструменты</h1>
                <p className="text-gray-600 mt-2">
                    Автоматизация обработки заказов с помощью искусственного интеллекта
                </p>
            </div>

            <AIRouterPanel />
        </div>
    );
}
