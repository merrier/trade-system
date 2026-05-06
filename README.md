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

源码提交到 `dev` 分支后，`.github/workflows/deploy-pages.yml` 会自动构建前端、导出静态行情 JSON，并把 `dist-web` 发布到 `main` 分支。仓库的 GitHub Pages 需要配置为从 `main` 分支根目录发布。

GitHub Pages 只能托管静态页面，不能运行 Fastify API。当前免费部署模式不需要 `PAGES_API_BASE_URL`，页面会直接读取 `data/*.json`。本地开发仍然通过 Vite proxy 请求 `http://localhost:8787/api`。

Workflow 会在北京时间交易日 16:30 左右自动运行，也可以在 GitHub Actions 页面手动触发。

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
