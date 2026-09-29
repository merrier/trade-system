# A股智能选股、个股监控与板块天梯

一个面向手动交易辅助研究的 A 股分析系统。它盘后落库涨停复盘、龙虎榜、板块资金流，盘中按需生成参考推荐，并提供个股分析和监控池。

> 本系统只做数据分析与研究辅助，不自动交易，也不构成投资建议或收益保证。

## 功能

- 推荐榜：自然语言策略编译为白名单 DSL，输出股票排名、理由、风险和置信度。
- 涨停天梯：展示连板高度、封板强度、所属板块。
- 板块天梯：行业 + 概念板块按涨幅、资金流、涨停家数、领涨股和热度排序。
- 个股分析：按代码查看走势摘要、资金、板块、龙虎榜、推荐因子与风险。
- 监控池：按代码或名称添加股票后，页面逐家公司纵向展示 K 线、MA5/10/20/60 和成交量，每张图可独立切换日 K / 周 K。
- 三时报：GitHub Actions 在北京时间 09:00、14:50、16:00 生成晨报、盘中主板选股、收盘复盘，并导出到 `data/reports/*/latest.json`。
- 30 天主板滑窗：按沪深主板代码前缀缓存最近 30 个 A 股交易日的开收盘价、成交量、成交额、涨跌幅和换手率。
- 问财主板全量快照：通过 `hithink-market-query` 技能分页抓取 A 股主板全量行情，写入 SQLite 和原始 JSON。
- 问财涨停板快照：通过 `hithink-market-query` 技能抓取涨停原因、连板数、首封/终封时间、封单额、开板次数和行业。
- 问财龙虎榜快照：通过 `hithink-market-query` 技能抓取龙虎榜席位明细，并按股票聚合净买入额、买入额、卖出额和席位列表。
- 公司画像增强：盘后对涨停池股票补所属行业/概念、涨停原因、竞争对手、行业地位/市占率/龙头相关证据和题材唯一性。
- mootdx 主板日 K 快照：通过通达信线上行情抓取最近 30 个交易日主板日 K，作为后续“涨停倍量阴”等 K 线策略的数据基础。
- tdx2db 本地历史库：可把通达信离线日线导入 DuckDB，再导出主板前复权日 K 补强本地滑窗缓存。
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
- `Enrich company context`：北京时间工作日 17:15 运行，参考 `a-stock-data` 记录的 F10/研报/题材/资金面能力方向，对涨停池股票补公司画像，并把 `data/company-context/*.json` 提交回 `dev` 分支。
- `Send 14:50 intraday selection`：仅手动触发，运行所选分支，复用代码中的“沿五日线阴线回调”默认策略生成 14:50 主板盘中选股（默认跳过发送）；该任务只上传报告 artifact，不提交数据、不覆盖 `main`。

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

