const AVATAR_MAX_DIMENSION = 1024;
const AVATAR_COMPRESSION_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const AVATAR_OUTPUT_QUALITY = 0.82;

function renameFileWithExtension(fileName: string, extension: string) {
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'avatar';
    return `${baseName}.${extension}`;
}

async function renderImageBlob(file: File, width: number, height: number) {
    const bitmap = await createImageBitmap(file);

    try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
            return null;
        }

        context.drawImage(bitmap, 0, 0, width, height);

        const webpBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/webp', AVATAR_OUTPUT_QUALITY);
        });

        if (webpBlob) {
            return webpBlob;
        }

        return await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', AVATAR_OUTPUT_QUALITY);
        });
    } finally {
        bitmap.close();
    }
}

export async function prepareAvatarFileForUpload(file: File) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size <= AVATAR_COMPRESSION_THRESHOLD_BYTES) {
        return file;
    }

    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
        const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
        bitmap.close();

        const blob = await renderImageBlob(file, targetWidth, targetHeight);
        if (!blob || blob.size >= file.size) {
            return file;
        }

        return new File(
            [blob],
            renameFileWithExtension(file.name, blob.type === 'image/webp' ? 'webp' : 'jpg'),
            { type: blob.type, lastModified: Date.now() },
        );
    } catch {
        return file;
    }
}