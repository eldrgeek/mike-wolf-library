#!/usr/bin/env node
/**
 * recover-media.mjs — Recover dropped in-body images for 70YearsWTF posts.
 *
 * For each post in content-cache/70yt/:
 *   1. Fetch body_html serially (429-resilient) if not already cached
 *   2. Cache raw HTML → content-cache/70yt-raw/<slug>.html
 *   3. If no in-body images → leave markdown byte-for-byte untouched
 *   4. If images → download to public/media/70yt/<slug>/N.ext and regenerate
 *      ONLY that post's markdown with inline ![alt](/media/70yt/<slug>/N.ext)
 *
 * Resumable. Serial only. Does not deploy / ingest / build_atlas.
 *
 * Usage:
 *   node scripts/recover-media.mjs
 *   node scripts/recover-media.mjs --slugs a,b
 *   node scripts/recover-media.mjs --limit 5
 *   node scripts/recover-media.mjs --dry-run
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MD_DIR = join(ROOT, 'content-cache/70yt');
const RAW_DIR = join(ROOT, 'content-cache/70yt-raw');
const MEDIA_DIR = join(ROOT, 'public/media/70yt');
const FAILURES = join(ROOT, '_grok/media-failures.txt');
const API = 'https://70yearswtf.substack.com/api/v1/posts';
const COLLECTION = '70YearsWTF';
const AUTHOR = 'Mike Wolf';

/** Polite base delay between successful API fetches (ms). */
const BASE_DELAY_MS = 1800;
/** Delay between image downloads (ms). */
const IMAGE_DELAY_MS = 500;
/** Max retries per request on 429/5xx. */
const MAX_RETRIES = 6;
const BACKOFF_START_MS = 30_000;
const BACKOFF_CAP_MS = 300_000;

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { slugs: [], dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slugs') {
      const v = argv[++i] || '';
      opts.slugs.push(...v.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--limit') {
      opts.limit = Number(argv[++i]);
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  constructor(status, label, body, retryAfterMs) {
    super(`HTTP ${status} for ${label}: ${String(body).slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.label = label;
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

async function fetchWithRetry(url, label, { asBuffer = false } = {}) {
  let attempt = 0;
  let backoff = BACKOFF_START_MS;
  while (true) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: asBuffer ? '*/*' : 'application/json',
          'User-Agent': 'mike-wolf-library/recover-media (local archive)',
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const retryAfterMs =
          res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : null;
        throw new HttpError(res.status, label, body, retryAfterMs);
      }
      if (asBuffer) {
        const ab = await res.arrayBuffer();
        return {
          buffer: Buffer.from(ab),
          contentType: res.headers.get('content-type') || '',
        };
      }
      return res.json();
    } catch (err) {
      const status = err?.status;
      const retriable =
        status === 429 || status === 503 || status === 502 || status === 504 || status === 408;
      // Network errors (no status) — also retry a few times
      const network = !status && err?.name !== 'HttpError';
      if ((!retriable && !network) || attempt >= MAX_RETRIES) throw err;
      attempt++;
      let waitMs;
      if (status === 429 && err.retryAfterMs != null) {
        waitMs = err.retryAfterMs;
      } else {
        waitMs = Math.min(backoff, BACKOFF_CAP_MS);
        backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
      }
      waitMs += Math.floor(Math.random() * 2000);
      console.warn(
        `  ⏳ ${label}: ${status || err.message}, retry ${attempt}/${MAX_RETRIES} after ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
    }
  }
}

function appendFailure(slug, reason) {
  const line = `${new Date().toISOString()}\t${slug}\t${reason.replace(/\s+/g, ' ').slice(0, 400)}\n`;
  const dir = dirname(FAILURES);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(FAILURES, line, 'utf8');
}

// ── Image detection / download ────────────────────────────────────────────────

const MEDIA_URL_RE =
  /(?:substackcdn\.com\/image|substack-post-media\.s3\.amazonaws\.com|bucketeer-[\w-]+\.s3\.amazonaws\.com)/i;

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

function attr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = attrs.match(re);
  return m ? decodeEntities(m[1]) : '';
}

