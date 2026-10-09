#!/usr/bin/env python3
"""
SRMW reference text: PDF -> typeset HTML sections.

Reads the published PDF (~/Projects/SOMA/canon/srmw/SRMW.pdf) with PyMuPDF and
uses its font, size and position data to rebuild the book's typography:
paragraphs (from first-line indents), section headings, display epigraphs,
block quotes, footnotes, the muse's handwritten note, Metatron's typeface, the
narrator's sans italics, and the Retroactive Contents as a linked table.

Writes content-cache/srmw/sections.json, which scripts/ingest.mjs reads. The
Netlify build does not run Python; the JSON is committed, like atlas.json.

Every word is as printed. Only layout is interpreted: line breaks, page
furniture (running head, page numbers) and soft hyphens are removed.

Run:  python3 scripts/extract_srmw.py
_Written 2026-10-09 by Mike Wolf + Claude Opus 5.5 (CCc), replacing the
SRMW.txt line-dump parser that rendered the book without typography._
"""
import html
import json
import os
import re
from collections import Counter

import fitz  # PyMuPDF

HOME = os.path.expanduser('~')
PDF = os.path.join(HOME, 'Projects/SOMA/canon/srmw/SRMW.pdf')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'content-cache/srmw/sections.json')

SOFT = '­'
RUNNING_HEAD = 'Self-Referential Metanovel Writing for D*mmies'
SECTION_RE = re.compile(
    r'^(Part\s+[IVXLC]+:|Chapter\s+\d+:|Antichapter\s+\d+:|Prologue\s+\d+:|Reflection\s+\d+:|'
    r'Interchapter\s+Report\s+\d+:|Narrative\s+Chapter\s+\d+:|Retroactive Contents)')
KIND = [
    ('Part', 'part'), ('Chapter', 'chapter'), ('Antichapter', 'antichapter'),
    ('Prologue', 'prologue'), ('Reflection', 'reflection'),
    ('Interchapter', 'interchapter report'), ('Narrative', 'narrative chapter'),
    ('Retroactive', 'contents'),
]


def slugify(s):
    # Same rule as slugify() in ingest.mjs: straight quotes vanish, curly ones split
    # ("Who’s" → "who-s"), so the URLs the Library already published stay put.
    s = s.lower().replace("'", '').replace('`', '').replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return re.sub(r'-{2,}', '-', s)[:80]


def norm(s):
    return re.sub(r'\s+', ' ', s.replace(SOFT, '')).strip()


# ── Span → inline HTML ────────────────────────────────────────────────────────
PAGE_FOOTNOTES = set()   # footnote numbers printed at the bottom of the page being read


def span_style(sp):
    f, size = sp['font'], sp['size']
    if size < 8 and sp['text'].strip().isdigit():
        return 'sup' if sp['text'].strip() in PAGE_FOOTNOTES else 'sup-plain'
    if size >= 14 and not f.startswith('Arial-Bold'):
        return 'big-em' if 'Italic' in f else 'big'
    if f.startswith('Arial-Italic') or f.startswith('ArialUnicode'):
        return 'sans-em'
    if f.startswith('Arial-Bold'):
        return 'strong'
    if 'Italic' in f:
        return 'em'
    if 'Bold' in f:
        return 'strong'
    return ''


def wrap(style, text):
    if not text:
        return ''
    if style == 'em':
        return f'<em>{text}</em>'
    if style == 'strong':
        return f'<strong>{text}</strong>'
    if style == 'sans-em':
        return f'<em class="sans">{text}</em>'
    if style == 'sup-plain':
        return f'<sup>{text}</sup>'
    if style == 'big':
        return f'<span class="big">{text}</span>'
    if style == 'big-em':
        return f'<em class="big">{text}</em>'
    if style == 'sup':
        n = text.strip()
        return f'<sup class="fnref"><a href="#fn-{n}" id="fnref-{n}">{n}</a></sup>'
    return text


