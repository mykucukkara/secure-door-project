const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const request = require('supertest');
const app = require('../index');
const prisma = require('../config/prisma');
const { getAdminToken, getTestAdmin, signFor } = require('./authTestUtils');

describe('Hesap açma, zorunlu şifre değişimi ve yönetici kuralları', () => {
  const stamp = Date.now();
  const testEmail = `account_flow_${stamp}@subu.edu.tr`;
  const newWebPassword = 'YeniGuvenli2026';
  let adminToken = '';
  let userToken = '';
  let createdUser = null;
  let temporaryPassword = '';
  let doorPin = '';

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  afterAll(async () => {
    const users = await prisma.kullanici.findMany({
      where: { eposta: { contains: `_${stamp}@` } },
      select: { kullaniciId: true }
    });
    const ids = users.map((u) => u.kullaniciId);
    if (ids.length) {
      await prisma.denetimKaydi.deleteMany({ where: { islemYapan: { in: ids } } });
      await prisma.kullanici.deleteMany({ where: { kullaniciId: { in: ids } } });
    }
  });

  test('yeni hesap yalnızca kurumsal e-posta ile açılabilmeli', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ad: 'Dış', soyad: 'Adres', eposta: `dis_${stamp}@gmail.com` });
    expect(res.statusCode).toBe(400);
  });

  test('yeni hesaplar yönetici rolüyle açılamamalı', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ad: 'İkinci', soyad: 'Admin', eposta: `admin_${stamp}@subu.edu.tr`, rol: 'admin' });
    expect(res.statusCode).toBe(400);
  });

  test('admin hesap açınca geçici şifre üretilmeli; SMTP yoksa bir kez gösterilmeli', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unvan: 'Arş. Gör.', ad: 'Hesap', soyad: 'Test', eposta: testEmail.toUpperCase() });

    expect(res.statusCode).toBe(201);
    expect(res.body.kullanici.rol).toBe('hoca');
    expect(res.body.kullanici.eposta).toBe(testEmail);
    expect(res.body.kullanici.unvan).toBe('Arş. Gör.');
    expect(res.body.kullanici.sifreDegistirmeZorunlu).toBe(true);
    expect(res.body.mailGonderildi).toBe(false);
    expect(res.body.geciciSifre).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect(res.body).not.toHaveProperty('initialPin');
    createdUser = res.body.kullanici;
    temporaryPassword = res.body.geciciSifre;

    const stored = await prisma.kullanici.findUnique({ where: { kullaniciId: BigInt(createdUser.kullaniciId) } });
    expect(stored.sifreHash).not.toContain(temporaryPassword);
    expect(stored.sifreGecerlilikBitis).not.toBeNull();
  });

  test('aynı e-posta ile ikinci hesap açılamamalı', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ad: 'Hesap', soyad: 'Tekrar', eposta: testEmail });
    expect(res.statusCode).toBe(409);
  });

  test('geçici şifreyle giriş yapan kullanıcı şifresini değiştirmeden paneli kullanamamalı', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ eposta: testEmail, pin: temporaryPassword });
    expect(login.statusCode).toBe(200);
    expect(login.body.user.sifreDegistirmeZorunlu).toBe(true);
    userToken = login.body.token;

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(me.statusCode).toBe(200);

    const blocked = await request(app)
      .get(`/api/kullanicilar/${createdUser.kullaniciId}/kapi-sifresi`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body.code).toBe('SIFRE_DEGISTIRME_ZORUNLU');
  });

  test('zayıf ya da kişisel bilgi içeren yeni şifre reddedilmeli', async () => {
    for (const weak of ['kisa1A', 'tamamikucuk2026', 'Password2026', `Account_flow_${stamp}X`]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ mevcutSifre: temporaryPassword, yeniSifre: weak, yeniSifreTekrar: weak });
      expect(res.statusCode).toBe(400);
    }
  });

  test('şifre değiştirilince kilit kalkmalı ve yeni oturum anahtarı verilmeli', async () => {
    // İlk girişte geçici şifre yeniden sorulmaz.
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ yeniSifre: newWebPassword, yeniSifreTekrar: newWebPassword });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.sifreDegistirmeZorunlu).toBe(false);

    const oldSession = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(oldSession.statusCode).toBe(401);

    userToken = res.body.token;
    const pinRes = await request(app)
      .get(`/api/kullanicilar/${createdUser.kullaniciId}/kapi-sifresi`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(pinRes.statusCode).toBe(200);
    expect(pinRes.body.pin).toMatch(/^\d{6}$/);
    expect(pinRes.body.kalici).toBe(true);
    doorPin = pinRes.body.pin;

    const oldLogin = await request(app).post('/api/auth/login').send({ eposta: testEmail, pin: temporaryPassword });
    expect(oldLogin.statusCode).toBe(401);
  });

  test('kapı PIN\'i şifreli saklanmalı', async () => {
    const stored = await prisma.kapiSifreGecmisi.findFirst({
      where: { kullaniciId: BigInt(createdUser.kullaniciId) }
    });
    expect(stored.pinSifreli).not.toContain(doorPin);
  });

  test('standart kullanıcı başka kullanıcı oluşturamamalı', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ad: 'Yetkisiz', soyad: 'İşlem', eposta: `blocked_${stamp}@subu.edu.tr` });
    expect(res.statusCode).toBe(403);
  });

  test('admin yeni geçici şifre verince kullanıcının oturumları kapanmalı ve kilit geri gelmeli', async () => {
    const res = await request(app)
      .post(`/api/kullanicilar/${createdUser.kullaniciId}/gecici-sifre`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.geciciSifre).toBeTruthy();

    const oldSession = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(oldSession.statusCode).toBe(401);

    const login = await request(app).post('/api/auth/login').send({ eposta: testEmail, pin: res.body.geciciSifre });
    expect(login.statusCode).toBe(200);
    expect(login.body.user.sifreDegistirmeZorunlu).toBe(true);
  });

  test('şifremi unuttum bağlantısı zorunlu değişim kilidini de kaldırmalı', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ eposta: testEmail });
    expect(res.statusCode).toBe(200);
    expect(res.body.resetUrl).toContain('token=');
    const resetToken = new URL(res.body.resetUrl).searchParams.get('token');
    const resetPassword = 'Sifirlanmis2027';
    const resetResult = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, yeniSifre: resetPassword, yeniSifreTekrar: resetPassword });
    expect(resetResult.statusCode).toBe(200);

    const reused = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, yeniSifre: 'BaskaGuvenli2027', yeniSifreTekrar: 'BaskaGuvenli2027' });
    expect(reused.statusCode).toBe(400);

    const login = await request(app).post('/api/auth/login').send({ eposta: testEmail, pin: resetPassword });
    expect(login.statusCode).toBe(200);
    expect(login.body.user.sifreDegistirmeZorunlu).toBe(false);
  });

  test('aday listesi bölüm kadrosundan yalnızca hesabı olmayanları göstermeli', async () => {
    const res = await request(app)
      .get('/api/kullanicilar/aday-hocalar')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.toplamKadro).toBeGreaterThan(10);
    const existing = await prisma.kullanici.findMany({ where: { eposta: { endsWith: '@subu.edu.tr' } }, select: { eposta: true } });
    const existingSet = new Set(existing.map((u) => u.eposta.toLowerCase()));
    res.body.adaylar.forEach((aday) => expect(existingSet.has(aday.eposta)).toBe(false));
    expect(res.body.adaylar.length + res.body.kayitliSayisi).toBe(res.body.toplamKadro);
  });

  test('birden fazla yönetici olabilmeli; kişi kendi yetkisini kaldıramamalı', async () => {
    const promote = await request(app)
      .put(`/api/kullanicilar/${createdUser.kullaniciId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'admin' });
    expect(promote.statusCode).toBe(200);
    expect(promote.body.rol).toBe('admin');

    const admin = await getTestAdmin();
    const selfDemote = await request(app)
      .put(`/api/kullanicilar/${admin.kullaniciId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'hoca' });
    expect(selfDemote.statusCode).toBe(409);

    const selfDelete = await request(app)
      .delete(`/api/kullanicilar/${admin.kullaniciId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(selfDelete.statusCode).toBe(409);

    const demote = await request(app)
      .put(`/api/kullanicilar/${createdUser.kullaniciId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'hoca' });
    expect(demote.statusCode).toBe(200);
  });

  test('idari personel rolüyle hesap açılabilmeli; panelde yalnızca kendi verisini görmeli', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ad: 'İdari', soyad: 'Personel', eposta: `idari_${stamp}@subu.edu.tr`, rol: 'idari_personel' });
    expect(res.statusCode).toBe(201);
    expect(res.body.kullanici.rol).toBe('idari_personel');

    const stored = await prisma.kullanici.findUnique({ where: { kullaniciId: BigInt(res.body.kullanici.kullaniciId) } });
    // Zorunlu şifre değişimi kilidini atlayıp doğrudan rol yetkilerini sına.
    await prisma.kullanici.update({ where: { kullaniciId: stored.kullaniciId }, data: { sifreDegistirmeZorunlu: false } });
    const idariToken = signFor(stored);

    // Yönetici dışındaki roller personel verilerini (kapılar vb.) göremez.
    const okuma = await request(app).get('/api/kapilar').set('Authorization', `Bearer ${idariToken}`);
    expect(okuma.statusCode).toBe(403);

    // Yönetici olmayanlar yalnızca kendi erişim kayıtlarını görmeli.
    const kayitlar = await request(app).get('/api/erisim-kayitlari').set('Authorization', `Bearer ${idariToken}`);
    expect(kayitlar.statusCode).toBe(200);
    expect(Array.isArray(kayitlar.body)).toBe(true);
    kayitlar.body.forEach((k) => expect(String(k.kullaniciId)).toBe(String(stored.kullaniciId)));

    const yazma = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${idariToken}`)
      .send({ ad: 'Yetkisiz', soyad: 'İdari', eposta: `idari_blocked_${stamp}@subu.edu.tr` });
    expect(yazma.statusCode).toBe(403);

    const rolDegisimi = await request(app)
      .put(`/api/kullanicilar/${createdUser.kullaniciId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'idari_personel' });
    expect(rolDegisimi.statusCode).toBe(200);
    expect(rolDegisimi.body.rol).toBe('idari_personel');
  });

  test('yetkili öğrenci yalnızca kendi erişim geçmişini ve profilini görebilmeli', async () => {
    const res = await request(app)
      .post('/api/kullanicilar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ad: 'Yetkili', soyad: 'Öğrenci', eposta: `ogrenci_${stamp}@ogr.subu.edu.tr`, rol: 'yetkili_ogrenci' });
    expect(res.statusCode).toBe(201);
    expect(res.body.kullanici.rol).toBe('yetkili_ogrenci');

    const stored = await prisma.kullanici.findUnique({ where: { kullaniciId: BigInt(res.body.kullanici.kullaniciId) } });
    await prisma.kullanici.update({ where: { kullaniciId: stored.kullaniciId }, data: { sifreDegistirmeZorunlu: false } });
    const ogrenciToken = signFor(stored);

    const kayitlar = await request(app).get('/api/erisim-kayitlari').set('Authorization', `Bearer ${ogrenciToken}`);
    expect(kayitlar.statusCode).toBe(200);
    kayitlar.body.forEach((k) => expect(String(k.kullaniciId)).toBe(String(stored.kullaniciId)));

    const profil = await request(app).get(`/api/kullanicilar/${stored.kullaniciId}`).set('Authorization', `Bearer ${ogrenciToken}`);
    expect(profil.statusCode).toBe(200);

    for (const yol of ['/api/kapilar', '/api/kullanicilar/ozet', '/api/arizalar', '/api/kartlar']) {
      // eslint-disable-next-line no-await-in-loop
      const engel = await request(app).get(yol).set('Authorization', `Bearer ${ogrenciToken}`);
      expect(engel.statusCode).toBe(403);
    }
  });

  test('admin standart kullanıcıyı silebilmeli (geçmiş kaydı varsa pasife alınır)', async () => {
    const res = await request(app)
      .delete(`/api/kullanicilar/${createdUser.kullaniciId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    const deleted = await prisma.kullanici.findUnique({
      where: { kullaniciId: BigInt(createdUser.kullaniciId) }
    });
    if (res.body.pasifeAlindi) {
      expect(deleted.durum).toBe('pasif');
    } else {
      expect(deleted).toBeNull();
    }
  });

  test('pasif hesabın eski oturum anahtarı geçersiz olmalı', async () => {
    const user = await prisma.kullanici.findUnique({ where: { kullaniciId: BigInt(createdUser.kullaniciId) } });
    if (!user) return;
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signFor(user)}`);
    expect(res.statusCode).toBe(401);
  });
});
