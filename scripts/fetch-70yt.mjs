#!/usr/bin/env node
/**
 * fetch-70yt.mjs — Fetch 70YearsWTF Substack posts → library source markdown.
 *
 * Proven fetch (no browser):
 *   GET https://70yearswtf.substack.com/api/v1/posts/<slug>
 *   → JSON with title, subtitle, post_date, wordcount, canonical_url, body_html
 *
 * Usage:
 *   node scripts/fetch-70yt.mjs _grok/sample-slugs.tsv
 *   node scripts/fetch-70yt.mjs --slugs the-egg-16-12-06,my-new-writing-process
 *   node scripts/fetch-70yt.mjs --slugs a,b --dry-run   # print paths only
 *   node scripts/fetch-70yt.mjs --slugs a --out /tmp/out # custom output dir
 *
 * Idempotent: re-running overwrites the same 70yearswtf-<slug>.md cleanly.
 * Dependency-light: no HTML→MD library — Substack body_html is regular enough
 * that a small hand-rolled converter is more controllable for cruft stripping.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_OUT = join(ROOT, 'src/content/sources');
const DEFAULT_FAILURES = join(ROOT, '_grok/70yt-failures.txt');
const API = 'https://70yearswtf.substack.com/api/v1/posts';
const COLLECTION = '70YearsWTF';
const AUTHOR = 'Mike Wolf';

/** Polite base delay between successful/skip requests (ms). */
const BASE_DELAY_MS = 1800;
/** Max retries per slug on 429 (and other retriable errors). */
const MAX_RETRIES = 6;
/** Initial backoff when no Retry-After header (ms). */
const BACKOFF_START_MS = 30_000;
/** Cap backoff at this (ms). */
const BACKOFF_CAP_MS = 300_000;

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { slugs: [], tsv: null, out: DEFAULT_OUT, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slugs') {
      const v = argv[++i] || '';
      opts.slugs.push(...v.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--out') {
      opts.out = argv[++i];
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (!a.startsWith('-')) {
      opts.tsv = a;
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

/** Read slug list from TSV: slug\\tdate\\twordcount\\ttype\\ttitle (header optional). */
function slugsFromTsv(path) {
  const text = readFileSync(path, 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cols = trimmed.split('\t');
    const slug = cols[0]?.trim();
    if (!slug || slug === 'slug') continue; // skip header
    out.push(slug);
  }
  return out;
}

// ── Fetch (rate-limit resilient) ──────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse Retry-After: either seconds (integer) or HTTP-date.
 * Returns wait ms, or null if missing/unparseable.
 */
function parseRetryAfter(header) {
  if (!header) return null;
  const trimmed = String(header).trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, BACKOFF_CAP_MS);
  }
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    const ms = when - Date.now();
    if (ms > 0) return Math.min(ms, BACKOFF_CAP_MS);
  }
  return null;
}

