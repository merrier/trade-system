# 数据源与失败切换

本系统定位为 A 股主板研究辅助，不做自动交易。数据源按免费优先、多源兜底设计；任何真实源全部失败时任务失败，只有显式设置 `ALLOW_SAMPLE_DATA=true` 才允许开发样例数据。

## A 股主板

默认覆盖沪深主板代码前缀：`000`、`001`、`002`、`600`、`601`、`603`、`605`。

| 优先级 | 数据源 | 用途 | 关键字段 | 失败处理 |
| --- | --- | --- | --- | --- |
| 1 | [AKShare](https://akshare.akfamily.xyz/data/stock/stock.html) / 东方财富 | 实时快照、涨停池、板块资金流、历史日线 | open、close、volume、amount、pctChange、turnoverRate、涨停梯队、板块 | 非关键接口失败时保留部分数据并写入 warning；关键接口失败切下个源 |
| 2 | [efinance](https://github.com/Micro-sheep/efinance) | 实时行情兜底 | 最新价、涨跌幅、成交额、换手率 | 不提供完整连板/龙虎榜时写 warning，继续用于盘中选股 |
| 3 | [easyquotation](https://github.com/shidenggui/easyquotation) | 盘中实时快照兜底 | name、open、high、low、now、成交量、成交额 | 通过新浪/腾讯免费行情补 `intraday-snapshot`；不提供完整板块/龙虎榜时写 warning |
| 4 | [BaoStock](http://baostock.com/baostock/index.php/Python_API%E6%96%87%E6%A1%A3) | 历史日线兜底 | open、high、low、close、volume、amount、pctChange、turnoverRate | 主要用于 30 天滑窗缓存补历史 |
| 可选优先 | [Tushare](https://tushare.pro/document/2) | 30 天日线滑窗缓存 | open、high、low、close、volume、amount、pctChange、turnoverRate、股票中文名 | 配置 `TUSHARE_TOKEN` 后优先用于 `daily-bars`；未配置时不参与链路 |
| 可选兜底 | [Ashare](https://github.com/mpquant/Ashare) | 日线/分钟线 K 线兜底 | open、high、low、close、volume | 通过 `ASHARE_MODULE_PATH` 加载单文件模块；接入 `daily-bars` 和按代码拉取的 `minute-bars` |

Tushare 当前接入 [日线行情接口](https://tushare.pro/document/2?doc_id=27)，用于 14:50 涨停回调策略所需的近 30 个交易日 K 线窗口；实时快照、涨停池和板块热度仍由 AKShare/efinance/easyquotation/BaoStock 链路提供。

Ashare 当前作为 `daily-bars` 末级兜底：当 Tushare、BaoStock、efinance、AKShare 日线都失败时，系统用 Ashare 的日线 K 线补窗口；由于 Ashare 日线不直接给成交额和换手率，成交额会用 `close * volume` 近似，换手率记为 `0` 并通过 provider warning/报告风险提示暴露。分钟线通过 `minute-bars` 按股票代码拉取，支持 `1m/5m/15m/30m/60m`，主要给后续盘中细化和小范围候选验证使用，避免全市场分钟线请求过重。

## 外盘晨报

晨报用于 09:00 对 A 股当天主板市场做预判，默认尝试：

| 数据源 | 用途 |
| --- | --- |
| [yfinance](https://github.com/ranaroussi/yfinance) | 美股指数、行业 ETF、关键期货、汇率和商品 |
| Stooq | 预留备用外盘历史行情 |
| Alpha Vantage | 预留备用外盘与行业数据，需要 API key |

## Hermes Agent

[Hermes Agent](https://github.com/NousResearch/hermes-agent) 只承担分析编排和消息网关推送，不直接决定行情真实性、不写入交易指令。

可选环境变量：

- `HERMES_ANALYSIS_COMMAND`：接收 JSON prompt，返回 `{ analysis, rankingNarrative, pushMessage }` JSON。
- `HERMES_SEND_TARGET`：优先使用 `hermes send --to` 发送报告，例如 `weixin` 或 `weixin:<chat_id>`。
- `HERMES_DELIVERY_COMMAND`：从 stdin 接收推送文本。
- `HERMES_DELIVERY_WEBHOOK_URL`：接收报告 artifact JSON 的 webhook。

未配置 Hermes 推送时，任务仍生成静态报告，并在 `warnings` 中记录“仅生成静态报告”。
