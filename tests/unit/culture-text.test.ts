import { describe, expect, it } from 'vitest'
import { compact, htmlToText } from '@/modules/culture-context/text'

/**
 * HTML to text.
 *
 * The first case is culture-context's confirmed defect, verbatim: the original
 * returned "Hi alert(1) p{}". Source HTML is untrusted input, and script and
 * style contents are not prose.
 */
describe('htmlToText strips scripts and styles', () => {
  it('drops <script> and <style> with their contents (the confirmed defect)', () => {
    expect(htmlToText('<p>Hi</p><script>alert(1)</script><style>p{}</style>')).toBe('Hi')
  })

  it('handles attributes, mixed case and multi-line bodies', () => {
    const html = `<P>Entry</P><SCRIPT type="text/javascript">
      var x = "<p>not prose</p>";
    </SCRIPT><style media="screen">.a { color: red }</style><p>rules</p>`
    expect(htmlToText(html)).toBe('Entry rules')
  })

  it('drops an unclosed script to the end rather than leaking it', () => {
    expect(htmlToText('<p>Safe text</p><script>steal()')).toBe('Safe text')
  })

  it('drops noscript, template, iframe, svg and comments', () => {
    expect(
      htmlToText(
        '<p>a</p><noscript>n</noscript><template>t</template><iframe>i</iframe><svg><text>s</text></svg><!-- c --><p>b</p>',
      ),
    ).toBe('a b')
  })

  it('decodes entities after stripping, so encoded markup stays inert text', () => {
    expect(htmlToText('<p>Fish &amp; chips &lt;script&gt; &#8217; &#x2014;</p>')).toBe(
      'Fish & chips <script> ’ —',
    )
  })

  it('collapses whitespace and returns empty for empty input', () => {
    expect(htmlToText('<p>  a \n\n b </p>')).toBe('a b')
    expect(htmlToText('')).toBe('')
    expect(htmlToText(null)).toBe('')
  })
})

describe('compact', () => {
  it('leaves short text alone', () => {
    expect(compact('short text')).toBe('short text')
  })

  it('trims long text on a word boundary with an ellipsis', () => {
    const out = compact('word '.repeat(400), 50)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/wor…$/)
  })
})
