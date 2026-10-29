# EL CHUPE · Sistema POS

Sistema de punto de venta para café bar. Maneja mesas, cuentas, inventario con recetas, caja, compras, gastos, reportes y usuarios con permisos. Funciona en el computador del local sin necesidad de internet.

---

## 1. Instalación rápida

### Antes de empezar

Necesitas **Node.js versión 22 o superior**. Si no lo tienes:

1. Entra a <https://nodejs.org>
2. Descarga la versión que dice **LTS**
3. Instálala dándole siguiente a todo
4. Reinicia el computador

El sistema usa el SQLite que ya viene incluido dentro de Node, así que la
instalación no compila nada: no necesitas Visual Studio, ni Python, ni
herramientas de desarrollo. Sirve igual en Node 22, 24 o 26.

### Instalar

**En Windows:** doble clic en `instalar.bat`

**En Mac o Linux:** abre la terminal en esta carpeta y escribe:

```bash
bash instalar.sh
```

El instalador revisa que todo esté en orden, crea la configuración con una clave de seguridad única, instala los componentes y arma la base de datos con productos, mesas y roles de ejemplo. Al terminar te muestra el usuario y la contraseña para entrar.

### Arrancar el sistema

**En Windows:** doble clic en `iniciar.bat`

**En Mac o Linux:** `bash iniciar.sh`

También sirve escribir `npm start` en la terminal.

Se abre el navegador en <http://localhost:3000>. Deja esa ventana negra abierta mientras uses el sistema — si la cierras, el POS se apaga.

---

## 2. Ayuda dentro del sistema

Cada pantalla tiene arriba un panel **"?"** que explica en palabras sencillas
para qué sirve y cómo se usa. Tócalo y se despliega. Está pensado para que
cualquiera pueda usar el sistema sin leer este manual.

---

## 3. El sistema llega vacío

Se instala **sin ningún producto, ninguna mesa y ninguna venta**. Está limpio
para que cargues tu negocio real, no el de un ejemplo.

Lo único que trae es lo que necesita para funcionar: los permisos, los roles,
los métodos de pago y tu usuario administrador.

Al entrar por primera vez, el Resumen no te muestra puros ceros: te muestra una
**guía de cuatro pasos** con botones que te llevan a cada sitio.

### ¿Quieres practicar antes con datos de prueba?

Si prefieres jugar un rato antes de cargar lo tuyo:

```bash
npm run demo
```

Eso carga 34 productos, 14 mesas y 6 recetas de ejemplo. Cuando termines de
practicar, déjalo limpio otra vez:

```bash
npm run reset
npm run setup
```

---

## 4. Primer ingreso

El instalador te muestra las credenciales en pantalla. Por defecto:

| Dato | Valor |
|---|---|
| Correo | `admin@elchupe.local` |
| Contraseña | la que esté en tu archivo `.env` |
| PIN rápido | `1234` |

**Lo primero que debes hacer al entrar:**

1. **Configuración → Mi cuenta → Cambiar mi contraseña**
2. **Configuración → Logo** y sube el logo oficial de El Chupe en PNG
3. **Configuración → Datos del negocio**: NIT, dirección, teléfono, mensaje del ticket
4. **Usuarios**: crea los usuarios reales de meseros y cajeros, cada uno con su PIN
5. **Productos**: revisa precios y carga tu carta real
6. **Inventario → Conteo físico**: deja el stock igual a lo que realmente tienes

---

## 5. Cómo usarlo en el día a día

### Abrir el turno

**Caja → Abrir caja.** Escribe la base en efectivo con la que arrancas. Sin caja abierta no se pueden cobrar cuentas.

### Atender una mesa

Cada mesa tiene un color y un dibujo que dice qué le pasa:

| | Qué significa | Qué haces |
|---|---|---|
| ✅ Verde | Libre | Tócala cuando llegue gente |
| 🍽️ Dorada | Atendiendo | Tócala para agregar cosas o cobrar |
| 🔔 Parpadeando | Pidieron la cuenta | Ve a cobrarles |

