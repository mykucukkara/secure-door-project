const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const request = require('supertest');
const app = require('../index');
const prisma = require('../config/prisma');
const argon2 = require('argon2');

describe('/api/auth/me Testi', () => {
  let token = '';
  const testEmail = `test_me_${Date.now()}@example.com`;
  const testPassword = 'BenimTestim2026';

  beforeAll(async () => {
    const sifreHash = await argon2.hash(testPassword);
    await prisma.kullanici.create({
      data: {
        ad: 'Test',
        soyad: 'Kullanici',
        eposta: testEmail,
        sifreHash,
        rol: 'hoca',
        durum: 'aktif'
      }
    });

    // Bu dosya kendi token'ını kendi üretiyor, başka dosyaya bağımlı değil
    const res = await request(app)
      .post('/api/auth/login')
      .send({ eposta: testEmail, pin: testPassword });
    token = res.body.token;
  });

  afterAll(async () => {
    try {
      await prisma.kullanici.deleteMany({ where: { eposta: testEmail } });
    } catch (e) {
      // Bağlantı kapanma hatası olursa testi kırmasın
    }
  });

  test('GET /api/auth/me - Alınan token ile kullanıcı bilgileri okunabilmeli', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.eposta).toEqual(testEmail);
  });
});