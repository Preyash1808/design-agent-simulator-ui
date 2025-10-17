"use client";
import { useState } from 'react';
import Toast from '../../components/Toast';
import './contact.css';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info', text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Placeholder submit – wire to backend/email provider as needed
    setTimeout(() => {
      setToast({ kind: 'success', text: "Message sent. We'll get back soon!" });
      setLoading(false);
      setName(''); setEmail(''); setMessage('');
    }, 450);
  }

  return (
    <div className="contact-wrap">
      <h1 className="contact-title">We're here to help</h1>
      <div className="contact-grid">
        <div className="contact-panel">
          <form onSubmit={onSubmit} className="grid">
            <label>
              Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., John Smith" required />
            </label>
            <label>
              Email address
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g., you@company.com" required />
            </label>
            <label>
              Message
              <textarea rows={6} value={message} onChange={e => setMessage(e.target.value)} placeholder="Let us know how we can help" required />
            </label>
            <div className="form-actions">
              <button className="btn-primary" disabled={loading} type="submit">{loading ? 'Sending…' : 'Send message'}</button>
            </div>
          </form>
        </div>

        <div className="contact-card">
          <div className="contact-card-header">
            <div className="contact-logo">S</div>
            <div className="contact-brand">Sparrow</div>
          </div>
          <div className="contact-quote">
            “Sparrow cut project delays by 30% and transformed our global team communication, saving us hours every week.”
          </div>
          <div className="contact-quote-sub">— Product Lead, Example Corp</div>
        </div>
      </div>

      {toast && <Toast kind={toast.kind} message={toast.text} duration={2800} onClose={() => setToast(null)} />}
    </div>
  );
}