1. Toca una mesa verde → dice cuántas personas son
2. Toca los productos para irlos agregando
3. **Enviar a cocina** manda la comanda al bar o a la cocina
4. Cuando pidan la cuenta: **Cobrar**

### Armar las mesas de tu local

En **Mesas** toca el botón **🪑 Mis mesas**. Ahí puedes:

- **Agregar una zona** — las partes de tu local: el salón, la terraza, la barra
- **Agregar una mesa** — le pones nombre, cuántos caben y en qué zona va
- **Editar** o **eliminar** cualquiera

Si una mesa tiene cuenta abierta, el sistema no te deja eliminarla hasta cobrarla.

### Anotar un gasto

En **Gastos** toca el botón verde grande. Solo te pide dos cosas:

1. **¿En qué gastaste?** — escribe lo que sea: "oficios varios", "hielo",
   "domicilio". Hay botones con los más comunes para no escribir.
2. **¿Cuánto fue?**

Y ya. **No necesitas crear un proveedor**, ni clasificarlo, ni nada. Si quieres
puedes abrir "Otros datos" y ponerle un tipo, la forma de pago o la fecha — pero
es opcional. Si te falta un tipo de gasto, lo creas ahí mismo sin salir.

### Cobrar

En la ventana de cobro eliges el método de pago y el valor. Si el cliente paga con dos métodos (parte tarjeta, parte efectivo), registras el primer pago y el sistema te deja pendiente el resto. Si pagas en efectivo y escribes cuánto te dieron, calcula el cambio solo.

Al quedar en cero, la cuenta se cierra, la mesa se libera y se imprime la factura.

### Dividir y unir cuentas

Desde **Mesas**, el menú de cada mesa ocupada tiene:

- **Dividir cuenta**: escoges qué productos se van a una cuenta nueva
- **Unir cuentas**: juntas dos mesas en una sola
- **Trasladar**: mueves la cuenta completa a otra mesa
- **Cambiar mesero**: reasignas quién atiende

### Cerrar el turno

La pantalla de **Caja** tiene una sola cosa grande en el centro: el botón de
abrir o el de cerrar, según como esté. Debajo quedan las acciones secundarias
(registrar un ingreso, un retiro, imprimir el arqueo) y el historial.

**Caja → Cerrar caja.** Cuentas el efectivo real y lo escribes. El sistema compara contra lo que debería haber y te muestra el sobrante o faltante. Imprime el arqueo firmado.

No deja cerrar si quedan cuentas abiertas sin cobrar.

### El día de trabajo lo define la caja, no la medianoche

En una cantina la venta de las 11 p.m. y la de la 1 a.m. son de la **misma noche
de trabajo**. Por eso el dashboard no corta a medianoche: la jornada arranca
cuando abres la caja y termina cuando la cierras.

- **Con la caja abierta** → el dashboard muestra en vivo lo que va vendido desde
  la apertura. Se actualiza solo cada 25 segundos, sin recargar la página.
- **Sin caja abierta** → muestra la última jornada cerrada, para que puedas
  revisarla con calma.

Las tarjetas de *Esta semana* y *Este mes* sí van por calendario, como siempre.

---

## 6. Inventario y recetas

Hay tres tipos de producto:

- **Producto simple** — una cerveza, un paquete de papas. Al venderlo se descuenta una unidad de su propio stock.
- **Con receta** — un mojito. Al venderlo se descuentan los ingredientes: 60 ml de ron, 5 gr de hierbabuena, etc. El costo se calcula solo sumando los ingredientes.
- **Insumo** — el ron, el hielo, la hierbabuena. No se vende suelto, solo alimenta las recetas.

Para armar una receta: **Productos** → abre el producto → **Editar receta** → agrega cada ingrediente con su cantidad.

Cada movimiento queda en el **kardex** del producto: entradas, salidas, saldo después de cada una, quién lo hizo y por qué. Nada se borra.

Cuando algo se cae, se daña o se lo toma el personal: **Inventario → Registrar movimiento**, escoges el tipo (pérdida, daño, consumo interno) y anotas el motivo.

---

## 7. Permisos

