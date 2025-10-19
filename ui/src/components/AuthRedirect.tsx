"use client";
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function AuthRedirect() {
  const pathname = usePathname();

  useEffect(() => {
    function redirectIfLoggedOut() {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const currentPath = pathname || window.location.pathname;

        // Public routes that don't require authentication
        const publicRoutes = ['/login', '/signup'];
        const isPublicRoute = publicRoutes.some(route => currentPath.startsWith(route));

        if (!token && !isPublicRoute) {
          if (typeof window !== 'undefined') {
            // Redirect to login page when not authenticated
            window.location.href = '/login';
          }
        }
      } catch {}
    }

    redirectIfLoggedOut();

    const onAuth = () => redirectIfLoggedOut();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sparrow_token') redirectIfLoggedOut();
    };
    window.addEventListener('authStateChanged', onAuth);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('authStateChanged', onAuth);
      window.removeEventListener('storage', onStorage);
    };
  }, [pathname]);

  return null;
}


