import {
  createApiContext,
  createLogger,
  extractRooms,
  formatDateTime,
  getCategories,
  getOrderInfo,
  readJson,
  searchSeats,
  selectCategories,
  buildBookingParams,
  writeJson
} from './lib.js';

const config = await readJson(new URL('../config.json', import.meta.url));
const logger = createLogger('discover');
const api = await createApiContext();

try {
  const request = await readJson(new URL('../requests/default.json', import.meta.url));
  const categories = await getCategories(api, logger, config);
  const selectedCategories = selectCategories(categories, { categories: 'any' }, config);
  const catalog = {
    scannedAt: new Date().toISOString(),
    categories,
    rooms: []
  };

  await logger.log(`发现空间分类：${categories.map((item) => `${item.name}(${item.content_id})`).join(', ')}`);

  for (const category of selectedCategories) {
    try {
      const orderInfo = await getOrderInfo(api, category, logger, config);
      const booking = buildBookingParams(orderInfo, category, request, config);
      const searchData = await searchSeats(api, booking, logger, config);
      const rooms = extractRooms(searchData, category).map((room) => ({
        ...room,
        booking: {
          beginTime: booking.beginTime,
          duration: booking.duration,
          label: formatDateTime(booking.beginTime, config.timezone)
        },
        seatStats: {
          total: room.seats.length,
          available: room.seats.filter((seat) => seat.state === 0).length,
          withSocket: room.seats.filter((seat) => seat.have_socket).length
        }
      }));
      catalog.rooms.push(...rooms);
      await logger.log(`${category.name}：扫描到 ${rooms.length} 个房间，${rooms.reduce((sum, room) => sum + room.seats.length, 0)} 个座位。`);
    } catch (error) {
      await logger.log(`${category.name} 扫描失败：${error.message}`);
    }
  }

  await writeJson(new URL('../data/catalog.json', import.meta.url), catalog);
  await logger.log(`已保存扫描结果：data/catalog.json`);
} finally {
  await api.dispose();
}
