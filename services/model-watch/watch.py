"""Model & pricing watch (daily Cloud Run job).

Fetches three public pages, extracts what matters for the AI Gateway, and writes a JSON
report to GCS so the Admin Console can alert the admin:

  * Vertex AI pricing   (authoritative: the gateway calls Vertex)  -> per-model input/output USD per 1M,
                          plus EVERY price cell on the page (all models: Gemini, Claude, Grok, Llama,
                          Mistral, DeepSeek, Qwen, Imagen, Veo, embeddings, tuning, caching, tools...)
  * Gemini API pricing  (cross-check)                              -> per-model input/output USD per 1M
  * Gemini API changelog                                           -> releases, deprecations, shutdowns

Each run compares with the previous report (gs://$BUCKET/$PREFIX/latest.json) and records what
changed. Changes to any price on the Vertex page are kept for RECENT_DAYS in
`recentPriceChanges`, so an admin who looks a few days later still sees them. A page whose
layout no longer parses is reported as an error, never as "no change".

Standard library only (no pip install), so the container is python:3.12-slim + this file.

Env:
  MODEL_WATCH_BUCKET   GCS bucket for reports (required unless --dry-run)
  MODEL_WATCH_PREFIX   object prefix (default: model-watch)
  VERTEX_PRICING_URL / GEMINI_PRICING_URL / CHANGELOG_URL  (defaults below)

Local run:  python3 watch.py --dry-run            (prints the report, writes nothing)
            python3 watch.py --from-dir DIR       (parse saved pages: vertex.html, gemini.html, changelog.html)
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html as htmllib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

VERTEX_PRICING_URL = os.environ.get(
    'VERTEX_PRICING_URL', 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing')
GEMINI_PRICING_URL = os.environ.get('GEMINI_PRICING_URL', 'https://ai.google.dev/gemini-api/docs/pricing')
CHANGELOG_URL = os.environ.get('CHANGELOG_URL', 'https://ai.google.dev/gemini-api/docs/changelog')
UA = 'Mozilla/5.0 (apigee-ai-gateway model-watch)'

# Fewer than this many priced models means the page layout changed and parsing broke.
TEXT_MODEL_RE = re.compile(
    r'^(gemini-[0-9][0-9.]*-(flash|pro)(-lite)?(-preview)?|claude-(opus|sonnet|haiku)-[0-9]+(-[0-9]+)?)$')
MIN_VERTEX_MODELS = 5
MIN_GEMINI_MODELS = 5
CHANGELOG_KEEP = 30
RECENT_DAYS = 30          # keep detected price changes this long
RECENT_MAX = 500          # and at most this many
# If today's page yields far fewer price cells than yesterday's, the layout changed: keep
# yesterday's prices instead of reporting hundreds of "removed" prices.
MIN_ALL_PRICES_RATIO = 0.6


# ---------------------------------------------------------------------------------------------
# Fetch / GCS
# ---------------------------------------------------------------------------------------------
def fetch(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en-US,en'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='ignore')


def access_token() -> str:
    """Metadata server on Cloud Run; gcloud locally."""
    try:
        req = urllib.request.Request(
            'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
            headers={'Metadata-Flavor': 'Google'})
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.load(r)['access_token']
    except Exception:
        return subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()


def gcs_read(bucket: str, name: str, token: str) -> dict | None:
    url = f'https://storage.googleapis.com/storage/v1/b/{bucket}/o/{urllib.parse.quote(name, safe="")}?alt=media'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def gcs_write(bucket: str, name: str, data: dict, token: str) -> None:
    url = (f'https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o'
           f'?uploadType=media&name={urllib.parse.quote(name, safe="")}')
    body = json.dumps(data, indent=2).encode()
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()


# ---------------------------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------------------------
class _Tables(HTMLParser):
    """Collect every top-level <table> as (nearest preceding h2/h3 text, rows of cell text)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.heading = [], ''
        self._depth, self._rows, self._row, self._cell, self._h = 0, None, None, None, None

    def handle_starttag(self, tag, attrs):
        if tag in ('h2', 'h3'):
            self._h = ''
        elif tag == 'table':
            self._depth += 1
            if self._depth == 1:
                self._rows = []
        elif tag == 'tr' and self._depth:
            self._row = []
        elif tag in ('td', 'th') and self._depth:
            self._cell = ''
        elif tag == 'br' and self._cell is not None:
            self._cell += ' '

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3') and self._h is not None:
            t = ' '.join(self._h.split())
            if t:
                self.heading = t
            self._h = None
        elif tag in ('td', 'th') and self._cell is not None and self._row is not None:
            self._row.append(' '.join(self._cell.split()))
            self._cell = None
        elif tag == 'tr' and self._row is not None and self._rows is not None:
            if any(self._row):
                self._rows.append(self._row)
            self._row = None
        elif tag == 'table' and self._depth:
            self._depth -= 1
            if self._depth == 0:
                self.tables.append((self.heading, self._rows))
                self._rows = None

    def handle_data(self, d):
        if self._cell is not None:
            self._cell += d
        if self._h is not None:
            self._h += d