class Inline:
    """Accumulates styled runs, joining lines the way the typesetter broke them."""

    def __init__(self):
        self.runs = []  # [style, text]

    def add(self, style, text):
        if not text:
            return
        if self.runs and self.runs[-1][0] == style and style not in ('sup', 'raw'):
            self.runs[-1][1] += text
        else:
            self.runs.append([style, text])

    def add_line(self, spans, marker=''):
        text_runs = [r for r in self.runs if r[0] != 'raw']
        if text_runs:
            lr = text_runs[-1]
            last = lr[1]
            if last.endswith(SOFT):
                lr[1] = last[:-1]                     # soft hyphen: rejoin the word
            elif not (last.endswith(' ') or last.endswith('—') or last.endswith('-') or last.endswith('/')):
                self.add(lr[0] if lr[0] not in ('sup', 'raw') else '', ' ')
        if marker:
            self.runs.append(['raw', marker])
        for sp in spans:
            self.add(span_style(sp), sp['text'])

    def html(self):
        runs = []
        for style, text in self.runs:
            if not text:
                continue
            if runs and runs[-1][0] == style and style not in ('sup', 'raw'):
                runs[-1][1] += text
            else:
                runs.append([style, text])
        out = []
        for style, text in runs:
            if style == 'raw':
                out.append(text)
                continue
            t = html.escape(re.sub(r'[ \t]{2,}', ' ', text), quote=False)
            if style and style != 'sup':
                # keep edge spaces outside the tag
                lead = len(t) - len(t.lstrip(' '))
                trail = len(t) - len(t.rstrip(' '))
                core = t.strip(' ')
                out.append(' ' * lead + wrap(style, core) + ' ' * trail if core else t)
            else:
                out.append(wrap(style, t))
        return ''.join(out).strip()

    def text(self):
        return ''.join(t for st, t in self.runs if st != 'raw')


# ── Line model ────────────────────────────────────────────────────────────────
def dominant(spans):
    c = Counter()
    for sp in spans:
        c[(sp['font'], round(sp['size'], 1))] += len(sp['text'].strip()) or 0.1
    return c.most_common(1)[0][0]


def page_lines(page):
    lines = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            spans = [s for s in l['spans'] if s['text']]
            if not spans:
                continue
            text = ''.join(s['text'] for s in spans)
            if not text.strip():
                continue
            x0, y0, x1, y1 = l['bbox']
            font, size = dominant(spans)
            lines.append(dict(x0=x0, x1=x1, y0=y0, y1=y1, spans=spans, text=text, font=font, size=size))
    # Merge fragments that share a baseline (e.g. TOC title + its page number).
    lines.sort(key=lambda L: (round(L['y0']), L['x0']))
    merged = []
    for L in lines:
        if merged and abs(merged[-1]['y0'] - L['y0']) < 2 and L['x0'] >= merged[-1]['x1'] - 1:
            m = merged[-1]
            m['spans'] = m['spans'] + [dict(s) for s in L['spans']]
            m['text'] += '\t' + L['text']
            m['x1'] = L['x1']
        else:
            merged.append(L)
    return merged


def is_furniture(L, page_h):
    t = L['text'].strip()
    if L['y0'] < 75 and t.startswith('Self-Referential Metanovel Writing'):
        return True
    if L['y0'] > page_h - 90 and re.fullmatch(r'[ivxlcdm]+|\d{1,3}', t):
        return True
    return False


def classify(L, left):
    f, size = L['font'], L['size']
    t = L['text'].strip()
    if f.startswith('Arial-Bold') and size >= 15.5:
        return 'section' if SECTION_RE.match(norm(t)) else 'heading'
    if size >= 14 and not f.startswith('Arial-Bold'):
        return 'display'
    if f.startswith('SegoeScript'):
        return 'script'
    if f.startswith('TimesNewRoman') and abs(size - 10.0) < 0.05 and L['y0'] > 500:
        return 'footnote'
    if (f.startswith('ArialMT') or f.startswith('Arial-BoldMT')) and size < 10.5:
        return 'quote'
    if L['x0'] > left + 28:
        return 'inset'
    return 'body'


# ── Block assembly ────────────────────────────────────────────────────────────
class Block:
    def __init__(self, kind, **kw):
        self.kind = kind
        self.lines = []
        self.inline = Inline()
        self.__dict__.update(kw)


