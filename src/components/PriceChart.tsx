import { useEffect, useRef, memo } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries } from "lightweight-charts";
import type { CandlePoint, AutoTraderState } from "../types";

interface Props {
  candles: CandlePoint[] | undefined;
  currentCandle: CandlePoint | null | undefined;
  autoTrader: AutoTraderState | undefined;
  currentPrice: number;
}

export const PriceChart = memo(function PriceChart({ candles, currentCandle, autoTrader, currentPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

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
      },
      rightPriceScale: { borderColor: "#30363d" },
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

    chartRef.current = chart;
    candleSeriesRef.current = cs;
    volumeSeriesRef.current = vs;

    const observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Update candle data
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs || !candles?.length) return;

    cs.setData(
      candles.map((c) => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    vs.setData(
      candles.map((c) => ({
        time: c.time as any,
        value: c.volume,
        color: c.close >= c.open ? "#3fb95033" : "#f8514933",
      }))
    );
  }, [candles]);

  // Update current forming candle
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs || !currentCandle) return;
    cs.update({
      time: currentCandle.time as any,
      open: currentCandle.open,
      high: currentCandle.high,
      low: currentCandle.low,
      close: currentCandle.close,
    });
  }, [currentCandle]);

  // Fit content when candle count changes
  useEffect(() => {
    if (!chartRef.current || !candles?.length) return;
    chartRef.current.timeScale().fitContent();
  }, [candles?.length]);

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
      <div ref={containerRef} className="chart-canvas" />
    </div>
  );
});
