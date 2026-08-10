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
  // Extra dictionary terms extracted from Mike's writing (SRMW, Wall, 70yt, chats),
  // pre-rendered to the term output schema (HTML body). Source-tagged in frontmatter.
  termsExtra: join(ROOT, 'content-cache/terms-extra'),
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
  const lines = m[1].split('\n');
  // Unquote AND unescape. Without the unescape step a value written as
  //   title: "… as \"itself\""
  // round-trips through yamlEscape() as \\\"itself\\\" and renders with literal
  // backslashes on the page. (Fixed 2026-08-10.)
  const unquote = s => {
    const t = s.trim();
    const dq = t.match(/^"([\s\S]*)"$/);
    if (dq) return dq[1].replace(/\\(["\\])/g, '$1');
    const sq = t.match(/^'([\s\S]*)'$/);
    if (sq) return sq[1].replace(/''/g, "'");
    return t;
  };
  let i = 0;
  while (i < lines.length) {
    const kv = lines[i].match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1];
    const rest = kv[2].trim();
    if (rest === '' && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      // YAML list form:  key:\n  - a\n  - b
      const arr = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        arr.push(unquote(lines[i].replace(/^\s*-\s+/, '')));
        i++;
      }
      data[key] = arr;
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      // inline array:  key: [a, b]
      data[key] = rest.slice(1, -1).split(',').map(unquote).filter(Boolean);
      i++;
      continue;
    }
    data[key] = unquote(rest);
    i++;
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
      // A `---` rule ends the entry. It previously only skipped the rule and
      // kept reading, so the document colophon after the final rule ("Compiled
      // by Claude for Mike Wolf, 2026-07-24 — modeled on the Levinese
      // dictionary…") was rendering as the body of the LAST entry, Machine Room.
      // Rules only ever appear between sections, so closing here loses nothing.
      if (/^---\s*$/.test(line)) { entries.push(cur); cur = null; continue; }
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
      tags: ['dialect', themeTag].filter(Boolean),
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

// Extra dictionary terms mined from Mike's writing (SRMW/Wall/70yt/chats), pre-rendered
// to the term schema with HTML bodies. Dedupe by slug vs the live Lexicon terms.
function parseTermsExtra() {
  if (!existsSync(P.termsExtra)) { console.log('  Dictionary extra → (none)'); return; }
  const seen = new Set(termRecords.map(t => t.slug));
  let n = 0, dupes = 0;
  for (const f of readdirSync(P.termsExtra)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const slug = f.replace(/\.md$/, '');
    if (seen.has(slug)) { dupes++; continue; }
    const { data, body } = parseFrontmatter(readFileSync(join(P.termsExtra, f), 'utf8'));
    const letter = (data.letter && /[A-Z]/.test(data.letter)) ? data.letter
      : ((data.title || slug)[0] || '#').toUpperCase().replace(/[^A-Z]/, '#');
    const bodyHtml = body.trim();
    termRecords.push({
      slug,
      letter,
      title: data.title || slug.replace(/-/g, ' '),
      subtitle: data.subtitle || '',
      theme: data.theme || undefined,
      origin: data.origin || data.source || '',
      relatedNames: Array.isArray(data.related) ? data.related : [],
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
      provenance: Array.isArray(data.provenance) ? data.provenance : [],
      link: data.link || undefined,
      link_label: data.link_label || undefined,
      bodyHtml,
      bodyText: bodyHtml.replace(/<[^>]+>/g, ' '),
    });
    seen.add(slug);
    n++;
  }
  console.log(`  Dictionary extra → ${n} terms (${dupes} dupes skipped)`);
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
// INLINE LINKING
//
// Two passes run over every term's HTML body:
//   (1) corpus refs — the mined entries carry machine-readable citations of the
//       form `70yt *post-slug*`. Those become <a href="/corpus/…/"><em>…</em></a>
//       (which also clears the literal asterisks that were rendering as markdown
//       leftovers), and feed term.provenance.
//   (2) term↔term — a mention of ANOTHER dictionary term becomes
//       <a href="#term-…">, first occurrence per distinct target only.
//
// FALSE-POSITIVE POLICY. The dictionary is full of ordinary English carrying a
// private overload ("dispatch", "the board", "time travel"). Linking every
// occurrence would wreck the prose, so an alias must earn its place:
//   • +2  three or more words (an exact long phrase is self-evidencing)
//   • +2  contains a coined token (not in Webster's) or an ALL-CAPS acronym
//   • +1  contains a capitalized proper noun ("Ralph loop", "Silicon Children")
//   • +1  hyphen-joined compound ("click-path", "dual-audience design")
//   • +1  a two-word "the …" dialect handle ("the fleet", "the vault")
//   • -1  shorter than five characters
// Threshold is 2, then a hand-curated stoplist removes survivors that are still
// generic, and aliases whose lowercase form is ordinary English but which are
// proper nouns/acronyms match CASE-SENSITIVELY only ("Pulse" links, "pulse"
// doesn't). Bare common words are never linked at all — "dispatch" alone gets
// no link even though "dispatch don't micromanage" does. A missed link is fine.
// ══════════════════════════════════════════════════════════════════════════════
const WEBSTER = (() => {
  try {
    return new Set(readFileSync('/usr/share/dict/words', 'utf8')
      .split('\n').map(w => w.trim().toLowerCase()).filter(Boolean));
  } catch { return new Set(); }
})();

const FUNCTION_WORDS = new Set(('a an the of to in on at by for and or but is are was were be been being it its this ' +
  'that these those with from as if not no so we you i he she they them our your my his her their all any each ' +
  'every more most some such than then there here what which who whom whose when where why how do does did done ' +
  'can could will would shall should may might must have has had own same too very just also only into out up ' +
  'down over under about').split(' '));

// Survivors of the score that are still too generic to link safely.
const ALIAS_STOPLIST = new Set([
  'pay the price', 'time travel', 'waking up', 'one shot', 'bucket list', 'zero day',
  'i win', 'i am!', 'i don’t disagree', "i don't disagree", 'i know my job',
  'a wake', 'awake', 'knowing', 'unknowing', 'residual', 'inspiration',
  'family motto', 'chosen people', 'new york style', 'writing for ai', 'one shot',
  'flip the bit', 'lowering the bar', 'audience of one', 'share your gifts',
]);
// Forced in despite a low score — unmistakable proper nouns, plus the
// hand-written lexicon's own plain-English terms, which are the whole point of
// the dictionary even though they read as ordinary phrases.
const ALIAS_ALLOWLIST = new Set([
  'dee', 'opie', 'soma', 'hermes', 'yeshie', 'ainjel', 'pulse', 'pulse core',
  'ccc', 'ccw', 'bathos', 'ai optimism', 'host pair', 'node identity', 'ship it',
  'specialist ledger', 'verify outcomes', "we're aligned", 'we’re aligned',
]);
// NOTE: 'fable' was allowlisted and then pulled. It linked correctly once (the
// SOMA persona) and wrongly once ("Fable format for free-will arguments" — the
// literary genre, not the AI). One-for-one is not good enough; a missed link is
// fine, a wrong one isn't.

// Idiom guards: the alias is right but the surrounding phrase makes it a
// different expression. Caught in review — "Green across the board" was linking
// to the work-queue entry, which is the exact failure mode this pass has to avoid.
const CONTEXT_BLOCKERS = [
  { alias: 'the board', before: /\b(?:across|above)\s+$/i },   // "across the board" = universally
  { alias: 'the relay', after: /^\s*(?:race|baton|team)\b/i }, // athletics, not infrastructure
  { alias: 'the queue', after: /^\s*(?:at the (?:bank|store))\b/i },
];
function blockedByContext(alias, before, after) {
  const lower = alias.toLowerCase().replace(/(?:['’]s|s)$/, '');
  for (const b of CONTEXT_BLOCKERS) {
    if (b.alias !== lower && b.alias !== alias.toLowerCase()) continue;
    if (b.before && b.before.test(before)) return true;
    if (b.after && b.after.test(after)) return true;
  }
  return false;
}

const stripOuterQuotes = s => {
  let t = s.trim();
  for (let i = 0; i < 3; i++) {
    const m = t.match(/^["“‘'](.*)["”’']$/s);
    if (!m) break;
    t = m[1].trim();
  }
  return t;
};
const trimAlias = s => stripOuterQuotes(String(s).replace(/\*/g, '').replace(/^[\s·+&/,;:]+/, '').replace(/[\s·,;:.]+$/, '')).trim();

// Every string that may reasonably stand in for a term in running prose.
// Priority: 0 = the full title, 1 = a middot-packed sub-term, 2 = paren-stripped,
// 3 = a slash-separated variant. Lower priority wins an alias collision.
function termAliases(title) {
  const out = new Map();
  const push = (s, prio) => {
    const v = trimAlias(s);
    if (!v || v.length < 3) return;
    if (!/[A-Za-z]/.test(v)) return;
    if (/[()…]/.test(v)) return;          // broken split remnants
    if (/-$/.test(v)) return;                  // "pico-"
    if ((v.match(/"/g) || []).length % 2) return; // unbalanced quote remnant
    if (!out.has(v) || out.get(v) > prio) out.set(v, prio);
  };
  const clean = title.replace(/\\+"/g, '"');
  push(clean, 0);
  const tier1 = [trimAlias(clean)];
  if (clean.includes('·')) clean.split('·').forEach(p => { push(p, 1); tier1.push(trimAlias(p)); });
  for (const a of [...tier1]) {
    const m = a.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
    if (!m) continue;
    push(m[1], 2);
    tier1.push(trimAlias(m[1]));
    if (m[2].includes('/')) m[2].split('/').forEach(p => push(p, 3));
  }
  for (const a of [...tier1]) {
    if (!a || a.includes('(') || !a.includes('/')) continue;
    const parts = a.split('/').map(trimAlias);
    if (parts.every(p => p && p.split(/\s+/).length <= 3)) parts.forEach(p => push(p, 3));
  }
  return [...out.entries()].map(([alias, prio]) => ({ alias, prio }));
}

const isAcronym = w => /^[A-Z][A-Z0-9$*.-]{2,}$/.test(w);
const isProperNoun = w => /^[A-Z][a-z]{2,}/.test(w);
const isCoined = w => {
  const bare = w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  return bare.length >= 4 && !WEBSTER.has(bare) && !FUNCTION_WORDS.has(bare);
};

function aliasScore(alias) {
  const words = alias.split(/\s+/).filter(Boolean);
  let s = 0;
  if (words.length >= 3) s += 2;
  if (words.some(isCoined)) s += 2;
  if (words.some(isAcronym)) s += 2;
  // A capitalised word inside a phrase is a strong proper-noun signal
  // ("Ralph loop", "Silicon Children"); alone it is much weaker ("Pulse").
  if (words.some(isProperNoun)) s += words.length >= 2 ? 2 : 1;
  if (/[a-z]-[a-z]/i.test(alias) && words.length <= 3) s += 1;
  // "the fleet" / "the vault" / "the board" — the estate's flagship overloads,
  // and exactly the ones a reader most needs signposted.
  if (words.length === 2 && /^the$/i.test(words[0])) s += 2;
  if (alias.length < 5 && !words.some(isAcronym) && !words.some(isCoined)) s -= 1;
  return s;
}

// Match case-sensitively when the phrase is only distinctive BECAUSE of its
// capitalisation — otherwise "Pulse" would swallow every "pulse".
function needsCaseSensitivity(alias) {
  if (!/[A-Z]/.test(alias)) return false;
  const words = alias.split(/\s+/).filter(Boolean);
  if (words.some(isAcronym)) return true;
  return words.every(w => !isCoined(w));
}

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── term↔term index ───────────────────────────────────────────────────────────
function buildTermLinkIndex() {
  const byAlias = new Map(); // aliasKey -> { slug, alias, cs, prio }
  const ordered = [...termRecords].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const t of ordered) {
    for (const { alias, prio } of termAliases(t.title)) {
      const lower = alias.toLowerCase();
      if (ALIAS_STOPLIST.has(lower)) continue;
      const forced = ALIAS_ALLOWLIST.has(lower);
      if (!forced && aliasScore(alias) < 2) continue;
      const cs = needsCaseSensitivity(alias);
      const key = cs ? alias : lower;
      const prev = byAlias.get(key);
      if (prev && prev.prio <= prio) continue;   // first/most-specific owner wins
      byAlias.set(key, { slug: t.slug, alias, cs, prio });
    }
  }
  if (process.env.DEBUG_ALIASES) {
    const rejected = [];
    for (const t of ordered) for (const { alias } of termAliases(t.title)) {
      const lower = alias.toLowerCase();
      if (ALIAS_ALLOWLIST.has(lower)) continue;
      if (ALIAS_STOPLIST.has(lower) || aliasScore(alias) < 2) rejected.push(`${alias}(${aliasScore(alias)})${(t.tags || []).includes('dialect') ? ' ★' : ''}`);
    }
    console.log('\n--- REJECTED ALIASES (★ = hand-written lexicon term) ---\n' + rejected.sort().join(' | '));
    console.log('\n--- ACCEPTED ---\n' + [...byAlias.values()].map(e => e.alias + (e.cs ? '·CS' : '')).sort().join(' | ') + '\n');
  }
  const entries = [...byAlias.values()].sort((a, b) => b.alias.length - a.alias.length);
  // Two alternations: one case-sensitive, one not. Longest-first inside each so
  // "dispatch don't micromanage" beats "dispatch".
  const build = list => list.length
    ? new RegExp('(?<![A-Za-z0-9])(?:' + list.map(e => reEsc(e.alias) + "(?:['’]s|s)?").join('|') + ')(?![A-Za-z0-9])', 'g')
    : null;
  const cs = entries.filter(e => e.cs);
  const ci = entries.filter(e => !e.cs);
  return {
    entries,
    reCS: build(cs),
    reCI: ci.length
      ? new RegExp('(?<![A-Za-z0-9])(?:' + ci.map(e => reEsc(e.alias) + "(?:['’]s|s)?").join('|') + ')(?![A-Za-z0-9])', 'gi')
      : null,
    lookupCS: new Map(cs.map(e => [e.alias, e.slug])),
    lookupCI: new Map(ci.map(e => [e.alias.toLowerCase(), e.slug])),
  };
}

// Resolve a match back to its alias by peeling the possessive/plural suffix.
function resolveMatch(text, lookup, lower) {
  const probe = lower ? text.toLowerCase() : text;
  if (lookup.has(probe)) return lookup.get(probe);
  for (const suf of ["'s", '’s', 's']) {
    if (probe.endsWith(suf)) {
      const base = probe.slice(0, -suf.length);
      if (lookup.has(base)) return lookup.get(base);
    }
  }
  return null;
}

// ── corpus-ref index ──────────────────────────────────────────────────────────
// `70yt *some-post-slug*` → the real /corpus/ page. Source slugs carry a date
// suffix and are sometimes truncated, so exact match first, then unique prefix.
let CORPUS_REF_INDEX = null;
function buildCorpusRefIndex() {
  const all = sourceRecords.map(s => s.slug).sort();
  const exact = new Set(all);
  const cache = new Map();
  const ambiguous = [];
  const DATE_SUFFIX = /^-\d{2}-\d{2}-\d{2}$/;
  return {
    resolve(ref) {
      if (cache.has(ref)) return cache.get(ref);
      let hit = null;
      const full = '70yearswtf-' + ref;
      const multiWord = ref.includes('-');
      if (exact.has(full)) hit = full;
      else {
        const c = all.filter(s => s.startsWith(full));
        // A single-token ref is only trusted on an exact hit or a bare date
        // suffix. Otherwise `*good*` (an italicised ordinary word) would resolve
        // to "good-conversations" and manufacture a citation out of emphasis.
        const pool = multiWord ? c : c.filter(s => DATE_SUFFIX.test(s.slice(full.length)));
        if (pool.length === 1) hit = pool[0];
        else if (pool.length > 1) { hit = pool[0]; ambiguous.push(ref); }
      }
      cache.set(ref, hit);
      return hit;
    },
    ambiguous,
  };
}

// ── HTML-safe text walking ────────────────────────────────────────────────────
// The generated bodies are simple, well-formed HTML. Walk tag-by-tag, keep a
// stack, and only hand fn() the text runs whose ancestry is safe to rewrite.
function mapTextRuns(html, skipTags, fn) {
  const parts = html.split(/(<[^>]+>)/);
  const stack = [];
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (part[0] === '<') {
      const m = part.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
      if (m) {
        const tag = m[1].toLowerCase();
        if (part.startsWith('</')) { const i = stack.lastIndexOf(tag); if (i >= 0) stack.splice(i, 1); }
        else if (!/\/>$/.test(part) && !['br', 'hr', 'img'].includes(tag)) stack.push(tag);
      }
      out += part;
      continue;
    }
    out += stack.some(t => skipTags.has(t)) ? part : fn(part);
  }
  return out;
}

const CORPUS_REF_RE = /\*([a-z0-9]+(?:-[a-z0-9]+)*)\*/g;

// Pass 1: corpus refs → real links. Returns { html, refs } (refs in order seen).
function linkCorpusRefs(html) {
  const refs = [];
  const out = mapTextRuns(html, new Set(['a', 'code']), text =>
    text.replace(CORPUS_REF_RE, (whole, ref) => {
      if (ref.length < 6) return whole;
      const slug = CORPUS_REF_INDEX.resolve(ref);
      if (!slug) return whole;
      refs.push(slug);
      return `<a href="/corpus/${slug}/" class="corpus-ref"><em>${ref}</em></a>`;
    }));
  return { html: out, refs };
}

// Pass 2: term↔term. Skips <a>/<code>/<strong> (that's the "What we mean."
// label) and <blockquote> (Mike's verbatim quoted prose stays clean).
const TERM_SKIP = new Set(['a', 'code', 'strong', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
function linkTermMentions(html, selfSlug, index, cap = 6) {
  const used = new Set([selfSlug]);
  let n = 0;
  const run = (text, re, lookup, lower) => {
    if (!re) return text;
    re.lastIndex = 0;
    return text.replace(re, (m, offset, whole) => {
      if (n >= cap) return m;
      const slug = resolveMatch(m, lookup, lower);
      if (!slug || used.has(slug)) return m;
      if (blockedByContext(m, whole.slice(Math.max(0, offset - 24), offset), whole.slice(offset + m.length, offset + m.length + 24))) return m;
      used.add(slug); n++;
      return `<a href="#term-${slug}" class="term-xref">${m}</a>`;
    });
  };
  // Case-sensitive alternation first so "Pulse" claims its span before the
  // case-insensitive pass can see it; the CI pass then skips existing <a>.
  let out = mapTextRuns(html, TERM_SKIP, t => run(t, index.reCS, index.lookupCS, false));
  out = mapTextRuns(out, TERM_SKIP, t => run(t, index.reCI, index.lookupCI, true));
  return { html: out, count: n, targets: [...used].filter(s => s !== selfSlug) };
}

// ══════════════════════════════════════════════════════════════════════════════
// CROSS-REFERENCES
// ══════════════════════════════════════════════════════════════════════════════
function wireCrossRefs() {
  const termSlugSet = new Set(termRecords.map(t => t.slug));
  const titleToSlug = new Map(termRecords.map(t => [t.title.toLowerCase(), t.slug]));

  // term <-> term: (a) explicit "See also" names, then (b) mention-matching —
  // this term's body (or another term's body) references another term's title.
  const norm = s => s.toLowerCase().replace(/^["'“”]+|["'“”]+$/g, '');
  const termNeedles = termRecords
    .filter(t => norm(t.title).length >= 5)
    .map(t => ({ slug: t.slug, re: new RegExp('\\b' + norm(t.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') }));
  for (const t of termRecords) {
    t.related = [];
    for (const name of t.relatedNames) {
      const s = slugify(name);
      if (termSlugSet.has(s) && s !== t.slug) { t.related.push(s); continue; }
      const byTitle = titleToSlug.get(name.toLowerCase());
      if (byTitle && byTitle !== t.slug) t.related.push(byTitle);
    }
    // (b) this term's definition body mentions another term's title
    for (const o of termNeedles) {
      if (o.slug === t.slug || t.related.includes(o.slug)) continue;
      if (o.re.test(t.bodyText)) t.related.push(o.slug);
    }
    t.related = [...new Set(t.related)].slice(0, 12);
  }
  // symmetric backfill: if A links to B, surface A under B too (discovery), capped
  const backlinks = new Map();
  for (const t of termRecords) for (const r of t.related) {
    if (!backlinks.has(r)) backlinks.set(r, []);
    backlinks.get(r).push(t.slug);
  }
  for (const t of termRecords) {
    for (const b of (backlinks.get(t.slug) || [])) {
      if (!t.related.includes(b)) t.related.push(b);
    }
    t.related = [...new Set(t.related)].slice(0, 12);
  }

  // term -> source provenance. Two feeds, in priority order:
  //   (a) DIRECT — the entry's own `70yt *post-slug*` citation, resolved to a
  //       real corpus page. Authoritative: it names the passage the term was
  //       mined from. (Wired in wireInlineLinks(), which runs first.)
  //   (b) MENTION — a source whose body or title contains one of the term's
  //       accepted aliases. Uses the same specificity filter as inline linking,
  //       so the full packed title ("metastupid / Chronic Metastupidity · Law of
  //       Relative Stupidity") no longer has to appear verbatim to score a hit.
  // Ranked: title hit ≫ body frequency. Capped so one common phrase can't drag
  // three hundred posts into "Discussed in".
  const PROV_CAP = 8;
  const sourceBySlug = new Map(sourceRecords.map(s => [s.slug, s]));
  for (const s of sourceRecords) s.relatedTerms = [];
  for (const t of termRecords) {
    const ranked = new Map();  // slug -> score
    for (const slug of (t.directProvenance || [])) {
      if (sourceBySlug.has(slug)) ranked.set(slug, 1e6 - ranked.size);
    }
    // Two tiers of needle. STRONG aliases (the same ones that earn an inline
    // link) count on a single hit. WEAK aliases — ordinary English like
    // "dispatch", "safe place", "the bottleneck" — are matched case-insensitively
    // but must show ABOUTNESS: a title hit, or three or more occurrences in the
    // body. One passing mention of "the foundation" in a 2019 post is not a
    // citation for SOMA's Foundation; a post that says "dispatch" nine times is.
    const WEAK_MIN_HITS = 3;
    const needles = [];
    for (const { alias } of termAliases(t.title)) {
      const lower = alias.toLowerCase();
      if (ALIAS_STOPLIST.has(lower)) continue;
      const strong = ALIAS_ALLOWLIST.has(lower) || aliasScore(alias) >= 2;
      if (!strong && alias.split(/\s+/).length === 1 && alias.length < 6) continue; // too short to be evidence
      const cs = strong && needsCaseSensitivity(alias);
      needles.push({ strong, re: new RegExp('(?<![A-Za-z0-9])' + reEsc(alias) + '(?![A-Za-z0-9])', cs ? 'g' : 'gi') });
      // Mike's own pre-2020 prose predates the capitalisation convention — the
      // 2019 posts write "the bottleneck", the lexicon writes "the Bottleneck".
      // Retry case-insensitively under the aboutness gate so the real Goldratt
      // posts still qualify without one passing mention counting as a citation.
      if (cs) needles.push({ strong: false, re: new RegExp('(?<![A-Za-z0-9])' + reEsc(alias) + '(?![A-Za-z0-9])', 'gi') });
    }
    for (const s of sourceRecords) {
      let score = 0;
      for (const n of needles) {
        n.re.lastIndex = 0;
        const titleHit = n.re.test(s.title);
        n.re.lastIndex = 0;
        const hits = (s.bodyText.match(n.re) || []).length;
        if (n.strong) { if (titleHit) score += 500; score += hits; }
        else if (titleHit) score += 200;
        else if (hits >= WEAK_MIN_HITS) score += hits;
      }
      if (score > 0 && !ranked.has(s.slug)) ranked.set(s.slug, score);
    }
    t.provenance = [...ranked.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PROV_CAP)
      .map(e => e[0])
      .filter(slug => sourceBySlug.has(slug));   // never emit a link that 404s
    for (const slug of t.provenance) sourceBySlug.get(slug).relatedTerms.push(t.slug);
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
  const withProv = termRecords.filter(t => t.provenance.length).length;
  console.log(`  Cross-refs → ${termRecords.reduce((a, t) => a + t.related.length, 0)} term links, ${provCount} term→source citations across ${withProv}/${termRecords.length} terms`);
}

// ══════════════════════════════════════════════════════════════════════════════
// INLINE LINK + ARTIFACT PASS  (runs before wireCrossRefs — it feeds provenance)
// ══════════════════════════════════════════════════════════════════════════════
// Honest attribution for entries whose real origin is unpublished internal canon
// and which therefore have no corpus passage to cite. Naming the source in plain
// text beats inventing a link.
const INTERNAL_CANON_ORIGIN = 'Internal SOMA canon — working dialect, unpublished (SOMA Lexicon, 2026-07-24).';

function wireInlineLinks() {
  CORPUS_REF_INDEX = buildCorpusRefIndex();
  const index = buildTermLinkIndex();
  let corpusLinks = 0, termLinks = 0, originLinks = 0, originBackfill = 0;

  for (const t of termRecords) {
    // Leftover markdown in the pre-rendered HTML bodies: `**x**` and `*x*` were
    // rendering as literal asterisks on the page.
    const refs = [];
    let html = t.bodyHtml;

    const c = linkCorpusRefs(html);
    html = c.html; refs.push(...c.refs); corpusLinks += c.refs.length;

    html = mapTextRuns(html, new Set(['a', 'code']), txt => txt
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>'));

    const x = linkTermMentions(html, t.slug, index);
    html = x.html; termLinks += x.count;

    t.bodyHtml = html;
    t.bodyText = html.replace(/<[^>]+>/g, ' ');
    t.inlineRelated = x.targets;

    // Origin line: same treatment, rendered as HTML by the dictionary template.
    let origin = (t.origin || '').replace(/\s*---\s*$/, '').trim();
    if (!origin && (t.tags || []).includes('dialect')) { origin = INTERNAL_CANON_ORIGIN; originBackfill++; }
    t.origin = origin;
    if (origin) {
      const oc = linkCorpusRefs(`<span>${origin}</span>`);
      refs.push(...oc.refs); originLinks += oc.refs.length;
      t.originHtml = oc.html.replace(/^<span>|<\/span>$/g, '')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    } else {
      t.originHtml = '';
    }

    t.directProvenance = [...new Set(refs)];
  }

  const cited = termRecords.filter(t => t.directProvenance.length).length;
  console.log(`  Inline links → ${corpusLinks} corpus refs in bodies + ${originLinks} in origin lines (${cited} terms cite a corpus page directly)`);
  console.log(`  Inline links → ${termLinks} term↔term anchors from ${index.entries.length} accepted aliases; ${originBackfill} origins backfilled as internal canon`);
  if (CORPUS_REF_INDEX.ambiguous.length) {
    console.log(`  ⚠ ambiguous corpus refs (took earliest match): ${[...new Set(CORPUS_REF_INDEX.ambiguous)].join(', ')}`);
  }
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
      origin_html: t.originHtml || undefined,
      source: t.origin || '',
      related: t.related || [],
      provenance: t.provenance || [],
      tags: t.tags || [],
      link: t.link || undefined,
      link_label: t.link_label || undefined,
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
parseTermsExtra();
parseSRMW();
parse70yt();
parse70ytArchive();
parseAIWTF();
parseSiliconChildren();
wireInlineLinks();
wireCrossRefs();
writeAll();
console.log('\nDone.');
