-- Hesap daveti / geçici şifre akışı:
--  * sifreDegistirmeZorunlu: geçici şifreyle giren kullanıcı önce kendi
--    şifresini belirlemek zorundadır (sunucu tarafında zorlanır).
--  * unvan: bölüm sitesindeki akademik unvan (Prof. Dr., Arş. Gör. ...)
--  * sonGiris: son başarılı web girişi (yönetici listesinde gösterilir)
ALTER TABLE "kullanici" ADD COLUMN "unvan" VARCHAR(48);
ALTER TABLE "kullanici" ADD COLUMN "sifreDegistirmeZorunlu" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kullanici" ADD COLUMN "sonGiris" TIMESTAMPTZ;

