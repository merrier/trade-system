import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const Chart = React.lazy(() => import("./StockKLineChart.js").then((module) => ({ default: module.StockKLineChart })));
type Stock = { code: string; name?: string };
const OpenStockChart = createContext<(stock: Stock) => void>(() => {});

export function StockChartProvider({ children }: { children: React.ReactNode }) {
  const [stock, setStock] = useState<Stock | null>(null);
  return <OpenStockChart.Provider value={setStock}>
    {children}
    {stock && <StockChartDialog stock={stock} onClose={() => setStock(null)} />}
  </OpenStockChart.Provider>;
}

function StockChartDialog({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialog} className="stock-chart-dialog" aria-labelledby="stock-chart-title" onCancel={onClose} onClose={onClose}>
    <div className="stock-chart-dialog-header">
      <h2 id="stock-chart-title">{stock.name || stock.code} · K 线图</h2>
      <button type="button" className="ghost" onClick={onClose} aria-label="关闭 K 线弹窗">关闭</button>
    </div>
    <React.Suspense fallback={<p role="status">正在加载 K 线组件…</p>}>
      <Chart key={stock.code} code={stock.code} />
    </React.Suspense>
  </dialog>;
}

export function StockLink({ code, name, children }: Stock & { children?: React.ReactNode }) {
  const open = useContext(OpenStockChart);
  if (!code || !/^\d{6}$/.test(code)) return <>{children ?? name ?? code}</>;
  return <button type="button" className="stock-link" aria-haspopup="dialog" aria-label={`查看 ${name || code} ${name ? code : ""} K 线`} onClick={() => open({ code, name })}>
    {children ?? name ?? code}
  </button>;
}

export function StockText({ children }: { children: string }) {
  return <>{children.split(/(?<!\d)((?:000|001|002|300|301|600|601|603|605|688)\d{3})(?!\d)/g).map((part, index) =>
    index % 2 ? <StockLink key={index} code={part} /> : part)}</>;
}
