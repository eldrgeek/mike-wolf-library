/* copy-canonize — SOMA §17 Tier 1 publish, with the loop actually closed.
 *
 * ── The wrinkle this function exists to solve ────────────────────────────────
 *
 * The Library's dictionary is GENERATED. `scripts/ingest.mjs` builds
 * `src/content/terms/*.md` from two upstream sources:
 *
 *   1. content-cache/terms-extra/<slug>.md   (in THIS repo — 395 terms)
 *   2. ~/Projects/soma-lexicon/SOMA-LEXICON.md (a DIFFERENT repo — ~63 terms)
 *
 * If "Make canonical" only stored a database override, the next `npm run
 * ingest` would silently revert Mike's edit and the site would have two
 * sources of truth — the exact failure SOMA/standards/soma-live-edit forbids.
 * If it only patched the generated file, `npm run ingest` would still revert
 * it. Closure therefore requires patching the UPSTREAM file, and the generated
 * file alongside it so the change ships now instead of at the next ingest.
 *
 * So canonize does a literal string swap — the same swap a build worker would
 * do, on exactly the key the standard mandates, (route, original_text,
 * occurrence) — directly against the repo via the GitHub Git Data API, in ONE
 * commit covering both layers. GitHub → Netlify auto-deploy → a logged-out
 * visitor reads the new words out of static HTML. No override is served at
 * runtime and the public read path stays $0/query.
 *
 * What this function CANNOT reach is SOMA-LEXICON.md, which lives in another
 * repo. Those rows come back `reason:'upstream-out-of-repo:soma-lexicon'`, stay
 * `canonical`, and are closed by `tools/apply-canonical-copy.mjs`, which runs as
 * the first step of `npm run ingest` — so ingest patches the lexicon before it
 * regenerates, and can never revert an edit. See that file's header.
 *
 * ── Matching (SOMA/standards/soma-live-edit/ADOPT.md §5d, 2026-09-16) ─────────
 *
 * The engine's original_text is one WHOLE, VISIBLE text node, so only whole,
 * visible text in a source file counts as a hit:
 *
 *   - .astro site copy: the layout and the edited route's own page only; not
 *     the frontmatter, <head>, <script>, <style>, <title>, comments or
 *     attributes; markup or an Astro expression on both sides.
 *   - a term .md file: the body (HTML), plus the frontmatter values the
 *     dictionary actually renders (title, subtitle, theme, link_label, and the
 *     origin line). Every other frontmatter key is data, not copy.
 *
 * An HTML entity in the source matches the character the DOM shows, and a
 * quote escaped inside a YAML string matches the quote itself. The element a
 * hit sits in must be the clicked text's parent (the row's element_tag).
 *
 * The two term layers do not split text in the same places. ingest wraps term
 * mentions and corpus references in links, and turns `*x*` / `**x**` into
 * <em> / <strong>, so one sentence upstream can be two text nodes on the page.
 * The generated file is matched strictly, because it is what the page renders,
 * and it decides which field the upstream match must be in. Only on a side
 * where the generated match touches an inline link/em/strong may the upstream
 * match end at a word boundary or an asterisk instead of at markup. Both layers
 * are patched, or neither: a generated-only patch is a silent revert at the
 * next ingest.
 *
 * Proven 2026-09-16 against the real sources: one edit per entry in both
 * layers, then `node scripts/ingest.mjs`, regenerated 395 of 395 body edits and
 * 181 of 181 origin edits byte-identical to what this function wrote. 61 site
 * copy edits, rebuilt with astro, changed exactly the planned text and nothing
 * else on the five routed pages.
 *
 * ── One base commit ──────────────────────────────────────────────────────────
 *
 * The branch is resolved to a sha once. Every file is read at that sha, the new
 * tree and the commit's parent come from it, and the ref update is not forced,
 * so a concurrent push returns 409 and publishes nothing. A read by branch name
 * straight after a commit can return the previous version, and a second edit
 * built on it would quietly undo the first.
 *
 * ── Retirement ───────────────────────────────────────────────────────────────
 *
 * A row retires when every layer this repo holds says the new words: patched in
 * the commit that just landed (the ref moved non-forced, so the branch holds
 * exactly the tree built from the files read), or already saying them (a retry
 * after a lost response). Until 2026-09-16 every row stayed `canonical` for the
 * local tool to retire. That made an edit and its undo two live canonical rows,
 * and the tool, which applies rows in whatever order the database returns them,
 * could apply the edit again after the undo. A lexicon term still stays
 * canonical, because its source is out of reach here.
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * The caller's Supabase JWT is passed straight through to `is_app_admin(app)`
 * — the same question RLS asks. No email allow-list, here or in the client.
 */

