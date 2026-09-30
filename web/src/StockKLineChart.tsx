import { useEffect, useMemo, useRef, useState } from "react";
import { init, use } from "echarts/core";
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { chartCandles, MA_PERIODS, type CandlePeriod, type StockHistory } from "../../src/shared/kline.js";
import "./stock-kline.css";
import StockSearch from "./StockSearch.js";

use([CandlestickChart, LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, CanvasRenderer]);

const maColors = ["#a46708", "#2765b0", "#8a4d9e", "#425b68"];
const rise = "#c83f31";
const fall = "#21846b";
const number = (value: number | null) => value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function StockKLineChart({ code }: { code: string }) {
  const [period, setPeriod] = useState<CandlePeriod>("day");
  const [data, setData] = useState<StockHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    if (!/^(000|001|002|600|601|603|605)\d{3}$/.test(code)) {
      setError("请输入六位沪深主板股票代码，例如 600519。");
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
    const staticMode = !base && !["localhost", "127.0.0.1", ""].includes(window.location.hostname);
    const url = staticMode ? `./data/history/${code}.json?refresh=${Date.now()}` : `${base}/api/stocks/${code}/history`;
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (staticMode && response.status === 404) throw new Error("该股票的历史行情尚未发布，请加入监控池并等待数据更新。");
        if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("K 线图需要连接行情服务，当前站点未提供该接口。");
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "历史行情加载失败");
        if (!Array.isArray(body.bars) || body.code !== code) throw new Error("行情数据格式不正确");
        if (!controller.signal.aborted) setData(body);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "历史行情加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [code, retry]);

  const bars = useMemo(() => chartCandles(data?.bars ?? [], period), [data, period]);
  const visible = bars.slice(-30);
  const warmupMissing = visible.some((bar) => bar.ma.includes(null));

  return <section className="table-section kline-panel" aria-label={`${code} K线图`}>
    <div className="kline-heading">
      <div><h2>{code} · {period === "day" ? "日 K 线" : "周 K 线"}</h2></div>
      <div className="kline-period" role="group" aria-label="K线周期">
        <button className="ghost" aria-pressed={period === "day"} onClick={() => setPeriod("day")}>日 K</button>
        <button className="ghost" aria-pressed={period === "week"} onClick={() => setPeriod("week")}>周 K</button>
      </div>
    </div>
    {loading && <div className="kline-loading" role="status" aria-busy="true">正在加载历史行情…</div>}
    {error && <div className="kline-error" role="alert">{error} <button className="ghost" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
    {!loading && !error && data?.code === code && (bars.length ? <>
      <KLinePlot key={`${code}:${period}`} bars={bars} period={period} />
      {warmupMissing && <p className="kline-note" role="status">部分均线历史不足，起始段留空；不足 30 根时展示全部有效 K 线。</p>}
      <details className="kline-table"><summary>查看最近 {visible.length} 根 K 线数据</summary>
        <div className="kline-table-scroll"><table><caption>{code} {period === "day" ? "日线" : "周线"}，价格：元，成交量：手</caption>
          <thead><tr>{["日期", "开", "高", "低", "收", "成交量", ...MA_PERIODS.map((value) => `MA${value}`)].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{visible.map((bar) => <tr key={bar.date}><th scope="row">{bar.date}</th>{[bar.open, bar.high, bar.low, bar.close, bar.volume, ...bar.ma].map((value, index) => <td key={index}>{number(value)}</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </> : <p className="empty" role="status">该股票暂无可用历史日线，请检查代码或稍后重试。</p>)}
  </section>;
}

function KLinePlot({ bars, period }: { bars: ReturnType<typeof chartCandles>; period: CandlePeriod }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof init> | null>(null);
  function zoom(factor: number) {
    const chart = chartRef.current;
    if (!chart || bars.length < 2) return;
    const current = (chart.getOption().dataZoom as { start: number; end: number }[])[0];
    const width = Math.min(100, Math.max(100 * Math.min(4, bars.length - 1) / (bars.length - 1), (current.end - current.start) * factor));
    const start = Math.max(0, Math.min(100 - width, (current.start + current.end - width) / 2));
    chart.dispatchAction({ type: "dataZoom", start, end: start + width });
  }
  useEffect(() => {
    if (!container.current) return;
    const chart = init(container.current);
    chartRef.current = chart;
    const dates = bars.map((bar) => bar.date);
    const option: EChartsOption = {
      animation: false,
      aria: { enabled: true, description: `${period === "day" ? "日" : "周"}K线、MA5、MA10、MA20、MA60与成交量。下方可展开数据表。` },
      legend: { top: 0, data: MA_PERIODS.map((value) => `MA${value}`), selectedMode: false },
      tooltip: {
        trigger: "axis", confine: true, axisPointer: { type: "cross" },
        formatter: (params) => {
          const item = Array.isArray(params) ? params[0] : params;
          const bar = bars[item.dataIndex];
          if (!bar) return "";
          return `${bar.date}<br/>开 ${number(bar.open)}　高 ${number(bar.high)}<br/>低 ${number(bar.low)}　收 ${number(bar.close)}<br/>成交量 ${number(bar.volume)} 手<br/>${MA_PERIODS.map((window, index) => `MA${window} ${number(bar.ma[index])}`).join("<br/>")}`;
        }
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [{ left: 65, right: 20, top: 72, height: "44%" }, { left: 65, right: 20, top: "71%", height: "16%" }],
      xAxis: [0, 1].map((gridIndex) => ({ type: "category", gridIndex, data: dates, boundaryGap: true,
        axisLine: { onZero: false, lineStyle: { color: "#9aa7b5" } }, axisLabel: { show: gridIndex === 1, color: "#52606f", hideOverlap: true } })),
      yAxis: [{ scale: true, name: "价格 / 元", splitLine: { lineStyle: { color: "#edf0f4" } }, axisLabel: { formatter: (value: number) => number(value) } },
        { gridIndex: 1, name: "成交量 / 手", min: 0, splitNumber: 2, splitLine: { show: false }, axisLabel: { formatter: (value: number) => value >= 10000 ? `${number(value / 10000)}万` : number(value) } }],
      dataZoom: [
        { type: "inside", zoomOnMouseWheel: false, moveOnMouseWheel: false, preventDefaultMouseMove: false, xAxisIndex: [0, 1], startValue: Math.max(0, bars.length - 30), endValue: bars.length - 1, minValueSpan: 4 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 0, height: 22, showDataShadow: false, brushSelect: false }
      ],
      series: [
        { name: "K线", type: "candlestick", data: bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]), itemStyle: { color: rise, color0: fall, borderColor: rise, borderColor0: fall } },
        ...MA_PERIODS.map((window, index) => ({ name: `MA${window}`, type: "line" as const, data: bars.map((bar) => bar.ma[index]), showSymbol: false, connectNulls: false, lineStyle: { width: 1.5, color: maColors[index] }, itemStyle: { color: maColors[index] } })),
        { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: bars.map((bar) => ({ value: bar.volume, itemStyle: { color: bar.close >= bar.open ? rise : fall } })) }
      ]
    };
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); chartRef.current = null; };
  }, [bars, period]);
  return <>
    <div className="kline-period" role="group" aria-label="K线缩放">
      <button className="ghost" onClick={() => zoom(0.7)}>放大</button>
      <button className="ghost" onClick={() => zoom(1 / 0.7)}>缩小</button>
    </div>
    <div ref={container} className="kline-canvas" />
  </>;
}

export default function StockChartPanel() {
  const [input, setInput] = useState("600519");
  const [code, setCode] = useState("600519");
  return <div className="kline-workspace">
    <form className="kline-search" onSubmit={(event) => { event.preventDefault(); if (input) setCode(input); }}>
      <StockSearch initialCode="600519" onSelect={(stock) => setInput(stock?.code ?? "")} />
      <button className="primary" type="submit" disabled={!input}>查看 K 线</button>
    </form>
    <StockKLineChart code={code} />
  </div>;
}