/**
 * Collect candidate download URLs in preference order.
 * Prefer substackcdn.com proxies (always public). Direct bucketeer S3 URLs
 * often 403; substack-post-media S3 usually works but CDN is safer.
 *
 * IMPORTANT: only use URLs that belong to THIS img (src / data-attrs).
 * Do NOT take the first image-link href from a surrounding window — that
 * often belongs to the previous figure and causes false dedupes + wrong files.
 */
function candidateImageUrls(imgAttrs, surroundingHtml) {
  const urls = [];
  const push = (u) => {
    if (!u || !/^https?:\/\//i.test(u)) return;
    const d = decodeEntities(u);
    if (!urls.includes(d)) urls.push(d);
  };

  // 1. img src — substackcdn, always correct for this element
  push(attr(imgAttrs, 'src'));

  // 2. data-attrs original (S3) — good identity; may 403 on bucketeer
  let originalSrc = '';
  const dataAttrs = attr(imgAttrs, 'data-attrs');
  if (dataAttrs) {
    try {
      const parsed = JSON.parse(dataAttrs);
      if (parsed?.srcNoWatermark) push(parsed.srcNoWatermark);
      if (parsed?.src) {
        originalSrc = parsed.src;
        push(parsed.src);
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Parent image-link href ONLY if it embeds the same original asset
  //    (full-quality CDN URL without w_1456 constraint)
  if (originalSrc && surroundingHtml) {
    const hrefRe = /<a\b[^>]*class="[^"]*image-link[^"]*"[^>]*href="([^"]+)"/gi;
    let hm;
    while ((hm = hrefRe.exec(surroundingHtml)) !== null) {
      const href = decodeEntities(hm[1]);
      if (href.includes(encodeURIComponent(originalSrc)) || href.includes(originalSrc)) {
        push(href);
        break;
      }
      // Also match by filename UUID
      const base = originalSrc.split('/').pop();
      if (base && href.includes(base)) {
        push(href);
        break;
      }
    }
  }

  // Prefer: substackcdn without width cap > substackcdn with w_ > direct S3
  urls.sort((a, b) => {
    const score = (u) => {
      let s = /substackcdn\.com/i.test(u) ? 0 : 10;
      if (/[?/,]w_\d+/i.test(u) || /!,w_\d+/i.test(u)) s += 1; // width-capped
      return s;
    };
    return score(a) - score(b);
  });
  return urls.filter((u) => MEDIA_URL_RE.test(u));
}

function bestImageUrl(imgAttrs, surroundingHtml) {
  const cands = candidateImageUrls(imgAttrs, surroundingHtml);
  return cands[0] || '';
}

function extensionFromUrlAndType(url, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('svg')) return 'svg';
  // From URL path (ignore query)
  try {
    const u = new URL(url);
    // substackcdn embeds original path URL-encoded after last /
    const path = decodeURIComponent(u.pathname + u.search);
    const m = path.match(/\.(png|jpe?g|webp|gif|svg)(?:\?|$|&|!)/i);
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
    // S3 direct: .../foo_1646x920.png
    const m2 = u.pathname.match(/\.(png|jpe?g|webp|gif|svg)$/i);
    if (m2) return m2[1].toLowerCase().replace('jpeg', 'jpg');
  } catch {
    /* ignore */
  }
  return 'jpg';
}

/**
 * Find in-body images in document order.
 * Returns [{ url, alt, captionHtml, index }]
 */
function findInBodyImages(html) {
  const found = [];
  const seenUrls = new Set();
  const re = /<img\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const imgAttrs = m[1];
    // Window of surrounding HTML for caption / href
    const start = Math.max(0, m.index - 800);
    const end = Math.min(html.length, m.index + m[0].length + 2500);
    const window = html.slice(start, end);

    const url = bestImageUrl(imgAttrs, window);
    if (!url || !MEDIA_URL_RE.test(url)) continue;

    // Skip tiny tracking/spacer-ish (rare); keep everything media-looking
    const alt = attr(imgAttrs, 'alt') || '';

    // Caption: only from the enclosing <figure>…</figure> that contains this img
    // (wide fixed windows grab the NEXT figure's figcaption).
    let captionHtml = '';
    const figStart = html.lastIndexOf('<figure', m.index);
    if (figStart !== -1) {
      const close = html.indexOf('</figure>', m.index);
      if (close !== -1 && close > m.index) {
        const figHtml = html.slice(figStart, close + '</figure>'.length);
        // Ensure no nested figure boundary between start and this img
        if (!/<figure\b/i.test(figHtml.slice(7, m.index - figStart))) {
          const figCap = figHtml.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
          if (figCap) captionHtml = figCap[1];
        }
      }
    }

    // Dedupe by URL (srcset variants of same image share underlying asset)
    const dedupeKey = normalizeImageKey(url);
    if (seenUrls.has(dedupeKey)) continue;
    seenUrls.add(dedupeKey);

    const candidates = candidateImageUrls(imgAttrs, window);
    found.push({
      url: candidates[0] || url,
      candidates: candidates.length ? candidates : url ? [url] : [],
      alt,
      captionHtml,
      index: found.length, // 0-based assignment order
    });
  }
  return found;
}