const APP = 'mike-wolf-library';
const SUPABASE_URL = 'https://omfwcodoimjmbrhssvfl.supabase.co';
const ANON_KEY = 'sb_publishable_vi2qDWjozUJ5mi9dwirkLA_rj6UaqLf';
const REPO = process.env.GITHUB_REPO || 'eldrgeek/mike-wolf-library';
const BRANCH = process.env.GITHUB_BRANCH || 'master';
const GH = 'https://api.github.com';

// Site copy that is not generated: searched when the edit did not happen
// inside a dictionary entry. A page's text comes from the layout and from that
// route's own page file, and from nowhere else — searching every page let the
// nav link "Dictionary" on / match a <p>Dictionary</p> in the dictionary page.
const LAYOUT = 'src/layouts/Base.astro';
const ROUTE_PAGES = {
  '/': 'src/pages/index.astro',
  '/about/': 'src/pages/about/index.astro',
  '/dictionary/': 'src/pages/dictionary/index.astro',
  '/corpus/': 'src/pages/corpus/index.astro',
  '/atlas/': 'src/pages/atlas/index.astro',
};
export const siteCopyFiles = (route) => [LAYOUT, ...(ROUTE_PAGES[route] ? [ROUTE_PAGES[route]] : [])];
export const upstreamTermFile = (slug) => `content-cache/terms-extra/${slug}.md`;
export const generatedTermFile = (slug) => `src/content/terms/${slug}.md`;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/* ── matching ─────────────────────────────────────────────────────────────── */

// Either spelling of a character is the same sentence to a reader. Named
// entities for the characters these sources spell that way; any non-ASCII
// character also matches its numeric forms.
const ENTITY_ALTS = {
  '—': ['&mdash;'],
  '–': ['&ndash;'],
  '’': ['&rsquo;'],
  '‘': ['&lsquo;'],
  '“': ['&ldquo;'],
  '”': ['&rdquo;'],
  '…': ['&hellip;'],
  '→': ['&rarr;'],
  '←': ['&larr;'],
  'á': ['&aacute;'],
  'é': ['&eacute;'],
  '©': ['&copy;'],
  '&': ['&amp;', '&#38;'],
  '<': ['&lt;', '&#60;'],
  '>': ['&gt;', '&#62;'],
  '"': ['&quot;', '&#34;'],
  "'": ['&apos;', '&#39;'],
  '{': ['&#123;'],
  '}': ['&#125;'],
};
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ctx.entities: the text is HTML, so entities count. ctx.quote: the text sits
// inside a YAML string with that quote character, so its escapes count.
function charPattern(ch, ctx) {
  const alts = [];
  if (ctx.quote === '"' && (ch === '"' || ch === '\\')) alts.push(reEscape('\\' + ch));
  if (ctx.quote === "'" && ch === "'") alts.push("''");
  if (ctx.entities) {
    alts.push(...(ENTITY_ALTS[ch] || []).map(reEscape));
    const cp = ch.codePointAt(0);
    if (cp > 127) {
      const hex = cp.toString(16).replace(/[a-f]/g, (d) => `[${d}${d.toUpperCase()}]`);
      alts.push(`&#0*${cp};`, `&#[xX]0*${hex};`);
    }
  }
  return alts.length ? `(?:${[reEscape(ch), ...alts].join('|')})` : reEscape(ch);
}

/* Whitespace-flexible literal match. The DOM collapses runs of whitespace; the
 * source file may wrap the same sentence across lines. Matching on the exact
 * bytes would fail on every wrapped paragraph, which is most of them. */
export function flexible(literal, ctx = { entities: true, quote: '' }) {
  let src = '';
  let inSpace = false;
  for (const ch of literal) {
    if (/\s/.test(ch)) {
      if (!inSpace) src += ctx.entities ? '(?:\\s|&nbsp;)+' : '\\s+';
      inSpace = true;
      continue;
    }
    inSpace = false;
    src += charPattern(ch, ctx);
  }
  return new RegExp(src, 'g');
}

