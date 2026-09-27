// NOT: Bu dosya daha önce .env dosyasını hiç yüklemiyordu (yalnızca
// prisma.config.js kendi içinde dotenv çağırıyordu, ama o sadece Prisma CLI
// komutları çalıştırılırken devreye giriyor, "node src/index.js" ile
// başlatılan asıl uygulama sürecini etkilemiyordu). Bu satır olmadan .env
// içindeki değerler (ör. MQTT_BROKER_HOST=localhost, MQTT_ENABLED) hiç
// okunmuyor, kod sadece dosyadaki sabit varsayılanları kullanıyordu.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const {
    allowedCorsOrigins,
    isProduction,
    validateRuntimeSecurity
} = require('./config/security');

// BigInt dönüşümü (res.json serialization çözümü)
BigInt.prototype.toJSON = function () {
    return this.toString();
};

// Rotaları içe aktarma
// 'middlewares' (sonunda 's' var) olarak değiştirin:
const birimRotalari = require('./routes/birimler');
const kullaniciRotalari = require('./routes/kullanicilar');
const kartRotalari = require('./routes/kartlar');
const kartYetkilendirmeRotalari = require('./routes/kartYetkilendirmeler');
const kapiRotalari = require('./routes/kapilar');
const cihazRotalari = require('./routes/cihazlar');
const cihazKapiAtamaRotalari = require('./routes/cihazKapiAtama');
const cihazDurumuRotalari = require('./routes/cihazDurumlari');
const erisimKaydiRotalari = require('./routes/erisimKayitlari');
const ihlalKaydiRotalari = require('./routes/ihlalKayitlari');
const grupRotalari = require('./routes/gruplar');
const yetkiKuraliRotalari = require('./routes/yetkiKurallari');
const authRotalari = require('./routes/authRoutes');
const firmwareRotalari = require('./routes/firmware');
const publicRotalari = require('./routes/publicRoutes');

const arizaRotalari = require('./routes/arizalar');

const app = express();
const PORT = process.env.PORT || 3000;
const mqttService = require('./services/mqttService');
const { initSifreCron } = require('./cron/sifreCron');
const { initIhlalCron } = require('./cron/ihlalCron');

validateRuntimeSecurity();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

const limiterDefaults = {
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test'
};
const authLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { message: 'Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.' }
});
const publicReportLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 10 * 60 * 1000,
    limit: 8,
    message: { message: 'Çok fazla bildirim gönderildi. Lütfen daha sonra tekrar deneyin.' }
});

// Middleware'ler
app.use(express.json({ limit: '5mb' }));
const corsOrigins = allowedCorsOrigins();
// Panel, nginx üzerinden aynı adresten (/api) çağrıldığında istek aynı
// kökenlidir; hangi port/IP ile açılırsa açılsın izin verilir. Farklı bir
// kökenden gelen istekler yalnızca CORS_ORIGIN listesindeyse kabul edilir.
function isSameOrigin(req, origin) {
    try {
        const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
        return Boolean(host) && new URL(origin).host === host;
    } catch (error) {
        return false;
    }
}
app.use(cors((req, callback) => {
    const origin = req.get('origin');
    const baseOptions = {
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    };
    if (!origin || corsOrigins.includes(origin) || isSameOrigin(req, origin)) {
        return callback(null, { ...baseOptions, origin: true });
    }
    const error = new Error('Bu kaynaktan API erişimine izin verilmiyor.');
    error.statusCode = 403;
    return callback(error);
}));

// Healthcheck Route
app.get('/', (req, res) => {
    res.json({ message: 'Backend, Prisma ORM ve PostgreSQL veritabanı ile aktif olarak çalışıyor!' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API çalışıyor.' });
});

// Auth Endpoint'leri (giriş yapma / token alma herkese açık)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth', authRotalari);
app.use('/api/public', publicRotalari);
app.use('/api/firmware', firmwareRotalari);

// Endpoint Bağlantıları
app.use('/api/birimler', birimRotalari);

app.use('/api/kullanicilar', kullaniciRotalari);

app.use('/api/kartlar', kartRotalari);
app.use('/api/kart-yetkilendirmeler', kartYetkilendirmeRotalari);
app.use('/api/kapilar', kapiRotalari);
app.use('/api/cihazlar', cihazRotalari);
app.use('/api/cihaz-kapi-atamalar', cihazKapiAtamaRotalari);
app.use('/api/cihaz-durumlari', cihazDurumuRotalari);
app.use('/api/erisim-kayitlari', erisimKaydiRotalari);
app.use('/api/ihlal-kayitlari', ihlalKaydiRotalari);
app.use('/api/gruplar', grupRotalari);
app.use('/api/yetki-kurallari', yetkiKuraliRotalari);

app.post('/api/arizalar', publicReportLimiter);
app.use('/api/arizalar', arizaRotalari);

// -------------------------------------------------------------
// EKLEYEBİLECEĞİN YERLER: (Rotalar bittikten sonra)
// -------------------------------------------------------------

// 1. Tanımsız Rota (404) Yakalayıcı
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'İstenen endpoint bulunamadı.' });
});

// 2. Global Hata (500) Yakalayıcı
app.use((err, req, res, next) => {
    console.error('❌ Beklenmeyen Sunucu Hatası:', err.stack);
    res.status(err.statusCode || err.status || 500).json({
        success: false,
        error: 'Sunucu tarafında bir hata oluştu.',
        message: isProduction() ? undefined : err.message
    });
});

// -------------------------------------------------------------
if (require.main === module) {
    // MQTT_ENABLED=false (.env) devre dışı bırakır — ESP32/broker olmadan yerel
    // geliştirme sırasında bağlantı deneme loglarını susturmak için. Varsayılan
    // (değişken tanımlı değilse) her zaman aktif: gerçek dağıtımda davranış değişmez.
    if (process.env.MQTT_ENABLED !== 'false') {
        mqttService.connect();
    } else {
        console.log('[MQTT] MQTT_ENABLED=false — broker bağlantısı atlandı (yerel geliştirme modu).');
    }
    initSifreCron();
    initIhlalCron();

    app.listen(PORT, () => {
        console.log(`🚀 Backend sunucusu ${PORT} portunda başlatıldı.`);
    });
}

module.exports = app;
