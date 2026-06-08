# A股智能选股、个股监控与板块天梯

一个面向手动交易辅助研究的 A 股分析系统。它盘后落库涨停复盘、龙虎榜、板块资金流，盘中按需生成参考推荐，并提供个股分析和监控池。

> 本系统只做数据分析与研究辅助，不自动交易，也不构成投资建议或收益保证。

## 功能

- 推荐榜：自然语言策略编译为白名单 DSL，输出股票排名、理由、风险和置信度。
- 涨停天梯：展示连板高度、封板强度、所属板块。
- 板块天梯：行业 + 概念板块按涨幅、资金流、涨停家数、领涨股和热度排序。
- 个股分析：按代码查看走势摘要、资金、板块、龙虎榜、推荐因子与风险。
- 监控池：把主观看好的股票加入观察，满足模板/自然语言条件后进入触发推荐池。
- 三时报：GitHub Actions 在北京时间 09:00、14:50、16:00 生成晨报、盘中主板选股、收盘复盘，并导出到 `data/reports/*/latest.json`。
- 30 天主板滑窗：按沪深主板代码前缀缓存最近 30 个 A 股交易日的开收盘价、成交量、成交额、涨跌幅和换手率。
- 问财主板全量快照：通过 `hithink-market-query` 技能分页抓取 A 股主板全量行情，写入 SQLite 和原始 JSON。
- 问财涨停板快照：通过 `hithink-market-query` 技能抓取涨停原因、连板数、首封/终封时间、封单额、开板次数和行业。
- 问财龙虎榜快照：通过 `hithink-market-query` 技能抓取龙虎榜席位明细，并按股票聚合净买入额、买入额、卖出额和席位列表。
- mootdx 主板日 K 快照：通过通达信线上行情抓取最近 30 个交易日主板日 K，作为后续“涨停倍量阴”等 K 线策略的数据基础。
- 训练与回测路线：后续可接入 Microsoft Qlib，用每日行情、涨停、龙虎榜和板块数据做模型训练、因子验证和历史回测，见 `docs/modeling.md`。

## 快速开始

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run db:init
npm run ingest:iwencai-main-board
npm run ingest:post-close
npm run dev
```

API 默认运行在 `http://localhost:8787`，Web 看板默认运行在 `http://localhost:5173`。

## GitHub Pages

仓库可以通过 GitHub Pages 从 `main` 分支根目录发布静态页面。当前没有恢复之前那个构建前端并覆盖 `main` 的 Pages 发布 workflow。

现在只保留很窄的问财数据 GitHub Actions：

- `Ingest Iwencai main board data`：北京时间工作日 16:40 运行，抓取问财主板全量行情，并把 `data/iwencai/main-board-*.json` 与 `cache/main-daily-bars.json` 提交回 `dev` 分支。
- `Ingest Iwencai limit-up data`：北京时间工作日 16:45 运行，抓取问财涨停板数据，并把 `data/iwencai/limit-ups-*.json` 提交回 `dev` 分支。
- `Ingest Iwencai dragon tiger data`：北京时间工作日 16:55 运行，抓取问财龙虎榜席位明细，并把 `data/iwencai/dragon-tiger-*.json` 提交回 `dev` 分支。
- `Ingest Mootdx main daily bars`：北京时间工作日 17:05 运行，按问财主板股票池抓取最近 30 根日 K，并把 `data/mootdx/main-daily-bars-*.json` 与 `cache/main-daily-bars.json` 提交回 `dev` 分支。

这些任务都不会推送或覆盖 `main`。

GitHub Pages 只能托管静态页面，不能运行 Fastify API。当前免费部署模式不需要 `PAGES_API_BASE_URL`，页面会直接读取 `data/*.json`。本地开发仍然通过 Vite proxy 请求 `http://localhost:8787/api`。

页面会读取静态镜像：

