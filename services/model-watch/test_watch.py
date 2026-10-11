"""Unit tests for watch.py parsers and diffing (stdlib unittest; no network).

Fixtures are trimmed copies of the real page layouts (2026-10-10):
  * Vertex AI: an h2 family heading, then a table whose first column holds the model name
    only on its first row, a Region column, and price-schedule text in the model cell.
  * Gemini API: text blocks "Model name / Input price | / free cell | / $paid | ...".
  * Changelog: <h2 id="MM-DD-YYYY"> date headings followed by "Title : description" items.
Run: python3 -m unittest discover -s services/model-watch
"""
import unittest

import watch

VERTEX = """
<h2>Gemini 3</h2>
<table>
<tr><th>Model</th><th>Type</th><th>Region</th><th>Price (/1M tokens)&lt;= 200K input tokens</th><th>Price (/1M tokens)&gt; 200K input tokens</th></tr>
<tr><td>Gemini 3.1 Pro Preview</td><td>Input (text, image, video, audio)</td><td>Global</td><td>$2.00</td><td>$4.00</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$12.00</td><td>$18.00</td></tr>
<tr><td>Gemini 3.8 Flash*through December 31, 2026</td><td>Input (text, image, video, audio)</td><td>Global</td><td>$0.75</td><td>$0.75</td></tr>
<tr><td></td><td></td><td>Non-global</td><td>$0.825</td><td>$0.825</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$3.75</td><td>$3.75</td></tr>
<tr><td>Gemini 3.8 FlashStarting January 1, 2027</td><td>Input (text, image, video, audio)</td><td>Global</td><td>$1.50</td><td>$1.50</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$7.50</td><td>$7.50</td></tr>
<tr><td>Gemini 3.5 Flash-Lite</td><td>Input (text, image, video, audio)</td><td>Global</td><td>$0.30</td><td>$0.30</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$2.50</td><td>$2.50</td></tr>
<tr><td>Gemini 3.1 Flash-Lite</td><td>Input (text, image, video)</td><td>Global</td><td>$0.25</td><td>$0.25</td></tr>
<tr><td></td><td>Input (audio)</td><td>Global</td><td>$0.50</td><td>$0.50</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$1.50</td><td>$1.50</td></tr>
</table>
<h2>Gemini 3</h2>
<table>
<tr><th>Model</th><th>Type</th><th>Region</th><th>Price (/1M tokens)&lt;= 200K input tokens with Priority</th></tr>
<tr><td>Gemini 3.1 Pro Preview</td><td>Input (text, image, video, audio)</td><td>Global</td><td>$3.60</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$21.60</td></tr>
</table>
<h2>Gemini 2.5</h2>
<table>
<tr><th>Model</th><th>Type</th><th>Token Price &lt;= 200K tokens</th><th>Price &gt; 200K tokens</th></tr>
<tr><td>Gemini 2.5 Pro</td><td>Input (text, image, video, audio)</td><td>$1.25</td><td>$2.50</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>$10.00</td><td>$15.00</td></tr>
<tr><td>Gemini 2.5 Flash Image</td><td>Input (text, image)***</td><td>$0.30</td><td>N/A</td></tr>
<tr><td></td><td>Text output (response and reasoning)</td><td>$2.50</td><td>N/A</td></tr>
</table>
<h2>Anthropic’s Claude models</h2>
<table>
<tr><th>Model</th><th>Type</th><th>Price (/1M tokens) =&lt; 200K input tokens *</th></tr>
<tr><td>Claude Opus 4.5</td><td>Input</td><td>$5.00</td></tr>
<tr><td></td><td>Output</td><td>$25.00</td></tr>
<tr><td>Claude Haiku 4.5</td><td>Input</td><td>$1.00</td></tr>
<tr><td></td><td>Output</td><td>$5.00</td></tr>
<tr><td>Claude Haiku 5.5</td><td>Input</td><td></td><td>$0.10</td></tr>
<tr><td></td><td>Output</td><td></td><td>$0.50</td></tr>
<tr><td>Opus 5.5</td><td>Input</td><td>$4.00</td></tr>
<tr><td></td><td>Output</td><td>$20.00</td></tr>
</table>
<h2>Anthropic’s Claude models</h2>
<table>
<tr><th>Model</th><th>Type</th><th>Regional price (/1M tokens)</th></tr>
<tr><td>Claude Opus 4.5</td><td>Input</td><td>$5.50</td></tr>
<tr><td></td><td>Output</td><td>$27.50</td></tr>
</table>
"""

GEMINI = """
<h2>Gemini 3.1 Pro Preview</h2><p>gemini-3.1-pro-preview</p>
<table><tr><td></td><td>Free Tier</td><td>Paid Tier, per 1M tokens in USD</td></tr>
<tr><td>Input price</td><td>Not available</td><td>$2.00, prompts &lt;= 200k tokens $4.00, prompts &gt; 200k tokens</td></tr>
<tr><td>Output price (including thinking tokens)</td><td>Not available</td><td>$12.00, prompts &lt;= 200k tokens</td></tr></table>
<h2>Gemini 3.8 Flash</h2><p>gemini-3.8-flash</p>
<table><tr><td>Input price</td><td>Free of charge</td><td>$0.75 through December 31, 2026. $1.50 starting January 1, 2027.</td></tr>
<tr><td>Output price (including thinking tokens)</td><td>Free of charge</td><td>$3.75 through December 31, 2026.</td></tr></table>
<h2>Gemini 3.8 Flash TTS</h2>
<table><tr><td>Input price</td><td>Free of charge</td><td>$1.00</td></tr>
<tr><td>Output price</td><td>Free of charge</td><td>$20.00</td></tr></table>
"""

