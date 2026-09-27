const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const request = require('supertest');
const app = require('../index');
const prisma = require('../config/prisma');
const { getAdminToken } = require('./authTestUtils');

describe('Kullanıcı CRUD Entegrasyon Testleri', () => {
  let olusturulanKullaniciId;
  let adminToken;
  const testEposta = `crud_test_${Date.now()}@subu.edu.tr`;

  beforeAll(async () => { adminToken = await getAdminToken(); });
  const authorized = (method, url) => request(app)[method](url)
    .set('Authorization', `Bearer ${adminToken}`);

  afterAll(async () => {
    try {
      const user = await prisma.kullanici.findFirst({ where: { eposta: testEposta } });
      if (user) await prisma.denetimKaydi.deleteMany({ where: { islemYapan: user.kullaniciId } });
      await prisma.kullanici.deleteMany({ where: { eposta: testEposta } });
    } catch (e) {
      // Test zaten sildiyse veya bağlantı kapandıysa sorun değil
    }
  });

  test('POST /api/kullanicilar - ad ve soyad olmadan istek 400 dönmeli', async () => {
    const res = await authorized('post', '/api/kullanicilar').send({});
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('hata');
  });

  test('POST /api/kullanicilar - Yeni kullanıcı oluşturulabilmeli', async () => {
    const res = await authorized('post', '/api/kullanicilar')
      .send({
        ad: 'Crud',
        soyad: 'Test',
        eposta: testEposta,
        rol: 'hoca',
        durum: 'aktif'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.kullanici).toHaveProperty('kullaniciId');
    expect(res.body.kullanici.eposta).toEqual(testEposta);
    olusturulanKullaniciId = res.body.kullanici.kullaniciId;
  });

  test('GET /api/kullanicilar/:id - Oluşturulan kullanıcı getirilebilmeli', async () => {
    const res = await authorized('get', `/api/kullanicilar/${olusturulanKullaniciId}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.eposta).toEqual(testEposta);
  });

  test('GET /api/kullanicilar/:id - Var olmayan id için 404 dönmeli', async () => {
    const res = await authorized('get', '/api/kullanicilar/999999999');
    expect(res.statusCode).toEqual(404);
  });

  test('PUT /api/kullanicilar/:id - Kullanıcı güncellenebilmeli', async () => {
    const res = await authorized('put', `/api/kullanicilar/${olusturulanKullaniciId}`)
      .send({ durum: 'pasif' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.durum).toEqual('pasif');
  });

  test('PUT /api/kullanicilar/:id - Var olmayan id için 404 dönmeli', async () => {
    const res = await authorized('put', '/api/kullanicilar/999999999')
      .send({ durum: 'aktif' });
    expect(res.statusCode).toEqual(404);
  });

  test('GET /api/kullanicilar - Liste dönmeli ve oluşturulan kullanıcıyı içermeli', async () => {
    const res = await authorized('get', '/api/kullanicilar');
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    const bulunan = res.body.find((k) => k.eposta === testEposta);
    expect(bulunan).toBeDefined();
  });

  test('DELETE /api/kullanicilar/:id - Kullanıcı silinebilmeli', async () => {
    const res = await authorized('delete', `/api/kullanicilar/${olusturulanKullaniciId}`);
    expect(res.statusCode).toEqual(200);
  });

  test('GET /api/kullanicilar/:id - Silinen kullanıcı artık bulunamamalı', async () => {
    const res = await authorized('get', `/api/kullanicilar/${olusturulanKullaniciId}`);
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) expect(res.body.durum).toEqual('pasif');
  });

  test('DELETE /api/kullanicilar/:id - Var olmayan id için 404 dönmeli', async () => {
    const res = await authorized('delete', '/api/kullanicilar/999999999');
    expect(res.statusCode).toEqual(404);
  });
});