- `data/reports/morning/latest.json`
- `data/reports/intraday-selection/latest.json`
- `data/reports/close/latest.json`
- `data/cache/main-daily-bars.json`

## 可选：部署后端 API

静态模式完全免费，但自然语言实时选股、监控池自动触发、盘中即时数据需要后端。若后续要恢复这些实时能力，可以把 Fastify API 部署到能长期运行 Node 服务的平台。推荐先用 Render：

1. 在 Render 创建 Web Service，连接 `merrier/trade-system` 仓库。
2. 选择 `dev` 分支，Runtime 选择 Docker。仓库已提供 `Dockerfile` 和 `render.yaml`。
3. Health Check Path 设置为 `/api/health`。
4. 配置环境变量：`DEEPSEEK_API_KEY`、`ALLOW_SAMPLE_DATA=false`，必要时配置 `PYTHON_BIN=python3`。
5. 部署成功后得到类似 `https://trade-system-api.onrender.com` 的地址。
6. 回到 GitHub 仓库 Variables，把 `PAGES_API_BASE_URL` 设置为这个后端地址，然后重新运行 Pages workflow。

注意：当前 SQLite 数据库在容器文件系统中，适合第一版验证。生产长期使用应改为持久磁盘或外部数据库，否则服务重建后需要重新跑盘后落库。

## 数据源

默认通过 `python/akshare_worker.py` 调用多数据源链路：AKShare/东方财富、efinance、easyquotation、BaoStock；配置 `TUSHARE_TOKEN` 后，Tushare 会优先补 30 天日线滑窗缓存。Ashare 可作为日线和分钟线 K 线兜底，GitHub Actions 会运行时下载单文件模块。系统默认不允许静默展示 sample 数据；只有设置 `ALLOW_SAMPLE_DATA=true` 时，才会在真实数据源不可用时返回开发演示数据。数据源细节见 `docs/data-sources.md`。

后续可参考 [simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data) 补充研报、一致预期、北向资金、两融、大宗交易、股东户数、新闻公告和龙虎榜增强字段；它暂作为候选数据源与实现参考，详见 `docs/data-sources.md`。

