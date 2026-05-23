import { useEffect, useRef, memo, useState, useCallback } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from "lightweight-charts";
import type { CandlePoint, AutoTraderState, TradeMarker } from "../types";

type BarKey = "1m" | "5m" | "15m" | "1H";

interface Props {
  candles: CandlePoint[] | undefined;
  currentCandle: CandlePoint | null | undefined;
  autoTrader: AutoTraderState | undefined;
  currentPrice: number;
  positions: any[];
  recentTrades: any[];
  tradeMarkers: TradeMarker[];
  candleMap: Record<BarKey, { candles: CandlePoint[] | undefined; currentCandle: CandlePoint | null | undefined }>;
}

const BARS: BarKey[] = ["1m", "5m", "15m", "1H"];

function formatBeijing(sec: number): string {
  const d = new Date((sec + 8 * 3600) * 1000);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatBeijingFull(sec: number): string {
  const d = new Date((sec + 8 * 3600) * 1000);
  const M = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const D = d.getUTCDate().toString().padStart(2, "0");
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${M}-${D} ${h}:${m}`;
}

// ---- MACD helpers ----

function calcEMA(values: number[], period: number): number[] {
  const r: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return r;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  r[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * k + ema;
    r[i] = ema;
  }
  return r;
}

function computeMACDData(candles: CandlePoint[], fast = 12, slow = 26, signal = 9) {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const fastEMA = calcEMA(closes, fast);
  const slowEMA = calcEMA(closes, slow);

  const macdArr: number[] = new Array(n).fill(NaN);
  const macdValues: number[] = [];
  const macdIndices: number[] = [];
  for (let i = slow - 1; i < n; i++) {
    const v = fastEMA[i] - slowEMA[i];
    macdArr[i] = v;
    macdValues.push(v);
    macdIndices.push(i);
  }

  const signalEMA = calcEMA(macdValues, signal);
  const signalArr: number[] = new Array(n).fill(NaN);
  const histArr: number[] = new Array(n).fill(NaN);
  for (let i = 0; i < signalEMA.length; i++) {
    if (!isNaN(signalEMA[i])) {
      const oi = macdIndices[i];
      signalArr[oi] = signalEMA[i];
      histArr[oi] = macdArr[oi] - signalArr[oi];
    }
  }

  return candles.map((c, i) => ({
    time: c.time,
    macd: macdArr[i] as any,
    signal: signalArr[i] as any,
    histogram: histArr[i] as any,
  }));
}

export const PriceChart = memo(function PriceChart({
  candles: _candles, currentCandle: _currentCandle,
  autoTrader, currentPrice,
  candleMap, tradeMarkers,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const macdHistRef = useRef<any>(null);
  const macdLineRef = useRef<any>(null);
  const signalLineRef = useRef<any>(null);
  const macdMarkersRef = useRef<any>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const macdTooltipRef = useRef<HTMLDivElement>(null);
  const macdDataRef = useRef<any[]>([]);
  const positionedRef = useRef<string>("");
  const [activeBar, setActiveBar] = useState<BarKey>("5m");
  const [showTooltip, setShowTooltip] = useState(true);
  const showTooltipRef = useRef(true);
  useEffect(() => { showTooltipRef.current = showTooltip; }, [showTooltip]);

  const activeData = candleMap[activeBar];
  const candles = activeData?.candles;
  const curCandle = activeData?.currentCandle;

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0d1117" },
        textColor: "#8b949e",
      },
      grid: {
        vertLines: { color: "#1c2333" },
        horzLines: { color: "#1c2333" },
      },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => formatBeijing(time),
      },
      rightPriceScale: { borderColor: "#30363d" },
      crosshair: {
        mode: 0, // CrosshairMode.Normal
        vertLine: { color: "#636785", width: 1, style: 2, labelBackgroundColor: "#9b7fbf" },
        horzLine: { color: "#636785", width: 1, style: 2, labelBackgroundColor: "#9b7fbf" },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      handleScroll: false,
      handleScale: false,
    });

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#3fb950",
      downColor: "#f85149",
      borderDownColor: "#f85149",
      borderUpColor: "#3fb950",
      wickDownColor: "#f85149",
      wickUpColor: "#3fb950",
    });

    const vs = chart.addSeries(HistogramSeries, {
      color: "#58a6ff33",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // Markers plugin (v5: not available directly on series)
    const markersPlugin = createSeriesMarkers(cs);

    // MACD sub-pane
    const macdPane = chart.addPane(true);
    const mh = macdPane.addSeries(HistogramSeries, {
      color: "#26a69a33",
      priceFormat: { type: "volume" },
      priceScaleId: "histogram",
    });
    const ml = macdPane.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      autoscaleInfoProvider: (original: () => any) => {
        const info = original();
        if (!info) return info;
        const r = info.priceRange;
        const pad = (r.maxValue - r.minValue) * 0.1;
        return {
          priceRange: {
            minValue: r.minValue - pad,
            maxValue: r.maxValue + pad,
          },
        };
      },
    });
    const sl = macdPane.addSeries(LineSeries, {
      color: "#FF6D00",
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    macdPane.setHeight(120);
    const macdMarkers = createSeriesMarkers(ml);

    chartRef.current = chart;
    candleSeriesRef.current = cs;
    volumeSeriesRef.current = vs;
    markersRef.current = markersPlugin;
    macdMarkersRef.current = macdMarkers;
    macdHistRef.current = mh;
    macdLineRef.current = ml;
    signalLineRef.current = sl;

    // Crosshair tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    containerRef.current.appendChild(tooltip);
    tooltipRef.current = tooltip;

    // MACD tooltip (top-left overlay)
    const macdTipEl = document.createElement("div");
    macdTipEl.className = "macd-tooltip";
    containerRef.current.appendChild(macdTipEl);
    macdTooltipRef.current = macdTipEl;

    chart.subscribeCrosshairMove((param: any) => {
      const hasPoint = param.time && param.point;

      // Main OHLCV tooltip
      if (!showTooltipRef.current || !hasPoint) {
        tooltip.style.display = "none";
      } else {
        const data = param.seriesData.get(cs);
        if (!data) {
          tooltip.style.display = "none";
        } else {
          const d = data as any;
          const volD = param.seriesData.get(vs) as any;
          const volume = volD?.value ?? 0;
          const chg = d.close - d.open;
          const chgPct = d.open > 0 ? ((chg / d.open) * 100) : 0;
          const chgColor = chg >= 0 ? "#3fb950" : "#f85149";
          tooltip.innerHTML = `
            <div class="tip-time">${formatBeijingFull(param.time as number)}</div>
            <div class="tip-row"><span>开</span><span class="tip-val">${d.open.toFixed(2)}</span></div>
            <div class="tip-row"><span>高</span><span class="tip-val">${d.high.toFixed(2)}</span></div>
            <div class="tip-row"><span>低</span><span class="tip-val">${d.low.toFixed(2)}</span></div>
            <div class="tip-row"><span>收</span><span class="tip-val">${d.close.toFixed(2)}</span></div>
            <div class="tip-row"><span>量</span><span class="tip-val">${volume.toFixed(3)}</span></div>
            <div class="tip-chg" style="color:${chgColor}">${chg >= 0 ? "+" : ""}${chgPct.toFixed(2)}%</div>
          `;
          const rect = containerRef.current!.getBoundingClientRect();
          let left = param.point.x + 10;
          let top = param.point.y - 10;
          if (left + 100 > rect.width) left = param.point.x - 110;
          if (top < 0) top = 10;
          tooltip.style.left = left + "px";
          tooltip.style.top = top + "px";
          tooltip.style.display = "block";
        }
      }

      // MACD tooltip — show DIF/DEA/MACD + cross status at crosshair position
      if (macdTipEl && hasPoint) {
        const idx = macdDataRef.current.findIndex((d: any) => d.time === param.time);
        if (idx >= 0 && !isNaN(macdDataRef.current[idx].macd)) {
          const d = macdDataRef.current[idx];
          let crossHtml = "";
          if (idx > 0) {
            const prev = macdDataRef.current[idx - 1];
            if (!isNaN(prev.macd) && !isNaN(prev.signal)) {
              if (d.macd >= d.signal && prev.macd < prev.signal) crossHtml = '<span style="color:#26a69a"> ↑金叉</span>';
              else if (d.macd <= d.signal && prev.macd > prev.signal) crossHtml = '<span style="color:#ef5350"> ↓死叉</span>';
            }
          }
          const histColor = d.histogram >= 0 ? "#26a69a" : "#ef5350";
          macdTipEl.innerHTML = `
            <span style="color:#2962FF">DIF: ${d.macd.toFixed(2)}</span>
            <span style="color:#FF6D00">DEA: ${!isNaN(d.signal) ? d.signal.toFixed(2) : "--"}</span>
            <span style="color:${histColor}">MACD: ${d.histogram >= 0 ? "+" : ""}${d.histogram.toFixed(2)}</span>
            ${crossHtml}
          `;
          macdTipEl.style.display = "block";
        } else {
          macdTipEl.style.display = "none";
        }
      } else if (macdTipEl) {
        macdTipEl.style.display = "none";
      }
    });

    const observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
        macdPane.setHeight(120);
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
      macdMarkersRef.current = null;
      macdHistRef.current = null;
      macdLineRef.current = null;
      signalLineRef.current = null;
      tooltipRef.current = null;
      macdTooltipRef.current = null;
    };
  }, []);

  // Update candle data + markers
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs || !candles?.length) return;

    // Skip warmup candles so chart aligns with valid MACD data
    const warmup = Math.min(35, candles.length - 1);
    const dc = candles.slice(warmup);

    const mapped = dc.map((c) => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    cs.setData(mapped);

    vs.setData(
      dc.map((c) => ({
        time: c.time as any,
        value: c.volume,
        color: c.close >= c.open ? "#3fb95033" : "#f8514933",
      }))
    );

    // Update MACD data — computed from full set, display sliced to match chart
    let crossMarkers: any[] = [];
    const mh = macdHistRef.current;
    const ml = macdLineRef.current;
    const sl = signalLineRef.current;
    if (mh && ml && sl && candles.length >= 34) {
      const macdData = computeMACDData(candles).slice(warmup);
      macdDataRef.current = macdData;
      const valid = macdData.filter((d) => !isNaN(d.histogram));
      if (valid.length > 0) {
        mh.setData(
          valid.map((d) => ({
            time: d.time,
            value: Math.abs(d.histogram),
            color: d.histogram >= 0 ? "#26a69a80" : "#ef535080",
          }))
        );
        ml.setData(valid.map((d) => ({ time: d.time, value: d.macd })));
        sl.setData(valid.map((d) => ({ time: d.time, value: d.signal })));

        // Detect golden cross / death cross from MACD
        for (let i = 1; i < valid.length; i++) {
          const prev = valid[i - 1];
          const cur = valid[i];
          if (isNaN(prev.macd) || isNaN(prev.signal) || isNaN(cur.macd) || isNaN(cur.signal)) continue;
          if (cur.macd >= cur.signal && prev.macd < prev.signal)
            crossMarkers.push({ time: cur.time, position: "belowBar", shape: "arrowUp", color: "#26a69a", text: "金叉" });
          else if (cur.macd <= cur.signal && prev.macd > prev.signal)
            crossMarkers.push({ time: cur.time, position: "aboveBar", shape: "arrowDown", color: "#ef5350", text: "死叉" });
        }
      }
    }

    // Set trade markers on K-line
    const mp = markersRef.current;
    if (mp) {
      const candleTimes = new Set(mapped.map((m) => m.time));
      mp.setMarkers(tradeMarkers.filter((m) => candleTimes.has(m.time)));
    }

    // Set cross markers on MACD line
    if (crossMarkers.length > 0) {
      macdMarkersRef.current?.setMarkers(crossMarkers);
    }

    // Fit content once per timeframe when data first becomes available
    if (positionedRef.current !== activeBar) {
      chartRef.current?.timeScale().fitContent();
      positionedRef.current = activeBar;
    }
  }, [candles, tradeMarkers]);

  // Update current forming candle
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs || !curCandle) return;
    cs.update({
      time: curCandle.time as any,
      open: curCandle.open,
      high: curCandle.high,
      low: curCandle.low,
      close: curCandle.close,
    });
  }, [curCandle]);

  const handleBarChange = useCallback((bar: BarKey) => {
    setActiveBar(bar);
  }, []);

  return (
    <div className="price-chart-container">
      <div className="chart-header">
        <div className="chart-title">BTC-USDT {currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "--"}</div>
        <div className="chart-legend">
          {autoTrader && (
            <>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: "#58a6ff" }} />
                失衡: {autoTrader.imbalance.toFixed(2)}
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: "#d2991d" }} />
                RSI({5}): {autoTrader.rsi.toFixed(1)}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="chart-toolbar">
        <div className="bar-selector">
          {BARS.map((b) => (
            <button
              key={b}
              className={`bar-btn ${b === activeBar ? "active" : ""}`}
              onClick={() => handleBarChange(b)}
            >
              {b}
            </button>
          ))}
        </div>
        <label className="tooltip-toggle">
          <input type="checkbox" checked={showTooltip} onChange={() => setShowTooltip(v => !v)} />
          <span className="toggle-slider" />
          <span className="toggle-label">提示</span>
        </label>
      </div>
      <div ref={containerRef} className="chart-canvas" />
    </div>
  );
});
