# Ya está en Railway. ¿Y ahora qué?

Estás a tres pasos de poder usarlo. El primero es el más importante.

---

## Paso 1 — El disco (esto es lo urgente)

En la pantalla veo `elchupe-pos-datos`, así que ya creaste el volumen. **Falta
confirmar dónde está montado.**

1. Toca `elchupe-pos-datos`
2. Busca donde dice **Mount path**
3. Tiene que decir exactamente: `/datos`

Si dice otra cosa (por ejemplo `/data` o `/app/data`), **cámbialo a `/datos`**.

**Por qué importa tanto:** tu base de datos es un archivo. Si no está en el
disco, vive dentro del programa — y cada vez que actualices, Railway bota el
programa viejo y arma uno nuevo. **Se irían todas tus ventas con él.** El disco
es lo único que sobrevive entre actualizaciones.

---

## Paso 2 — Las variables

Ve a la pestaña **Variables** y agrega estas. Sin la primera, el sistema ni
siquiera arranca (es una protección a propósito, para que nadie deje una clave
de ejemplo puesta en internet).

| Nombre | Valor |
|---|---|
| `JWT_SECRET` | (la clave larga que te di en el chat) |
| `ADMIN_EMAIL` | tu correo real |
| `ADMIN_PASSWORD` | una contraseña fuerte que te sepas |
| `TZ` | `America/Bogota` |

Las de abajo ya vienen puestas dentro del `Dockerfile`, pero si Railway te deja
verlas y alguna no aparece, agrégala:

| Nombre | Valor |
|---|---|
| `DB_PATH` | `/datos/elchupe.db` |
| `BACKUP_DIR` | `/datos/backups` |
| `UPLOAD_DIR` | `/datos/uploads` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |

Al guardar, Railway vuelve a desplegar solo. Espera un minuto.

---

## Paso 3 — Entrar

Abre tu dirección:

**https://elchupe-pos-production.up.railway.app**

Inicia sesión con el `ADMIN_EMAIL` y el `ADMIN_PASSWORD` que pusiste.

**Apenas entres, cambia la contraseña** en Ajustes → Mi cuenta.

---

## Si algo sale mal

Toca **View logs** en Railway. Ahí sale escrito qué pasó:

| Lo que dice el log | Qué significa |
|---|---|
| `ERROR: define JWT_SECRET` | Falta la variable del paso 2 |
| `EL CHUPE - Sistema POS` y `Escuchando` | Todo bien, ya está corriendo |
| `Sistema LIMPIO, listo para cargar tu negocio` | La base se creó bien |
| `USUARIO ADMINISTRADOR` + una contraseña | No pusiste `ADMIN_PASSWORD`, así que se generó una. Cópiala de ahí. |

---

## Cómo saber si el disco quedó bien (la prueba de fuego)

Vale la pena comprobarlo **antes** de cargar tu carta, no después.

1. Entra al sistema y crea una mesa cualquiera, por ejemplo "Prueba"
2. En Railway, pestaña **Deployments** → toca los tres puntos → **Redeploy**
3. Espera a que termine y vuelve a entrar

**Si la mesa "Prueba" sigue ahí, el disco quedó bien.** Ya puedes cargar todo
con confianza.

**Si desapareció, el disco no está montado en `/datos`.** Vuelve al paso 1 y
arréglalo antes de seguir, porque si cargas tu carta completa la vas a perder.

---

## Cosas que no puedes olvidar

**Tu crédito.** Arriba dice "30 days or $5.00 left". Es crédito de prueba. Antes
de que se acabe tienes que poner una tarjeta o el sistema se apaga. Calcula
entre US$5 y US$10 al mes.

**Las copias de seguridad.** Aunque esté en la nube, entra cada semana a
Ajustes → Copias de seguridad y **descarga una a tu computador**. Si la cuenta
se suspende o algo pasa, esa copia es todo lo que te queda.

**La impresora.** Está en tu local, conectada a un computador. Desde el celular
puedes ver reportes, pero para imprimir tickets tienes que estar en el navegador
del computador que tiene la impresora conectada.

**El internet.** Ahora el sistema vive en la nube. Si se cae la señal del local,
no puedes cobrar. Ten un plan B: datos del celular compartidos, o deja también
la instalación local funcionando para vender.

---

## Para actualizar más adelante

Subes los archivos nuevos a GitHub igual que la primera vez. Railway se da
cuenta solo y vuelve a desplegar. Tu base de datos no se toca, porque está en
el disco.
