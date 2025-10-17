"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";

interface EmotionData {
  name: string;
  count: number;
  color: string;
  emoji: string;
  valence: number;
}

interface EmotionStep {
  screen: string;
  emotion: string;
  color: string;
  emoji: string;
}

interface EmotionMixProps {
  emotions: EmotionData[];
  emotionJourney: EmotionStep[];
}

export default function EmotionMix({ emotions, emotionJourney }: EmotionMixProps) {
  const total = emotions.reduce((acc, e) => acc + e.count, 0);
  const dominant = emotions.length > 0 ? [...emotions].sort((a, b) => b.count - a.count)[0] : null;
  // Recharts expects a generic data shape with index signatures; cast for TS compatibility
  const chartDataForRecharts: any[] = emotions as any[];
  // Build compact flow chips from the provided journey (limit length to avoid overflow)
  const flowChips = (emotionJourney || [])
    .slice(0, 18)
    .map(step => ({ emotion: step.emotion, emoji: step.emoji, screen: step.screen }));

  if (!emotions.length) {
    return (
      <div className="w-full p-4 rounded-xl bg-[#0B0E14] border border-neutral-800">
        <h3 className="text-lg font-semibold mb-2 text-white">Emotion Mix</h3>
        <div className="text-gray-400 text-sm">No emotion data available</div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 rounded-xl bg-[#0B0E14] border border-neutral-800">
      <h3 className="text-lg font-semibold mb-2 text-white">Overall Emotion</h3>

      {/* Donut Chart Section */}
      <div className="h-[230px] mb-4 flex flex-col items-center justify-center relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartDataForRecharts}
              dataKey="count"
              nameKey="name"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={3}
              stroke="none"
            >
              {emotions.map((e, i) => (
                <Cell key={`cell-${i}`} fill={e.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, entry: any) => {
                const v = typeof value === 'number' ? value : Number(value);
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                return [
                  `${pct}% (${Number.isFinite(v) ? v : 0})`,
                  `${entry?.payload?.emoji || ''} ${name}`,
                ];
              }}
              contentStyle={{
                background: "#111827",
                border: "none",
                color: "white",
                borderRadius: "8px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {dominant && (
          <div className="absolute text-center pointer-events-none" style={{ top: '50%', transform: 'translateY(-50%)' }}>
            <span className="text-2xl align-middle mr-2">{dominant.emoji}</span>
            <span className="text-sm text-gray-300 align-middle">{dominant.name}</span>
          </div>
        )}
      </div>

      {/* Emotion Flow Bar */}
      {emotionJourney.length > 0 && (
        <>
          <h4 className="text-md font-medium mb-1 text-gray-300">Emotion Journey</h4>
          <div className="flex space-x-1 h-8 rounded-md overflow-hidden border border-neutral-700">
            {emotionJourney.map((step, i) => (
              <motion.div
                key={i}
                className="flex-1 cursor-pointer"
                style={{ backgroundColor: step.color }}
                whileHover={{ scaleY: 1.1 }}
                title={`${step.emoji} ${step.emotion} (${step.screen})`}
              />
            ))}
          </div>

          {/* Compact horizontal flow chips (single line, horizontally scrollable) */}
          <div className="mt-2">
            <div
              role="region"
              aria-label="Emotion journey flow"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
                overflowX: 'auto',
                overflowY: 'hidden',
                paddingBottom: 2,
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'thin' as any,
              }}
            >
              {flowChips.map((step, i) => (
                <span key={`chip-${i}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span
                    className="border text-xs text-gray-200"
                    style={{ padding: '4px 8px', borderRadius: 999, borderColor: 'rgba(148,163,184,0.28)', background: 'rgba(17,24,39,0.6)' }}
                    title={step.screen}
                  >
                    <span className="mr-1" aria-hidden>{step.emoji}</span>
                    <span>{step.emotion}</span>
                  </span>
                  {i < flowChips.length - 1 && (
                    <span className="text-gray-500" aria-hidden style={{ margin: '0 6px' }}>→</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

    </div>
  );
}

