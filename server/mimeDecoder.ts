import { simpleParser, ParsedMail } from 'mailparser';
import iconv from 'iconv-lite';

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes email charset strings to standard iconv identifiers
 */
function normalizeCharset(charset?: string): string {
  if (!charset) return 'utf-8';
  const c = charset.toLowerCase().trim().replace(/['"]/g, '');
  if (c.includes('1256') || c.includes('arabic') || c.includes('cp1256')) return 'windows-1256';
  if (c.includes('8859-6') || c.includes('iso-8859-6')) return 'iso-8859-6';
  if (c.includes('utf-8') || c.includes('utf8')) return 'utf-8';
  if (c.includes('ascii') || c.includes('us-ascii')) return 'ascii';
  if (c.includes('latin1') || c.includes('8859-1')) return 'latin1';
  return c;
}

/**
 * Robustly decodes Quoted-Printable encoded strings without corrupting unicode/Persian text.
 */
export function decodeQuotedPrintable(str: string, charset = 'utf-8'): string {
  if (!str || typeof str !== 'string') return '';
  if (!str.includes('=')) return str;

  try {
    const textWithoutSoftBreaks = str.replace(/=(?:\r\n|\n|\r)/g, '');

    return textWithoutSoftBreaks.replace(/((?:=[0-9A-Fa-f]{2})+)/g, (match) => {
      try {
        const hexPairs = match.match(/=[0-9A-Fa-f]{2}/g) || [];
        const bytes = hexPairs.map(h => parseInt(h.substring(1), 16));
        const buf = Buffer.from(bytes);
        const targetCharset = normalizeCharset(charset);
        if (iconv.encodingExists(targetCharset)) {
          return iconv.decode(buf, targetCharset);
        }
        return buf.toString('utf-8');
      } catch {
        return match;
      }
    });
  } catch (err) {
    console.error('[MimeDecoder] Error in decodeQuotedPrintable:', err);
    return str;
  }
}

/**
 * Decodes RFC 2047 MIME encoded headers like =?UTF-8?B?...?= or =?windows-1256?Q?...?=
 */
export function decodeMimeHeader(header: string): string {
  if (!header || typeof header !== 'string') return '';
  if (!header.includes('=?')) return fixMojibake(header);

  try {
    const joinedHeader = header.replace(/(\?=\s+=\?)/g, '?==?');

    const decoded = joinedHeader.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, text) => {
      try {
        const normCharset = normalizeCharset(charset);
        const enc = encoding.toUpperCase();

        if (enc === 'B') {
          const buf = Buffer.from(text.replace(/\s+/g, ''), 'base64');
          if (iconv.encodingExists(normCharset)) {
            return iconv.decode(buf, normCharset);
          }
          return buf.toString('utf-8');
        } else if (enc === 'Q') {
          const qText = text.replace(/_/g, ' ');
          return decodeQuotedPrintable(qText, normCharset);
        }
      } catch (err) {
        console.error('[MimeDecoder] Error decoding header chunk:', err);
      }
      return text;
    });

    return fixMojibake(decoded);
  } catch (err) {
    return fixMojibake(header);
  }
}

/**
 * Detects and automatically fixes Persian/Arabic Mojibake (corrupted characters like Ø³Ù„Ø§Ù… caused by double-encoding).
 */
export function fixMojibake(text: string): string {
  if (!text || typeof text !== 'string') return '';

  if (!text.includes('Ø') && !text.includes('Ù') && !text.includes('Â') && !text.includes('Ã')) {
    return text;
  }

  try {
    const buf = Buffer.from(text, 'latin1');
    const recovered = buf.toString('utf-8');

    if (!recovered.includes('\uFFFD') && /[\u0600-\u06FF]/.test(recovered)) {
      return recovered;
    }
  } catch {
    // Keep original on failure
  }

  return text;
}

/**
 * Parses any incoming email with full Persian, UTF-8, inline image (CID to base64) resolution and attachments.
 */
