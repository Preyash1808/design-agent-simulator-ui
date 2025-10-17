"use client";
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import LoadingBar from './LoadingBar';

export default function Topbar() {
  const [userLabel, setUserLabel] = useState('Guest User');
  const [loggedIn, setLoggedIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const checkAuthStatus = () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      if (!token) { 
        setLoggedIn(false); 
        setUserLabel('Guest User');
        return; 
      }
      setLoggedIn(true);
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
          if (!d) return;
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

  const initials = useMemo(() => {
    const base = userLabel && userLabel.includes('@') ? userLabel.split('@')[0] : userLabel;
    return (base || 'GU').slice(0, 2).toUpperCase();
  }, [userLabel]);

  return (
    <header className="topbar minimal">
      <div className="top-left">
        <Link href="/" className="brand-link" aria-label="Sparrow home">
          <span className="brand-logo">S</span>
          <span className="brand-name">Sparrow</span>
        </Link>
      </div>

      <nav className="top-center" />

      <div className="top-right">
        {loggedIn ? (
          <button 
            className="btn-ghost btn-sm" 
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try { 
                await fetch('/api/auth/logout', { method: 'POST' }); 
              } catch {}
              
              // Add delay before logout
              setTimeout(() => {
                localStorage.removeItem('sparrow_token');
                localStorage.removeItem('sparrow_user_name');
                setLoggedIn(false);
                setUserLabel('Guest User');
            // Dispatch event to notify other components of auth state change
            window.dispatchEvent(new CustomEvent('authStateChanged'));
            location.href = '/';
              }, 2000); // 2 second delay
            }}
          >
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
        ) : (
          <Link href="/login" className="btn-ghost btn-sm">Sign In</Link>
        )}
      </div>
              <LoadingBar show={loggingOut} message="Logging Out" />
    </header>
  );
}
