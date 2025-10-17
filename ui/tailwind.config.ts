import type { Config } from 'tailwindcss';

export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    {
      pattern: /^(bg|text|border|hover:bg|focus:ring)-(sky|violet|amber|emerald|rose|indigo|cyan|fuchsia)-(50|100|200|300|800)$/,
    },
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
