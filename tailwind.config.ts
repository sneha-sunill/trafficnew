import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        panel: '#0d1b2e',
        card:  '#12243b',
        muted: '#8da2bd',
        brand: '#39d0ff',
        'brand-green': '#44e0a6',
        line:  '#213b5b',
      },
    },
  },
  plugins: [],
};

export default config;
