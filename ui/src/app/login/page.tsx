"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Toast from '../../components/Toast';
import LoadingBar from '../../components/LoadingBar';

// Check if registration is enabled via environment variable
const REGISTRATION_ENABLED = process.env.NEXT_PUBLIC_ENABLE_REGISTRATION === 'true';

export default function LoginPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<'success'|'error'|'info'|null>(null);
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState<{kind:'success'|'error', text:string}|null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [modeSwitching, setModeSwitching] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setMsgKind(null);
    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
    const payload = mode === 'login'
      ? { email, password }
      : { email, password, first_name: firstName, last_name: lastName };
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (data.access_token) localStorage.setItem('sparrow_token', data.access_token);
      const resolvedFirst = data.first_name || (mode === 'signup' ? firstName : '');
      const resolvedLast = data.last_name || (mode === 'signup' ? lastName : '');
      if (resolvedFirst || resolvedLast) {
        localStorage.setItem('sparrow_user_name', `${resolvedFirst} ${resolvedLast}`.trim());
      }
      // Removed success message display - no message at bottom
      
      // Redirect to dashboard after successful authentication
      setTimeout(() => {
        setRedirecting(true);
        setLoading(false); // Set loading to false when loading bar appears
        // Dispatch event to notify other components of auth state change
        window.dispatchEvent(new CustomEvent('authStateChanged'));
        // Add a small delay before redirect to show loading bar
        setTimeout(() => {
          router.push('/');
        }, 2500); // 2.5 seconds to match loading bar duration
      }, 1500); // Small delay to show success message
    } else {
      const text = mode === 'login' ? 'The user is not registered' : (data.detail || 'Registration failed');
      setMsg(text);
      setMsgKind('error');
      if (mode !== 'login') {
        setShowToast({ kind: 'error', text });
      } else {
        setShowToast(null);
      }
      setLoading(false); // Only set loading to false on error
    }
  }

  return (
    <>
    <div className="card auth-card">
      <h2>{mode === 'login' ? 'Sign In' : 'Register'}</h2>
      <form onSubmit={onSubmit} className="grid" style={{ marginTop: 16 }}>
        {mode === 'signup' && (
          <div className="row">
            <label>
              First name
              <input value={firstName} onChange={e => setFirstName(e.target.value)} required={mode === 'signup'} />
            </label>
            <label>
              Last name
              <input value={lastName} onChange={e => setLastName(e.target.value)} required={mode === 'signup'} />
            </label>
          </div>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        <div className="form-actions">
          <button className="btn-primary" disabled={loading} type="submit">{loading ? (mode === 'login' ? 'Signing in…' : 'Creating…') : (mode === 'login' ? 'Sign in' : 'Create account')}</button>
        </div>
        {REGISTRATION_ENABLED && (
          <div className="auth-footer">
            <span className="auth-helper-text">
              {mode === 'login' ? 'Don\u2019t have an account?' : 'Already have an account?'}
            </span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModeSwitching(true);
                const next = mode === 'login' ? 'signup' : 'login';
                // allow overlay to mount before switching content
                setTimeout(() => {
                  setMode(next);
                  // keep spinner briefly to convey transition
                  setTimeout(() => setModeSwitching(false), 240);
                }, 10);
              }}
              className="auth-cta-link"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              {mode === 'login' ? 'Register' : 'Sign In'}
            </a>
          </div>
        )}
      </form>
      {msg && (
        <p className={`${msgKind === 'error' ? 'form-error' : 'muted'} auth-error`}>
          {msg}
        </p>
      )}
      {showToast && (
        <Toast kind={showToast.kind} message={showToast.text} duration={2800} onClose={() => setShowToast(null)} />
      )}
    </div>
    <LoadingBar show={redirecting} message="Signing In" />
    </>
  );
}
