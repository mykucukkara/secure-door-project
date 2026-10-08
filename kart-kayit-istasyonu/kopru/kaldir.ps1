# SecureLab - Kart Kayit Istasyonu Koprusunu kaldirir.
$Hedef = Join-Path $env:LOCALAPPDATA 'SecureLabKopru'

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*SecureLabKopru*kopru.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$kisayol = Join-Path ([Environment]::GetFolderPath('Startup')) 'SecureLab Istasyon Koprusu.lnk'
Remove-Item -Force -ErrorAction SilentlyContinue $kisayol
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Hedef
Write-Host 'Kopru kaldirildi.'
