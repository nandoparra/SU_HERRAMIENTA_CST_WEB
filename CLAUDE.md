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
server.js                          Entrada — monta sesión, auth, rutas + migraciones automáticas BD
middleware/apiKey.js               Guard API key opcional (env API_SECRET_KEY)
middleware/auth.js                 requireLogin / requireInterno / requireCliente
                                     └─ requireInterno devuelve 401/403 JSON en rutas /api/
utils/db.js                        Pool MySQL
utils/schema.js                    Helpers BD + resolveOrder + getTechnicianWhereClause
                                     └─ filtra usu_tipo='T' — solo técnicos en selector cotizaciones
utils/ia.js                        Wrapper Anthropic SDK
utils/whatsapp-client.js           Singleton waClient + parche LID + validación getNumberId
utils/wa-handler.js                Listener mensajes entrantes WA — flujo autorización cotizaciones
                                     └─ resuelve LID vía msg.getContact() antes de buscar pendiente
utils/pdf-generator.js             Generación PDFs (quote, maintenance, orden de servicio)
utils/phones.js                    parseColombianPhones() — separa múltiples números
routes/auth.js                     GET/POST /login (rate limit 10/15min), /logout, /me
                                     └─ POST /login redirige a /dashboard.html (internos) o /seguimiento.html (C)
routes/orders.js                   GET/PATCH órdenes + estados + notificaciones WA
                                     └─ todos los endpoints con requireInterno
                                     └─ GET /orders/:id/detalle — orden+cliente+máquinas+fotos+cotización
                                     └─ POST /orders/:id/fotos-trabajo/:uid — subir foto de trabajo
                                     └─ DELETE /orders/fotos-trabajo/:uid — eliminar foto de trabajo
routes/quote.js                    GET/POST cotizaciones — mensaje incluye menú WA autorización
routes/whatsapp.js                 POST envío WhatsApp — registra pendiente en b2c_wa_autorizacion_pendiente
routes/pdf.js                      GET descargar/POST enviar PDFs
                                     └─ /pdf/orden — PDF con todas las máquinas de la orden
                                     └─ /print/orden — HTML wrapper con auto-print
                                     └─ /informes/:uid — requireInterno
routes/crear-orden.js              POST crear cliente/herramienta/orden + fotos
                                     └─ todos los endpoints con requireInterno
routes/dashboard.js                KPIs + CRUD clientes, funcionarios, inventario (requireInterno)
                                     └─ GET /dashboard?mes=YYYY-MM — KPIs + alertas reparadas sin entregar
                                     └─ GET /clientes/search, GET /clientes/:id
                                     └─ GET/POST/PATCH /funcionarios, GET/POST/PATCH /inventario
public/login.html                  Página de login
public/seguimiento.html            Vista cliente — seguimiento de sus órdenes
public/crear-orden.html            Módulo creación de órdenes
public/ordenes.html                Consulta de órdenes — buscador + detalle + fotos + cotización
                                     └─ selector de estado por máquina inline
                                     └─ botón Informe por máquina
                                     └─ botón Editar/Ver cotización según estado
public/dashboard.html              SPA principal — 6 vistas con sidebar responsive
                                     └─ Inicio: KPIs del mes + alertas reparadas (amarillo/naranja/rojo)
                                     └─ Órdenes: migración completa de ordenes.html
                                     └─ Cotizaciones: migración completa de generador-cotizaciones.html
                                     └─ Clientes: búsqueda + historial de órdenes
                                     └─ Funcionarios: CRUD con editar nombre/rol/clave + toggle estado
                                     └─ Inventario: CRUD conceptos de costo
