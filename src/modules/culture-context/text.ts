/**
 * Third-party HTML to plain text.
 *
 * Source HTML is untrusted input and is never rendered. This turns it into
 * plain text that the UI renders as text (React escapes it).
 *
 * The original walked the HTML with a parser that kept the text of *every*
 * node, so `<p>Hi</p><script>alert(1)</script><style>p{}</style>` came out as
 * `"Hi alert(1) p{}"`. That was not an XSS hole, because it rendered as text,
 * but it did put script source and CSS in front of a guest, against the
 * source policy's "strip scripts/styles". Non-content elements are now removed
 * *with their contents* before any tag is stripped.
 */

/** Elements whose contents are never prose. Removed whole. */
const NON_CONTENT = ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg', 'head']

const NON_CONTENT_BLOCK = new RegExp(
  `<(${NON_CONTENT.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
  'gi',
)
/** An opening tag with no close swallows the rest: dropping too much beats leaking code. */
const NON_CONTENT_UNCLOSED = new RegExp(`<(${NON_CONTENT.join('|')})\\b[\\s\\S]*$`, 'i')

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  pound: '£',
  euro: '€',
  copy: '©',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

export function htmlToText(value: string | null | undefined): string {
  if (!value) return ''
  const text = value
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(NON_CONTENT_BLOCK, ' ')
    .replace(NON_CONTENT_UNCLOSED, ' ')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

/** Collapses whitespace and trims to `limit` characters on a word boundary. */
export function compact(value: string, limit = 900): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
