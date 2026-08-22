#!/bin/bash
# Продакшн-smoke миграции доменов (Этап 6/7). Запуск: bash scripts/prod-smoke.sh
for d in gruppovoe-foto.ru restavraciyafoto-ai.ru semeynoe-foto-ai.ru delovoy-portret-ai.ru; do
  echo "== $d =="
  curl -s -o /tmp/pb -w 'status=%{http_code}\n' --max-time 8 "https://$d/"
  echo "canonical_hits=$(grep -c "href=\"https://$d/\"" /tmp/pb)"
  echo "leaks=$(grep -cE 'imagetransformation\.ru|\{\{' /tmp/pb)"
  curl -s --max-time 8 "https://$d/robots.txt" | tail -1
done
echo '== MAIN =='
curl -s -o /tmp/pb -w 'status=%{http_code}\n' --max-time 8 https://portret-iz-foto-ai.ru/
echo "canonical_hits=$(grep -c 'href="https://portret-iz-foto-ai.ru/"' /tmp/pb)"
curl -s --max-time 8 https://portret-iz-foto-ai.ru/robots.txt | tail -3
echo "sitemap_urls=$(curl -s --max-time 8 https://portret-iz-foto-ai.ru/sitemap.xml | grep -c '<loc>')"
curl -s -o /tmp/pb -w 'app_status=%{http_code}\n' --max-time 8 https://portret-iz-foto-ai.ru/app/
echo "spa_assets=$(grep -c '/app/assets/' /tmp/pb)"
echo "oldpath=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://portret-iz-foto-ai.ru/uluchshit-gruppovoe-foto)"
curl -s -o /tmp/pb -w 'oferta_status=%{http_code}\n' --max-time 8 https://portret-iz-foto-ai.ru/oferta
echo "oferta_new_domain_hits=$(grep -c 'portret-iz-foto-ai.ru' /tmp/pb)"
echo '== OLD DOMAIN =='
echo "old_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://imagetransformation.ru/)"
echo '== RASKRASITFOTO =='
getent hosts raskrasitfoto-ai.ru || echo NO_DNS_YET