CHANGELOG = """
<h2 id="10-08-2026" data-text="October 8, 2026">October 8, 2026</h2>
<p><b>Gemini 3.5 Flash deprecation</b>: <code>gemini-3.5-flash</code> is deprecated and has been replaced by
<code>gemini-3.6-flash</code>. All requests are automatically routed.</p>
<p><b>Image model update</b>: The <code>gemini-3.1-flash-image</code> model is deprecated (no shutdown date announced).</p>
<h2 id="01-14-2026" data-text="January 14, 2026">January 14, 2026</h2>
<p>The <code>text-embedding-004</code> model has been shut down.</p>
<h2 id="07-21-2026" data-text="July 21, 2026">July 21, 2026</h2>
<p><b>Gemini 3.6 Flash generally available (GA)</b>: Released <code>gemini-3.6-flash</code>.</p>
"""


class VertexTest(unittest.TestCase):
    def setUp(self):
        self.p = watch.parse_vertex(VERTEX)

    def test_standard_global_prices(self):
        self.assertEqual((self.p['gemini-3.1-pro-preview']['input'], self.p['gemini-3.1-pro-preview']['output']), (2.0, 12.0))
        self.assertEqual((self.p['gemini-3.5-flash-lite']['input'], self.p['gemini-3.5-flash-lite']['output']), (0.3, 2.5))

    def test_priority_table_is_ignored(self):
        self.assertNotEqual(self.p['gemini-3.1-pro-preview']['output'], 21.6)

    def test_price_schedule(self):
        e = self.p['gemini-3.8-flash']
        self.assertEqual((e['input'], e['output'], e['until']), (0.75, 3.75, '2026-12-31'))
        self.assertEqual(e['next'], {'from': '2027-01-01', 'input': 1.5, 'output': 7.5})

    def test_audio_input_row_is_not_the_text_price(self):
        self.assertEqual(self.p['gemini-3.1-flash-lite']['input'], 0.25)

    def test_gemini_25_and_claude_tables(self):
        self.assertEqual(self.p['gemini-2.5-pro']['output'], 10.0)
        self.assertEqual((self.p['claude-opus-4-5']['input'], self.p['claude-opus-4-5']['output']), (5.0, 25.0))
        self.assertEqual(self.p['claude-haiku-4-5']['output'], 5.0)

    def test_claude_rows_without_brand_prefix(self):
        self.assertEqual((self.p['claude-opus-5-5']['input'], self.p['claude-opus-5-5']['output']), (4.0, 20.0))

    def test_claude_row_priced_only_in_the_100k_column(self):
        self.assertEqual((self.p['claude-haiku-5-5']['input'], self.p['claude-haiku-5-5']['output']), (0.1, 0.5))

    def test_non_text_variants_dropped(self):
        self.assertFalse(any('image' in k for k in self.p))


class GeminiApiTest(unittest.TestCase):
    def test_paid_standard_prices(self):
        p = watch.parse_gemini_api(GEMINI)
        self.assertEqual(p['gemini-3.1-pro-preview'], {'input': 2.0, 'output': 12.0})
        self.assertEqual(p['gemini-3.8-flash'], {'input': 0.75, 'output': 3.75})
        self.assertNotIn('gemini-3.8-flash-tts', p)


class ChangelogTest(unittest.TestCase):
    def test_entries(self):
        e = watch.parse_changelog(CHANGELOG)
        dep = next(x for x in e if 'gemini-3.5-flash' in x['models'])
        self.assertEqual(dep['date'], '2026-10-08')
        self.assertIn('deprecation', dep['kinds'])
        self.assertIn('gemini-3.6-flash', dep['models'])
        img = next(x for x in e if 'gemini-3.1-flash-image' in x['models'])
        self.assertNotIn('shutdown', img['kinds'])  # "no shutdown date announced"
        emb = next(x for x in e if x['date'] == '2026-01-14')
        self.assertEqual(emb['models'], ['text-embedding-004'])
        self.assertIn('shutdown', emb['kinds'])
        rel = next(x for x in e if x['date'] == '2026-07-21')
        self.assertIn('release', rel['kinds'])


