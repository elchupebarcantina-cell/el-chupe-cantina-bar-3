# Subir EL CHUPE a internet

Guía para publicar el sistema en la web y poder entrar desde cualquier lado.

---

## Antes de nada: ¿de verdad lo necesitas?

Vale la pena pensarlo, porque hay una diferencia grande.

**En el computador del local (como está ahora)**

- ✅ Gratis, no pagas nada al mes
- ✅ **Funciona sin internet.** Si se cae la señal, sigues vendiendo
- ✅ Más rápido: todo pasa dentro del local
- ✅ Tus datos no salen de tu equipo
- ❌ Solo puedes ver tus números estando ahí

**En internet**

- ✅ Ves tus ventas desde la casa, desde el celular, desde donde sea
- ✅ Sirve si algún día abres una segunda sede
- ✅ Las copias de seguridad las hace el servidor
- ❌ Cuestas entre US$5 y US$10 al mes
- ❌ **Si se cae el internet del local, no puedes vender.** Esto es serio para
  una cantina un viernes por la noche

**Lo que yo haría:** deja el sistema corriendo en el local (esa es la caja
registradora que no se puede caer) y súbelo a internet solo cuando quieras
consultar desde afuera o cuando abras otra sede.

Hay una opción intermedia que sale gratis: **dejarlo en el local y entrar por
Tailscale** desde tu celular. Está explicada al final.

---

## Opción 1: Railway (la más sencilla)

Es la que recomiendo si quieres subirlo ya. Cuesta alrededor de **US$5 al mes**.

### Lo que necesitas

- Una cuenta de GitHub (gratis)
- Una cuenta de Railway
- Una tarjeta

### Paso a paso

**1. Sube el código a GitHub**

Entra a <https://github.com> y crea un repositorio nuevo. Ponlo en **Private**
(privado), porque ahí va tu configuración.

Después, desde la carpeta del sistema en tu computador:

```bash
git init
git add .
git commit -m "Sistema POS El Chupe"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/elchupe-pos.git
git push -u origin main
```

El archivo `.gitignore` ya está puesto para que **no** se suban tu base de datos
ni tus claves.

**2. Crea el proyecto en Railway**

1. Entra a <https://railway.app> y crea la cuenta
2. **New Project** → **Deploy from GitHub repo**
3. Escoge tu repositorio
4. Railway ve el `Dockerfile` que ya viene incluido y construye solo

**3. Agrega el disco (esto es lo más importante)**

Sin esto **pierdes todas tus ventas cada vez que actualices**. La base de datos
es un archivo, y sin un disco aparte se borra en cada despliegue.

1. En tu servicio, pestaña **Variables** → **+ Volume**
2. Ruta de montaje: `/datos`
3. Tamaño: 1 GB alcanza de sobra

**4. Pon las variables**

En **Variables**, agrega:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `TZ` | `America/Bogota` |
| `DB_PATH` | `/datos/elchupe.db` |
| `BACKUP_DIR` | `/datos/backups` |
| `UPLOAD_DIR` | `/datos/uploads` |
| `JWT_SECRET` | una cadena larga y aleatoria (ver abajo) |
| `ADMIN_EMAIL` | tu correo |
| `ADMIN_PASSWORD` | una contraseña fuerte |

Para generar el `JWT_SECRET`, corre esto en tu computador y copia el resultado:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**5. Genera la dirección**

**Settings** → **Networking** → **Generate Domain**. Te da algo como
`elchupe-pos-production.up.railway.app`, ya con candado de seguridad (HTTPS).

Entra ahí, inicia sesión con el correo y la contraseña que pusiste, y **cambia
la contraseña de una vez**.

### Para actualizar después

```bash
git add .
git commit -m "cambios"
git push
```

Railway reconstruye solo. Tu base de datos no se toca porque está en el disco.

---

## Opción 2: Render

Muy parecido, con precios más predecibles: **US$7 al mes** el servicio más
pequeño que se queda prendido.

