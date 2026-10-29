# Actualizar las sedes que ya están funcionando

Esta guía es para poner la versión nueva (1.6: **Socios**) en las sedes que ya
tienen ventas, compras, inventario y caja, **sin perder nada**.

---

## Qué pasa con tus datos

Nada se borra. Al arrancar la versión nueva, el sistema:

1. **Guarda una copia completa** de la base antes de tocar nada
2. **Agrega** lo nuevo: la tabla de socios y dos datos más en cada cuenta
3. **No cambia ni borra** ventas, compras, gastos, inventario, caja, clientes, usuarios ni la configuración
4. Si algo fallara a mitad de camino, **deshace el cambio** y la base queda como estaba

Esto se probó con una sede llena de datos. Las ventas, los pagos, las cuentas
abiertas, las compras, los gastos y el inventario quedaron idénticos. Una cuenta
que estaba abierta antes de actualizar se pudo cobrar después sin problema.

---

## Antes de empezar, en cada sede (2 minutos)

Aunque el sistema saca su propia copia, ten una **en tu mano**:

1. Entra a la sede → **Ajustes → Copias de seguridad → Crear copia ahora**
2. **Descárgala** y guárdala en tu computador o en Drive, con el nombre de la sede

Hazlo en un momento sin clientes, o con la caja cerrada. Las cuentas abiertas
no se pierden al actualizar, pero el sistema se reinicia por unos segundos.

---

## Sedes en Railway (internet)

Todas tus sedes salen del **mismo repositorio de GitHub**. Cuando subes la
versión nueva ahí, Railway actualiza cada sede sola. Cada una conserva su propio
disco `/datos` con sus propios datos.

### Paso 1 — Revisa el disco de CADA sede (lo más importante)

En Railway, entra a cada sede y toca su volumen. El **Mount path** tiene que
decir exactamente:

```
/datos
```

- **Si dice `/datos`** → tus datos están en el disco y sobreviven a la actualización. Sigue.
- **Si no hay volumen, o dice otra cosa** → **NO actualices esa sede todavía.**
  Sus datos viven dentro del programa y se perderían con cualquier actualización.
  Primero descarga la copia de seguridad y avísame: lo arreglamos antes.

### Paso 2 — Sube los archivos nuevos a GitHub

1. Entra a tu repositorio de El Chupe en GitHub
2. **Add file → Upload files**
3. Arrastra **todo el contenido** de esta carpeta (no la carpeta, lo de adentro)
4. Abajo escribe algo como `Version 1.6 - Socios` y toca **Commit changes**

**No subas** `node_modules`, `data`, `backups` ni el archivo `.env`, si los tienes.
(Este paquete no los trae.)

> Si me das acceso al repositorio, yo subo los cambios directo y te ahorras este paso.

### Paso 3 — Mira que se actualizó bien

Railway arranca solo el despliegue de cada sede. En cada una, abre
**Deployments → el más reciente → Deploy Logs**. Tienes que ver algo así:

```
  Copia de seguridad antes de actualizar: /datos/backups/antes-de-actualizar-...db
  aplicada: 002_socios.sql

  Base de datos existente: se conservo todo.
    1532 ventas · 87 productos · 64 compras · 210 gastos · 12 clientes
```

Los números son los de esa sede. **Si los números se ven bien, quedó.**

### Paso 4 — Entra y confirma

1. Abre la sede en el navegador y presiona **Ctrl + Shift + R**
2. Abajo a la izquierda debe decir **v2026.10.01-2**
3. En el menú aparece **★ Socios**
4. Revisa **Ventas hechas** y el **Resumen**: todo debe seguir ahí

---

## Sede en el computador del local (Windows)

1. **Cierra la ventana negra** donde corre el sistema
2. Descomprime esta versión en una **carpeta nueva**
3. Doble clic en **`actualizar.bat`** y arrastra la carpeta anterior cuando te la pida
4. Doble clic en **`instalar.bat`** (no borra nada: si ya hay base, la deja quieta)
5. Doble clic en **`iniciar.bat`**: al arrancar, aplica la actualización sola
6. En el navegador, **Ctrl + Shift + R**

No borres la carpeta vieja hasta que hayas revisado que todo está bien.

---

## Si algo sale mal

No toques nada más y escríbeme con lo que dice la pantalla o el log. Tienes
dos copias de seguridad: la que descargaste tú y la que sacó el sistema en
`backups/antes-de-actualizar-...db` (en Railway: `/datos/backups/`).

---

## Después de actualizar: cargar los socios

**Socios → Agregar varios** y pega la lista: un socio por línea, primero la
cédula y después el nombre.

```
1073777762, Juan Pérez
52987654, Laura Céspedes, 3016667788
```

**Hay que cargarlos en cada sede.** Cada sede es un sistema aparte, así que
tiene su propia lista y su propio conteo de 2 descuentos al mes. Puedes pegar la
misma lista en todas.
