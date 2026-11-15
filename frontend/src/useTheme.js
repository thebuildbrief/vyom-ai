import { useEffect, useState } from 'react';
import { themes } from './themes.js';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return themes.some(item => item.id === localStorage.getItem('vyom-theme')) ? localStorage.getItem('vyom-theme') : 'midnight'; }
    catch { return 'midnight'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('vyom-theme', theme); } catch { /* Storage may be disabled; the in-memory theme still works. */ }
  }, [theme]);
  const changeTheme = nextTheme => {
    if (!themes.some(item => item.id === nextTheme)) return;
    document.documentElement.dataset.theme = nextTheme;
    try { localStorage.setItem('vyom-theme', nextTheme); } catch { /* Keep this change in memory if browser storage is unavailable. */ }
    setTheme(nextTheme);
  };
  return [theme, changeTheme];
}

