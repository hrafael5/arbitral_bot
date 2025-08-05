@echo off
echo Enviando atualizações para o GitHub...
git add .
git commit -m "Deploy automático"
git push

echo Conectando na VPS e atualizando o projeto remoto...

ssh root@82.29.59.139 ^
"su - arbflash -c \"cd arbitral_bot && git pull && npm install && pm2 restart arbflash-bot\""

echo ---
echo Deploy finalizado com sucesso!
pause
