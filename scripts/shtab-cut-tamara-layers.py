"""Разрезает вырезанный кадр Тамары на два слоя: тело и голова.

Линия раздела — верх плеч: там ширина силуэта скачком уходит вверх, потому что
к волосам добавляются плечи. Растушёвки слоёв взаимно дополняют друг друга,
поэтому в покое сумма даёт ровно исходный кадр, а при повороте размытая полоса
прячет стык на шее.
"""
from PIL import Image
import numpy as np, json, os

S = os.path.dirname(os.path.abspath(__file__))
src = Image.open(os.path.join(S, "out/tam_final.png")).convert("RGBA")
W0, H0 = src.size
alpha = np.asarray(src.split()[3]).astype(np.float32) / 255.0

# Носки туфель срезаны нижней границей исходного кадра. Гасим последние строки,
# чтобы плоский срез уходил в тень пола, а не читался как обрубленная нога.
FADE = 24
alpha[-FADE:] *= np.linspace(1.0, 0.0, FADE)[:, None]

# профиль ширины силуэта и его производная
width = (alpha > 0.16).sum(1).astype(float)
smooth = np.convolve(width, np.ones(9) / 9, mode="same")
deriv = np.zeros(H0)
deriv[8:H0 - 8] = smooth[16:] - smooth[:H0 - 16]

lo, hi = int(H0 * 0.05), int(H0 * 0.35)
seg = deriv[lo:hi]
yc = lo + int(np.argmax(seg > 0.55 * seg.max()))   # начало подъёма = верх плеч

cols = np.where(alpha[yc] > 0.16)[0]
xc = (cols[0] + cols[-1]) / 2.0                     # центр шеи

# Растушёвка односторонняя. Наложение по «over» не складывается: если оба слоя
# в одной точке полупрозрачны, между ними просвечивает фон и на шее проступает
# размытая полоса. Поэтому там, где голова полупрозрачна, тело держит полную
# непрозрачность — сумма слоёв в покое даёт ровно исходный кадр.
band = 13                                           # полуширина растушёвки, px исходника
top = yc - band                                     # выше этой линии тело обрезано

lip = 3                                             # тело гасится не ступенькой, а за lip строк

ramp = np.ones(H0, dtype=np.float32)                # альфа головы
ramp[yc + band:] = 0.0
ramp[top:yc + band] = np.linspace(1.0, 0.0, 2 * band)

keep = np.zeros(H0, dtype=np.float32)               # альфа тела
keep[top:] = 1.0
keep[top - lip:top] = np.linspace(0.0, 1.0, lip)    # голова здесь ещё полностью непрозрачна

rgb = np.asarray(src)[..., :3]
layers = {
    "head": np.dstack([rgb, alpha * ramp[:, None] * 255]),
    "body": np.dstack([rgb, alpha * keep[:, None] * 255]),
}

TW = 620
TH = int(round(TW * H0 / W0))
sizes = {}
for name, arr in layers.items():
    im = Image.fromarray(arr.astype(np.uint8), "RGBA").resize((TW, TH), Image.LANCZOS)
    p = os.path.join(S, f"out/tamara_{name}.webp")
    im.save(p, "WEBP", quality=86, method=6)
    sizes[name] = os.path.getsize(p)

meta = {
    "split_y": int(yc), "band": band, "neck_x": round(xc, 1),
    "src": [W0, H0], "out": [TW, TH],
    "origin_x_pct": round(xc / W0 * 100, 2),
    "origin_y_pct": round(yc / H0 * 100, 2),
    "sizes": sizes,
}
open(os.path.join(S, "out/layers.json"), "w").write(json.dumps(meta))
print(json.dumps(meta, ensure_ascii=False, indent=2))
