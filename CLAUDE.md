# Contexto del proyecto — universal-cotizaciones

Sistema de cotizaciones y órdenes de servicio para **SU HERRAMIENTA CST** (taller de reparación de herramientas eléctricas, Pereira - Colombia).

---

## Stack

- **Backend**: Node.js + Express (`server.js` entrada, puerto 3001)
- **BD**: MySQL via `mysql2/promise` (`utils/db.js`)
- **IA**: Anthropic SDK `@0.13.1` — usar `client.beta.messages.create()`, NO `client.messages.create()`
- **PDF**: PDFKit `^0.17.2` (`utils/pdf-generator.js`)
- **WhatsApp**: `whatsapp-web.js` (`utils/whatsapp-client.js`)
- **Sesiones**: `express-session` + `bcrypt`
- **Fotos**: `multer` → `public/uploads/fotos-recepcion/`

---

## Estructura de archivos clave

```
server.js                          Entrada — monta sesión, auth, rutas
middleware/apiKey.js               Guard API key opcional (env API_SECRET_KEY)
middleware/auth.js                 requireLogin / requireInterno / requireCliente
utils/db.js                        Pool MySQL
utils/schema.js                    Helpers BD + resolveOrder
utils/ia.js                        Wrapper Anthropic SDK
utils/whatsapp-client.js           Singleton waClient
utils/pdf-generator.js             Generación PDFs
utils/phones.js                    parseColombianPhones() — separa múltiples números
routes/auth.js                     GET/POST /login, /logout, /me
routes/orders.js                   GET/PATCH órdenes + estados + notificaciones WA
routes/quote.js                    GET/POST cotizaciones
routes/whatsapp.js                 POST envío WhatsApp
routes/pdf.js                      GET descargar/POST enviar PDFs
routes/crear-orden.js              POST crear cliente/herramienta/orden + fotos (WIP)
public/login.html                  Página de login
public/seguimiento.html            Vista cliente — seguimiento de sus órdenes
public/crear-orden.html            Módulo creación de órdenes (WIP — bug selección cliente)
public/generador-cotizaciones.html UI principal (vanilla JS)
public/assets/logo.png             Logo portrait 1396x2696 px
public/uploads/fotos-recepcion/    Fotos subidas (en .gitignore)
```

---

## Variables de entorno

```
DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
PORT                  (default 3001)
NODE_ENV
ANTHROPIC_API_KEY
CLAUDE_MODEL
IVA_RATE              (decimal, default 0 — sin IVA)
API_SECRET_KEY        (opcional, guard de rutas)
SESSION_SECRET        (secreto de sesión — agregar al .env)
PARTS_WHATSAPP_NUMBER (número del encargado de repuestos, ej: 3104650437)
```

---

## Git — ramas activas

```
main                  Estado estable inicial
feature/login         Login completo — pendiente merge a main
feature/crear-orden   Módulo crear orden (WIP, basada en feature/login)
```

**Flujo**: trabajar en ramas, mergear a main cuando estén probadas.

---

## Autenticación — b2c_usuario

| Columna | Uso |
|---------|-----|
| `uid_usuario` | PK int(11) AUTO_INCREMENT |
| `usu_nombre` | Nombre para mostrar |
| `usu_login` | Usuario para login |
| `usu_clave` | Contraseña (migración lazy a bcrypt en el login) |
| `usu_tipo` | `A`=admin, `F`=funcionario, `T`=tecnico, `C`=cliente |
| `usu_estado` | `A`=activo, `I`=inactivo |

- Clientes: `b2c_cliente.uid_usuario` apunta a `b2c_usuario`
- Login con `usu_login` + `usu_clave`
- Admin/F/T → `/generador-cotizaciones.html`
- C → `/seguimiento.html`
- Clave por defecto al crear cliente: últimos 4 dígitos de la identificación

---

## Tablas BD

