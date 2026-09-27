const crypto = require('crypto');

// Kolay tahmin edilen / sızıntı listelerinde ilk sıralarda yer alan kalıplar.
const YASAKLI_KALIPLAR = [
  'password', 'parola', 'sifre', 'şifre', 'qwerty', 'asdf', '123456', '111111',
  'securelab', 'subu', 'sakarya', 'admin', 'yonetici', 'yönetici'
];

function validateWebPassword(password, { eposta, ad, soyad } = {}) {
  const value = String(password || '');
  if (value.length < 10) {
    return { valid: false, message: 'Web şifresi en az 10 karakter olmalıdır.' };
  }
  if (value.length > 72) {
    return { valid: false, message: 'Web şifresi en fazla 72 karakter olabilir.' };
  }
  if (!/[a-zçğıöşü]/.test(value) || !/[A-ZÇĞİÖŞÜ]/.test(value) || !/\d/.test(value)) {
    return { valid: false, message: 'Web şifresi en az bir büyük harf, bir küçük harf ve bir rakam içermelidir.' };
  }
  if (/(.)\1\1\1/.test(value)) {
    return { valid: false, message: 'Web şifresinde aynı karakter art arda dört kez kullanılamaz.' };
  }

  const lower = value.toLocaleLowerCase('tr-TR');
  const kisisel = [String(eposta || '').split('@')[0], String(ad || ''), String(soyad || '')]
    .join(' ')
    .split(/[\s._-]+/)
    .map((part) => part.toLocaleLowerCase('tr-TR').trim())
    .filter((part) => part.length >= 3);
  if (kisisel.some((part) => lower.includes(part))) {
    return { valid: false, message: 'Web şifresi adınızı, soyadınızı veya e-posta kullanıcı adınızı içeremez.' };
  }
  const yalin = lower.replace(/[^a-zçğıöşü0-9]/g, '');
  if (YASAKLI_KALIPLAR.some((kalip) => yalin.startsWith(kalip) && yalin.length - kalip.length <= 6)) {
    return { valid: false, message: 'Bu şifre çok kolay tahmin edilebilir. Daha özgün bir şifre seçin.' };
  }
  return { valid: true };
}

/**
 * Yöneticinin yeni hesaplara verdiği tek kullanımlık geçici şifre.
 * Karışabilecek karakterler (0/O, 1/l/I) kullanılmaz; her zaman büyük harf,
 * küçük harf ve rakam içerir, böylece politika kontrolünden geçer.
 */
function generateTemporaryWebPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const numbers = '23456789';
  const pick = (alphabet) => alphabet[crypto.randomInt(0, alphabet.length)];
  const chars = [pick(upper), pick(upper), pick(lower), pick(lower), pick(numbers), pick(numbers)];
  const all = upper + lower + numbers;
  while (chars.length < 12) chars.push(pick(all));
  // Fisher–Yates karıştırma
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const raw = chars.join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Geçici şifrenin geçerlilik süresi (saat). Varsayılan 72 saat. */
function temporaryPasswordTtlHours() {
  const hours = Number.parseInt(process.env.GECICI_SIFRE_GECERLILIK_SAAT || '72', 10);
  if (!Number.isFinite(hours) || hours < 1) return 72;
  return Math.min(hours, 24 * 30);
}

function temporaryPasswordExpiry(now = new Date()) {
  return new Date(now.getTime() + temporaryPasswordTtlHours() * 60 * 60 * 1000);
}

module.exports = {
  validateWebPassword,
  generateTemporaryWebPassword,
  temporaryPasswordTtlHours,
  temporaryPasswordExpiry
};