class HttpError extends Error {
  constructor(status, slug, body, retryAfterMs) {
    super(`HTTP ${status} for ${slug}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.slug = slug;
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

async function fetchPostOnce(slug) {
  const url = `${API}/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'mike-wolf-library/fetch-70yt (local ingest)',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const retryAfterMs = res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : null;
    throw new HttpError(res.status, slug, body, retryAfterMs);
  }
  return res.json();
}

/**
 * Fetch with 429-aware retries. Same slug retried up to MAX_RETRIES times
 * after the first attempt (i.e. up to MAX_RETRIES + 1 total tries).
 * Honors Retry-After; otherwise exponential backoff from BACKOFF_START_MS.
 */
async function fetchPost(slug) {
  let attempt = 0;
  let backoff = BACKOFF_START_MS;
  // attempt 0 = first try; retries = 1..MAX_RETRIES
  while (true) {
    try {
      return await fetchPostOnce(slug);
    } catch (err) {
      const status = err?.status;
      const retriable = status === 429 || status === 503 || status === 502 || status === 504;
      if (!retriable || attempt >= MAX_RETRIES) throw err;

      attempt++;
      let waitMs;
      if (status === 429 && err.retryAfterMs != null) {
        waitMs = err.retryAfterMs;
      } else {
        waitMs = Math.min(backoff, BACKOFF_CAP_MS);
        backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
      }
      // Small jitter so serial runs don't lock-step
      waitMs += Math.floor(Math.random() * 2000);
      console.warn(
        `  ⏳ ${slug}: HTTP ${status}, retry ${attempt}/${MAX_RETRIES} after ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
    }
  }
}

function appendFailure(failuresPath, slug, reason) {
  const line = `${new Date().toISOString()}\t${slug}\t${reason.replace(/\s+/g, ' ').slice(0, 300)}\n`;
  const dir = dirname(failuresPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(failuresPath, line, 'utf8');
}

// ── HTML → Markdown (Substack-aware) ──────────────────────────────────────────

/**
 * Extract balanced element from `html` starting at `openIdx` (index of '<').
 * Handles nested same-tag elements. Returns { end, outer, inner } or null.
 */
function balancedElement(html, openIdx) {
  const openMatch = html.slice(openIdx).match(/^<([a-zA-Z][\w:-]*)\b[^>]*>/);
  if (!openMatch) return null;
  const tag = openMatch[1].toLowerCase();
  // void tags
  if (/^(img|br|hr|source|meta|link|input)$/i.test(tag) || /\/\s*>$/.test(openMatch[0])) {
    const end = openIdx + openMatch[0].length;
    return { end, outer: html.slice(openIdx, end), inner: '' };
  }
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0;
  let i = openIdx;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const om = openRe.exec(html);
    const cm = closeRe.exec(html);
    if (!cm) return null;
    if (om && om.index < cm.index) {
      depth++;
      i = om.index + om[0].length;
    } else {
      depth--;
      i = cm.index + cm[0].length;
      if (depth === 0) {
        const outer = html.slice(openIdx, i);
        const innerStart = openIdx + openMatch[0].length;
        const innerEnd = cm.index;
        return { end: i, outer, inner: html.slice(innerStart, innerEnd) };
      }
    }
  }
  return null;
}

/** Replace every occurrence of <tag ...>...</tag> (balanced) via mapper(outer, inner). */
function replaceBalanced(html, tag, mapper) {
  const openPat = new RegExp(`<${tag}\\b`, 'gi');
  let out = '';
  let i = 0;
  while (i < html.length) {
    openPat.lastIndex = i;
    const m = openPat.exec(html);
    if (!m) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, m.index);
    const bal = balancedElement(html, m.index);
    if (!bal) {
      // malformed — skip the open tag token and continue
      out += html.slice(m.index, m.index + m[0].length);
      i = m.index + m[0].length;
      continue;
    }
    out += mapper(bal.outer, bal.inner);
    i = bal.end;
  }
  return out;
}

/**
 * Strip Substack chrome before conversion:
 * subscribe/share/comment/gift buttons, restack/view-image chrome, SVGs,
 * picture/source trees, bare images (keep figcaption text as italic).
 *
 * Uses balanced-tag matching because Substack nests <div> deeply inside
 * captioned-image-container / figure blocks — non-greedy regex leaves
 * orphan `</a></figure>` fragments.
 */
function stripCruft(html) {
  let h = html;

  // Remove entire script/style/svg/iframe/button blocks (balanced where needed)
  for (const tag of ['script', 'style', 'svg', 'iframe', 'button', 'noscript']) {
    h = replaceBalanced(h, tag, () => '');
  }

  // Captioned image containers & figures: keep figcaption prose only
  const captionKeep = (outer) => {
    const caps = [...outer.matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi)].map(
      (m) => m[1]
    );
    if (!caps.length) return '';
    return caps.map((c) => `<p><em>${c}</em></p>`).join('');
  };

  // Recursively walk divs: drop chrome containers whole; unwrap everything else
  // so nested captioned-image / youtube blocks are not skipped when a parent
  // div wraps them.
  function stripDivs(fragment) {
    return replaceBalanced(fragment, 'div', (outer, inner) => {
      if (/class="[^"]*captioned-image-container/i.test(outer)) return captionKeep(outer);
      if (/class="[^"]*youtube-wrap/i.test(outer)) return '';
      if (
        /class="[^"]*(?:subscribe-widget|subscription-widget|paywall|like-button|share-dialog|image2-inset)/i.test(
          outer
        )
      ) {
        return '';
      }
      // unwrap: process children, discard the div shell
      return stripDivs(inner);
    });
  }
  h = stripDivs(h);

  h = replaceBalanced(h, 'figure', (outer) => captionKeep(outer));

  // Standalone image wrappers (image2 / image-link anchors)
  h = replaceBalanced(h, 'a', (outer) => {
    if (/class="[^"]*image-link/i.test(outer)) return '';
    return outer; // keep normal links
  });
  h = replaceBalanced(h, 'picture', () => '');
  h = h.replace(/<img\b[^>]*\/?>/gi, '');
  h = h.replace(/<source\b[^>]*\/?>/gi, '');

  // Unwrap remaining span wrappers
  h = h.replace(/<\/?span\b[^>]*>/gi, '');

  // Orphan close/open tags from any residual imbalance
  h = h.replace(/<\/(?:figure|picture|button|div)\s*>/gi, '');
  h = h.replace(/<(?:figure|picture|div)\b[^>]*>/gi, '');

  return h;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function inlineToMd(html) {
  let s = html;

  // Links first (preserve nested formatting inside text)
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    // Collapse newlines but preserve leading/trailing spaces so
    // `<a>I wrote </a>about` becomes `[I wrote](url) about`, not `](url)about`.
    let t = inlineToMd(text).replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ');
    const lead = (t.match(/^\s*/) || [''])[0];
    const trail = (t.match(/\s*$/) || [''])[0];
    t = t.trim();
    const h = href.replace(/&amp;/g, '&');
    if (!t) return lead + trail;
    if (/substackcdn\.com\/image/i.test(h)) return lead + trail;
    // Always ensure a trailing space if the anchor itself ended with whitespace
    // (common Substack pattern: link text includes the space before the next word).
    const outTrail = trail || '';
    return `${lead}[${t}](${h})${outTrail}`;
  });

  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => {
    const t = inlineToMd(inner).trim();
    return t ? `**${t}**` : '';
  });
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => {
    const t = inlineToMd(inner).trim();
    return t ? `*${t}*` : '';
  });
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => {
    return '`' + decodeEntities(inner.replace(/<[^>]+>/g, '')) + '`';
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip any remaining tags
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s);
}

function listToMd(html, ordered) {
  // Split top-level <li> (non-greedy, no nested list handling beyond one level of text)
  const items = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let inner = m[1];
    // Nested lists → append as indented block
    inner = inner.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (full, tag, body) => {
      const nested = listToMd(body, tag.toLowerCase() === 'ol');
      return '\n' + nested.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
    });
    const text = inlineToMd(inner).replace(/\n{3,}/g, '\n\n').trim();
    if (text) items.push(text);
  }
  return items
    .map((t, i) => {
      const bullet = ordered ? `${i + 1}. ` : '- ';
      // Multi-line list items: indent continuation
      const lines = t.split('\n');
      return lines
        .map((line, j) => (j === 0 ? bullet + line : '  ' + line))
        .join('\n');
    })
    .join('\n');
}

/**
 * Convert cleaned Substack body_html to markdown.
 * Walks block-level tags in document order via a simple regex scanner.
 */
function htmlToMarkdown(rawHtml) {
  let html = rawHtml || '';

  // Normalize <hr>
  html = html.replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n');

  // Convert <pre> FIRST and stash as placeholders so stripCruft cannot hollow
  // out demo iframe/HTML samples that live inside code blocks.
  // Substack sometimes nests <code><code>… and embeds demo markdown that is already
  // mangled upstream — we pass it through faithfully rather than "fixing" author text.
  const prePlaceholders = [];
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    let code = inner
      .replace(/<\/?code\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    code = decodeEntities(code).replace(/^\n+|\n+$/g, '');
    if (!code.trim()) return '\n\n';
    const token = `\u0000PRE${prePlaceholders.length}\u0000`;
    prePlaceholders.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
    return token;
  });

  // Now strip Substack chrome from the remaining prose HTML
  html = stripCruft(html);

  // Blockquotes
  html = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    // Recurse: convert inner paragraphs, then prefix >
    const innerMd = htmlToMarkdown(inner).trim();
    const quoted = innerMd
      .split('\n')
      .map((l) => (l.trim() ? `> ${l}` : '>'))
      .join('\n');
    return `\n\n${quoted}\n\n`;
  });

  // Lists
  html = html.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, body) => {
    return '\n\n' + listToMd(body, tag.toLowerCase() === 'ol') + '\n\n';
  });

  // Headings
  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const text = inlineToMd(inner).replace(/\n+/g, ' ').trim();
    if (!text) return '';
    return `\n\n${'#'.repeat(Number(level))} ${text}\n\n`;
  });

  // Paragraphs
  html = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => {
    const text = inlineToMd(inner).trim();
    if (!text) return '\n\n';
    return `\n\n${text}\n\n`;
  });

  // Any leftover block tags → strip wrappers, keep text
  html = html.replace(/<\/?(?:span|section|article|header|footer|main|nav)\b[^>]*>/gi, '');

  // If residual HTML remains, flatten
  if (/<[a-zA-Z]/.test(html)) {
    html = inlineToMd(html);
  } else {
    html = decodeEntities(html);
  }

  // Restore protected <pre> blocks
  html = html.replace(/\u0000PRE(\d+)\u0000/g, (_, n) => prePlaceholders[Number(n)] || '');

  return normalizeMarkdown(html);
}

function normalizeMarkdown(md) {
  let s = md;

  // Collapse excessive blank lines
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  // Drop empty markdown image/link shells left from stripped images
  s = s.replace(/!\[.*?\]\([^)]+\)/g, '');
  s = s.replace(/\[\]\([^)]+\)/g, '');

  // Drop orphan HTML fragments that slipped past stripCruft
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // Drop lines that are only Substack CDN noise or whitespace after cleanup
  s = s
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^!\[.*\]\(https?:\/\/substackcdn\.com/i.test(t)) return false;
      if (/^\[\]\(https?:\/\/substackcdn\.com/i.test(t)) return false;
      if (/^https?:\/\/substackcdn\.com\S*$/i.test(t)) return false;
      return true;
    })
    .join('\n');

  // Soft-wrap runs of single newlines inside paragraphs are already paragraph-based.
  // Convert leftover <br>-style single newlines that aren't list/quote/heading into spaces
  // only when they look like mid-paragraph — Substack often uses <br><br> for paragraph breaks.
  // After conversion those become \n\n already via <p> or via double br → handled.

  // Trim trailing spaces on lines; normalize end
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();

  // Final blank-line collapse
  s = s.replace(/\n{3,}/g, '\n\n');

  return s + '\n';
}

// ── Frontmatter / file write ──────────────────────────────────────────────────

function yamlEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
}

function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
        continue;
      }
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

function dateOnly(iso) {
  if (!iso) return null;
  // post_date is ISO; take YYYY-MM-DD
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(iso).slice(0, 10);
}

function excerptFrom(subtitle, bodyMd) {
  const sub = (subtitle || '').trim();
  if (sub) return sub.replace(/\s+/g, ' ').slice(0, 400);
  const plain = bodyMd
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain.split(/\s+/).filter(Boolean).slice(0, 40);
  let ex = words.join(' ');
  if (plain.split(/\s+/).length > 40) ex += '…';
  return ex.slice(0, 400);
}

function sensibleTags(post, bodyMd) {
  const tags = [COLLECTION];
  // postTags from API if any
  const apiTags = post.postTags || post.post_tags || [];
  for (const t of apiTags) {
    const name = typeof t === 'string' ? t : t?.name || t?.slug;
    if (name && !tags.includes(name)) tags.push(name);
  }
  // Light content heuristics (keep short; scale phase can enrich)
  const lower = `${post.title || ''} ${bodyMd}`.toLowerCase();
  const hints = [
    [/silicon child/, 'Silicon Children'],
    [/\bai\b|artificial intelligence|llm|claude|gpt/, 'AI'],
    [/meditat/, 'meditation'],
    [/blog/, 'blogging'],
    [/monetar|mmt|economics|money/, 'economics'],
    [/robot|automat/, 'automation'],
    [/bias|debias/, 'rationality'],
  ];
  for (const [re, tag] of hints) {
    if (re.test(lower) && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 6);
}

function sourcePath(outDir, slug) {
  // Naming convention observed in repo: 70yearswtf-<substack-slug>.md
  return join(outDir, `70yearswtf-${slug}.md`);
}

function renderSource(post, bodyMd) {
  const date = dateOnly(post.post_date);
  const wordCount = Number(post.wordcount) || wordCountOf(bodyMd);
  const fields = {
    title: post.title || 'Untitled',
    collection: COLLECTION,
    kind: 'post',
    order: 0,
    date,
    author: AUTHOR,
    original_url: post.canonical_url || `https://70yearswtf.substack.com/p/${post.slug}`,
    excerpt: excerptFrom(post.subtitle, bodyMd),
    word_count: wordCount,
    tags: sensibleTags(post, bodyMd),
    related: [],
  };

  let body = bodyMd;
  // Podcast note only when there is a real audio asset.
  // Substack often returns a non-null podcastFields object full of nulls —
  // that is NOT a podcast. Require a duration > 0 or a usable URL.
  const dur = Number(post.podcast_duration) || Number(post.podcastFields?.free_podcast_duration) || 0;
  const audioUrl = post.podcast_url || post.podcastFields?.free_podcast_url || '';
  const hasPodcast =
    post.type === 'podcast' ||
    (Number.isFinite(dur) && dur > 0) ||
    (typeof audioUrl === 'string' && audioUrl.startsWith('http'));
  if (hasPodcast) {
    body = `*[Audio edition available on Substack.]*\n\n${body}`;
  }

  return `${buildFrontmatter(fields)}\n\n${body.trim()}\n`;
}

function wordCountOf(md) {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processSlug(slug, outDir, dryRun) {
  const post = await fetchPost(slug);
  // Ensure slug on post object for URL fallback
  if (!post.slug) post.slug = slug;

  const bodyMd = htmlToMarkdown(post.body_html || '');
  const file = sourcePath(outDir, slug);
  const content = renderSource(post, bodyMd);

  if (dryRun) {
    console.log(`[dry-run] would write ${file} (${content.length} bytes, title=${JSON.stringify(post.title)})`);
    return { slug, file, bytes: content.length, title: post.title, status: 'fetched' };
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(file, content, 'utf8');
  console.log(`✓ ${slug} → ${file} (${bodyMd.split(/\s+/).filter(Boolean).length} words body)`);
  return { slug, file, bytes: content.length, title: post.title, status: 'fetched' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.tsv && opts.slugs.length === 0)) {
    console.log(`Usage:
  node scripts/fetch-70yt.mjs <slugs.tsv>
  node scripts/fetch-70yt.mjs --slugs slug-a,slug-b
  node scripts/fetch-70yt.mjs --slugs a --out DIR --dry-run`);
    process.exit(opts.help ? 0 : 2);
  }

  let slugs = [...opts.slugs];
  if (opts.tsv) slugs.push(...slugsFromTsv(opts.tsv));
  // Dedupe, preserve order
  slugs = [...new Set(slugs)];

  if (!slugs.length) {
    console.error('No slugs to process.');
    process.exit(2);
  }

  const failuresPath = DEFAULT_FAILURES;
  console.log(
    `Fetching ${slugs.length} post(s) → ${opts.out}${opts.dryRun ? ' (dry-run)' : ''}\n` +
      `  delay=${BASE_DELAY_MS}ms  maxRetries=${MAX_RETRIES}  failures→${failuresPath}\n`
  );

  let fetched = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const file = sourcePath(opts.out, slug);
    const progress = `[${i + 1}/${slugs.length}]`;

    // Skip-existing / resume: do not re-fetch if output already present
    if (!opts.dryRun && existsSync(file)) {
      console.log(`${progress} skip ${slug} (exists)`);
      skipped++;
      continue;
    }

    try {
      await processSlug(slug, opts.out, opts.dryRun);
      fetched++;
      // Polite inter-request delay after a real network fetch
      await sleep(BASE_DELAY_MS);
    } catch (err) {
      console.error(`✗ ${progress} ${slug}: ${err.message}`);
      errors.push({ slug, error: err.message });
      if (!opts.dryRun) {
        appendFailure(failuresPath, slug, err.message);
      }
      // Still wait after a failure so we don't stampede on 429 waves
      await sleep(BASE_DELAY_MS);
    }
  }

  console.log(
    `\nDone: ${fetched} fetched, ${skipped} skipped-existing, ${errors.length} permanent failures.`
  );
  if (errors.length) {
    console.log(`Failures ledger: ${failuresPath}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
