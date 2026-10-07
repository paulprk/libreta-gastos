# Libreta de gastos

**En vivo:** https://libreta-gastos.vercel.app

App web para anotar gastos (rojo) e ingresos (verde). Cada movimiento se guarda con la fecha y hora de Buenos Aires; se ven los totales del mes, la lista por día y gráficos de torta.

## Guardado

- Cada movimiento se guarda al instante en el dispositivo, en dos lugares (IndexedDB y localStorage); al abrir, se unen y se repara la copia que falte.
- Se pide almacenamiento persistente al navegador.
- Instalable (PWA): en iPhone, agregarla a la pantalla de inicio evita que Safari borre los datos por inactividad. Funciona sin conexión.
- Copia de seguridad: descargar y restaurar un archivo `.json` (restaurar une, no borra).

## Copia en la nube (Supabase)

La app guarda siempre primero en el teléfono (funciona sin señal) y sincroniza con Supabase cuando hay conexión. En la nube nunca se borra una fila: borrar marca `deleted = true`. Cada movimiento muestra ✓ (en la nube) o ⏳ (esperando subirse).

Configuración, una sola vez:

1. Crear una cuenta y un proyecto en https://supabase.com (plan gratis).
2. **SQL Editor → New query**: pegar el contenido de `supabase.sql` y tocar **Run**.
3. **Authentication → Email Templates → Magic Link**: reemplazar el texto por uno que incluya el código, por ejemplo:
   `<h2>Tu código para la Libreta de gastos</h2><p>{{ .Token }}</p>`
   (la app entra con un código de 6 números, no con un link, para que funcione bien con la app instalada en el iPhone).
4. **Project Settings → API**: copiar *Project URL* y la clave *anon public* en `js/config.js`.
5. En la app, sección **Tus datos**: escribir el email, tocar **Enviarme el código** y escribir el código.

En el plan gratis, Supabase pausa el proyecto si pasa una semana sin uso; los datos no se pierden y se reactiva desde el panel. Mientras tanto la app sigue guardando en el teléfono.

## Cambiar el ícono

El ícono es un solo archivo: `icons/icono.png`. Para cambiarlo, en la terminal:

```
cd ~/Documents/libreta-gastos
./cambiar-icono.sh /ruta/a/tu-imagen.png
```

(o escribir `./cambiar-icono.sh ` y arrastrar la imagen a la terminal). Acepta PNG, JPG, HEIC o WEBP; si no es cuadrada se recorta al centro. Muestra cómo queda y, si confirmás con `s`, la publica. En el iPhone, el ícono de la pantalla de inicio cambia recién al volver a agregar la app.

## Correr en local

```
python3 -m http.server 5173
```

y abrir http://localhost:5173

## Deploy

Sitio estático: se sube tal cual a Vercel (sin build).
