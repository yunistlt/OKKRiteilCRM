import os

# Вызываем блок из Вебасиста напрямую
OKK_WIDGET_CODE = '    {$wa->block("okk_chat")}'

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    changed = False

    # 1. Отключаем CarrotQuest (оборачиваем в <!-- --> если еще не обернут)
    if "<!-- Carrot quest BEGIN -->" in content and "<!-- ОТКЛЮЧЕНО" not in content:
        content = content.replace("<!-- Carrot quest BEGIN -->", "<!-- Carrot quest BEGIN -->\n<!-- ОТКЛЮЧЕНО")
        content = content.replace("<!-- Carrot quest END -->", "-->\n<!-- Carrot quest END -->")
        changed = True

    # 2. Вставляем вызов блока ОКК виджета, если его еще нет
    if "okk_chat" not in content and "</body>" in content:
        content = content.replace("</body>", OKK_WIDGET_CODE + "\n</body>")
        changed = True

    if changed:
        # Делаем резервную копию на всякий случай
        os.rename(filepath, filepath + ".bak")
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Обновлен: {filepath}")

for root, dirs, files in os.walk('.'):
    if "themes" in root and "index.html" in files:
        process_file(os.path.join(root, "index.html"))