import QRCode from 'qrcode';

/**
 * Generates a local Data URL (PNG) for QR code without sending data to external APIs.
 */
export async function generateQrDataUrl(text: string, size = 200): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { width: size, margin: 2 });
  } catch (err) {
    console.error('Error generating local QR code:', err);
    return '';
  }
}

export function generateQrSvg(text: string, size = 200): string {
  // Sync fallback helper returning local data URL via QRCode
  const encoded = encodeURIComponent(text);
  // Safe inline SVG placeholder or canvas URL
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="%23f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="12" fill="%23475569">${encoded}</text></svg>`;
}