def tables(html: str):
    p = _Tables()
    p.feed(html)
    return p.tables


def money(s: str) -> float | None:
    m = re.search(r'\$\s*([0-9]+(?:\.[0-9]+)?)', s or '')
    return float(m.group(1)) if m else None


def model_id(display: str, section: str = '') -> str | None:
    """'Gemini 3.5 Flash-Lite' -> gemini-3.5-flash-lite, 'Claude Opus 4.5' -> claude-opus-4-5.
    In the Claude section some rows omit the brand ('Opus 5.5'), so it is added back."""
    d = re.sub(r'\*.*$', '', display)                                  # drop footnote markers
    if 'claude' in section.lower() and re.match(r'(?i)^(opus|sonnet|haiku)\b', d.strip()):
        d = 'Claude ' + d.strip()
    d = re.sub(r'(?i)(through|starting|from)\s.*$', '', d).strip()     # drop price-schedule text
    d = re.sub(r'(?<=[a-z])(?=(through|starting|Starting|Through))', ' ', d)
    if not re.match(r'(?i)^(gemini|claude)\b', d):
        return None
    slug = re.sub(r'\s+', '-', d.strip().lower())
    if slug.startswith('claude'):
        slug = slug.replace('.', '-')
    return slug


def schedule(display: str) -> tuple[str, str | None]:
    """Price-schedule hint in a model cell: ('current'|'future', iso_date)."""
    m = re.search(r'(?i)(through|starting)\s+([A-Z][a-z]+ \d{1,2}, \d{4})', display)
    if not m:
        return 'current', None
    when = dt.datetime.strptime(m.group(2), '%B %d, %Y').date().isoformat()
    return ('current' if m.group(1).lower() == 'through' else 'future'), when


# ---------------------------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------------------------
def parse_vertex(html: str) -> dict:
    """Standard (not Priority / Flex / Batch) per-1M prices, global region, prompts <= 200K."""
    out: dict[str, dict] = {}

    def put(model, kind, price, display):
        if model is None or price is None:
            return
        when, date = schedule(display)
        e = out.setdefault(model, {'display': re.split(r'(?i)\*|through|starting', display)[0].strip()})
        # First table wins: the global price table comes before the regional (+10%) ones.
        if when == 'future':
            e.setdefault('next', {'from': date}).setdefault(kind, price)
        elif kind not in e:
            e[kind] = price
            if date:
                e['until'] = date

    for heading, rows in tables(html):
        if not rows:
            continue
        header = ' '.join(rows[0]).lower()
        if re.search(r'priority|flex|batch', header):
            continue
        family = heading.lower()
        is_gemini3 = family.startswith('gemini 3') and 'price (/1m tokens)' in header and 'region' in header
        is_gemini25 = family.startswith('gemini 2.5') and 'token price' in header
        is_claude = 'claude' in family and 'price' in header
        if not (is_gemini3 or is_gemini25 or is_claude):
            continue
        current = None
        for r in rows[1:]:
            if r and r[0] and not r[0].startswith(('Input', 'Text', 'Output', 'Audio', 'Batch', 'Image', '1M')):
                current = r[0]
                r = r[1:]
            elif r and r[0] == '':
                r = r[1:]
            if not current or not r:
                continue
            mid = model_id(current, heading)
            kind_cell = r[0].lower()
            if is_gemini3:
                if len(r) < 3 or r[1].lower() not in ('global',):
                    continue
                price = money(r[2])
            elif is_claude:
                # Some Claude rows leave the <=200K column empty and price by <=100K instead
                # (e.g. Haiku 5.5): use the first price on the row.
                price = next((money(c) for c in r[1:] if money(c) is not None), None)
            else:
                price = money(r[1]) if len(r) > 1 else None
            # Text input row ('Input (text, image, video[, audio])' or Claude's plain 'Input');
            # audio-only input rows are priced separately and skipped.
            if kind_cell == 'input' or kind_cell.startswith('input (text'):
                put(mid, 'input', price, current)
            elif kind_cell.startswith(('text output', 'output')):
                put(mid, 'output', price, current)
    # Keep plain text models with both prices (drops TTS, Image, Live, Computer Use variants).
    return {k: v for k, v in out.items() if 'input' in v and 'output' in v and TEXT_MODEL_RE.match(k)}


