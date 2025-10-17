"use client";
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import SpinnerPortal from './SpinnerPortal';

/**
 * Global route-change spinner overlay.
 * Shows a spinner when user clicks internal links and hides after navigation completes.
 */
export default function RouteSpinner() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  function normalizePath(p: string): string {
    if (!p) return '/';
    if (p !== '/' && p.endsWith('/')) return p.slice(0, -1);
    return p;
  }

  // Hide spinner once the route changed
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 160); // small delay to avoid flicker
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Safety net: never keep spinner forever if no route change happens
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 2000);
    return () => clearTimeout(t);
  }, [show]);

  // Listen for clicks on internal links to start the spinner
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      // external or new tab
      const isAbsolute = /^(https?:)?\/\//.test(href);
      const url = (() => {
        try { return new URL(href, location.href); } catch { return null; }
      })();
      const isExternal = !url || (isAbsolute && url.origin !== location.origin);
      if (isExternal || anchor.getAttribute('target') === '_blank' || anchor.hasAttribute('download')) return;

      // Only show spinner for real pathname changes. Avoid for same-path or only query/hash updates.
      const nextPath = url ? normalizePath(url.pathname) : '';
      const currentPath = normalizePath(pathname || location.pathname);
      if (!nextPath || nextPath === currentPath) return;

      setShow(true);
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [pathname]);

  return <SpinnerPortal show={show} />;
}


