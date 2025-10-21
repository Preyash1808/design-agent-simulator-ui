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

  // Calculate the end percentage for dataZoom to show ~25 marks by default
  const dataZoomEnd = React.useMemo(() => {
    if (runs.length <= 25) return 100;
    return (25 / runs.length) * 100;
  }, [runs.length]);

  const option = React.useMemo(() => ({
    backgroundColor: 'transparent',
    title: { text: 'Screen Name', left: 0, top: 0, textStyle: { color: '#cbd5e1', fontSize: 14, fontWeight: 600 } },
    grid: { left: 70, right: 16, top: 40, bottom: 50, borderColor: 'rgba(148,163,184,0.15)', containLabel: false },
    xAxis: {
      type: 'category',
      data: mounted ? runs : [],
      axisLabel: { color: '#94a3b8', fontSize: 11, margin: 6 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.2)', width: 1 } },
      axisTick: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      gridIndex: 0
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#cbd5e1', formatter: (v: number) => `${v}%`, margin: 8, fontSize: 12, fontWeight: 500 },
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.2)', width: 1 } },
      axisTick: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)', type: 'solid', width: 1 } },
      name: 'Share %',
      nameTextStyle: { color: '#cbd5e1', fontSize: 12, fontWeight: 500 },
      nameGap: 12
    },
    dataZoom: [
      {
        type: 'slider',
        show: true,
        xAxisIndex: [0],
        start: 0,
        end: dataZoomEnd,
        bottom: 20,
        textStyle: { color: '#94a3b8' },
        fillerColor: 'rgba(59, 130, 246, 0.25)',
        borderColor: 'rgba(148,163,184,0.4)',
        handleStyle: { color: '#3b82f6', borderColor: 'rgba(59,130,246,0.3)', borderWidth: 1 },
        backgroundColor: 'rgba(148,163,184,0.08)',
      }
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: 'rgba(59, 130, 246, 0.5)',
      borderWidth: 1,
      textStyle: { color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' },
      padding: [12, 14],
      axisPointer: { type: 'cross', lineStyle: { color: 'rgba(59, 130, 246, 0.3)' } },
      formatter: (p: any) => {
        if (!p || !Array.isArray(p)) return '';
        const runLabel = p[0]?.axisValue || '';
        const lines = [`<div style="font-weight: 700; margin-bottom: 8px; color: #60a5fa; font-size: 13px;">▸ Run: ${runLabel}</div>`];

        p.forEach((it: any) => {
          if (it.seriesName === 'Average') return;
          const curr = typeof it.data === 'number' ? it.data : Number(it?.value ?? 0);
          const prevRaw = it?.seriesData && it.seriesData[0] && Array.isArray(it.seriesData[0].data)
            ? it.seriesData[0].data[it.dataIndex - 1]
            : undefined;
          const prev = it.dataIndex > 0 && typeof prevRaw === 'number' ? Number(prevRaw) : 0;
          const diff = curr - prev;
          const sign = diff === 0 ? '→' : (diff > 0 ? '↗' : '↘');
          const color = diff === 0 ? '#94a3b8' : (diff > 0 ? '#10b981' : '#ef4444');
          const currText = Number.isFinite(curr) ? curr.toFixed(1) : '0.0';
          const diffText = Number.isFinite(diff) ? Math.abs(diff).toFixed(1) : '0.0';
          lines.push(`<div style="margin: 6px 0; display: flex; align-items: center; gap: 8px;">${it.marker}<span style="font-weight: 500; flex: 1;">${it.seriesName}</span> <span style="color: #f0f9ff; font-weight: 600;">${currText}%</span> <span style="color: ${color}; font-weight: 700;">${sign} ${diffText}%</span></div>`);
        });

        // Add average line info
        const avgIdx = p.findIndex((it: any) => it.seriesName === 'Average');
        if (avgIdx >= 0) {
          const avgVal = p[avgIdx].data;
          lines.push(`<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(148,163,184,0.3); margin: 8px 0; font-weight: 500; color: #cbd5e1;">⊷ Avg: <span style="color: #a78bfa;">${Number.isFinite(avgVal) ? Number(avgVal).toFixed(1) : '0.0'}%</span></div>`);
        }

        return lines.join('');
      }
    },
    legend: {
      show: true,
      top: 5,
      left: 75,
      textStyle: { color: '#cbd5e1', fontSize: 12, fontWeight: 500 },
      itemGap: 20,
      itemWidth: 12,
      itemHeight: 12,
      data: [...(mounted ? sorted : []).map(s => s.name), 'Average'],
      backgroundColor: 'rgba(15,23,42,0.3)',
      borderColor: 'rgba(148,163,184,0.2)',
      borderRadius: 6,
      padding: [6, 12],
    },
    series: [
      ...(mounted ? sorted : []).map((s, i) => ({
        type: 'line',
        name: s.name,
        data: s.data,
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: hoveredPath === s.name ? 10 : 7,
        lineStyle: {
          width: hoveredPath === s.name ? 4 : 3,
          color: palette[i % palette.length],
          opacity: hoveredPath && hoveredPath !== s.name ? 0.25 : 1,
          cap: 'round',
          join: 'round'
        },
        itemStyle: {
          color: palette[i % palette.length],
          borderWidth: 2,
          borderColor: '#0f172a',
          shadowBlur: hoveredPath === s.name ? 16 : 4,
          shadowColor: `${palette[i % palette.length]}60`,
          shadowOffsetY: hoveredPath === s.name ? 4 : 2,
          opacity: hoveredPath && hoveredPath !== s.name ? 0.4 : 1
        },
        areaStyle: {
          color: palette[i % palette.length],
          opacity: hoveredPath === s.name ? 0.3 : 0.15
        },
        z: hoveredPath === s.name ? 20 : 5,
        animationDuration: 300,
        animationEasing: 'cubicOut'
      })),
      // Enhanced average trend line
      {
        type: 'line',
        name: 'Average',
        data: mounted ? avgLine : [],
        smooth: 0.4,
        symbol: 'diamond',
        symbolSize: 4,
        lineStyle: { width: 2, type: 'dashed', color: '#a78bfa', dashOffset: 5 },
        itemStyle: { color: '#a78bfa', borderColor: '#0f172a', borderWidth: 1, opacity: 0.8 },
        z: 3,
        animationDuration: 400,
        animationEasing: 'cubicOut'
      },
    ],
  }), [mounted, runs.join(','), runs.length, dataZoomEnd, JSON.stringify(sorted), JSON.stringify(avgLine), hoveredPath, palette.join(',')]);


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


