/**
 * Kart UID biçim yardımcıları.
 *
 * Kapı cihazı (esp32-kodlar) ve Kart Kayıt İstasyonu (kart-kayit-istasyonu)
 * UID'yi "04:A1:B2:C3" biçiminde (büyük harf, iki nokta ile ayrılmış bayt)
 * gönderir. Web panelinden elle girilen değerler "04a1b2c3", "04 A1 B2 C3",
 * "04-a1-b2-c3" gibi farklı biçimlerde olabilir; hepsi aynı standarda çevrilir.
 */

const GECERLI_BAYT_SAYILARI = new Set([4, 7, 10]); // MIFARE single/double/triple size UID

function normalizeKartUid(raw) {
  const hex = String(raw ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!hex || hex.length % 2 !== 0) return null;
  const byteCount = hex.length / 2;
  if (!GECERLI_BAYT_SAYILARI.has(byteCount)) return null;
  return hex.match(/.{2}/g).join(':');
}

function isValidKartUid(raw) {
  return normalizeKartUid(raw) !== null;
}

module.exports = { normalizeKartUid, isValidKartUid };
