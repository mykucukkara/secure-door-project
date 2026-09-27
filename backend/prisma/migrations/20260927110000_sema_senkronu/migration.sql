-- schema.prisma ile migration geçmişi arasındaki farkları kapatır.
-- (Bu alanlar daha önce yalnızca "prisma db push" ile eklenmişti; sıfırdan
-- kurulan veritabanında eksik kaldıkları için onay bekleyen kartlar ve erişim
-- geçmişi sayfaları hata veriyordu.) Tüm ifadeler tekrar çalıştırılabilir.

-- Kapıda okutulan tanımsız kartlar "onay_bekliyor" durumunda saklanır.
ALTER TYPE "KartDurum" ADD VALUE IF NOT EXISTS 'onay_bekliyor';

-- PIN ile yapılan erişimlerde kullanılan kapı şifresi kaydı.
ALTER TABLE "erisim_kaydi" ADD COLUMN IF NOT EXISTS "kapiSifreId" BIGINT;

CREATE INDEX IF NOT EXISTS "erisim_kaydi_kapiSifreId_idx" ON "erisim_kaydi"("kapiSifreId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erisim_kaydi_kapiSifreId_fkey'
  ) THEN
    ALTER TABLE "erisim_kaydi"
      ADD CONSTRAINT "erisim_kaydi_kapiSifreId_fkey"
      FOREIGN KEY ("kapiSifreId") REFERENCES "kapi_sifre_gecmisi"("kapiSifreId")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
