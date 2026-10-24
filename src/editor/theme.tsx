import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readPreference, savePreference } from './preferences';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'mesh-avatar-theme';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => undefined,
  setTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = readPreference(THEME_KEY);
    return saved === 'light' ? 'light' : 'dark'; // Dark theme is default
  });

  const setTheme = (next: Theme) => {
    setThemeState(next);
    savePreference(THEME_KEY, next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