Vienen seis roles armados: Super Administrador, Administrador, Cajero, Mesero, Inventario y Contabilidad. Puedes crear más y marcar exactamente qué puede hacer cada uno desde **Usuarios → Roles y permisos**.

Detalles que valen la pena:

- El permiso **"Ver costos"** está separado. Un mesero o cajero puede vender sin ver nunca cuánto te cuesta cada producto.
- El **tope de descuento para meseros** se configura en pesos. Por encima de ese valor, el descuento necesita otro rol.
- **Anular ventas** es un permiso aparte y siempre exige escribir un motivo.

---

## 7.1 Socios: descuento exclusivo

Los socios son las personas que invirtieron en El Chupe. Cada uno tiene
**5% de descuento en su cuenta, 2 veces al mes**. El porcentaje y las veces se
cambian en **Socios → Cambiar beneficio**.

**Cómo lo usa la mesera:**

1. Abre la cuenta normal y agrega los productos
2. Toca **★ Socio** y escribe la cédula (con o sin puntos)
3. El sistema muestra el nombre y cuántos descuentos le quedan en el mes
4. **Aplicar descuento**. Listo: la cuenta baja sola y en la factura sale "Descuento socio 5%"

**Reglas que maneja el sistema solo:**

- El cupo se **renueva el día 1 de cada mes**. No hay que hacer nada.
- Si ya usó sus 2 del mes, el sistema no deja aplicarlo y dice cuándo se le renueva.
- Si anulan la cuenta, o le quitan el descuento antes de cobrar, el socio **recupera ese uso**.
- No se suma con otros descuentos: si la cuenta ya tiene uno, hay que quitarlo primero.
- La mesera puede aplicarlo, pero **no ve la lista de socios**. Esa la ven el administrador, el cajero y contabilidad.

**Agregar socios:** **Socios → Agregar socio**, o **Agregar varios** para pegar
una lista desde Excel (cédula, nombre y si quieres teléfono, uno por línea).
Un socio que ya usó el descuento no se borra, se desactiva, para no perder el historial.

**Ojo con varias sedes:** hoy cada sede es un sistema aparte, así que cada una
tiene su propia lista de socios y su propio conteo. Hay que agregar a los socios
en cada sede, y el límite de 2 al mes se cuenta por sede.

---

## 8. Auditoría

Todo movimiento importante queda registrado: quién abrió cuentas, quién dio descuentos, quién anuló ventas, quién ajustó inventario, quién abrió y cerró caja, e intentos de acceso fallidos.

Está en **Auditoría** y no se puede borrar desde la interfaz.

---

## 9. Impresión de tickets

El sistema imprime usando el navegador, así que sirve con cualquier impresora térmica que ya funcione en Windows o Mac.

**Cómo dejarlo listo:**

1. Instala tu impresora térmica normalmente
2. En **Configuración**, escoge si tu papel es de 58 mm o de 80 mm
3. La primera vez que imprimas, en la ventana del navegador:
   - Escoge tu impresora térmica
   - **Márgenes: ninguno**
   - **Desmarca** "encabezados y pies de página"
   - Marca "gráficos de fondo"
4. Marca la casilla para no volver a preguntar

Se imprimen tres cosas distintas: la **factura** para el cliente, la **comanda** para cocina o bar (solo los productos de esa estación) y el **arqueo** al cerrar caja.

---

## 10. Copias de seguridad

**Configuración → Copias de seguridad → Crear copia ahora.**

Cada copia es la base de datos completa. Descárgala y guárdala en una USB o en la nube — si el computador del local se daña, ahí está todo.

**Hazlo al final de cada día.**

Para restaurar: apaga el sistema, reemplaza el archivo `data/elchupe.db` por la copia que descargaste, vuelve a arrancar.

---

## 11. Usar el sistema desde tablets y celulares

El sistema ya está listo para que los meseros tomen pedidos desde una tablet, sin instalar nada:

1. En el computador donde corre el sistema, averigua su dirección IP local
   - Windows: abre el símbolo del sistema y escribe `ipconfig`, busca "Dirección IPv4"
   - Mac: `ipconfig getifaddr en0`
   - Da algo como `192.168.1.15`
