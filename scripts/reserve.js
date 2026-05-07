import {
  bookSeat,
  buildBookingParams,
  createApiContext,
  createLogger,
  DateUnavailableError,
  extractRooms,
  formatDate,
  formatDateTime,
  getCategories,
  getOrderInfo,
  parseArgs,
  readJson,
  scoreCandidates,
  searchSeats,
  selectCategories,
  shouldRetryBookingResult,
  waitUntilPollStart
} from './lib.js';

const config = await readJson(new URL('../config.json', import.meta.url));
const args = parseArgs();
const runNow = args.flags.has('now');
const dryRun = args.flags.has('dry-run');
const requestUrl = args.values.request
  ? new URL(args.values.request, `file://${process.cwd()}/`)
  : new URL('../requests/default.json', import.meta.url);
const req = await readJson(requestUrl);
const logger = createLogger('run');
const api = await createApiContext();
const onNoSeat = req.onNoSeat ?? config.onNoSeat ?? 'try_fallback';
const onDateUnavailable = req.onDateUnavailable ?? config.onDateUnavailable ?? 'fail_fast';

async function collectCandidates(categories) {
  const allCandidates = [];
  const bookings = [];

  for (const category of categories) {
    const orderInfo = await getOrderInfo(api, category, logger, config);
    const booking = buildBookingParams(orderInfo, category, req, config);
    bookings.push(booking);

    const searchData = await searchSeats(api, booking, logger, config);
    const rooms = extractRooms(searchData, category);
    const candidates = scoreCandidates(rooms, req, config).map((candidate) => ({
      ...candidate,
      booking
    }));
    allCandidates.push(...candidates);
  }

  allCandidates.sort((a, b) => b.score - a.score || Number(a.seat.title) - Number(b.seat.title));
  return { allCandidates, bookings };
}

async function reserveWithPolling(categories) {
  const intervalMs = config.poll?.intervalMs ?? 700;
  const maxDurationMs = config.poll?.durationMs ?? 45000;
  const deadline = Date.now() + (runNow ? (config.poll?.runNowDurationMs ?? maxDurationMs) : maxDurationMs);
  let attempt = 0;
  let lastSummary = '';
  let loggedTime = false;

  while (Date.now() <= deadline) {
    attempt += 1;
    try {
      const { allCandidates, bookings } = await collectCandidates(categories);
      if (!loggedTime && bookings[0]) {
        loggedTime = true;
        if (bookings[0].date?.fallbackApplied) {
          await logger.log([
            `请求日期 ${bookings[0].date.dateSpec} (${formatDate(bookings[0].date.requestedDateEpoch, config.timezone)}) 当前不可预约。`,
            `已按配置降级到最新开放日期：${formatDate(bookings[0].date.dateEpoch, config.timezone)}。`
          ].join(' '));
        }
        await logger.log(`目标预约时间：${formatDateTime(bookings[0].beginTime, config.timezone)}，时长 ${bookings[0].duration / 3600} 小时`);
      }

      const summary = allCandidates
        .slice(0, 8)
        .map((candidate) => `${candidate.room.title}/${candidate.seat.title}`)
        .join(', ');
      if (summary !== lastSummary || attempt % 10 === 1) {
        lastSummary = summary;
        await logger.log(`第 ${attempt} 次：可用候选 ${allCandidates.length} 个${summary ? `，Top: ${summary}` : ''}`);
      }

      const candidate = allCandidates[0];
      if (candidate) {
        await logger.log(`选择候选：${candidate.room.category.name} - ${candidate.room.title} ${candidate.seat.title}号，seatId=${candidate.seat.id}，score=${candidate.score}`);
        if (dryRun) {
          await logger.log('收到 --dry-run，已跳过接口提交预约。');
          return { ok: true, dryRun: true, candidate };
        }

        const result = await bookSeat(api, candidate.booking, candidate, logger, config);
        await logger.log(`预约接口返回：${JSON.stringify(result)}`);
        if (result?.CODE === 'ok' && result?.DATA?.result === 'success') {
          await logger.log(`预约成功：${candidate.room.title} ${candidate.seat.title}号`);
          return { ok: true, candidate, result };
        }

        if (!shouldRetryBookingResult(result)) {
          await logger.log('预约接口返回不可自动重试的结果，已停止。');
          return { ok: false, candidate, result };
        }

        await logger.log(`座位 ${candidate.seat.title} 提交失败，将继续轮询尝试。`);
      } else if (onNoSeat === 'fail_fast') {
        await logger.log('没有符合条件的可用座位，onNoSeat=fail_fast，立即停止。');
        return { ok: false, noSeat: true };
      }
    } catch (error) {
      if (error instanceof DateUnavailableError || error.code === 'DATE_UNAVAILABLE') {
        await logger.log(error.message);
        await logger.log(`onDateUnavailable=${onDateUnavailable}，已停止预约。`);
        return { ok: false, dateUnavailable: true, error };
      }
      await logger.log(`第 ${attempt} 次轮询异常：${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  await logger.log(`轮询结束，未预约到符合条件的座位。onNoSeat=${onNoSeat}`);
  return { ok: false, timeout: true };
}

try {
  await logger.log(`使用请求文件：${requestUrl.pathname}`);
  await waitUntilPollStart({ config, runNow, log: logger.log });
  const categories = selectCategories(await getCategories(api, logger, config), req, config);
  await logger.log(`目标空间分类：${categories.map((category) => category.name).join(', ')}`);
  const result = await reserveWithPolling(categories);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  await logger.log(`脚本异常：${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  await api.dispose();
}