public/generador-cotizaciones.html Módulo de cotizaciones standalone (sin lista de estado en panel izq.)
public/assets/logo.png             Logo portrait 1396x2696 px
public/uploads/fotos-recepcion/    Fotos subidas — recepción Y trabajo (en .gitignore)
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
SESSION_SECRET        (requerido en producción — lanza error si no está)
PARTS_WHATSAPP_NUMBER (número del encargado de repuestos, ej: 3104650437)
```

---

## Git — ramas

```
main                    Estado estable inicial
feature/login           Login completo — pendiente merge a main
feature/crear-orden     Módulo crear orden — pendiente merge a main
feature/security-fixes  Correcciones de seguridad — pendiente merge a main
feature/wa-autorizacion Flujo autorización cotizaciones por WhatsApp — pendiente merge
feature/ui-fixes        Quitar lista máquinas panel izq. cotizaciones — pendiente merge
feature/dashboard       Dashboard SPA + edición funcionarios + fix técnicos — pendiente merge
```

Mergear en orden: login → crear-orden → security-fixes → wa-autorizacion → ui-fixes → dashboard.

---

## Seguridad — correcciones aplicadas (feature/security-fixes)

1. `SESSION_SECRET` obligatorio en producción (lanza error), warning en dev
2. CORS restringido a mismo origen (`origin: false`)
3. Cookie: `httpOnly`, `sameSite: lax`, `secure` en producción
4. Rate limiting en POST /login: 10 intentos / 15 minutos
5. `/health` y `/api/debug/usuario-schema` detrás de `requireInterno`
6. `requireInterno` devuelve 401/403 JSON para rutas `/api/` (antes era 302 redirect)
7. `routes/orders.js` — todos los endpoints protegidos con `requireInterno`
8. `routes/crear-orden.js` — todos los endpoints protegidos con `requireInterno`
9. `routes/pdf.js` — `/informes/:uid` detrás de `requireInterno`
10. `buildMaintenancePrompt` sanitiza inputs contra prompt injection
11. twilio desinstalado

---

## WhatsApp — flujo de autorización (feature/wa-autorizacion)

Al enviar cotización por WA (`routes/whatsapp.js`) se registra conversación pendiente en
`b2c_wa_autorizacion_pendiente`. El cliente responde con 1/2/3/4:

| Opción | Acción |
|--------|--------|
| 1 | Autorizar todas las máquinas → estado `autorizada` + envía lista repuestos al encargado |
| 2 | No autorizar → estado `no_autorizada` |
| 3 | Autorización parcial → envía lista numerada, cliente selecciona (ej: "1,3") |
| 4 | Hablar con asesor → notifica a PARTS_WHATSAPP_NUMBER + confirma al cliente |

**LID fix en wa-handler.js**: si `msg.from` no es `57XXXXXXXXXX`, se resuelve vía
`msg.getContact().number` antes de buscar el pendiente en BD.

**Tabla**: `b2c_wa_autorizacion_pendiente` (uid_autorizacion, uid_orden, wa_phone,
estado ENUM('esperando_opcion','esperando_maquinas'), created_at). UNIQUE KEY en wa_phone.

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
- Admin/F/T → `/dashboard.html` (antes `/generador-cotizaciones.html`)
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
| `b2c_foto_herramienta_orden` | uid_foto_herramienta_orden(int AI), uid_herramienta_orden, fho_archivo(varchar100), fho_nombre(varchar100), **fho_tipo**(agregado: 'recepcion'\|'trabajo') |
| `b2c_usuario` | ver arriba |
| `b2c_concepto_costos` | uid_concepto_costo, cco_descripcion, cco_valor, cco_tipo, cco_estado |

### Creadas por este sistema
| Tabla | Descripción |
|-------|-------------|
| `b2c_cotizacion_orden` | Totales cotización por orden |
| `b2c_cotizacion_maquina` | Cotización por máquina (mano de obra, descripción) |
| `b2c_cotizacion_item` | Ítems/repuestos por máquina |
| `b2c_herramienta_status_log` | Historial cambios de estado por máquina |
| `b2c_informe_mantenimiento` | Registro de informes PDF generados por máquina |
| `b2c_wa_autorizacion_pendiente` | Conversaciones WA activas de autorización |

### Columnas agregadas al ERP (auto-migradas en server.js al arrancar)
- `b2c_herramienta_orden.her_estado` VARCHAR(32) DEFAULT 'pendiente_revision'
- `b2c_foto_herramienta_orden.fho_tipo` VARCHAR(20) DEFAULT 'recepcion'

---

## Fotos — dos tipos

Ambos tipos se guardan en `public/uploads/fotos-recepcion/` (mismo directorio).
Se diferencian por la columna `fho_tipo`:

| fho_tipo | Origen | Cuándo |
|----------|--------|--------|
| `recepcion` | `crear-orden.html` | Al crear la orden |
| `trabajo` | `ordenes.html` | Durante la reparación |

Las fotos aparecen en el informe de mantenimiento PDF agrupadas por tipo.

---

## WhatsApp — utils/whatsapp-client.js

- `sendWAMessage(phone, content)` — valida con `getNumberId` antes de enviar
  - Si `getNumberId` retorna null → error claro "El número no tiene WhatsApp registrado"
  - Si retorna ID → envía normalmente
- Parche LID en 3 niveles (para contactos migrados al sistema LID de WA):
  1. Intento normal con `getChat`
  2. Resolver via `enforceLidAndPnRetrieval`
  3. Buscar chat existente en el store (funciona si alguna vez se ha chateado desde ese teléfono)

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

## Dashboard SPA — public/dashboard.html (feature/dashboard)

- **Entrada**: login redirige a `/dashboard.html` para usuarios internos (A/F/T)
- **Sidebar**: 240px desktop, drawer en móvil (hamburger), logo portrait centrado arriba + nombre
- **Logo sidebar**: wrapper `154×80px` overflow:hidden + img `width:80px` rotate(-90deg)
- **Navegación**: hash-based (`#inicio`, `#ordenes`, `#cotizaciones`, `#clientes`, `#funcionarios`, `#inventario`)
- **Vistas**: objetos JS con `render()` + `init()`, funciones prefijadas (`ord_`, `cot_`, `cli_`, `fun_`, `inv_`)
- **KPIs Inicio**: filtro por mes, tarjetas de estado, alertas reparadas sin entregar (amarillo ≥7d, naranja ≥15d, rojo ≥30d)
- **Funcionarios**: editar nombre/rol/clave (modal), toggle activo/inactivo — solo admin
- **Técnico asignado**: `getTechnicianWhereClause` filtra `usu_tipo='T'` — solo técnicos

