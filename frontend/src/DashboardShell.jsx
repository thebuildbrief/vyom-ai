import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const groups = [
  { label: 'Workspace', items: [
    { to: '/dashboard', label: 'Overview', icon: '◈', exact: true },
    { to: '/interview/setup', label: 'New interview', icon: '✦', exact: true },
    { to: '/dashboard/interviews', label: 'Interview history', icon: '◷' },
    { to: '/dashboard/analytics', label: 'Analytics', icon: '◐' }
  ] },
  { label: 'Grow', items: [
    { to: '/dashboard/resume', label: 'Resume library', icon: '▤' },
    { to: '/dashboard/coding', label: 'Code Lab', icon: '⌨' },
    { to: '/dashboard/leaderboard', label: 'Leaderboard', icon: '♛' },
    { to: '/dashboard/study', label: 'Study rooms', icon: '◎' }
  ] },
  { label: 'Account', items: [
    { to: '/dashboard/profile', label: 'Profile', icon: '◉' },
    { to: '/dashboard/settings', label: 'Settings', icon: '⚙' }
  ] }
];

function isActive(path, item) {
  if (item.exact) return path === item.to;
  return path === item.to || path.startsWith(`${item.to}/`);
}

export function Avatar({ name, image, size = '' }) {
  const label = String(name || 'V').trim().slice(0, 2).toUpperCase();
  const [imageFailed, setImageFailed] = useState(false);
  const safeImage = !imageFailed && typeof image === 'string' && /^https?:\/\//i.test(image);
  return <span className={`lb-avatar ${size}`} aria-hidden="true">{safeImage ? <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : label}</span>;
}

export default function DashboardShell({ user, children }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [location.pathname]);
  return <div className={`app-shell ${open ? 'nav-open' : ''}`}>
    <button className="app-nav-toggle" type="button" aria-expanded={open} aria-controls="workspace-nav" onClick={() => setOpen(value => !value)}>{open ? '× Close' : '☰ Workspace'}</button>
    {open && <button className="app-scrim" type="button" aria-label="Close navigation" onClick={() => setOpen(false)}/>}
    <aside className="app-sidebar" id="workspace-nav" aria-label="Workspace navigation">
      <div className="app-user">
        <Avatar name={user?.name || 'You'} image={user?.profile_image} size="large"/>
        <div><span className="eyebrow">YOUR WORKSPACE</span><b>{user?.name || 'VYOM member'}</b><small>{user?.email || 'Private practice space'}</small></div>
      </div>
      <Link className="button small full app-start" to="/interview/setup">Start an interview <span>↗</span></Link>
      <nav className="app-nav">
        {groups.map(group => <div className="app-nav-group" key={group.label}>
          <span className="app-nav-label">{group.label}</span>
          {group.items.map(item => <Link key={item.to} to={item.to} className={`app-nav-link ${isActive(location.pathname, item) ? 'is-active' : ''}`} aria-current={isActive(location.pathname, item) ? 'page' : undefined}>
            <span className="app-nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
          </Link>)}
        </div>)}
      </nav>
      <div className="app-sidebar-note"><b>Face the interview.</b><small>Own the future.</small></div>
    </aside>
    <div className="app-main">{children}</div>
  </div>;
}
