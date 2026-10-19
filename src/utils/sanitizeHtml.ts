import DOMPurify from 'dompurify';

/**
 * Standard DOMPurify configuration for email HTML rendering.
 * Safely preserves images with data: URIs (base64 inline photos), cid: URIs, http/https URLs, styled tables, and responsive elements.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ADD_TAGS: [
      'style', 'center', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 
      'span', 'p', 'div', 'b', 'strong', 'i', 'em', 'a', 'h1', 'h2', 'h3', 'h4', 
      'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'hr', 'img', 
      'br', 'font', 'small', 'sub', 'sup', 'figure', 'figcaption'
    ],
    ADD_ATTR: [
      'target', 'style', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 
      'width', 'height', 'align', 'valign', 'dir', 'src', 'alt', 'title', 
      'class', 'href', 'color', 'size', 'face', 'srcset', 'loading'
    ],
    FORCE_BODY: true,
  });
}
