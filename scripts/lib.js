import { request } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BASE_URL = 'https://hdu.huitu.zhishulib.com';
export const USER_AGENT = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  'AppleWebKit/605.1.15 (KHTML, like Gecko)',
  'Version/17.0 Mobile/15E148 Safari/604.1'
].join(' ');

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const storageStatePath = fileURLToPath(new URL('../storageState.json', import.meta.url));

export async function readJson(pathOrUrl) {
  return JSON.parse(await readFile(pathOrUrl, 'utf8'));
}

export async function writeJson(pathOrUrl, value) {
  await mkdir(new URL('.', pathOrUrl), { recursive: true }).catch(() => {});
  await writeFile(pathOrUrl, `${JSON.stringify(value, null, 2)}\n`);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { flags: new Set(), values: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.values[key] = next;
      index += 1;
    } else {
      args.flags.add(key);
    }
  }
  return args;
}

export function formatStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

export function createLogger(prefix = 'run') {
  const stamp = formatStamp();
  const logUrl = new URL(`../logs/${prefix}-${stamp}.log`, import.meta.url);
  const networkUrl = new URL(`../logs/network-${stamp}.ndjson`, import.meta.url);

  return {
    stamp,
    logUrl,
    networkUrl,
    async log(message) {
      await mkdir(new URL('../logs/', import.meta.url), { recursive: true });
      const line = `[${new Date().toISOString()}] ${message}`;
      console.log(line);
      await writeFile(logUrl, `${line}\n`, { flag: 'a' });
    },
    async network(entry, includePayload = false) {
      await mkdir(new URL('../logs/', import.meta.url), { recursive: true });
      const payload = {
        time: new Date().toISOString(),
        ...entry
      };
      if (!includePayload) delete payload.body;
      await writeFile(networkUrl, `${JSON.stringify(payload)}\n`, { flag: 'a' }).catch(() => {});
    }
  };
}

export function startTimeSeconds(timeText) {
  const parts = String(timeText).split(':').map(Number);
  const hour = parts[0] ?? 0;
  const minute = parts[1] ?? 0;
  const second = parts[2] ?? 0;
  return hour * 3600 + minute * 60 + second;
}

export function localDateToEpoch(dateText) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  if (!year || !month || !day) throw new Error(`日期格式应为 YYYY-MM-DD：${dateText}`);
  return Math.floor((Date.UTC(year, month - 1, day) - 8 * 3600 * 1000) / 1000);
}

export function dateKeywordToEpoch(keyword) {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  local.setHours(0, 0, 0, 0);
  if (keyword === 'today') return Math.floor(local.getTime() / 1000);
  if (keyword === 'tomorrow') {
    local.setDate(local.getDate() + 1);
    return Math.floor(local.getTime() / 1000);
  }
  throw new Error(`不支持的日期关键字：${keyword}`);
}

export function formatDateTime(seconds, timezone = 'Asia/Shanghai') {
  const numericSeconds = Number(seconds);
  if (!Number.isFinite(numericSeconds)) return `无效时间(${seconds})`;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(numericSeconds * 1000));
}

export function formatDate(seconds, timezone = 'Asia/Shanghai') {
  const numericSeconds = Number(seconds);
  if (!Number.isFinite(numericSeconds)) return `无效日期(${seconds})`;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(numericSeconds * 1000));
}

export class DateUnavailableError extends Error {
  constructor({ dateSpec, requestedDateEpoch, minDateEpoch, maxDateEpoch, category, timezone }) {
    const rangeText = minDateEpoch && maxDateEpoch
      ? `${formatDate(minDateEpoch, timezone)} 到 ${formatDate(maxDateEpoch, timezone)}`
      : '未知';
    super([
      `请求日期尚未开放或不在可预约范围内：${dateSpec} (${formatDate(requestedDateEpoch, timezone)})。`,
      `当前${category?.name ? `「${category.name}」` : ''}可预约日期范围：${rangeText}。`
    ].join(' '));
    this.name = 'DateUnavailableError';
    this.code = 'DATE_UNAVAILABLE';
    this.dateSpec = dateSpec;
    this.requestedDateEpoch = requestedDateEpoch;
    this.minDateEpoch = minDateEpoch;
    this.maxDateEpoch = maxDateEpoch;
  }
}

export function msUntilTodayTime(timeText, earlySeconds = 0) {
  const [hour, minute, second = '0'] = String(timeText).split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, second, 0);
  target.setSeconds(target.getSeconds() - earlySeconds);
  return target.getTime() - now.getTime();
}

