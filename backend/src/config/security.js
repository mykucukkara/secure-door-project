const DEVELOPMENT_JWT_SECRET = 'securelab-development-only-secret';
const DEVELOPMENT_PIN_SECRET = 'securelab-development-pin-history-key';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function allowedCorsOrigins() {
  const configured = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length) return configured;
  return ['http://localhost:8080', 'http://127.0.0.1:8080'];
}

function validateRuntimeSecurity() {
  if (!isProduction()) return;
  const problems = [];
  const jwtSecret = String(process.env.JWT_SECRET || '');
  const pinSecret = String(process.env.PIN_HISTORY_ENCRYPTION_KEY || '');
  const otaSecret = String(process.env.OTA_SIGNING_SECRET || '');

  if (jwtSecret.length < 32 || jwtSecret === DEVELOPMENT_JWT_SECRET) {
    problems.push('JWT_SECRET en az 32 karakterlik benzersiz bir değer olmalıdır.');
  }
  if (pinSecret.length < 32 || pinSecret === DEVELOPMENT_PIN_SECRET || pinSecret === jwtSecret) {
    problems.push('PIN_HISTORY_ENCRYPTION_KEY ayrı ve en az 32 karakter olmalıdır.');
  }
  if (otaSecret.length < 32 || otaSecret === jwtSecret) {
    problems.push('OTA_SIGNING_SECRET ayrı ve en az 32 karakter olmalıdır.');
  }
  if (process.env.ALLOW_DEV_PASSWORD_RESET === 'true') {
    problems.push('ALLOW_DEV_PASSWORD_RESET üretimde true olamaz.');
  }
  if (!process.env.SEED_ADMIN_PASSWORD
    || ['123456', 'SecureLab2026!'].includes(process.env.SEED_ADMIN_PASSWORD)) {
    problems.push('SEED_ADMIN_PASSWORD üretimde benzersiz ve güçlü bir değer olmalıdır.');
  }
  if (!process.env.SEED_HOCA_PASSWORD
    || ['123456', 'BmLab-2026!'].includes(process.env.SEED_HOCA_PASSWORD)) {
    problems.push('SEED_HOCA_PASSWORD üretimde benzersiz ve güçlü bir değer olmalıdır.');
  }
  if (!process.env.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN üretimde açıkça tanımlanmalıdır.');
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    problems.push('Şifre sıfırlama için SMTP_HOST ve SMTP_FROM tanımlanmalıdır.');
  }
  if (problems.length) {
    throw new Error(`Üretim güvenlik yapılandırması eksik:\n- ${problems.join('\n- ')}`);
  }
}

module.exports = {
  DEVELOPMENT_JWT_SECRET,
  DEVELOPMENT_PIN_SECRET,
  allowedCorsOrigins,
  isProduction,
  validateRuntimeSecurity
};