/** Normalize for dedupe: identity = filename under /public/images/ (not bucket UUID). */
function normalizeImageKey(url) {
  try {
    const u = new URL(url);
    const raw = u.pathname + u.search;
    // Prefer decoded path so %2Fpublic%2Fimages%2F becomes /public/images/
    let dec = raw;
    try {
      dec = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    // Filename after /public/images/ — the actual asset id
    const underImages = dec.match(/\/public\/images\/([^/?#\s"']+)/i);
    if (underImages) return underImages[1].toLowerCase();

    // Fallback: last path segment that looks like UUID_WxH.ext
    const fileM = dec.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[^/?#\s"']+)/i
    );
    if (fileM) return fileM[1].toLowerCase();

    if (/substack-post-media|bucketeer/i.test(u.hostname)) {
      return (u.pathname.split('/').pop() || url).toLowerCase();
    }
    return url.split('?')[0];
  } catch {
    return url;
  }
}

function localImagePath(slug, n, ext) {
  // 1-based filenames: 1.png, 2.jpg, ...
  return join(MEDIA_DIR, slug, `${n}.${ext}`);
}

function publicImagePath(slug, n, ext) {
  return `/media/70yt/${slug}/${n}.${ext}`;
}

async function downloadImage(urls, destPath) {
  if (existsSync(destPath) && statSync(destPath).size > 0) {
    return { skipped: true, bytes: statSync(destPath).size };
  }
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr;
  for (const url of list) {
    try {
      const { buffer, contentType } = await fetchWithRetry(url, `img ${url.slice(0, 80)}`, {
        asBuffer: true,
      });
      // Reject tiny error bodies (XML AccessDenied etc.)
      if (buffer.length < 200 && /accessdenied|error|forbidden/i.test(buffer.toString('utf8'))) {
        lastErr = new Error(`rejected error body from ${url.slice(0, 80)}`);
        continue;
      }
      const dir = dirname(destPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(destPath, buffer);
      return { skipped: false, bytes: buffer.length, contentType, url };
    } catch (err) {
      lastErr = err;
      // try next candidate (403 on S3 → CDN etc.)
      continue;
    }
  }
  throw lastErr || new Error('no image URLs');
}

// ── HTML → Markdown (image-preserving variant of fetch-70yt) ──────────────────

function balancedElement(html, openIdx) {
  const openMatch = html.slice(openIdx).match(/^<([a-zA-Z][\w:-]*)\b[^>]*>/);
  if (!openMatch) return null;
  const tag = openMatch[1].toLowerCase();
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
 * Strip Substack chrome but KEEP in-body images as \u0000IMG n\u0000 placeholders.
 * imageSlots is the ordered list from findInBodyImages (for caption pairing).
 * placeholderMap: n → { alt, captionMd, publicPath }
 */
function stripCruftKeepImages(html, placeholderMap) {
  let h = html;

  for (const tag of ['script', 'style', 'svg', 'iframe', 'button', 'noscript']) {
    h = replaceBalanced(h, tag, () => '');
  }

  // Build lookup from image URL key → placeholder index by re-scanning as we walk
  // Instead, replace images in document order matching placeholderMap keys 0..n-1
  let imgCursor = 0;

  const emitImageBlock = (outer) => {
    const caps = [...outer.matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi)].map(
      (m) => m[1]
    );
    // Does this outer contain a media img?
    if (!/<img\b/i.test(outer) || !MEDIA_URL_RE.test(outer)) {
      if (!caps.length) return '';
      return caps.map((c) => `<p><em>${c}</em></p>`).join('');
    }
    const n = imgCursor++;
    const slot = placeholderMap.get(n);
    if (!slot) {
      return caps.map((c) => `<p><em>${c}</em></p>`).join('');
    }
    // Prefer caption from the live HTML outer (reliable); fall back to map
    const captionHtml = caps[0] || slot.captionHtml || '';
    let out = `<p>\u0000IMG${n}\u0000</p>`;
    if (captionHtml) {
      out += `<p><em>${captionHtml}</em></p>`;
    }
    return out;
  };

  function stripDivs(fragment) {
    return replaceBalanced(fragment, 'div', (outer, inner) => {
      if (/class="[^"]*captioned-image-container/i.test(outer)) return emitImageBlock(outer);
      if (/class="[^"]*youtube-wrap/i.test(outer)) return '';
      if (
        /class="[^"]*(?:subscribe-widget|subscription-widget|paywall|like-button|share-dialog)/i.test(
          outer
        )
      ) {
        return '';
      }
      // image2-inset is inside captioned containers; if we see it bare, emit image
      if (/class="[^"]*image2-inset/i.test(outer)) {
        // Parent figure/captioned usually handles it; if still here, emit
        if (/<img\b/i.test(outer) && MEDIA_URL_RE.test(outer)) return emitImageBlock(outer);
        return '';
      }
      return stripDivs(inner);
    });
  }
  h = stripDivs(h);

  h = replaceBalanced(h, 'figure', (outer) => emitImageBlock(outer));

  // Standalone image-link anchors not already handled.
  // CRITICAL: nested image2-inset may already have been replaced with
  // \u0000IMGn\u0000 placeholders — do NOT return '' and wipe them.
  h = replaceBalanced(h, 'a', (outer, inner) => {
    if (/class="[^"]*image-link/i.test(outer)) {
      if (/<img\b/i.test(outer) && MEDIA_URL_RE.test(outer)) return emitImageBlock(outer);
      if (/\u0000IMG\d+\u0000/.test(inner)) return inner; // keep placeholder
      return '';
    }
    return outer;
  });
  h = replaceBalanced(h, 'picture', (outer, inner) => {
    if (/<img\b/i.test(outer) && MEDIA_URL_RE.test(outer)) return emitImageBlock(outer);
    if (/\u0000IMG\d+\u0000/.test(inner)) return inner;
    return '';
  });

  // Any remaining bare media imgs
  h = h.replace(/<img\b([^>]*)\/?>/gi, (full, attrs) => {
    if (!MEDIA_URL_RE.test(full)) return '';
    const n = imgCursor++;
    if (!placeholderMap.has(n)) return '';
    return `<p>\u0000IMG${n}\u0000</p>`;
  });
  h = h.replace(/<source\b[^>]*\/?>/gi, '');

  h = h.replace(/<\/?span\b[^>]*>/gi, '');
  h = h.replace(/<\/(?:figure|picture|button|div)\s*>/gi, '');
  h = h.replace(/<(?:figure|picture|div)\b[^>]*>/gi, '');

  // ZWSP / BOM
  h = h.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  return h;
}

