-- schema.prisma'daki KullaniciRol enum'u ile veritabanını eşitler.
-- idari_personel: öğretim elemanıyla aynı yetkilere sahip idari personel rolü.
-- yetkili_ogrenci: şemada tanımlıydı ancak hiçbir migration eklememişti (şema kayması).
ALTER TYPE "KullaniciRol" ADD VALUE IF NOT EXISTS 'yetkili_ogrenci';
ALTER TYPE "KullaniciRol" ADD VALUE IF NOT EXISTS 'idari_personel';