2. Conecta la tablet al **mismo WiFi** del local
3. En el navegador de la tablet entra a `http://192.168.1.15:3000`
4. Cada mesero entra con su PIN

Ponle un IP fijo al computador en el router para que no cambie.

---

## 12. Estructura del proyecto

```
el-chupe-pos/
├── instalar.sh   / instalar.bat    instaladores
├── iniciar.sh    / iniciar.bat     arrancar el sistema
├── actualizar.sh / actualizar.bat  traer datos de una version anterior
├── SUBIR-A-INTERNET.md             guia para publicarlo en la web
├── Dockerfile                      para publicarlo en internet
├── railway.json / render.yaml      configuracion de los servicios de hosting
├── .env.example                  plantilla de configuración
├── package.json
│
├── server/                       backend
│   ├── index.js                  servidor y seguridad
│   ├── config/env.js
│   ├── db/
│   │   ├── connection.js
│   │   ├── migrate.js            crea y actualiza las tablas (sin borrar datos)
│   │   ├── seed.js               datos de arranque
│   │   ├── backup.js
│   │   ├── reset.js
│   │   └── migrations/
│   ├── middleware/               sesión, permisos, auditoría, errores
│   ├── services/                 lógica de inventario, órdenes, caja, reportes
│   ├── routes/                   endpoints de la API
│   └── utils/
│
├── public/                       frontend
│   ├── index.html
│   ├── assets/logo.svg
│   ├── css/                      tokens, estilos, impresión
│   └── js/
│       ├── app.js                sesión y navegación
│       ├── api.js
│       ├── ui.js
│       └── views/                una vista por módulo
│
└── data/                         base de datos y copias (se crea sola)
```

---

## 13. Actualizar el sistema sin perder tus datos

**Desde la versión 1.6 el sistema se actualiza solo al arrancar.** Si la versión
nueva trae cambios en la base de datos:

1. Primero guarda una **copia completa** de tu base en la carpeta de copias
   (`backups/antes-de-actualizar-FECHA.db`, o `/datos/backups` en Railway)
2. Después **agrega** lo nuevo (tablas y columnas). Nunca borra ni cambia lo que ya hay
3. Si algo fallara, deshace el cambio y la base queda exactamente como estaba

Las ventas, compras, gastos, inventario, caja, clientes, usuarios y la
configuración se conservan tal cual. La guía paso a paso para cada sede está en
**`ACTUALIZAR-SEDES.md`**.

### En el computador del local

Hay un asistente que hace todo el traslado solo.

1. **Cierra la ventana negra** donde corre el sistema. Esto es obligatorio: el
   programa se queda en memoria y si no lo cierras seguirá corriendo la versión
   vieja aunque cambies los archivos.
2. Descomprime la versión nueva en una **carpeta limpia**.
3. Doble clic en **`actualizar.bat`** (Mac o Linux: `bash actualizar.sh`).
   Te pide la carpeta anterior — puedes arrastrarla a la ventana.
4. Corre **`instalar.bat`** y después **`iniciar.bat`**.
5. En el navegador presiona **Ctrl + Shift + R**.

El asistente trae tu base de datos con todas las ventas, tu archivo de
configuración, tu logo y las imágenes. Además guarda una copia de respaldo de tu
base anterior en `backups/antes-de-actualizar.db` por si acaso.

**Si prefieres hacerlo a mano**, copia estas tres cosas de la carpeta vieja a la
nueva: la carpeta `data`, el archivo `.env` y la carpeta `public/uploads`.

### Ya no necesitas borrar el caché

Desde esta versión, los archivos de la interfaz se sirven bajo una dirección que
incluye el número de versión (`/v/1.2.0/js/app.js`). Cada actualización estrena
dirección, así que el navegador está **obligado** a pedir los archivos nuevos:
los viejos quedaron en una ruta que ya nadie solicita.

Esto elimina de raíz el problema de "actualicé pero sigue saliendo la pantalla
vieja". Ya no hace falta el Ctrl + Shift + R.

### Cómo sabes qué versión estás corriendo

