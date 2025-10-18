"use client";
import Link from 'next/link';
import { IconPlus } from '../components/icons';

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center" style={{ minHeight: 'calc(100vh - 200px)' }}>
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Welcome to AI Usability</h1>
        <p className="text-slate-600 mb-6">Run usability tests before you launch. Let's set up your first project.</p>
        <button className="flex items-center gap-2 px-6 py-3 rounded-lg mx-auto transition-colors" style={{ width: 'fit-content', fontSize: '15px', fontWeight: '600', backgroundColor: '#000000', color: '#FFFFFF', border: 'none' }}>
          <IconPlus width={20} height={20} /> Create Project
        </button>
        <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px dashed #CBD5E1', textAlign: 'left' }}>
          <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#64748B', marginBottom: '12px' }}>How it works</h2>
          <ol style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#64748B' }}>
            <li>1️⃣ Connect your Figma design</li>
            <li>2️⃣ Define goals and personas</li>
            <li>3️⃣ Run tests and view results</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
