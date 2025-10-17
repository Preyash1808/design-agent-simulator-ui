"use client";
import { useEffect } from 'react';

export default function AuthRedirect() {
  useEffect(() => {
    function redirectIfLoggedOut() {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        if (!token) {
          if (typeof window !== 'undefined') {
            // Always land on Dashboard page when logged out/unauthorized
            window.location.href = '/';
          }
        }
      } catch {}
    }

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
  }, []);

  return null;
}


