import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BellRing, CandlestickChart, ChevronDown, Clock3, FileText, Layers3, Plus, RefreshCw, Search, Sun } from "lucide-react";
import "./styles.css";
import StockSearch from "./StockSearch.js";
import { StockChartProvider, StockLink, StockText } from "./StockChartDialog.js";

const INTRADAY_STRATEGY_NAME = "沿五日线阴线回调策略";
const StockKLineChart = React.lazy(() => import("./StockKLineChart.js").then((module) => ({ default: module.StockKLineChart })));
const StockChartPanel = React.lazy(() => import("./StockKLineChart.js"));

type Recommendation = {
  rank: number;
  code: string;
  name: string;
  market: string;
  score: number;
  confidence: number;
  reasons: string[];
  risks: string[];
  factors: Record<string, number>;
};

type LimitUp = {
  code: string;
  name: string;
  consecutive: number;
  openCount: number;
  sealedAmount: number;
  industry?: string;
  strengthScore: number;
};

type Sector = {
  name: string;
  type: string;
  pctChange: number;
  netInflow: number;
  limitUpCount: number;
  leaderCode?: string;
  leaderName?: string;
  leaderPctChange: number;
  heatScore: number;
};

type WatchItem = {
  id: string;
  code: string;
  name: string;
  thesis: string;
  conditionPrompt: string;
  isActive: boolean;
};

type DataStatus = {
  source?: string;
  warnings: string[];
  tradeDate?: string;
  dataAsOf?: string;
};

type ReportArtifact = {
  id: string;
  kind: "morning" | "intraday-selection" | "close";
  tradeDate: string;
  dataAsOf: string;
  provider: string;
  warnings: string[];
  payload: any;
  analysis: string;
  rankingNarrative?: string;
  pushMessage: string;
};

