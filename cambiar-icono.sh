#!/bin/bash
# Cambia el ícono de la app: ./cambiar-icono.sh /ruta/a/tu-imagen.png
# Acepta PNG, JPG, HEIC o WEBP. Si no es cuadrada, se recorta al centro. La deja en 512×512,
# te la muestra y, si confirmás, la publica (GitHub → Vercel).
set -e
cd "$(dirname "$0")"

if [ -z "$1" ] || [ ! -f "$1" ]; then
  echo "Uso: ./cambiar-icono.sh /ruta/a/tu-imagen.png"
  echo "Tip: escribí ./cambiar-icono.sh y arrastrá la imagen a la terminal."
  exit 1
fi

TMP="$(mktemp -d)/icono.png"
sips -s format png "$1" --out "$TMP" >/dev/null
W=$(sips -g pixelWidth "$TMP" | awk '/pixelWidth/ {print $2}')
H=$(sips -g pixelHeight "$TMP" | awk '/pixelHeight/ {print $2}')
SIDE=$(( W < H ? W : H ))
sips -c "$SIDE" "$SIDE" "$TMP" >/dev/null
sips -z 512 512 "$TMP" >/dev/null

echo "Así va a quedar el ícono (se abre en Vista Previa)."
open -a Preview "$TMP"
read -r -p "¿Lo publico? (s/n) " OK
if [ "$OK" != "s" ] && [ "$OK" != "S" ]; then
  echo "No se cambió nada."
  exit 0
fi

cp "$TMP" icons/icono.png
# Nueva versión del service worker, para que la app instalada tome el ícono nuevo.
perl -pi -e 's/libreta-gastos-v(\d+)/"libreta-gastos-v".($1+1)/e' sw.js

git add icons/icono.png sw.js
GIT_AUTHOR_NAME="Paul" GIT_AUTHOR_EMAIL="128933681+paulprk@users.noreply.github.com" \
GIT_COMMITTER_NAME="Paul" GIT_COMMITTER_EMAIL="128933681+paulprk@users.noreply.github.com" \
  git commit -q -m "Cambio del ícono de la app"
git push -q
echo "Listo: en uno o dos minutos se publica en https://libreta-gastos.vercel.app"
echo "En el iPhone, el ícono de la pantalla de inicio se actualiza recién al volver a agregar la app."
