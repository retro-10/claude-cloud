"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui/Icon";
import { currentTheme, setTheme, type Theme } from "./shell/theme";

export function ThemeToggle({ className = "btn btn-ghost btn-icon" }: { className?: string }) {
  const [theme, set] = useState<Theme>("dark");
  useEffect(() => {
    set(currentTheme());
    const on = (e: Event) => set((e as CustomEvent<Theme>).detail);
    window.addEventListener("crm:theme", on);
    return () => window.removeEventListener("crm:theme", on);
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button onClick={() => setTheme(next)} className={className} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
