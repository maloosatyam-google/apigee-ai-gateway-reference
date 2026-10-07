import React, { useState } from 'react';
import { usePersonaVoice } from '../utils/voice';

export interface DonutSlice {
  id: string;
  label: string;
  badge?: string;
  sublabel?: string;
  value: number;
  formattedValue: string;
  color: string;
  badgeBg?: string;
  percentage: number;
}

export interface DonutPieChartProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  data: DonutSlice[];
  totalFormatted: string;
  totalLabel: string;
  unitLabel?: string;
  centerBadgeColor?: string;
  borderless?: boolean;
}

function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

function describeArc(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const delta = Math.min(endAngle - startAngle, 359.99);
  const actualEnd = startAngle + delta;

  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rOuter, actualEnd);
  const p3 = polarToCartesian(cx, cy, rInner, actualEnd);
  const p4 = polarToCartesian(cx, cy, rInner, startAngle);

  const largeArcFlag = delta > 180 ? 1 : 0;

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArcFlag} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArcFlag} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export const DonutPieChart: React.FC<DonutPieChartProps> = ({
  title,
  subtitle,
  icon,
  data,
  totalFormatted,
  totalLabel,
  unitLabel,
  centerBadgeColor = 'text-slate-900',
  borderless = false,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Shown on Analytics (admin speakers) but usable anywhere, so every speaker gets a line.
  const { sp } = usePersonaVoice('active');
  const shareWord = sp({
    technical: 'Share',
    platform: 'of metered',
    finance: 'of total',
    ai_coe: 'of the mix',
    eng: 'Share',
    analysts: 'of total',
    support: 'of total',
  });
  const emptyText = sp({
    technical: 'Nothing metered in this window yet.',
    platform: 'No metered model traffic in this scope and window.',
    finance: 'No spend to break down for this period.',
    ai_coe: 'No model usage to break down for this period.',
    eng: 'No calls from your key in this window yet.',
    analysts: 'Nothing to break down for this period yet.',
    support: 'Nothing to break down for this period yet.',
  });

  // Only consider items with positive value
  const validData = data.filter((d) => d.value > 0);
  const total = validData.reduce((acc, d) => acc + d.value, 0);

  // Compute start and end angles for each slice
  let currentAngle = 0;
  const slicesWithAngles = validData.map((item) => {
    const fraction = total > 0 ? item.value / total : 0;
    const sweepAngle = fraction * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sweepAngle;
    currentAngle = endAngle;

    return {
      ...item,
      startAngle,
      endAngle,
      fraction,
    };
  });

  const activeSlice = slicesWithAngles.find((s) => s.id === hoveredId);

  return (
    <div className={borderless ? "w-full space-y-3" : "bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between"}>
      {/* Optional Header */}
      {title && (
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="border-b-2 border-purple-500 inline-flex items-center gap-1.5 pb-0.5 font-bold text-sm text-slate-900">
              {icon}
              <span>{title}</span>
            </div>
            {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          </div>
        </div>
      )}

      {/* Chart & Categorized Legend (Inspired by Semrush On Page SEO Checker) */}
      <div className="flex flex-col sm:flex-row items-center gap-6 pt-1">
        {/* SVG Donut Canvas */}
        <div className="relative w-48 h-48 shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 200 200" className="w-full h-full overflow-visible">
            {/* Background ring */}
            <circle
              cx="100"
              cy="100"
              r="70"
              fill="none"
              strokeWidth="24"
              className="stroke-slate-100"
            />

            {/* Slices */}
            {slicesWithAngles.map((s) => {
              if (s.value <= 0) return null;
              const isHovered = s.id === hoveredId;
              const rOuter = isHovered ? 86 : 82;
              const rInner = isHovered ? 52 : 54;
              const d = describeArc(100, 100, rOuter, rInner, s.startAngle, s.endAngle);

              return (
                <path
                  key={s.id}
                  d={d}
                  fill={s.color}
                  strokeWidth="2"
                  className="stroke-white transition-all duration-200 cursor-pointer"
                  style={{
                    filter: isHovered ? 'drop-shadow(0 0 8px rgba(0, 0, 0, 0.2))' : 'none',
                    opacity: hoveredId && !isHovered ? 0.4 : 1,
                  }}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              );
            })}
          </svg>

          {/* Center Callout Overlay.
              The hole is a circle, so each line must fit the chord at ITS OWN
              vertical offset, not one shared box. Measured at w-48: the hole is
              104px across, the centre value line has ~101px to work with, but
              the label and share lines sit ~18px off-centre where the chord
              narrows to ~90px. Hence the two different max widths. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <span className="max-w-[84px] truncate text-[10px] uppercase font-mono tracking-wider text-slate-500 font-semibold leading-none mb-1">
              {activeSlice ? activeSlice.label : totalLabel}
            </span>
            <span className={`max-w-[98px] truncate text-sm sm:text-base font-bold font-mono tracking-tight leading-none ${centerBadgeColor}`}>
              {activeSlice ? activeSlice.formattedValue : totalFormatted}
            </span>
            <span className="max-w-[84px] truncate text-[10px] text-slate-500 font-medium leading-none mt-1">
              {activeSlice
                ? `${activeSlice.percentage.toFixed(1)}% ${shareWord}`
                : unitLabel || sp({ technical: 'Total', business: 'Total' })}
            </span>
          </div>
        </div>

        {/* Categorized List with 2-Letter Badges (Semrush Reference Pattern) */}
        <div className="flex-1 w-full space-y-2 text-xs">
          {slicesWithAngles.length === 0 && (
            <p className="py-6 text-center text-slate-500">{emptyText}</p>
          )}
          {slicesWithAngles.filter((item) => item.value > 0 && item.percentage >= 0.1).map((item) => {
            const isHovered = item.id === hoveredId;
            const badgeText = item.badge || item.label.slice(0, 2).toUpperCase();

            return (
              <div
                key={item.id}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`flex items-center justify-between p-2 rounded-xl border transition cursor-pointer ${
                  isHovered
                    ? 'bg-slate-50 border-slate-300 shadow-sm'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                {/* 2-Letter Badge + Label */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-6 h-6 rounded-lg font-mono font-bold text-[10px] text-white flex items-center justify-center shrink-0 shadow-xs"
                    style={{ backgroundColor: item.color }}
                  >
                    {badgeText}
                  </span>
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-slate-800 truncate">
                      {item.label}
                    </div>
                    {item.sublabel && (
                      <div className="text-[10px] text-slate-500 truncate">
                        {item.sublabel}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Aligned Value + Percentage */}
                <div className="text-right shrink-0 pl-3">
                  <div className="font-mono font-bold text-slate-900">
                    {item.formattedValue}
                  </div>
                  <div className="text-[10px] font-mono font-semibold text-emerald-600">
                    {item.percentage.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
