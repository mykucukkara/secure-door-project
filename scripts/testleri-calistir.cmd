@echo off
chcp 65001 >nul
REM SecureLab - tum yazilim testlerini calistirir (Windows cmd veya PowerShell).
REM Kullanim: proje klasorunde  scripts\testleri-calistir.cmd
REM Sistem once "docker compose up -d --build" ile calisiyor olmali.
setlocal
cd /d "%~dp0.."

echo.
echo === 1/2 Backend birim ve entegrasyon testleri (Jest, Docker icinde) ===
docker compose exec -T -e NODE_ENV=test -e ALLOW_DEV_PASSWORD_RESET=true backend npm test
if errorlevel 1 (
  echo [HATA] Backend testleri basarisiz.
  set SONUC=1
)

echo.
echo === 2/2 Web paneli ve API uctan uca testleri (Playwright) ===
cd e2e
if not exist node_modules (
  call npm ci || goto :hata
)
REM Playwright surumu degisince tarayici da yenilenmeli; kuruluysa hizlica gecer.
REM Okul/kurum agi veya antivirus HTTPS trafigini kendi sertifikasiyla imzaliyorsa
REM Node bu sertifikayi tanimaz (SELF_SIGNED_CERT_IN_CHAIN). NODE_USE_SYSTEM_CA=1
REM ile Windows'un guvendigi sertifikalar kullanilir (Node 22.15+ / 23.8+).
set NODE_USE_SYSTEM_CA=1
if defined PW_CHROMIUM goto :tarayici_hazir
call npx playwright install chromium
if not errorlevel 1 goto :tarayici_hazir
REM Indirme basarisizsa bilgisayarda kurulu Chrome/Edge ile devam et.
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "PW_CHROMIUM=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined PW_CHROMIUM if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "PW_CHROMIUM=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined PW_CHROMIUM if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "PW_CHROMIUM=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined PW_CHROMIUM goto :hata
echo [UYARI] Playwright tarayicisi indirilemedi; kurulu tarayici kullaniliyor: %PW_CHROMIUM%
:tarayici_hazir
call npx playwright test
if errorlevel 1 (
  echo [HATA] Uctan uca testler basarisiz. Ayrintili rapor: cd e2e ^&^& npx playwright show-report
  set SONUC=1
)
cd ..

echo.
if defined SONUC (
  echo SONUC: Bazi testler basarisiz.
  exit /b 1
)
echo SONUC: Tum testler gecti.
exit /b 0

:hata
echo [HATA] Test araclari kurulamadi (internet baglantisini kontrol edin).
exit /b 1
