// Tests for tools/apply-canonical-copy.mjs against the REAL sources: the
// generated terms in this repo and ~/Projects/soma-lexicon/SOMA-LEXICON.md.
// Page text and parent tags below are what the built dictionary page shows.
//
//   npm test
//
// SOMA-LEXICON.md lives outside this repo. Where it is missing, the lexicon
// cases are reported as skipped, not passed.
//
// If ingest regenerates one of these entries with different words, update the
// case from the page, not the other way round.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { planRows, lexiconEntry, LEXICON, DEFAULT_LEXICON } from '../tools/apply-canonical-copy.mjs';
import { generatedTermFile } from '../netlify/functions/copy-canonize.mjs';

const HAVE = existsSync(DEFAULT_LEXICON);
const skip = HAVE ? false : 'SOMA-LEXICON.md is not on this machine';
const lexicon = HAVE ? readFileSync(DEFAULT_LEXICON, 'utf8') : '';
const read = (p) => {
  if (p === LEXICON) return lexicon;
  const url = new URL(`../${p}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
let seq = 0;
const row = (slug, original_text, new_text, element_tag, extra = {}) => ({
  id: `t${++seq}`, route: '/dictionary/', original_text, new_text, occurrence: 0, element_tag,
  element_path: `article#term-${slug}`, status: 'canonical',
  canonical_at: `2026-09-16T00:00:${String(seq).padStart(2, '0')}Z`, created_at: '2026-09-16T00:00:00Z', ...extra,
});
const one = (r) => {
  const out = planRows([r], read);
  const file = (p) => out.files.find((f) => f.path === p)?.content;
  return { ...out.results[0], lexicon: file(LEXICON), generated: file(generatedTermFile(r.element_path.slice(13))) };
};
const entryText = (text, slug) => {
  const e = lexiconEntry(text, slug);
  return text.slice(e.start, Math.max(...e.regions.map((r) => r.end)));
};

test('the entry is found by slug, with its fields; "See also" is not one of them', { skip }, () => {
  const e = lexiconEntry(lexicon, 'three-trees-one-greenhouse');
  const fields = e.regions.map((r) => r.field);
  assert.deepEqual([...new Set(fields)], ['title', 'subtitle', 'body', 'origin']);
  const origin = e.regions.find((r) => r.field === 'origin');
  assert.equal(lexicon.slice(origin.start, origin.end), 'Coined by James, adopted by Mike as a SOMA frame.');
  assert.ok(!e.regions.some((r) => lexicon.slice(r.start, r.end).includes('*See also:*')));
});

test('an edit lands in its own entry, not in another entry with the same words', { skip }, () => {
  // "What we mean." opens nearly every entry.
  const r = one(row('the-greenhouse', 'What we mean.', 'What we mean, exactly.', 'strong'));
  assert.ok(r.ok, r.reason);
  assert.match(entryText(r.lexicon, 'the-greenhouse'), /^\*\*What we mean, exactly\.\*\*/m);
  assert.equal(entryText(r.lexicon, 'three-trees-one-greenhouse'), entryText(lexicon, 'three-trees-one-greenhouse'));
  assert.match(r.generated, /<strong>What we mean, exactly\.<\/strong>/);
});