Abajo en la barra lateral, debajo de tu nombre, aparece el número de versión.
Si alguna vez algo no cuadra, ese número dice exactamente qué tienes instalado.

Además, si el programa y la pantalla quedaran desfasados, sale un aviso con los
pasos para arreglarlo en vez de un error técnico.

---

## 14. Comandos disponibles

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el sistema |
| `npm run dev` | Arranca en modo desarrollo (se reinicia solo al editar) |
| `npm run setup` | Crea la base de datos **limpia**, lista para tu negocio |
| `npm run demo` | Carga productos y mesas de ejemplo para practicar |
| `npm run migrate` | Solo crea o actualiza las tablas |
| `npm run seed` | Solo carga los datos de arranque |
| `npm run backup` | Crea una copia de seguridad desde la terminal |
| `npm run clave` | Lista los usuarios o cambia una contraseña olvidada |
| `npm run reparar` | Revisa si hay gastos sueltos que no se están restando de la caja |
| `npm run reset` | **Borra toda la base de datos.** Solo para pruebas. |

---

## 15. Problemas comunes

**"El puerto 3000 está ocupado"**
Abre `.env` y cambia `PORT=3000` por `PORT=3001`. Entra entonces a `http://localhost:3001`.

**"No puedo cobrar, dice que no hay caja abierta"**
Ve a **Caja → Abrir caja** y registra la base del turno.

**"Al cerrar caja no me restan los gastos y las cuentas no dan"**
Eso pasaba en versiones anteriores a la 1.5.0: un gasto anotado sin decir cómo
se pagó quedaba sin conectar a la caja, así que se veía en Gastos pero no se
restaba del arqueo. Ya está corregido: ahora si no dices cómo pagaste, el
sistema asume **efectivo**, que es de donde sale la plata en un bar.

Para arreglar los gastos que ya habías anotado antes:

```bash
npm run reparar           # te muestra qué encontró, sin cambiar nada
npm run reparar -- --si   # lo aplica
```

Recalcula también los arqueos de las cajas que ya habías cerrado. Es seguro
correrlo varias veces.

**"No me deja cerrar la caja"**
Hay cuentas abiertas sin cobrar. Ve a **Mesas** y ciérralas o anúlalas.

**"El producto no descuenta inventario"**
Revisa en **Productos** que tenga marcado "Controlar inventario". Si es un cóctel, revisa que tenga la receta armada.

**"Se me olvidó la contraseña del administrador"**
Usa el comando de recuperación. Primero mira qué usuarios hay:

```bash
npm run clave
```

Y después cámbiale la clave al que necesites:

```bash
npm run clave -- admin@elchupe.local MiClaveNueva123
```

También puedes cambiarle el PIN de una vez agregando `--pin 4821`. Esto no toca
tus ventas ni nada más, y queda registrado en Auditoría.

Si el sistema está en internet (Railway), abre la pestaña **Console** y escribe
ahí el mismo comando.

**"La instalación falla y la ventana dice node-gyp"**
Eso pasa cuando alguna dependencia intenta compilarse en el equipo. Esta versión
del sistema ya no compila nada. Si te aparece, borra la carpeta `node_modules`
y el archivo `package-lock.json`, y vuelve a ejecutar el instalador.

**"Dice que necesito Node 22 o superior"**
Tienes una versión vieja. Entra a <https://nodejs.org>, descarga la LTS,
instálala encima de la que tienes y reinicia el computador.

**"Sale un error raro después de actualizar" o "el logo aparece roto"**
Casi siempre es que **no se cerró la ventana negra** antes de cambiar los
archivos. El programa se queda en memoria con el código viejo aunque los
archivos del disco ya sean nuevos. Ciérrala, vuelve a abrirla con `iniciar.bat`
y recarga con **Ctrl + Shift + R**.

Si el logo sale roto, es que se perdió la carpeta `public/uploads` al actualizar.
Vuelve a subirlo desde Configuración → Logo, o usa `actualizar.bat`, que la
copia sola.