后续可参考 [simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data) 补充研报、一致预期、北向资金、两融、大宗交易、股东户数、新闻公告和龙虎榜增强字段；也可用已安装的 [anysearch-ai/anysearch-skill](https://github.com/anysearch-ai/anysearch-skill) 为“行业龙头/市占率/题材唯一性”补外部证据。它们暂作为候选数据源与实现参考，详见 `docs/data-sources.md`。

模型训练和回测不放在数据源链路里；后续可用 [Microsoft Qlib](https://github.com/microsoft/qlib) 读取已沉淀的问财/AKShare 数据，做离线训练、因子验证和回测评估，路线见 `docs/modeling.md`。

可选安装：

```bash
python3 -m pip install akshare pandas efinance baostock yfinance tushare easyquotation
```

可选数据源：

```bash
TUSHARE_TOKEN="..."
ASHARE_MODULE_PATH="/path/to/Ashare.py"
TDX2DB_DUCKDB_PATH="data/tdx/tdx.db"
TDX2DB_VIEW="v_stock_qfq"
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

公司画像增强会读取最新涨停池股票，盘后补充：

- `data/company-context/company-context-YYYYMMDD.json`：当日公司画像快照。
- `data/company-context/latest.json`：14:50 盘中消息优先读取的最新画像缓存。

字段包括：涨停原因、所属行业/概念、主营/行业地位/市占率/龙头相关问财返回字段、竞争对手、题材关键词和唯一性说明。当前第一版用问财 SkillHub 落库，设计参考 `a-stock-data` 中记录的 F10、研报、一致预期、行业对比、股东户数等增强方向；后续可把 `a-stock-data` 的 F10/研报实现接成第二数据源。

离线板块映射会用东方财富行业/概念板块成分补充主板股票的稳定行业与概念标签。输出会写入：

- `data/sector-map/main-board-sector-map-YYYYMMDD.json`：当日主板股票行业/概念映射快照。
- `data/sector-map/latest.json`：14:50 盘中选股优先读取的最新映射缓存。

该缓存用于给 `easyquotation` 等实时快照源补齐缺失的 `industry/concepts` 字段，从而让推荐原因里的“板块”、板块热度因子和龙头/唯一性判断有基础数据。

mootdx 主板日 K 抓取会读取最新的 `data/iwencai/main-board-YYYYMMDD.json` 作为股票池，默认抓取最近 30 根日 K。输出会写入：

- SQLite `DailyBarRecord`：日 K 结构化字段。
- `cache/main-daily-bars.json`：主板最近 30 个交易日滑窗缓存。
- `data/mootdx/main-daily-bars-YYYYMMDD.json`：mootdx 原始归一化日 K 快照。

这份缓存用于后续讨论和实现“涨停倍量阴”等 K 线策略。mootdx 首次运行需要选择最快通达信服务器；云端 Action 会自动执行 `python3 -m mootdx bestip`。抓取过程设置了 socket 超时并输出批量进度，避免单个通达信连接长期挂住。

tdx2db 可作为本地历史行情底座：先用通达信 `vipdoc` 日线包初始化 DuckDB，再把 `v_stock_qfq` 视图里的主板日 K 导出到本项目缓存。它适合补历史 K 线、前收盘、换手率和市值口径，不提供盘中实时价、涨停原因、龙虎榜或问财自然语言字段。

```bash
tdx2db init --dburi 'duckdb://./data/tdx/tdx.db' --dayfiledir ./vipdoc
tdx2db cron --dburi 'duckdb://./data/tdx/tdx.db'
npm run ingest:tdx2db-daily-bars -- --db=data/tdx/tdx.db --days=90
```

可选参数：

```bash
npm run ingest:iwencai-main-board -- --limit=100 --delay-ms=250
npm run ingest:iwencai-main-board -- --query="A股主板股票 最新价 成交额 换手率 主力资金流向" --limit=100
npm run ingest:iwencai-limit-ups -- --limit=100
npm run ingest:iwencai-dragon-tiger -- --limit=100
npm run enrich:company-context -- --max-codes=80
npm run ingest:sector-map
npm run ingest:mootdx-main-daily-bars -- --days=30 --concurrency=8
npm run ingest:tdx2db-daily-bars -- --db=data/tdx/tdx.db --days=90
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
HERMES_ANALYSIS_COMMAND="./scripts/hermes-analysis.sh"
LARK_CLI_CHAT_ID=""
LARK_CLI_USER_ID=""
LARK_CLI_AS="bot"
HERMES_SEND_TARGET="weixin"
FEISHU_WEBHOOK_URL=""
FEISHU_WEBHOOK_SECRET=""
FEISHU_WEBHOOK_MODE=""
FEISHU_WEBHOOK_KEYWORD=""
HERMES_DELIVERY_COMMAND=""
HERMES_DELIVERY_WEBHOOK_URL=""
INTRADAY_STRATEGY_PROMPT="涨停回踩阴线策略：主板股票近5日出现实体涨停，涨停后有阴线调整，调整区间最低价未跌破涨停当日开盘价，今日收阴线但收盘价不跌破10日均线，今日涨幅小于5%，近20日最大涨幅小于45%，非ST，非科创板，非北交所，非创业板，股价大于5元，近5日日均成交额大于3000万"
```

`HERMES_ANALYSIS_COMMAND` 默认可指向 `./scripts/hermes-analysis.sh`。该脚本从 stdin 接收报告 JSON，使用 DeepSeek 兼容 Chat Completions 接口生成 `analysis`、`rankingNarrative` 和 `pushMessage`；需要配置 `DEEPSEEK_API_KEY`，未配置或调用失败时会在 `warnings` 中说明并退回本地摘要。

如果配置 `LARK_CLI_CHAT_ID` 或 `LARK_CLI_USER_ID`，系统会优先使用 `lark-cli im +messages-send` 发送 Markdown 简报。首次使用前需要完成 `lark-cli config init` 和 `lark-cli auth login --recommend`，并确认 `lark-cli auth status` 中 bot 身份可用。`LARK_CLI_AS` 默认是 `bot`。

`HERMES_SEND_TARGET` 使用 `hermes send --to` 的目标格式，例如 `weixin` 或 `weixin:<chat_id>`。未配置 Hermes 推送时，系统仍会生成静态报告，并在 `warnings` 中说明仅落盘未推送。

如果未配置 `lark-cli` 目标但配置了 `FEISHU_WEBHOOK_URL`，系统会推送飞书简报。原生飞书机器人 URL（`open.feishu.cn/open-apis/bot/...`）会自动使用飞书互动卡片；自建中转 URL 会发送 `{"title":"2026-05-26 早报","content":"...markdown..."}`，标题按交易日和报告类型生成，并在配置 `FEISHU_WEBHOOK_SECRET` 后附带 `X-Hub-Signature-256: sha256=<hmac>`。需要强制指定时可设置 `FEISHU_WEBHOOK_MODE=feishu-card` 或 `FEISHU_WEBHOOK_MODE=signed-message`。若飞书机器人使用关键词安全校验，可把关键词填到 `FEISHU_WEBHOOK_KEYWORD`。GitHub Actions 云端发送时，把 `FEISHU_WEBHOOK_URL`、`FEISHU_WEBHOOK_SECRET` 配置到仓库 Secrets，把 `FEISHU_WEBHOOK_MODE`、`FEISHU_WEBHOOK_KEYWORD` 配置到 Variables。

三类报告的 `pushMessage` 默认使用 Markdown 简报格式，飞书会按标题、列表和加粗字段渲染；微信等纯文本渠道会收到同一份内容的可读文本。

报告任务会按北京时间自动识别 A 股交易日。周末和已内置的 2026 年交易所休市日会直接跳过，不生成报告、不推送微信；临时休市可用 `A_SHARE_EXTRA_HOLIDAYS=2026-05-25,2026-05-26` 补充。手动调试非交易日时可设置 `FORCE_REPORT_ON_NON_TRADING_DAY=true` 或传 `--force-non-trading`。

14:50 盘中选股默认策略统一定义在 `src/core/defaults.ts` 的 `MA5_PULLBACK_PROMPT`，GitHub 手动 workflow 不再单独维护提示词。使用主板全量股票的“沿五日线阴线回调”规则：MA5 连续上行、MA5 > MA10 > MA20、前 5 个完整交易日收盘均在各自 MA5 上方，今日阴线回踩且最新价距 MA5 为 0%～2%，最低价相对 MA5 为 -0.8%～1.5%，今日涨跌幅 -2%～2.5%，量比 0.7～1.8；同时要求非 ST、非停牌、上市至少 20 天、股价大于 5 元、近 5 日日均成交额大于 3000 万、当天成交额至少 3000 万。近 5 日和 20 日区间振幅分别不超过 15% 和 35%，排除长上影和大阴线。排序后最多保留 5 只，不放宽条件凑数；具名策略由本地确定性编译，不由模型改写阈值。盘中快照作为今日临时日 K，历史不足不入选。日线扫描不限定近期涨停股票。

配置 `FUYAO_API_KEY` 后，盘中行情优先使用[同花顺 Fuyao](https://fuyao.aicubes.cn/docs/api-reference/prices/) 的 `/api/a-share/prices/snapshot`，股票名称取 `/api/meta/tickers/list`。两者均分页读取，成交量由股转换为项目使用的手，保留上游行情时间；日期与请求交易日不一致时拒绝使用。请求失败时沿用 AKShare → efinance → easyquotation → baostock 回退链。14:50 GitHub Actions 已引用同名仓库 Secret。

板块资金流仍使用 AKShare；该接口不可用时保留 Fuyao 行情、板块资金流留空，离线板块映射仍补齐个股行业/概念，但不以成交额派生资金流排名。Fuyao 行情不含换手率、量比、上市天数及个股主力净流入，当前分别沿用兜底值 `0`、`1`、`999`、`0`，并在报告警告中说明这些不是实测数据。日线、分钟线、盘后涨停池及交易日判断保持原路径。

14:50 报告还会读取 `data/watchlist/monitor-pool.json` 的监控池，逐只输出是否进入上升趋势、是否回踩或接近 5 日线、相对 10 日线位置、量能和风险。新增或更新监控股票：

```bash
npm run monitor:pool -- add --code=600226 --name=亨通股份 --thesis=观察涨停后回踩5日线承接
npm run monitor:pool -- list
npm run monitor:pool -- disable --code=600226
```

监控池不会改变策略筛选结果；它是独立的“指定股票状态体检”小节。

### 9:00 晨报

晨报依赖安装：`python3 -m pip install -r python/requirements-morning.txt`。手动生成：`npm run reports:morning -- --skip-delivery`；定时运行加 `--if-missing`，当天已有报告时直接跳过。非 A 股交易日会在请求数据之前退出，晨报不扫描 A 股日线。

GitHub Actions 的 `morning-report-0900.yml` 在北京时间周一至周五 9:00 运行（GitHub 排队可能延迟），也支持手动触发。任务读取仓库 Secret `FUYAO_API_KEY`，节假日由项目日历跳过；生成后更新 `main` 分支上的 GitHub Pages 静态页面和晨报数据，主动触发 Pages 构建并验证公网报告。只生成页面数据，不发送飞书或微信消息，不依赖本机 Codex。原本地晨报自动化停用。

外盘使用 yfinance，Fuyao 提供国内原油连续和商品指数，分栏展示。仅采用报告日前已完成、距报告日不超过 7 天的日线；涨跌幅按相邻两根有效日线计算。Yahoo 限流时保留 Fuyao 栏目并标注外盘缺失，全部数据源失败则不覆盖已有报告。报告日期为 A 股晨报日期，各行情另标数据日期。

报告持久保存在 `data/reports/morning/`，同时写入 `dist-web/data/reports/morning/`。本地晨报 API 每分钟检查 GitHub 已发布报告，并在云端与本地文件中选择报告日期、生成时间较新的一份；网络失败时保留可用数据。其他报告仍按原路径读取；前端构建后会恢复持久化报告，避免构建清空晨报。旧日报在页面明确标注为历史数据。定时任务需运行在持有代码、Python 依赖和 `FUYAO_API_KEY` 的机器上；静态远程站点需要另行发布生成的文件，仅保存 GitHub artifact 不会更新页面。

### 个股 K 线图

启动前后端后，在侧栏选择「K 线图」，输入六位主板股票代码。支持日 K / 周 K 切换，默认显示最近 30 根 K 线，叠加 MA5、MA10、MA20、MA60，下方成交量以手计；悬停查看详情，拖动滑块查看更长历史。

推荐榜、天梯、个股分析、监控池中的股票名称或代码可点击打开 K 线弹窗，报告正文中的明确股票代码同样支持。按 Esc 或关闭按钮返回原页面。名称没有对应代码时保持普通文本，不推测股票身份。

K 线图、个股分析和监控池共用股票搜索框，可输入六位代码、股票名称或名称关键词，选择候选后按准确代码查询。名称索引由 `/api/stocks/catalog` 提供，服务端缓存 24 小时；上游不可用时使用数据库已有名称，仍可直接输入代码。静态导出同时生成 `stocks/catalog.json`。

可复用组件：`web/src/StockKLineChart.tsx` 中的 `<StockKLineChart code="600519" />`。`GET /api/stocks/:code/history` 使用服务端 `FUYAO_API_KEY` 获取最近三年前复权日线以预热周 MA60，同一股票缓存 10 分钟，上游请求串行且间隔至少 2 秒。MA 在完整历史上计算后再显示最近 30 根；历史不足时留空，最新周可能未结束。该组件需要后端，纯静态站点须通过 `VITE_API_BASE_URL` 连接已部署的 API，密钥不得配置到浏览器环境。

### 微信入站转发

Hermes 微信网关可以通过用户插件把所有 Weixin 入站消息转发到本项目。默认落盘位置是 `data/inbox/weixin.jsonl`，该文件已加入 `.gitignore`，避免把私人消息提交到仓库。

本地 API 同时提供：

- `POST /api/inbox/weixin`：写入一条 Weixin 入站消息。
- `GET /api/inbox/weixin/latest?limit=50`：读取最近消息，按新到旧排序。

如果本地 API 正在运行，可设置 `TRADE_SYSTEM_INBOX_HTTP_URL=http://127.0.0.1:8787/api/inbox/weixin` 让投递脚本额外 fan-out 到 HTTP；未设置时仍会可靠写入 JSONL。

### GitHub 14:50 选股

`.github/workflows/intraday-selection-1450.yml` 使用 `dev` 源码运行：北京时间工作日 08:00 串行准备主板最近 30 个完整交易日日线，14:50 读取当日缓存、采样 Fuyao、按现有沿五日线阴线回调规则筛选前 5，再通过已有 `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET` 推送并更新 Pages。节假日由内置 A 股交易日历跳过。GitHub 调度可能延迟；超过 15:00 不补造盘中结果，网站和 Webhook 均显示失败原因。

历史请求间隔至少 2 秒，限流按 Retry-After 和 60/120/240 秒退避；每只股票落盘，Actions cache 保存中断进度。前复权窗口整体刷新以避免混用复权基准；同日有效窗口复用。缺失日、重复日期、无效 OHLC 或成交量额使准备失败，不能当作停牌或零结果。上市不足 30 个完整交易日及 ST 股票单独排除。量比用实际累计成交量 / 近 5 日日均成交量 / 已交易分钟占比计算，成交量统一为手；不会填默认量比。

手动运行默认为 `validate`（检查代码，不请求行情、不发消息）；`prepare` 补齐当天使用的历史窗口；`report` 生成并发布当天报告（默认跳过飞书，窗口外发布明确失败状态）。检查 Actions 的 `coverage.json` 与报告 artifact，可区分数据准备失败、无人符合条件和推送失败。首次全量准备约需两小时，数据源异常可能更久。

### GitHub 16:00 复盘

`.github/workflows/close-report-1600.yml` 在北京时间工作日 16:00 自动生成并发布复盘，A 股非交易日跳过；支持手动补跑。使用 Fuyao 当日收盘快照统计完整沪深主板（含 ST，不含尚未上市股票），无成交股票单独说明。涨跌停家数来自同日专用股票池；行业前排按行业指数涨跌幅排序，不将资金流缺失替换成涨停池热度。页面展示报告日期、行情时间和缺失项，历史复盘明确标注。此工作流仅更新网站，不发送飞书。
