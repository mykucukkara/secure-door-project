# SecureLab - Kart Kayit Istasyonu Koprusu kurulumu
# Kopruyu %LOCALAPPDATA%\SecureLabKopru klasorune kopyalar, ayarlar.json yazar,
# Windows acilisinda gizli baslamasi icin Baslangic klasorune kisayol ekler ve
# kopruyu hemen baslatir. Yonetici yetkisi gerekmez; yalnizca bu kullaniciyi etkiler.
#
#   kur.cmd                                  (sunucu ve anahtari sorar)
#   kur.cmd -Sunucu http://10.9.2.50 -Anahtar <ISTASYON_ANAHTARI>
# Panelden indirilen kurulum dosyasi (GET /api/istasyon/kurulum) bu betigi
# sunucu, anahtar ve kopru.ps1 icerigi (-KopruIcerik) gomulu olarak calistirir.

param(
    [string]$Sunucu,
    [string]$Anahtar,
    [string]$Ad = $env:COMPUTERNAME,
    [string]$KopruIcerik
)

$ErrorActionPreference = 'Stop'
$Hedef = Join-Path $env:LOCALAPPDATA 'SecureLabKopru'
$AyarYolu = Join-Path $Hedef 'ayarlar.json'

if (-not $Sunucu) {
    $Sunucu = Read-Host 'Sunucu adresi [http://10.9.2.50]'
    if (-not $Sunucu) { $Sunucu = 'http://10.9.2.50' }
}
if (-not $Anahtar) {
    $Anahtar = Read-Host 'Istasyon anahtari (sunucudaki .env -> ISTASYON_ANAHTARI)'
}
if ($Anahtar.Length -lt 16) { throw 'Istasyon anahtari en az 16 karakter olmalidir.' }

# Calisan eski kopyayi durdur (guncelleme durumunda).
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*SecureLabKopru*kopru.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $Hedef | Out-Null
if ($KopruIcerik) {
    [System.IO.File]::WriteAllText((Join-Path $Hedef 'kopru.ps1'), $KopruIcerik, [System.Text.Encoding]::ASCII)
} else {
    Copy-Item -Force (Join-Path $PSScriptRoot 'kopru.ps1') $Hedef
}
@{ sunucu = $Sunucu.TrimEnd('/'); anahtar = $Anahtar; ad = $Ad } |
    ConvertTo-Json | Set-Content -Path $AyarYolu -Encoding UTF8

# Pencere acmadan baslatan VBS (powershell -WindowStyle Hidden kisa sure pencere gosterir).
$baslatici = Join-Path $Hedef 'baslat.vbs'
$komut = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""' + (Join-Path $Hedef 'kopru.ps1') + '""'
"CreateObject(""WScript.Shell"").Run ""$komut"", 0, False" | Set-Content -Path $baslatici -Encoding Unicode

$kisayol = Join-Path ([Environment]::GetFolderPath('Startup')) 'SecureLab Istasyon Koprusu.lnk'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($kisayol)
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = '"' + $baslatici + '"'
$lnk.WorkingDirectory = $Hedef
$lnk.Description = 'SecureLab kart kayit istasyonu koprusu'
$lnk.Save()

Start-Process wscript.exe -ArgumentList ('"' + $baslatici + '"')

# Sunucu baglantisini dogrula.
try {
    $govde = @{ ad = $Ad; istasyonBagli = $false } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$($Sunucu.TrimEnd('/'))/api/istasyon/nabiz" -TimeoutSec 5 `
        -Headers @{ 'X-Istasyon-Anahtari' = $Anahtar } -ContentType 'application/json' -Body $govde | Out-Null
    Write-Host 'Sunucu baglantisi ve anahtar dogrulandi.' -ForegroundColor Green
} catch {
    Write-Host "UYARI: Sunucu dogrulanamadi: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "Kopru kuruldu: $Hedef"
Write-Host 'Windows acilisinda kendiliginden baslar. Kayitlar: kopru.log'
