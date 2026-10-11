/**
 * Customer theme library (/api/themes/*).
 *
 * Themes live outside the container, in a private Cloud Storage bucket, so new
 * customers can be added without a redeploy:
 *
 *   gs://<bucket>/themes/<id>.json   theme (name, colours, font, industry)
 *   gs://<bucket>/logos/<id>         logo bytes (content type kept on the object)
 *   gs://<bucket>/wordmarks/<id>     full logo with the company name (optional, wide)
 *   gs://<bucket>/industries/<id>.json  industries the agent added (see industryGenerator.js)
 *
 * The bucket is private; the server reads and writes it with the service
 * account and serves logos same-origin through /api/themes/logo/<id>.
 *
 * "Request a theme" (POST /api/themes/requests) runs a small theme agent: it
 * asks Gemini, through the Apigee AI Gateway with the caller's own key (so the
 * call is governed and shows up in Analytics like any other), for the brand's
 * colours, closest Google Font and industry, fetches the site icon when no logo
 * was uploaded, and writes both to the bucket. If the customer fits none of the
 * known industries, the agent adds one (personas and scenario prompts) first.
 *
 * Presenters can add and edit themes but never remove them (no delete route;
 * removal is an admin task in the bucket). Nothing is overwritten by accident:
 * a request for a customer that already exists is refused (409 'exists'), and
 * an edit must name the version it started from, so it cannot silently undo
 * another presenter's change (409 'stale').
 *
 * No runtime dependencies: Cloud Storage JSON API over fetch.
 */

import { inflateSync } from 'node:zlib';
import { buildIndustryPrompt, industryFromSlots, industryLabelFrom, sanitizeLibraryIndustry, slugifyIndustryId } from './industryGenerator.js';
import { APIGEE_ORG, AI_BASE_PROD, DEMO_ADMIN_EMAIL, THEME_BUCKET } from './deployConfig.js';

export { THEME_BUCKET };
const ORG = APIGEE_ORG;
// Grounded brand research: gemini-3.6-flash gets real brand colours (~7 s, <$0.002);
// flash-lite is the fallback (faster, cheaper, noticeably less accurate).
const THEME_AGENT_MODEL = process.env.THEME_AGENT_MODEL || 'gemini-3.6-flash';
const THEME_AGENT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const LIST_CACHE_MS = 60 * 1000;
// Auto-added industries stop here, so a run of odd requests cannot flood the picker.
const MAX_LIBRARY_INDUSTRIES = 60;
const KEY_CACHE_MS = 5 * 60 * 1000;
const AGENT_TIMEOUT_MS = 45 * 1000;
// Room for two base64 images (logo + wordmark, 400 KB each) in one edit.
const MAX_BODY_BYTES = 1536 * 1024;
export const MAX_LOGO_BYTES = 400 * 1024;
// Bucket folders for the two theme images, served at /api/themes/<kind>/<id>.
const IMAGE_FOLDERS = { logo: 'logos', wordmark: 'wordmarks' };
const SITE_FETCH_TIMEOUT_MS = 6000;
const MAX_SITE_HTML_BYTES = 1536 * 1024;
const MAX_SITE_CSS_BYTES = 512 * 1024;
const MAX_SITE_STYLESHEETS = 3;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
// Raster logos smaller than this (on their longer side) look blurry in the header; a monogram is better.
export const MIN_LOGO_PX = 96;
// Wikimedia's API policy wants a descriptive User-Agent with a contact; generic ones are throttled.
const WIKIMEDIA_HEADERS = { 'User-Agent': `ApigeeAIGatewayDemo/1.0 (theme agent; ${DEMO_ADMIN_EMAIL})`, Accept: 'application/json,image/*;q=0.9' };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function slugifyId(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function normalizeHexColor(v) {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/** Black, white and greys are not usable brand colours (text and surfaces already are). */
export function isNeutralColor(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return true;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 40;
}

function cleanFont(v) {
  if (v === 'system') return 'system';
  if (typeof v !== 'string') return 'system';
  const f = v.replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  return f && f.toLowerCase() !== 'system' ? f : 'system';
}

/**
 * Public hostname from a website field ("https://www.acme.com/in", "acme.com").
 * IPs, localhost and internal names are refused: the server fetches the site icon
 * from this host, so it must not be pointed at anything private.
 */
export function websiteHost(website) {
  if (typeof website !== 'string') return null;
  let s = website.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let host;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  if (/^\d+(\.\d+)+$/.test(host)) return null;
  if (/(^|\.)(localhost|internal|local|lan|corp|home|arpa)$/.test(host)) return null;
  if (!/\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

/** Theme record as stored in the bucket, or null. Logos are referenced, never inlined. */
export function sanitizeLibraryTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && /^[a-z0-9-]{1,64}$/.test(raw.id) ? raw.id : null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
  if (!id || !name) return null;
  const logoUrl =
    typeof raw.logoUrl === 'string' && /^\/api\/themes\/logo\/[a-z0-9-]{1,64}(\?v=\d{1,16})?$/.test(raw.logoUrl)
      ? raw.logoUrl
      : '';
  const wordmarkUrl =
    typeof raw.wordmarkUrl === 'string' && /^\/api\/themes\/wordmark\/[a-z0-9-]{1,64}(\?v=\d{1,16})?$/.test(raw.wordmarkUrl)
      ? raw.wordmarkUrl
      : '';
  const industry = typeof raw.industry === 'string' && /^[a-z0-9-]{1,32}$/.test(raw.industry) ? raw.industry : 'generic';
  const website = typeof raw.website === 'string' ? websiteHost(raw.website) || '' : '';
  return {
    id,
    name,
    website,
    logoUrl,
    wordmarkUrl,
    wordmarkWhite: Boolean(wordmarkUrl && raw.wordmarkWhite),
    showName: Boolean(raw.showName),
    headerBg: normalizeHexColor(raw.headerBg),
    primary: normalizeHexColor(raw.primary),
    accent: normalizeHexColor(raw.accent),
    font: cleanFont(raw.font),
    industry,
    requestedBy: typeof raw.requestedBy === 'string' ? raw.requestedBy.slice(0, 120) : '',
    editedBy: typeof raw.editedBy === 'string' ? raw.editedBy.slice(0, 120) : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : '',
    agentNotes: typeof raw.agentNotes === 'string' ? raw.agentNotes.slice(0, 400) : '',
  };
}

/** `data:image/...;base64,...` → { type, bytes }, or null if not an allowed image. */
export function parseLogoDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!LOGO_TYPES.includes(type)) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) return null;
  return { type, bytes };
}

/** Validated "Request a theme" form, or throws Error with status 400. */
export function parseThemeRequest(body) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!body || typeof body !== 'object') throw bad('Body must be a JSON object.');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) throw bad('Enter the customer name.');
  const host = websiteHost(body.website);
  if (!host) throw bad('Enter the customer website, e.g. https://www.example.com');
  const ids = (list, re, max) =>
    Array.isArray(list) ? list.filter((x) => typeof x === 'string' && re.test(x)).slice(0, max) : [];
  const industries = ids(body.industries, /^[a-z0-9-]{1,32}$/, 100);
  const fonts = ids(body.fonts, /^[A-Za-z0-9 ]{1,48}$/, 60);
  const industry =
    typeof body.industry === 'string' && industries.includes(body.industry) && body.industry !== 'generic'
      ? body.industry
      : '';
  let logo = null;
  if (body.logoDataUrl) {
    logo = parseLogoDataUrl(body.logoDataUrl);
    if (!logo) throw bad('The logo must be a PNG, JPEG, WebP, GIF or SVG image under 400 KB.');
  }
  let wordmark = null;
  if (body.wordmarkDataUrl) {
    wordmark = parseLogoDataUrl(body.wordmarkDataUrl);
    if (!wordmark) throw bad('The full logo must be a PNG, JPEG, WebP, GIF or SVG image under 400 KB.');
  }
  return { name, host, industry, industries, fonts, logo, wordmark };
}

