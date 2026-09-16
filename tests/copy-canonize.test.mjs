// Matcher tests for netlify/functions/copy-canonize.mjs, run against the REAL
// sources in this repo (content-cache/terms-extra, src/content/terms, the
// .astro pages), not fixtures. Page text, parent tags and occurrence below are
// what the built dictionary page shows for these entries.
//
//   npm test
//
// SOMA/standards/soma-live-edit/ADOPT.md §5d, traps 1, 2 and 4. Trap 3 (one base
// sha, non-forced ref update) is GitHub API wiring and is proven end to end.
//
// If ingest regenerates one of these entries with different words, update the
// case from the page, not the other way round.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  planTerm, planSiteCopy, siteCopyFiles, upstreamTermFile, generatedTermFile,
} from '../netlify/functions/copy-canonize.mjs';

const read = (p) => {
  const url = new URL(`../${p}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
const term = (slug) => ({ upstream: read(upstreamTermFile(slug)), generated: read(generatedTermFile(slug)) });
const row = (original_text, new_text, element_tag, occurrence = 0) => ({ original_text, new_text, element_tag, occurrence });
const changed = (plan, prefix) => plan.changes.find((c) => c.path.startsWith(prefix))?.content;

test('trap 1: frontmatter that the page does not render as copy never matches', () => {
  // tags: ["SRMW", "philosophy"] render as chips, but they are data.
  const p = planTerm('100-recycled-words', term('100-recycled-words'), row('philosophy', 'TEST', 'span'));
  assert.equal(p.changes.length, 0);
  assert.equal(p.found, false);
});

test('trap 1: a "Discussed in:" link with the entry title does not rename the entry', () => {
  const files = term('actions-that-match-intentions');
  const link = planTerm('actions-that-match-intentions', files, row('Actions that match intentions', 'TEST', 'a'));
  assert.equal(link.changes.length, 0);

  const heading = planTerm('actions-that-match-intentions', files, row('Actions that match intentions', 'TEST', 'h2'));
  assert.equal(heading.changes.length, 2);
  for (const c of heading.changes) assert.match(c.content, /^title: "TEST"$/m);
  assert.equal(heading.retire, true);
});

test('trap 1: the same words in the body and the origin line are told apart by tag', () => {
  const files = term('actions-that-match-intentions');
  const origin = planTerm('actions-that-match-intentions', files, row('(title mine).', 'TEST.', 'span'));
  assert.equal(origin.changes.length, 2);
  const gen = changed(origin, 'src/');
  assert.match(gen, /^origin_html: ".*<\/a> TEST\."$/m);
  assert.match(gen, /\(title mine\)\.<\/p><\/blockquote>/);   // the body copy is untouched
  // the unrendered copies of the upstream origin follow it, as ingest would write them
  assert.match(gen, /^origin: "70yt \*actions-that-match-intentions\* TEST\."$/m);
  assert.match(gen, /^source: "70yt \*actions-that-match-intentions\* TEST\."$/m);
  assert.match(changed(origin, 'content-cache/'), /^origin: "70yt \*actions-that-match-intentions\* TEST\."$/m);
});

test('trap 1: two identical candidates inside one entry are refused, not guessed', () => {
  // The corpus link text is an <em> in both the body and the origin line.
  const p = planTerm('actions-that-match-intentions', term('actions-that-match-intentions'),
    row('actions-that-match-intentions', 'TEST', 'em'));
  assert.equal(p.changes.length, 0);
  assert.match(p.reason, /ambiguous:2-matches/);
});

test('trap 1: site copy is the layout plus the edited route\'s page, nothing else', () => {
  // "Dictionary" on / is a nav link built from an array in Base.astro's
  // frontmatter. dictionary/index.astro has a <p>Dictionary</p>, and it must not
  // be edited from the home page.
  const files = (route) => siteCopyFiles(route).map((p) => [p, read(p)]);
  const home = planSiteCopy(files('/'), { route: '/', ...row('Dictionary', 'TEST', 'a') });
  assert.equal(home.changes.length, 0);
});

test('trap 2: entities in the source match the characters on the page', () => {
  // &quot; and &gt; in the source; the page shows " and >.
  const text = '“For years I\'ve whined about the fact that "I don\'t do what I intend to do." > > At some point in a typical day, I might say to myself “Self, here’s what I intend to do.” Later, I…” — 70yt';
  const p = planTerm('actions-that-match-intentions', term('actions-that-match-intentions'), row(text, 'Quote & <b>TEST</b> — 70yt', 'p'));
  assert.equal(p.changes.length, 2);
  assert.equal(p.retire, true);
  // Upstream has "— 70yt *actions-that-match-intentions*", generated has "— 70yt <a …>":
  // the match ends at the asterisk upstream and at the link on the page.
  assert.match(changed(p, 'content-cache/'), /<p>Quote &amp; &lt;b&gt;TEST&lt;\/b&gt; — 70yt \*actions-that-match-intentions\* \(title mine\)\.<\/p>/);
  assert.match(changed(p, 'src/'), /<p>Quote &amp; &lt;b&gt;TEST&lt;\/b&gt; — 70yt <a href="\/corpus\//);
});

test('trap 2: a quote escaped in YAML matches the quote on the page, in either quoting style', () => {
  // upstream: title: '"Self"-promotion'   generated: title: "\"Self\"-promotion"
  const p = planTerm('self-promotion-scare-quotes', term('self-promotion-scare-quotes'), row('"Self"-promotion', '"Self"-promotion, TEST', 'h2'));
  assert.equal(p.changes.length, 2);
  // each layer keeps its own quoting style
  assert.match(changed(p, 'content-cache/'), /^title: '"Self"-promotion, TEST'$/m);
  assert.match(changed(p, 'src/'), /^title: "\\"Self\\"-promotion, TEST"$/m);
});

test('layers: text split by a link ingest inserted is one sentence upstream', () => {
  const files = term('100-recycled-words');
  // page: "…recombination. " <a>Bathos</a> "-adjacent loft+trash."   upstream: "…recombination. Bathos-adjacent loft+trash."
  const before = planTerm('100-recycled-words', files, row('Front-matter gag that is also poetics: language is compost; originality is recombination.', 'TEST.', 'p'));
  assert.match(changed(before, 'content-cache/'), /<\/strong> TEST\. Bathos-adjacent loft\+trash\.<\/p>/);
  assert.match(changed(before, 'src/'), /<\/strong> TEST\. <a href="#term-bathos" class="term-xref">Bathos<\/a>-adjacent/);

  const link = planTerm('100-recycled-words', files, row('Bathos', 'Pathos', 'a'));
  assert.match(changed(link, 'content-cache/'), /recombination\. Pathos-adjacent/);
  assert.match(changed(link, 'src/'), /class="term-xref">Pathos<\/a>-adjacent/);

  const after = planTerm('100-recycled-words', files, row('-adjacent loft+trash.', '-adjacent TEST.', 'p'));
  assert.match(changed(after, 'content-cache/'), /Bathos-adjacent TEST\.<\/p>/);
});

test('layers: both are patched, or neither', () => {
  const files = term('100-recycled-words');
  const drifted = { ...files, upstream: files.upstream.replace('language is compost', 'language is mulch') };
  const p = planTerm('100-recycled-words', drifted, row('Front-matter gag that is also poetics: language is compost; originality is recombination.', 'TEST.', 'p'));
  assert.equal(p.changes.length, 0);
  assert.match(p.reason, /^pending:.*content-cache\/terms-extra\/100-recycled-words\.md:no-match/);
});

test('layers: a lexicon term patches the page and stays canonical for the local tool', () => {
  const slug = 'afk-taxonomy-atk-afk-ok-afk-dnba-afk-dnd-asleep';
  const files = term(slug);
  assert.equal(files.upstream, null);
  const p = planTerm(slug, files, row("Mike's ladder of how interruptible he is, so the AI knows whether it may reach him.", 'TEST.', 'p'));
  assert.deepEqual(p.changes.map((c) => c.path), [generatedTermFile(slug)]);
  assert.equal(p.retire, false);
  assert.equal(p.reason, 'upstream-out-of-repo:soma-lexicon');
});

test('trap 4: edit, undo, and a retry of the undo', () => {
  const slug = '100-recycled-words';
  const was = 'mock-eco claim: book made only of words already used';
  const now = 'mock-eco claim: a book made only of words already used';
  const apply = (files, plan) => ({
    upstream: changed(plan, 'content-cache/') ?? files.upstream,
    generated: changed(plan, 'src/') ?? files.generated,
  });

  const f0 = term(slug);
  const edit = planTerm(slug, f0, row(was, now, 'p'));
  assert.equal(edit.changes.length, 2);
  assert.equal(edit.retire, true);

  const f1 = apply(f0, edit);
  const undo = planTerm(slug, f1, row(now, was, 'p'));
  assert.equal(undo.changes.length, 2);
  const f2 = apply(f1, undo);
  assert.deepEqual(f2, f0);   // byte-for-byte back where it started

  // The admin clicks again after a lost response: the source already says it,
  // so nothing is committed and the row retires instead of staying "pending".
  const retry = planTerm(slug, f2, row(now, was, 'p'));
  assert.equal(retry.changes.length, 0);
  assert.equal(retry.retire, true);
  assert.equal(retry.found, true);
});
