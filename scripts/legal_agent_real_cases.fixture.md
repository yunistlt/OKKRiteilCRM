// Golden fixtures for legal agent regression
// Run: npm run legal:regression
//
// This file contains 20+ реальных кейсов для проверки извлечения рисков и подсветки проблемных пунктов.
// Формат: { id, title, file_name, text, expected_issues }
// expected_issues: [{ id, severity }]
//
// Пример:
// {
//   "id": 1,
//   "title": "Поставка оборудования с неустойкой 25%",
//   "file_name": "contract1.pdf",
//   "text": "Поставщик обязуется поставить оборудование. В случае просрочки применяется неустойка 25%. Подсудность — по месту истца.",
//   "expected_issues": [
//     { "id": "penalty-high", "severity": "red" },
//     { "id": "plaintiff-jurisdiction", "severity": "red" }
//   ]
// }
// ...
