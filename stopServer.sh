pidDex=$(lsof -i :8545 | head -n2 | cut -d " " -f2)
kill $pidDex
echo "fechado"
