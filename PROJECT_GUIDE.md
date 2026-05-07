# 图书馆座位预约助手项目介绍书

## 1. 项目定位

这个项目是一个本地图书馆座位预约助手，目标是把“打开网页、选择日期时间、选择房间座位、提交预约”的人工流程，改造成可配置、可复用、可由 agent 调用的自动化工具。

它现在支持两种使用方式：

1. 固定策略预约：例如固定预约 `宋韵云图（四楼）`、`17-58` 号、`12:00-20:00`。
2. 自主选座预约：通过请求文件描述偏好，例如“明天 13:00-17:00，二楼优先，没座就全馆兜底”，程序自动扫描候选、打分、选择并提交。

项目内部使用标准 JSON 请求文件，适合稳定执行；你和 agent 之间可以使用自然语言，由 agent 把自然语言翻译成请求文件再运行程序。

## 2. 是否每次都要扫描所有空间

不需要。

图书馆预约系统里的数据可以分成两类：

1. 结构数据：空间分类、房间名称、座位号、座位 ID、是否有插座、座位地图坐标。
2. 实时数据：某个日期、某个时间段里，每个座位当前是否可预约。

结构数据变化很少，适合用 `npm run discover` 扫描后缓存到 `data/catalog.json`。这个缓存主要用于了解系统里有哪些房间和座位，也方便后续做更智能的推荐。

实时数据必须每次预约时重新查询。比如同一个座位，今天 13:00-17:00 可用，不代表明天同一时间可用；20:00 放号瞬间更是必须查实时状态。所以正式预约时仍然需要请求 `searchSeats` 接口。

推荐策略：

- 平时或改需求前：偶尔运行 `npm run discover`，比如每周一次，或发现房间/座位变了再跑。
- 每次规划/预约：运行 `plan` 或 `reserve`，它们会实时查询目标时间段的座位状态。
- 20:00 抢座：不要全量扫描所有空间，尽量把请求文件写窄，比如指定 `categories`、`preferredRooms`，这样会更快。

简单说：`discover` 是地图册，`reserve` 是看实时空位。地图册不用天天重印，但空位必须现查。

## 3. 目录结构

```txt
library-seat-reserver/
  config.json
  config.example.json
  package.json
  README.md
  PROJECT_GUIDE.md
  storageState.json
  requests/
    default.json
    tomorrow-13-17-second-floor.json
  scripts/
    login.js
    lib.js
    discover.js
    plan.js
    reserve.js
  data/
    catalog.json
    latest-plan.json
  logs/
    run-*.log
    network-*.ndjson
```

重要文件说明：

- `storageState.json`：登录态文件，由 `npm run login` 生成，包含敏感登录状态，不要提交到 GitHub。
- `config.json`：全局默认配置，包括开放时间、轮询间隔、默认座位偏好等。
- `config.example.json`：公开仓库里的示例配置。新用户复制成 `config.json` 后再按自己需求修改。
- `requests/*.json`：每次预约的标准请求文件。
- `scripts/lib.js`：共享逻辑库，封装接口请求、时间计算、座位打分、提交预约等能力。
- `scripts/discover.js`：扫描空间分类、房间和座位，保存结构缓存。
- `scripts/plan.js`：根据请求文件规划座位，只推荐，不提交。
- `scripts/reserve.js`：根据请求文件轮询实时座位状态并提交预约。

## 4. 命令说明

首次登录：

```bash
cp config.example.json config.json
npm run login
```

扫描所有空间结构：

```bash
npm run discover
```

根据请求文件规划座位，不提交：

```bash
npm run plan -- --request requests/default.json
```

立即 dry-run，不提交：

```bash
npm run reserve -- --request requests/default.json --now --dry-run
```

立即正式预约：

```bash
npm run reserve -- --request requests/default.json --now
```

等待到开放时间正式预约：

```bash
npm run reserve -- --request requests/default.json
```

## 5. 请求文件格式

请求文件是标准 JSON，例如：

```json
{
  "date": "tomorrow",
  "startTime": "13:00",
  "durationHours": 4,
  "categories": "any",
  "preferredRooms": ["二楼东", "二楼西", "（二楼"],
  "fallbackRooms": "any",
  "preferSocket": false,
  "requireSocket": false
}
```

常用字段：

- `date`: `latest`、`today`、`tomorrow` 或 `YYYY-MM-DD`。
- `startTime`: 开始时间，例如 `13:00`。
- `durationHours`: 使用时长，例如 `4`。
- `categories`: 空间分类，例如 `["自习室"]`，也可以用 `"any"`。
- `preferredRooms`: 优先房间关键词，例如 `["宋韵云图（四楼）"]` 或 `["二楼东", "二楼西"]`。
- `fallbackRooms`: `"any"` 表示优先房间没座时全馆兜底。
- `seats`: 指定座位号列表，例如 `[27, 28, 29]`。
- `seatRange`: 指定座位范围，例如 `[17, 58]`。
- `preferredSeat`: 指定最优先座位，例如 `27`。
- `preferSocket`: 有插座加分。
- `requireSocket`: 必须有插座。
- `avoidRooms`: 排除房间关键词。
- `avoidSeats`: 排除座位号。
- `dateMode`: 日期策略，默认 `"strict"`。
- `allowDateFallback`: 指定日期未开放时，是否允许自动降级到最新开放日期，默认 `false`。
- `onDateUnavailable`: 日期不可预约时的动作，默认 `"fail_fast"`。
- `onNoSeat`: 没有可用座位时的动作，默认 `"try_fallback"`。

自然语言和 JSON 的关系：

