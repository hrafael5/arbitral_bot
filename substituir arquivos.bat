@echo off
echo ==========================================================
echo [1/4] Enviando atualizações para o GitHub...
git add .
git commit -m "Deploy automático"
git push

echo.
echo ==========================================================
echo [2/4] Conectando na VPS e executando comandos como no terminal manual...

ssh root@82.29.59.139 ^
"bash -c 'su - arbflash <<EOF
cd arbitral_bot
git pull
npm install
pm2 restart arbflash-bot
read -p \"[REMOTE] Pressione ENTER para encerrar a sessão...\"
EOF'"

echo.
echo ==========================================================
echo [3/4] Deploy remoto concluído!
echo [4/4] Tudo pronto. O bot foi atualizado com sucesso.
pause