/** First JSON object in a model reply (tolerates ```json fences and prose around it). */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function buildAgentPrompt({ name, host, industry, industries, fonts, site = null }) {
  const headerBgs = site?.headerBgs || [];
  const evidence = site && (site.colors.length || site.themeColor || site.fonts.length || headerBgs.length)
    ? [
        '',
        `Evidence read directly from https://${host}/ (its HTML and stylesheets). This is ground truth; prefer it over search results:`,
        ...(site.themeColor ? [`  meta theme-color: ${site.themeColor}`] : []),
        ...(site.colors.length ? [`  brand colours used on the site, most used first: ${site.colors.join(', ')}`] : []),
        ...(headerBgs.length ? [`  background of the site's top header bar: ${headerBgs.slice(0, 3).join(', ')}`] : []),
        ...(site.fonts.length ? [`  fonts the site loads: ${site.fonts.join(', ')}`] : []),
        'Pick "primary" and "accent" from the site colours above (primary must read well as a button colour on white).',
      ]
    : [];
  return [
    `Company: ${name}`,
    `Official website: https://${host}`,
    ...evidence,
    '',
    'Find this company\'s official brand identity (logo and website colours, brand guidelines if public).',
    'Reply with ONLY one JSON object, no prose, with these keys:',
    '  "name": the short brand name as the company writes it,',
    '  "primary": main brand colour as "#rrggbb" (the dominant colour of the logo / website header),',
    '  "accent": secondary brand colour as "#rrggbb", or "" if the brand has only one colour,',
    '  "headerBackground": the background colour of the website\'s top navigation bar as "#rrggbb" ("#ffffff" if it is white or light). This is the bar that holds the logo on the desktop site: if the logo sits on white and only a menu strip below it is coloured, answer "#ffffff",',
    `  "font": the closest match to the brand's typeface from this list: ${fonts.length ? fonts.join(', ') : 'Inter, Roboto, Open Sans'},`,
    industry
      ? `  "industry": "${industry}",`
      : `  "industry": the best fit from this list: ${industries.filter((i) => i !== 'generic').join(', ') || 'generic'}; or "new" if none of them fits the company's core business,`,
    '  "industryLabel": the company\'s industry in 2-4 words, e.g. "Media & Entertainment",',
    '  "notes": one short sentence on where the colours come from.',
    'Brand colours must be real hues: never black, white or grey.',
    'Never invent colours: if you are unsure, use the colours visible in the logo.',
  ].join('\n');
}

/**
 * Merges the agent's answer with the request into a stored theme. The header
 * bar colour comes from the site's own header CSS; the model's
 * "headerBackground" is used only when the site uses that colour too, and a
 * white wordmark gets the brand colour behind it (see chooseHeaderBg).
 */
export function themeFromAgent({ request, answer, id, logoUrl, wordmarkUrl = '', wordmarkLightness = null, requestedBy, nowIso, site = null }) {
  const a = answer && typeof answer === 'object' ? answer : {};
  const industry = request.industry || (request.industries.includes(a.industry) ? a.industry : 'generic');
  // A font the site actually loads beats the model's guess.
  const siteFont = (site?.fonts || []).map((f) => request.fonts.find((x) => x.toLowerCase() === f.toLowerCase())).find(Boolean);
  const font = siteFont || (request.fonts.includes(a.font) ? a.font : 'system');
  // Colours the site does not use are model guesses: replace them with the site's own.
  const siteColors = site?.colors || [];
  const onSite = (hex) => !siteColors.length || siteColors.some((c) => colorDistance(c, hex) <= 48);
  let primary = isNeutralColor(a.primary) ? '' : normalizeHexColor(a.primary);
  let accent = isNeutralColor(a.accent) ? '' : normalizeHexColor(a.accent);
  if (primary && !onSite(primary)) primary = '';
  if (accent && !onSite(accent)) accent = '';
  if (!primary && siteColors.length) primary = siteColors[0];
  if (!accent && siteColors.length) accent = siteColors.find((c) => colorDistance(c, primary) > 80) || '';
  const modelHeader = normalizeHexColor(a.headerBackground);
  const siteHeaderCss = site?.headerBgs || [];
  // The model's colour counts when the site uses it too, or (the CSS showed no header at
  // all, e.g. a JS-rendered site) when it is a dark bar like Axis maroon. When the site
  // could not be read at all (bot wall), a guessed dark bar is used only if there is no
  // dark full logo to hide behind it (BookMyShow's header is white, not the model's #333545).
  const darkWordmark = Boolean(wordmarkUrl) && !(wordmarkLightness != null && wordmarkLightness > 0.8);
  const trustModel = modelHeader && (siteColors.some((c) => colorDistance(c, modelHeader) <= 48) || (!siteHeaderCss.length && contrastWithWhite(modelHeader) >= 3 && (site || !darkWordmark)));
  const siteHeader = [...siteHeaderCss, ...(trustModel ? [modelHeader] : [])];
  const headerBg = chooseHeaderBg({ siteHeader, wordmarkLightness: wordmarkUrl ? wordmarkLightness : null, primary: primary || '#1a73e8' });
  const wordmarkWhite = Boolean(wordmarkUrl) && wantsWhiteWordmark({ headerBg, wordmarkLightness });
  return sanitizeLibraryTheme({
    id,
    // The customer name the presenter typed is what they expect to see.
    name: request.name,
    website: request.host,
    logoUrl,
    wordmarkUrl,
    wordmarkWhite,
    showName: false,
    headerBg,
    primary: primary || '#1a73e8',
    accent: accent && accent !== primary ? accent : '',
    font,
    industry,
    requestedBy,
    updatedAt: nowIso,
    agentNotes: typeof a.notes === 'string' ? a.notes : primary ? '' : 'Brand colours not found; using a neutral blue. Edit the theme to fix.',
  });
}

// ---------------------------------------------------------------------------
// Site evidence: what the customer's own homepage says about its brand
// ---------------------------------------------------------------------------

