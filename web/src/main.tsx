import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BellRing, CandlestickChart, Layers3, Play, Plus, RefreshCw, Search, ShieldAlert, Star } from "lucide-react";
import "./styles.css";

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

const api = {
  async get<T>(url: string): Promise<T> {
    const response = await fetch(apiUrl(url));
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  },
  async post<T>(url: string, body: unknown): Promise<T> {
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
  return `${baseUrl}${path}`;
}

function App() {
  const [tab, setTab] = useState("recommend");
  const [prompt, setPrompt] = useState("主板里找连板强、龙虎榜净买入高、所属板块热度靠前、炸板少的短线票");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [limitUps, setLimitUps] = useState<LimitUp[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [analysisCode, setAnalysisCode] = useState("603000");
  const [analysis, setAnalysis] = useState<any>(null);
  const [watchForm, setWatchForm] = useState({ code: "603000", name: "人民网", thesis: "主观看好 AI 应用主线", conditionPrompt: "所属概念进入前三且个股放量突破5日线" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dataStatus, setDataStatus] = useState<DataStatus>({ warnings: [] });

  const topRecommendation = recommendations[0];

  async function refreshDashboard() {
    setBusy(true);
    try {
      const [latest, ladder, sectorLadder, watch, triggerData] = await Promise.all([
        api.get<{ recommendations: Recommendation[]; source?: string; tradeDate?: string; dataAsOf?: string }>("/api/recommendations/latest"),
        api.get<{ items: LimitUp[] }>("/api/limit-up/ladder"),
        api.get<{ items: Sector[] }>("/api/sectors/ladder"),
        api.get<{ items: WatchItem[] }>("/api/watchlist"),
        api.get<{ triggers: any[] }>("/api/watchlist/triggers")
      ]);
      setRecommendations(latest.recommendations ?? []);
      setLimitUps(ladder.items ?? []);
      setSectors(sectorLadder.items ?? []);
      setWatchlist(watch.items ?? []);
      setTriggers(triggerData.triggers ?? []);
      setDataStatus({ source: latest.source, tradeDate: latest.tradeDate, dataAsOf: latest.dataAsOf, warnings: [] });
      setMessage("数据已刷新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function runPostClose() {
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

  async function runRecommendation() {
    setBusy(true);
    try {
      const result = await api.post<{ results: Recommendation[]; source?: string; warnings?: string[]; dataAsOf?: string }>("/api/recommendations/run", {
        prompt,
        mode: "intraday",
        markets: ["main"]
      });
      setRecommendations(result.results);
      setDataStatus({ source: result.source, warnings: result.warnings ?? [], dataAsOf: result.dataAsOf });
      setMessage(result.warnings?.length ? `盘中参考推荐已生成，但有告警：${result.warnings.join("；")}` : "盘中参考推荐已生成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "推荐失败");
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
      await api.post("/api/watchlist", { ...watchForm, market: watchForm.code.startsWith("300") ? "gem" : "main", markets: ["main", "gem"] });
      await refreshDashboard();
      setMessage("已加入监控池");
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
    if (tab === "ladder") return <LadderPanel limitUps={limitUps} sectors={sectors} />;
    if (tab === "stock") return <StockPanel analysisCode={analysisCode} setAnalysisCode={setAnalysisCode} loadAnalysis={loadAnalysis} analysis={analysis} />;
    if (tab === "watch") return <WatchPanel watchlist={watchlist} triggers={triggers} watchForm={watchForm} setWatchForm={setWatchForm} addWatchItem={addWatchItem} />;
    return <RecommendationPanel prompt={prompt} setPrompt={setPrompt} runRecommendation={runRecommendation} recommendations={recommendations} />;
  }, [tab, prompt, recommendations, limitUps, sectors, analysisCode, analysis, watchlist, triggers, watchForm]);

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
          <TabButton active={tab === "recommend"} icon={<Star size={18} />} label="推荐榜" onClick={() => setTab("recommend")} />
          <TabButton active={tab === "ladder"} icon={<Layers3 size={18} />} label="天梯" onClick={() => setTab("ladder")} />
          <TabButton active={tab === "stock"} icon={<Search size={18} />} label="个股分析" onClick={() => setTab("stock")} />
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
            <h1>盘后复盘与盘中参考推荐</h1>
            <p>数据分析辅助，不自动交易，不保证收益。</p>
          </div>
          <div className="status">
            <SourceBadge status={dataStatus} />
            {topRecommendation ? <strong>Top 1：{topRecommendation.name} {topRecommendation.score}</strong> : <strong>暂无推荐</strong>}
            <button className="ghost" onClick={refreshDashboard} disabled={busy}>
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </header>

        {message && <div className="message">{message}</div>}
        {dataStatus.warnings.length > 0 && <div className="warning-strip">{dataStatus.warnings.join("；")}</div>}
        {visiblePanel}
      </section>
    </main>
  );
}

function SourceBadge({ status }: { status: DataStatus }) {
  const label = status.source === "sample" ? "样例数据" : status.source === "akshare" ? "AKShare真实数据" : status.source === "akshare_partial" ? "AKShare部分数据" : "数据源待确认";
  return (
    <div className={status.source === "sample" ? "source-badge sample" : "source-badge"}>
      <strong>{label}</strong>
      {status.tradeDate && <span>{status.tradeDate}</span>}
    </div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "tab active" : "tab"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function RecommendationPanel({ prompt, setPrompt, runRecommendation, recommendations }: any) {
  return (
    <div className="panel-grid">
      <section className="workbench">
        <div className="section-title">
          <Activity size={18} />
          <h2>自然语言选股</h2>
        </div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <button className="primary" onClick={runRecommendation}>
          <Play size={16} />
          生成盘中参考排名
        </button>
      </section>
      <section className="table-section span-2">
        <RankingTable items={recommendations} />
      </section>
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
                <td><strong>{item.name}</strong><span>{item.code} {item.industry}</span></td>
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
                <td><strong>{item.name}</strong><span>{item.type === "industry" ? "行业" : "概念"} 领涨 {item.leaderName ?? "-"}</span></td>
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
          <input value={analysisCode} onChange={(event) => setAnalysisCode(event.target.value)} placeholder="输入代码" />
          <button className="primary" onClick={loadAnalysis}>分析</button>
        </div>
        {score && (
          <div className="score-box">
            <strong>{score.name} {score.score}</strong>
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
          <div className="empty">输入股票代码查看分析。</div>
        )}
      </section>
    </div>
  );
}

function WatchPanel({ watchlist, triggers, watchForm, setWatchForm, addWatchItem }: any) {
  return (
    <div className="panel-grid">
      <section className="workbench">
        <div className="section-title">
          <BellRing size={18} />
          <h2>加入监控池</h2>
        </div>
        <input value={watchForm.code} onChange={(event) => setWatchForm({ ...watchForm, code: event.target.value })} placeholder="股票代码" />
        <input value={watchForm.name} onChange={(event) => setWatchForm({ ...watchForm, name: event.target.value })} placeholder="股票名称" />
        <textarea value={watchForm.thesis} onChange={(event) => setWatchForm({ ...watchForm, thesis: event.target.value })} />
        <textarea value={watchForm.conditionPrompt} onChange={(event) => setWatchForm({ ...watchForm, conditionPrompt: event.target.value })} />
        <button className="primary" onClick={addWatchItem}>
          <Plus size={16} />
          加入监控
        </button>
      </section>
      <section className="table-section span-2">
        <div className="section-title">
          <ShieldAlert size={18} />
          <h2>触发推荐池</h2>
        </div>
        <div className="watch-grid">
          <InfoBlock title="监控中" items={watchlist.map((item: WatchItem) => `${item.name}：${item.conditionPrompt}`)} />
          <InfoBlock title="已触发" items={triggers.map((item: any) => `${item.name} ${item.priority} ${item.score}`)} />
        </div>
      </section>
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
            <td><strong>{item.name}</strong><span>{item.code} {item.market}</span></td>
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

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="info-block">
      <h3>{title}</h3>
      {items.length ? items.map((item, index) => <p key={`${title}-${index}`}>{item}</p>) : <p>暂无数据</p>}
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

createRoot(document.getElementById("root")!).render(<App />);