def build_blocks(doc, first_page):
    """Walk the book once, returning a flat list of blocks with page markers."""
    blocks = []
    cur = None          # current open paragraph-like block
    last_y1 = None

    def close():
        nonlocal cur
        if cur is not None:
            blocks.append(cur)
        cur = None

    for pno in range(first_page, doc.page_count):
        page = doc[pno]
        H = page.rect.height
        lines = [L for L in page_lines(page) if not is_furniture(L, H)]
        PAGE_FOOTNOTES.clear()
        for L in lines:
            m = re.match(r'^(\d+)(?:\t|$)', L['text'].strip())
            if m and L['font'].startswith('TimesNewRoman') and abs(L['size'] - 10.0) < 0.05 and L['y0'] > 500:
                PAGE_FOOTNOTES.add(m.group(1))
        printed = pno - 3  # printed arabic page number (PDF page index 4 = p. 1)
        body_x = [round(L['x0']) for L in lines if L['font'].startswith('TimesNewRoman') and L['size'] < 12.5]
        left = min(Counter(body_x).most_common(3))[0] if body_x else 63
        left = min(left, 63) if left > 58 else left
        page_marked = False
        last_y1 = None
        i = 0
        while i < len(lines):
            L = lines[i]
            kind = classify(L, left)
            gap = (L['y0'] - last_y1) if last_y1 is not None else 0
            indent = L['x0'] > left + 8

            def mark():
                nonlocal page_marked
                if not page_marked and printed >= 1:
                    page_marked = True
                    return f'<span class="pg" id="page-{printed}" data-page="{printed}" aria-hidden="true"></span>'
                return ''

            if kind in ('section', 'heading'):
                close()
                text = L['text']
                spans = list(L['spans'])
                # Headings can wrap onto a second line.
                while (i + 1 < len(lines) and lines[i + 1]['font'].startswith('Arial-Bold') and lines[i + 1]['size'] >= 15.5
                       and lines[i + 1]['y0'] - L['y1'] < 12):
                    i += 1
                    L = lines[i]
                    text += ('' if text.endswith(SOFT) else ' ') + L['text']
                    spans += L['spans']
                title = re.sub(r'^([A-Z][A-Za-z ]+\d+):(?=\S)', r'\1: ', norm(text))  # "Epilogue 1:It’s" → "Epilogue 1: It’s"
                blocks.append(Block(kind, title=title, page=printed, marker=mark()))
            elif kind == 'display':
                if cur is None or cur.kind != 'display' or gap > 40:
                    close()
                    cur = Block('display', size=L['size'], italic='Italic' in L['font'], marker=mark(), lines=[])
                cur.lines.append(L)
            elif kind == 'script':
                if cur is None or cur.kind != 'script':
                    close()
                    cur = Block('script', marker=mark(), lines=[])
                cur.lines.append(L)
            elif kind == 'footnote':
                t = L['text'].strip()
                lead = re.match(r'^(\d+)\t', L['text'].lstrip())
                if lead:
                    close()
                    cur = Block('footnote', num=lead.group(1), marker='', lines=[])
                    cur.inline.add_line(L['spans'][1:] if L['spans'][0]['text'].strip() == lead.group(1) else L['spans'])
                elif re.fullmatch(r'\d+', t):
                    close()
                    cur = Block('footnote', num=t, marker='', lines=[])
                elif cur is not None and cur.kind == 'footnote':
                    cur.inline.add_line(L['spans'])
                else:
                    close()
                    cur = Block('footnote', num='', marker='', lines=[])
                    cur.inline.add_line(L['spans'])
            elif kind == 'quote':
                if cur is None or cur.kind != 'quote':
                    close()
                    cur = Block('quote', marker=mark())
                cur.inline.add_line(L['spans'])
            elif kind == 'inset':
                same = cur is not None and cur.kind == 'inset' and abs(cur.x0 - L['x0']) < 6 and gap < 14
                if not same:
                    close()
                    cur = Block('inset', x0=L['x0'], font=L['font'], marker=mark(), lines=[])
                cur.lines.append(L)
            else:  # body
                new_para = (
                    cur is None or cur.kind not in ('para',)
                    or indent
                    or gap > 9
                )
                # A page that opens flush-left continues the paragraph from the previous page.
                if cur is not None and cur.kind == 'para' and last_y1 is None and not indent:
                    new_para = False
                if new_para:
                    close()
                    cur = Block('para', marker='')
                cur.lines.append(L)
                cur.inline.add_line(L['spans'], marker=mark())
                # A short line that is the whole paragraph (dialogue) ends it.
            last_y1 = L['y1']
            i += 1
        # Display/script/inset/quote blocks never continue across a page.
        if cur is not None and cur.kind != 'para':
            close()
    close()
    return blocks


# ── Render ────────────────────────────────────────────────────────────────────
def inline_html(inl):
    return inl.html()


def lines_html(lines, br=True):
    parts = []
    for L in lines:
        inl = Inline()
        inl.add_line(L['spans'])
        parts.append(inl.html())
    return ('<br>' if br else ' ').join(p for p in parts if p)


