@echo off
title Dashboard de Arbitragem - Servidor
echo =======================================================
echo  Iniciando o servidor do Dashboard de Arbitragem...
echo =======================================================
echo.
cd /d "%~dp0"
start "Servidor Node.js" npm start
echo Aguardando 5 segundos para o servidor inicializar...
timeout /t 5 /nobreak > nul
echo.
echo Abrindo o dashboard no seu navegador...
start http://localhost:3000/
echo.
echo =======================================================
echo  Pronto! O servidor esta rodando e o dashboard foi aberto.
echo =======================================================