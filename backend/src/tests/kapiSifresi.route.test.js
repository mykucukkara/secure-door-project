jest.mock('../config/prisma', () => ({
  kullanici: { findUnique: jest.fn() }
}));
jest.mock('../services/pinService', () => ({
  refreshSingleUserPin: jest.fn(),
  generateUniquePin: jest.fn(),
  validateCustomPin: jest.fn(),
  isPinInUse: jest.fn(),
  setUserPin: jest.fn(),
  getCurrentPin: jest.fn()
}));
jest.mock('../services/auditService', () => ({ writeAudit: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const pinService = require('../services/pinService');
const { JWT_SECRET } = require('../middlewares/authMiddleware');
const kullaniciRotalari = require('../routes/kullanicilar');

const app = express();
app.use(express.json());
app.use('/api/kullanicilar', kullaniciRotalari);

function tokenFor(id, rol = 'hoca') {
  prisma.kullanici.findUnique.mockResolvedValue({
    kullaniciId: BigInt(id), eposta: 'hoca@subu.edu.tr', rol, durum: 'aktif', oturumSurumu: 0
  });
  return jwt.sign({ kullaniciId: String(id), rol, oturumSurumu: 0 }, JWT_SECRET);
}

describe('Profil kapı şifresi uç noktaları', () => {
  beforeEach(() => jest.clearAllMocks());

  test('kullanıcı kendi şifresini görebilir', async () => {
    const token = tokenFor(7);
    pinService.getCurrentPin.mockResolvedValue({ pin: '482913', kalici: true });
    const res = await request(app).get('/api/kullanicilar/7/kapi-sifresi').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pin).toBe('482913');
  });

  test('kullanıcı başkasının şifresini göremez', async () => {
    const token = tokenFor(7);
    const res = await request(app).get('/api/kullanicilar/8/kapi-sifresi').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(pinService.getCurrentPin).not.toHaveBeenCalled();
  });

  test('şifre tekrarı eşleşmezse 400 döner', async () => {
    const token = tokenFor(7);
    const res = await request(app)
      .put('/api/kullanicilar/7/kapi-sifresi')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '482913', pinTekrar: '482914' });
    expect(res.status).toBe(400);
    expect(pinService.setUserPin).not.toHaveBeenCalled();
  });

  test('kullanıcı kendi şifresini belirleyebilir', async () => {
    const token = tokenFor(7);
    pinService.setUserPin.mockResolvedValue({ yeniPin: '482913', kalici: true });
    const res = await request(app)
      .put('/api/kullanicilar/7/kapi-sifresi')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '482913', pinTekrar: '482913' });
    expect(res.status).toBe(200);
    expect(pinService.setUserPin).toHaveBeenCalledWith('7', { pin: '482913', kaynak: 'kullanici' });
  });

  test('politika hatası kullanıcıya anlaşılır mesajla döner', async () => {
    const token = tokenFor(7);
    const err = new Error('Bu kapı şifresi kullanılamıyor.');
    err.statusCode = 409;
    pinService.setUserPin.mockRejectedValue(err);
    const res = await request(app)
      .put('/api/kullanicilar/7/kapi-sifresi')
      .set('Authorization', `Bearer ${token}`)
      .send({ rastgele: true });
    expect(res.status).toBe(409);
    expect(res.body.hata).toMatch(/kullanılamıyor/);
  });
});
