import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import Icon from './Icon';

const links = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/stock', label: 'Stock', icon: 'box', end: false },
  { to: '/manage', label: 'Manage', icon: 'edit', end: false },
  { to: '/potencies', label: 'Potencies', icon: 'sliders', end: false },
  { to: '/pack-sizes', label: 'Pack sizes', icon: 'box', end: false },
] as const;

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem('materia-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('materia-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export default function Layout() {
  const { theme, toggle } = useTheme();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><Icon name="leaf" size={22} /></span>
          <span className="name">
            Materia
            <small>Homoeopathy stock</small>
          </span>
        </div>

        <nav className="nav-desktop">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={l.icon} size={17} />
              {l.label}
            </NavLink>
          ))}
        </nav>

        <button className="theme-toggle" onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
        </button>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <nav className="nav-mobile">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={l.icon} size={23} />
            {l.label}
            <span className="dot" />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
