const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const request = require('supertest');
const app = require('../index');
const prisma = require('../config/prisma');
const argon2 = require('argon2');

describe('Login Testi', () => {
  const stamp = Date.now();
  const normalEmail = `test_login_${stamp}@example.com`;
  const expiredEmail = `test_login_expired_${stamp}@example.com`;
  const webPassword = 'GirisTesti2026';
  const doorPin = '482913';

  beforeAll(async () => {
    await prisma.kullanici.create({
      data: {
        ad: 'Test',
        soyad: 'Kullanici',
        eposta: normalEmail,
        sifreHash: await argon2.hash(webPassword),
        pinHash: await argon2.hash(doorPin),
        rol: 'hoca',
        durum: 'aktif'
      }
    });
    await prisma.kullanici.create({
      data: {
        ad: 'Suresi',
        soyad: 'Dolmus',
        eposta: expiredEmail,
        sifreHash: await argon2.hash(webPassword),
        sifreDegistirmeZorunlu: true,
        sifreGecerlilikBitis: new Date(Date.now() - 60 * 1000),
        rol: 'hoca',
        durum: 'aktif'
      }
    });
  });

  afterAll(async () => {
    await prisma.kullanici.deleteMany({ where: { eposta: { in: [normalEmail, expiredEmail] } } });
  });

  test('doğru e-posta ve web şifresiyle giriş yapılıp token alınabilmeli', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ eposta: normalEmail.toUpperCase(), pin: webPassword });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.sifreDegistirmeZorunlu).toBe(false);
  });

  test('kapı PIN\'i web şifresi yerine kullanılamamalı', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ eposta: normalEmail, pin: doorPin });
    expect(res.statusCode).toEqual(401);
  });

  test('olmayan hesap ile hatalı şifre aynı mesajı vermeli', async () => {
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ eposta: `yok_${stamp}@example.com`, pin: 'Herhangi2026' });
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ eposta: normalEmail, pin: 'YanlisSifre2026' });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  test('süresi dolmuş geçici şifre ile giriş reddedilmeli', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ eposta: expiredEmail, pin: webPassword });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('GECICI_SIFRE_SURESI_DOLDU');
  });
});
