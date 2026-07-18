@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo ============================================
echo   HUBSELL - May chu (Backend) - cong 4000
echo ============================================
echo.
echo Dang khoi dong... (de mo cua so nay, dung tat)
echo Kiem tra: http://localhost:4000/health
echo.
call npm run dev
pause
