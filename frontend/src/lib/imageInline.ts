// Helpers to turn an image into a Gemini inlineData payload (base64 WITHOUT the
// data: prefix). Used to ride an image along a BYOK Gemini call (AI multimodal).
// L1: these never touch a key — they only encode image bytes.

import { assetUrl } from '../config/api';
import { tn } from '../i18n/tn';

export interface InlineImage {
  mimeType: string;
  /** base64 WITHOUT the leading "data:<mime>;base64," prefix. */
  data: string;
}

/** Strip the "data:<mime>;base64," prefix from a FileReader data URL. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function blobToInlineData(blob: Blob, mimeFallback: string): Promise<InlineImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(tn('misc.image_read_error')));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error(tn('misc.image_read_error')));
        return;
      }
      resolve({ mimeType: blob.type || mimeFallback, data: stripDataUrlPrefix(result) });
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch a same-origin image URL (e.g. a "/uploads/<name>" path) and convert it
 * to inline base64 bytes for a Gemini inlineData part. Returns null on ANY
 * failure so callers can gracefully fall back to a text-only request rather than
 * blocking the reply. CSP: same-origin fetch is allowed by connect-src 'self'.
 */
export async function urlToInlineData(url: string): Promise<InlineImage | null> {
  try {
    const res = await fetch(assetUrl(url) ?? url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') && blob.size === 0) return null;
    return await blobToInlineData(blob, 'image/png');
  } catch {
    return null;
  }
}
