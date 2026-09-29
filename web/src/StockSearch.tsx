import { useEffect, useId, useRef, useState } from "react";

type Stock = { code: string; name: string };
let catalog: Promise<Stock[]> | undefined;
function loadCatalog() {
  const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
  const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  return catalog ??= fetch(base || local ? `${base}/api/stocks/catalog` : "./data/stocks/catalog.json")
    .then(async (response) => {
      if (!response.ok) throw new Error("股票名称索引加载失败，可输入六位代码；重新聚焦可重试。");
      const body = await response.json();
      if (!Array.isArray(body.items)) throw new Error("股票名称索引格式异常");
      return body.items as Stock[];
    }).catch((error) => { catalog = undefined; throw error; });
}

export function resolveStock(input: string, items: Stock[]): Stock | null {
  const query = input.trim();
  const matches = items.filter((item) => item.code === query || `${item.code} ${item.name}` === query || item.name.replace(/\s/g, "").toUpperCase() === query.replace(/\s/g, "").toUpperCase());
  return matches.length === 1 ? matches[0] : /^\d{6}$/.test(query) ? { code: query, name: "" } : null;
}

export default function StockSearch({ initialCode, onSelect }: { initialCode: string; onSelect: (stock: Stock | null) => void }) {
  const id = useId();
  const [text, setText] = useState(initialCode);
  const [items, setItems] = useState<Stock[]>([]);
  const [error, setError] = useState("");
  const callback = useRef(onSelect);
  callback.current = onSelect;
  async function load() {
    try { setItems(await loadCatalog()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "名称索引不可用，请输入代码"); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { callback.current(resolveStock(text, items)); }, [text, items]);
  const selected = resolveStock(text, items);
  const query = text.trim().replace(/\s/g, "").toUpperCase();
  const matches = items.filter((item) => item.code.includes(query) || item.name.replace(/\s/g, "").toUpperCase().includes(query)).slice(0, 20);
  return <div className="stock-search">
    <label htmlFor={id}>股票代码或公司名称</label>
    <input id={id} value={text} onChange={(event) => setText(event.target.value)} onFocus={() => { if (error) void load(); }} placeholder="例如 600519 / 贵州茅台" autoComplete="off" aria-describedby={`${id}-hint`} />
    {query && !selected && matches.length > 0 && <ul className="stock-search-results" aria-label="匹配股票">
      {matches.map((item) => <li key={item.code}><button type="button" onClick={() => setText(`${item.code} ${item.name}`)}>{item.name} · {item.code}</button></li>)}
    </ul>}
    <small id={`${id}-hint`} role="status">{selected?.name ? `${selected.name} · ${selected.code}` : error || (text && !selected ? "请选择匹配股票，或输入完整名称 / 六位代码" : "支持名称关键词或代码搜索")}</small>
  </div>;
}
