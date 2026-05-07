import {
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
  searchSeats,
  scoreCandidates,
  selectCategories,
  writeJson
} from './lib.js';

const config = await readJson(new URL('../config.json', import.meta.url));
const args = parseArgs();
const requestUrl = args.values.request
  ? new URL(args.values.request, `file://${process.cwd()}/`)
  : new URL('../requests/default.json', import.meta.url);
const req = await readJson(requestUrl);
const logger = createLogger('plan');
const api = await createApiContext();
const onDateUnavailable = req.onDateUnavailable ?? config.onDateUnavailable ?? 'fail_fast';

try {
  const categories = selectCategories(await getCategories(api, logger, config), req, config);
  const allCandidates = [];
  const scans = [];

  for (const category of categories) {
    const orderInfo = await getOrderInfo(api, category, logger, config);
    const booking = buildBookingParams(orderInfo, category, req, config);
    if (booking.date?.fallbackApplied) {
      await logger.log([
        `请求日期 ${booking.date.dateSpec} (${formatDate(booking.date.requestedDateEpoch, config.timezone)}) 当前不可预约。`,
        `已按配置降级到最新开放日期：${formatDate(booking.date.dateEpoch, config.timezone)}。`
      ].join(' '));
    }
    const searchData = await searchSeats(api, booking, logger, config);
    const rooms = extractRooms(searchData, category);
    const candidates = scoreCandidates(rooms, req, config);
    scans.push({
      category,
      booking: {
        beginTime: booking.beginTime,
        duration: booking.duration,
        label: formatDateTime(booking.beginTime, config.timezone)
      },
      rooms: rooms.length,
      candidates: candidates.length
    });
    for (const candidate of candidates) allCandidates.push({ ...candidate, booking });
  }

  allCandidates.sort((a, b) => b.score - a.score || Number(a.seat.title) - Number(b.seat.title));
  const top = allCandidates.slice(0, Number(args.values.limit ?? 20)).map((candidate, index) => ({
    rank: index + 1,
    score: candidate.score,
    category: candidate.room.category.name,
    room: candidate.room.title,
    seat: candidate.seat.title,
    seatId: candidate.seat.id,
    hasSocket: Boolean(candidate.seat.have_socket),
    time: formatDateTime(candidate.booking.beginTime, config.timezone),
    durationHours: candidate.booking.duration / 3600
  }));

  await writeJson(new URL('../data/latest-plan.json', import.meta.url), {
    plannedAt: new Date().toISOString(),
    request: req,
    scans,
    top
  });

  if (!top.length) {
    await logger.log('没有找到符合条件的可用座位。');
  } else {
    await logger.log(`推荐前 ${top.length} 个座位：`);
    for (const item of top.slice(0, 10)) {
      await logger.log(`#${item.rank} ${item.room} ${item.seat}号 ${item.hasSocket ? '带插座' : '无插座'} score=${item.score}`);
    }
  }
  await logger.log('已保存规划结果：data/latest-plan.json');
} catch (error) {
  if (error instanceof DateUnavailableError || error.code === 'DATE_UNAVAILABLE') {
    await logger.log(error.message);
    await logger.log(`onDateUnavailable=${onDateUnavailable}，已停止规划。`);
  } else {
    await logger.log(`规划异常：${error.stack || error.message}`);
  }
  process.exitCode = 1;
} finally {
  await api.dispose();
}
