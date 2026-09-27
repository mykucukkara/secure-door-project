const crypto = require('crypto');
const prisma = require('../config/prisma');
const { writeAudit } = require('./auditService');

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function createPasswordReset(userId, requestIp) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await prisma.$transaction(async (transaction) => {
    await transaction.webSifreSifirlama.updateMany({
      where: { kullaniciId: BigInt(userId), kullanildi: null, iptal: false },
      data: { iptal: true }
    });
    await transaction.webSifreSifirlama.create({
      data: {
        kullaniciId: BigInt(userId),
        tokenHash: tokenHash(rawToken),
        gecerlilikBitis: expiresAt,
        talepIp: requestIp ? String(requestIp).slice(0, 64) : null
      }
    });
  });
  return { rawToken, expiresAt };
}

async function consumePasswordReset(rawToken, passwordHash) {
  const hash = tokenHash(rawToken);
  return prisma.$transaction(async (transaction) => {
    const reset = await transaction.webSifreSifirlama.findUnique({
      where: { tokenHash: hash }
    });
    if (!reset || reset.iptal || reset.kullanildi || reset.gecerlilikBitis <= new Date()) {
      const error = new Error('Şifre yenileme bağlantısı geçersiz veya süresi dolmuş.');
      error.statusCode = 400;
      throw error;
    }
    const claimed = await transaction.webSifreSifirlama.updateMany({
      where: {
        sifirlamaId: reset.sifirlamaId,
        iptal: false,
        kullanildi: null,
        gecerlilikBitis: { gt: new Date() }
      },
      data: { kullanildi: new Date() }
    });
    if (claimed.count !== 1) {
      const error = new Error('Şifre yenileme bağlantısı daha önce kullanılmış.');
      error.statusCode = 409;
      throw error;
    }
    await transaction.kullanici.update({
      where: { kullaniciId: reset.kullaniciId },
      data: {
        sifreHash: passwordHash,
        sifreGecerlilikBitis: null,
        sifreDegistirmeZorunlu: false,
        oturumSurumu: { increment: 1 }
      }
    });
    await transaction.webSifreSifirlama.updateMany({
      where: {
        kullaniciId: reset.kullaniciId,
        NOT: { sifirlamaId: reset.sifirlamaId },
        kullanildi: null
      },
      data: { iptal: true }
    });
    await writeAudit({
      client: transaction,
      actorId: reset.kullaniciId,
      action: 'guncelle',
      tableName: 'kullanici',
      recordId: reset.kullaniciId,
      before: { webSifresi: 'sifirlama_talebi' },
      after: { webSifresi: 'yenilendi', tumOturumlar: 'kapatildi' }
    });
    return { kullaniciId: reset.kullaniciId };
  });
}

module.exports = { createPasswordReset, consumePasswordReset };