test('text next to a link ingest inserted matches the unlinked lexicon sentence', { skip }, () => {
  // page: "The second half of \"" <a>three trees, one greenhouse</a> ",\" used on its own. …"
  const onPage = ',"' + ' used on its own. When Mike calls something "part of the greenhouse," he means it belongs to the shared support layer — the tooling and scaffolding everyone draws on — rather than to any single person\'s project. Not a literal place.';
  const r = one(row('the-greenhouse', onPage, ',"' + ' used on its own. Not a literal place.', 'p'));
  assert.ok(r.ok, r.reason);
  assert.match(entryText(r.lexicon, 'the-greenhouse'), /one greenhouse," used on its own\. Not a literal place\./);
  assert.match(r.generated, /one greenhouse<\/a>," used on its own\. Not a literal place\.<\/p>/);
});

test('an origin edit rewrites the *Origin.* line and every copy ingest keeps of it', { skip }, () => {
  const r = one(row('three-trees-one-greenhouse', 'Coined by James, adopted by Mike as a SOMA frame.', 'Coined by James & adopted by Mike.', 'span'));
  assert.ok(r.ok, r.reason);
  assert.match(r.lexicon, /^\*Origin\.\* Coined by James & adopted by Mike\.$/m);
  // ingest copies the origin into origin_html unescaped, and into origin and source
  assert.match(r.generated, /^origin_html: "Coined by James & adopted by Mike\."$/m);
  assert.match(r.generated, /^origin: "Coined by James & adopted by Mike\."$/m);
  assert.match(r.generated, /^source: "Coined by James & adopted by Mike\."$/m);
});

test('a subtitle edit rewrites the header after the middot', { skip }, () => {
  const r = one(row('three-trees-one-greenhouse', 'separate projects, one shared support structure', 'separate projects, one shared structure', 'p'));
  assert.ok(r.ok, r.reason);
  assert.match(r.lexicon, /^### three trees, one greenhouse · separate projects, one shared structure$/m);
});

test('a title edit is placed only if the slug stays the same', { skip }, () => {
  const ok = one(row('the-greenhouse', 'the greenhouse', 'The Greenhouse', 'h2'));
  assert.ok(ok.ok, ok.reason);
  assert.match(ok.lexicon, /^### The Greenhouse · the shared infrastructure held in common$/m);

  const renamed = one(row('the-greenhouse', 'the greenhouse', 'the glasshouse', 'h2'));
  assert.equal(renamed.ok, false);
  assert.match(renamed.reason, /changes-the-slug/);
});

test('refused, with a reason: a theme, the default origin, ambiguity, markup characters', { skip }, () => {
  const theme = one(row('click-path', 'Rituals & Shorthand', 'Rituals', 'span'));
  assert.match(theme.reason, /lexicon-section-heading/);

  const defaultOrigin = one(row('the-greenhouse', 'Internal SOMA canon — working dialect, unpublished (SOMA Lexicon, 2026-07-24).', 'Mike, 2026.', 'span'));
  assert.match(defaultOrigin.reason, /no-Origin-line/);

  const dot = one(row('click-path', '.', '!', 'p'));   // the entry's body has "." twice as a whole run
  assert.match(dot.reason, /ambiguous/);

  const star = one(row('click-path', 'A delivery standard. A deliverable isn\'t done when the file exists; it\'s done when Mike\'s next step is', 'A *delivery* standard.', 'p'));
  assert.match(star.reason, /asterisk/);

  const angle = one(row('three-trees-one-greenhouse', 'Coined by James, adopted by Mike as a SOMA frame.', 'Coined by <James>.', 'span'));
  assert.match(angle.reason, /markup/);

  for (const r of [theme, defaultOrigin, dot, star, angle]) assert.equal(r.ok, false);
});

test('rows apply in canonical order: an undo saved first but made canonical later lands after its edit', { skip }, () => {
  const slug = 'arr-darr';
  const was = 'meaningful dollar figure — could be $10K, could be $1M. The insight it encodes is that leverage lives in';
  // Ends in "&". Body text is written as "&amp;", so the undo must match the
  // page's "&" against the file's "&amp;" at the very end of the text.
  const now = 'meaningful dollar figure, $10K to $1M. Leverage lives in &';
  const edit = row(slug, was, now, 'p', { canonical_at: '2026-09-16T10:00:00Z', created_at: '2026-09-16T10:00:00Z' });
  const undo = row(slug, now, was, 'p', { canonical_at: '2026-09-16T11:00:00Z', created_at: '2026-09-16T09:00:00Z' });
  const out = planRows([undo, edit], read);
  assert.deepEqual(out.results.map((r) => r.row.id), [edit.id, undo.id]);
  assert.ok(out.results.every((r) => r.ok), out.results.map((r) => r.reason).join(' | '));
  const file = (p) => out.files.find((f) => f.path === p)?.content;
  assert.equal(file(LEXICON), lexicon);
  assert.equal(file(generatedTermFile(slug)), read(generatedTermFile(slug)));
});
