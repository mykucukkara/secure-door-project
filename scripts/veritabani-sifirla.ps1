# SecureLab — veritabanını SIFIRDAN kurar (TÜM KAYITLAR SİLİNİR)
#
# Kullanım (proje klasöründe, PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\veritabani-sifirla.ps1
#
# Ne yapar?
#   1. Konteynerleri durdurur ve PostgreSQL veri birimini (postgres_data) siler.
#   2. İmajları yeniden derleyip sistemi başlatır.
#   3. Backend açılırken migration'ları uygular ve başlangıç hesaplarını oluşturur:
#        - Sistem yöneticisi (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
#        - Bölüm başkanı, yönetici (SEED_BOLUM_BASKANI_EPOSTA)
#        - Bölüm akademik kadrosu (şifre: SEED_HOCA_PASSWORD)
#      Tüm hesaplar ilk girişte şifre değiştirmek zorundadır.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host ''
Write-Host 'DİKKAT: Veritabanındaki TÜM kullanıcılar, kartlar, erişim ve arıza kayıtları silinecek.' -ForegroundColor Yellow
$onay = Read-Host 'Devam etmek için SIFIRLA yazın'
if ($onay -ne 'SIFIRLA') {
    Write-Host 'İptal edildi, hiçbir şey değişmedi.'
    exit 0
}

docker compose down -v
docker compose up -d --build

Write-Host ''
Write-Host 'Backend hazırlanıyor (başlangıç hesapları oluşturuluyor)...'
docker compose logs -f --tail 40 backend
