@echo off
chcp 65001 >nul
cd /d "%~dp0frontend"
echo ============================================
echo   HUBSELL - Giao dien (Frontend) - cong 3000
echo ============================================
echo.
echo Dang khoi dong... (de mo cua so nay, dung tat)
echo Mo trinh duyet: http://localhost:3000
echo.
call npm run dev
pause