const api = {
  async get<T>(url: string): Promise<T> {
    if (isStaticMode() && url === "/api/watchlist") {
      const response = await fetch(`./data/watchlist/monitor-pool.json?refresh=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("GitHub 监控池读取失败，请稍后刷新");
      const pool = await response.json();
      return { items: pool.items.filter((item: WatchItem) => item.isActive).map((item: WatchItem) => ({ ...item, id: item.code })) } as T;
    }
    const response = await fetch(`${apiUrl(url)}${isStaticMode() ? `?refresh=${Date.now()}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  },
  async post<T>(url: string, body: unknown): Promise<T> {
    if (isStaticMode() && url === "/api/watchlist") {
      throw new Error("请通过 GitHub 修改监控池并提交保存");
    }
    if (isStaticMode()) {
      throw new Error("静态模式下不能执行写入操作；盘后数据由 GitHub Actions 自动生成。");
    }
    const response = await fetch(apiUrl(url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  }
};

function apiUrl(path: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
  if (isStaticMode()) return staticDataUrl(path);
  return `${baseUrl}${path}`;
}

function isStaticMode() {
  const hasApiBase = Boolean(import.meta.env.VITE_API_BASE_URL);
  const isLocalhost = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  return !hasApiBase && !isLocalhost;
}

function staticDataUrl(path: string) {
  if (path === "/api/recommendations/latest") return "./data/recommendations/latest.json";
  if (path === "/api/limit-up/ladder") return "./data/limit-up/ladder.json";
  if (path === "/api/sectors/ladder") return "./data/sectors/ladder.json";
  if (path === "/api/reports/morning/latest") return "./data/reports/morning/latest.json";
  if (path === "/api/reports/intraday-selection/latest") return "./data/reports/intraday-selection/latest.json";
  if (path === "/api/reports/close/latest") return "./data/reports/close/latest.json";
  if (path.startsWith("/api/stocks/") && path.endsWith("/analysis")) {
    const code = path.replace("/api/stocks/", "").replace("/analysis", "");
    return `./data/stocks/${code}.json`;
  }
  return path;
}

function readStoredWatchlist(): WatchItem[] {
  try {
    return JSON.parse(localStorage.getItem("trade-system-watchlist") ?? "[]") as WatchItem[];
  } catch {
    return [];
  }
}

async function loadReports(): Promise<Partial<Record<ReportArtifact["kind"], ReportArtifact>>> {
  const entries = await Promise.all(
    (["morning", "intraday-selection", "close"] as const).map(async (kind) => {
      try {
        const report = await api.get<ReportArtifact>(`/api/reports/${kind}/latest`);
        return [kind, report] as const;
      } catch {
        return [kind, undefined] as const;
      }
    })
  );
  return Object.fromEntries(entries.filter(([, report]) => Boolean(report))) as Partial<Record<ReportArtifact["kind"], ReportArtifact>>;
}

function App() {
  const [tab, setTab] = useState("intradayMa5");
  const [limitUps, setLimitUps] = useState<LimitUp[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [reports, setReports] = useState<Partial<Record<ReportArtifact["kind"], ReportArtifact>>>({});
  const [analysisCode, setAnalysisCode] = useState("603000");
  const [analysis, setAnalysis] = useState<any>(null);
  const [watchForm, setWatchForm] = useState({ code: "603000", name: "人民网", thesis: "", conditionPrompt: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dataStatus, setDataStatus] = useState<DataStatus>({ warnings: [] });


  async function refreshDashboard() {
    setBusy(true);
    try {
      const [latest, ladder, sectorLadder, watch] = await Promise.all([
        api.get<{ recommendations: Recommendation[]; source?: string; tradeDate?: string; dataAsOf?: string; warnings?: string[] }>("/api/recommendations/latest"),
        api.get<{ items: LimitUp[] }>("/api/limit-up/ladder"),
        api.get<{ items: Sector[] }>("/api/sectors/ladder"),
        api.get<{ items: WatchItem[] }>("/api/watchlist")
      ]);
      setLimitUps(ladder.items ?? []);
      setSectors(sectorLadder.items ?? []);
      setWatchlist(watch.items ?? []);
      const loadedReports = await loadReports();
      setReports(loadedReports);
      setDataStatus({ source: latest.source, tradeDate: latest.tradeDate, dataAsOf: latest.dataAsOf, warnings: latest.warnings ?? [] });
      setMessage(isStaticMode() ? "静态盘后数据已刷新" : "数据已刷新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function runPostClose() {
    if (isStaticMode()) {
      setMessage("静态模式下盘后落库由 GitHub Actions 自动执行；也可以在 GitHub Actions 页面手动运行 workflow。");
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<DataStatus>("/api/jobs/post-close-ingest", {});
      await refreshDashboard();
      setDataStatus(result);
      setMessage(result.warnings?.length ? `盘后数据已落库，但有告警：${result.warnings.join("；")}` : "盘后数据已落库并生成推荐");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "盘后任务失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadAnalysis() {
    setBusy(true);
    try {
      const result = await api.get<any>(`/api/stocks/${analysisCode}/analysis`);
      setAnalysis(result);
      setMessage("个股分析已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "个股分析失败");
    } finally {
      setBusy(false);
    }
  }

  async function addWatchItem() {
    setBusy(true);
    try {
      const { item } = await api.post<{ item: WatchItem }>("/api/watchlist", { ...watchForm, market: watchForm.code.startsWith("300") ? "gem" : "main", markets: ["main", "gem"] });
      setWatchlist((items) => [item, ...items]);
      setMessage(isStaticMode() ? "已保存到本机浏览器监控池；自动触发需要后端或 GitHub Actions 支持。" : "已加入监控池");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入监控池失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshDashboard();
  }, []);

  const visiblePanel = useMemo(() => {
    if (tab === "kline") return <React.Suspense fallback={<p role="status">正在加载 K 线组件…</p>}><StockChartPanel /></React.Suspense>;
    if (tab === "morning") return <ReportPanel title="9:00 晨报" report={reports.morning} />;
    if (tab === "intradayMa5") return <IntradayStrategyPage report={reports["intraday-selection"]} />;
    if (tab === "closeReport") return <CloseReportPanel report={reports.close} />;
    if (tab === "ladder") return <LadderPanel limitUps={limitUps} sectors={sectors} />;
    if (tab === "stock") return <StockPanel analysisCode={analysisCode} setAnalysisCode={setAnalysisCode} loadAnalysis={loadAnalysis} analysis={analysis} />;
    if (tab === "watch") return <WatchPanel busy={busy} watchlist={watchlist} watchForm={watchForm} setWatchForm={setWatchForm} addWatchItem={addWatchItem} />;
    return null;
  }, [tab, limitUps, sectors, analysisCode, analysis, watchlist, watchForm, reports, busy]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <CandlestickChart size={24} />
          <div>
            <strong>A股智能研究台</strong>
            <span>手动交易辅助</span>
          </div>
        </div>
        <nav>
          <TabButton active={tab === "morning"} icon={<Sun size={18} />} label="9点晨报" onClick={() => setTab("morning")} />
          <details className="nav-group" open>
            <summary className={tab === "intradayMa5" ? "tab active" : "tab"}>
              <Clock3 size={18} />
              <span>14:50选股</span>
              <ChevronDown className="nav-chevron" size={16} />
            </summary>
            <div className="nav-submenu" aria-label="14:50选股策略">
              <TabButton active={tab === "intradayMa5"} label={INTRADAY_STRATEGY_NAME} onClick={() => setTab("intradayMa5")} />
            </div>
          </details>
          <TabButton active={tab === "closeReport"} icon={<FileText size={18} />} label="16点复盘" onClick={() => setTab("closeReport")} />
          <TabButton active={tab === "ladder"} icon={<Layers3 size={18} />} label="天梯" onClick={() => setTab("ladder")} />
          <TabButton active={tab === "stock"} icon={<Search size={18} />} label="个股分析" onClick={() => setTab("stock")} />
          <TabButton active={tab === "kline"} icon={<CandlestickChart size={18} />} label="K 线图" onClick={() => setTab("kline")} />
          <TabButton active={tab === "watch"} icon={<BellRing size={18} />} label="监控池" onClick={() => setTab("watch")} />
        </nav>
        <button className="primary wide" onClick={runPostClose} disabled={busy}>
          <RefreshCw size={16} />
          盘后落库
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>A股策略研究台</h1>
            <p>数据分析辅助，不自动交易，不保证收益。</p>
          </div>
          <div className="status">
            {tab === "closeReport" ? <div className="source-badge"><strong>{reports.close?.provider ?? "复盘未生成"}</strong><span>{reports.close?.tradeDate ?? ""}</span></div> : tab === "intradayMa5" ? <div className="source-badge"><strong>{reports["intraday-selection"]?.payload?.runStatus === "failed" ? "选股任务失败" : reports["intraday-selection"] ? "选股报告" : "选股报告未生成"}</strong><span>{reports["intraday-selection"]?.tradeDate ?? ""}</span></div> : <SourceBadge status={dataStatus} />}
            <button className="ghost" onClick={refreshDashboard} disabled={busy}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </header>

        {message && <div className="message">{message}</div>}
        {tab !== "intradayMa5" && tab !== "closeReport" && dataStatus.warnings.length > 0 && <div className="warning-strip">{dataStatus.warnings.join("；")}</div>}
        {visiblePanel}
      </section>
    </main>
  );
}

function SourceBadge({ status }: { status: DataStatus }) {
  const label = status.source === "sample" ? "样例数据" : status.source === "akshare" ? "AKShare真实数据" : status.source === "akshare_partial" ? "AKShare部分数据" : status.source === "efinance" ? "efinance数据" : status.source === "baostock" ? "BaoStock数据" : "数据源待确认";
  return (
    <div className={status.source === "sample" ? "source-badge sample" : "source-badge"}>
      <strong>{label}</strong>
      {status.tradeDate && <span>{status.tradeDate}</span>}
    </div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon?: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "tab active" : "tab"} aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function ReportPanel({ title, report }: { title: string; report?: ReportArtifact }) {
  if (!report) return <div className="empty">暂无{title}数据。{title.includes("晨报") && "晨报在 A 股交易日 9:00 生成；数据源全部失败时不会生成空报告。"}</div>;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date()).replaceAll("-", "");
  const morningGroups = report.kind === "morning" ? [
    ["美股指数", "indices"], ["国际期货", "futures"], ["美股板块", "sectors"],
    ["汇率", "currencies"], ["国际商品", "commodities"], ["国内期货与商品指数", "domesticFutures"]
  ] : [];
  return (
    <div className="report-layout">
      <section className="table-section">
        <div className="section-title">
          <FileText size={18} />
          <h2>{title}</h2>
        </div>
        <div className="report-meta">
          <span>{report.tradeDate}</span>
          <span>{report.provider}</span>
          <span>{new Date(report.dataAsOf).toLocaleString()}</span>
        </div>
        {report.kind === "morning" && report.tradeDate !== today && <p role="status">当前展示 {report.tradeDate} 的历史晨报，并非今日数据；非交易日不生成晨报。</p>}
        <p className="report-text"><StockText>{report.analysis}</StockText></p>
        {morningGroups.map(([label, key]) => <section key={key}>
          <h3>{label}</h3>
          {report.payload?.brief?.[key]?.length ? <div className="table-wrap"><table>
            <thead><tr><th>标的</th><th>收盘价</th><th>涨跌幅</th><th>数据日期</th><th>来源</th></tr></thead>
            <tbody>{report.payload.brief[key].map((item: { symbol: string; name: string; close?: number; price?: number; pctChange: number; date?: string; source?: string }) =>
              <tr key={item.symbol}><td>{item.name}</td><td>{item.close ?? item.price ?? "—"}</td><td>{item.pctChange.toFixed(2)}%</td><td>{item.date ?? "未知"}</td><td>{item.source ?? report.provider}</td></tr>
            )}</tbody>
          </table></div> : <p>暂无有效数据</p>}
        </section>)}
        {report.kind !== "morning" && <p className="report-push"><StockText>{report.pushMessage}</StockText></p>}
      </section>
      <section className="table-section">
        <div className="section-title">
          <Activity size={18} />
          <h2>关键线索</h2>
        </div>
        <div className="metric-grid">
          {(report.payload?.aShareReadThrough ?? []).map((item: string, index: number) => <p key={index}><StockText>{item}</StockText></p>)}
          {report.warnings.map((item, index) => <p key={`warning-${index}`}>{item}</p>)}
        </div>
      </section>
    </div>
  );
}

const MA5_RULES = [
  ["股票范围", "主板、非 ST、非停牌，排除上市不足 20 天"],
  ["价格与成交额", "股价 > 5 元；近 5 日日均成交额 > 3000 万；当天成交额 ≥ 3000 万"],
  ["均线趋势", "MA5 连续 3 日上行，且 MA5 > MA10 > MA20"],
  ["前期走势", "今天之前的 5 个完整交易日，收盘价均站在各自 MA5 上方"],
  ["今日形态", "采样时最新价低于开盘价，呈阴线；但仍在 MA5 上方，距离 0%～2%"],
  ["回踩幅度", "今日最低价相对 MA5 在 −0.8%～+1.5%，允许短暂跌破后收回"],
  ["今日涨跌幅", "−2%～+2.5%"],
  ["波动限制", "近 5 日区间振幅 ≤ 15%，近 20 日 ≤ 35%"],
  ["量能与形态", "量比 0.7～1.8；上影线比例 ≤ 3.5%，阴线实体跌幅不超过 3%"]
];

function IntradayStrategyPage({ report }: { report?: ReportArtifact }) {
  return <div className="strategy-page">
    <section className="table-section" aria-labelledby="strategy-rules-title">
      <div className="section-title">
        <Clock3 size={18} />
        <h2 id="strategy-rules-title">{INTRADAY_STRATEGY_NAME}</h2>
      </div>
      <table className="strategy-rules">
        <caption>筛选条件（需同时满足）</caption>
        <thead><tr><th scope="col">条件</th><th scope="col">当前规则</th></tr></thead>
        <tbody>{MA5_RULES.map(([condition, rule]) => <tr key={condition}><th scope="row">{condition}</th><td>{rule}</td></tr>)}</tbody>
      </table>
    </section>
    <IntradayReportPanel report={report} />
  </div>;
}

function IntradayReportPanel({ report }: { report?: ReportArtifact }) {
  if (!report) return <div className="empty">暂无「{INTRADAY_STRATEGY_NAME}」的 14:50 选股报告。</div>;
  if (report.payload?.runStatus === "failed") return <div className="empty">{report.tradeDate} · {report.analysis}</div>;
  if (!report.payload?.strategy?.compiledDsl?.strategyTemplates?.includes("ma5_pullback")) {
    return <div className="empty">当前最新报告属于其他策略，尚无「{INTRADAY_STRATEGY_NAME}」报告。</div>;
  }
  return (
    <div className="panel-grid">
      <section className="workbench">
        <div className="section-title">
          <Clock3 size={18} />
          <h2>选股报告与摘要 · {report.tradeDate}</h2>
        </div>
        <p className="report-text"><StockText>{report.analysis}</StockText></p>
        {report.rankingNarrative && <p className="report-push"><StockText>{report.rankingNarrative}</StockText></p>}
        <p>实际采样：{new Date(report.dataAsOf).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
        <InfoBlock title="数据说明" items={report.warnings ?? []} />
        <InfoBlock title="策略" items={[report.payload?.strategy?.prompt ?? "默认策略"]} />
      </section>
      <section className="table-section span-2">
        <RankingTable items={report.payload?.recommendations ?? []} />
      </section>
    </div>
  );
}

function CloseReportPanel({ report }: { report?: ReportArtifact }) {
  if (!report) return <div className="empty">暂无16:00收盘复盘。</div>;
  const breadth = report.payload?.marketBreadth;
  const industries: Array<{ name: string; pctChange: number }> | undefined = report.payload?.industryPerformance;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  return (
    <div className="report-layout">
      <section className="table-section">
        <div className="section-title">
          <FileText size={18} />
          <h2>收盘复盘 · {report.tradeDate}</h2>
        </div>
        <p className="report-text"><StockText>{report.analysis}</StockText></p>
        <p>行情时间：{new Date(report.dataAsOf).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
        {report.tradeDate !== today && <p role="status">当前为 {report.tradeDate} 的历史复盘，并非今日数据。</p>}
        <InfoBlock title="统计口径与数据说明" items={report.warnings ?? []} />
        {breadth && (
          <div className="summary-grid">
            <Metric label="上涨" value={breadth.up} />
            <Metric label="下跌" value={breadth.down} />
            <Metric label="涨停" value={breadth.limitUp ?? "—"} />
            <Metric label="成交额" value={formatYi(breadth.turnoverAmount)} />
          </div>
        )}
      </section>
      <section className="table-section">
        <div className="section-title">
          <Layers3 size={18} />
          <h2>{industries ? "行业指数涨幅前排" : "板块前排"}</h2>
        </div>
        <InfoBlock title={industries ? "按指数涨跌幅排序" : "板块"} items={industries ? industries.slice(0, 8).map(item => `${item.name} ${item.pctChange > 0 ? "+" : ""}${item.pctChange.toFixed(2)}%`) : (report.payload?.sectors ?? []).slice(0, 8).map((item: Sector) => `${item.name} 热度 ${Math.round(item.heatScore)}，涨停 ${item.limitUpCount}`)} />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LadderPanel({ limitUps, sectors }: { limitUps: LimitUp[]; sectors: Sector[] }) {
  return (
    <div className="panel-grid two">
      <section className="table-section">
        <div className="section-title">
          <CandlestickChart size={18} />
          <h2>涨停天梯</h2>
        </div>
        <table>
          <thead>
            <tr><th>股票</th><th>连板</th><th>强度</th><th>封单</th></tr>
          </thead>
          <tbody>
            {limitUps.map((item) => (
              <tr key={item.code}>
                <td><StockLink code={item.code} name={item.name}><strong>{item.name}</strong><span>{item.code}</span></StockLink><span>{item.industry}</span></td>
                <td>{item.consecutive}</td>
                <td>{Math.round(item.strengthScore)}</td>
                <td>{formatYi(item.sealedAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="table-section">
        <div className="section-title">
          <Layers3 size={18} />
          <h2>板块天梯</h2>
        </div>
        <table>
          <thead>
            <tr><th>板块</th><th>热度</th><th>净流入</th><th>涨停</th></tr>
          </thead>
          <tbody>
            {sectors.map((item) => (
              <tr key={`${item.type}-${item.name}`}>
                <td><strong>{item.name}</strong><span>{item.type === "industry" ? "行业" : "概念"} 领涨 <StockLink code={item.leaderCode ?? ""} name={item.leaderName ?? "-"} /></span></td>
                <td><HeatBar value={item.heatScore} /></td>
                <td>{formatYi(item.netInflow)}</td>
                <td>{item.limitUpCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StockPanel({ analysisCode, setAnalysisCode, loadAnalysis, analysis }: any) {
  const score = analysis?.score;
  return (
    <div className="panel-grid">
      <section className="workbench">
        <div className="section-title">
          <Search size={18} />
          <h2>个股分析</h2>
        </div>
        <div className="inline-form">
          <StockSearch initialCode={analysisCode} onSelect={(stock) => setAnalysisCode(stock?.code ?? "")} />
          <button className="primary" disabled={!analysisCode} onClick={loadAnalysis}>分析</button>
        </div>
        {score && (
          <div className="score-box">
            <strong><StockLink code={score.code} name={score.name} /> {score.score}</strong>
            <span>置信度 {score.confidence}%</span>
          </div>
        )}
      </section>
      <section className="table-section span-2">
        {analysis ? (
          <div className="analysis-grid">
            <InfoBlock title="推荐理由" items={score?.reasons ?? ["暂无推荐理由"]} />
            <InfoBlock title="风险提示" items={score?.risks?.length ? score.risks : ["未发现显著模型风险"]} />
            <InfoBlock title="相关板块" items={(analysis.relatedSectors ?? []).map((item: any) => `${item.name} 热度 ${item.heatScore}`)} />
            <InfoBlock title="龙虎榜" items={(analysis.dragonTiger ?? []).map((item: any) => `${item.tradeDate} 净买入 ${formatYi(item.netAmount)}`)} />
          </div>
        ) : (
          <div className="empty">输入股票代码或公司名称查看分析。</div>
        )}
      </section>
    </div>
  );
}

function WatchPanel({ busy, watchlist, watchForm, setWatchForm, addWatchItem }: any) {
  return (
    <div className="watch-page">
      <section className="workbench">
        <div className="section-title">
          <BellRing size={18} />
          <h2>加入监控池</h2>
        </div>
        {isStaticMode() ? <>
          <p>监控池保存在公开 GitHub 仓库，列表公开可见，所有设备共用。点击下方链接，登录 GitHub 后编辑 items 列表并提交到 dev，发布完成后刷新此页。</p>
          <a href="https://github.com/merrier/trade-system/edit/dev/data/watchlist/monitor-pool.json" target="_blank" rel="noreferrer">在 GitHub 管理监控池</a>
          {readStoredWatchlist().length > 0 && <details><summary>此浏览器还有旧监控数据（未删除，请合并到 GitHub）</summary><pre>{JSON.stringify(readStoredWatchlist(), null, 2)}</pre></details>}
        </> : <>
        <StockSearch initialCode={watchForm.code} onSelect={(stock) => setWatchForm({ ...watchForm, code: stock?.code ?? "", name: stock?.name ?? "" })} />
        <button className="primary" disabled={busy || !watchForm.code || !watchForm.name} onClick={addWatchItem}>
          <Plus size={16} />
          加入监控
        </button>
        </>}
      </section>
      {watchlist.length ? watchlist.map((item: WatchItem) => <article key={item.id} className="watch-stock" aria-label={`${item.name}监控图表`}>
        <h2>{item.name} · {item.code}</h2>
        <React.Suspense fallback={<p role="status">正在加载 K 线组件…</p>}>
          <StockKLineChart code={item.code} />
        </React.Suspense>
      </article>) : <p className="empty">暂无监控股票，添加后将在这里展示 K 线与成交量。</p>}
    </div>
  );
}

function RankingTable({ items }: { items: Recommendation[] }) {
  return (
    <table>
      <thead>
        <tr><th>排名</th><th>股票</th><th>得分</th><th>置信度</th><th>理由</th><th>风险</th></tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.rank}-${item.code}`}>
            <td>{item.rank}</td>
            <td><StockLink code={item.code} name={item.name}><strong>{item.name}</strong><span>{item.code}</span></StockLink><span>{item.market}</span></td>
            <td><HeatBar value={item.score} /></td>
            <td>{item.confidence}%</td>
            <td>{item.reasons.slice(0, 2).join("；")}</td>
            <td>{item.risks.slice(0, 2).join("；") || "无显著风险"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InfoBlock({ title, items }: { title: string; items: React.ReactNode[] }) {
  return (
    <div className="info-block">
      <h3>{title}</h3>
      {items.length ? items.map((item, index) => <p key={`${title}-${index}`}>{typeof item === "string" ? <StockText>{item}</StockText> : item}</p>) : <p>暂无数据</p>}
    </div>
  );
}

function HeatBar({ value }: { value: number }) {
  return (
    <div className="heat">
      <span style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      <b>{Math.round(value)}</b>
    </div>
  );
}

function formatYi(value: number) {
  return `${Math.round((value / 100000000) * 100) / 100}亿`;
}

createRoot(document.getElementById("root")!).render(<StockChartProvider><App /></StockChartProvider>);
