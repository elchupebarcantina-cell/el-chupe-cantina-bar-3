# Montar la sede EL CHUPE SALITRE

Esta sede arranca **con su inventario ya cargado**: 5 categorías, 28 productos
y sus unidades. Es el mismo sistema de las otras sedes, con su propia base de
datos: no ve ni toca nada de las demás.

---

## Lo que trae cargado

| Categoría | Productos |
|---|---|
| **Cerveza** | Águila Light 150 · Costeña 150 · Águila Original 150 · Póker 150 · Coronita 192 · Corona 120 · Stella 96 · Smirnoff 24 |
| **Licores** | Aguardiente Amarillo 1/2: 20 · Aguardiente Amarillo Botella: 12 · Aguardiente Antioqueño 1/2: 10 · Aguardiente Antioqueño Botella: 10 · Ron Medellín Botella: 2 · Tequila José Cuervo Botella: 3 · Tequila Patrón Botella: 3 · Whisky Buchanan's Botella: 3 · Whisky Sello Rojo Botella: 3 |
| **Bebidas** | Agua Natural 96 · Agua con Gas 24 · Electrolit 36 · Gatorade 0 · Four Loko 21 |
| **Snacks** | De Todito 24 · Papas Pollo 24 · Chiclets x3 48 · Maní 48 |
| **Cafetería** | Cigarrillos Mustang 1/2: 20 · Cigarrillos Lucky 1/2: 20 |

Cada unidad queda anotada en el kardex como **"Inventario inicial de la sede"**.

**Pendiente antes de vender:** los productos entran con **precio $0**, porque
las hojas no traían precios. Ponle el precio a cada uno en **Productos**.

---

## Paso a paso en Railway

Antes, sube esta versión (1.6.1) a tu repositorio de GitHub, igual que la vez
pasada. Las otras sedes se actualizan solas y no les pasa nada: la carga de
inventario solo funciona en una sede que tenga la variable del paso 5 y que no
tenga ningún producto.

### 1. Proyecto nuevo
**New Project → Deploy from GitHub repo →** tu repositorio de El Chupe.
Que sea un **proyecto nuevo**, no un servicio dentro del proyecto de otra sede.

### 2. Nombre
**Settings → Service Name:** `elchupe-salitre`

### 3. Disco propio
**+ Volume → Mount path:** `/datos`
Tiene que ser un disco **nuevo**, no el de otra sede.

### 4. Variables de siempre

| Nombre | Valor |
|---|---|
| `JWT_SECRET` | una clave larga **distinta** a la de las otras sedes |
| `ADMIN_EMAIL` | el correo del administrador de Salitre |
| `ADMIN_PASSWORD` | una contraseña fuerte. **Anótala en un lugar seguro** |
| `TZ` | `America/Bogota` |

Para generar la clave, en tu computador:
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 5. La variable que carga el inventario

| Nombre | Valor |
|---|---|
| `INVENTARIO_INICIAL` | `salitre` |

### 6. Dirección
**Settings → Networking → Generate Domain**

### 7. Confirma en los logs
En **Deployments → Deploy Logs** tiene que aparecer:

```
Inventario inicial "salitre" cargado: 5 categorias, 28 productos, 1459 unidades.
```

Si reinicia o actualizas después, dirá *"ya se habia cargado antes"*. Es
normal: no se duplica nunca.

### 8. Entra y termina de dejarla lista
1. Entra con el correo y la contraseña del paso 4
2. **Productos** → ponle el precio a cada producto
3. **Mesas → Mis mesas** → crea las zonas y mesas del local
4. **Usuarios** → crea los meseros y cajeros, cada uno con su PIN
5. **Ajustes** → NIT, dirección, teléfono y logo de esta sede
6. **Socios** → pega la lista de socios
7. **Caja → Abrir caja** y a vender

---

## En un computador del local (sin internet)

1. Descomprime el paquete en una carpeta y corre `instalar.bat`
2. Abre una ventana de comandos en esa carpeta y escribe:
   ```
   npm run inventario -- salitre
   ```
3. Corre `iniciar.bat`
