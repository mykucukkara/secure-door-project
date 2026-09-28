@echo off
chcp 65001 >nul
REM Yonetici hesaplarinin sifresini baslangic sifresine dondurur (yalnizca gelistirme).
cd /d "%~dp0.."
docker compose exec -T backend node - < scripts\sifre-sifirla.js
docker compose restart backend >nul
