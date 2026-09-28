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

/**
 * Допуск на шаг: насколько пиксель может отличаться от соседа, с которого мы на
 * него пришли. Сравнение идёт с соседом, а не с цветом угла, потому что фон
 * бывает с градиентом — пол под ногами темнее стены за спиной. Сравнение с
 * одним цветом на таком фоне останавливается на полпути и не снимает ничего.
 */
const STEP = 9;

/**
 * Поводок: насколько далеко цвет может уйти от той точки на краю кадра, с
 * которой заливка сюда пришла. Без поводка плавный переход тона довёл бы её от
 * стены до самой кожи — шаг за шагом, каждый в пределах допуска.
 *
 * Считается именно от своей точки старта, а не от общего цвета углов. Иначе
 * приходится выбирать между двумя бедами: короткий поводок оставляет
 * потемнение пола у ног, длинный — пускает заливку на белую одежду. От своей
 * точки пол укладывается в поводок (он начался с тёмного низа кадра), а белый
 * костюм — нет (до него добираются от светлой стены).
 */
const LEASH = 60;

/** Насколько замкнутый участок может отличаться от цвета фона, чтобы считаться им. */
const HOLE_TOLERANCE = 7;

/** Меньше этого — блик на ткани, а не просвет фона. */
const HOLE_MIN_AREA = 40;

/** Сколько пикселей у границы делаем полупрозрачными, чтобы не было пилы. */
const FEATHER = 2;

export async function cutout(input: Buffer): Promise<Buffer> {
    const cut = await cutoutKeepFrame(input);

    // Обрезаем по фигуре: поля вокруг — это и есть причина, по которой она
    // выглядела мелкой.
    return sharp(cut).trim({ threshold: 1 }).png().toBuffer();
}

/**
 * Снять фон, не трогая размер кадра.
 *
 * Нужна видео: кадры ролика обрезаются одной общей рамкой, а не каждый по
 * своей фигуре — иначе при каждом взмахе руки рамка менялась бы и Тамара на
 * экране дёргалась.
 */
export async function cutoutKeepFrame(input: Buffer, opts: { holes?: boolean } = {}): Promise<Buffer> {
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

    const diff = (a: number, b: number) =>
        Math.max(
            Math.abs(data[a] - data[b]),
            Math.abs(data[a + 1] - data[b + 1]),
            Math.abs(data[a + 2] - data[b + 2]),
        );
    // Заливка от краёв. Очередь вместо рекурсии: кадр под два мегапикселя, и
    // рекурсия здесь кончается переполнением стека.
    const isBg = new Uint8Array(width * height);
    // Цвет точки старта — тот, от которого этому пикселю отмеряется поводок.
    const seed = new Uint8Array(width * height * 3);
    const queue: number[] = [];

    const push = (x: number, y: number, from: number | null) => {
        const p = y * width + x;
        if (isBg[p]) return;
        const i = p * channels;

        // Пиксель на краю кадра сам себе точка старта: дальше от него и пойдёт
        // отсчёт. Пиксель внутри наследует точку старта соседа.
        const s = from === null ? [data[i], data[i + 1], data[i + 2]] : [seed[from * 3], seed[from * 3 + 1], seed[from * 3 + 2]];

        if (from !== null) {
            if (diff(i, from * channels) > STEP) return;
            const drift = Math.max(
                Math.abs(data[i] - s[0]),
                Math.abs(data[i + 1] - s[1]),
                Math.abs(data[i + 2] - s[2]),
            );
            if (drift > LEASH) return;
        } else {
            // Край кадра — это фон по определению, но если он уже далеко от
            // общего тона углов, значит в кадр попало что-то ещё; такое не
            // трогаем.
            const off = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
            if (off > LEASH * 2) return;
        }

        isBg[p] = 1;
        seed[p * 3] = s[0];
        seed[p * 3 + 1] = s[1];
        seed[p * 3 + 2] = s[2];
        queue.push(p);
    };

    for (let x = 0; x < width; x += 1) {
        push(x, 0, null);
        push(x, height - 1, null);
    }
    for (let y = 0; y < height; y += 1) {
        push(0, y, null);
        push(width - 1, y, null);
    }

    while (queue.length) {
        const p = queue.pop()!;
        const x = p % width;
        const y = (p - x) / width;
        if (x > 0) push(x - 1, y, p);
        if (x < width - 1) push(x + 1, y, p);
        if (y > 0) push(x, y - 1, p);
        if (y < height - 1) push(x, y + 1, p);
    }

    // Замкнутый фон: зазор между ног, просвет под согнутой рукой. Заливка от
    // краёв туда не доходит, когда щиколотки или локоть касаются тела, и в
    // просвете остаётся серый клочок. Снимаем участки, которые почти в точности
    // цвета фона, — допуск узкий, чтобы кремовая блузка или белая рубашка им не
    // считались: у них другой оттенок, а не только яркость.
    if (opts.holes) {
        const near = (i: number) =>
            Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) <=
            HOLE_TOLERANCE;
        const visited = new Uint8Array(width * height);
        for (let start = 0; start < width * height; start += 1) {
            if (isBg[start] || visited[start] || !near(start * channels)) continue;
            const part: number[] = [start];
            visited[start] = 1;
            for (let k = 0; k < part.length; k += 1) {
                const p = part[k];
                const x = p % width;
                const y = (p - x) / width;
                const next = [
                    x > 0 ? p - 1 : -1,
                    x < width - 1 ? p + 1 : -1,
                    y > 0 ? p - width : -1,
                    y < height - 1 ? p + width : -1,
                ];
                for (const q of next) {
                    if (q < 0 || visited[q] || isBg[q] || !near(q * channels)) continue;
                    visited[q] = 1;
                    part.push(q);
                }
            }
            if (part.length >= HOLE_MIN_AREA) for (const p of part) isBg[p] = 1;
        }
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

    return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}
