import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "matrix" | "aqua" | "pastel-girly" | "system";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("atenia-theme") as Theme) || "dark";
    }
    return "dark";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    
    root.classList.remove("light", "dark", "matrix", "aqua", "pastel-girly");
    
    let effectiveTheme: "light" | "dark" | "matrix" | "aqua" | "pastel-girly";
    
    if (theme === "system") {
      effectiveTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } else {
      effectiveTheme = theme;
    }
    
    root.classList.add(effectiveTheme);
    localStorage.setItem("atenia-theme", theme);
    
    // Update color-scheme for proper browser styling
    // Matrix, Aqua themes use dark color scheme; pastel-girly uses light
    root.style.colorScheme = (effectiveTheme === "light" || effectiveTheme === "pastel-girly") ? "light" : "dark";
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;
    
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove("light", "dark", "matrix", "aqua", "pastel-girly");
      root.classList.add(mediaQuery.matches ? "dark" : "light");
      root.style.colorScheme = mediaQuery.matches ? "dark" : "light";
    };
    
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  return {
    theme,
    setTheme: setThemeState,
  };
}
