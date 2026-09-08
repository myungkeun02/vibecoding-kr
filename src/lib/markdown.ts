import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
export function markdown(s: string) {
  return sanitizeHtml(marked.parse(s, { async: false }) as string, {
    allowedTags: [
      'p',
      'br',
      'h2',
      'h3',
      'h4',
      'strong',
      'em',
      'del',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
      'img',
    ],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'], code: ['class'], img: ['src', 'alt'] },
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: { ...attrs, rel: 'nofollow ugc noopener', target: '_blank' },
      }),
    },
    exclusiveFilter: (f) => f.tag === 'img' && !(f.attribs.src || '').startsWith('/media/'),
  });
}
export function plainText(s: string) {
  return sanitizeHtml(marked.parse(s, { async: false }) as string, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}
