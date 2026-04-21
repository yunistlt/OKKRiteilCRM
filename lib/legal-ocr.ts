// OCR для сканов и image-based PDF
import Tesseract from 'tesseract.js';

export async function extractTextFromImageBuffer(buffer: Buffer): Promise<string> {
  const { data } = await Tesseract.recognize(buffer, 'rus+eng', { logger: () => {} });
  return data.text;
}