const FRONTMATTER = /^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/;

/* A source file as regions of visible text, in the order the page renders them
 * (occurrence counts in page order, not file order). kind 'astro' and 'html'
 * are markup (a hit is a whole run between tags); kind 'plain' is a YAML value
 * rendered as text (a hit is the whole value).
 *
 * A term entry renders, in order (src/pages/dictionary/index.astro):
 *   <h2>title</h2> <span>theme</span> <p>subtitle</p> <div>body</div>
 *   <span>origin</span> … <a>link_label</a>
 * `wrapper` is the element the template puts that value in, so it is the parent
 * of any text the value does not wrap in tags of its own. */
const TERM_FIELDS = {
  title: { order: 0, wrapper: 'h2' },
  theme: { order: 1, wrapper: 'span' },
  subtitle: { order: 2, wrapper: 'p' },
  body: { order: 3, wrapper: 'div' },
  origin: { order: 4, wrapper: 'span' },
  link_label: { order: 5, wrapper: 'a' },
};
export function regions(path, text) {
  if (path.endsWith('.astro')) {
    const fm = FRONTMATTER.exec(text);
    return [{ start: fm ? fm[0].length : 0, end: text.length, kind: 'astro', quote: '', order: 0, wrapper: null }];
  }
  const out = [];
  const fm = FRONTMATTER.exec(text);
  out.push({ start: fm ? fm[0].length : 0, end: text.length, kind: 'html', quote: '', field: 'body' });
  if (fm) {
    const lines = [...fm[0].matchAll(/^([A-Za-z_]+):[ \t]*(.*?)[ \t]*$/dgm)];
    const keys = new Set(lines.map((m) => m[1]));
    // The dictionary renders origin_html when the generated file has it, else
    // origin (which is all an upstream file has), else source — as HTML.
    const originKey = ['origin_html', 'origin', 'source'].find((k) => keys.has(k));
    for (const m of lines) {
      const key = m[1];
      if (['origin_html', 'origin', 'source'].includes(key) && key !== originKey) continue;
      const field = key === originKey ? 'origin' : key;
      if (field === 'body' || !(field in TERM_FIELDS)) continue;
      let [start, end] = m.indices[2];
      const raw = m[2];
      if (!raw || raw === '[]' || raw === '""' || raw === "''") continue;
      let quote = '';
      if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0])) {
        quote = raw[0]; start += 1; end -= 1;
      }
      out.push({ start, end, kind: field === 'origin' ? 'html' : 'plain', quote, field });
    }
  }
  for (const r of out) Object.assign(r, TERM_FIELDS[r.field]);
  return out;
}

// Inside markup regions: the places a visitor never reads as text.
function hiddenRanges(text, r) {
  const sub = text.slice(r.start, r.end);
  const res = [/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, /<(script|style|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
               /<!--[\s\S]*?-->/g, /<[a-zA-Z\/!][^>]*>/g];
  const ranges = [];
  for (const re of res) for (const m of sub.matchAll(re)) ranges.push([r.start + m.index, r.start + m.index + m[0].length]);
  return ranges;
}

// The element a text run sits directly inside, as the page's DOM will see it.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function enclosingTag(text, r, index) {
  const stack = [];
  const sub = text.slice(r.start, index).replace(/<!--[\s\S]*?-->/g, '');
  for (const m of sub.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const name = m[2].toLowerCase();
    if (m[1]) { const i = stack.lastIndexOf(name); if (i >= 0) stack.length = i; }
    else if (!m[3] && !VOID.has(name)) stack.push(name);
  }
  return stack.length ? stack[stack.length - 1] : r.wrapper;
}

const INLINE_TAG_BEFORE = /<\/?(?:a|em|strong)\b[^>]*>$/i;
const INLINE_TAG_AFTER = /^<\/?(?:a|em|strong)\b/i;
const isWordChar = (c) => Boolean(c) && /[\p{L}\p{N}_]/u.test(c);

/* Is this hit a whole run of text? Returns whether it is, and whether each
 * side's boundary is an inline link/em/strong (which ingest may have inserted).
 * relax: {before, after} — sides on which a word boundary or an asterisk is
 * accepted in place of markup (the upstream term file only). */
