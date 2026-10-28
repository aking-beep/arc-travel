/**
 * The readout.
 *
 * A standalone HTML file, because the person who wants this is deciding whether
 * the product is ready and not reading a terminal. Grouped by persona, because
 * "what breaks for a partner" is a different decision from "what breaks for a
 * guest", and sorted so the blockers are first.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Finding, PersonaResult, Severity } from './agent.js'

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, info: 3 }

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function writeReport(outDir: string, baseUrl: string, results: PersonaResult[]): Promise<string> {
  const all = results.flatMap((r) => r.findings)
  const broken = all.filter((f) => f.status === 'fail' || f.status === 'error')
  const held = all.filter((f) => f.status === 'pass')
  const skipped = all.filter((f) => f.status === 'skipped')
  const blockers = broken.filter((f) => f.severity === 'blocker')
  const problems = results.flatMap((r) => r.problems)

  const row = (f: Finding): string => `
    <tr class="${f.status}">
      <td><span class="pill ${f.severity}">${f.severity}</span></td>
      <td><span class="pill ${f.status}">${f.status}</span></td>
      <td>
        <div class="expectation">${escape(f.expectation)}</div>
        <div class="meta">${escape(f.step)} · <code>${escape(f.id)}</code></div>
        ${f.evidence ? `<pre>${escape(f.evidence)}</pre>` : ''}
        ${f.url ? `<div class="meta url">${escape(f.url)}</div>` : ''}
      </td>
    </tr>`

  const personaSection = (r: PersonaResult): string => {
    const sorted = [...r.findings].sort(
      (a, b) =>
        (a.status === 'pass' ? 1 : 0) - (b.status === 'pass' ? 1 : 0) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    )
    const f = r.findings
    return `
    <section class="persona">
      <h2>${escape(r.name)}</h2>
      <p class="goal">${escape(r.goal)}</p>
      <p class="tally">
        <strong>${f.filter((x) => x.status === 'pass').length}</strong> held ·
        <strong>${f.filter((x) => x.status === 'fail' || x.status === 'error').length}</strong> did not ·
        <strong>${f.filter((x) => x.status === 'skipped').length}</strong> not reached
      </p>
      ${r.notes.length > 0 ? `<ul class="notes">${r.notes.map((n) => `<li>${escape(n)}</li>`).join('')}</ul>` : ''}
      <table><tbody>${sorted.map(row).join('')}</tbody></table>
    </section>`
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARC Stay pressure test</title>
<style>
  :root { --bg:#fbfaf7; --fg:#241f1a; --muted:#6b645c; --line:#e5e0d8; --blocker:#b3261e; --major:#a4610a; --minor:#5d6b5a; --pass:#1f6f4a; }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif }
  main { max-width:62rem; margin:0 auto; padding:2.5rem 1.25rem 6rem }
  h1 { font-size:1.9rem; margin:0 0 .25rem } h2 { font-size:1.2rem; margin:0 0 .25rem }
  .sub { color:var(--muted); margin:0 0 2rem }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.75rem; margin-bottom:2rem }
  .card { background:#fff; border:1px solid var(--line); border-radius:.75rem; padding:1rem }
  .card b { display:block; font-size:1.9rem; line-height:1.1; font-variant-numeric:tabular-nums }
  .card span { color:var(--muted); font-size:.82rem }
  .persona { background:#fff; border:1px solid var(--line); border-radius:.75rem; padding:1.25rem; margin-bottom:1.25rem }
  .goal, .tally { color:var(--muted); font-size:.9rem; margin:.25rem 0 }
  .notes { color:var(--muted); font-size:.86rem; margin:.5rem 0 0; padding-left:1.1rem }
  table { width:100%; border-collapse:collapse; margin-top:1rem }
  td { border-top:1px solid var(--line); padding:.6rem .5rem; vertical-align:top }
  td:first-child, td:nth-child(2) { width:5.5rem; white-space:nowrap }
  tr.pass .expectation { color:var(--muted) }
  .expectation { font-weight:500 }
  .meta { color:var(--muted); font-size:.78rem; margin-top:.15rem }
  .meta.url { word-break:break-all }
  code { font-size:.78rem } pre { background:#f4f1ea; border-radius:.4rem; padding:.5rem .6rem; margin:.4rem 0 0;
    font-size:.78rem; white-space:pre-wrap; word-break:break-word; max-height:12rem; overflow:auto }
  .pill { display:inline-block; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em;
    padding:.12rem .45rem; border-radius:.3rem; background:#f0ece4; color:var(--muted) }
  .pill.blocker { background:#fbe9e7; color:var(--blocker) } .pill.major { background:#fdf0e0; color:var(--major) }
  .pill.fail, .pill.error { background:#fbe9e7; color:var(--blocker) }
  .pill.pass { background:#e7f3ec; color:var(--pass) }
  .problems li { font-size:.84rem; color:var(--muted); word-break:break-all }
  footer { color:var(--muted); font-size:.82rem; margin-top:2rem }
</style></head><body><main>
  <h1>ARC Stay — simulated-user pressure test</h1>
  <p class="sub">${results.length} personas against <code>${escape(baseUrl)}</code> · ${escape(new Date().toISOString())}</p>

  <div class="cards">
    <div class="card"><b>${all.length}</b><span>expectations put to the product</span></div>
    <div class="card"><b>${held.length}</b><span>held</span></div>
    <div class="card"><b>${broken.length}</b><span>did not hold</span></div>
    <div class="card"><b>${blockers.length}</b><span>blockers</span></div>
    <div class="card"><b>${skipped.length}</b><span>not reached</span></div>
    <div class="card"><b>${problems.length}</b><span>console / network problems</span></div>
  </div>

  ${results.map(personaSection).join('')}

  ${
    problems.length > 0
      ? `<section class="persona"><h2>Console, network and 5xx</h2>
         <p class="goal">Caught by listeners rather than by an expectation — nobody was looking for these.</p>
         <ul class="problems">${problems
           .slice(0, 120)
           .map((p) => `<li><strong>${escape(p.persona)}</strong> · ${escape(p.kind)} · ${escape(p.detail)}</li>`)
           .join('')}</ul></section>`
      : ''
  }

  <footer>Every figure here comes from synthetic seeded data on a local instance. No card was charged,
  no partner was verified, and no message left the machine.</footer>
</main></body></html>`

  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, 'readout.html')
  await writeFile(file, html, 'utf8')
  return file
}
