jest.mock('../config/prisma', () => {
  const client = {
    kullanici: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    kapiSifreGecmisi: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    cihaz: { findMany: jest.fn() },
    cihazKapiAtama: { findFirst: jest.fn() },
    yetkiKurali: { findMany: jest.fn() },
    offlineListeSurumu: { create: jest.fn() }
  };
  client.$transaction = jest.fn(async (fn) => fn(client));
  return client;
});

jest.mock('../services/mqttService', () => ({
  publishCommand: jest.fn(() => true)
}));

const argon2 = require('argon2');
const prisma = require('../config/prisma');
const { encryptPin } = require('../services/pinHistoryService');
const pinService = require('../services/pinService');
const { normalizeKartUid } = require('../utils/kartUid');

describe('Kapı şifresi politikası', () => {
  test.each([
    ['12345', false],
    ['1234567', false],
    ['12a456', false],
    ['111111', false],
    ['123456', false],
    ['654321', false],
    ['112233', false],
    ['482913', true],
    ['907315', true]
  ])('%s geçerli mi → %s', (pin, expected) => {
    expect(pinService.validateCustomPin(pin).valid).toBe(expected);
  });

  test('rastgele üretilen PIN her zaman politikaya uyar', () => {
    for (let i = 0; i < 200; i += 1) {
      const pin = pinService.generateRandomPin();
      expect(pinService.validateCustomPin(pin).valid).toBe(true);
    }
  });

  test('otomatik yenileme varsayılan olarak kapalıdır', () => {
    delete process.env.PIN_OTOMATIK_YENILEME;
    expect(pinService.isAutoRotationEnabled()).toBe(false);
    process.env.PIN_OTOMATIK_YENILEME = 'true';
    expect(pinService.isAutoRotationEnabled()).toBe(true);
    delete process.env.PIN_OTOMATIK_YENILEME;
  });
});

describe('setUserPin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.kullanici.findUnique.mockResolvedValue({ kullaniciId: 5n, durum: 'aktif' });
    prisma.kapiSifreGecmisi.findFirst.mockResolvedValue(null);
    prisma.kullanici.findMany.mockResolvedValue([]);
    prisma.cihaz.findMany.mockResolvedValue([]);
  });

  test('kullanıcının belirlediği PIN süresiz olarak kaydedilir', async () => {
    const result = await pinService.setUserPin(5, { pin: '482913', kaynak: 'kullanici' });

    expect(result.yeniPin).toBe('482913');
    expect(result.kalici).toBe(true);
    expect(result.gecerlilikBitis).toBeNull();
    const updateArgs = prisma.kullanici.update.mock.calls[0][0];
    expect(updateArgs.data.pinGecerlilikBitis).toBeNull();
    const historyArgs = prisma.kapiSifreGecmisi.create.mock.calls[0][0];
    expect(historyArgs.data.gecerlilikBitis).toBeNull();
    expect(historyArgs.data.kaynak).toBe('kullanici');
  });

  test('zayıf PIN reddedilir', async () => {
    await expect(pinService.setUserPin(5, { pin: '123456' })).rejects.toThrow(/Ardışık/);
    expect(prisma.kullanici.update).not.toHaveBeenCalled();
  });

  test('başka kullanıcıda tanımlı PIN reddedilir', async () => {
    const otherHash = await argon2.hash('482913');
    prisma.kullanici.findMany.mockResolvedValue([{ kullaniciId: 9n, pinHash: otherHash }]);
    await expect(pinService.setUserPin(5, { pin: '482913' })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('mevcut PIN ile aynı şifre reddedilir', async () => {
    prisma.kapiSifreGecmisi.findFirst.mockResolvedValue({
      kapiSifreId: 1n, aktif: true, pinSifreli: encryptPin('482913'), olusturulma: new Date()
    });
    await expect(pinService.setUserPin(5, { pin: '482913' })).rejects.toThrow(/aynı olamaz/);
  });

  test('getCurrentPin şifreli geçmişten güncel PIN\'i çözer', async () => {
    prisma.kullanici.findUnique.mockResolvedValue({
      kullaniciId: 5n, pinHash: 'x', pinSonDegisim: new Date('2026-09-01'), pinGecerlilikBitis: null
    });
    prisma.kapiSifreGecmisi.findFirst.mockResolvedValue({
      kapiSifreId: 1n, aktif: true, pinSifreli: encryptPin('907315'), kaynak: 'kullanici', olusturulma: new Date()
    });
    const result = await pinService.getCurrentPin(5);
    expect(result.pin).toBe('907315');
    expect(result.kalici).toBe(true);
    expect(result.gorunebilir).toBe(true);
  });
});

describe('Kart UID normalizasyonu', () => {
  test.each([
    ['04:a1:b2:c3', '04:A1:B2:C3'],
    ['04A1B2C3', '04:A1:B2:C3'],
    ['04 a1 b2 c3', '04:A1:B2:C3'],
    ['04-A1-B2-C3-D4-E5-F6', '04:A1:B2:C3:D4:E5:F6'],
    ['04A1B2', null],
    ['zz', null],
    ['', null]
  ])('%s → %s', (input, expected) => {
    expect(normalizeKartUid(input)).toBe(expected);
  });
});