function sides(text, r, index, length, relax) {
  const end = index + length;
  if (r.kind === 'plain') {
    const whole = text.slice(r.start, index).trim() === '' && text.slice(end, r.end).trim() === '';
    return { ok: whole, inlineBefore: false, inlineAfter: false };
  }
  const before = text.slice(Math.max(r.start, index - 200), index).replace(/(?:\s|&nbsp;)+$/, '');
  const after = text.slice(end, Math.min(r.end, end + 200)).replace(/^(?:\s|&nbsp;)+/, '');
  const atStart = before === '' && text.slice(r.start, index).trim() === '';
  const atEnd = after === '' && text.slice(end, r.end).trim() === '';
  const astro = r.kind === 'astro';
  let okBefore = atStart || />$/.test(before) || (astro && /\}$/.test(before));
  let okAfter = atEnd || /^</.test(after) || (astro && /^\{/.test(after));
  if (!okBefore && relax?.before) okBefore = /\*$/.test(before) || !(isWordChar(text[index - 1]) && isWordChar(text[index]));
  if (!okAfter && relax?.after) okAfter = /^\*/.test(after) || !(isWordChar(text[end - 1]) && isWordChar(text[end]));
  return {
    ok: okBefore && okAfter,
    inlineBefore: INLINE_TAG_BEFORE.test(before),
    inlineAfter: INLINE_TAG_AFTER.test(after),
  };
}

/** Every whole, visible occurrence of `literal` in a source file, in page order.
 * Each hit carries its region (which field) and the tag it sits directly in. */
export function visibleHits(path, text, literal, relax = null) {
  const out = [];
  for (const r of regions(path, text)) {
    const re = flexible(literal, { entities: r.kind !== 'plain', quote: r.quote });
    const sub = text.slice(r.start, r.end);
    const hidden = r.kind === 'plain' ? [] : hiddenRanges(text, r);
    for (const m of sub.matchAll(re)) {
      const index = r.start + m.index;
      if (hidden.some(([a, b]) => index >= a && index < b)) continue;
      const s = sides(text, r, index, m[0].length, relax);
      if (!s.ok) continue;
      out.push({
        index, length: m[0].length, region: r,
        tag: r.kind === 'plain' ? r.wrapper : enclosingTag(text, r, index),
        inlineBefore: s.inlineBefore, inlineAfter: s.inlineAfter,
      });
    }
  }
  return out.sort((a, b) => a.region.order - b.region.order || a.index - b.index);
}

