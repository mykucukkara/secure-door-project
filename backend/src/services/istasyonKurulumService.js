/**
 * Kart kayıt istasyonu köprüsünün panelden indirilen kurulum dosyasını üretir.
 *
 * Çıktı tek bir .cmd dosyasıdır: kendini okur ve ":SL_PAYLOAD" satırından
 * sonrasını PowerShell'e verir. kur.ps1 ve kopru.ps1 içerikleri base64 olarak,
 * sunucu adresi ve istasyon anahtarı da parametre olarak gömülüdür.
 */
const fs = require('fs');
const path = require('path');

// Köprü betikleri (kart-kayit-istasyonu/kopru). Docker'da salt okunur bağlanır.
const KOPRU_DIZINLERI = [
  process.env.ISTASYON_KOPRU_DIZINI,
  '/app/istasyon-kopru',
  path.join(__dirname, '../../../kart-kayit-istasyonu/kopru')
].filter(Boolean);

const PAYLOAD_ISARETI = ':SL_PAYLOAD';

function kopruDosyasiOku(ad) {
  for (const dizin of KOPRU_DIZINLERI) {
    const yol = path.join(dizin, ad);
    if (fs.existsSync(yol)) return fs.readFileSync(yol, 'utf8');
  }
  return null;
}

function psTirnak(deger) {
  return `'${String(deger).replace(/'/g, "''")}'`;
}

function base64(metin) {
  return Buffer.from(metin, 'utf8').toString('base64');
}

/** Betikler bulunamazsa null döner. */
function kurulumDosyasiOlustur({ sunucu, anahtar, zaman = new Date() }) {
  const kur = kopruDosyasiOku('kur.ps1');
  const kopru = kopruDosyasiOku('kopru.ps1');
  if (!kur || !kopru) return null;

  const payload = [
    `$kur = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(kur)}'))`,
    `$kopru = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(kopru)}'))`,
    `& ([scriptblock]::Create($kur)) -Sunucu ${psTirnak(sunucu)} -Anahtar ${psTirnak(anahtar)} -KopruIcerik $kopru`
  ].join('\r\n');

  const cmd = [
    '@echo off',
    'rem SecureLab - Kart Kayit Istasyonu Koprusu kurulumu',
    `rem Sunucu: ${sunucu}  -  Panelden indirildi: ${zaman.toISOString()}`,
    'rem Bu dosya istasyon anahtarini icerir; paylasmayin, kurulumdan sonra silin.',
    'set "SL_KURULUM=%~f0"',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:SL_KURULUM); $i=$t.LastIndexOf('${PAYLOAD_ISARETI}'); iex $t.Substring($i+${PAYLOAD_ISARETI.length})"`,
    'pause',
    'exit /b',
    PAYLOAD_ISARETI,
    payload,
    ''
  ].join('\r\n');

  return Buffer.from(cmd, 'ascii');
}

module.exports = { kurulumDosyasiOlustur };