export async function parseInboundEmail(rawInput: any): Promise<{
  to: string;
  from: { name: string; address: string };
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; contentType: string; size: string; downloadUrl?: string }>;
  headers?: Record<string, string>;
}> {
  // Case 1: Raw MIME / RFC 822 string or Buffer
  if (typeof rawInput === 'string' || Buffer.isBuffer(rawInput)) {
    const rawString = typeof rawInput === 'string' ? rawInput : rawInput.toString('utf-8');
    
    // Check if it's an RFC822 formatted string
    if (rawString.includes('Received:') || rawString.includes('Content-Type:') || rawString.includes('From:') || rawString.includes('Subject:')) {
      try {
        const parsed: ParsedMail = await simpleParser(rawInput);
        
        const toAddress = parsed.to ? (Array.isArray(parsed.to) ? parsed.to[0].value[0]?.address : parsed.to.value[0]?.address) : '';
        const fromItem = parsed.from?.value?.[0];
        const senderName = fixMojibake(fromItem?.name || decodeMimeHeader(parsed.from?.text || ''));
        const senderAddress = fromItem?.address || 'unknown@sender.com';
        const subject = fixMojibake(parsed.subject || 'ایمیل دریافتی جدید');
        const text = fixMojibake(parsed.text || '');
        let html = parsed.html ? fixMojibake(parsed.html) : (text ? `<div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 16px; white-space: pre-wrap;">${text.replace(/\n/g, '<br/>')}</div>` : '');

        // Resolve CID inline images inside HTML body and construct download URLs
        const unrenderedImages: Array<{ filename: string; dataUrl: string }> = [];

        const attachments = (parsed.attachments || []).map(att => {
          let downloadUrl: string | undefined = undefined;
          const isImage = (att.contentType && att.contentType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.filename || '');

          if (att.content && Buffer.isBuffer(att.content)) {
            const base64Data = att.content.toString('base64');
            const mimeType = att.contentType || 'image/png';
            downloadUrl = `data:${mimeType};base64,${base64Data}`;

            // Replace cid:image_id in HTML with base64 data URI
            let wasReplacedInHtml = false;
            if (att.cid && html) {
              const cleanCid = att.cid.replace(/[<>]/g, '').trim();
              if (cleanCid) {
                const cidRegex = new RegExp(`cid:${cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
                if (cidRegex.test(html)) {
                  html = html.replace(cidRegex, downloadUrl);
                  wasReplacedInHtml = true;
                }
              }
            }

            // If it is an image and was NOT replaced inside HTML, collect it to append to HTML gallery
            if (isImage && downloadUrl && !wasReplacedInHtml) {
              unrenderedImages.push({
                filename: fixMojibake(att.filename || 'تصویر پیوست شده'),
                dataUrl: downloadUrl
              });
            }
          }

          return {
            filename: fixMojibake(att.filename || 'attachment'),
            contentType: att.contentType || 'application/octet-stream',
            size: `${Math.round((att.size || 0) / 1024)} KB`,
            downloadUrl
          };
        });

        // If there are unrendered image attachments, embed an image gallery inside HTML body
        if (unrenderedImages.length > 0) {
          let galleryHtml = `<div style="margin-top: 24px; padding: 16px; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; direction: rtl; text-align: right;">`;
          galleryHtml += `<div style="font-weight: 800; font-size: 13px; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">🖼️ تصاویر پیوست‌شده پیام (${unrenderedImages.length} تصویر):</div>`;
          galleryHtml += `<div style="display: flex; flex-direction: column; gap: 16px;">`;
          for (const img of unrenderedImages) {
            galleryHtml += `
              <div style="border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; background: #ffffff; padding: 8px;">
                <img src="${img.dataUrl}" alt="${escapeHtml(img.filename)}" style="max-width: 100%; height: auto; display: block; border-radius: 6px; margin: 0 auto 8px auto;" />
                <div style="font-size: 11px; color: #64748b; text-align: center; font-weight: 600;">${escapeHtml(img.filename)}</div>
              </div>
            `;
          }
          galleryHtml += `</div></div>`;
          html += galleryHtml;
        }

        const headers: Record<string, string> = {};
        if (parsed.headers) {
          for (const [k, v] of parsed.headers) {
            headers[k] = typeof v === 'string' ? v : (typeof (v as any)?.text === 'string' ? (v as any).text : JSON.stringify(v));
          }
        }

        return {
          to: toAddress || '',
          from: { name: senderName || senderAddress.split('@')[0], address: senderAddress },
          subject: subject || 'ایمیل جدید',
          text,
          html,
          attachments,
          headers,
        };
      } catch (parserErr) {
        console.warn('[MimeDecoder] simpleParser error:', parserErr);
      }
    }
  }

  // Case 2: Structured JSON or Webhook Payload (SendGrid, Mailgun, Cloudflare, Webhook)
  const body = typeof rawInput === 'object' && rawInput !== null ? rawInput : {};

  let toRaw = body.to || body.recipient || body['envelope[to]'] || '';
  let fromRaw = body.from || body.sender || body['envelope[from]'] || 'unknown@sender.com';
  let subjectRaw = body.subject || 'ایمیل دریافتی جدید';
  let textRaw = body.text || body['body-plain'] || body.bodyText || '';
  let htmlRaw = body.html || body['body-html'] || body.bodyHtml || '';

  // If raw email stream is embedded in JSON
  const nestedRaw = body.raw || body['body-mime'] || body.email;
  if (typeof nestedRaw === 'string' && (nestedRaw.includes('From:') || nestedRaw.includes('Subject:') || nestedRaw.includes('Content-Type:'))) {
    try {
      return await parseInboundEmail(nestedRaw);
    } catch {
      // continue fallback
    }
  }

  // Clean and decode To
  let toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw.toString();
  const toMatch = toAddress.match(/<([^>]+)>/) || toAddress.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (toMatch) toAddress = toMatch[1];
  toAddress = toAddress.toLowerCase().trim();

  // Clean and decode From
  let senderAddress = typeof fromRaw === 'string' ? fromRaw : ((fromRaw as any)?.address || 'unknown@sender.com');
  const fromMatch = senderAddress.match(/<([^>]+)>/);
  if (fromMatch) senderAddress = fromMatch[1];
  let senderName = typeof fromRaw === 'object' && (fromRaw as any)?.name ? (fromRaw as any).name : (typeof fromRaw === 'string' && fromRaw.includes('<') ? fromRaw.split('<')[0].trim() : senderAddress.split('@')[0]);

  senderName = fixMojibake(decodeMimeHeader(senderName));
  const subject = fixMojibake(decodeMimeHeader(subjectRaw));
  const text = fixMojibake(decodeQuotedPrintable(textRaw));
  let html = fixMojibake(decodeQuotedPrintable(htmlRaw));

  if (!html && text) {
    html = `<div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 16px; white-space: pre-wrap;">${text.replace(/\n/g, '<br/>')}</div>`;
  }

  return {
    to: toAddress,
    from: { name: senderName || senderAddress, address: senderAddress },
    subject: subject || 'ایمیل جدید',
    text,
    html,
  };
}