def parse_vertex_all(html: str) -> dict[str, dict]:
    """Every price cell on the Vertex AI pricing page, keyed for stable day-over-day diffs.

    Key   = "section | model | row label | column header"
    Value = {"section", "model", "item", "column", "price" (cell text), "usd" (first $ amount)}

    The first column carries forward when empty (the page leaves the model name only on its
    first row). Row label = the non-price cells after the first column (e.g. "Input (text, ...)
    · Global"). Column header disambiguates Standard / Priority / Flex / >200K variants.
    """
    out: dict[str, dict] = {}
    for heading, rows in tables(html):
        if not rows:
            continue
        header = rows[0]
        if not any('$' in c for c in header):
            body = rows[1:]
        else:  # no header row
            header, body = [], rows
        current = ''
        for r in body:
            if not r:
                continue
            if r[0] and '$' not in r[0]:
                current = r[0]
            label_cells = [c for c in r[1:] if c and '$' not in c and not re.fullmatch(r'N/?A|-|—', c)]
            item = ' · '.join(label_cells)[:160]
            for i, cell in enumerate(r):
                if '$' not in cell:
                    continue
                column = header[i] if i < len(header) else f'col{i}'
                model = re.sub(r'\s+', ' ', current).strip()[:120]
                key = ' | '.join((heading, model, item, column))
                n, base = 2, key
                while key in out:  # identical labels in one table: keep both
                    key = f'{base} #{n}'
                    n += 1
                out[key] = {'section': heading, 'model': model, 'item': item, 'column': column[:160],
                            'price': cell[:160], 'usd': money(cell)}
    return out


def diff_all_prices(prev: dict, cur: dict, now: str) -> list[dict]:
    changes = []
    for k in sorted(set(prev) | set(cur)):
        a, b = prev.get(k), cur.get(k)
        if a and b and a.get('price') == b.get('price'):
            continue
        ref = b or a
        change = 'added' if not a else 'removed' if not b else 'changed'
        changes.append({
            'id': hashlib.sha1(f"{k}|{a and a.get('price')}|{b and b.get('price')}".encode()).hexdigest()[:12],
            'detectedAt': now, 'change': change, 'section': ref['section'], 'model': ref['model'],
            'item': ref['item'], 'column': ref['column'],
            'before': a.get('price') if a else None, 'after': b.get('price') if b else None,
            'beforeUsd': a.get('usd') if a else None, 'afterUsd': b.get('usd') if b else None,
        })
    return changes


