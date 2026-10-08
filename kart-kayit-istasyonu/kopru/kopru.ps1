# SecureLab - Kart Kayit Istasyonu Koprusu
# -----------------------------------------------------------------------------
# Panel HTTP uzerinden acildiginda tarayici USB'ye (Web Serial) erisemez. Bu
# program istasyonun takili oldugu bilgisayarda arka planda calisir:
#   - USB-seri portlari tarar, istasyonu (CP210x / CH340 / FTDI ...) bulur,
#   - "UID:04:A1:B2:C3" satirlarini okur ve sunucuya iletir (POST /api/istasyon/kart),
#   - 15 sn'de bir canlilik bildirir (POST /api/istasyon/nabiz),
#   - istasyon cikarilip takilinca kendiliginden yeniden baglanir.
# Ayarlar ayni klasordeki ayarlar.json dosyasindadir (kur.ps1 olusturur).
# Kayit: ayni klasorde kopru.log
# Ek kurulum gerektirmez; Windows PowerShell 5.1 ile calisir.

param([string]$AyarDosyasi = (Join-Path $PSScriptRoot 'ayarlar.json'))

$ErrorActionPreference = 'Stop'
$LogDosyasi = Join-Path $PSScriptRoot 'kopru.log'
$NabizAraligiSn = 15
$Baud = 115200

function Yaz([string]$Mesaj) {
    $satir = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mesaj
    try {
        # Kayit dosyasi 1 MB'yi gecerse bastan baslat.
        if ((Test-Path $LogDosyasi) -and (Get-Item $LogDosyasi).Length -gt 1MB) { Remove-Item $LogDosyasi -Force }
        Add-Content -Path $LogDosyasi -Value $satir -Encoding UTF8
    } catch { }
}

# Ayni anda tek kopya calissin.
$mutex = New-Object System.Threading.Mutex($false, 'Local\SecureLabIstasyonKoprusu')
if (-not $mutex.WaitOne(0)) { exit 0 }

$ayar = Get-Content -Raw -Path $AyarDosyasi | ConvertFrom-Json
$Sunucu = ([string]$ayar.sunucu).TrimEnd('/')
$Anahtar = [string]$ayar.anahtar
$Ad = if ($ayar.ad) { [string]$ayar.ad } else { $env:COMPUTERNAME }

function Gonder([string]$Yol, [hashtable]$Govde) {
    $Govde.ad = $Ad
    $json = $Govde | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$Sunucu/api/istasyon/$Yol" -TimeoutSec 5 `
        -Headers @{ 'X-Istasyon-Anahtari' = $Anahtar } `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
}

$script:sonNabiz = [datetime]::MinValue
$script:sunucuHatasi = $false
function Nabiz([bool]$IstasyonBagli, [string]$Port, [switch]$Hemen) {
    if (-not $Hemen -and ((Get-Date) - $script:sonNabiz).TotalSeconds -lt $NabizAraligiSn) { return }
    $script:sonNabiz = Get-Date
    try {
        Gonder 'nabiz' @{ istasyonBagli = $IstasyonBagli; port = $Port }
        if ($script:sunucuHatasi) { Yaz 'Sunucu baglantisi geri geldi.'; $script:sunucuHatasi = $false }
    } catch {
        if (-not $script:sunucuHatasi) { Yaz "Sunucuya ulasilamiyor: $($_.Exception.Message)"; $script:sunucuHatasi = $true }
    }
}

function Bul-IstasyonPortu {
    # Yalnizca bilinen USB-seri kopru yongalari (ESP32 gelistirme kartlarinda kullanilanlar).
    $portlar = Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Ports'" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\((COM\d+)\)' } |
        ForEach-Object {
            [pscustomobject]@{
                Port    = ([regex]::Match($_.Name, 'COM\d+')).Value
                Ad      = $_.Name
                Oncelik = if ($_.Name -match 'CP210|CH34|CH91|FTDI|USB Serial|USB-SERIAL|USB JTAG') { 0 } else { 1 }
            }
        } | Where-Object { $_.Oncelik -eq 0 } | Sort-Object Port
    return $portlar | Select-Object -First 1
}

Yaz "Kopru basladi. Sunucu: $Sunucu, ad: $Ad"
$sonDurum = ''

while ($true) {
    $aday = Bul-IstasyonPortu
    if (-not $aday) {
        if ($sonDurum -ne 'yok') { Yaz 'Istasyon takili degil, bekleniyor...'; $sonDurum = 'yok' }
        Nabiz $false ''
        Start-Sleep -Seconds 2
        continue
    }

    $seri = New-Object System.IO.Ports.SerialPort($aday.Port, $Baud, 'None', 8, 'One')
    # DTR/RTS kapali: acilista ESP32 yeniden baslatilmaz / reset'te tutulmaz.
    $seri.DtrEnable = $false
    $seri.RtsEnable = $false
    $seri.ReadTimeout = 1000
    $seri.NewLine = "`n"
    try {
        $seri.Open()
    } catch {
        if ($sonDurum -ne "mesgul:$($aday.Port)") {
            Yaz "$($aday.Port) acilamadi (baska program kullaniyor olabilir): $($_.Exception.Message)"
            $sonDurum = "mesgul:$($aday.Port)"
        }
        $seri.Dispose()
        Nabiz $false $aday.Port
        Start-Sleep -Seconds 5
        continue
    }

    Yaz "Istasyon baglandi: $($aday.Ad)"
    $sonDurum = "bagli:$($aday.Port)"
    Nabiz $true $aday.Port -Hemen

    try {
        while ($seri.IsOpen) {
            Nabiz $true $aday.Port
            try {
                $satir = $seri.ReadLine().Trim()
            } catch [System.TimeoutException] {
                continue
            }
            $m = [regex]::Match($satir, '^UID:\s*([0-9A-Fa-f:]+)$')
            if (-not $m.Success) { continue }
            $uid = $m.Groups[1].Value.ToUpper()
            try {
                Gonder 'kart' @{ uid = $uid; port = $aday.Port }
                Yaz "Kart iletildi: $uid"
            } catch {
                Yaz "Kart iletilemedi ($uid): $($_.Exception.Message)"
            }
        }
    } catch {
        # USB cikarilinca IOException / UnauthorizedAccessException gelir.
        Yaz "Istasyon baglantisi kesildi: $($_.Exception.Message)"
    } finally {
        try { $seri.Close() } catch { }
        $seri.Dispose()
    }
    $sonDurum = ''
    Nabiz $false '' -Hemen
    Start-Sleep -Seconds 2
}