export async function waitUntilPollStart({ config, runNow, log }) {
  if (runNow) {
    await log('收到 --now，立即开始接口轮询。');
    return;
  }
  const earlySeconds = config.poll?.startSecondsBeforeOpen ?? 2;
  const ms = msUntilTodayTime(config.openTime, earlySeconds);
  if (ms <= 0) {
    await log('当前已到达轮询窗口，立即开始。');
    return;
  }
  await log(`等待到 ${config.openTime} 前 ${earlySeconds} 秒开始轮询，约 ${Math.ceil(ms / 1000)} 秒后开始。`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createApiContext() {
  if (!existsSync(storageStatePath)) {
    throw new Error('缺少 storageState.json。请先运行 npm run login 保存登录态。');
  }
  return request.newContext({
    baseURL: BASE_URL,
    storageState: storageStatePath,
    userAgent: USER_AGENT,
    extraHTTPHeaders: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/#!/Space/Category/list`
    }
  });
}

export function buildSearchParams(spaceCategory) {
  return new URLSearchParams({
    'space_category[category_id]': String(spaceCategory.category_id),
    'space_category[content_id]': String(spaceCategory.content_id),
    LAB_JSON: '1'
  });
}

export async function readJsonResponse(response, label, logger, config) {
  const text = await response.text();
  await logger?.network?.({
    type: 'response',
    label,
    status: response.status(),
    url: response.url(),
    body: text.slice(0, 4000)
  }, config?.capturePayloads);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 返回不是 JSON：${text.slice(0, 200)}`);
  }
}

export async function getCategories(api, logger, config) {
  const path = '/Space/Category/list?LAB_JSON=1';
  await logger?.network?.({ type: 'request', label: 'categories', method: 'GET', url: path }, config?.capturePayloads);
  const response = await api.get(path, { timeout: config?.poll?.requestTimeoutMs ?? 8000 });
  if (!response.ok()) throw new Error(`获取空间分类失败：HTTP ${response.status()}`);
  const json = await readJsonResponse(response, 'categories', logger, config);
  const categories = [];

  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.ui_type === 'ht.space.SpaceReservationListItem' && value.link?.url) {
      const url = new URL(value.link.url, BASE_URL);
      categories.push({
        name: value.name,
        desc: value.desc ?? '',
        category_id: url.searchParams.get('space_category[category_id]'),
        content_id: url.searchParams.get('space_category[content_id]')
      });
    }
    for (const child of Object.values(value)) walk(child);
  }

  walk(json);
  return categories;
}

export function selectCategories(allCategories, req, config) {
  const requested = req.categories ?? req.category ?? config.defaultCategories ?? config.defaultCategory;
  const values = Array.isArray(requested) ? requested : requested ? [requested] : [config.defaultCategory ?? '自习室'];
  if (values.includes('any') || values.includes('*')) return allCategories;
  const selected = allCategories.filter((category) => values.some((value) => {
    const text = String(value);
    return category.name === text || category.name.includes(text) || category.content_id === text;
  }));
  return selected.length ? selected : allCategories.filter((category) => category.name === '自习室');
}

export async function getOrderInfo(api, category, logger, config) {
  const path = `/Seat/Index/searchSeats?${buildSearchParams(category).toString()}`;
  await logger?.network?.({ type: 'request', label: 'order-info', method: 'GET', url: path }, config?.capturePayloads);
  const response = await api.get(path, { timeout: config?.poll?.requestTimeoutMs ?? 8000 });
  if (!response.ok()) throw new Error(`获取预约配置失败：HTTP ${response.status()}`);
  return readJsonResponse(response, 'order-info', logger, config);
}

export function resolveBookingDate(orderData, category, req, config) {
  const dateSpec = req.date ?? config.date ?? 'latest';
  const minDateEpoch = Number(orderData?.data?.range?.min_date);
  const maxDateEpoch = Number(orderData?.data?.range?.max_date);
  let requestedDateEpoch;

  if (dateSpec === 'latest') {
    requestedDateEpoch = maxDateEpoch;
  } else if (dateSpec === 'today' || dateSpec === 'tomorrow') {
    requestedDateEpoch = dateKeywordToEpoch(dateSpec);
  } else {
    requestedDateEpoch = localDateToEpoch(dateSpec);
  }

  if (!requestedDateEpoch || !maxDateEpoch) {
    throw new Error(`预约配置缺少日期范围：requested=${requestedDateEpoch}, max=${maxDateEpoch}`);
  }

  const explicitDate = dateSpec !== 'latest';
  const outsideRange = explicitDate && (
    (minDateEpoch && requestedDateEpoch < minDateEpoch) ||
    (maxDateEpoch && requestedDateEpoch > maxDateEpoch)
  );

  if (!outsideRange) {
    return {
      dateEpoch: requestedDateEpoch,
      requestedDateEpoch,
      minDateEpoch,
      maxDateEpoch,
      dateSpec,
      fallbackApplied: false
    };
  }

  const onDateUnavailable = req.onDateUnavailable ?? config.onDateUnavailable ?? 'fail_fast';
  const dateMode = req.dateMode ?? config.dateMode ?? 'strict';
  const allowDateFallback = Boolean(req.allowDateFallback ?? config.allowDateFallback ?? false);
  const shouldFallback = allowDateFallback ||
    dateMode === 'latest' ||
    dateMode === 'fallback_latest' ||
    onDateUnavailable === 'fallback_latest' ||
    onDateUnavailable === 'use_latest';

  if (shouldFallback) {
    return {
      dateEpoch: maxDateEpoch,
      requestedDateEpoch,
      minDateEpoch,
      maxDateEpoch,
      dateSpec,
      fallbackApplied: true
    };
  }

  throw new DateUnavailableError({
    dateSpec,
    requestedDateEpoch,
    minDateEpoch,
    maxDateEpoch,
    category,
    timezone: config.timezone
  });
}

export function buildBookingParams(orderData, category, req, config) {
  const date = resolveBookingDate(orderData, category, req, config);
  const userId = orderData?.data?.uid;
  if (!date.dateEpoch || !userId) {
    throw new Error(`预约配置缺少日期或 uid：date=${date.dateEpoch}, uid=${userId}`);
  }

  const startTime = req.startTime ?? config.startTime;
  const durationHours = Number(req.durationHours ?? config.durationHours);
  return {
    beginTime: Number(date.dateEpoch) + Number(startTimeSeconds(startTime)),
    duration: durationHours * 3600,
    num: Number(req.num ?? 1),
    userId,
    category,
    date,
    startTime,
    durationHours
  };
}

export async function searchSeats(api, booking, logger, config) {
  const form = {
    beginTime: String(booking.beginTime),
    duration: String(booking.duration),
    num: String(booking.num),
    'space_category[category_id]': String(booking.category.category_id),
    'space_category[content_id]': String(booking.category.content_id)
  };

  await logger?.network?.({
    type: 'request',
    label: 'search-seats',
    method: 'POST',
    url: '/Seat/Index/searchSeats?LAB_JSON=1',
    body: form
  }, config?.capturePayloads);

  const response = await api.post('/Seat/Index/searchSeats?LAB_JSON=1', {
    form,
    timeout: config?.poll?.requestTimeoutMs ?? 8000
  });
  if (!response.ok()) throw new Error(`查询座位失败：HTTP ${response.status()}`);
  return readJsonResponse(response, 'search-seats', logger, config);
}

export function extractRooms(searchData, category) {
  const rooms = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.info?.title && Array.isArray(value.POIs)) {
      rooms.push({
        category,
        id: value.info.id,
        title: value.info.title,
        width: Number(value.info.width),
        height: Number(value.info.height),
        plan: value.info.plan,
        seats: value.POIs.map((seat) => ({
          id: String(seat.id),
          title: String(seat.title),
          state: Number(seat.state),
          x: Number(seat.x),
          y: Number(seat.y),
          w: Number(seat.w),
          h: Number(seat.h),
          have_socket: Number(seat.have_socket ?? 0),
          raw: seat
        }))
      });
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(searchData);
  const seen = new Set();
  return rooms.filter((room) => {
    const key = `${room.category.content_id}:${room.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildSeatOrder(req, config) {
  if (Array.isArray(req.seats) && req.seats.length) return req.seats.map(String);
  const range = req.seatRange ?? req.fallbackSeatRange;
  const preferred = req.preferredSeat;
  if (!range) return null;
  const [from, to] = range;
  const seats = [];
  for (let seat = Number(from); seat <= Number(to); seat += 1) {
    if (String(seat) !== String(preferred)) seats.push(String(seat));
  }
  return preferred ? [String(preferred), ...seats] : seats;
}

function listValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function matchesAny(text, values) {
  if (!values.length) return false;
  return values.some((value) => text === value || matchesKeyword(text, value));
}

function matchesKeyword(text, value) {
  if (!text.includes(value)) return false;
  if (!/^[一二三四五六七八九十]+楼$/.test(value)) return true;

  let index = text.indexOf(value);
  while (index >= 0) {
    const previous = index > 0 ? text[index - 1] : '';
    if (!/[一二三四五六七八九十]/.test(previous)) return true;
    index = text.indexOf(value, index + value.length);
  }
  return false;
}

export function scoreCandidates(rooms, req, config) {
  const seatOrder = buildSeatOrder(req, config);
  const seatRank = new Map((seatOrder ?? []).map((seat, index) => [String(seat), index]));
  const preferredRooms = listValue(req.preferredRooms ?? req.rooms ?? config.area);
  const fallbackRooms = req.fallbackRooms === 'any' ? [] : listValue(req.fallbackRooms);
  const avoidRooms = listValue(req.avoidRooms);
  const requireSocket = Boolean(req.requireSocket);
  const preferSocket = Boolean(req.preferSocket);
  const roomKeywords = listValue(req.roomKeywords);
  const avoidSeats = new Set(listValue(req.avoidSeats));

  const candidates = [];
  for (const room of rooms) {
    if (avoidRooms.length && matchesAny(room.title, avoidRooms)) continue;
    const preferredRoomMatch = preferredRooms.length && matchesAny(room.title, preferredRooms);
    const fallbackRoomMatch = fallbackRooms.length && matchesAny(room.title, fallbackRooms);
    const keywordMatch = roomKeywords.length && matchesAny(room.title, roomKeywords);
    if (preferredRooms.length && !preferredRoomMatch && req.fallbackRooms !== 'any' && !fallbackRoomMatch && !keywordMatch) {
      continue;
    }

    for (const seat of room.seats) {
      if (seat.state !== 0) continue;
      if (avoidSeats.has(String(seat.title))) continue;
      if (seatOrder && !seatRank.has(String(seat.title))) continue;
      if (requireSocket && !seat.have_socket) continue;

      let score = 0;
      if (preferredRoomMatch) score += 10000;
      if (fallbackRoomMatch) score += 5000;
      if (keywordMatch) score += 1000;
      if (preferSocket && seat.have_socket) score += 250;
      if (seatRank.has(String(seat.title))) score += Math.max(0, 1000 - seatRank.get(String(seat.title)));
      score += Number(seat.title) ? Math.max(0, 300 - Number(seat.title)) / 100 : 0;

      candidates.push({ room, seat, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || Number(a.seat.title) - Number(b.seat.title));
}

export function createApiToken({ apiTime, beginTime, duration, userId, seatId, isRecommend = 0 }) {
  const raw = [
    `post&/Seat/Index/bookSeats?LAB_JSON=1&api_time${apiTime}`,
    `&beginTime${beginTime}`,
    `&duration${duration}`,
    `&is_recommend${isRecommend}`,
    `&seatBookers[0]${parseInt(userId, 10)}`,
    `&seats[0]${seatId}`
  ].join('');
  const md5 = createHash('md5').update(raw).digest('hex');
  return Buffer.from(md5).toString('base64');
}

export async function bookSeat(api, booking, candidate, logger, config) {
  const apiTime = Math.floor(Date.now() / 1000);
  const token = createApiToken({
    apiTime,
    beginTime: booking.beginTime,
    duration: booking.duration,
    userId: booking.userId,
    seatId: candidate.seat.id,
    isRecommend: 0
  });

  const form = {
    beginTime: String(booking.beginTime),
    duration: String(booking.duration),
    is_recommend: '0',
    api_time: String(apiTime),
    'seatBookers[0]': String(parseInt(booking.userId, 10)),
    'seats[0]': String(candidate.seat.id)
  };

  await logger?.network?.({
    type: 'request',
    label: 'book-seat',
    method: 'POST',
    url: `/Seat/Index/bookSeats?LAB_JSON=1&api_time=${apiTime}`,
    body: { ...form, token }
  }, config?.capturePayloads);

  const response = await api.post(`/Seat/Index/bookSeats?LAB_JSON=1&api_time=${apiTime}`, {
    form,
    headers: { 'Api-Token': token },
    timeout: config?.poll?.requestTimeoutMs ?? 8000
  });
  if (!response.ok()) throw new Error(`提交预约失败：HTTP ${response.status()}`);
  return readJsonResponse(response, 'book-seat', logger, config);
}

export function shouldRetryBookingResult(result) {
  const message = `${result?.MESSAGE ?? ''} ${result?.DATA?.msg ?? ''}`;
  return /已被预约|不可预约|被占用|座位/.test(message);
}