**"Las ventas de anoche me aparecen en las de hoy"**
Eso pasaba en versiones anteriores porque las horas se guardaban en horario
universal en vez del horario de Colombia. Ya está corregido. Si tienes una base
de datos creada con la versión vieja, los registros anteriores conservan la hora
corrida; lo más limpio es empezar con base nueva antes de abrir el local.

**"El ticket sale en una hoja tamaño carta"**
Ya no debería. La hoja se genera del ancho exacto del rollo. Si aún te pasa,
revisa en la ventana de impresión que el tamaño de papel diga 58 mm o 80 mm y no
Carta, y que los márgenes estén en ninguno.

**"El ticket sale con encabezados raros del navegador"**
En la ventana de impresión: márgenes en ninguno y desmarca "encabezados y pies de página".

---

## 16. Notas técnicas

- **Base de datos:** SQLite en modo WAL con llaves foráneas activas. Un solo archivo, sin servidor aparte.
- **Motor de base de datos:** usa `node:sqlite`, el SQLite que viene dentro de Node.js desde la versión 22.5. No hay módulos nativos que compilar, así que la instalación no depende de node-gyp, Python ni Visual Studio, y no se rompe cuando sale una versión nueva de Node. Si el equipo tuviera un Node más viejo, el sistema cae automáticamente a `better-sqlite3` si está instalado.
- **Copias de seguridad:** se hacen con `VACUUM INTO`, que genera un archivo consistente aunque el sistema esté en uso.
- **Sesiones:** JWT en cookie `httpOnly`, `sameSite=strict`. No se guarda nada sensible en el navegador.
- **Contraseñas:** hasheadas con bcrypt. No se pueden recuperar, solo reemplazar.
- **Transacciones:** cada venta, pago, anulación, compra y cierre de caja va dentro de una transacción. Si algo falla a mitad de camino, nada queda a medias.
- **Anulaciones:** nunca se borra un registro. Se marca como anulado y el inventario se devuelve automáticamente.
- **Exportación:** los CSV salen con punto y coma y BOM, listos para abrir en Excel en español sin desconfigurarse.
- **Horas:** todos los registros se guardan en la hora del equipo (`localtime`), no en horario universal. Así el corte del día coincide con la realidad del local.
- **Jornada:** el dashboard usa la ventana apertura → cierre de caja como "hoy", en vez de medianoche a medianoche.
- **Impresión:** la regla `@page` se genera con el ancho del rollo y alto automático, así que la hoja mide lo mismo que el ticket y no salen páginas en blanco.
- **Caché:** los archivos de la interfaz se sirven bajo `/v/<versión>/`. Cada versión estrena URL, así que el navegador no puede reutilizar archivos viejos: quedan en rutas que ya nadie pide. El `index.html` se arma en cada petición con `no-store` y es lo único que se vuelve a descargar siempre. Resultado: actualizar nunca deja la interfaz desfasada, y de paso los archivos cargan desde caché al instante porque la URL ya identifica la versión.
- **Sin internet:** todo el frontend es local, no carga librerías de afuera. Las fuentes tienen respaldo del sistema si no hay conexión.

---

## 17. Subirlo a internet

Si quieres ver tus ventas desde afuera del local, hay una guía aparte:
**`SUBIR-A-INTERNET.md`**. Cubre Railway, Render, tu propio servidor, y una
opción gratis con Tailscale que probablemente es la que más te conviene.

Léela completa antes de decidir: hay una diferencia importante entre tener el
sistema en el local (sigue vendiendo aunque se caiga internet) y tenerlo en la
web (si se cae la señal, no puedes cobrar).

---

## 18. Antes de ponerlo en el local

- [ ] Cambiar la contraseña del administrador
- [ ] Subir el logo oficial
- [ ] Llenar los datos del negocio y el NIT
- [ ] Crear los usuarios reales con sus PINes
- [ ] Cargar la carta real con precios
- [ ] Armar las recetas de los cócteles
- [ ] Hacer el conteo físico inicial del inventario
- [ ] Configurar las zonas y mesas como están en el local
- [ ] Probar la impresora térmica
- [ ] Probar el acceso desde una tablet en el WiFi
- [ ] Hacer una copia de seguridad de prueba y guardarla afuera
