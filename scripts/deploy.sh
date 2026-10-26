#!/bin/sh
# Baut den Editor und lädt ihn per SFTP auf einen statischen Webspace.
#
#   scripts/deploy.sh               bauen und hochladen
#   scripts/deploy.sh clean         alte Assets auf dem Server löschen
#   scripts/deploy.sh deploy clean  beides, mit einer Passwortabfrage
#
# Das Ziel kommt aus deploy.env im Wurzelverzeichnis (nicht im Repository);
# gesetzte Umgebungsvariablen gehen vor:
#   QAD_SFTP=benutzer@host            SFTP-Zugang; Port und Schlüssel ggf. in ~/.ssh/config
#   QAD_SFTP_DIR=webroots/www/qad     Zielordner auf dem Server (Standard: Startordner des Zugangs)
set -eu
cd "$(dirname "$0")/.."
given_sftp=${QAD_SFTP-}
given_dir=${QAD_SFTP_DIR-}
if [ -f deploy.env ]; then . ./deploy.env; fi
QAD_SFTP=${given_sftp:-${QAD_SFTP-}}
QAD_SFTP_DIR=${given_dir:-${QAD_SFTP_DIR-}}
: "${QAD_SFTP:?QAD_SFTP=benutzer@host setzen, z. B. in deploy.env}"
dir=${QAD_SFTP_DIR:-.}
dist=apps/editor/dist
steps=${*:-deploy}
for step in $steps; do
  case $step in
  deploy | clean) ;;
  *)
    echo "Unbekannter Schritt „$step“; möglich sind deploy und clean." >&2
    exit 2
    ;;
  esac
done

work=$(mktemp -d)
# Eine SSH-Verbindung für alle Schritte, damit das Passwort nur einmal gefragt wird.
# BatchMode=no: Auch eine Passwortabfrage ist möglich, nicht nur Schlüssel.
control=/tmp/qad-deploy-%C
remote() { sftp -o BatchMode=no -o ControlMaster=auto -o ControlPath="$control" -o ControlPersist=60 -b "$1" "$QAD_SFTP"; }
finish() {
  ssh -o ControlPath="$control" -O exit "$QAD_SFTP" 2>/dev/null || true
  rm -rf "$work"
}
trap finish EXIT

deploy() {
  pnpm --filter @qad/editor build

  # Der Markenname gehört nicht in die Auslieferung (Quellen stehen nur in Kommentaren).
  if grep -rqi quadro "$dist"; then
    echo "Abbruch: $dist enthält den Markennamen:" >&2
    grep -rio '[a-z0-9:/._-]*quadro[a-z0-9:/._-]*' "$dist" | sort -u >&2
    exit 1
  fi

  # Erst die Assets, zuletzt index.html: Die laufende Seite verweist so bis zum
  # Schluss nur auf Dateien, die schon da sind.
  {
    echo "-mkdir \"$dir\""
    echo "cd \"$dir\""
    echo "-mkdir assets"
    for f in "$dist"/assets/*; do echo "put \"$f\" assets/"; done
    echo "put \"$dist/index.html\""
  } >"$work/deploy"
  remote "$work/deploy"
  echo "Hochgeladen nach $QAD_SFTP:$dir"
}

# Löscht in assets/, worauf die index.html auf dem Server nicht verweist; ohne
# lesbare index.html mit Verweisen löscht es nichts.
clean() {
  printf 'cd "%s"\n-get index.html "%s/live.html"\nls -1 assets\n' "$dir" "$work" >"$work/list"
  remote "$work/list" >"$work/listed"
  grep -o 'assets/[^"'"'"' )>]*' "$work/live.html" 2>/dev/null | sed 's|^assets/||' | sort -u >"$work/keep" || true
  if [ ! -s "$work/keep" ]; then
    echo "Abbruch: Die index.html auf dem Server verweist auf keine Assets; nichts gelöscht." >&2
    exit 1
  fi
  grep '^assets/[^/]*$' "$work/listed" | sed 's|^assets/||' | sort -u | grep -vxF -f "$work/keep" >"$work/stale" || true
  if [ ! -s "$work/stale" ]; then
    echo "Keine alten Assets in $QAD_SFTP:$dir/assets."
    return
  fi
  {
    echo "cd \"$dir\""
    sed 's|.*|-rm "assets/&"|' "$work/stale"
  } >"$work/clean"
  remote "$work/clean"
  echo "Gelöscht in $QAD_SFTP:$dir/assets: $(tr '\n' ' ' <"$work/stale")"
}

for step in $steps; do $step; done
