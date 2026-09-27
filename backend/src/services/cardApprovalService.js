const prisma = require('../config/prisma');
const { writeAudit } = require('./auditService');
const { normalizeKartUid } = require('../utils/kartUid');

/**
 * 1. ESP32'den bilinmeyen/tanımsız bir kart ID geldiğinde çalışır.
 * Kartı veritabanındaki Kart tablosuna kaydeder (varsa günceller).
 */
async function handleUnknownCardScan(kartUid) {
  try {
    const normalizedKartUid = String(kartUid).trim().toUpperCase();

    // Kart daha önce kaydedilmiş mi kontrol et
    let kart = await prisma.kart.findUnique({
      where: { kartUid: normalizedKartUid }
    });

    if (!kart) {
      // Veritabanına yeni kart olarak ekle
      kart = await prisma.kart.create({
        data: {
          kartUid: normalizedKartUid,
          durum: 'onay_bekliyor',
          iptalNedeni: 'Onay Bekliyor'
        }
      });
      console.log(`[YENİ KART] Onay bekleyen yeni kart DB'ye eklendi: ${normalizedKartUid}`);
    } else if (
      kart.durum === 'iptal'
      && kart.iptalNedeni === 'Yetkilendirme isteği reddedildi'
    ) {
      // Daha önce reddedilen kart yeniden okutulursa yeni bir istek olarak göster.
      kart = await prisma.kart.update({
        where: { kartUid: normalizedKartUid },
        data: {
          durum: 'onay_bekliyor',
          iptalTarihi: null,
          iptalNedeni: 'Onay Bekliyor'
        }
      });
      console.log(`[YENİDEN OKUTMA] Kart yeniden onay bekliyor: ${normalizedKartUid}`);
    } else {
      console.log(`[KART UYARI] Tanımsız kart tekrar okutuldu: ${normalizedKartUid}`);
    }

    return {
      success: false,
      message: "Kartınız sisteme kayıtlı değil. Onay isteği yöneticiye iletildi.",
      kartUid: normalizedKartUid
    };
  } catch (error) {
    console.error(`[KART OKUMA HATA]`, error.message);
    return { success: false, message: "Kart okuma veritabanına kaydedilemedi." };
  }
}

/**
 * 2. Yöneticinin panelde yetkilendirilmemiş/onay bekleyen kartları listelemesini sağlar.
 */
async function getPendingCards() {
  try {
    // Kartın gerçek durumuna göre bekleyenleri getir. Yarım kalmış eski
    // yetkilendirme kayıtları kartın listeden kaybolmasına neden olmamalı.
    const pendingCards = await prisma.kart.findMany({
      where: {
        durum: 'onay_bekliyor'
      },
      include: {
        erisimKayitlari: {
          orderBy: [
            { kayitTamani: 'desc' },
            { kayitId: 'desc' }
          ],
          take: 1,
          select: { kayitTamani: true }
        }
      }
    });

    return pendingCards
      .map(({ erisimKayitlari, ...card }) => ({
        ...card,
        sonOkutmaZamani: erisimKayitlari[0]?.kayitTamani || null
      }))
      .sort((a, b) => (
        new Date(b.sonOkutmaZamani || b.verilicTarihi).getTime()
        - new Date(a.sonOkutmaZamani || a.verilicTarihi).getTime()
      ));
  } catch (error) {
    console.error(`[ONAY BEKLEYEN KARTLAR HATA]`, error.message);
    return [];
  }
}

/**
 * 3. Yönetici kartı bir kullanıcıya (userId) atayıp onayladığında çalışır.
 * KartYetkilendirme tablosuna kayıt atar.
 */
