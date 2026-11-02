#!/usr/bin/env bash
# Il Bel Paese — firewall in uscita per i container.
#
# Garantisce che i servizi (database, login, Studio, funzioni...) non possano contattare internet,
# qualunque cosa provino a fare. Le sole uscite permesse dai container sono:
#   - DNS (porta 53), per risolvere il nome del server di posta
#   - SMTP (465/587), per le email di invito e reset password
#   - HTTP/HTTPS (80/443) SOLO dal container di Caddy (172.30.0.250), per il certificato Let's Encrypt
# Tutto il resto viene bloccato e annotato nel log di sistema (prefisso IBP-BLOCCO).
#
# Il traffico in entrata verso il sito (80/443 su Caddy) e le risposte alle connessioni già aperte
# passano normalmente. Il server stesso (aggiornamenti di sistema, backup verso kDrive) non è toccato:
# queste regole valgono solo per i container.
#
# Uso:  sudo ./firewall.sh          applica le regole
#       sudo ./firewall.sh status   mostra le regole e i contatori
#       sudo ./firewall.sh off      rimuove le regole (per diagnosi)
# Va rilanciato dopo ogni riavvio di Docker: il servizio systemd del piano lo fa da solo.

set -euo pipefail

SUBNET="172.30.0.0/24"     # rete dei container (docker-compose.override.yml)
CADDY_IP="172.30.0.250"    # unico container autorizzato a uscire su 80/443
CHAIN="IBP-EGRESS"

# Interfaccia verso internet: quella della rotta predefinita, oppure EXT_IF=... davanti al comando
EXT_IF="${EXT_IF:-$(ip -o route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p')}"
[ -n "$EXT_IF" ] || { echo "Interfaccia di rete non trovata" >&2; exit 1; }

case "${1:-on}" in
  status)
    iptables -L DOCKER-USER -n -v --line-numbers
    iptables -L "$CHAIN" -n -v --line-numbers 2>/dev/null || echo "Regole Il Bel Paese non attive"
    exit 0 ;;
  off)
    iptables -D DOCKER-USER -s "$SUBNET" -o "$EXT_IF" -j "$CHAIN" 2>/dev/null || true
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
    echo "Regole rimosse: i container possono di nuovo uscire su internet."
    exit 0 ;;
  on) ;;
  *) echo "Uso: $0 [on|status|off]" >&2; exit 2 ;;
esac

iptables -L DOCKER-USER -n >/dev/null 2>&1 || { echo "Catena DOCKER-USER assente: Docker è avviato?" >&2; exit 1; }

# Catena dedicata, ricreata da zero ogni volta (lo script si può rilanciare senza duplicare regole)
iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A "$CHAIN" -p udp --dport 53 -j RETURN
iptables -A "$CHAIN" -p tcp --dport 53 -j RETURN
iptables -A "$CHAIN" -p tcp -m multiport --dports 465,587 -j RETURN
iptables -A "$CHAIN" -s "$CADDY_IP" -p tcp -m multiport --dports 80,443 -j RETURN
iptables -A "$CHAIN" -m limit --limit 6/min -j LOG --log-prefix "IBP-BLOCCO " --log-level 4
iptables -A "$CHAIN" -j DROP

# Aggancio: solo il traffico che parte dai container ed esce verso internet passa dalla catena
iptables -C DOCKER-USER -s "$SUBNET" -o "$EXT_IF" -j "$CHAIN" 2>/dev/null \
  || iptables -I DOCKER-USER 1 -s "$SUBNET" -o "$EXT_IF" -j "$CHAIN"

echo "Firewall in uscita attivo su $EXT_IF per la rete $SUBNET."
echo "Tentativi bloccati:  sudo journalctl -k | grep IBP-BLOCCO"
