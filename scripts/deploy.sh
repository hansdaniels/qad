#!/bin/sh
# Baut den Editor und lädt ihn per SFTP auf einen statischen Webspace.
#
# Das Ziel kommt aus der Umgebung oder aus deploy.env im Wurzelverzeichnis
# (nicht im Repository):
#   QAD_SFTP=benutzer@host   SFTP-Zugang; Port und Schlüssel ggf. in ~/.ssh/config
#   QAD_SFTP_DIR=qad         Zielordner auf dem Server (Standard: Startordner des Zugangs)
set -eu
cd "$(dirname "$0")/.."
if [ -f deploy.env ]; then . ./deploy.env; fi
: "${QAD_SFTP:?QAD_SFTP=benutzer@host setzen, z. B. in deploy.env}"
dir=${QAD_SFTP_DIR:-.}
dist=apps/editor/dist

pnpm --filter @qad/editor build

# Der Markenname gehört nicht in die Auslieferung (Quellen stehen nur in Kommentaren).
if grep -rqi quadro "$dist"; then
  echo "Abbruch: $dist enthält den Markennamen:" >&2
  grep -rio '[a-z0-9:/._-]*quadro[a-z0-9:/._-]*' "$dist" | sort -u >&2
  exit 1
fi

# Erst die Assets, zuletzt index.html: Die laufende Seite verweist so bis zum
# Schluss nur auf Dateien, die schon da sind.
batch=$(mktemp)
trap 'rm -f "$batch"' EXIT
{
  echo "-mkdir \"$dir\""
  echo "cd \"$dir\""
  echo "-mkdir assets"
  for f in "$dist"/assets/*; do echo "put \"$f\" assets/"; done
  echo "put \"$dist/index.html\""
} >"$batch"

# BatchMode=no vor -b: Auch eine Passwortabfrage ist möglich, nicht nur Schlüssel.
sftp -o BatchMode=no -b "$batch" "$QAD_SFTP"
echo "Hochgeladen nach $QAD_SFTP:$dir"
