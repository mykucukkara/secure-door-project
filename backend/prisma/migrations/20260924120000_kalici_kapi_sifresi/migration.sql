-- Kapı şifreleri (PIN) artık kalıcıdır: süresi dolmaz, kullanıcı istediğinde
-- Profil sayfasından günceller. Mevcut kullanıcıların o anki şifreleri
-- geçerliliğini korusun diye bitiş tarihleri temizlenir.

UPDATE "kullanici"
SET "pinGecerlilikBitis" = NULL
WHERE "pinGecerlilikBitis" IS NOT NULL;

UPDATE "kapi_sifre_gecmisi"
SET "gecerlilikBitis" = NULL
WHERE "aktif" = TRUE;
