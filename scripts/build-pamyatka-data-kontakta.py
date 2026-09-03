# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(TTFont('A', '/System/Library/Fonts/Supplemental/Arial.ttf'))
pdfmetrics.registerFont(TTFont('AB', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'))

W, H = A4
M = 18 * mm
INK = (0.09, 0.09, 0.09)
GREY = (0.42, 0.42, 0.42)
LINE = (0.80, 0.80, 0.80)
ACC = (0.13, 0.32, 0.62)

c = canvas.Canvas('docs/sales-rop/pamyatka-data-kontakta.pdf', pagesize=A4)
c.setTitle('Памятка: дата следующего контакта')
c.setAuthor('ЗМК Тольятти')

y = [H - M]

def rule(color=LINE, w=0.6, gap=4):
    y[0] -= gap
    c.setStrokeColorRGB(*color); c.setLineWidth(w)
    c.line(M, y[0], W - M, y[0])
    y[0] -= gap

def text(s, font='A', size=11.5, color=INK, lead=16.5, indent=0):
    c.setFont(font, size); c.setFillColorRGB(*color)
    max_w = W - 2 * M - indent
    words, line = s.split(' '), ''
    for wd in words:
        t = (line + ' ' + wd).strip()
        if c.stringWidth(t, font, size) <= max_w:
            line = t
        else:
            c.drawString(M + indent, y[0], line); y[0] -= lead; line = wd
    if line:
        c.drawString(M + indent, y[0], line); y[0] -= lead

def h1(s):
    c.setFont('AB', 22); c.setFillColorRGB(*INK)
    c.drawString(M, y[0], s); y[0] -= 22

def h2(s):
    y[0] -= 14
    c.setFont('AB', 13.5); c.setFillColorRGB(*INK)
    c.drawString(M, y[0], s); y[0] -= 19

def bullet(s, mark='—'):
    c.setFont('A', 11.5); c.setFillColorRGB(*ACC)
    c.drawString(M, y[0], mark)
    text(s, indent=7 * mm)

def block(title, body, color):
    pad = 4 * mm
    c.setFont('AB', 10.5)
    lines = []
    for para in body:
        words, line = para.split(' '), ''
        for wd in words:
            t = (line + ' ' + wd).strip()
            if c.stringWidth(t, 'A', 11.5) <= W - 2 * M - 2 * pad:
                line = t
            else:
                lines.append(line); line = wd
        lines.append(line)
    h = 10 * mm + len(lines) * 16
    c.setFillColorRGB(*color); c.rect(M, y[0] - h + 10, W - 2 * M, h, stroke=0, fill=1)
    c.setFillColorRGB(*INK); c.setFont('AB', 11.5)
    c.drawString(M + pad, y[0], title); y[0] -= 18
    c.setFont('A', 11.5)
    for ln in lines:
        c.drawString(M + pad, y[0], ln); y[0] -= 16
    y[0] -= 10

# ── страница 1 ──────────────────────────────────────────────────────────────
h1('Дата следующего контакта')
c.setFont('A', 11); c.setFillColorRGB(*GREY)
c.drawString(M, y[0], 'Памятка отделу продаж · ЗМК Тольятти · сентябрь 2026'); y[0] -= 6
rule(INK, 1.2, 6)
y[0] -= 10

text('Дата следующего контакта в карточке заказа — это обещание клиенту, а не служебная '
     'галочка. В этот день с ним разговаривают. Из этого поля собирается ваш утренний план: '
     'что стоит на сегодня, то и придёт вам в задачи.')
y[0] -= 4

h2('Как ставить')
bullet('Ставьте ту дату, о которой договорились с клиентом вслух: «созвонимся в четверг» — четверг.')
bullet('Не знаете точный день — ставьте день, когда сами планируете вернуться к заказу.')
bullet('Дату в будущем автоматика не трогает: если вы договорились на 20-е, никто её не сдвинет.')
bullet('Сделали звонок — сразу ставьте следующую дату. Заказ без даты выпадает из плана.')

h2('Чего делать не нужно')
bullet('Переносить пачкой на завтра всё, до чего сегодня не дошли руки. Завтра будет то же самое, '
       'плюс новые заказы.')
bullet('Ставить одну дату на десятки заказов. 40 обещаний на один день — это 40 несделанных звонков, '
       'а не план.')
bullet('Двигать дату, чтобы заказ «не мозолил глаза». Если разговор не нужен — заказу место в другом '
       'статусе, а не в новой дате.')

y[0] -= 4
block('Как это выглядит со стороны', [
    'На 3 сентября у одного менеджера стояло 87 заказов с датой контакта «сегодня».',
    'Все 87 — перенос уже стоявшей даты, ни одного нового договора с клиентом.',
    '35 переехали со вчера, 18 — со сдвигом больше недели, самый старый — на 702 дня.',
    'В утренний план из них попали 38 задач. Столько звонков за день не делает никто.',
], (0.96, 0.94, 0.90))

h2('Если заказ не двигается')
text('Перенос даты не решает проблему — он её прячет. Работающие варианты:')
bullet('Клиент думает — договоритесь о конкретном сроке ответа и поставьте эту дату.')
bullet('Клиент молчит второй месяц — переведите заказ в статус, который это отражает, и напишите '
       'причину в комментарии.')
bullet('Заказ потерял смысл — закройте его. Мёртвый заказ в работе портит и план, и вашу же статистику.')

y[0] -= 6
rule()
c.setFont('A', 9); c.setFillColorRGB(*GREY)
c.drawString(M, y[0], 'Вопросы по памятке — руководителю отдела продаж.')

c.showPage()
c.save()
print('готово')