async function approveCard(kartUid, userId, adminId = null, notlar = null) {
  try {
    const normalizedKartUid = normalizeKartUid(kartUid);
    if (!normalizedKartUid) {
      return {
        success: false,
        message: 'Kart UID biçimi geçersiz. Örnek: 04:A1:B2:C3 (4, 7 veya 10 bayt).'
      };
    }
    const kullaniciIdBigInt = BigInt(userId);
    const adminIdBigInt = adminId ? BigInt(adminId) : null;

    const kullanici = await prisma.kullanici.findUnique({
      where: { kullaniciId: kullaniciIdBigInt },
      select: { kullaniciId: true, birimId: true, durum: true }
    });

    if (!kullanici || kullanici.durum !== 'aktif') {
      return {
        success: false,
        message: 'Kart yalnızca aktif bir kullanıcıya atanabilir.'
      };
    }

    // Kart durumu ile kullanıcı yetkisini tek transaction içinde güncelle.
    // Böylece aynı kart tekrar onaylandığında duplicate hatası oluşmaz ve
    // "yetki aktif / kart onay bekliyor" şeklinde yarım kayıt kalmaz.
    const yetkilendirme = await prisma.$transaction(async (tx) => {
      await tx.kart.upsert({
        where: { kartUid: normalizedKartUid },
        update: {
          durum: 'aktif',
          iptalTarihi: null,
          iptalNedeni: null
        },
        create: {
          kartUid: normalizedKartUid,
          durum: 'aktif'
        }
      });

      const permission = await tx.kartYetkilendirme.upsert({
        where: { kartUid: normalizedKartUid },
        update: {
          kullaniciId: kullaniciIdBigInt,
          birimId: kullanici.birimId,
          durum: 'aktif',
          yetkilendiren: adminIdBigInt,
          yetkilendirilmeTarihi: new Date(),
          notlar: notlar || 'Yönetici Paneli Üzerinden Onaylandı'
        },
        create: {
          kartUid: normalizedKartUid,
          kullaniciId: kullaniciIdBigInt,
          birimId: kullanici.birimId,
          durum: 'aktif',
          yetkilendiren: adminIdBigInt,
          notlar: notlar || 'Yönetici Paneli Üzerinden Onaylandı'
        }
      });
      await writeAudit({
        client: tx,
        actorId: adminIdBigInt,
        action: 'guncelle',
        tableName: 'kart_yetkilendirme',
        recordId: permission.kartYetkiId,
        after: {
          kartUid: normalizedKartUid,
          kullaniciId: kullaniciIdBigInt,
          durum: 'aktif'
        }
      });
      return permission;
    });

    console.log(`[KART ONAYLANDI] ${normalizedKartUid} UID'li kart, User ID: ${userId} kişisine tanımlandı.`);

    return {
      success: true,
      message: "Kart başarıyla yetkilendirildi ve kullanıcıya atandı.",
      kartUid: normalizedKartUid,
      userId,
      yetkiId: yetkilendirme.kartYetkiId.toString()
    };
  } catch (error) {
    console.error(`[KART ONAYLAMA HATA]`, error.message);
    return {
      success: false,
      message: "Kart onaylanırken bir hata oluştu.",
      error: error.message
    };
  }
}

async function rejectCard(kartUid, adminId = null) {
  try {
    const normalizedKartUid = normalizeKartUid(kartUid) || String(kartUid).trim().toUpperCase();
    const kart = await prisma.kart.findUnique({
      where: { kartUid: normalizedKartUid }
    });

    if (!kart) {
      return {
        success: false,
        message: 'Reddedilecek kart kaydı bulunamadı.'
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.kart.update({
        where: { kartUid: normalizedKartUid },
        data: {
          durum: 'iptal',
          iptalTarihi: new Date(),
          iptalNedeni: 'Yetkilendirme isteği reddedildi'
        }
      });
      await tx.kartYetkilendirme.updateMany({
        where: { kartUid: normalizedKartUid },
        data: { durum: 'pasif' }
      });
      await writeAudit({
        client: tx,
        actorId: adminId,
        action: 'guncelle',
        tableName: 'kart',
        recordId: normalizedKartUid,
        before: { durum: kart.durum },
        after: { durum: 'iptal', sebep: 'yetkilendirme_istegi_reddedildi' }
      });
    });

    console.log(`[KART REDDEDİLDİ] ${normalizedKartUid} yetkilendirme isteği reddedildi.`);
    return {
      success: true,
      message: 'Kart yetkilendirme isteği reddedildi.',
      kartUid: normalizedKartUid
    };
  } catch (error) {
    console.error(`[KART REDDETME HATA]`, error.message);
    return {
      success: false,
      message: 'Kart isteği reddedilirken bir hata oluştu.',
      error: error.message
    };
  }
}

module.exports = {
  handleUnknownCardScan,
  getPendingCards,
  approveCard,
  rejectCard
};
