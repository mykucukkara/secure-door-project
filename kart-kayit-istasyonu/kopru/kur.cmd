@echo off
rem SecureLab - Kart Kayit Istasyonu Koprusu kurulumu (cift tiklayin)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0kur.ps1" %*
pause