function inlineToMd(html) {
  let s = html;
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    let t = inlineToMd(text).replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ');
    const lead = (t.match(/^\s*/) || [''])[0];
    const trail = (t.match(/\s*$/) || [''])[0];
    t = t.trim();
    const h = href.replace(/&amp;/g, '&');
    if (!t) return lead + trail;
    // Drop image CDN links that slipped through as anchors
    if (MEDIA_URL_RE.test(h) && !t) return lead + trail;
    if (/substackcdn\.com\/image/i.test(h) && !/^https?:\/\/70yearswtf/i.test(h)) {
      // pure image link with text — keep text only
      if (!t || t === h) return lead + trail;
    }
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
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s);
}

function listToMd(html, ordered) {
  const items = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let inner = m[1];
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
      const lines = t.split('\n');
      return lines.map((line, j) => (j === 0 ? bullet + line : '  ' + line)).join('\n');
    })
    .join('\n');
}

function htmlToMarkdownWithImages(rawHtml, placeholderMap) {
  let html = rawHtml || '';

  html = html.replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n');

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

  html = stripCruftKeepImages(html, placeholderMap);

  html = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    // Pass the same placeholderMap so \u0000IMGn\u0000 tokens inside
    // blockquotes resolve to real markdown images (not empty string).
    const innerMd = htmlToMarkdownWithImages(inner, placeholderMap).trim();
    const quoted = innerMd
      .split('\n')
      .map((l) => (l.trim() ? `> ${l}` : '>'))
      .join('\n');
    return `\n\n${quoted}\n\n`;
  });

  html = html.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, body) => {
    return '\n\n' + listToMd(body, tag.toLowerCase() === 'ol') + '\n\n';
  });

  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const text = inlineToMd(inner).replace(/\n+/g, ' ').trim();
    if (!text) return '';
    return `\n\n${'#'.repeat(Number(level))} ${text}\n\n`;
  });

  html = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => {
    // Preserve image placeholders inside paragraphs
    if (/\u0000IMG\d+\u0000/.test(inner) && !/<[a-zA-Z]/.test(inner.replace(/\u0000IMG\d+\u0000/g, ''))) {
      return `\n\n${inner.trim()}\n\n`;
    }
    const text = inlineToMd(inner).trim();
    if (!text) return '\n\n';
    return `\n\n${text}\n\n`;
  });

  html = html.replace(/<\/?(?:span|section|article|header|footer|main|nav)\b[^>]*>/gi, '');

  if (/<[a-zA-Z]/.test(html)) {
    html = inlineToMd(html);
  } else {
    html = decodeEntities(html);
  }

  html = html.replace(/\u0000PRE(\d+)\u0000/g, (_, n) => prePlaceholders[Number(n)] || '');

  // Restore image placeholders as markdown — AFTER normalize-ish cleanup but protect them
  // First normalize without nuking placeholders
  let s = normalizeMarkdownKeepImages(html);

  s = s.replace(/\u0000IMG(\d+)\u0000/g, (_, nStr) => {
    const n = Number(nStr);
    const slot = placeholderMap.get(n);
    if (!slot) return '';
    const alt = (slot.alt || '').replace(/[[\]]/g, '');
    return `![${alt}](${slot.publicPath})`;
  });

  // Final blank-line collapse after image injection
  s = s.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return s;
}

