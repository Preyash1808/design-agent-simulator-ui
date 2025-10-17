"use client";
import React from 'react';
import dynamic from 'next/dynamic';
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

export type PathItem = { path: string; sharePct?: number; count?: number };

function FlowSankey({
  paths,
  palette = ['#5B6DAA', '#4B6B88', '#2F6F7E', '#64748B', '#1E3A8A', '#B45309', '#94A3B8', '#475569'],
  height = 280,
  totalUsers,
  hoveredPath,
  selectedPath,
  onHover,
  onSelect,
}: {
  paths: PathItem[];
  palette?: string[];
  height?: number;
  hoveredPath?: string | null;
  selectedPath?: string | null;
  onHover?: (path: string | null) => void;
  onSelect?: (path: string) => void;
  totalUsers?: number;
}) {
  const pathsKey = React.useMemo(() => {
    if (!Array.isArray(paths)) return '';
    return paths
      .map((p) => `${p.path}|${p.sharePct ?? ''}|${p.count ?? ''}`)
      .join('||');
  }, [paths]);

  const top = React.useMemo(() => (Array.isArray(paths) ? paths.slice(0, 5) : []), [pathsKey]);

  function colorForPath(p: string): string {
    let h = 0;
    for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0;
    return palette[h % palette.length] || palette[0];
  }

  function categoryColor(name: string): string {
    const n = String(name || '').toLowerCase();
    if (/(splash|welcome|home)/.test(n)) return '#5B6DAA';
    if (/(auth|login|sign|verify)/.test(n)) return '#7c3aed';
    if (/(basket|cart|checkout|order|payment|complete order)/.test(n)) return '#ec4899';
    if (/(complete|success|done|confirmation)/.test(n)) return '#10b981';
    return '#94A3B8';
  }

  const option = React.useMemo(() => {
    if (!top.length) {
      return {
        backgroundColor: 'transparent',
        graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'No path data available', fill: '#94a3b8', fontSize: 14 } }],
        series: [],
      } as any;
    }

    type Edge = { source: string; target: string; value: number; __fullPath: string };

    // Parse and sanitize individual paths (remove within-path loops and consecutive dups)
    const sequences: string[][] = [];
    let maxDepth = 0;
    let maxValue = 0;
    const edgeCandidates: Edge[] = [];
    for (const it of top) {
      const partsRaw = String(it.path || '')
        .split('>')
        .map((s) => s.trim())
        .filter(Boolean);
      const seq: string[] = [];
      const seenInPath = new Set<string>();
      for (const name of partsRaw) {
        if (seenInPath.has(name)) break;
        seenInPath.add(name);
        if (seq.length === 0 || seq[seq.length - 1] !== name) seq.push(name);
      }
      if (seq.length < 2) continue;
      sequences.push(seq);
      maxDepth = Math.max(maxDepth, Math.max(0, seq.length - 1));
      const value = Number(it.sharePct || it.count || 0);
      maxValue = Math.max(maxValue, value);
      for (let i = 0; i < seq.length - 1; i++) {
        const u = seq[i];
        const v = seq[i + 1];
        if (!u || !v || u === v) continue;
        edgeCandidates.push({ source: u, target: v, value, __fullPath: it.path });
      }
    }

    // Global order heuristic from first-seen position across sequences
    const order = new Map<string, number>();
    for (const seq of sequences) {
      for (let i = 0; i < seq.length; i++) {
        const n = seq[i];
        if (!order.has(n) || (order.get(n) as number) > i) order.set(n, i);
      }
    }
    const DEFAULT_ORDER = 1e9;

    // Prefer stronger edges first
    edgeCandidates.sort((a, b) => (b.value || 0) - (a.value || 0));

    // Accept only forward, acyclic edges; dedupe source→target by max value
    const adj = new Map<string, Set<string>>();
    function ensureNode(n: string) { if (!adj.has(n)) adj.set(n, new Set<string>()); }
    function reachable(from: string, to: string): boolean {
      if (from === to) return true;
      const visited = new Set<string>();
      const stack: string[] = [from];
      while (stack.length) {
        const cur = stack.pop() as string;
        if (cur === to) return true;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const nbrs = adj.get(cur);
        if (nbrs) for (const nx of nbrs) stack.push(nx);
      }
      return false;
    }

    const linkMap = new Map<string, Edge>();
    for (const e of edgeCandidates) {
      const ou = order.has(e.source) ? (order.get(e.source) as number) : DEFAULT_ORDER;
      const ov = order.has(e.target) ? (order.get(e.target) as number) : DEFAULT_ORDER;
      if (!(ou < ov)) continue; // enforce global forward flow
      ensureNode(e.source); ensureNode(e.target);
      if (reachable(e.target, e.source)) continue; // skip if would create cycle
      adj.get(e.source)!.add(e.target);
      const key = `${e.source}→${e.target}`;
      const prev = linkMap.get(key);
      if (!prev || e.value > prev.value) linkMap.set(key, e);
    }

    // Robust cycle pruning: if any cycle still exists, iteratively remove the lowest-value edge in the cycle
    function buildAdjFromLinks(map: Map<string, Edge>) {
      const m = new Map<string, Set<string>>();
      for (const e of map.values()) {
        if (!m.has(e.source)) m.set(e.source, new Set<string>());
        m.get(e.source)!.add(e.target);
      }
      return m;
    }

    function findCycle(map: Map<string, Edge>): string[] | null {
      const g = buildAdjFromLinks(map);
      const visited = new Set<string>();
      const inStack = new Set<string>();
      const stack: string[] = [];

      function dfs(u: string): string[] | null {
        visited.add(u);
        inStack.add(u);
        stack.push(u);
        const nbrs = g.get(u) || new Set<string>();
        for (const v of nbrs) {
          if (!visited.has(v)) {
            const cyc = dfs(v);
            if (cyc) return cyc;
          } else if (inStack.has(v)) {
            // cycle: v ... u -> v
            const start = stack.lastIndexOf(v);
            const cycNodes = stack.slice(start);
            cycNodes.push(v);
            return cycNodes;
          }
        }
        stack.pop();
        inStack.delete(u);
        return null;
      }

      const nodes = new Set<string>();
      for (const e of map.values()) { nodes.add(e.source); nodes.add(e.target); }
      for (const n of nodes) {
        if (!visited.has(n)) {
          const cyc = dfs(n);
          if (cyc) return cyc;
        }
      }
      return null;
    }

    let safety = 100;
    while (safety-- > 0) {
      const cyc = findCycle(linkMap);
      if (!cyc) break;
      // Remove the weakest edge along the cycle
      let weakestKey = '';
      let weakestVal = Infinity;
      for (let i = 0; i < cyc.length - 1; i++) {
        const u = cyc[i]; const v = cyc[i + 1];
        const key = `${u}→${v}`;
        const e = linkMap.get(key);
        if (e && e.value < weakestVal) { weakestVal = e.value; weakestKey = key; }
      }
      if (weakestKey) linkMap.delete(weakestKey); else break;
    }

    const acceptedLinks = Array.from(linkMap.values()).map((e) => ({
      source: e.source,
      target: e.target,
      value: e.value,
      lineStyle: { color: colorForPath(e.__fullPath), opacity: 0.35 + 0.65 * (e.value > 0 ? e.value / Math.max(1, maxValue) : 0) },
      emphasis: { lineStyle: { width: 8, shadowBlur: 12, shadowColor: 'rgba(255,255,255,0.18)' } },
      __fullPath: e.__fullPath,
    }));

    // Nodes from accepted links only
    const nodesSet = new Set<string>();
    for (const lk of acceptedLinks) { nodesSet.add(lk.source); nodesSet.add(lk.target); }
    const nodes = Array.from(nodesSet).map((name) => ({ name, itemStyle: { color: categoryColor(name), borderRadius: 6 } }));

    if (!acceptedLinks.length || !nodes.length) {
      return {
        backgroundColor: 'transparent',
        graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'No path data available', fill: '#94a3b8', fontSize: 14 } }],
        series: [],
      } as any;
    }

    const levels = Array.from({ length: Math.max(1, maxDepth) + 1 }).map((_, d) => ({
      depth: d,
      label: {
        show: d === 0 || d === Math.max(1, maxDepth),
        position: d === 0 ? 'left' : 'right',
        align: d === 0 ? 'left' : 'right',
        distance: 4,
        fontSize: 11,
        lineHeight: 14,
        width: 110,
        color: '#cbd5e1',
        overflow: 'break' as any,
        formatter: (p: any) => String(p?.name || ''),
      },
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          if (params.dataType === 'node') return `Screen: ${params.name}`;
          if (params.dataType === 'edge') {
            const p = params.data.__fullPath || '';
            const v = Number(params.data.value || 0);
            const users = Math.round((Number(totalUsers||0) * v) / 100);
            return `${p}<br/>${v}% of users${Number.isFinite(users) && users>0 ? ` (~${users} users)` : ''}`;
          }
          return params.name;
        },
      },
      animation: true,
      animationDuration: 500,
      animationEasing: 'cubicOut',
      series: [
        {
          type: 'sankey',
          data: nodes,
          links: acceptedLinks,
          orient: 'horizontal',
          left: 8,
          right: 8,
          top: 6,
          bottom: 6,
          nodeGap: 18,
          nodeWidth: 14,
          draggable: false,
          emphasis: { focus: 'adjacency' },
          lineStyle: { curveness: 0.55, color: 'gradient', opacity: 0.95, shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.35)' },
          edgeLabel: {
            show: true,
            color: '#e5e7eb',
            fontSize: 10,
            formatter: (p: any) => {
              const v = Number(p.data?.value || 0);
              return v >= 8 ? `${Math.round(v)}%` : '';
            },
          },
          label: {
            show: true,
            position: 'right',
            align: 'right',
            distance: 4,
            fontSize: 11,
            lineHeight: 14,
            width: 110,
            color: '#cbd5e1',
            overflow: 'break' as any,
            formatter: (p: any) => String(p?.name || ''),
          },
          levels,
          labelLayout: { hideOverlap: true } as any,
          blendMode: 'lighter',
          select: { disabled: true },
        },
      ],
    } as any;
  }, [pathsKey, palette.join(',')]);

  const lastHoverRef = React.useRef<string | null>(null);
  const hoverTimerRef = React.useRef<any>(null);
  const events = React.useMemo(() => ({
    mouseover: (e: any) => {
      try {
        const v = e?.data?.__fullPath ? String(e.data.__fullPath) : null;
        if (!v) return;
        if (lastHoverRef.current === v) return;
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          lastHoverRef.current = v;
          if (onHover) onHover(v);
        }, 80);
      } catch {}
    },
    globalout: () => {
      try {
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        if (lastHoverRef.current !== null) { lastHoverRef.current = null; if (onHover) onHover(null); }
      } catch {}
    },
    click: (e: any) => { try { if (e?.data?.__fullPath && onSelect) onSelect(String(e.data.__fullPath)); } catch {} },
  }), [onHover, onSelect]);

  return (
    <ReactECharts
      style={{ height, width: '100%' }}
      option={option}
      onEvents={events}
      notMerge
      lazyUpdate
      opts={{ renderer: 'canvas' }}
    />
  );
}

function makePathsKey(arr: PathItem[] | undefined | null): string {
  if (!Array.isArray(arr)) return '';
  return arr
    .slice(0, 5)
    .map((p) => `${p.path}|${p.sharePct ?? ''}|${p.count ?? ''}`)
    .join('||');
}

export default React.memo(FlowSankey, (prev, next) => {
  if (prev.height !== next.height) return false;
  const p1 = Array.isArray(prev.palette) ? prev.palette.join(',') : '';
  const p2 = Array.isArray(next.palette) ? next.palette.join(',') : '';
  if (p1 !== p2) return false;
  return makePathsKey(prev.paths) === makePathsKey(next.paths);
});


