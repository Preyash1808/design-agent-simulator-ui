"use client";
import React from 'react';
import Link from 'next/link';

export default function LaunchTestPage() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="page-title">Home</h1>
            <p className="meta">Start new tests, manage personas, and resume projects.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/configure-persona"><button className="btn btn-secondary">Manage Personas</button></Link>
            <Link href="/configure-test"><button className="btn btn-primary">New Project</button></Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6">
        <section className="py-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
            <h3 className="section-title mb-2">Projects</h3>
            <div className="text-2xl font-semibold text-slate-900">12 <span className="meta">total</span></div>
            <div className="mt-2 flex gap-2 text-sm">
              <span className="chip chip-success">7 ready</span>
              <span className="chip chip-pending">3 processing</span>
              <span className="chip chip-warn">2 re-index</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
            <h3 className="section-title mb-2">Personas</h3>
            <p className="text-slate-800">Active set: <span className="font-medium">Default</span></p>
            <div className="mt-3 flex gap-2">
              <span className="chip chip-pending">New</span>
              <span className="chip chip-pending">Returning</span>
              <span className="chip chip-pending">Streamliners</span>
              <span className="chip chip-pending">+3 more</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
            <h3 className="section-title mb-2">Runs (24h)</h3>
            <div className="flex gap-6 text-slate-800">
              <div><div className="text-2xl font-semibold">18</div><div className="meta">completed</div></div>
              <div><div className="text-2xl font-semibold">4</div><div className="meta">queued</div></div>
              <div><div className="text-2xl font-semibold">1</div><div className="meta">failed</div></div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="section-title">Projects</h3>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white">
              <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 21l-4.3-4.3M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/></svg>
              <input className="input border-0 h-auto p-0" placeholder="Search projects" />
            </div>
            <button className="btn btn-secondary">Filters</button>
            <button className="btn btn-secondary">Sort</button>
          </div>
        </div>

        {/* Row */}
        <div className="row">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <a className="text-slate-900 font-medium truncate hover:underline">Acme Checkout</a>
              <span className="chip chip-success">Ready</span>
            </div>
            <div className="meta mt-0.5">Design v23 · 4 goals · Updated 2h ago</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary">Open</button>
            <button className="btn btn-ghost">Results</button>
          </div>
        </div>

        {/* Processing row example */}
        <div className="row">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <a className="text-slate-900 font-medium hover:underline">Search &amp; Filter</a>
              <span className="chip chip-pending">Processing…</span>
            </div>
            <div className="meta mt-0.5">Design v7 · 3 goals · Updated 9:10 AM</div>
            <div className="mt-2 progress">
              <div className="progress-bar w-[42%]"></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary">Open</button>
            <button className="btn btn-ghost">Results</button>
          </div>
        </div>

        {/* Needs re-index example */}
        <div className="row">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <a className="text-slate-900 font-medium hover:underline">Onboarding</a>
              <span className="chip chip-warn">Needs re-index</span>
            </div>
            <div className="meta mt-0.5">Design v12 · 2 goals · Updated 1d ago</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary">Open</button>
            <button className="btn btn-ghost">Re-index</button>
          </div>
        </div>
        </section>

        <section className="py-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title">Recent runs</h3>
            <button className="btn btn-ghost">View all</button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2.5">Project</th>
                  <th className="text-left px-4 py-2.5">Goal</th>
                  <th className="text-left px-4 py-2.5">Personas</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">When</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">Acme Checkout</td>
                  <td className="px-4 py-2.5">Checkout</td>
                  <td className="px-4 py-2.5">New + Returning</td>
                  <td className="px-4 py-2.5"><span className="chip chip-success">Done</span></td>
                  <td className="px-4 py-2.5 text-right">10:12 AM</td>
                </tr>
                <tr className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">Search &amp; Filter</td>
                  <td className="px-4 py-2.5">Find a product</td>
                  <td className="px-4 py-2.5">Streamliners</td>
                  <td className="px-4 py-2.5"><span className="chip chip-pending">Queued</span></td>
                  <td className="px-4 py-2.5 text-right">9:45 AM</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