### Del ERP (no modificar estructura)
| Tabla | Descripción |
|-------|-------------|
| `b2c_orden` | uid_orden(int AI), ord_consecutivo, uid_cliente, ord_estado(varchar2), ord_total, ord_impuestos, ord_valor_total, ord_fecha(varchar16 formato YYYYMMDD) |
| `b2c_cliente` | uid_cliente(int AI), uid_usuario, cli_identificacion, cli_razon_social, cli_direccion, cli_telefono, cli_contacto, cli_tel_contacto, cli_estado |
| `b2c_herramienta` | uid_herramienta(int AI), uid_cliente, her_nombre, her_marca, her_serial, her_referencia, her_tipo_medicion, her_cantidad, her_ultima_medicion, her_proximo_mantenimiento, her_estado |
| `b2c_herramienta_orden` | uid_herramienta_orden(int AI), uid_orden, uid_herramienta, hor_tiene_arreglo, hor_fecha_prom_entrega, hor_fecha_real_entrega, hor_aceptada_cliente, hor_fecha_aceptada, hor_observaciones, hor_tecnico, hor_cargo_tecnico, hor_proximo_mantenimiento, **her_estado**(agregado) |
| `b2c_foto_herramienta_orden` | uid_foto_herramienta_orden(int AI), uid_herramienta_orden, fho_archivo(varchar100), fho_nombre(varchar100) |
| `b2c_usuario` | ver arriba |
| `b2c_concepto_costos` | uid_concepto_costo, cco_descripcion, cco_valor, cco_tipo, cco_estado |

### Creadas por este sistema
| Tabla | Descripción |
|-------|-------------|
| `b2c_cotizacion_orden` | Totales cotización por orden |
| `b2c_cotizacion_maquina` | Cotización por máquina (mano de obra, descripción) |
| `b2c_cotizacion_item` | Ítems/repuestos por máquina |
| `b2c_herramienta_status_log` | Historial cambios de estado por máquina |

### Columna agregada al ERP
`b2c_herramienta_orden.her_estado` VARCHAR(32) DEFAULT 'pendiente_revision'

---

## Estados de máquina

| Valor | Label | WA automático |
|-------|-------|---------------|
| pendiente_revision | Pendiente de revisión | — |
| revisada | Revisada | — |
| cotizada | Cotizada | — |
| autorizada | Autorizada | — |
| no_autorizada | No autorizada | — |
| reparada | Reparada | — |
| entregada | Entregada | — |

**Los envíos de WA son manuales** via 3 botones en el frontend:
- Naranja: lista repuestos al encargado (máquinas autorizadas)
- Morado: notifica cliente máquinas reparadas
- Verde: confirma entrega al cliente

---

## Bug pendiente — crear-orden.html

**Problema**: botón "Seleccionar" cliente no funciona.
**Causa probable**: `JSON.stringify` doble en el `onclick` del resultado — revisar función `seleccionarCliente()` y el template HTML que la llama.
**Archivo**: `public/crear-orden.html` función `buscarCliente()` → template del resultado.

---

## Datos de la empresa (hardcoded en pdf-generator.js)

```js
COMPANY = {
  name:    'HERNANDO PARRA ZAPATA',
  nit:     'NIT 9862087-1',
  address: 'calle 21 No 10 02 - Pereira',
  phone:   '3104650437',
  website: 'www.suherramienta.com',
  email:   'suherramientapereira@gmail.com',
}
```

---

## Logo — problema conocido y solución aplicada

`public/assets/logo.png` es portrait (1396x2696 px). En PDFs se rota -90 con PDFKit.
En HTML se rota con CSS: `transform: rotate(-90deg)` + `width: 100px` en login.html.

---

## Teléfonos colombianos — utils/phones.js

`parseColombianPhones(raw)` — separa múltiples números del campo cli_telefono,
filtra solo móviles colombianos (10 dígitos que empiezan por 3), retorna array de chatIds.
Usado en routes/whatsapp.js y routes/orders.js.

---

## ord_fecha — formato YYYYMMDD (varchar)

La fecha se guarda como string `20260212`. Para mostrar en frontend:
```js
const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})$/);
return m ? `${m[3]}/${m[2]}/${m[1]}` : '-';
```

---

## Notas de entorno (Windows / Git Bash)

- Python no disponible (Windows Store shim)
- Heredocs de Bash fallan con comillas simples — usar Write tool
- Rutas Node: forward slashes `C:/...`
- Shell: bash MINGW64 — sintaxis Unix