function normalizeMarkdownKeepImages(md) {
  let s = md;
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  // Drop empty markdown image/link shells that are still remote CDN
  s = s.replace(/!\[.*?\]\(https?:\/\/substackcdn\.com[^)]+\)/g, '');
  s = s.replace(/\[\]\(https?:\/\/substackcdn\.com[^)]+\)/g, '');
  // Keep \u0000IMG placeholders — do not strip as HTML
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  s = s
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^!\[.*\]\(https?:\/\/substackcdn\.com/i.test(t)) return false;
      if (/^\[\]\(https?:\/\/substackcdn\.com/i.test(t)) return false;
      if (/^https?:\/\/substackcdn\.com\S*$/i.test(t)) return false;
      // Drop Subscribe-now chrome lines
      if (/^Subscribe now$/i.test(t)) return false;
      if (/^Thanks for reading/i.test(t)) return false;
      if (/^Share this post$/i.test(t)) return false;
      return true;
    })
    .join('\n');

  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();

  s = s.replace(/\n{3,}/g, '\n\n');
  return s + '\n';
}

// ── Frontmatter preservation ──────────────────────────────────────────────────

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: null, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: null, body: text };
  const fm = text.slice(0, end + 4); // include closing ---
  let body = text.slice(end + 4);
  if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatter: fm, body };
}

/**
 * Preserve leading Mem editorial notes that are not from Substack body_html.
 * Pattern: blockquote "Why canonical" and optional trailing --- before real body.
 */
function extractEditorialPreamble(existingBody) {
  if (!existingBody) return '';
  const lines = existingBody.split('\n');
  // Detect start: > *Why canonical or > Why canonical
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return '';
  const first = lines[i];
  if (!/^>\s*\*?Why canonical/i.test(first) && !/^>\s*\*Why canonical/i.test(first)) {
    // Also accept other Mem notes starting with "> *Why"
    if (!/^>\s*\*.*Mem/i.test(first)) return '';
  }
  // Consume blockquote lines and following blank lines / --- separators
  let end = i;
  while (end < lines.length) {
    const t = lines[end];
    if (t.startsWith('>')) {
      end++;
      continue;
    }
    if (t.trim() === '') {
      end++;
      continue;
    }
    if (/^---+$/.test(t.trim()) || /^\* \* \*$/.test(t.trim())) {
      end++;
      // include trailing blanks after separator
      while (end < lines.length && lines[end].trim() === '') end++;
      break;
    }
    break;
  }
  const preamble = lines.slice(0, end).join('\n').replace(/\s+$/, '');
  return preamble ? preamble + '\n\n' : '';
}