---

## Estilo visual — patrón de páginas internas

Todas las páginas internas (ordenes.html, generador-cotizaciones.html) siguen este patrón:

- **Header**: `background:#1d3557` — logo rotado + título + nav links + logout
- **Layout**: `display:flex` — `.panel-left` (340px fijo, scrollable) + `.panel-right` (flex:1, scrollable)
- **Panel izquierdo**: buscador con concept selector (Número / Cédula NIT / Nombre), debounce 350ms, resultados en `.result-card`
- **Panel derecho**: empty state hasta seleccionar, luego detalle/formulario en `.card` components
- **Logo CSS wrapper**: `position:relative; width:96px; height:50px; overflow:hidden` + img `position:absolute; left:50%; top:50%; width:50px; transform:translate(-50%,-50%) rotate(-90deg)`
- **API_BASE**: usar `/api` (relativo), NO `http://localhost:3001/api`

---

## Páginas protegidas — server.js

Cada HTML interno requiere ruta explícita en `server.js`:
```js
app.get('/ordenes.html',                requireInterno, (req,res) => res.sendFile(...));
app.get('/generador-cotizaciones.html', requireInterno, (req,res) => res.sendFile(...));
app.get('/dashboard.html',              requireInterno, (req,res) => res.sendFile(...));
// etc.
```
Sin esta ruta el servidor devuelve 404 aunque el archivo exista en `public/`.

---

## PDF orden de servicio

`generateOrdenServicioPDF({ orden, cliente, maquinas[] })` en `utils/pdf-generator.js`:
- Acepta array de máquinas — todas en UN solo PDF
- Cada máquina tiene sección numerada ("EQUIPO 1 — NOMBRE", "EQUIPO 2 — NOMBRE")
- Condiciones y firma se renderizan UNA vez al final
- Texto empresa: "SU HERRAMIENTA CST" (no "UNIVERSAL DE LICUADORAS")
- Ruta print: `GET /api/orders/:id/print/orden` → HTML con iframe + auto-print dialog

---

## crear-orden.html — bug resuelto

`seleccionarCliente()` / `seleccionarHerramienta()` — patrón `clientMap`/`herramientaMap`:
- Objetos indexados por uid (`clientMap[uid] = obj`)
- `onclick` pasa solo el uid: `onclick="seleccionarCliente(${c.uid_cliente})"`
- La función recibe el uid y busca en el mapa — evita JSON.stringify en atributos HTML

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
En HTML siempre usar el patrón wrapper:
```html
<div style="position:relative;width:Wpx;height:Hpx;overflow:hidden;">
  <img src="/assets/logo.png" style="position:absolute;left:50%;top:50%;width:Xpx;transform:translate(-50%,-50%) rotate(-90deg)">
</div>
```
Donde `X` = altura deseada, `W` ≈ X × 1.93 (ancho después de rotar), `H` = X.
Sidebar dashboard: X=80, W=154, H=80.

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
