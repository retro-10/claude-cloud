import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Camp's one accent (Indigo, Brand Guardrails)
        brand: {
          DEFAULT: token("brand"),
          soft: token("brand-soft"),
          deep: token("brand-deep"),
        },
        onbrand: token("onbrand"),
        // theme-aware tokens, defined in globals.css
        bg: token("bg"),
        surface: token("surface"),
        raised: token("raised"),
        fg: token("fg"),
        muted: token("muted"),
        faint: token("faint"),
        line: token("line"),
        // status and accent-text colours: darker on the light theme so they keep 4.5:1 contrast
        accent: token("accent"),
        warn: token("warn"),
        danger: token("danger"),
        ok: token("ok"),
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        display: ['"Bodoni Moda"', "Georgia", '"Times New Roman"', "serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgb(0 0 0 / 0.18), 0 1px 1px rgb(0 0 0 / 0.08)",
        lift: "0 12px 32px -12px rgb(0 0 0 / 0.45), 0 2px 6px rgb(0 0 0 / 0.18)",
        pop: "0 24px 64px -16px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(var(--line) / 0.9)",
        glow: "0 0 0 1px rgb(var(--glow) / 0.45), 0 8px 28px -10px rgb(var(--glow) / 0.5)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(12px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        pulse_ring: {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--danger) / 0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgb(var(--danger) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--danger) / 0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out both",
        "rise-in": "rise-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "pop-in": "pop-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "toast-in": "toast-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "pulse-ring": "pulse_ring 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
