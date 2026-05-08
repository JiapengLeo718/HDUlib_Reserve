# HDU图书馆座位预约脚本

这是一个面向汇图智舒图书馆座位预约系统的 Playwright 自动化脚本。登录态仍然用手机浏览器保存，但正式预约时走接口轮询，避开 20:00 高峰期的页面渲染和转圈。

完整项目说明见 [PROJECT_GUIDE.md](PROJECT_GUIDE.md)。

## 安装

```bash
npm install
npx playwright install chromium
cp config.example.json config.json
```

`config.json` 是你的本地配置，已被 `.gitignore` 忽略。公开仓库里只保留 `config.example.json`。

## 第一次登录

```bash
npm run login
```

脚本会打开一个模拟 iPhone 的浏览器窗口。你手动完成学校统一身份认证并回到预约系统后，在终端按回车，它会把登录态保存到 `storageState.json`。

`storageState.json` 含登录状态，请勿上传到 GitHub。

每个使用者都需要用自己的学校账号运行一次 `npm run login`。

## 运行预约

扫描所有空间和座位：

```bash
npm run discover
```

按请求文件规划座位，不提交：

```bash
npm run plan -- --request requests/default.json
```

立即检查并规划，不提交：

```bash
npm run reserve -- --now --dry-run
```

立即执行并提交预约：

```bash
npm run reserve -- --now
```

正式运行：

```bash
npm run reserve
```

脚本会在 `20:00:00` 前几秒开始接口轮询。发现符合请求文件的可用座位时，会自动选择评分最高的座位提交。

指定请求文件：

```bash
npm run reserve -- --request requests/default.json
```

## 自动操作顺序

当前脚本按接口流程执行：

1. 读取已保存的登录态
2. 读取请求文件，比如 `requests/default.json`
3. 扫描目标空间分类和房间
4. 按房间、座位号、插座等偏好给可用座位打分
5. 轮询 `searchSeats` 获取实时座位状态
6. 正式运行时调用 `/Seat/Index/bookSeats` 提交预约

`--dry-run` 会打印将要预约/当前不可用的座位状态，但不会提交。

## 请求文件

请求文件是标准 JSON，适合由 agent 根据你的自然语言生成：

```json
{
  "date": "latest",
  "startTime": "12:00",
  "durationHours": 8,
  "categories": ["自习室"],
  "preferredRooms": ["宋韵云图（四楼）"],
  "fallbackRooms": "any",
  "preferredSeat": 17,
  "seatRange": [17, 58],
  "preferSocket": false,
  "requireSocket": false
}
```

常用字段：

- `date`: `latest`、`today`、`tomorrow` 或 `YYYY-MM-DD`
- `startTime`: 如 `09:00`
- `durationHours`: 如 `4`、`8`
- `categories`: `["自习室"]` 或 `"any"`
- `preferredRooms`: 优先房间，可以是房间名关键词
- `fallbackRooms`: `"any"` 表示优先房间没座时全馆兜底
- `seats`: 指定座位号列表，如 `[27, 28]`
- `seatRange`: 指定座位范围，如 `[17, 58]`
- `preferSocket`: 有插座加分
- `requireSocket`: 必须有插座
- `avoidRooms` / `avoidSeats`: 排除房间或座位
- `allowDateFallback`: 指定日期未开放时是否自动降级到最新开放日期，默认 `false`
- `onNoSeat`: 没有可用座位时的策略，默认 `try_fallback`

默认失败策略：

- 日期没开放：快速失败，打印当前可预约日期范围，不自动改日期
- 目标座位没了：继续尝试请求文件允许的备选座位，直到成功或轮询超时

## 当前配置

- 区域：宋韵云图（四楼）
- 优先座位：17
- 备用座位：18 到 58，按顺序尝试
- 时间段：12:00 到 20:00
- 使用时长：8 小时
- 预约开放时间：20:00:00
- 开放前 2 秒开始轮询
- 轮询间隔：700ms
- 最长轮询：45 秒
- 日期策略：严格模式，指定日期未开放时不自动降级

## 后续需要根据页面微调的地方

这个版本已经包含移动端模拟、登录态保存、等待开放时间、座位尝试和结果截图。由于真实页面的 DOM 结构和弹窗按钮还需要现场确认，第一次试跑时可能需要根据日志调整：

- `bookSeats` 接口是否要求图片验证码
- 20:00 放号瞬间是否需要增加重试频率
- 成功后的通知方式
