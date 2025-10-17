"use client";
import React from 'react';
import dynamic from 'next/dynamic';
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

function PathShareTrend({
  runs,
  series,
  palette = ['#5B6DAA', '#4B6B88', '#2F6F7E', '#64748B', '#1E3A8A', '#B45309', '#94A3B8', '#475569'],
  height = 140,
  onHover,
  hoveredPath,
}: {
  runs: string[]; // run labels (most recent last)
  series: Array<{ name: string; data: number[] }>; // per path, % share per run
  palette?: string[];
  height?: number;
  onHover?: (path: string | null) => void;
  hoveredPath?: string | null;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  // Show only top 3 series by latest value for clarity
  const sorted = React.useMemo(() => {
    const arr = [...series];
    arr.sort((a, b) => (b.data[b.data.length - 1] || 0) - (a.data[a.data.length - 1] || 0));
    return arr.slice(0, 3);
  }, [JSON.stringify(series)]);

  const avgLine = React.useMemo(() => {
    if (!series.length) return [] as number[];
    const len = Math.max(...series.map(s => s.data.length));
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      let sum = 0; let count = 0;
      for (const s of series) { if (typeof s.data[i] === 'number') { sum += s.data[i]; count++; } }
      out.push(count ? Math.round((sum / count) * 10) / 10 : 0);
    }
    return out;
  }, [JSON.stringify(series)]);

  const option = React.useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 10, bottom: 28 },
    xAxis: { type: 'category', data: mounted ? runs : [], axisLabel: { color: '#94a3b8', fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#94a3b8', formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
    tooltip: {
      trigger: 'axis',
      formatter: (p: any) => {
        const lines = p.map((it: any) => {
          if (it.seriesName === 'Average') return null;
          const prevRaw = it?.seriesData && it.seriesData[0] && Array.isArray(it.seriesData[0].data)
            ? it.seriesData[0].data[it.dataIndex - 1]
            : undefined;
          const prev = it.dataIndex > 0 && typeof prevRaw === 'number' ? Number(prevRaw) : 0;
          const curr = typeof it.data === 'number' ? it.data : Number(it?.value ?? 0);
          const diff = curr - prev;
          const sign = diff === 0 ? '' : (diff > 0 ? '+' : '');
          const currText = Number.isFinite(curr) ? curr.toFixed(1) : String(curr ?? '0');
          const diffText = Number.isFinite(diff) ? diff.toFixed(1) : '0.0';
          return `${it.marker}${it.seriesName}: ${currText}% (${sign}${diffText} vs prev)`;
        }).filter(Boolean);
        return lines.join('<br/>');
      }
    },
    legend: { show: false },
    series: [
      ...(mounted ? sorted : []).map((s, i) => ({
        type: 'line', name: s.name, data: s.data, smooth: true,
        symbol: 'circle', symbolSize: 6,
        lineStyle: { width: 3, color: palette[i % palette.length], opacity: hoveredPath && hoveredPath !== s.name ? 0.15 : 1 },
        itemStyle: { color: palette[i % palette.length], borderWidth: 1.2, borderColor: '#0b0f14', shadowBlur: hoveredPath === s.name ? 10 : 0, shadowColor: 'rgba(0,0,0,0.35)' },
        areaStyle: { opacity: 0.1, color: palette[i % palette.length] },
      })),
      // Dotted average trend
      { type: 'line', name: 'Average', data: mounted ? avgLine : [], smooth: true, symbol: 'none', lineStyle: { width: 1.4, type: 'dotted', color: 'rgba(148,163,184,0.9)' }, z: 0 },
    ],
  }), [mounted, runs.join(','), JSON.stringify(sorted), JSON.stringify(avgLine), hoveredPath, palette.join(',')]);

  return (
    <ReactECharts
      style={{ height }}
      option={option}
      notMerge={false}
      lazyUpdate
      onEvents={{
        // Only set hover when entering a series; clear when leaving chart entirely to avoid constant refresh while moving between points
        mouseover: (e: any) => { try { if (onHover && e?.seriesName) onHover(String(e.seriesName)); } catch {} },
        globalout: () => { try { if (onHover) onHover(null); } catch {} },
      }}
    />
  );
}

// Prevent re-rendering on hover changes by ignoring hoveredPath in props comparison
export default React.memo(PathShareTrend, (prev, next) => {
  const runsEqual = prev.runs.length === next.runs.length && prev.runs.every((v, i) => v === next.runs[i]);
  const seriesEqual = prev.series.length === next.series.length && prev.series.every((s, i) => {
    const t = next.series[i];
    if (!t || s.name !== t.name || s.data.length !== t.data.length) return false;
    for (let j = 0; j < s.data.length; j++) { if (s.data[j] !== t.data[j]) return false; }
    return true;
  });
  const paletteEqual = (prev.palette || []).join(',') === (next.palette || []).join(',');
  return runsEqual && seriesEqual && paletteEqual && prev.height === next.height && prev.onHover === next.onHover;
});