1. Sube el código a GitHub igual que arriba
2. Entra a <https://render.com> → **New** → **Web Service**
3. Conecta tu repositorio
4. Render lee el archivo `render.yaml` que ya viene incluido y configura casi todo
5. Solo te pide llenar `ADMIN_EMAIL` y `ADMIN_PASSWORD`

El disco de 1 GB ya viene definido en ese archivo.

> Ojo: el plan gratuito de Render **se duerme** a los 15 minutos sin uso y no
> permite discos. Para un POS necesitas el plan pago.

---

## Opción 3: Tu propio servidor (VPS)

Es la más barata si vas a tener varias sedes: entre **US$4 y US$6 al mes** en
Hetzner, DigitalOcean o Contabo. Pero toca administrarlo tú.

```bash
# Ya conectado a tu servidor por SSH

# 1. Instalar Node
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# 2. Traer el sistema
git clone https://github.com/TU-USUARIO/elchupe-pos.git
cd elchupe-pos
npm install --omit=dev --omit=optional
cp .env.example .env
nano .env          # pon tu JWT_SECRET y tu contraseña
npm run setup

# 3. Que se mantenga prendido y arranque solo
sudo npm install -g pm2
pm2 start server/index.js --name elchupe
pm2 startup
pm2 save
```

Después configuras Nginx como puerta de entrada y le pones el candado de
seguridad gratis:

```bash
sudo certbot --nginx -d pos.tudominio.com
```

---

## Cosas que NO puedes saltarte

### El disco separado

Ya lo dije arriba pero lo repito porque es el error que más duele: **si no
montas un disco aparte, pierdes todas tus ventas en cada actualización.** La
base de datos es un archivo; sin disco propio se va con el contenedor viejo.

### Copias de seguridad

Aunque esté en internet, **descarga una copia cada semana** desde
Ajustes → Copias de seguridad, y guárdala en tu computador o en Google Drive.
Si la cuenta del servidor se cae o se suspende, esa copia es todo lo que tienes.

### La contraseña

La primera contraseña la pones tú en las variables. **Cámbiala apenas entres** y
que no sea la misma de tu correo. Ahora cualquiera en el mundo puede llegar a la
dirección de tu sistema: lo único que lo protege es esa clave.

### La impresora térmica

Esto es importante y a la gente se le olvida: la impresora está **en tu local**,
conectada a un computador. Si el sistema vive en internet, el navegador que
imprime tiene que ser el del computador que tiene la impresora conectada. Desde
tu celular en la casa puedes ver reportes, pero no imprimir tickets.

### El internet del local

Si subes el sistema y se cae la señal, **no puedes cobrar**. Ten un plan B: un
datos del celular compartido, o mejor, deja la instalación local funcionando en
paralelo para vender y usa la de internet solo para consultar.

---

## La opción gratis: entrar a tu local desde afuera

Si lo único que quieres es **ver tus ventas desde el celular**, no necesitas
pagar hosting. Puedes conectarte a tu propio computador de manera segura.

1. Entra a <https://tailscale.com> y crea una cuenta gratis
2. Instálalo en el computador del local
3. Instala la app de Tailscale en tu celular con la misma cuenta
4. Tailscale te da una dirección fija para ese computador
5. Desde el celular entras a `http://esa-direccion:3000`

Ventajas: **no cuestas nada**, tus datos nunca salen de tu equipo, y el local
sigue vendiendo aunque se caiga internet. La única condición es que el
computador del local esté prendido.

Para lo que tú necesitas, esta es probablemente la mejor opción.

---

## Resumen rápido

| | Cuesta | Vende sin internet | Ves desde afuera | Dificultad |
|---|---|---|---|---|
| Solo en el local | Gratis | Sí | No | Ya está listo |
| Local + Tailscale | Gratis | Sí | Sí | Fácil |
| Railway | ~US$5/mes | No | Sí | Fácil |
| Render | ~US$7/mes | No | Sí | Fácil |
| Tu propio VPS | ~US$5/mes | No | Sí | Requiere maña |

Precios de mediados de 2026: revísalos antes de decidir, que cambian seguido.