def render_block(b, anchors):
    if b.kind == 'heading':
        aid = anchors(b.title)
        return f'<h3 id="{aid}">{b.marker}{html.escape(b.title, quote=False)}</h3>', b.title
    if b.kind == 'display':
        cls = 'display' + (' display-xl' if b.size >= 24 else ' display-l' if b.size >= 15.5 else '')
        inner = re.sub(r'<span class="big">(.*?)</span>', r'\1', lines_html(b.lines)).replace('<em class="big">', '<em>')
        return f'<p class="{cls}">{b.marker}{inner}</p>', ' '.join(L['text'] for L in b.lines)
    if b.kind == 'script':
        return f'<p class="note-script">{b.marker}{lines_html(b.lines)}</p>', ' '.join(L['text'] for L in b.lines)
    if b.kind == 'quote':
        return f'<blockquote class="cite">{b.marker}<p>{inline_html(b.inline)}</p></blockquote>', b.inline.text()
    if b.kind == 'footnote':
        n = b.num
        body = inline_html(b.inline)
        back = f' <a class="fnback" href="#fnref-{n}" aria-label="Back to text">↩</a>' if n else ''
        return f'<p class="footnote" id="fn-{n}"><span class="fnnum">{n}</span> {body}{back}</p>', b.inline.text()
    if b.kind == 'inset':
        lines = b.lines
        txt = ' '.join(L['text'] for L in lines)
        widths = [L['x1'] - L['x0'] for L in lines]
        centered = all(abs((L['x0'] + L['x1']) / 2 - 277) < 22 for L in lines)
        cls = 'inset'
        if b.font.startswith('LucidaSans'):
            cls += ' voice-lucida'
        if centered:
            cls += ' center'
        if len(lines) == 1 or max(widths) < 300:
            inner = lines_html(lines, br=True)
        else:
            inl = Inline()
            for L in lines:
                inl.add_line(L['spans'])
            inner = inl.html()
        return f'<p class="{cls}">{b.marker}{inner}</p>', txt
    # para
    return f'<p>{inline_html(b.inline)}</p>', b.inline.text()


TOC_LINE = re.compile(r'^(?P<title>.*?)(?:\s*\.{3,}\s*|\t+)(?P<page>\d+)\s*$')


