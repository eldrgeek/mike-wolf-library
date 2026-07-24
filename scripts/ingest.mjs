#!/usr/bin/env node
/**
 * Mike Wolf — Library ingest adapter.
 *
 * Converts each on-disk source format into the engine's content-collection
 * format:
 *   - src/content/terms/<slug>.md    (dictionary entries; HTML body + frontmatter)
 *   - src/content/sources/<slug>.md  (long-form corpus; markdown body + frontmatter)
 *
 * Design: one parser function per source TYPE. To extend for Phase 2 (e.g.
 * scraping the 717-post 70YearsWTF Substack archive), add a new parser that
 * emits `writeSource(...)` records — nothing else changes. Cross-references
 * (term<->term via "see also", term->source via mention-matching) are wired
 * automatically at the end, so new sources light up existing terms for free.
 *
 * Idempotent: wipes and rewrites both collections each run.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const HOME = process.env.HOME;
const ROOT = new URL('..', import.meta.url).pathname;
const TERMS_DIR = join(ROOT, 'src/content/terms');
const SOURCES_DIR = join(ROOT, 'src/content/sources');

// ── Source paths (verify-as-you-go: all confirmed on disk 2026-07-24) ─────────
const P = {
  lexicon: join(HOME, 'Projects/soma-lexicon/SOMA-LEXICON.md'),
  srmw: join(HOME, 'Projects/SOMA/canon/srmw/SRMW.txt'),
  manifesto: join(HOME, 'Projects/SOMA/canon/silicon-children-manifesto.md'),
  seventy: join(HOME, 'Projects/SOMA/canon/70yearswtf'),
  seventyDraft: join(HOME, 'Projects/yeshie/70yearswtf-writing-for-llms.md'),
  // Full 70YearsWTF Substack archive, fetched by scripts/fetch-70yt.mjs.
  // These files are named `70yearswtf-<postslug>.md` and are the canonical
  // on-disk copy (bodies are NOT re-fetched during ingest — avoids Substack 429s).
  seventyArchive: join(ROOT, 'content-cache/70yt'),
  aiwtfPosts: join(HOME, 'Projects/SOMA/aiwtf/posts'),
  aiwtfDrafts: join(HOME, 'Projects/SOMA/aiwtf/drafts'),
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function yamlEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
}

function fm(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${k}: []`); continue; }
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${yamlEscape(item)}"`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: "${yamlEscape(v)}"`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// Parse frontmatter + body from an existing .md file (simple YAML scalars/arrays).
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  const fmText = m[1];
  const re = /^([a-zA-Z0-9_-]+):\s*(.*)$/gm;
  let mm;
  while ((mm = re.exec(fmText)) !== null) {
    let val = mm[2].trim().replace(/^["']|["']$/g, '');
    data[mm[1]] = val;
  }
  return { data, body: m[2].trim() };
}

// Minimal, safe markdown-inline → HTML for term definition bodies.
function mdInline(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function mdBlockToHtml(md) {
  const paras = md.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return paras.map(p => `<p>${mdInline(p.replace(/\n/g, ' '))}</p>`).join('\n');
}

function firstSentences(text, max = 240) {
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function wordCount(text) {
  return (text.replace(/<[^>]+>/g, ' ').match(/\b\w+\b/g) || []).length;
}

// ── Collectors ────────────────────────────────────────────────────────────────
const termRecords = [];   // { slug, letter, title, subtitle, theme, origin, source, related(names), tags, bodyHtml, bodyText }
const sourceRecords = []; // { slug, title, subtitle, collection, kind, order, date, author, original_url, tags, bodyMd, bodyText }

// ══════════════════════════════════════════════════════════════════════════════
// PARSER 1 — SOMA Lexicon → terms
// ══════════════════════════════════════════════════════════════════════════════
function parseLexicon() {
  const text = readFileSync(P.lexicon, 'utf8');
  const lines = text.split('\n');
  let theme = '';
  let i = 0;
  // Skip preamble until first "## " theme.
  const entries = [];
  let cur = null;

  for (const line of lines) {
    const themeM = line.match(/^##\s+(?:[IVXLC]+\.\s+)?(.+)$/);
    const entryM = line.match(/^###\s+(.+)$/);
    if (themeM && !entryM) {
      theme = themeM[1].trim();
      continue;
    }
    if (entryM) {
      if (cur) entries.push(cur);
      const header = entryM[1].trim();
      // Split "term · gloss" (middot separator)
      const parts = header.split(/\s+·\s+/);
      const rawTitle = parts[0].trim();
      const subtitle = parts.slice(1).join(' · ').trim();
      cur = { theme, rawTitle, subtitle, bodyLines: [] };
      continue;
    }
    if (cur) {
      if (/^---\s*$/.test(line)) continue; // section rules
      cur.bodyLines.push(line);
    }
  }
  if (cur) entries.push(cur);

  for (const e of entries) {
    let body = e.bodyLines.join('\n').trim();
    // Extract "*Origin.* ..." and "*See also:* ..." meta lines out of the body.
    let origin = '';
    const relatedNames = [];

    body = body.replace(/^\*Origin\.\*\s*(.+)$/gim, (_m, g) => { origin = g.trim(); return ''; });
    body = body.replace(/^\*See also:\*\s*(.+)$/gim, (_m, g) => {
      g.split(/[,;]/).forEach(n => {
        const name = n.replace(/[."']+$/g, '').trim();
        if (name) relatedNames.push(name);
      });
      return '';
    });
    body = body.replace(/\n{3,}/g, '\n\n').trim();

    const title = e.rawTitle.replace(/^"|"$/g, '');
    const slug = slugify(title);
    if (!slug) continue;
    const letter = (title.replace(/^["'“”]+/, '')[0] || '#').toUpperCase();
    const bodyHtml = mdBlockToHtml(body);
    const bodyText = body.replace(/[#*_>`]/g, ' ');

    // crude tag inference from theme
    const themeTag = e.theme.split(/[&,]/)[0].trim().toLowerCase();

    termRecords.push({
      slug,
      letter: /[A-Z]/.test(letter) ? letter : '#',
      title,
      subtitle: e.subtitle,
      theme: e.theme,
      origin,
      relatedNames,
      tags: [themeTag].filter(Boolean),
      bodyHtml,
      bodyText,
    });
  }
  console.log(`  Lexicon → ${termRecords.length} terms`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PARSER 2 — SRMW book → sources (one per chapter/part)
// ══════════════════════════════════════════════════════════════════════════════
function parseSRMW() {
  const raw = readFileSync(P.srmw, 'utf8');
  // Strip page markers and bare page-number lines.
  const cleaned = raw
    .split('\n')
    .filter(l => !/^\[PAGE\s+\d+\]\s*$/.test(l))
    .filter(l => !/^\s*[ivxlcdm]{0,7}\d{0,4}\s*$/i.test(l) || l.trim().length > 4)
    .join('\n');

  const lines = cleaned.split('\n');
  // A heading is a real chapter/part line (NOT a table-of-contents dotted leader).
  const isHeading = (l) =>
    (/^(Chapter\s+\d+:|Part\s+[IVXLC]+:)/.test(l.trim()) && !/\.{5,}/.test(l) && !/\d+\s*$/.test(l.replace(/^(Chapter\s+\d+|Part\s+[IVXLC]+):?/, '')));

  // Find heading indices; but skip the TOC block (dotted leaders). Real headings
  // start after the TOC. We detect: a heading whose next non-empty line is prose.
  const chunks = [];
  let curHead = 'Front Matter';
  let curPart = '';
  let curLines = [];
  let started = false;

  for (const line of lines) {
    const t = line.trim();
    const partM = t.match(/^(Part\s+[IVXLC]+:\s*.+)$/);
    const chapM = t.match(/^(Chapter\s+\d+:\s*.+)$/);
    const isTOC = /\.{5,}/.test(t) || /\d+\s*$/.test(t) && t.length < 90 && /\.{3,}/.test(t);

    if ((partM || chapM) && !isTOC) {
      // flush previous
      if (curLines.join('').trim().length > 400) {
        chunks.push({ head: curHead, part: curPart, text: curLines.join('\n').trim() });
      }
      if (partM) { curPart = partM[1].trim(); curHead = partM[1].trim(); }
      else { curHead = chapM[1].trim(); }
      curLines = [];
      started = true;
      continue;
    }
    if (started) curLines.push(line);
  }
  if (curLines.join('').trim().length > 400) {
    chunks.push({ head: curHead, part: curPart, text: curLines.join('\n').trim() });
  }

  let order = 0;
  for (const c of chunks) {
    order++;
    const title = c.head;
    const slug = 'srmw-' + slugify(title);
    const bodyMd = c.text.replace(/\n{3,}/g, '\n\n');
    sourceRecords.push({
      slug,
      title,
      subtitle: c.part && c.part !== title ? c.part : '',
      collection: 'SRMW',
      kind: 'book-section',
      order,
      date: '2012',
      author: 'Mike Wolf',
      original_url: null,
      tags: ['SRMW', 'metanovel', 'writing'],
      bodyMd,
      bodyText: bodyMd,
    });
  }
  console.log(`  SRMW → ${chunks.length} sections`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PARSER 3 — pre-frontmattered markdown posts (70yt, AI WTF, manifesto)
// Generic: reads a .md with YAML frontmatter, maps to a source record.
// ══════════════════════════════════════════════════════════════════════════════
function ingestMdFile(path, { collection, kind, defaultDate = null, slugOverride = null }) {
  const raw = readFileSync(path, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const fname = basename(path).replace(/\.md$/, '');
  const title = data.title || fname.replace(/-/g, ' ');
  // slugOverride lets callers keep an already-prefixed filename (e.g. the
  // 70YearsWTF archive files, named `70yearswtf-<slug>.md`) as the record slug,
  // avoiding a doubled `70yearswtf-70yearswtf-` prefix.
  const slug = slugOverride || slugify(collection) + '-' + slugify(data.slug || fname);
  // Strip a leading H1 that duplicates the title, and the boilerplate meta lines.
  let md = body
    .replace(/^#\s+.+\n+/, '')
    .replace(/^\*\*Original URL:\*\*.*$/gim, '')
    .replace(/^\*\*Published:\*\*.*$/gim, '')
    .trim();
  return {
    slug,
    title,
    subtitle: data.subtitle || '',
    collection,
    kind,
    order: 0,
    date: data.date || defaultDate,
    author: data.author || 'Mike Wolf',
    original_url: data.url || data.original_url || null,
    tags: parseTags(data.tags, collection),
    bodyMd: md,
    bodyText: md,
  };
}

function parseTags(t, collection) {
  const base = [collection];
  if (!t) return base;
  if (Array.isArray(t)) return [...base, ...t];
  const cleaned = String(t).replace(/^\[|\]$/g, '');
  return [...base, ...cleaned.split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)];
}

function parse70yt() {
  let n = 0;
  for (const f of readdirSync(P.seventy)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    sourceRecords.push(ingestMdFile(join(P.seventy, f), {
      collection: '70YearsWTF', kind: 'post', defaultDate: null,
    }));
    n++;
  }
  if (existsSync(P.seventyDraft)) {
    // loose draft without frontmatter — synthesize
    const raw = readFileSync(P.seventyDraft, 'utf8');
    const titleM = raw.match(/^#\s+(.+)$/m);
    const title = titleM ? titleM[1].trim() : 'Writing for LLMs';
    const md = raw.replace(/^#\s+.+\n+/, '').trim();
    sourceRecords.push({
      slug: '70yearswtf-' + slugify(title), title, subtitle: '',
      collection: '70YearsWTF', kind: 'draft', order: 0, date: '2026',
      author: 'Mike Wolf', original_url: null, tags: ['70YearsWTF', 'draft', 'AI'],
      bodyMd: md, bodyText: md,
    });
    n++;
  }
  console.log(`  70YearsWTF → ${n} posts`);
}

// Full 70YearsWTF archive (688+ posts) fetched to content-cache/70yt/.
// Read them as canonical source-of-truth; dedupe by slug against the curated
// posts already pushed by parse70yt() (curated wins on conflict).
function parse70ytArchive() {
  if (!existsSync(P.seventyArchive)) { console.log('  70YearsWTF archive → (cache missing, skipped)'); return; }
  const seen = new Set(sourceRecords.map(r => r.slug));
  let n = 0, dupes = 0;
  for (const f of readdirSync(P.seventyArchive)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const fname = f.replace(/\.md$/, '');            // already `70yearswtf-<postslug>`
    if (seen.has(fname)) { dupes++; continue; }
    sourceRecords.push(ingestMdFile(join(P.seventyArchive, f), {
      collection: '70YearsWTF', kind: 'post', defaultDate: null, slugOverride: fname,
    }));
    seen.add(fname);
    n++;
  }
  console.log(`  70YearsWTF archive → ${n} posts (${dupes} dupes skipped)`);
}

function parseAIWTF() {
  let n = 0;
  for (const dir of [P.aiwtfPosts, P.aiwtfDrafts]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const isDraft = dir === P.aiwtfDrafts;
      sourceRecords.push(ingestMdFile(join(dir, f), {
        collection: 'AI WTF', kind: isDraft ? 'draft' : 'post',
      }));
      n++;
    }
  }
  console.log(`  AI WTF → ${n} pieces`);
}

function parseSiliconChildren() {
  let n = 0;
  if (existsSync(P.manifesto)) {
    sourceRecords.push(ingestMdFile(P.manifesto, {
      collection: 'Silicon Children', kind: 'manifesto', defaultDate: '2026',
    }));
    n++;
  }
  // The two canonical 70yt silicon-children posts double as Silicon Children canon,
  // but they are already ingested under 70YearsWTF; we cross-reference them instead
  // of duplicating. (Astro-page essay extraction deferred — see report.)
  console.log(`  Silicon Children → ${n} manifesto`);
}

// ══════════════════════════════════════════════════════════════════════════════
// CROSS-REFERENCES
// ══════════════════════════════════════════════════════════════════════════════
function wireCrossRefs() {
  const termSlugSet = new Set(termRecords.map(t => t.slug));
  const titleToSlug = new Map(termRecords.map(t => [t.title.toLowerCase(), t.slug]));

  // term <-> term via "See also" names
  for (const t of termRecords) {
    t.related = [];
    for (const name of t.relatedNames) {
      const s = slugify(name);
      if (termSlugSet.has(s) && s !== t.slug) { t.related.push(s); continue; }
      const byTitle = titleToSlug.get(name.toLowerCase());
      if (byTitle && byTitle !== t.slug) t.related.push(byTitle);
    }
    t.related = [...new Set(t.related)];
  }

  // term -> source provenance: a term is "discussed" in a source if the source
  // body mentions the term title as a whole phrase (word-boundary, case-insensitive).
  // Also builds the reverse: source.relatedTerms.
  for (const s of sourceRecords) s.relatedTerms = [];
  for (const t of termRecords) {
    t.provenance = [];
    if (t.title.length < 4) continue; // skip too-generic short titles
    const needle = t.title.toLowerCase().replace(/^["'“”]+|["'“”]+$/g, '');
    // avoid extremely common words masquerading as terms
    const re = new RegExp('\\b' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    for (const s of sourceRecords) {
      if (re.test(s.bodyText)) {
        t.provenance.push(s.slug);
        s.relatedTerms.push(t.slug);
      }
    }
  }

  // source <-> source relatedness via shared collection + shared term mentions
  for (const s of sourceRecords) {
    const mine = new Set(s.relatedTerms);
    const scored = sourceRecords
      .filter(o => o.slug !== s.slug)
      .map(o => ({ slug: o.slug, shared: o.relatedTerms.filter(x => mine.has(x)).length, sameCol: o.collection === s.collection }))
      .filter(o => o.shared > 0 || o.sameCol)
      .sort((a, b) => (b.shared - a.shared) || (Number(b.sameCol) - Number(a.sameCol)))
      .slice(0, 5);
    s.related = scored.map(o => o.slug);
  }

  const provCount = termRecords.reduce((a, t) => a + t.provenance.length, 0);
  console.log(`  Cross-refs → ${termRecords.reduce((a, t) => a + t.related.length, 0)} term links, ${provCount} term→source citations`);
}

// ══════════════════════════════════════════════════════════════════════════════
// WRITE
// ══════════════════════════════════════════════════════════════════════════════
function resetDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function writeAll() {
  resetDir(TERMS_DIR);
  resetDir(SOURCES_DIR);

  for (const t of termRecords) {
    const front = fm({
      letter: t.letter,
      title: t.title,
      subtitle: t.subtitle || undefined,
      theme: t.theme || undefined,
      authored_by: 'Mike Wolf & the SOMA fleet',
      origin: t.origin || undefined,
      source: t.origin || '',
      related: t.related || [],
      provenance: t.provenance || [],
      tags: t.tags || [],
    });
    writeFileSync(join(TERMS_DIR, `${t.slug}.md`), `${front}\n\n${t.bodyHtml}\n`);
  }

  for (const s of sourceRecords) {
    const front = fm({
      title: s.title,
      subtitle: s.subtitle || undefined,
      collection: s.collection,
      kind: s.kind,
      order: s.order || 0,
      date: s.date || undefined,
      author: s.author,
      original_url: s.original_url || undefined,
      excerpt: firstSentences(s.bodyText),
      word_count: wordCount(s.bodyText),
      tags: s.tags || [],
      related: s.related || [],
    });
    writeFileSync(join(SOURCES_DIR, `${s.slug}.md`), `${front}\n\n${s.bodyMd}\n`);
  }

  console.log(`\nWrote ${termRecords.length} terms → src/content/terms/`);
  console.log(`Wrote ${sourceRecords.length} sources → src/content/sources/`);
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log('Ingesting Mike Wolf Library corpus…\n');
parseLexicon();
parseSRMW();
parse70yt();
parse70ytArchive();
parseAIWTF();
parseSiliconChildren();
wireCrossRefs();
writeAll();
console.log('\nDone.');
