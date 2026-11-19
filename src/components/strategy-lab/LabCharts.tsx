'use client';

import { useEffect, useRef } from 'react';
import {
  createChart, LineSeries, ColorType, CrosshairMode, createSeriesMarkers,
  type IChartApi, type Time, type SeriesMarker,
} from 'lightweight-charts';

export interface LineDef { name: string; color: string; times: number[]; values: number[]; width?: 1 | 2 | 3; dashed?: boolean }
export interface MarkerDef { time: number; kind: 'buy' | 'sell' }

const chartOptions = (el: HTMLDivElement) => ({
  layout: { background: { type: ColorType.Solid, color: '#141414' }, textColor: '#9095A1', fontFamily: 'var(--font-geist-mono), monospace', fontSize: 10 },
  grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: 'rgba(255,255,255,0.15)', labelBackgroundColor: '#30333A' },
    horzLine: { color: 'rgba(255,255,255,0.15)', labelBackgroundColor: '#30333A' },
  },
  rightPriceScale: { borderColor: '#30333A' },
  timeScale: { borderColor: '#30333A', timeVisible: false },
  width: el.clientWidth, height: el.clientHeight,
});

function toData(times: number[], values: number[]) {
  const out: { time: Time; value: number }[] = [];
  let last = -Infinity;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= last || !Number.isFinite(values[i])) continue;
    out.push({ time: times[i] as Time, value: values[i] });
    last = times[i];
  }
  return out;
}

export function LineChart({ lines, markers, height = 280, logScale = false }: { lines: LineDef[]; markers?: MarkerDef[]; height?: number; logScale?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, chartOptions(el));
    chart.priceScale('right').applyOptions({ mode: logScale ? 1 : 0 });
    chartRef.current = chart;
    lines.forEach((l, i) => {
      const s = chart.addSeries(LineSeries, {
        color: l.color, lineWidth: l.width ?? 2, lineStyle: l.dashed ? 2 : 0,
        priceLineVisible: false, lastValueVisible: true,
      });
      s.setData(toData(l.times, l.values));
      if (i === 0 && markers?.length) {
        const ms: SeriesMarker<Time>[] = markers
          .slice()
          .sort((a, b) => a.time - b.time)
          .map(m => ({
            time: m.time as Time,
            position: m.kind === 'buy' ? 'belowBar' : 'aboveBar',
            color: m.kind === 'buy' ? '#0FEDBE' : '#FF495B',
            shape: m.kind === 'buy' ? 'arrowUp' : 'arrowDown',
            size: 0.6,
          }));
        createSeriesMarkers(s, ms);
      }
    });
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [lines, markers, logScale]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', padding: '0 2px 6px', flexWrap: 'wrap' }}>
        {lines.map(l => (
          <span key={l.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'var(--text2)' }}>
            <span style={{ width: '14px', height: '2px', background: l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined }} />
            {l.name}
          </span>
        ))}
      </div>
      <div ref={ref} style={{ width: '100%', height }} />
    </div>
  );
}