模型训练和回测不放在数据源链路里；后续可用 [Microsoft Qlib](https://github.com/microsoft/qlib) 读取已沉淀的问财/AKShare 数据，做离线训练、因子验证和回测评估，路线见 `docs/modeling.md`。

可选安装：

```bash
python3 -m pip install akshare pandas efinance baostock yfinance tushare easyquotation
```

可选数据源：

```bash
TUSHARE_TOKEN="..."
ASHARE_MODULE_PATH="/path/to/Ashare.py"
```

如果 `prisma db push` 在本机 SQLite schema engine 上失败，使用 `npm run db:init` 初始化数据库；运行时仍由 Prisma Client 读写。

### 同花顺问财 SkillHub

安装 `hithink-market-query` 技能并配置 `IWENCAI_API_KEY` 后，可以每日抓取 A 股主板全量行情：

```bash
source ~/.zshrc
npm run db:init
npm run ingest:iwencai-main-board
npm run ingest:iwencai-limit-ups
npm run ingest:iwencai-dragon-tiger
npm run ingest:mootdx-main-daily-bars
```

默认查询：

```text
A股主板股票 股票代码 股票简称 上市板块 最新价 涨跌幅 开盘价 最高价 最低价 收盘价 成交量 成交额 换手率 主力资金流向 主力增仓占比
```

输出会写入：

- SQLite `DailyBarRecord`：结构化日线字段，供推荐、筛选、监控使用。
- SQLite `Stock`：同步股票基础信息和 ST/停牌状态。
- `data/iwencai/main-board-YYYYMMDD.json`：问财原始返回，保留主力资金等全部查询字段。
- `cache/main-daily-bars.json`：主板日线滑窗缓存，默认保留 90 天。

涨停板抓取默认查询：

```text
今日A股涨停股票 股票代码 股票简称 最新价 最新涨跌幅 涨停原因 连续涨停天数 首次涨停时间 最终涨停时间 涨停封单额 涨停封单量 涨停开板次数 所属同花顺行业
```

涨停板输出会写入：

- SQLite `LimitUpRecord`：涨停天梯结构化字段。
- SQLite `Stock`：同步股票基础信息、行业和概念标签。
- `data/iwencai/limit-ups-YYYYMMDD.json`：问财涨停板原始返回。

龙虎榜抓取默认查询：

```text
今日A股龙虎榜 股票代码 股票简称 上榜日期 上榜原因 龙虎榜净买入额 龙虎榜买入额 龙虎榜卖出额 营业部名称 买卖席位 营业部类型 买入额占成交额比例 卖出额占成交额比例 净买入额占成交额比例
```

龙虎榜输出会写入：

- SQLite `DragonTigerRecord`：按股票聚合后的买入额、卖出额、净买入额和席位列表。
- SQLite `Stock`：同步股票基础信息。
- `data/iwencai/dragon-tiger-YYYYMMDD.json`：问财龙虎榜席位明细原始返回。

mootdx 主板日 K 抓取会读取最新的 `data/iwencai/main-board-YYYYMMDD.json` 作为股票池，默认抓取最近 30 根日 K。输出会写入：

- SQLite `DailyBarRecord`：日 K 结构化字段。
- `cache/main-daily-bars.json`：主板最近 30 个交易日滑窗缓存。
- `data/mootdx/main-daily-bars-YYYYMMDD.json`：mootdx 原始归一化日 K 快照。

这份缓存用于后续讨论和实现“涨停倍量阴”等 K 线策略。mootdx 首次运行需要选择最快通达信服务器；云端 Action 会自动执行 `python3 -m mootdx bestip`。抓取过程设置了 socket 超时并输出批量进度，避免单个通达信连接长期挂住。

可选参数：

```bash
npm run ingest:iwencai-main-board -- --limit=100 --delay-ms=250
npm run ingest:iwencai-main-board -- --query="A股主板股票 最新价 成交额 换手率 主力资金流向" --limit=100
npm run ingest:iwencai-limit-ups -- --limit=100
npm run ingest:iwencai-dragon-tiger -- --limit=100
npm run ingest:mootdx-main-daily-bars -- --days=30 --concurrency=8
```

本地每日运行可以使用 macOS `launchd` 或 crontab。例如 crontab 工作日 16:40 执行：

```cron
40 16 * * 1-5 cd /Users/bytedance/repos/mine/trade-system && /bin/zsh -lc 'source ~/.zshrc && npm run ingest:iwencai-main-board >> data/iwencai-cron.log 2>&1'
```

云端每日运行使用 `.github/workflows/iwencai-main-board.yml`、`.github/workflows/iwencai-limit-ups.yml`、`.github/workflows/iwencai-dragon-tiger.yml` 和 `.github/workflows/mootdx-main-daily-bars.yml`。问财任务需要在 GitHub 仓库 Secrets 配置：

```text
IWENCAI_API_KEY=你的问财 SkillHub API Key
IWENCAI_API_KEY_FALLBACK=可选备用 Key
```

如果主 key 在分页抓取过程中触发额度限制或请求失败，脚本会自动尝试备用 key；备用 key 成功后，后续分页会继续使用备用 key。

## DeepSeek

自然语言策略解析使用 DeepSeek 兼容 OpenAI Chat Completions 的接口。未配置 `DEEPSEEK_API_KEY` 时，系统自动使用本地规则解析兜底。

```bash
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-chat"
```

## Hermes Agent

Hermes Agent 用于报告分析编排和消息网关推送，不直接抓行情、不生成交易指令。可选配置：

```bash
HERMES_ANALYSIS_COMMAND=""
HERMES_SEND_TARGET="weixin"
FEISHU_WEBHOOK_URL=""
FEISHU_WEBHOOK_SECRET=""
FEISHU_WEBHOOK_MODE=""
FEISHU_WEBHOOK_KEYWORD=""
HERMES_DELIVERY_COMMAND=""
HERMES_DELIVERY_WEBHOOK_URL=""
INTRADAY_STRATEGY_PROMPT="涨停回调策略：主板股票最近10天内有涨停，今天是阴线，但是没有跌破涨停价，收盘价回调至五日线或十日线附近且距离不超过3%，阴线缩量，最近20天涨幅不超过25%，均线呈多头排列"
```

`HERMES_SEND_TARGET` 使用 `hermes send --to` 的目标格式，例如 `weixin` 或 `weixin:<chat_id>`。未配置 Hermes 推送时，系统仍会生成静态报告，并在 `warnings` 中说明仅落盘未推送。

如果配置 `FEISHU_WEBHOOK_URL`，系统会优先推送飞书简报。原生飞书机器人 URL（`open.feishu.cn/open-apis/bot/...`）会自动使用飞书互动卡片；自建中转 URL 会发送 `{"title":"2026-05-26 早报","content":"...markdown..."}`，标题按交易日和报告类型生成，并在配置 `FEISHU_WEBHOOK_SECRET` 后附带 `X-Hub-Signature-256: sha256=<hmac>`。需要强制指定时可设置 `FEISHU_WEBHOOK_MODE=feishu-card` 或 `FEISHU_WEBHOOK_MODE=signed-message`。若飞书机器人使用关键词安全校验，可把关键词填到 `FEISHU_WEBHOOK_KEYWORD`。GitHub Actions 云端发送时，把 `FEISHU_WEBHOOK_URL`、`FEISHU_WEBHOOK_SECRET` 配置到仓库 Secrets，把 `FEISHU_WEBHOOK_MODE`、`FEISHU_WEBHOOK_KEYWORD` 配置到 Variables。

三类报告的 `pushMessage` 默认使用 Markdown 简报格式，飞书会按标题、列表和加粗字段渲染；微信等纯文本渠道会收到同一份内容的可读文本。

报告任务会按北京时间自动识别 A 股交易日。周末和已内置的 2026 年交易所休市日会直接跳过，不生成报告、不推送微信；临时休市可用 `A_SHARE_EXTRA_HOLIDAYS=2026-05-25,2026-05-26` 补充。手动调试非交易日时可设置 `FORCE_REPORT_ON_NON_TRADING_DAY=true` 或传 `--force-non-trading`。

14:50 盘中选股默认使用“涨停回调策略”：主板股票最近 10 个交易日内曾涨停，当日为阴线，低点未跌破最近涨停日收盘价，收盘价站上并回调至 MA5 或 MA10 附近，默认距离最近均线不超过 3%，且当日成交量较前一交易日缩量；同时要求最近 20 个交易日涨幅不超过 25%，并形成 MA5 > MA10 > MA20 的均线多头排列。该策略依赖 `data/cache/main-daily-bars.json` 的 30 日滑窗日线缓存；缓存不足时报告会在 `warnings` 中提示。

### 微信入站转发

Hermes 微信网关可以通过用户插件把所有 Weixin 入站消息转发到本项目。默认落盘位置是 `data/inbox/weixin.jsonl`，该文件已加入 `.gitignore`，避免把私人消息提交到仓库。

本地 API 同时提供：

- `POST /api/inbox/weixin`：写入一条 Weixin 入站消息。
- `GET /api/inbox/weixin/latest?limit=50`：读取最近消息，按新到旧排序。

如果本地 API 正在运行，可设置 `TRADE_SYSTEM_INBOX_HTTP_URL=http://127.0.0.1:8787/api/inbox/weixin` 让投递脚本额外 fan-out 到 HTTP；未设置时仍会可靠写入 JSONL。
