@echo off
echo ==========================================================
echo [1/4] Enviando atualizações para o GitHub...
git add .
git commit -m "Deploy automático"
git push

echo.
echo ==========================================================
echo [2/4] Conectando na VPS e executando comandos como no terminal...

ssh -tt root@82.29.59.139 ^
"su - arbflash -l <<EOF
cd arbitral_bot
git pull
npm install
pm2 restart arbflash-bot
echo '--- Deploy remoto finalizado ---'
read -p 'Pressione ENTER para sair...'
EOF"

echo.
echo ==========================================================
echo [3/4] Sessão remota encerrada.
pause

