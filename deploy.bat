@echo off
echo ==========================================================
echo [1/3] Enviando atualizações para o GitHub...
git add .
git commit -m "Deploy automático"
git push

echo.
echo ==========================================================
echo [2/3] Conectando na VPS e executando os comandos...

ssh -tt root@82.29.59.139 ^
"su - arbflash -l -c \"cd arbitral_bot && git pull && npm install && /home/arbflash/.nvm/versions/node/v22.17.0/bin/pm2 restart arbflash-bot && read -p 'Pressione ENTER para sair...' < /dev/tty\""

echo.
echo ==========================================================
echo [3/3] Deploy remoto concluído.
pause
