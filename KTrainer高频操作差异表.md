# KTrainer 高频操作差异表

更新时间：2026-10-22。此表记录已观察到的参考行为、本地对应入口和验证边界；“通过”只表示本地流程可用，不表示像素或语义已经与交易所完全相同。

| 操作 | KTrainer / 币安参考行为 | 本地对应行为 | 状态与复验入口 |
| --- | --- | --- | --- |
| 周期切换 | 图表顶部保留常用周期，更多周期收进二级菜单；切换后时间轴和图表数据同步更新。 | `1m/5m/15m/1H/4H/1D` 置于首层，其余 Binance Futures 周期收进“更多”；切换成功后清理未完成绘图草稿，取消切换保留原会话。 | **部分通过**：`tests/chart-timeframes.cjs`、`tests/chart-live-timeframes.browser.js`、`tests/chart-interactions.browser.js`；参考站股票周期不照搬合约训练。 |
| 缩放与平移 | 鼠标滚轮/拖动改变可见范围，K 线和十字线随范围同步，双击或重置回到默认视图。 | 专业图使用 Lightweight Charts；备用 SVG 提供滚轮、拖动和按钮缩放，缩放锚点按指针位置保持；重置不改变训练数据和账户状态。 | **本地通过，参考同态待补**：`tests/chart-zoom-parity.browser.js`、`tests/chart-interactions.browser.js`。 |
| 十字光标与读数 | 十字线贯穿主图/成交量，顶部显示当前 K 线 OHLC、成交量和指标读数；移出图表恢复最新读数。 | 专业图/备用图均显示 OHLC、VOL、已启用均线和副图读数；窄屏指标行可横向滚动，移出后恢复当前已揭示最新读数。 | **本地通过，真机待验**：`tests/chart-interactions.browser.js`、`tests/chart-readouts.cjs`。 |
| 价格轴 | 拖动价格轴调整视图；双击/重置恢复自动缩放；指标副图有独立刻度。 | 价格轴拖动只作用于当前价格 pane；主图倒置/线性/对数/百分比/标准化模式与副图刻度分离，备用图也保留同一入口。备用图默认按高度自适应刻度，桌面默认约 10 个价格刻度、空间足够时量能窗格补两条量级刻度。 | **本地通过，参考逐动作待补**：`tests/chart-axis-controls.cjs`、`tests/chart-price-axis-interactions.browser.js`、`tests/chart-responsive.browser.js`。 |
| 指标设置 | 指标入口打开独立弹层，常用指标和参数可开关；多副图按 pane 展示，设置不挤压主图。 | “清爽观察 / 趋势对照 / 动能观察”三套轻量预设；SMA、EMA、RSI、MACD、KDJ、BOLL、SAR 和成交量均线可分别设置，偏好本地保存。 | **部分通过**：`tests/chart-indicator-presets.browser.js`、`tests/chart-pane-sizing.browser.js`；参考目录的全部项目和真实数据型指标不承诺覆盖。 |
| 绘图编辑 | 左侧工具栏提供常用线型，进阶工具分组展开；对象可选中、移动、隐藏、锁定、删除。 | 常用工具留在首层，22 类进阶对象收进菜单；对象管理器支持显隐/锁定/解锁/删除，磁吸可选，周期或来源切换只清理未完成草稿。 | **本地入口与对象管理通过，语义/真机待验**：`tests/chart-tool-matrix.browser.js`、`tests/chart-drawing-object-controls.browser.js`、`tests/chart-professional-drawing-edit.browser.js`。 |
| 全屏与副图 | 全屏扩大绘图区，时间轴、工具栏和副图仍可操作；面板可按分隔线调整。 | `chart-wrap` 支持全屏、Escape 退出、主图/成交量/RSI/MACD/KDJ 单 pane 临时放大和分隔线拖动；焦点状态不写入偏好。专业图默认主/量约 2.005:1，备用图默认约 1.94:1，和 Binance 参考主/量约 1.94:1 对齐；两条路径均按各自默认比例重置。 | **本地通过，短屏真机待验**：`tests/chart-fullscreen-tool-matrix.browser.js`、`tests/chart-pane-focus.browser.js`、`tests/chart-pane-sizing.browser.js`、`tests/chart-responsive.browser.js`。 |
| 工具图标与离线可识别性 | 参考站/币安的周期、指标、绘图和全屏入口始终有图标或文字，不因 CDN 暂时不可用变成空白控件。 | Lucide 资源改为仓库内 `vendor/lucide.min.js`，59 个声明图标和许可证随版本提交；拦截 `unpkg.com` 后，图表绘图工具仍显示 SVG 图标。 | **本地通过，参考像素/真机待验**：`tests/chart-assets.cjs`、`tests/chart-header-coach.browser.js`；54/54 图标渲染，五种视口无横向溢出。 |
| 双盲训练 | KTrainer 从周期/长度设置进入隐藏未来的逐根训练，完成后进入成绩、复盘和错题/专项再练。 | 首页主线固定为“选择周期与长度 → 逐根推演并记录 → 复盘弱项再训练”；设置、阶段课程、题库专项、指标课程和复盘集中在学习总览，独立练习不污染阶段门槛。 | **本地闭环通过，参考课程深度待补**：`tests/learning-loop.browser.js`、`tests/training-route.browser.js`、`tests/learning-supplemental.browser.js`。 |

## 明确不照搬的部分

- KTrainer 首页的排行榜、登录/注册、盈亏笔记、小程序入口和会员 MCP 接口目前没有服务端实现；本地首页只提供已实现的训练模块，不用静态按钮冒充线上能力。
- KTrainer 参考站面向证券/股票周期；本地产品定位是合约趋势训练，保留 Binance USDⓈ-M 永续来源和模拟交易边界，不把股票 D/W/M 语义直接套进合约数据。
- 浏览器模拟视口、离线拦截和本地快照只能证明当前代码路径，不能替代真实手机触控、线上行情稳定性或账号同步验收。
