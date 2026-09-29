import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        charcoal: "#1A1A1A",
        ink: "#0F0F0F",
        warm: "#EDEDED",
        gold: "#C9A227", // the single accent
        // theme-aware tokens, defined in globals.css
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        // status and accent-text colours: darker on the light theme so they keep 4.5:1 contrast
        accent: "rgb(var(--accent) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ['"Playfair Display"', "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
