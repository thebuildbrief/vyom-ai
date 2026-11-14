import { useEffect, useRef } from 'react';

import { themes } from './themes.js';

export function ThemePicker({ theme, onChange }) {
  const selectedIndex = Math.max(0, themes.findIndex(item => item.id === theme));
  const selected = themes[selectedIndex];
  const nextTheme = themes[(selectedIndex + 1) % themes.length];
  return <div className="theme-picker">
    <button className="theme-toggle" type="button" title="Change theme" aria-label={`Change theme. Current theme: ${selected.name}. Next theme: ${nextTheme.name}.`} onClick={() => onChange(nextTheme.id)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 1 0 9 9c0-.6-.05-1.2-.16-1.78A7.5 7.5 0 0 1 13.78 3.16 9.7 9.7 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="10" cy="6.7" r=".7"/><circle cx="14" cy="6.7" r=".7"/></svg>
    </button>
    <span className="theme-tooltip" role="tooltip">Change theme</span>
  </div>;
}

export function ScrollReveals({ pageKey }) {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targets = document.querySelectorAll('.hero-copy, .hero-art, .section, .interviewers-section, .features-section, .quote-section, .faq, .final-cta, .step, .person, .feature-card, .stats-grid > div, .dash-panel');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach(element => element.classList.add('reveal-target', 'is-visible'));
      return undefined;
    }
    targets.forEach(element => element.classList.add('reveal-target'));
    document.documentElement.classList.add('motion-ready');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -36px 0px' });
    targets.forEach((element, index) => { element.style.setProperty('--reveal-delay', `${Math.min(index % 6, 4) * 55}ms`); observer.observe(element); });
    return () => { observer.disconnect(); document.documentElement.classList.remove('motion-ready'); };
  }, [pageKey]);
  return null;
}
