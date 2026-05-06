# A股智能选股、个股监控与板块天梯

一个面向手动交易辅助研究的 A 股分析系统。它盘后落库涨停复盘、龙虎榜、板块资金流，盘中按需生成参考推荐，并提供个股分析和监控池。

> 本系统只做数据分析与研究辅助，不自动交易，也不构成投资建议或收益保证。

## 功能

- 推荐榜：自然语言策略编译为白名单 DSL，输出股票排名、理由、风险和置信度。
- 涨停天梯：展示连板高度、封板强度、所属板块。
- 板块天梯：行业 + 概念板块按涨幅、资金流、涨停家数、领涨股和热度排序。
- 个股分析：按代码查看走势摘要、资金、板块、龙虎榜、推荐因子与风险。
- 监控池：把主观看好的股票加入观察，满足模板/自然语言条件后进入触发推荐池。

## 快速开始

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run db:init
npm run ingest:post-close
npm run dev
```

API 默认运行在 `http://localhost:8787`，Web 看板默认运行在 `http://localhost:5173`。

## GitHub Pages

源码提交到 `dev` 分支后，`.github/workflows/deploy-pages.yml` 会自动构建前端并把 `dist-web` 发布到 `main` 分支。仓库的 GitHub Pages 需要配置为从 `main` 分支根目录发布。

GitHub Pages 只能托管静态页面，不能运行 Fastify API。若要让 Pages 上的看板访问接口，请在仓库 Variables 里配置。这里必须是后端 API 的公开地址，不是 GitHub Pages 页面地址：

```text
PAGES_API_BASE_URL=https://your-api-host.example.com
```

本地开发不需要这个变量，前端会继续通过 Vite proxy 请求 `http://localhost:8787/api`。

## 数据源

默认通过 `python/akshare_worker.py` 调用 AKShare。系统默认不允许静默展示 sample 数据；只有设置 `ALLOW_SAMPLE_DATA=true` 时，才会在真实数据源不可用时返回开发演示数据。

可选安装：

```bash
python3 -m pip install akshare pandas
```

如果 `prisma db push` 在本机 SQLite schema engine 上失败，使用 `npm run db:init` 初始化数据库；运行时仍由 Prisma Client 读写。

## DeepSeek

自然语言策略解析使用 DeepSeek 兼容 OpenAI Chat Completions 的接口。未配置 `DEEPSEEK_API_KEY` 时，系统自动使用本地规则解析兜底。

```bash
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-chat"
```