class ReportTest(unittest.TestCase):
    def pages(self, vertex=VERTEX):
        return {'vertex': vertex, 'gemini': GEMINI + GEMINI.replace('3.1 Pro', '2.5 Pro').replace('3.8 Flash', '2.5 Flash')
                + GEMINI.replace('3.1 Pro', '3.5 Flash-Lite'), 'changelog': CHANGELOG}

    def test_first_run_reports_no_changes(self):
        r = watch.build_report(self.pages(), None, '2026-10-10T00:00:00+00:00')
        self.assertTrue(r['firstRun'])
        self.assertEqual(r['changesSinceLastRun'], {'prices': [], 'changelog': [], 'allPrices': []})
        self.assertEqual(r['recentPriceChanges'], [])

    def test_price_change_and_new_changelog_entry(self):
        prev = watch.build_report(self.pages(), None, '2026-10-09T00:00:00+00:00')
        prev['changelogSeen'] = prev['changelogSeen'][1:]
        cur = watch.build_report(self.pages(VERTEX.replace('$12.00', '$11.00')), prev, '2026-10-10T00:00:00+00:00')
        changes = cur['changesSinceLastRun']
        self.assertTrue(any(c['model'] == 'gemini-3.1-pro-preview' and c['change'] == 'price' for c in changes['prices']))
        self.assertEqual(len(changes['changelog']), 1)

    def test_layout_change_is_an_error_and_keeps_previous_prices(self):
        prev = watch.build_report(self.pages(), None, '2026-10-09T00:00:00+00:00')
        cur = watch.build_report(self.pages('<html>redesigned</html>'), prev, '2026-10-10T00:00:00+00:00')
        self.assertTrue(any(e['source'] == 'vertex' and 'layout' in e['error'] for e in cur['errors']))
        self.assertEqual(cur['vertex'], prev['vertex'])
        self.assertFalse(any(c['change'] == 'removed' for c in cur['changesSinceLastRun']['prices']))


class AllPricesTest(unittest.TestCase):
    """Every price cell on the Vertex page is tracked, not only rate-card models."""

    def setUp(self):
        self.p = watch.parse_vertex_all(VERTEX)

    def test_every_price_cell_is_captured(self):
        self.assertEqual(len(self.p), VERTEX.count('<td>$'))
        sections = {v['section'] for v in self.p.values()}
        self.assertTrue({'Gemini 3', 'Gemini 2.5', 'Anthropic’s Claude models'} <= sections)

    def test_non_rate_card_models_and_variants_are_included(self):
        models = {v['model'] for v in self.p.values()}
        self.assertIn('Gemini 2.5 Flash Image', models)            # not a text model
        self.assertTrue(any('Priority' in v['column'] for v in self.p.values()))  # Priority table
        self.assertTrue(any(v['item'].endswith('Non-global') for v in self.p.values()))

    def test_model_name_carries_forward_to_following_rows(self):
        k = 'Gemini 3 | Gemini 3.1 Pro Preview | Text output (response and reasoning) · Global | Price (/1M tokens)<= 200K input tokens'
        self.assertEqual(self.p[k]['price'], '$12.00')
        self.assertEqual(self.p[k]['usd'], 12.0)

    def _pages(self, vertex):
        return {'vertex': vertex, 'gemini': GEMINI * 3, 'changelog': CHANGELOG}

    def test_change_added_removed_and_rolling_window(self):
        d1 = watch.build_report(self._pages(VERTEX), None, '2026-10-01T00:00:00+00:00')
        v2 = VERTEX.replace('<td>$27.50</td>', '<td>$26.00</td>').replace(
            '<tr><td>Claude Haiku 4.5</td><td>Input</td><td>$1.00</td></tr>',
            '<tr><td>Claude Haiku 4.5</td><td>Input</td><td>$1.00</td></tr><tr><td></td><td>Batch Input</td><td>$0.50</td></tr>')
        d2 = watch.build_report(self._pages(v2), d1, '2026-10-02T00:00:00+00:00')
        ch = {(c['change'], c['model'], c['before'], c['after']) for c in d2['changesSinceLastRun']['allPrices']}
        self.assertIn(('changed', 'Claude Opus 4.5', '$27.50', '$26.00'), ch)
        self.assertIn(('added', 'Claude Haiku 4.5', None, '$0.50'), ch)
        self.assertEqual(len(d2['recentPriceChanges']), 2)
        d3 = watch.build_report(self._pages(v2), d2, '2026-10-20T00:00:00+00:00')   # no new change
        self.assertEqual(len(d3['recentPriceChanges']), 2, 'kept for RECENT_DAYS')
        d4 = watch.build_report(self._pages(v2), d3, '2026-11-15T00:00:00+00:00')
        self.assertEqual(d4['recentPriceChanges'], [], 'expired after RECENT_DAYS')

    def test_layout_drop_keeps_yesterdays_prices_without_mass_removals(self):
        d1 = watch.build_report(self._pages(VERTEX), None, '2026-10-01T00:00:00+00:00')
        half = '<h2>Gemini 2.5</h2>' + VERTEX.split('<h2>Gemini 2.5</h2>')[1]  # Gemini 3 tables gone (<60% of cells left)
        d2 = watch.build_report(self._pages(half), d1, '2026-10-02T00:00:00+00:00')
        self.assertEqual(d2['allPrices'], d1['allPrices'])
        self.assertEqual(d2['changesSinceLastRun']['allPrices'], [])
        self.assertTrue(any('price cells parsed' in e['error'] for e in d2['errors']))


if __name__ == '__main__':
    unittest.main()