function captionHtmlToPlain(captionHtml) {
  if (!captionHtml) return '';
  // Lightweight: strip tags, decode, collapse
  return inlineToMd(captionHtml).replace(/\n+/g, ' ').trim();
}

// ── Per-slug processing ───────────────────────────────────────────────────────

function listAllSlugs() {
  if (!existsSync(MD_DIR)) return [];
  return readdirSync(MD_DIR)
    .filter((f) => f.startsWith('70yearswtf-') && f.endsWith('.md'))
    .map((f) => f.replace(/^70yearswtf-/, '').replace(/\.md$/, ''))
    .sort();
}

function rawPath(slug) {
  return join(RAW_DIR, `${slug}.html`);
}

function noImagesMarker(slug) {
  return join(RAW_DIR, `${slug}.noimages`);
}

function mdPath(slug) {
  return join(MD_DIR, `70yearswtf-${slug}.md`);
}

function imagesFullyPresent(slug, count, exts) {
  // Check 1.ext .. count.ext exist for some ext
  for (let n = 1; n <= count; n++) {
    let ok = false;
    for (const ext of exts || ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
      const p = localImagePath(slug, n, ext === 'jpeg' ? 'jpg' : ext);
      if (existsSync(p) && statSync(p).size > 0) {
        ok = true;
        break;
      }
    }
    // Also check without knowing ext: any file starting with n.
    if (!ok) {
      const dir = join(MEDIA_DIR, slug);
      if (existsSync(dir)) {
        const files = readdirSync(dir);
        if (files.some((f) => f === `${n}.png` || f === `${n}.jpg` || f === `${n}.webp` || f === `${n}.gif` || f === `${n}.jpeg`)) {
          ok = true;
        }
      }
    }
    if (!ok) return false;
  }
  return count > 0;
}

function findExistingLocalImages(slug, count) {
  // Return map n(0-based) → { publicPath, absPath, ext }
  const out = new Map();
  const dir = join(MEDIA_DIR, slug);
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir);
  for (let n = 1; n <= count; n++) {
    const hit = files.find((f) => new RegExp(`^${n}\\.(png|jpe?g|webp|gif|svg)$`, 'i').test(f));
    if (hit) {
      const ext = extname(hit).slice(1).toLowerCase().replace('jpeg', 'jpg');
      out.set(n - 1, {
        publicPath: publicImagePath(slug, n, ext),
        absPath: join(dir, hit),
        ext,
        filename: hit,
      });
    }
  }
  return out;
}