def _text_lines(html: str) -> list[str]:
    s = re.sub(r'(?is)<(script|style).*?</\1>', '', html)
    s = re.sub(r'(?i)</(tr|p|h[1-6]|li|div|section)>', '\n', s)
    s = re.sub(r'(?i)</t[dh]>', ' | ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = htmllib.unescape(s)
    return [' '.join(l.split()) for l in s.split('\n') if l.strip()]


def parse_gemini_api(html: str) -> dict:
    """Standard paid-tier input/output from the Gemini API pricing page."""
    lines = _text_lines(html)
    out: dict[str, dict] = {}
    for i, line in enumerate(lines):
        if not re.fullmatch(r'Gemini [0-9][0-9.]*( [A-Z][A-Za-z-]*)+', line):
            continue
        mid = model_id(line)
        if not mid:
            continue
        window = lines[i + 1:i + 30]
        e: dict = {}
        for j, l in enumerate(window):
            if re.match(r'^Gemini [0-9]', l):
                break
            # Layout: 'Input price |', then the free-tier cell, then the paid-tier cell.
            # The first dollar amount within the next few cells is the paid Standard price.
            for kind, label in (('input', 'Input price'), ('output', 'Output price')):
                if l.startswith(label) and kind not in e:
                    cells = window[j:j + 4]
                    e[kind] = next((money(c) for c in cells if money(c) is not None), None)
        if e.get('input') is not None and e.get('output') is not None and mid not in out and TEXT_MODEL_RE.match(mid):
            out[mid] = e
    return out


KIND_PATTERNS = [
    ('shutdown', r'(?<!no )\bshut ?down\b(?! date announced)|\bdiscontinu|\bno longer available\b|\bturned off\b'),
    ('deprecation', r'\bdeprecat'),
    ('release', r'\breleased?\b|\blaunch|\bgenerally available\b|\bnow available\b|\bpreview\b'),
    ('pricing', r'\bpric(e|ing)\b'),
]
MODEL_RE = re.compile(r'\b(gemini-[0-9][a-z0-9.\-]*[a-z0-9]|claude-[a-z0-9\-]+[a-z0-9]|'
                      r'text-embeddings?-[0-9][a-z0-9\-]*|text-multilingual-embedding-[0-9]+|gemini-embedding-[a-z0-9.\-]*[a-z0-9])\b')


def parse_changelog(html: str) -> list[dict]:
    s = re.sub(r'(?is)<(script|style).*?</\1>', '', html)
    parts = re.split(r'<h2 id="(\d\d-\d\d-\d{4})"[^>]*>', s)
    entries = []
    for k in range(1, len(parts), 2):
        mm, dd, yyyy = parts[k].split('-')
        date = f'{yyyy}-{mm}-{dd}'
        text = ' '.join(htmllib.unescape(re.sub(r'<[^>]+>', ' ', parts[k + 1])).split())
        text = re.sub(r'^[A-Z][a-z]+ \d{1,2}, \d{4}\s*', '', text)
        # One item per "Title : description" sentence group.
        items = [t.strip() for t in re.split(r'(?<=[.)])\s+(?=[A-Z][\w .\-]{2,80}\s:)', text) if t.strip()]
        for item in items:
            low = item.lower()
            kinds = [k2 for k2, rx in KIND_PATTERNS if re.search(rx, low)]
            models = sorted(set(MODEL_RE.findall(item)))
            entries.append({'date': date, 'text': item[:600], 'kinds': kinds, 'models': models})
    return entries


# ---------------------------------------------------------------------------------------------
# Diff + report
# ---------------------------------------------------------------------------------------------
def entry_id(e: dict) -> str:
    return hashlib.sha1(f"{e['date']}|{e['text'][:200]}".encode()).hexdigest()[:12]


def diff_prices(prev: dict, cur: dict, source: str) -> list[dict]:
    changes = []
    for m in sorted(set(prev) | set(cur)):
        a, b = prev.get(m), cur.get(m)
        if a and not b:
            changes.append({'source': source, 'model': m, 'change': 'removed', 'before': a})
        elif b and not a:
            changes.append({'source': source, 'model': m, 'change': 'added', 'after': b})
        elif a and b and (a.get('input'), a.get('output'), a.get('next')) != (b.get('input'), b.get('output'), b.get('next')):
            changes.append({'source': source, 'model': m, 'change': 'price', 'before': a, 'after': b})
    return changes


def build_report(pages: dict[str, str | Exception], previous: dict | None, now: str) -> dict:
    errors, sources = [], {}
    vertex, gemini, changelog, all_prices = {}, {}, [], {}
    for key, url, parse, minimum in (
        ('vertex', VERTEX_PRICING_URL, parse_vertex, MIN_VERTEX_MODELS),
        ('gemini', GEMINI_PRICING_URL, parse_gemini_api, MIN_GEMINI_MODELS),
        ('changelog', CHANGELOG_URL, parse_changelog, 1),
    ):
        page = pages.get(key)
        if isinstance(page, Exception) or page is None:
            errors.append({'source': key, 'error': f'fetch failed: {page}'})
            sources[key] = {'url': url, 'ok': False}
            continue
        try:
            parsed = parse(page)
        except Exception as e:  # noqa: BLE001 - surface any parser failure to the admin
            errors.append({'source': key, 'error': f'parse failed: {e}'})
            sources[key] = {'url': url, 'ok': False}
            continue
        ok = len(parsed) >= minimum
        if not ok:
            errors.append({'source': key, 'error': f'page layout changed: only {len(parsed)} item(s) parsed'})
        sources[key] = {'url': url, 'ok': ok, 'items': len(parsed), 'sha256': hashlib.sha256(page.encode()).hexdigest()}
        if key == 'vertex':
            vertex = parsed
            try:
                all_prices = parse_vertex_all(page)
            except Exception as e:  # noqa: BLE001
                errors.append({'source': 'vertex', 'error': f'full-page price parse failed: {e}'})
        elif key == 'gemini':
            gemini = parsed
        else:
            changelog = parsed

    prev = previous or {}
    # A source that failed today keeps yesterday's data, so a blip is not reported as "everything removed".
    if not sources.get('vertex', {}).get('ok') and prev.get('vertex'):
        vertex = prev['vertex']
    if not sources.get('gemini', {}).get('ok') and prev.get('gemini'):
        gemini = prev['gemini']
    prev_all = prev.get('allPrices') or {}
    if prev_all and len(all_prices) < MIN_ALL_PRICES_RATIO * len(prev_all):
        if all_prices or sources.get('vertex', {}).get('ok'):
            errors.append({'source': 'vertex', 'error': f'page layout changed: {len(all_prices)} price cells parsed, '
                                                        f'{len(prev_all)} yesterday; kept yesterday\'s prices'})
        all_prices = prev_all
    if sources.get('vertex'):
        sources['vertex']['prices'] = len(all_prices)
        sources['vertex']['models'] = len({(v['section'], v['model']) for v in all_prices.values()})

    seen = set(prev.get('changelogSeen', []))
    for e in changelog:
        e['id'] = entry_id(e)
    first_run = not previous
    new_entries = [] if first_run else [e for e in changelog if e['id'] not in seen]
    page_changes = [] if (first_run or not prev_all) else diff_all_prices(prev_all, all_prices, now)
    changes = {
        'prices': [] if first_run else (
            diff_prices(prev.get('vertex', {}), vertex, 'vertex') + diff_prices(prev.get('gemini', {}), gemini, 'gemini')),
        'changelog': new_entries,
        'allPrices': page_changes,
    }
    cutoff = (dt.datetime.fromisoformat(now) - dt.timedelta(days=RECENT_DAYS)).isoformat()
    recent = page_changes + [c for c in prev.get('recentPriceChanges', []) if c.get('detectedAt', '') >= cutoff]
    disagreements = [
        {'model': m, 'vertex': {k: vertex[m].get(k) for k in ('input', 'output')},
         'gemini': {k: gemini[m].get(k) for k in ('input', 'output')}}
        for m in sorted(set(vertex) & set(gemini))
        if (vertex[m].get('input'), vertex[m].get('output')) != (gemini[m].get('input'), gemini[m].get('output'))
    ]
    report = {
        'schema': 1,
        'checkedAt': now,
        'firstRun': first_run,
        'sources': sources,
        'errors': errors,
        'vertex': vertex,
        'gemini': gemini,
        'sourceDisagreements': disagreements,
        'allPrices': all_prices,
        'recentPriceChanges': recent[:RECENT_MAX],
        'changelog': changelog[:CHANGELOG_KEEP],
        'changelogSeen': sorted(seen | {e['id'] for e in changelog})[-500:],
        'changesSinceLastRun': changes,
        'lastChangeAt': now if (changes['prices'] or changes['changelog'] or page_changes) else prev.get('lastChangeAt'),
    }
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='print the report; do not read or write GCS')
    ap.add_argument('--from-dir', help='parse saved pages instead of fetching (vertex.html, gemini.html, changelog.html)')
    args = ap.parse_args(argv)

    pages: dict[str, str | Exception] = {}
    for key, url, fname in (('vertex', VERTEX_PRICING_URL, 'vertex.html'), ('gemini', GEMINI_PRICING_URL, 'gemini.html'),
                            ('changelog', CHANGELOG_URL, 'changelog.html')):
        try:
            pages[key] = open(os.path.join(args.from_dir, fname), encoding='utf-8').read() if args.from_dir else fetch(url)
        except Exception as e:  # noqa: BLE001
            pages[key] = e

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    bucket = os.environ.get('MODEL_WATCH_BUCKET', '')
    prefix = os.environ.get('MODEL_WATCH_PREFIX', 'model-watch').strip('/')

    if args.dry_run or not bucket:
        if not args.dry_run:
            print('MODEL_WATCH_BUCKET is not set; running as --dry-run', file=sys.stderr)
        report = build_report(pages, None, now)
        print(json.dumps({k: report[k] for k in ('checkedAt', 'sources', 'errors', 'vertex', 'gemini', 'sourceDisagreements')}, indent=2))
        print(f"changelog entries: {len(report['changelog'])}; all price cells: {len(report['allPrices'])} "
              f"across {report['sources'].get('vertex', {}).get('models')} models", file=sys.stderr)
        return 1 if report['errors'] else 0

    token = access_token()
    previous = gcs_read(bucket, f'{prefix}/latest.json', token)
    report = build_report(pages, previous, now)
    gcs_write(bucket, f'{prefix}/latest.json', report, token)
    gcs_write(bucket, f'{prefix}/history/{now[:10]}.json', report, token)
    c = report['changesSinceLastRun']
    print(json.dumps({'checkedAt': now, 'errors': report['errors'], 'priceChanges': len(c['prices']),
                      'newChangelogEntries': len(c['changelog']), 'pagePriceChanges': len(c['allPrices']),
                      'pricesTracked': len(report['allPrices'])}))
    # Exit 0 even with source errors: the report carries them to the admin, and a failed job
    # would hide yesterday's good report behind a retry loop.
    return 0


if __name__ == '__main__':
    sys.exit(main())
