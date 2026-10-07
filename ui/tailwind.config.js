import defaultColors from 'tailwindcss/colors';
import defaultTheme from 'tailwindcss/defaultTheme';

/*
 * Customer themes (src/utils/customerTheme.js) re-skin the app by setting CSS
 * variables, not by changing class names. The brand-role colour families are
 * routed through `--c-<family>-<shade>`, with Tailwind's own value as the
 * fallback, so with no theme applied the UI is pixel-identical to before:
 *   blue, indigo, purple, violet, fuchsia -> customer primary
 *   cyan, sky, teal                       -> customer accent
 * The status colours (emerald / amber / rose) and slate stay fixed on purpose.
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const hexToTriplet = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
};
const themable = (family) =>
  Object.fromEntries(
    SHADES.map((s) => [s, `rgb(var(--c-${family}-${s}, ${hexToTriplet(defaultColors[family][s])}) / <alpha-value>)`]),
  );

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blue: themable('blue'),
        indigo: themable('indigo'),
        purple: themable('purple'),
        violet: themable('violet'),
        fuchsia: themable('fuchsia'),
        cyan: themable('cyan'),
        sky: themable('sky'),
        teal: themable('teal'),
        google: {
          blue: "#1a73e8",
          red: "#ea4335",
          yellow: "#fbbc04",
          green: "#34a853"
        }
      },
      fontFamily: {
        // --brand-font is set by the active customer theme; unset = system stack.
        sans: ['var(--brand-font, ui-sans-serif)', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
}