async function ensureRawHtml(slug, dryRun) {
  const rp = rawPath(slug);
  if (existsSync(rp) && statSync(rp).size > 0) {
    return { html: readFileSync(rp, 'utf8'), fetched: false };
  }
  if (dryRun) {
    return { html: null, fetched: false, missing: true };
  }
  const post = await fetchWithRetry(`${API}/${encodeURIComponent(slug)}`, slug);
  const html = post.body_html || '';
  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(rp, html, 'utf8');
  // Side-cache minimal meta for debugging
  const meta = {
    slug: post.slug || slug,
    title: post.title || null,
    post_date: post.post_date || null,
    cover_image: post.cover_image || null,
    canonical_url: post.canonical_url || null,
  };
  writeFileSync(join(RAW_DIR, `${slug}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
  return { html, fetched: true, post };
}

async function processSlug(slug, dryRun, stats) {
  stats.scanned++;

  // Resume: raw cached + noimages marker → skip
  if (existsSync(noImagesMarker(slug)) && existsSync(rawPath(slug))) {
    stats.noImages++;
    stats.skippedUntouched++;
    return { status: 'no-images-cached' };
  }

  const { html, fetched, missing } = await ensureRawHtml(slug, dryRun);
  if (fetched) stats.apiFetched++;
  if (missing) {
    console.log(`  [dry-run] would fetch ${slug}`);
    return { status: 'dry-missing-raw' };
  }

  const images = findInBodyImages(html);
  if (images.length === 0) {
    if (!dryRun) {
      writeFileSync(noImagesMarker(slug), 'no in-body media images\n', 'utf8');
    }
    stats.noImages++;
    stats.skippedUntouched++;
    return { status: 'no-images' };
  }

  stats.withImages++;
  stats.imagesFound += images.length;

  // Download images 1..N
  const placeholderMap = new Map();
  let allLocal = true;
  const existing = findExistingLocalImages(slug, images.length);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    let publicPath;
    let ext;

    if (existing.has(i)) {
      const ex = existing.get(i);
      publicPath = ex.publicPath;
      ext = ex.ext;
      stats.imagesSkippedExisting++;
    } else {
      // Guess ext from URL first; may refine after download
      const candUrls = img.candidates?.length ? img.candidates : [img.url];
      ext = extensionFromUrlAndType(candUrls[0] || img.url, '');
      const dest = localImagePath(slug, i + 1, ext);
      if (dryRun) {
        publicPath = publicImagePath(slug, i + 1, ext);
        allLocal = false;
      } else {
        try {
          const result = await downloadImage(candUrls, dest);
          if (result.skipped) {
            stats.imagesSkippedExisting++;
          } else {
            stats.imagesDownloaded++;
            stats.bytesDownloaded += result.bytes;
            // Fix extension if content-type disagrees
            const realExt = extensionFromUrlAndType(result.url || candUrls[0], result.contentType);
            if (realExt !== ext && result.contentType) {
              const newDest = localImagePath(slug, i + 1, realExt);
              if (newDest !== dest) {
                writeFileSync(newDest, readFileSync(dest));
                try {
                  const { unlinkSync } = await import('fs');
                  unlinkSync(dest);
                } catch {
                  /* keep both if rename fails */
                }
                ext = realExt;
              }
            }
          }
          publicPath = publicImagePath(slug, i + 1, ext);
          await sleep(IMAGE_DELAY_MS);
        } catch (err) {
          allLocal = false;
          stats.imageFailures++;
          const reason = `image ${i + 1}/${images.length} ${candUrls[0]?.slice(0, 120)}: ${err.message}`;
          console.error(`  ✗ ${slug}: ${reason}`);
          appendFailure(slug, reason);
          // Still place a remote-free placeholder path so MD regenerates consistently
          publicPath = publicImagePath(slug, i + 1, ext);
        }
      }
    }

    const captionPlain = captionHtmlToPlain(img.captionHtml);
    placeholderMap.set(i, {
      alt: img.alt || captionPlain || '',
      captionHtml: img.captionHtml,
      captionPlain,
      publicPath,
      url: img.url,
    });
  }

  // Regenerate markdown
  const bodyMd = htmlToMarkdownWithImages(html, placeholderMap);

  // Preserve existing frontmatter + editorial preamble
  const existingMdPath = mdPath(slug);
  let frontmatter = null;
  let preamble = '';
  if (existsSync(existingMdPath)) {
    const existingText = readFileSync(existingMdPath, 'utf8');
    const split = splitFrontmatter(existingText);
    frontmatter = split.frontmatter;
    preamble = extractEditorialPreamble(split.body);
  }

  if (!frontmatter) {
    // Minimal fallback frontmatter
    let meta = {};
    const metaPath = join(RAW_DIR, `${slug}.meta.json`);
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      } catch {
        /* ignore */
      }
    }
    frontmatter = [
      '---',
      `title: "${String(meta.title || slug).replace(/"/g, '\\"')}"`,
      `collection: "${COLLECTION}"`,
      'kind: "post"',
      'order: 0',
      meta.post_date ? `date: "${String(meta.post_date).slice(0, 10)}"` : null,
      `author: "${AUTHOR}"`,
      `original_url: "${meta.canonical_url || `https://70yearswtf.substack.com/p/${slug}`}"`,
      'excerpt: ""',
      'word_count: 0',
      'tags:',
      `  - "${COLLECTION}"`,
      'related: []',
      '---',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Update word_count in frontmatter to reflect new body
  const wordCount = bodyMd
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  frontmatter = frontmatter.replace(
    /^word_count:\s*.*$/m,
    `word_count: ${wordCount}`
  );

  const content = `${frontmatter}\n\n${preamble}${bodyMd.trim()}\n`;

  if (dryRun) {
    console.log(
      `  [dry-run] ${slug}: ${images.length} images, would write ${existingMdPath} (${content.length} bytes)`
    );
    stats.regenerated++;
    return { status: 'dry-regen', images: images.length };
  }

  writeFileSync(existingMdPath, content, 'utf8');
  stats.regenerated++;
  return { status: 'regenerated', images: images.length, allLocal };
}

function dirSizeBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage:
  node scripts/recover-media.mjs
  node scripts/recover-media.mjs --slugs a,b
  node scripts/recover-media.mjs --limit 5
  node scripts/recover-media.mjs --dry-run`);
    process.exit(0);
  }

  let slugs = opts.slugs.length ? opts.slugs : listAllSlugs();
  slugs = [...new Set(slugs)];
  if (opts.limit != null && Number.isFinite(opts.limit)) {
    slugs = slugs.slice(0, opts.limit);
  }

  if (!slugs.length) {
    console.error('No slugs found.');
    process.exit(2);
  }

  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });

  console.log(
    `Media recovery: ${slugs.length} post(s)\n` +
      `  raw→${RAW_DIR}\n` +
      `  media→${MEDIA_DIR}\n` +
      `  md→${MD_DIR}\n` +
      `  delay API=${BASE_DELAY_MS}ms images=${IMAGE_DELAY_MS}ms  maxRetries=${MAX_RETRIES}` +
      (opts.dryRun ? '  (dry-run)' : '') +
      '\n'
  );

  const stats = {
    scanned: 0,
    withImages: 0,
    noImages: 0,
    skippedUntouched: 0,
    regenerated: 0,
    imagesFound: 0,
    imagesDownloaded: 0,
    imagesSkippedExisting: 0,
    imageFailures: 0,
    apiFetched: 0,
    bytesDownloaded: 0,
    permanentFailures: 0,
  };

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const progress = `[${i + 1}/${slugs.length}]`;
    process.stdout.write(`${progress} ${slug} … `);

    try {
      const result = await processSlug(slug, opts.dryRun, stats);
      if (result.status === 'no-images' || result.status === 'no-images-cached') {
        console.log('no images (md untouched)');
      } else if (result.status === 'regenerated') {
        console.log(`✓ ${result.images} image(s), md regenerated`);
      } else if (result.status === 'dry-regen') {
        console.log(`dry-run ${result.images} image(s)`);
      } else {
        console.log(result.status);
      }

      // Polite delay after real API fetch only
      // processSlug doesn't tell us easily after return — use fetched flag via stats change
      // Always small pause when we might have hit API; if raw was cached, still brief yield
      if (!opts.dryRun) {
        // If we just wrote raw (fetched), BASE_DELAY; else tiny pause for fairness
        // Heuristic: if raw mtime is very recent (< 3s), we fetched
        const rp = rawPath(slug);
        let justFetched = false;
        if (existsSync(rp)) {
          const age = Date.now() - statSync(rp).mtimeMs;
          justFetched = age < 5000;
        }
        await sleep(justFetched ? BASE_DELAY_MS : 50);
      }
    } catch (err) {
      stats.permanentFailures++;
      console.error(`\n✗ ${progress} ${slug}: ${err.message}`);
      if (!opts.dryRun) appendFailure(slug, err.message);
      await sleep(BASE_DELAY_MS);
    }
  }

  const totalMediaBytes = dirSizeBytes(MEDIA_DIR);
  const mb = (totalMediaBytes / (1024 * 1024)).toFixed(2);

  console.log(`
═══════════════════════════════════════════════════════════
MEDIA RECOVERY REPORT
═══════════════════════════════════════════════════════════
posts scanned:              ${stats.scanned}
posts with images:          ${stats.withImages}
posts without images:       ${stats.noImages} (markdown untouched)
markdown files regenerated: ${stats.regenerated}
images found:               ${stats.imagesFound}
images downloaded:          ${stats.imagesDownloaded}
images already on disk:     ${stats.imagesSkippedExisting}
image permanent failures:   ${stats.imageFailures}
API fetches this run:       ${stats.apiFetched}
post permanent failures:    ${stats.permanentFailures}
total in public/media/70yt: ${mb} MB (${totalMediaBytes} bytes)
failures ledger:            ${FAILURES}
═══════════════════════════════════════════════════════════
`);

  if (stats.permanentFailures > 0 || stats.imageFailures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
