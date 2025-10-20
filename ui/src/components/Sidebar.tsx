"use client";
import Link from 'next/link';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSelectedLayoutSegments } from 'next/navigation';
import { IconHome, IconCog, IconBeaker, IconFolder, IconQuestionCircle, IconMail, IconActivity, IconFourSquare } from './icons';

type NavItem = {
  href: string;
  label: string;
  icon: JSX.Element;
  subItems?: Array<{ href: string; label: string }>;
};

const NAV: NavItem[] = [
  {
    href: '/create-run',
    label: 'Launch Usability Test',
    icon: <IconBeaker width={18} height={18} />,
    subItems: [
      { href: '/configure-persona', label: 'Configure Persona' },
      { href: '/configure-test', label: 'Configure Test' }
    ]
  },
  { href: '/reports', label: 'Reports', icon: <IconFolder width={18} height={18} /> },
];

export default function Sidebar() {
  // Initialize from localStorage during first render to avoid open->collapse flicker
  const initialCollapsed = (() => {
    if (typeof window === 'undefined') return false; // default expanded
    const saved = localStorage.getItem('sparrow_sidebar_collapsed');
    return saved ? saved === '1' : false;
  })();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [userLabel, setUserLabel] = useState('Guest User');
  const [loggedIn, setLoggedIn] = useState(false);
  const pathname = usePathname();
  const segments = useSelectedLayoutSegments();
  const normalizedPath = useMemo(() => {
    const p = pathname || '/';
    return (p.endsWith('/') && p !== '/') ? p.slice(0, -1) : p;
  }, [pathname]);
  // Robust active detection: compare root path segments, no extra state
  const currentRoot = useMemo(() => {
    // Prefer App Router segments for reliability
    if (segments && segments.length > 0) return String(segments[0]);
    const p = normalizedPath.replace(/^\/+/, '');
    return p.split('/')[0] || '';
  }, [segments, normalizedPath]);
  function rootOf(href: string): string {
    if (href === '/') return '';
    return href.replace(/^\/+/, '').split('/')[0] || '';
  }

  function isActive(href: string, path: string): boolean {
    if (!href) return false;
    // Root: treat /, /?*, /#* as active
    if (href === '/') {
      return path === '/' || path.startsWith('/?') || path.startsWith('/#');
    }
    if (path === href) return true;
    // Boundary-aware nested match: "/reports" active on "/reports/..."
    if (path.startsWith(href + '/')) return true;
    // Query/hash cases
    if (path.startsWith(href + '?') || path.startsWith(href + '#')) return true;
    return false;
  }

  const checkAuthStatus = () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const cached = typeof window !== 'undefined' ? localStorage.getItem('sparrow_user_name') : null;
      if (cached) setUserLabel(cached);
      if (!token) { setLoggedIn(false); setUserLabel('Guest User'); return; }
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => {
          if (r.status === 401) {
            localStorage.removeItem('sparrow_token');
            localStorage.removeItem('sparrow_user_name');
            setLoggedIn(false);
            setUserLabel('Guest User');
            window.dispatchEvent(new CustomEvent('authStateChanged'));
            return null;
          }
          return r.ok ? r.json() : null;
        })
        .then(d => {
          if (!d) { setLoggedIn(false); return; }
          setLoggedIn(true);
          if (d.first_name || d.last_name) {
            const label = `${d.first_name || ''} ${d.last_name || ''}`.trim() || d.email;
            setUserLabel(label);
            localStorage.setItem('sparrow_user_name', label);
          } else if (d.email) {
            setUserLabel(d.email);
          }
        })
        .catch(() => {});
    } catch {}
  };

  useEffect(() => {
    checkAuthStatus();
    
    // Listen for authentication state changes
    const handleAuthChange = () => {
      checkAuthStatus();
    };
    
    window.addEventListener('authStateChanged', handleAuthChange);
    
    return () => {
      window.removeEventListener('authStateChanged', handleAuthChange);
    };
  }, []);

  useEffect(() => {
    const w = collapsed ? '64px' : '260px';
    document.documentElement.style.setProperty('--sidebar-w', w);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sparrow_sidebar_collapsed', collapsed ? '1' : '0');
    }
  }, [collapsed]);

  // Force expanded on first mount so users see the full menu
  useEffect(() => {
    setCollapsed(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sparrow_sidebar_collapsed', '0');
    }
  }, []);

  const initials = useMemo(() => {
    const base = userLabel && userLabel.includes('@') ? userLabel.split('@')[0] : userLabel;
    return (base || 'GU').slice(0, 2).toUpperCase();
  }, [userLabel]);

  const visibleNav = useMemo(() => {
    // When not signed in: show no navigation (auth redirect will handle it)
    // When signed in: show all navigation items
    if (!loggedIn) {
      return [];
    }
    return NAV;
  }, [loggedIn]);

  return (
    <aside className={`sidebar${collapsed ? '' : ' expanded'}`} data-collapsed={collapsed}>
      <div className="rail-head">
        <div className="avatar" title={userLabel}>{initials}</div>
        {!collapsed && (
          <div className="rail-user-label" title={userLabel}>{userLabel || 'Guest User'}</div>
        )}
      </div>

      <div className="rail-list">
        {visibleNav.map(item => {
          const seg0 = Array.isArray(segments) && segments.length > 0 ? String(segments[0]) : '';
          const navRoot = rootOf(item.href);
          const active = (item.href === '/' ? seg0 === '' : navRoot === seg0) ||
            (normalizedPath === item.href || normalizedPath.startsWith(item.href + '/'));

          return (
            <div key={item.href}>
              <Link href={item.href} prefetch={false} className={`rail-item${active ? ' active' : ''}`} data-tip={item.label} title={item.label}>
                <span className="icon" aria-hidden>{item.icon}</span>
                <span className="label">{item.label}</span>
              </Link>

              {/* Sub-items */}
              {item.subItems && !collapsed && (
                <div style={{ marginLeft: 44, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {item.subItems.map(subItem => {
                    const subActive = normalizedPath === subItem.href || normalizedPath.startsWith(subItem.href + '/');
                    return (
                      <Link
                        key={subItem.href}
                        href={subItem.href}
                        prefetch={false}
                        className={`rail-item${subActive ? ' active' : ''}`}
                        style={{
                          padding: '8px 12px',
                          fontSize: 13,
                          borderRadius: 8,
                          border: 'none'
                        }}
                        title={subItem.label}
                      >
                        <span className="label">{subItem.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rail-footer">
        <hr className="rail-hr" />
        <Link 
          href="/status" 
          className="rail-item" 
          style={{ 
            marginBottom: '12px',
            opacity: 0.8,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { (e.currentTarget.style as any).opacity = '1'; }}
          onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { (e.currentTarget.style as any).opacity = '0.8'; }}
          title="Recent Activity"
        >
          <span className="icon" aria-hidden><IconActivity width={18} height={18} /></span>
          <span className="label">Recent Activity</span>
        </Link>
        <div
          className="rail-collapse-row"
          onClick={() => setCollapsed(v => !v)}
          role="button"
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed && <span className="rail-collapse-label">Expand</span>}
          <span className="rail-collapse-icon" aria-hidden>{collapsed ? '»»' : '««'}</span>
        </div>
      </div>
    </aside>
  );
}