/** Euclidean RGB distance between two hex colours (0..442); Infinity if either is invalid. */
export function colorDistance(a, b) {
  const x = normalizeHexColor(a);
  const y = normalizeHexColor(b);
  if (!x || !y) return Infinity;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [p, q] = [rgb(x), rgb(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function decodeEntities(v) {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Attributes of one start tag, lower-cased names, entity-decoded values. */
function tagAttributes(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/** `data:image/...` URL (base64 or URL-encoded, as inline SVG favicons are) → { type, bytes }, or null. */
export function parseDataImageUrl(href) {
  if (typeof href !== 'string') return null;
  const m = href.match(/^data:(image\/[a-z0-9.+-]+)((?:;[a-z0-9=-]+)*?)(;base64)?,(.*)$/is);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!LOGO_TYPES.includes(type)) return null;
  let bytes;
  try {
    bytes = m[3] ? Buffer.from(m[4], 'base64') : Buffer.from(decodeURIComponent(m[4]), 'utf8');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) return null;
  return { type, bytes };
}

/**
 * Pixel size of a raster image from its header (PNG, GIF, JPEG, WebP, ICO: the
 * largest entry), or null when unknown. SVGs scale, so they have no size here.
 */
export function imageDimensions(type, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return null;
  try {
    if (type === 'image/png' && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (type === 'image/gif' && bytes.toString('latin1', 0, 3) === 'GIF') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (type === 'image/webp' && bytes.toString('latin1', 8, 12) === 'WEBP') {
      const chunk = bytes.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = bytes.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      return null;
    }
    if ((type === 'image/x-icon' || type === 'image/vnd.microsoft.icon') && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
      const count = bytes.readUInt16LE(4);
      let best = null;
      for (let i = 0; i < count && 6 + 16 * (i + 1) <= bytes.length; i++) {
        const w = bytes[6 + 16 * i] || 256;
        const h = bytes[7 + 16 * i] || 256;
        if (!best || w * h > best.width * best.height) best = { width: w, height: h };
      }
      return best;
    }
    if (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Whether an image is crisp enough to be the header logo: SVGs always; rasters
 * when their longer side is at least MIN_LOGO_PX (by byte size when the header
 * cannot be read).
 */
export function isSharpLogo(img) {
  if (!img?.bytes?.length) return false;
  if (img.type === 'image/svg+xml') return true;
  const dims = imageDimensions(img.type, img.bytes);
  if (dims) return Math.max(dims.width, dims.height) >= MIN_LOGO_PX;
  return img.bytes.length >= 1500;
}

/** SVG size from width/height attributes or the viewBox, or null. */
export function svgDimensions(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.subarray(0, 4096).toString('utf8') : String(bytes || '');
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const a = tagAttributes(tag);
  const w = parseFloat(a.width);
  const h = parseFloat(a.height);
  if (w > 0 && h > 0 && !/%/.test(`${a.width}${a.height}`)) return { width: w, height: h };
  const vb = String(a.viewbox || '').trim().split(/[\s,]+/).map(Number);
  return vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { width: vb[2], height: vb[3] } : null;
}

// A wordmark (logo + company name) is wide; the header shows it ~36 px tall.
export const MIN_WORDMARK_ASPECT = 2;
export const MIN_WORDMARK_HEIGHT_PX = 32;

/**
 * Whether an image is a usable wordmark: at least 2:1 wide, and an SVG or a
 * raster at least MIN_WORDMARK_HEIGHT_PX tall (smaller ones blur in the header).
 */
export function isWordmark(img) {
  if (!img?.bytes?.length) return false;
  const svg = img.type === 'image/svg+xml';
  const dims = svg ? svgDimensions(img.bytes) : imageDimensions(img.type, img.bytes);
  if (!dims || dims.width / dims.height < MIN_WORDMARK_ASPECT) return false;
  return svg || dims.height >= MIN_WORDMARK_HEIGHT_PX;
}

/** Lower-case letters and digits only: "Book My Show" and "BookMyShow" match. */
export function nameKey(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/** Whether a Wikipedia article / Commons file title is about the company `name`. */
export function titleMatchesName(title, name) {
  const t = nameKey(String(title || '').replace(/^File:/i, '').replace(/\.[a-z]+$/i, ''));
  const n = nameKey(name);
  if (n.length < 3 || t.length < 3) return false;
  return t.includes(n) || (n.includes(t) && t.length >= 5);
}

const COMPANY_SUFFIX = /^(limited|ltd|inc|plc|corp|corporation|company|co|group|holdings|pcl|bhd|berhad|tbk|sa|ag|ltda|india|indonesia|thailand|philippines|singapore)*$/;

/** Stricter match for a Wikipedia article title: the name itself, maybe with a company suffix ("Axis Bank" vs "HPCL-Mittal Energy"). */
export function articleMatchesName(title, name) {
  const t = nameKey(String(title || '').replace(/\s*\([^)]*\)\s*$/, ''));
  const n = nameKey(name);
  if (n.length < 3 || t.length < 3) return false;
  if (t.startsWith(n)) return COMPANY_SUFFIX.test(t.slice(n.length));
  return n.startsWith(t) && t.length >= 5 && COMPANY_SUFFIX.test(n.slice(t.length));
}

/** The file named in an infobox `| logo = ...` field of article wikitext, or ''. */
export function infoboxLogoFile(wikitext) {
  const m = String(wikitext || '').match(/\|\s*logo\s*=\s*(?:\[\[)?\s*(?:File:|Image:)?\s*([^|\]\n}<]+?\.(?:svg|png|jpe?g|gif|webp))/i);
  return m ? m[1].trim() : '';
}

/** The best Commons logo file among search result titles for `name`: name in the file name, "logo" in it, SVG first. */
export function pickCommonsLogo(titles, name) {
  const files = (titles || []).filter((t) => /^File:.*\.(svg|png)$/i.test(t) && /logo/i.test(t) && titleMatchesName(t, name));
  return files.find((t) => /\.svg$/i.test(t)) || files[0] || '';
}

function hexLuminance(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of a colour against white (1..21); 1 if invalid. */
function contrastWithWhite(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return 1;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

/** Average luminance (0..1) of the opaque pixels of an 8-bit, non-interlaced PNG; null otherwise. */
function pngLightness(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString('latin1', off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels || depth !== 8 || interlace !== 0 || !w || !h || w * h > 4_000_000) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  if (raw.length < h * (stride + 1)) return null;
  let prev = Buffer.alloc(stride);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = prev[i];
      const ul = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - ul;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - ul)];
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const px = x * channels;
      const alpha = channels === 4 ? line[px + 3] : channels === 2 ? line[px + 1] : 255;
      if (alpha < 128) continue;
      const [r, g, b] = channels >= 3 ? [line[px], line[px + 1], line[px + 2]] : [line[px], line[px], line[px]];
      sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      n++;
    }
    prev = line;
  }
  return n ? sum / n : null;
}

/** Average luminance of the colours an SVG paints with (masks and clip paths ignored); null if none. */
function svgLightness(bytes) {
  const text = bytes.toString('utf8').replace(/<(mask|clipPath)\b[\s\S]*?<\/\1>/gi, '');
  const named = { white: '#ffffff', black: '#000000' };
  const values = [];
  for (const m of text.matchAll(/(?:\b(?:fill|stop-color)\s*=\s*["']|\b(?:fill|stop-color)\s*:\s*)(#[0-9a-f]{3,6}\b|white|black)/gi)) {
    const v = named[m[1].toLowerCase()] || m[1];
    const l = hexLuminance(v);
    if (l !== null) values.push(l);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * How light a logo is (0 = black, 1 = white), from its painted pixels or
 * colours; null when it cannot be read. A light wordmark (e.g. ICICI's white
 * one) needs a coloured header bar behind it.
 */
export function imageLightness(img) {
  if (!img?.bytes?.length) return null;
  try {
    if (img.type === 'image/png') return pngLightness(img.bytes);
    if (img.type === 'image/svg+xml') return svgLightness(img.bytes);
  } catch {
    return null;
  }
  return null;
}

/** Hex for a CSS colour token (#hex, rgb()/rgba(), white/black); '' if none or mostly transparent. */
function cssColorHex(token) {
  const t = String(token || '').trim().toLowerCase();
  if (t === 'white') return '#ffffff';
  if (t === 'black') return '#000000';
  const hex = normalizeHexColor(t.match(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/)?.[0] || '');
  if (hex) return hex;
  const m = t.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (!m) return '';
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha < 0.5) return '';
  return `#${[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
}

function mixHex(a, b, t) {
  const p = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const q = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The colour a CSS background value shows: a plain colour, or the colour at
 * the middle of a linear gradient (stops interpolated), with var(--x) resolved
 * from the custom properties. '' when none.
 */
export function cssBackgroundColor(value, vars = new Map(), depth = 0) {
  if (typeof value !== 'string' || depth > 4) return '';
  const resolved = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) => {
    // Tailwind's --tw-* (e.g. --tw-bg-opacity) are per-element utilities: the first
    // definition in the stylesheet belongs to some other class, so use the fallback.
    if (fallback && name.startsWith('--tw-')) return fallback;
    const v = vars.get(name);
    return v !== undefined ? v : fallback || '';
  });
  if (resolved !== value && /var\(/.test(resolved)) return cssBackgroundColor(resolved, vars, depth + 1);
  const grad = resolved.match(/linear-gradient\(([\s\S]*)\)/i);
  if (grad) {
    const stops = [];
    for (const m of grad[1].matchAll(/(#[0-9a-f]{3,6}\b|rgba?\([^)]*\))\s*(-?[\d.]+%)?/gi)) {
      const hex = cssColorHex(m[1]);
      if (hex) stops.push({ hex, pos: m[2] === undefined ? null : parseFloat(m[2]) });
    }
    if (!stops.length) return '';
    stops.forEach((s, i) => {
      if (s.pos === null) s.pos = stops.length === 1 ? 50 : (i / (stops.length - 1)) * 100;
    });
    const after = stops.findIndex((s) => s.pos >= 50);
    if (after <= 0) return stops[after === 0 ? 0 : stops.length - 1].hex;
    const a = stops[after - 1];
    const b = stops[after];
    return mixHex(a.hex, b.hex, b.pos === a.pos ? 0 : (50 - a.pos) / (b.pos - a.pos));
  }
  for (const tok of resolved.match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi) || []) {
    const hex = cssColorHex(tok);
    if (hex) return hex;
  }
  return '';
}

/**
 * Background colours of the site's top bar, most likely first.
 *
 * 1. The page's own first <header> (or, failing that, <nav>) element: an inline
 *    background, then the backgrounds of its classes. Many sites colour the bar
 *    with a utility class (CJ More: <header class="h-navbar bgclr-green">), which
 *    no header-named CSS rule reveals.
 * 2. CSS rules whose selector ends in header / nav / .header… / .navbar / .topbar /
 *    .masthead (no hover, pseudo-element or descendant-only rules), most used first.
 */
export function extractHeaderBackgrounds(cssTexts, html = '') {
  const texts = (Array.isArray(cssTexts) ? cssTexts : [cssTexts]).filter((t) => typeof t === 'string' && t);
  const vars = new Map();
  for (const css of texts) {
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
      const v = m[2].trim();
      if (!vars.has(m[1]) && v && v !== 'none' && v !== 'initial') vars.set(m[1], v);
    }
  }
  const bgOf = (decls) => {
    let hex = '';
    for (const d of decls.matchAll(/(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+)/gi)) {
      hex = cssBackgroundColor(d[1].replace(/!important/i, ''), vars) || hex;
    }
    return hex;
  };

  // The bar element in the markup: its inline style and class names.
  const fromHtml = [];
  const wantClasses = new Set();
  if (typeof html === 'string' && html) {
    const el = html.match(/<header\b[^>]*>/i) || html.match(/<nav\b[^>]*>/i);
    if (el) {
      const style = el[0].match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i);
      const inline = style ? bgOf(style[2]) : '';
      if (inline) fromHtml.push(inline);
      const cls = el[0].match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
      for (const c of cls ? cls[2].split(/\s+/) : []) if (/^[\w-]+$/.test(c)) wantClasses.add(c);
    }
  }
  const classBg = new Map();

  const counts = new Map();
  const target = /^(?:header|nav)(?:[.#][\w-]+)*$|^[\w-]*[.#][\w-]*(?:header|navbar|topbar|top-bar|masthead|site-nav|main-nav)(?:__|--|-|_)?[\w-]*$/i;
  for (const css of texts) {
    // Split on "}" rather than a regex: `([^{}]+)\{` backtracks quadratically on long
    // brace-free runs (base64 fonts/images), which hung the agent on real sites.
    for (const chunk of css.split('}')) {
      const open = chunk.lastIndexOf('{');
      if (open < 0) continue;
      const head = chunk.slice(0, open);
      const selectorText = head.slice(head.lastIndexOf('{') + 1).replace(/\/\*[\s\S]*?\*\//g, '');
      if (selectorText.length > 2000) continue;
      const decls = chunk.slice(open + 1);
      const selectors = selectorText.split(',').map((s) => s.trim()).filter(Boolean);
      // A plain `.class` rule for one of the bar element's classes (last one in the CSS wins).
      if (wantClasses.size) {
        for (const s of selectors) {
          const m = s.match(/^\.([\w-]+)$/);
          if (m && wantClasses.has(m[1])) {
            const hex = bgOf(decls);
            if (hex) classBg.set(m[1], hex);
          }
        }
      }
      const hit = selectors.some((s) => {
        if (/[:[]/.test(s) || s.startsWith('@')) return false;
        const last = s.split(/[\s>+~]+/).pop();
        // ui-widget-header is jQuery UI's datepicker/dialog title bar, not the site header;
        // .navbar-collapse is the mobile menu panel.
        if (/ui-widget|widget-header|collapse/i.test(last)) return false;
        return target.test(last) && !/(?:footer|menu|dropdown|sub|mobile|modal|search|btn|button|icon|link|item|logo|title|text|top-nav|overlay|backdrop|drawer|sidebar|shadow|mask)/i.test(last.replace(/header|navbar|masthead/i, ''));
      });
      if (!hit) continue;
      for (const d of decls.matchAll(/(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+)/gi)) {
        const hex = cssBackgroundColor(d[1].replace(/!important/i, ''), vars);
        if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
      }
    }
  }
  for (const c of wantClasses) if (classBg.has(c)) fromHtml.push(classBg.get(c));
  const fromCss = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([hex]) => hex);
  return [...new Set([...fromHtml, ...fromCss])];
}

/**
 * The header bar colour for a new theme: the site's own header colour when
 * the CSS shows one; '' for a white/light bar. A light wordmark (white text)
 * needs a coloured bar, so it falls back to the brand primary. A dark
 * wordmark on a dark site bar keeps the bar and is shown in white
 * (see wantsWhiteWordmark), as the customer's own site does.
 */
export function chooseHeaderBg({ siteHeader = [], wordmarkLightness = null, primary = '' }) {
  const light = (hex) => (hexLuminance(hex) ?? 1) > 0.85;
  const site = siteHeader.find(Boolean) || '';
  const wordmarkIsLight = wordmarkLightness !== null && wordmarkLightness > 0.8;
  if (site && !light(site)) return site;
  if (wordmarkIsLight) return normalizeHexColor(primary) || '';
  return '';
}

/** A dark (or unknown-lightness SVG) full logo on a dark bar would vanish: show it in white. */
export function wantsWhiteWordmark({ headerBg = '', wordmarkLightness = null }) {
  const bg = normalizeHexColor(headerBg);
  if (!bg || contrastWithWhite(bg) < 3) return false;
  return wordmarkLightness === null || wordmarkLightness < 0.6;
}

/** Hex colours (`#abc` / `#aabbcc`) in CSS or markup, counted. Entities (`&#123;`) and ids are skipped. */
export function countHexColors(text, weight = 1, into = new Map()) {
  if (typeof text !== 'string') return into;
  const re = /(^|[\s:(,"'=])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
  let m;
  while ((m = re.exec(text))) {
    const hex = normalizeHexColor(m[2]);
    if (hex) into.set(hex, (into.get(hex) || 0) + weight);
  }
  return into;
}

/** Font families a page or stylesheet uses: Google Fonts links first, then CSS font-family declarations. */
export function extractFontFamilies(text) {
  const out = [];
  const add = (f) => {
    const clean = cleanFont(f);
    if (clean !== 'system' && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
  };
  if (typeof text !== 'string') return out;
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'\s)>]*/g)) {
    for (const fm of decodeEntities(m[0]).matchAll(/[?&]family=([^&:]+)/g)) {
      for (const fam of decodeURIComponent(fm[1].replace(/\+/g, ' ')).split('|')) add(fam.split(':')[0]);
    }
  }
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|inherit|initial|unset|var\(.*)$/i;
  for (const m of text.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (first && !generic.test(first) && !/^-apple-system|BlinkMacSystemFont|Segoe UI|Helvetica|Arial/i.test(first)) add(first);
  }
  return out;
}

/** An absolute https URL on a public host, resolved against the site, or null. */
function publicUrl(href, host) {
  try {
    const u = new URL(href, `https://${host}/`);
    if (u.protocol !== 'https:' || !websiteHost(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Brand evidence from a homepage's HTML: theme-color, colours used in inline
 * CSS/markup (and the inline favicon, weighted up), fonts, icon links and
 * same-site stylesheets to read next.
 */
export function extractSiteBrand(html, host) {
  const empty = { themeColor: '', colorCounts: new Map(), fonts: [], icons: [], logos: [], stylesheets: [] };
  if (typeof html !== 'string' || !html) return empty;
  const colorCounts = new Map();
  let themeColor = '';
  const icons = [];
  const stylesheets = [];
  const siteRoot = host.replace(/^www\./, '');
  for (const m of html.matchAll(/<(meta|link)\b[^>]*>/gi)) {
    const a = tagAttributes(m[0]);
    if (m[1].toLowerCase() === 'meta') {
      if ((a.name || '').toLowerCase() === 'theme-color' && normalizeHexColor(a.content)) themeColor = normalizeHexColor(a.content);
      continue;
    }
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    const href = a.href || '';
    if (!href) continue;
    if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed') || rel.includes('mask-icon')) {
      const size = Math.max(0, ...String(a.sizes || '').split(/\s+/).map((x) => parseInt(x, 10) || 0));
      if (href.startsWith('data:')) {
        const data = parseDataImageUrl(href);
        if (data) {
          icons.push({ href, rel: rel.join(' '), type: data.type, size });
          if (data.type === 'image/svg+xml') countHexColors(data.bytes.toString('utf8'), 3, colorCounts);
        }
      } else {
        const url = publicUrl(href, host);
        if (url && !icons.some((i) => i.href === url)) icons.push({ href: url, rel: rel.join(' '), type: (a.type || '').toLowerCase(), size });
      }
    } else if (rel.includes('stylesheet')) {
      const url = publicUrl(href, host);
      if (!url) continue;
      const h = new URL(url).hostname;
      if (h === host || h === siteRoot || h.endsWith(`.${siteRoot}`)) stylesheets.push(url);
    }
  }
  if (themeColor) colorCounts.set(themeColor, (colorCounts.get(themeColor) || 0) + 2);
  // The site's own header logo: <img> tags whose class, id, alt or file name says "logo" (first two only).
  const logos = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = tagAttributes(m[0]);
    const src = a.src || a['data-src'] || '';
    if (!src || src.startsWith('data:')) continue;
    if (!/(^|[^a-z])logo/i.test(`${a.class || ''} ${a.id || ''} ${a.alt || ''} ${src.split('?')[0].split('/').pop()}`)) continue;
    const url = publicUrl(src, host);
    if (url && !logos.some((l) => l.href === url)) logos.push({ href: url, rel: 'site-logo', type: /\.svg(\?|$)/i.test(url) ? 'image/svg+xml' : '', size: 0 });
    if (logos.length >= 2) break;
  }
  // Links and in-page anchors (href="#add") are not colours.
  countHexColors(html.replace(/<link\b[^>]*>/gi, '').replace(/\bhref\s*=\s*(["'])#[^"']*\1/gi, ''), 1, colorCounts);
  return { themeColor, colorCounts, fonts: extractFontFamilies(html), icons, logos, stylesheets: stylesheets.slice(0, MAX_SITE_STYLESHEETS) };
}

/** Top brand-colour candidates: real hues, most used first, near-duplicates merged. */
export function rankBrandColors(colorCounts, max = 8) {
  const ranked = [...colorCounts.entries()].filter(([hex]) => !isNeutralColor(hex)).sort((x, y) => y[1] - x[1]);
  const out = [];
  for (const [hex] of ranked) {
    if (out.some((c) => colorDistance(c, hex) < 24)) continue;
    out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Icon links worth trying as the logo, best first: Apple touch icons, then the
 * site's header logo image (SVG first), then SVG icons (scalable, often the
 * real mark), then the largest raster icons.
 */
export function rankSiteIcons(icons) {
  const score = (i) => {
    if (/apple-touch-icon/.test(i.rel)) return 3000 + i.size;
    if (i.rel === 'site-logo') return i.type === 'image/svg+xml' ? 2600 : 2500;
    if (i.type === 'image/svg+xml' || /\.svg(\?|$)/i.test(i.href) || /^data:image\/svg\+xml/i.test(i.href)) return /mask-icon/.test(i.rel) ? 500 : 2000;
    return i.size;
  };
  return [...icons].sort((a, b) => score(b) - score(a));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function callerEmailFrom(req, fallbackEmail) {
  const raw = String(req.headers['x-goog-authenticated-user-email'] || '');
  return raw.replace(/^accounts\.google\.com:/, '').trim() || fallbackEmail;
}

export function createThemeLibraryService({
  getToken,
  provision,
  identityToken = (_email) => '',
  defaultEmail = DEMO_ADMIN_EMAIL,
  bucket = THEME_BUCKET,
  aiBase = AI_BASE_PROD,
  model = THEME_AGENT_MODEL,
  fallbackModel = THEME_AGENT_FALLBACK_MODEL,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  logger = console,
} = {}) {
  const GCS = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const GCS_UPLOAD = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  let listCache = null; // { at, themes }
  const logoCache = new Map(); // id -> { at, type, bytes }
  const keyCache = new Map(); // email -> { at, key }

  async function auth() {
    const token = await getToken();
    if (!token) throw Object.assign(new Error('Could not get a GCP access token for the theme bucket.'), { status: 502 });
    return { Authorization: `Bearer ${token}` };
  }

  async function gcsGet(objectName) {
    const res = await fetchImpl(`${GCS}/${encodeURIComponent(objectName)}?alt=media`, { headers: await auth() });
    return res;
  }

  /** `ifAbsent` makes the write fail (409) if the object already exists, so nothing is overwritten. */
  async function gcsPut(objectName, bytes, contentType, { ifAbsent = false } = {}) {
    const res = await fetchImpl(`${GCS_UPLOAD}?uploadType=media&name=${encodeURIComponent(objectName)}${ifAbsent ? '&ifGenerationMatch=0' : ''}`, {
      method: 'POST',
      headers: { ...(await auth()), 'Content-Type': contentType },
      body: bytes,
    });
    if (res.status === 412) throw Object.assign(new Error('That customer already exists in the library.'), { status: 409, code: 'exists' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`Theme bucket write failed (HTTP ${res.status}) ${text.slice(0, 200)}`), { status: 502 });
    }
  }

  async function listThemes({ fresh = false } = {}) {
    if (!fresh && listCache && now() - listCache.at < LIST_CACHE_MS) return listCache.themes;
    const names = [];
    let pageToken = '';
    do {
      const url = `${GCS}?prefix=themes/&fields=items(name),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await fetchImpl(url, { headers: await auth() });
      if (!res.ok) throw Object.assign(new Error(`Theme bucket list failed (HTTP ${res.status})`), { status: 502 });
      const data = await res.json();
      for (const item of data.items || []) if (/^themes\/[a-z0-9-]{1,64}\.json$/.test(item.name)) names.push(item.name);
      pageToken = data.nextPageToken || '';
    } while (pageToken && names.length < 1000);

    const themes = (
      await Promise.all(
        names.map(async (n) => {
          try {
            const res = await gcsGet(n);
            return res.ok ? sanitizeLibraryTheme(await res.json()) : null;
          } catch {
            return null;
          }
        })
      )
    )
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    listCache = { at: now(), themes };
    return themes;
  }

  async function readTheme(id) {
    const r = await gcsGet(`themes/${id}.json`);
    if (r.status === 404) return null;
    if (!r.ok) throw Object.assign(new Error(`Theme bucket read failed (HTTP ${r.status})`), { status: 502 });
    return sanitizeLibraryTheme(await r.json());
  }

  /**
   * New themes: the record is written only if absent, then its logo (so a
   * refused add writes nothing). Edits: the logo first, then the record, so the
   * record never points at a logo that is not there yet.
   */
  async function saveTheme(theme, logo, { edit = false, wordmark = null } = {}) {
    const record = () => gcsPut(`themes/${theme.id}.json`, Buffer.from(JSON.stringify(theme, null, 2)), 'application/json', { ifAbsent: !edit });
    if (!edit) await record();
    for (const [kind, img] of [['logo', logo], ['wordmark', wordmark]]) {
      if (!img) continue;
      await gcsPut(`${IMAGE_FOLDERS[kind]}/${theme.id}`, img.bytes, img.type);
      for (const k of logoCache.keys()) if (k.startsWith(`${kind}:${theme.id}@`)) logoCache.delete(k);
    }
    if (edit) await record();
    listCache = null;
    return theme;
  }

  /** Fetches an image from a fixed https URL, with size and type checks. */
  async function fetchImage(url, headers = undefined) {
    try {
      const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), ...(headers ? { headers } : {}) });
      if (!res.ok) return null;
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!LOGO_TYPES.includes(type)) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_LOGO_BYTES) return null;
      return { type, bytes };
    } catch {
      return null;
    }
  }

  /** A text resource (HTML/CSS) from a public https URL, capped in size and time; '' on any failure. */
  async function fetchText(url, maxBytes) {
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApigeeDemoThemeAgent/1.0)', Accept: 'text/html,text/css;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(SITE_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return '';
      // A redirect must not land on a private host.
      if (res.url && !publicUrl(res.url, 'invalid.example')) return '';
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (type && !/text\/(html|css|plain)|application\/xhtml/.test(type)) return '';
      const bytes = Buffer.from(await res.arrayBuffer());
      return bytes.subarray(0, maxBytes).toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * Reads the customer's homepage (and up to a few same-site stylesheets) for
   * the colours, fonts and icons it actually uses. Null if the site is unreachable.
   */
  async function gatherSiteEvidence(host) {
    const html = await fetchText(`https://${host}/`, MAX_SITE_HTML_BYTES);
    if (!html) return null;
    const brand = extractSiteBrand(html, host);
    const fonts = [...brand.fonts];
    const cssTexts = await Promise.all(brand.stylesheets.map((u) => fetchText(u, MAX_SITE_CSS_BYTES)));
    for (const css of cssTexts) {
      countHexColors(css, 1, brand.colorCounts);
      for (const f of extractFontFamilies(css)) if (!fonts.some((x) => x.toLowerCase() === f.toLowerCase())) fonts.push(f);
    }
    return {
      themeColor: brand.themeColor,
      colors: rankBrandColors(brand.colorCounts),
      fonts: fonts.slice(0, 6),
      icons: rankSiteIcons([...brand.icons, ...brand.logos]),
      // Header logo images in page order: the first is usually the site header's wordmark.
      logos: brand.logos,
      headerBgs: extractHeaderBackgrounds([...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]), ...cssTexts], html).slice(0, 4),
      stylesheetsRead: cssTexts.filter(Boolean).length,
    };
  }

  /**
   * The site's full header logo (logo + company name), if it is wide and sharp
   * enough to show in the header: the first such header <img> logo. Its
   * lightness decides whether it needs a coloured bar (a white wordmark does).
   */
  async function fetchSiteWordmark(site = null) {
    for (const logo of (site?.logos || []).slice(0, 3)) {
      const img = await fetchImage(logo.href);
      if (!img || !isWordmark(img)) continue;
      return { ...img, lightness: imageLightness(img), source: logo.href };
    }
    return null;
  }

  /** JSON from a Wikimedia API URL (descriptive UA as their policy requires); null on any failure. */
  async function fetchWikiJson(url) {
    try {
      const res = await fetchImpl(url, { headers: WIKIMEDIA_HEADERS, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /** The image behind a `File:` title on a wiki: the original SVG, or a ≤1000 px raster. */
  async function fetchWikiFile(apiBase, fileTitle) {
    const info = await fetchWikiJson(`${apiBase}?action=query&format=json&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1000&titles=${encodeURIComponent(fileTitle)}`);
    const page = Object.values(info?.query?.pages || {})[0];
    const ii = page?.imageinfo?.[0];
    if (!ii?.url) return null;
    const url = /svg/i.test(ii.mime || '') || !ii.thumburl ? ii.url : ii.thumburl;
    const img = await fetchImage(url, WIKIMEDIA_HEADERS);
    return img ? { ...img, lightness: imageLightness(img), source: `${apiBase.includes('commons') ? 'Wikimedia Commons' : 'Wikipedia'} ${fileTitle}` } : null;
  }

  /**
   * Reference logo when the site hides its own (bot wall, white-on-image logo):
   * the logo in the company's Wikipedia infobox, else the best-named
   * "<name> logo" file on Wikimedia Commons. Null if neither is found.
   */
  async function fetchReferenceLogo(name) {
    const enApi = 'https://en.wikipedia.org/w/api.php';
    const search = await fetchWikiJson(`${enApi}?action=query&format=json&list=search&srlimit=5&srsearch=${encodeURIComponent(name)}`);
    const title = (search?.query?.search || []).map((r) => r.title).find((t) => articleMatchesName(t, name));
    if (title) {
      const parsed = await fetchWikiJson(`${enApi}?action=parse&format=json&prop=wikitext&section=0&redirects=1&page=${encodeURIComponent(title)}`);
      const file = infoboxLogoFile(parsed?.parse?.wikitext?.['*']);
      if (file) {
        const img = await fetchWikiFile(enApi, `File:${file}`);
        if (img) return img;
      }
    }
    // Commons file names often run the words together ("Bookmyshow-logoid.png").
    const commonsApi = 'https://commons.wikimedia.org/w/api.php';
    const queries = [...new Set([`${name} logo`, `${String(name).replace(/\s+/g, '')} logo`])];
    const titles = [];
    for (const q of queries) {
      const files = await fetchWikiJson(`${commonsApi}?action=query&format=json&list=search&srnamespace=6&srlimit=10&srsearch=${encodeURIComponent(q)}`);
      titles.push(...(files?.query?.search || []).map((r) => r.title));
      if (pickCommonsLogo(titles, name)) break;
    }
    const pick = pickCommonsLogo(titles, name);
    return pick ? fetchWikiFile(commonsApi, pick) : null;
  }

  /**
   * Site logo for a public host: the icons and header logo images the homepage
   * declares (Apple touch, header <img> logo, SVG incl. inline data-URI
   * favicons, large PNGs), then /apple-touch-icon.png, then Google's favicon
   * service. Raster images under MIN_LOGO_PX are skipped everywhere: a blurry
   * 16 px favicon is worse than the monogram the header falls back to.
   * Wide header logos (and near-white ones, which vanish on the white square
   * tile) are kept as the last resort, so the square slot and favicon get the
   * emblem. `preferSquare` is accepted for compatibility.
   */
  // eslint-disable-next-line no-unused-vars
  async function fetchSiteLogo(host, site = null, { preferSquare = false } = {}) {
    let wide = null;
    for (const icon of (site?.icons || []).slice(0, 5)) {
      const img = icon.href.startsWith('data:') ? parseDataImageUrl(icon.href) : await fetchImage(icon.href);
      if (!img || !isSharpLogo(img)) continue;
      const source = icon.href.startsWith('data:') ? 'site favicon (inline SVG)' : icon.rel === 'site-logo' ? `site header logo ${icon.href}` : icon.href;
      const light = imageLightness(img);
      if (isWordmark(img) || (light != null && light > 0.85)) {
        wide = wide || { ...img, source };
        continue;
      }
      return { ...img, source };
    }
    const touch = await fetchImage(`https://${host}/apple-touch-icon.png`);
    if (touch && isSharpLogo(touch)) return { ...touch, source: `https://${host}/apple-touch-icon.png` };
    const fav = await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`);
    if (fav && isSharpLogo(fav)) return { ...fav, source: 'Google favicon service' };
    return wide;
  }

  async function gatewayKeyFor(email) {
    const hit = keyCache.get(email);
    if (hit && now() - hit.at < KEY_CACHE_MS) return hit.key;
    const token = await getToken();
    if (!token || typeof provision !== 'function') return '';
    try {
      const result = await provision(ORG, token, email);
      const key = result?.apiKeys?.admin || result?.apiKey || '';
      if (key) keyCache.set(email, { at: now(), key });
      return key;
    } catch (err) {
      logger.warn?.('[ThemeLibrary] Could not resolve a gateway key:', err?.message || err);
      return '';
    }
  }

  async function gatewayGenerate({ apiKey, email, modelId, prompt, grounded, system }) {
    const body = {
      systemInstruction: {
        parts: [{ text: system || 'You research company brand identities for demo theming. You answer with a single JSON object only.' }],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
    };
    const startedAt = now();
    const res = await fetchImpl(`${aiBase}/models/${modelId}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-apikey': apiKey,
        // The gateway expects a caller identity token next to the key, as for the admin agent.
        ...(identityToken(email) ? { Authorization: `Bearer ${identityToken(email)}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers, latencyMs: now() - startedAt };
  }

  let industryCache = null; // { at, industries }

  /** Industries the agent added (industries/<id>.json), sorted by label. */
  async function listIndustries({ fresh = false } = {}) {
    if (!fresh && industryCache && now() - industryCache.at < LIST_CACHE_MS) return industryCache.industries;
    const res = await fetchImpl(`${GCS}?prefix=industries/&fields=items(name)`, { headers: await auth() });
    if (!res.ok) throw Object.assign(new Error(`Theme bucket list failed (HTTP ${res.status})`), { status: 502 });
    const data = await res.json();
    const names = (data.items || []).map((i) => i.name).filter((n) => /^industries\/[a-z0-9-]{1,32}\.json$/.test(n));
    const industries = (
      await Promise.all(
        names.map(async (n) => {
          try {
            const r = await gcsGet(n);
            return r.ok ? sanitizeLibraryIndustry(await r.json()) : null;
          } catch {
            return null;
          }
        })
      )
    )
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));
    industryCache = { at: now(), industries };
    return industries;
  }

  /** Asks the model for a new industry's slots and builds it from the templates; null on failure. */
  async function generateIndustry({ id, label, companyName, email }) {
    const apiKey = await gatewayKeyFor(email);
    if (!apiKey) return null;
    const prompt = buildIndustryPrompt({ label, companyName });
    for (const modelId of [model, fallbackModel]) {
      try {
        const r = await gatewayGenerate({
          apiKey,
          email,
          modelId,
          prompt,
          grounded: false,
          system: 'You write short, generic demo content for an industry. You answer with a single JSON object only.',
        });
        if (!r.ok) {
          if (r.status === 429 || r.status === 403 || r.status === 401) return null;
          continue;
        }
        const text = (r.json?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || '').join('');
        const slots = extractJsonObject(text);
        const industry = slots && industryFromSlots({ id, label: industryLabelFrom(slots.label) || label, slots, createdBy: email, nowIso: new Date(now()).toISOString() });
        if (industry) return industry;
      } catch (err) {
        logger.warn?.('[ThemeLibrary] industry generation failed:', err?.message || err);
      }
    }
    return null;
  }

  /**
   * The industry for a new theme: the presenter's pick, else the agent's pick
   * from the known list, else (the agent said none fits) an industry added to
   * the library, reusing one added earlier with the same name.
   */
  async function resolveIndustry(request, answer, email, steps) {
    if (request.industry) return { id: request.industry, created: null };
    const a = answer && typeof answer === 'object' ? answer : {};
    if (typeof a.industry === 'string' && a.industry !== 'new' && a.industry !== 'generic' && request.industries.includes(a.industry)) {
      return { id: a.industry, created: null };
    }
    const label = industryLabelFrom(a.industryLabel);
    const id = slugifyIndustryId(label);
    if (!label || !id || id === 'generic') return { id: 'generic', created: null };
    if (request.industries.includes(id)) return { id, created: null };
    let library = [];
    try {
      library = await listIndustries({ fresh: true });
    } catch {
      return { id: 'generic', created: null };
    }
    const same = library.find((i) => i.id === id || i.label.toLowerCase() === label.toLowerCase());
    if (same) return { id: same.id, created: null };
    if (library.length >= MAX_LIBRARY_INDUSTRIES) {
      steps.push(`"${label}" is not a known industry and the library already has ${library.length} added industries; using Generic.`);
      return { id: 'generic', created: null };
    }
    const industry = await generateIndustry({ id, label, companyName: request.name, email });
    if (!industry) {
      steps.push(`Could not add the "${label}" industry; using Generic.`);
      return { id: 'generic', created: null };
    }
    try {
      await gcsPut(`industries/${id}.json`, Buffer.from(JSON.stringify(industry, null, 2)), 'application/json', { ifAbsent: true });
    } catch (err) {
      // Another request added it first: use theirs.
      if (err?.code !== 'exists') throw err;
      industryCache = null;
      return { id, created: null };
    }
    industryCache = null;
    steps.push(`Added the "${industry.label}" industry to the library (personas and scenario prompts from the standard templates).`);
    return { id, created: industry };
  }

  /**
   * The agent's research step. Grounded (Google Search) first; if the gateway or
   * model refuses the tool, retries ungrounded, then on the fallback model.
   */
  async function researchBrand(request, email, site = null) {
    const apiKey = await gatewayKeyFor(email);
    if (!apiKey) {
      return { answer: null, trace: { error: 'No AI Gateway key for this user. Open the AI Gateway tab once so your developer app is provisioned.' } };
    }
    const prompt = buildAgentPrompt({ ...request, site });
    const attempts = [
      { modelId: model, grounded: true },
      { modelId: model, grounded: false },
      { modelId: fallbackModel, grounded: false },
    ];
    let last = null;
    for (const a of attempts) {
      try {
        const r = await gatewayGenerate({ apiKey, email, prompt, ...a });
        last = { ...a, status: r.status };
        if (!r.ok) {
          // A budget / quota 429 or a Model Armor 400 is governance, not a tool problem: stop there.
          if (r.status === 429 || r.status === 403 || r.status === 401) break;
          continue;
        }
        const cand = r.json?.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p?.text || '').join('');
        const answer = extractJsonObject(text);
        if (!answer) continue;
        const sources = (cand?.groundingMetadata?.groundingChunks || [])
          .map((c) => c?.web?.title || c?.web?.uri)
          .filter(Boolean)
          .slice(0, 5);
        return {
          answer,
          trace: {
            model: r.headers.get('x-gateway-model') || a.modelId,
            grounded: a.grounded,
            status: r.status,
            latencyMs: r.latencyMs,
            costUsd: r.headers.get('x-gateway-cost-usd') || '',
            sources,
          },
        };
      } catch (err) {
        last = { ...a, error: err?.message || String(err) };
      }
    }
    return {
      answer: null,
      trace: { ...last, error: last?.error || `AI Gateway returned HTTP ${last?.status ?? '?'}` },
    };
  }

  async function handleRequestTheme(req, res) {
    const body = JSON.parse((await readBody(req)) || '{}');
    const request = parseThemeRequest(body);
    const email = callerEmailFrom(req, defaultEmail);
    // Industries added earlier are valid answers too, whatever list the client sent.
    try {
      for (const i of await listIndustries()) if (!request.industries.includes(i.id)) request.industries.push(i.id);
    } catch {
      /* library industries unavailable: the built-in list still works */
    }
    const id = slugifyId(request.name);
    if (!id) throw Object.assign(new Error('That name does not make a valid theme id.'), { status: 400 });

    // Checked before the agent runs, so a duplicate costs no gateway call.
    const existing = await readTheme(id);
    if (existing) return sendJson(res, 409, { error: `"${existing.name}" already exists in the library.`, code: 'exists', existing });

    const steps = [];
    const site = await gatherSiteEvidence(request.host);
    steps.push(
      site
        ? `Read https://${request.host}/${site.stylesheetsRead ? ` and ${site.stylesheetsRead} stylesheet(s)` : ''}: ${site.colors.length} brand colour(s)${site.themeColor ? `, theme-color ${site.themeColor}` : ''}${site.fonts.length ? `, font ${site.fonts[0]}` : ''}.`
        : `Could not read https://${request.host}/; relying on search only.`
    );
    const { answer, trace } = await researchBrand(request, email, site);
    steps.push(
      answer
        ? `Researched the brand via the AI Gateway (${trace.model}${trace.grounded ? ', Google Search grounded' : ''}).`
        : `Brand research failed: ${trace.error}. Saved with neutral colours; edit the theme to fix.`
    );

    // The full header logo (logo + name) first, so the square slot can prefer the emblem.
    let wordmark = request.wordmark ? { ...request.wordmark, lightness: imageLightness(request.wordmark), source: 'uploaded' } : null;
    if (!wordmark) wordmark = await fetchSiteWordmark(site);
    // No usable full logo on the site (bot wall, or a white logo made for a photo with no
    // dark header bar to sit on): use the official logo from Wikipedia / Wikimedia Commons.
    let reference = null;
    const whiteWithoutBar = wordmark && wordmark.source !== 'uploaded' && wordmark.lightness != null && wordmark.lightness > 0.8 && !chooseHeaderBg({ siteHeader: site?.headerBgs || [] });
    if (!request.wordmark && (!wordmark || whiteWithoutBar)) {
      reference = await fetchReferenceLogo(request.name);
      if (reference && isWordmark(reference) && !(reference.lightness != null && reference.lightness > 0.8)) {
        wordmark = reference;
      }
    }

    let logo = request.logo;
    let logoSource = logo ? 'uploaded' : '';
    if (!logo) {
      const found = await fetchSiteLogo(request.host, site, { preferSquare: Boolean(wordmark) });
      // A square-ish reference logo beats a wide or near-white site image in the square slot.
      const foundIsFallback = found && (isWordmark(found) || (imageLightness(found) ?? 0) > 0.85);
      if (reference && !isWordmark(reference) && isSharpLogo(reference) && (!found || foundIsFallback)) {
        logo = { type: reference.type, bytes: reference.bytes };
        logoSource = reference.source;
      } else if (found) {
        logo = { type: found.type, bytes: found.bytes };
        logoSource = found.source;
      }
    }
    steps.push(logo ? `Logo: ${logoSource}.` : 'No logo found; the header shows a monogram.');

    const { id: industryId, created: createdIndustry } = await resolveIndustry(request, answer, email, steps);

    const version = now();
    const theme = themeFromAgent({
      request: { ...request, industry: industryId === 'generic' ? '' : industryId },
      answer,
      id,
      logoUrl: logo ? `/api/themes/logo/${id}?v=${version}` : '',
      wordmarkUrl: wordmark ? `/api/themes/wordmark/${id}?v=${version}` : '',
      wordmarkLightness: wordmark?.lightness ?? null,
      requestedBy: email,
      nowIso: new Date(version).toISOString(),
      site,
    });
    steps.push(
      wordmark
        ? `Full logo with the name: ${wordmark.source}${wordmark.lightness !== null && wordmark.lightness > 0.8 ? ' (white, so it needs a coloured bar)' : ''}${theme.wordmarkWhite ? ' (shown in white on the dark bar)' : ''}.`
        : 'No wide header logo found; the header shows the square logo.'
    );
    steps.push(theme.headerBg ? `Header bar: ${theme.headerBg}${site?.headerBgs?.includes(theme.headerBg) ? ' (from the site header CSS)' : ''}, with a brand stripe.` : `Header bar: white${theme.wordmarkUrl ? ', with a brand stripe' : ''}.`);
    await saveTheme(theme, logo, { wordmark: wordmark ? { type: wordmark.type, bytes: wordmark.bytes } : null });
    steps.push(`Saved to gs://${bucket}/themes/${id}.json.`);
    sendJson(res, 200, { theme, ...(createdIndustry ? { industry: createdIndustry } : {}), agent: { ...trace, steps } });
  }

  /**
   * Presenter edits to a library theme (colours, font, industry, logo), saved for
   * everyone. Only existing themes can be edited (new ones come from a request),
   * and `baseUpdatedAt` must match the stored version. The logo is an uploaded
   * data URL, an https image URL on a public host (copied into the bucket), or
   * unchanged.
   */
  async function handleUpdateTheme(req, res, id) {
    const body = JSON.parse((await readBody(req)) || '{}');
    const email = callerEmailFrom(req, defaultEmail);
    const raw = body?.theme && typeof body.theme === 'object' ? body.theme : null;
    if (!raw) throw Object.assign(new Error('Missing theme.'), { status: 400 });
    const current = await readTheme(id);
    if (!current) throw Object.assign(new Error('That theme is not in the library. Use Request a theme to add it.'), { status: 404 });
    const base = typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;
    if (base === null || base !== (current.updatedAt || '')) {
      return sendJson(res, 409, {
        error: `"${current.name}" was changed by ${current.editedBy || current.requestedBy || 'another presenter'} after you opened it. Their version is loaded; re-apply your changes to it.`,
        code: 'stale',
        existing: current,
      });
    }
    // Logo and wordmark: an uploaded data URL or a public https image is copied into the bucket.
    const incomingImage = async (value, label) => {
      if (value.startsWith('data:')) {
        const img = parseLogoDataUrl(value);
        if (!img) throw Object.assign(new Error(`The ${label} must be a PNG, JPEG, WebP, GIF or SVG image under 400 KB.`), { status: 400 });
        return img;
      }
      if (!/^https:\/\//i.test(value)) return null;
      let host = null;
      try {
        host = websiteHost(new URL(value).hostname);
      } catch {
        host = null;
      }
      const img = host ? await fetchImage(value) : null;
      if (!img) throw Object.assign(new Error(`Could not fetch an image from that ${label} URL.`), { status: 400 });
      return img;
    };
    let logoUrl = typeof raw.logoUrl === 'string' ? raw.logoUrl : current.logoUrl;
    let wordmarkUrl = typeof raw.wordmarkUrl === 'string' ? raw.wordmarkUrl : current.wordmarkUrl || '';
    const logo = await incomingImage(logoUrl, 'logo');
    const wordmark = await incomingImage(wordmarkUrl, 'full logo');
    // Strictly newer than the stored version, so the stale check always sees a change.
    const prev = Date.parse(current.updatedAt || '');
    const version = Number.isFinite(prev) ? Math.max(now(), prev + 1) : now();
    if (logo) logoUrl = `/api/themes/logo/${id}?v=${version}`;
    if (wordmark) wordmarkUrl = `/api/themes/wordmark/${id}?v=${version}`;
    const theme = sanitizeLibraryTheme({
      ...current,
      ...raw,
      id,
      logoUrl,
      wordmarkUrl,
      website: current.website,
      requestedBy: current.requestedBy,
      editedBy: email,
      updatedAt: new Date(version).toISOString(),
      // The agent's note explains its colours; once a presenter changes them it no longer applies.
      agentNotes: ['primary', 'accent', 'font'].some((k) => k in raw && raw[k] !== current[k]) ? '' : current.agentNotes,
    });
    if (!theme) throw Object.assign(new Error('That theme is not valid; check the name and colours.'), { status: 400 });
    await saveTheme(theme, logo, { edit: true, wordmark });
    sendJson(res, 200, { theme });
  }

  async function handleImage(res, kind, id, version = '') {
    // Keyed by version too: browsers cache a ?v= URL for a day, so a new version must never get the old bytes.
    const key = `${kind}:${id}@${version}`;
    const hit = logoCache.get(key);
    let entry = hit && now() - hit.at < LIST_CACHE_MS * 10 ? hit : null;
    if (!entry) {
      const r = await gcsGet(`${IMAGE_FOLDERS[kind]}/${id}`);
      if (!r.ok) return sendJson(res, r.status === 404 ? 404 : 502, { error: 'Logo not found.' });
      const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!LOGO_TYPES.includes(type)) return sendJson(res, 415, { error: 'Unsupported logo type.' });
      entry = { at: now(), type, bytes: Buffer.from(await r.arrayBuffer()) };
      if (logoCache.size > 100) logoCache.clear();
      logoCache.set(key, entry);
    }
    res.writeHead(200, {
      'Content-Type': entry.type,
      // URLs carry ?v=<updatedAt>, so a long cache is safe.
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      // SVG logos are images, never documents: no scripts even if opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(entry.bytes);
  }

  async function handleRequest(req, res, parsedUrl) {
    const { pathname } = parsedUrl;
    const method = req.method || 'GET';
    try {
      if (pathname === '/api/themes' && method === 'GET') {
        try {
          const fresh = parsedUrl.searchParams.get('fresh') === '1';
          const [themes, industries] = await Promise.all([
            listThemes({ fresh }),
            listIndustries({ fresh }).catch((err) => {
              logger.warn?.('[ThemeLibrary] industry list failed:', err?.message || err);
              return [];
            }),
          ]);
          return sendJson(res, 200, { available: true, bucket, themes, industries });
        } catch (err) {
          logger.warn?.('[ThemeLibrary] list failed:', err?.message || err);
          return sendJson(res, 200, { available: false, bucket, themes: [], error: err?.message || String(err) });
        }
      }
      if (pathname === '/api/themes/requests' && method === 'POST') return await handleRequestTheme(req, res);
      const imageMatch = pathname.match(/^\/api\/themes\/(logo|wordmark)\/([a-z0-9-]{1,64})$/);
      if (imageMatch && method === 'GET') return await handleImage(res, imageMatch[1], imageMatch[2], (parsedUrl.searchParams.get('v') || '').slice(0, 16));
      const idMatch = pathname.match(/^\/api\/themes\/([a-z0-9-]{1,64})$/);
      if (idMatch && method === 'PUT') return await handleUpdateTheme(req, res, idMatch[1]);
      return sendJson(res, 404, { error: 'Unknown theme library route.' });
    } catch (err) {
      const status = err instanceof SyntaxError ? 400 : err?.status || 500;
      if (status >= 500) logger.error?.('[ThemeLibrary]', err);
      return sendJson(res, status, { error: err?.message || 'Theme library error.', ...(err?.code ? { code: err.code } : {}) });
    }
  }

  return { handleRequest, listThemes, listIndustries, saveTheme, researchBrand, gatherSiteEvidence, generateIndustry };
}