def main():
    doc = fitz.open(PDF)

    # ── Cover (title page, copyright, imprint, dedication) — printed pp. i–v ──
    def texts(pno):
        return [norm(L['text']) for L in page_lines(doc[pno]) if not is_furniture(L, doc[pno].rect.height)]
    t0, t1, t2, t3 = texts(0), texts(1), texts(2), texts(3)
    e = lambda s: html.escape(s, quote=False)
    cover_html = '\n\n'.join([
        '<div class="srmw-cover">',
        f'<p class="cover-title">{e(t0[0])}<br>{e(t0[1])}</p>',
        f'<p class="cover-subtitle">{e(t0[2])}</p>',
        '<p class="cover-blurbs">' + '<br>'.join(e(x) for x in t0[3:6]) + '</p>',
        '<p class="cover-authors">' + '<br>'.join(e(x) for x in t0[6:10]) + '</p>',
        '</div>',
        '<div class="srmw-colophon">',
        '<p>' + '<br>'.join(e(x) for x in t1 if not x.startswith('ISBN')) + '</p>',
        '<p class="isbn">' + e(next(x for x in t1 if x.startswith('ISBN'))) + '</p>',
        '<p>' + '<br>'.join(e(x) for x in t2) + '</p>',
        '</div>',
        '<div class="srmw-dedication">',
        '<p>' + '<br>'.join(e(x) for x in t3) + '</p>',
        '</div>',
    ])
    cover_text = ' '.join(t0 + t1 + t2 + t3)

    blocks = build_blocks(doc, first_page=4)

    # ── Sectionize ────────────────────────────────────────────────────────────
    sections = [dict(title='Cover', short='Cover', kind='cover', part='', html=cover_html, text=cover_text, page='i')]
    cur = None
    part = ''
    for b in blocks:
        if b.kind == 'section' or (cur is None and b.kind == 'heading'):
            title = re.sub(r'\s*:\s*', ': ', b.title).replace(' :', ':')
            title = re.sub(r'\s{2,}', ' ', title)
            kind = next((k for p, k in KIND if title.startswith(p)), 'section')
            if kind == 'part':
                part = title
            cur = dict(title=title, kind=kind, part='' if kind == 'part' else part, blocks=[], page=b.page,
                       marker=b.marker)
            sections.append(cur)
            if b.kind == 'heading':      # "The World's Stupidest Novel" opens the book with a plain heading
                cur['kind'] = 'opening'
            continue
        cur['blocks'].append(b)

    for s in sections:
        s['slug'] = 'srmw-' + slugify(s['title'])

    def toc_entry(line_text):
        m = TOC_LINE.match(line_text.strip())
        if not m:
            return None
        return norm(m.group('title')).rstrip('. '), m.group('page')

    # Render every section. In the Retroactive Contents, the run of dotted-leader
    # lines becomes one placeholder, filled in once every heading has an anchor.
    for s in sections:
        if s['kind'] == 'cover':
            continue
        used = Counter()

        def anchors(title, used=used):
            a = slugify(title) or 'h'
            used[a] += 1
            return a if used[a] == 1 else f'{a}-{used[a]}'
        s['rendered'] = []
        toc_rows, toc_open = None, s['kind'] == 'contents'
        for b in s['blocks']:
            if toc_open and b.kind in ('para', 'inset') and b.lines:
                entries = [toc_entry(L['text']) for L in b.lines]
                if all(entries):
                    if toc_rows is None:
                        toc_rows = []
                        s['rendered'].append(('toc', toc_rows))
                    toc_rows.extend(entries)
                    continue
                toc_open = toc_rows is None   # contents ended; render the rest as prose
            s['rendered'].append(render_block(b, anchors))

    # Document-order list of link targets: each section title, then its headings.
    targets = []   # (key, slug, anchor)
    key = lambda t: norm(html.unescape(t)).lower().replace('“', '"').replace('”', '"').rstrip('!?.: ')
    for s in sections:
        if s['kind'] == 'cover':
            continue
        short = s['title'] if s['kind'] == 'opening' else re.sub(r'^[^:]+:\s*', '', s['title'])
        targets.append((key(short), s['slug'], ''))
        for h, _ in s['rendered']:
            if h == 'toc':
                continue
            m = re.match(r'<h3 id="([^"]+)">(?:<span[^>]*></span>)?(.*)</h3>$', h)
            if m:
                targets.append((key(m.group(2)), s['slug'], m.group(1)))
                numbered = re.match(r'^[A-Z][A-Za-z ]+\d+:\s*(.+)$', html.unescape(m.group(2)))
                if numbered:   # "New Chapter 2: Arrival At Last" is listed as "Arrival At Last"
                    targets.append((key(numbered.group(1)), s['slug'], m.group(1)))

    for s in sections:
        if s['kind'] != 'contents':
            continue
        cursor = -1
        for idx, (h, rows) in enumerate(s['rendered']):
            if h != 'toc':
                continue
            items, words = [], []
            for title, page in rows:
                is_part = bool(re.match(r'^Part\s+[IVXLC]+:', title))
                want = key(re.sub(r'^Part\s+[IVXLC]+:\s*', '', title))
                hit = next((j for j in range(cursor + 1, len(targets)) if targets[j][0] == want), None)
                label = html.escape(title, quote=False)
                if hit is not None:
                    cursor = hit
                    _, slug, anchor = targets[hit]
                    label = f'<a href="/corpus/{slug}/' + (f'#{anchor}' if anchor else '') + f'">{label}</a>'
                else:
                    print(f'  contents: no target for "{title}"')
                items.append(f'<li class="{"toc-part" if is_part else "toc-item"}"><span class="toc-title">{label}</span>'
                             f'<span class="toc-page">{page}</span></li>')
                words.append(f'{title} {page}')
            s['rendered'][idx] = ('<ol class="toc">\n' + '\n'.join(items) + '\n</ol>', ' '.join(words))

    out = []
    for i, s in enumerate(sections):
        if s['kind'] == 'cover':
            body, text = s['html'], s['text']
        else:
            lead = s.get('marker', '').replace('<span ', '<div ').replace('</span>', '</div>')
            notes = [h for h, _ in s['rendered'] if h.startswith('<p class="footnote"')]
            main_ = [h for h, _ in s['rendered'] if not h.startswith('<p class="footnote"')]
            body = (lead + '\n\n' if lead else '') + '\n\n'.join(main_)
            if notes:   # footnotes print at the foot of their page; on the web they go to the end
                body += '\n\n<div class="footnotes">\n\n' + '\n\n'.join(notes) + '\n\n</div>'
            text = ' '.join(t for _, t in s['rendered'])
        out.append(dict(
            slug=s['slug'], title=s['title'], subtitle=s.get('part', ''), kind=s['kind'],
            order=i, page=str(s.get('page', '')), html=body, text=norm(text),
        ))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f'SRMW → {len(out)} sections, {sum(len(o["text"].split()) for o in out):,} words → {OUT}')


if __name__ == '__main__':
    main()
