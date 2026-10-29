# Montar una segunda sede

Los archivos son los mismos. Lo que cambia es **dónde** los montas.

---

## Lo primero que tienes que entender

El paquete **siempre viene vacío**. No trae ni un producto ni una venta, nunca.
Los datos no viven en los archivos: viven en el disco `/datos` de cada
despliegue.

Eso significa que si montas un servicio nuevo con su propio disco, arranca
limpio solo. No hay nada que borrar.

**Lo que NO debes hacer:** duplicar el servicio que ya tienes, ni apuntar el
nuevo al mismo disco. Si haces eso, las dos sedes comparten la misma base y
verías los productos y las ventas de la primera mezclados con los de la
segunda.

---

## Antes de empezar: ¿separadas o juntas?

Vale la pena pensarlo cinco minutos, porque cambiarlo después cuesta.

**Dos sistemas separados** (lo que estás a punto de hacer)

- Cada sede con su inventario, sus productos, sus meseros y su caja
- Nadie de una sede ve ni toca lo de la otra
- **Pero:** no hay un reporte que te sume las dos. Para saber cómo va El Chupe
  completo, tienes que entrar a cada una y sumar a mano

**Un solo sistema con varias sedes**

- Un solo lugar, con reportes consolidados y comparación entre sedes
- Cargas la carta una vez y sirve para todas
- **Pero:** hay que construirlo. El sistema hoy no maneja sedes, y es trabajo

Para dos sedes, separadas funciona bien. Cuando vayas por la tercera o la
cuarta, sumar a mano se vuelve un dolor de cabeza y ahí sí conviene unificarlo.

---

## Paso a paso en Railway

### 1. Repositorio: usa el mismo

No necesitas crear otro. El código es idéntico. Railway puede desplegar el mismo
repositorio en varios servicios distintos.

### 2. Crea un proyecto nuevo

En Railway: **New Project** → **Deploy from GitHub repo** → escoge tu
repositorio de El Chupe.

Hazlo como **proyecto nuevo**, no como servicio dentro del proyecto de la
primera sede. Así quedan bien separados y no te confundes después.

### 3. Ponle nombre a la sede

En **Settings** → **Service Name**, algo que distingas de una:
`elchupe-acacias`, `elchupe-medellin`, lo que corresponda.

### 4. Crea su propio disco

**+ Volume** → Mount path: `/datos`

Este disco es **nuevo y vacío**. No es el mismo de la primera sede. Cada sede
tiene el suyo.

### 5. Las variables

| Nombre | Valor |
|---|---|
| `JWT_SECRET` | una clave larga **distinta** a la de la otra sede |
| `ADMIN_EMAIL` | el correo del encargado de esta sede |
| `ADMIN_PASSWORD` | una contraseña fuerte |
| `TZ` | `COT5` |

Para generar la clave, en tu computador:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Usa una clave diferente para cada sede. Si una se filtra, la otra sigue segura.

### 5.1 (Opcional) Sede con inventario ya cargado

Si la sede tiene un archivo de inventario en `server/db/inventarios/` (por
ejemplo `salitre.json`), agrega la variable `INVENTARIO_INICIAL` con ese nombre
(`salitre`). Al arrancar carga categorías, productos y unidades una sola vez.
Ver `MONTAR-SALITRE.md`.

### 6. Genera la dirección

**Settings** → **Networking** → **Generate Domain**.

Te da una dirección distinta, tipo `elchupe-acacias.up.railway.app`.

### 7. Entra y confirma que está limpio

Inicia sesión con el correo y contraseña del paso 5.

Deberías ver la **pantalla de bienvenida con los cuatro pasos** — esa es la
señal de que la base está vacía y lista.

Si en vez de eso ves productos o ventas, algo quedó mal conectado: revisa que
el disco del paso 4 sea nuevo y no el de la otra sede.

---

## Cargar esta sede

Los mismos cuatro pasos de siempre:

1. **Ajustes** — nombre, NIT, dirección y teléfono **de esta sede**, y el logo
2. **Mesas** — las zonas y mesas de este local
3. **Productos** — la carta con los precios de esta sede
4. **Usuarios** — los meseros y cajeros de acá, cada uno con su PIN

---

## Un atajo para la carta

Si las dos sedes venden casi lo mismo, no vuelvas a digitar todo:

1. En la primera sede: **Productos** → **Exportar CSV**
2. Abre el archivo, ajusta los precios si cambian
3. En la sede nueva, cárgalo

Las mesas sí toca crearlas a mano, porque cada local es distinto.

---

## Para acordarte

Cada sede es independiente. Eso significa que cada una necesita **su propia
copia de seguridad semanal**. Ponte la alarma para las dos.

Y cada servicio en Railway cobra aparte: calcula entre US$5 y US$10 al mes
**por sede**.