// The new words, spelled for the place they are written into.
function encodeFor(r, s) {
  let v = s.replace(/\s*\n\s*/g, ' ');
  if (r.kind === 'astro') {
    v = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  } else if (r.kind === 'html') {
    v = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (r.quote === '"') v = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  else if (r.quote === "'") v = v.replace(/'/g, "''");
  else if (r.kind === 'plain') v = `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;   // unquoted YAML: quote it
  return v;
}

/* Which of the visible hits could be the clicked text. `element_tag` is the
 * clicked text's parent element, and it must agree with the element the hit
 * sits in. These sources render their markup as-is (the dictionary template
 * uses no components), so this check is exact, and it is what keeps the
 * "Discussed in:" link that repeats an entry's title from renaming the entry.
 * The one exception is the upstream term file (opts.field): ingest adds inline
 * markup to it on the way to the page, so there the hit must instead be in the
 * same field the generated file matched in. Rows saved before element_tag
 * existed skip the check. */
function findHits(path, text, literal, row, opts = {}) {
  const tag = row.element_tag || null;
  const narrow = (hits) => {
    if (opts.field) return hits.filter((h) => h.region.field === opts.field);
    return tag ? hits.filter((h) => h.tag === tag) : hits;
  };
  const strict = narrow(visibleHits(path, text, literal));
  if (strict.length || !opts.relax || !(opts.relax.before || opts.relax.after)) return strict;
  return narrow(visibleHits(path, text, literal, opts.relax));
}

/** One term file. {state:'patched'|'already'|'no-match'|'ambiguous:N-matches', text, hit}.
 * Idempotent: a file that already says new_text and no longer says
 * original_text is "done", not "failed" — re-running canonize must never
 * double-apply or error.
 *
 * `occurrence` counts identical text nodes across the whole dictionary page,
 * 458 entries, so inside one entry's file it says nothing: "(title mine)." can
 * be the entry's first copy and the page's fortieth. Two candidates left is a
 * refusal, not a guess. */
export function patch(path, text, row, opts = {}) {
  const pick = (hits) => (hits.length === 1 ? hits[0] : null);
  const orig = findHits(path, text, row.original_text, row, opts);
  if (!orig.length) {
    const hit = pick(findHits(path, text, row.new_text, row, opts));
    return { state: hit ? 'already' : 'no-match', text, hit };
  }
  const hit = pick(orig);
  if (!hit) return { state: `ambiguous:${orig.length}-matches`, text, hit: null };
  return {
    state: 'patched',
    text: text.slice(0, hit.index) + encodeFor(hit.region, row.new_text) + text.slice(hit.index + hit.length),
    hit,
  };
}

const yamlValue = (text, key) => {
  const m = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec((FRONTMATTER.exec(text) || [''])[0]);
  if (!m) return null;
  const v = m[1];
  if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (v.length >= 2 && v[0] === "'" && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
};
const yamlQuoted = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/* The generated file also keeps `origin:` and `source:`, unrendered copies of
 * the upstream origin that ingest rewrites from it. When an origin edit lands
 * upstream, copy the new upstream origin into them too, so the next ingest
 * reproduces this file exactly instead of showing a diff nobody made. Only
 * lines that matched the old upstream origin are touched. */
function syncOriginCopies(generated, upstreamBefore, upstreamAfter) {
  const before = yamlValue(upstreamBefore, 'origin');
  const after = yamlValue(upstreamAfter, 'origin');
  if (before === null || after === null) return generated;
  const fm = FRONTMATTER.exec(generated);
  if (!fm) return generated;
  const head = fm[0].replace(/^(origin|source):[ \t]*(.*?)[ \t]*$/gm, (line, key) =>
    yamlValue(`---\n${line}\n---`, key) === before ? `${key}: ${yamlQuoted(after)}` : line);
  return head + generated.slice(fm[0].length);
}

/** What to commit and what the row becomes, for one dictionary term.
 * files: {upstream: text|null, generated: text|null} read at one base sha. */
export function planTerm(slug, files, row) {
  const up = upstreamTermFile(slug);
  const gen = generatedTermFile(slug);
  const done = (r) => Boolean(r) && (r.state === 'patched' || r.state === 'already');
  const note = (path, r) => `${path}:${r.state === 'already' ? 'already-applied' : r.state}`;

  // The generated file is what the page renders, so it is matched strictly and
  // decides the rest: which field the text is in, and on which sides the
  // upstream text may lack the markup ingest added.
  const g = files.generated === null ? null : patch(gen, files.generated, row, { tagGate: true });
  const opts = g?.hit ? { field: g.hit.region.field, relax: { before: g.hit.inlineBefore, after: g.hit.inlineAfter } } : {};
  const u = files.upstream === null ? null : patch(up, files.upstream, row, opts);

  // Did either layer hold the old or the new words at all? If not, the text is
  // the entry template's own ("Origin."), and the caller looks in site copy.
  const found = [g, u].some((r) => r && r.state !== 'no-match');
  const skipped = [];
  if (!g) skipped.push(`${gen}:absent`);
  else if (g.state !== 'patched') skipped.push(note(gen, g));
  if (!u) skipped.push(`${up}:absent`);
  else if (u.state !== 'patched') skipped.push(note(up, u));

  // Both layers or neither. A generated-only patch is reverted by the next
  // ingest; an upstream-only patch does not reach the page and is a guess
  // about which text was clicked.
  if ((g && !done(g)) || (u && !done(u)) || (!g && !u)) {
    return { changes: [], skipped, retire: false, found, reason: `pending:${skipped.join(', ')}` };
  }
  const changes = [];
  if (u?.state === 'patched') changes.push({ path: up, content: u.text });
  if (g?.state === 'patched') {
    const content = u?.state === 'patched' && g.hit.region.field === 'origin'
      ? syncOriginCopies(g.text, files.upstream, u.text) : g.text;
    changes.push({ path: gen, content });
  }

  // No upstream file here: a SOMA-LEXICON.md term. Its source is out of reach,
  // so the row stays canonical for tools/apply-canonical-copy.mjs.
  if (!u) return { changes, skipped, retire: false, found, reason: 'upstream-out-of-repo:soma-lexicon' };
  return { changes, skipped, retire: true, found, reason: null };
}

/** Site copy (.astro) for one route: files = [[layout, text], [page, text]].
 * The page's own source is the upstream, so a landed commit retires the row.
 *
 * Here `occurrence` is meaningful, as long as the hits are counted in the order
 * the page renders them: the layout down to its <slot />, then the page, then
 * the rest of the layout. */
export function planSiteCopy(files, row) {
  const skipped = files.filter(([, text]) => text === null).map(([path]) => `${path}:absent`);
  const ordered = (literal) => {
    const before = [];
    const page = [];
    const after = [];
    for (const [path, text] of files) {
      if (text === null) continue;
      const slot = path === LAYOUT ? text.search(/<slot\b/) : -1;
      for (const h of findHits(path, text, literal, row)) {
        const hit = { ...h, path, text };
        if (path !== LAYOUT) page.push(hit);
        else if (slot >= 0 && h.index > slot) after.push(hit);
        else before.push(hit);
      }
    }
    return [...before, ...page, ...after];
  };
  const occurrence = row.occurrence || 0;
  const pick = (hits) => (hits.length === 1 ? hits[0] : (occurrence < hits.length ? hits[occurrence] : null));

  const orig = ordered(row.original_text);
  if (orig.length) {
    const hit = pick(orig);
    if (!hit) {
      skipped.push(`ambiguous:${orig.length}-matches`);
      return { changes: [], skipped, retire: false, reason: `pending:${skipped.join(', ')}` };
    }
    const content = hit.text.slice(0, hit.index) + encodeFor(hit.region, row.new_text) + hit.text.slice(hit.index + hit.length);
    return { changes: [{ path: hit.path, content }], skipped, retire: true, reason: null };
  }
  const now = pick(ordered(row.new_text));
  if (now) {
    skipped.push(`${now.path}:already-applied`);
    return { changes: [], skipped, retire: true, reason: null };
  }
  skipped.push(`no-match in ${files.map(([p]) => p).join(', ')}`);
  return { changes: [], skipped, retire: false, reason: `pending:${skipped.join(', ')}` };
}

/* ── GitHub ───────────────────────────────────────────────────────────────── */

async function gh(token, path, init = {}) {
  const res = await fetch(GH + path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'soma-live-edit',
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`github ${init.method || 'GET'} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

// Is `sha` still the branch head? Checked with a write, not a read: GitHub
// answers a same-sha non-forced update with 200 and an out-of-date one with
// 422, and neither moves the branch.
async function isHead(token, sha) {
  try {
    await gh(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH', body: JSON.stringify({ sha, force: false }),
    });
    return true;
  } catch (e) {
    if (String(e.message).includes('-> 422')) return false;
    throw e;
  }
}

// Read at a COMMIT sha, never at the branch name (see "One base commit").
async function readFile(token, path, sha) {
  try {
    const r = await gh(token, `/repos/${REPO}/contents/${encodeURI(path)}?ref=${sha}`);
    return Buffer.from(r.content, 'base64').toString('utf8');
  } catch (e) {
    if (String(e.message).includes('-> 404')) return null;
    throw e;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json(401, { ok: false, error: 'no bearer token' });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'bad json' }); }
  const id = body && body.id;
  if (!id) return json(400, { ok: false, error: 'missing id' });

  const sb = (path, init = {}) =>
    fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });

  // ── admin gate: ask the DB the same question RLS asks ────────────────────
  const adminRes = await sb('/rest/v1/rpc/is_app_admin', {
    method: 'POST',
    body: JSON.stringify({ target_app: APP }),
  });
  const isAdmin = adminRes.ok && (await adminRes.json()) === true;
  if (!isAdmin) return json(403, { ok: false, error: 'not an admin for ' + APP });

  // ── load the row ─────────────────────────────────────────────────────────
  const rowRes = await sb(`/rest/v1/copy_overrides?id=eq.${encodeURIComponent(id)}&select=*`);
  const rows = rowRes.ok ? await rowRes.json() : [];
  const row = rows[0];
  if (!row) return json(404, { ok: false, error: 'row not found' });
  if (row.app !== APP) return json(400, { ok: false, error: 'wrong app' });
  // §17a R4 — a retired override is never revisable back into service.
  if (row.status === 'retired') return json(409, { ok: false, error: 'retired rows are not promotable' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json(500, { ok: false, error: 'GITHUB_TOKEN not configured' });

  // ── which files could hold this string? ──────────────────────────────────
  // The term slug the client saw is a HINT, never the match key. It is in
  // note ("term:<slug>") on a fresh draft, and in element_path
  // ("article#term-<slug>") always — note is overwritten by an earlier
  // canonize attempt, and a retry must still find the term.
  const slug = ((row.note || '').match(/^term:(.+)$/) || (row.element_path || '').match(/^article#term-(.+)$/) || [])[1] || null;

  // One base commit for the whole operation.
  const baseSha = (await gh(token, `/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;

  let plan = null;
  if (slug) {
    const [upstream, generated] = await Promise.all([
      readFile(token, upstreamTermFile(slug), baseSha),
      readFile(token, generatedTermFile(slug), baseSha),
    ]);
    plan = planTerm(slug, { upstream, generated }, row);
  }
  // Not in the entry's files at all: the entry's template text ("Origin.",
  // "see also:") is site copy, so look there.
  if (!plan || !plan.found) {
    const files = [];
    for (const path of siteCopyFiles(row.route)) files.push([path, await readFile(token, path, baseSha)]);
    const site = planSiteCopy(files, row);
    if (!plan || site.changes.length || site.retire) plan = site;
  }

  let sha = null;
  if (plan.changes.length) {
    const baseCommit = await gh(token, `/repos/${REPO}/git/commits/${baseSha}`);

    const tree = [];
    for (const c of plan.changes) {
      const blob = await gh(token, `/repos/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: c.content, encoding: 'utf-8' }),
      });
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await gh(token, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });
    const short = row.new_text.replace(/\s+/g, ' ').slice(0, 60);
    const commit = await gh(token, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message:
          `copy(live-edit): ${slug ? slug + ' — ' : ''}"${short}"\n\n` +
          `SOMA §17 in-place edit made canonical on ${row.route}.\n` +
          `was: ${row.original_text.replace(/\s+/g, ' ').slice(0, 200)}\n` +
          `now: ${row.new_text.replace(/\s+/g, ' ').slice(0, 200)}\n` +
          `override: ${row.id}\n` +
          (plan.reason ? `note: ${plan.reason}\n` : ''),
        tree: newTree.sha,
        parents: [baseSha],
      }),
    });
    try {
      await gh(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (e) {
      // Someone else moved the branch between our read and our write. Nothing
      // was published; the row is untouched, and saying so beats clobbering.
      if (String(e.message).includes('-> 422')) {
        return json(409, { ok: false, error: 'the site changed while publishing — publish again' });
      }
      throw e;
    }
    sha = commit.sha;
  }

  // Nothing committed, so nothing above proved the base sha was the branch
  // head. A stale read right after someone else's commit would make an undo
  // look "already applied" and retire it unpublished. A non-forced ref update
  // to the same sha is a no-op when it is the head and a 422 when the branch
  // has moved on, so it checks through the same path a commit would.
  if (!sha && !(await isHead(token, baseSha))) {
    return json(409, { ok: false, error: 'the site changed while publishing — publish again' });
  }

  // ── record what the source now says ──────────────────────────────────────
  const now = new Date().toISOString();
  const note = sha
    ? `commit:${sha}${plan.reason ? ' ' + plan.reason : ''}`
    : (plan.retire ? `already-applied:${plan.skipped.join(', ')}` : (plan.reason || 'pending'));
  await sb(`/rest/v1/copy_overrides?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(plan.retire
      ? { status: 'retired', canonical_at: now, retired_at: now, note }
      : { status: 'canonical', canonical_at: now, note }),
  });

  return json(200, {
    ok: true,
    committed: Boolean(sha),
    sha,
    retired: plan.retire,
    alreadyApplied: !sha && plan.retire,
    files: plan.changes.map((c) => c.path),
    skipped: plan.skipped,
    reason: plan.reason,
  });
};

// Functions 2.0 path routing. This is also why the endpoint survives
// netlify.toml's catch-all `/* -> /index.html 200`: function paths are matched
// before redirects, so /api/copy-canonize is never swallowed.
export const config = { path: '/api/copy-canonize' };
