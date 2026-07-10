import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Тест виджета Ловца Лидов Елена (Заказ #53770)</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 40px;
            background-color: #f3f4f6;
            color: #1f2937;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #fff;
            padding: 30px;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.05);
        }
        h1 {
            font-size: 24px;
            margin-bottom: 16px;
            color: #111827;
        }
        p {
            font-size: 15px;
            line-height: 1.6;
            color: #4b5563;
        }
        .info-box {
            background-color: #f0fdf4;
            border-left: 4px solid #10b981;
            padding: 16px;
            border-radius: 8px;
            margin-top: 20px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Тестирование виджета с UTM-метками заказа #53770</h1>
        <p>Вы перешли по ссылке из письма РОП-бота. На этой странице загружен виджет ИИ-консультанта Елены.</p>
        <p>Кликните по круглой иконке виджета в правом нижнем углу экрана (или подождите), чтобы начать диалог. Лена должна поприветствовать вас по имени <b>Тимофей</b>, упомянуть заказ <b>#53770</b> и задать 7 вопросов квалификации.</p>
        
        <div class="info-box">
            <b>Метки в URL:</b><br>
            utm_source = rop_bot<br>
            utm_medium = email<br>
            utm_campaign = 53770 (номер заказа)
        </div>
    </div>

    <!-- Подключаем наш локальный виджет -->
    <script src="/api/widget/embed" async></script>
</body>
</html>
    `.trim();

    return new NextResponse(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
        },
    });
}
