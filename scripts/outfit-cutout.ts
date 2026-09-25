import sharp from 'sharp';

/**
 * Вырезать фигуру из студийного кадра.
 *
 * Kling просьбу о прозрачном фоне не выполняет: возвращается сплошной светлый
 * фон. В Штабе фигура стоит на собственном фоне страницы, и серый прямоугольник
 * вокруг неё виден сразу.
 *
 * Фон здесь простой — ровная светлая заливка без предметов, — поэтому хватает
 * заливки от краёв: берём цвет угла и растекаемся по соседним пикселям, пока
 * они на него похожи. Так снимается именно фон, а не всё светлое в кадре: белая
 * рубашка внутри фигуры до краёв не достаёт и остаётся на месте.
 *
 * Обрезка по фигуре идёт следом и по той же причине, по которой она вообще
 * понадобилась: в кадре широкие поля, из-за которых Тамара на экране мельче,
 * чем была. После обрезки она занимает всю высоту сцены.
 */

/** Насколько цвет пикселя может отличаться от фонового, чтобы считаться фоном. */
const TOLERANCE = 26;

/** Сколько пикселей у границы делаем полупрозрачными, чтобы не было пилы. */
const FEATHER = 2;

export async function cutout(input: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const at = (x: number, y: number) => (y * width + x) * channels;

    // Цвет фона — среднее по четырём углам: в одном углу может оказаться тень.
    const corners = [
        at(0, 0),
        at(width - 1, 0),
        at(0, height - 1),
        at(width - 1, height - 1),
    ];
    const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, i) => s + data[i + c], 0) / corners.length));

    const near = (i: number) =>
        Math.abs(data[i] - bg[0]) <= TOLERANCE &&
        Math.abs(data[i + 1] - bg[1]) <= TOLERANCE &&
        Math.abs(data[i + 2] - bg[2]) <= TOLERANCE;

    // Заливка от краёв. Очередь вместо рекурсии: кадр под два мегапикселя, и
    // рекурсия здесь кончается переполнением стека.
    const isBg = new Uint8Array(width * height);
    const queue: number[] = [];
    const push = (x: number, y: number) => {
        const p = y * width + x;
        if (isBg[p]) return;
        if (!near(p * channels)) return;
        isBg[p] = 1;
        queue.push(p);
    };

    for (let x = 0; x < width; x += 1) {
        push(x, 0);
        push(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
        push(0, y);
        push(width - 1, y);
    }

    while (queue.length) {
        const p = queue.pop()!;
        const x = p % width;
        const y = (p - x) / width;
        if (x > 0) push(x - 1, y);
        if (x < width - 1) push(x + 1, y);
        if (y > 0) push(x, y - 1);
        if (y < height - 1) push(x, y + 1);
    }

    for (let p = 0; p < width * height; p += 1) {
        if (isBg[p]) data[p * channels + 3] = 0;
    }

    // Смягчение края: пиксель фигуры, у которого сосед — фон, делается
    // полупрозрачным. Без этого по контуру идёт лесенка и светлый ореол.
    for (let pass = 0; pass < FEATHER; pass += 1) {
        const edge: number[] = [];
        for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
                const p = y * width + x;
                if (data[p * channels + 3] === 0) continue;
                const around =
                    data[(p - 1) * channels + 3] === 0 ||
                    data[(p + 1) * channels + 3] === 0 ||
                    data[(p - width) * channels + 3] === 0 ||
                    data[(p + width) * channels + 3] === 0;
                if (around) edge.push(p);
            }
        }
        for (const p of edge) data[p * channels + 3] = Math.round(data[p * channels + 3] * 0.55);
    }

    const cut = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();

    // Обрезаем по фигуре: поля вокруг — это и есть причина, по которой она
    // выглядела мелкой.
    return sharp(cut).trim({ threshold: 1 }).png().toBuffer();
}
