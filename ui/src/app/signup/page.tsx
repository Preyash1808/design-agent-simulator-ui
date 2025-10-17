"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Toast from '../../components/Toast';
import LoadingBar from '../../components/LoadingBar';

// Check if registration is enabled via environment variable
const REGISTRATION_ENABLED = process.env.NEXT_PUBLIC_ENABLE_REGISTRATION === 'true';

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState<{kind:'success'|'error', text:string}|null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Redirect to login if registration is disabled
  useEffect(() => {
    if (!REGISTRATION_ENABLED) {
      router.replace('/login');
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Double-check registration is enabled
    if (!REGISTRATION_ENABLED) {
      setShowToast({ kind: 'error', text: 'Registration is currently disabled' });
      return;
    }

    setLoading(true);
    setMsg(null);
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (data.access_token) localStorage.setItem('sparrow_token', data.access_token);
      const text = 'Account created successfully';
      setMsg(text);
      // Removed success toast - no green toast message
      
      // Redirect to dashboard after successful registration
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
      const text = data.detail || 'Registration failed';
      setMsg(text);
      setShowToast({ kind: 'error', text });
      setLoading(false); // Only set loading to false on error
    }
  }

  // Don't render the form if registration is disabled (will redirect)
  if (!REGISTRATION_ENABLED) {
    return null;
  }

  return (
    <>
    <div className="card">
      <h2>Register</h2>
      <form onSubmit={onSubmit} className="grid" style={{ marginTop: 16 }}>
        <div className="row">
          <label>
            First name
            <input value={firstName} onChange={e => setFirstName(e.target.value)} required />
          </label>
          <label>
            Last name
            <input value={lastName} onChange={e => setLastName(e.target.value)} required />
          </label>
        </div>
        <label>
          Email
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        <button disabled={loading} type="submit">{loading ? 'Creating…' : 'Create account'}</button>
      </form>
      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
      {showToast && (
        <Toast kind={showToast.kind} message={showToast.text} duration={2800} onClose={() => setShowToast(null)} />
      )}
    </div>
    <LoadingBar show={redirecting} message="Creating Account" />
    </>
  );
}
