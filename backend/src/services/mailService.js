const nodemailer = require('nodemailer');

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    // STARTTLS kullanılan portlarda (587) şifrelemesiz gönderime izin verme.
    requireTLS: process.env.SMTP_SECURE !== 'true' && process.env.SMTP_REQUIRE_TLS !== 'false',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  });
}

function formatDateTr(date) {
  return new Date(date).toLocaleString('tr-TR', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/Istanbul',
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Panel yalnızca kampüs içinden erişilebilen bir adreste çalıştığı için tüm e-postalarda belirtilir.
const AG_UYARISI = 'Sisteme yalnızca üniversite ağından (kampüs içi kablolu ağ veya Wi-Fi) erişilebilir; '
  + 'bağlantılar kampüs dışından açılmaz.';

function mailLayout(bodyHtml) {
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e1e5ee">
<tr><td style="background:#313582;color:#ffffff;padding:18px 24px">
<div style="font-size:12px;letter-spacing:.06em;opacity:.85">SAKARYA UYGULAMALI BİLİMLER ÜNİVERSİTESİ</div>
<div style="font-size:18px;font-weight:bold;margin-top:2px">Bilgisayar Mühendisliği · SecureLab</div>
</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${bodyHtml}
<p style="background:#eef4fb;border:1px solid #b9d3ee;border-radius:6px;padding:10px 14px;font-size:14px"><strong>Erişim:</strong> ${escapeHtml(AG_UYARISI)}</p></td></tr>
<tr><td style="padding:14px 24px;background:#f7f8fb;color:#6b7280;font-size:12px;border-top:1px solid #e1e5ee">
Bu e-posta SecureLab kapı erişim kontrol sistemi tarafından otomatik gönderilmiştir. Lütfen yanıtlamayın.
Şifrenizi kimseyle paylaşmayın; sistem yöneticileri sizden asla şifrenizi istemez.
</td></tr></table></td></tr></table></body></html>`;
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresAt }) {
  if (!isMailConfigured()) return false;
  await createTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'SecureLab web şifresi yenileme',
    text: `${name || 'Merhaba'},\n\nWeb şifrenizi yenilemek için aşağıdaki tek kullanımlık bağlantıyı açın:\n${resetUrl}\n\nBağlantı ${formatDateTr(expiresAt)} tarihinde geçersiz olacaktır. Bu talebi siz yapmadıysanız mesajı dikkate almayın.\n\n${AG_UYARISI}`,
    html: mailLayout(`<p>Sayın ${escapeHtml(name || 'kullanıcı')},</p>
<p>Web şifrenizi yenilemek için 15 dakika geçerli tek kullanımlık bağlantıyı açın:</p>
<p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#056DB0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">Şifremi yenile</a></p>
<p>Bu talebi siz yapmadıysanız mesajı dikkate almayın.</p>`)
  });
  return true;
}

/**
 * Yönetici yeni hesap açtığında (veya geçici şifre yenilediğinde) kullanıcıya
 * geçici giriş şifresini gönderir. Kullanıcı ilk girişte şifresini değiştirmek
 * zorundadır; geçici şifre süre sonunda kendiliğinden geçersiz olur.
 */
async function sendAccountInviteEmail({ to, name, temporaryPassword, loginUrl, expiresAt, yenileme = false }) {
  if (!isMailConfigured()) return false;
  const baslik = yenileme ? 'SecureLab geçici şifreniz yenilendi' : 'SecureLab hesabınız oluşturuldu';
  const giris = yenileme
    ? 'SecureLab hesabınız için yönetici tarafından yeni bir geçici şifre oluşturuldu.'
    : 'Bilgisayar Mühendisliği laboratuvar kapı erişim sistemi SecureLab\'de sizin için bir hesap oluşturuldu.';

  await createTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: baslik,
    text: `Sayın ${name || 'kullanıcı'},\n\n${giris}\n\nGiriş adresi: ${loginUrl}\nE-posta: ${to}\nGeçici şifreniz: ${temporaryPassword}\n\nBu şifreyle giriş yaptıktan sonra sistem sizden hemen kendi şifrenizi belirlemenizi isteyecektir. Geçici şifre ${formatDateTr(expiresAt)} tarihine kadar geçerlidir.\n\nKapı şifrenizi (6 haneli PIN) giriş yaptıktan sonra Profilim sayfasından görebilir ve değiştirebilirsiniz.\n\n${AG_UYARISI}`,
    html: mailLayout(`<p>Sayın ${escapeHtml(name || 'kullanıcı')},</p>
<p>${escapeHtml(giris)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e1e5ee;border-radius:6px;width:100%">
<tr><td style="padding:10px 14px;color:#6b7280;width:140px">E-posta</td><td style="padding:10px 14px;font-weight:bold">${escapeHtml(to)}</td></tr>
<tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #e1e5ee">Geçici şifre</td><td style="padding:10px 14px;border-top:1px solid #e1e5ee;font-family:Consolas,monospace;font-size:17px;font-weight:bold;letter-spacing:.04em">${escapeHtml(temporaryPassword)}</td></tr>
</table>
<p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#056DB0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">SecureLab'e giriş yap</a></p>
<p style="background:#fff7e6;border:1px solid #f5d38a;border-radius:6px;padding:10px 14px"><strong>Önemli:</strong> Bu şifreyle giriş yaptıktan sonra sistem sizden hemen kendi şifrenizi belirlemenizi isteyecektir. Geçici şifre <strong>${escapeHtml(formatDateTr(expiresAt))}</strong> tarihine kadar geçerlidir.</p>
<p>Kapı şifrenizi (6 haneli PIN) giriş yaptıktan sonra <em>Profilim</em> sayfasından görebilir ve değiştirebilirsiniz.</p>`)
  });
  return true;
}

module.exports = {
  isMailConfigured,
  sendPasswordResetEmail,
  sendAccountInviteEmail,
  escapeHtml
};