```txt
你说：明天 13 点到 17 点，最好二楼，没位置就其他地方也行。

agent 生成：
{
  "date": "tomorrow",
  "startTime": "13:00",
  "durationHours": 4,
  "categories": "any",
  "preferredRooms": ["二楼东", "二楼西", "（二楼"],
  "fallbackRooms": "any"
}
```

## 6. 运行逻辑

### login.js

`login.js` 启动一个模拟 iPhone 的 Chromium 浏览器。你手动完成统一身份认证后，脚本保存浏览器登录态到 `storageState.json`。

这个步骤只需要在登录态失效时重新做。

### discover.js

`discover.js` 做结构扫描：

1. 请求 `/Space/Category/list?LAB_JSON=1`。
2. 解析空间分类，例如自习室、生活区、阅览室。
3. 对每个分类请求 `searchSeats`。
4. 解析房间、座位号、座位 ID、插座信息、座位图坐标。
5. 保存到 `data/catalog.json`。

这个命令不负责预约，只负责建立“地图册”。

### plan.js

`plan.js` 负责推荐：

1. 读取请求文件。
2. 查询目标日期和时间段的实时座位状态。
3. 提取所有可用座位。
4. 根据偏好打分。
5. 输出前若干个推荐座位。
6. 保存结果到 `data/latest-plan.json`。

它不会提交预约，适合调试需求。

### reserve.js

`reserve.js` 负责真正预约：

1. 读取请求文件。
2. 如果没有 `--now`，等到 `config.openTime` 前几秒。
3. 查询目标空间分类。
4. 轮询 `searchSeats`，获取实时座位状态。
5. 用同一套打分规则选出最佳候选。
6. 如果是 `--dry-run`，只打印候选，不提交。
7. 正式模式调用 `/Seat/Index/bookSeats`。
8. 如果成功，输出 bookingId；如果座位被抢，继续轮询尝试下一个候选。

## 7. 失败策略

当前默认策略是保守的：

```json
{
  "dateMode": "strict",
  "allowDateFallback": false,
  "onDateUnavailable": "fail_fast",
  "onNoSeat": "try_fallback"
}
```

日期不可预约：

- 如果请求 `latest`，程序会使用系统当前开放的最新日期。
- 如果请求 `today`、`tomorrow` 或 `YYYY-MM-DD`，程序会先检查这个日期是否在后端返回的可预约范围内。
- 如果不在范围内，默认立即失败，打印当前可预约日期范围，不会擅自改约其他日期。
- 如果显式设置 `allowDateFallback: true`，或 `onDateUnavailable: "fallback_latest"`，程序会自动降级到当前最新开放日期，并在日志里说明。

座位不可预约：

- 如果目标座位被抢，且请求文件里有 `seatRange`、`seats` 或 `fallbackRooms`，程序会继续查询实时状态，尝试下一个评分最高的候选。
- 如果一直没有候选，默认会轮询到超时，然后返回失败。
- 如果设置 `onNoSeat: "fail_fast"`，第一次发现没有候选座位时就会立即退出。

推荐保持默认值。日期代表强意图，默认不自动改日期；座位代表偏好，默认可以尝试备选。

## 8. 打分逻辑

程序会给每个可用座位计算一个分数，大致规则是：

- 命中 `preferredRooms` 的房间，大幅加分。
- 命中 `fallbackRooms` 的房间，中等加分。
- 有 `seatRange` 或 `seats` 时，按座位顺序加分。
- `preferSocket` 为 true 时，有插座加分。
- `requireSocket` 为 true 时，没有插座直接排除。
- `avoidRooms` 和 `avoidSeats` 命中的候选直接排除。

所以程序不是随机选座，而是按“偏好优先级”排序后选最优候选。

## 9. 性能和高峰期策略

20:00 高峰期网页容易卡，原因主要是：

- 前端页面和图片加载慢。
- 统一前端接口响应慢。
- 大量用户同时刷新。
- 浏览器点击和页面渲染有额外等待。

现在正式预约已经改为接口轮询版，不再依赖页面渲染。为了更快，可以进一步把请求文件写窄：

慢一些：

```json
{
  "categories": "any",
  "fallbackRooms": "any"
}
```

更快：

```json
{
  "categories": ["自习室"],
  "preferredRooms": ["宋韵云图（四楼）"]
}
```

最快：

```json
{
  "categories": ["自习室"],
  "preferredRooms": ["宋韵云图（四楼）"],
  "seats": [27, 28, 29]
}
```

范围越窄，需要查询和排序的候选越少，提交也越果断。但范围太窄时，目标被抢后可替代选项少。

## 10. agent 调用方式

这个项目很适合被 agent 调用。

推荐工作流：

1. 用户用自然语言描述需求。
2. agent 生成一个 `requests/*.json` 文件。
3. agent 运行 `npm run plan -- --request ...`。
4. 如果推荐结果符合需求，agent 运行 `npm run reserve -- --request ... --now` 或定时运行正式命令。
5. agent 总结预约结果。

用户不需要自己记命令，也不需要自己写 JSON。

## 11. 安全和边界

- 不要把 `storageState.json`、`.env`、日志中的敏感信息提交到 GitHub。
- 不建议高频攻击式请求，当前默认 `700ms` 轮询一次，已经足够快。
- 如果系统出现验证码，脚本不能也不应该绕过验证码，需要人工处理或改回浏览器辅助模式。
- 如果学校规则变化，例如限制预约次数、开放时间变化、接口签名变化，需要重新检查接口。

## 12. 推荐维护方式

平时：

```bash
npm run plan -- --request requests/default.json
```

确认登录态：

```bash
npm run reserve -- --request requests/default.json --now --dry-run
```

结构变化时：

```bash
npm run discover
```

正式预约：

```bash
npm run reserve -- --request requests/default.json
```

如果你只是临时变更需求，最好的方式是新建一个请求文件，而不是反复改 `config.json`。
