# Contexto del proyecto — universal-cotizaciones

Sistema de cotizaciones y órdenes de servicio para **SU HERRAMIENTA CST** (taller de reparación de herramientas eléctricas, Pereira - Colombia).

---

## Stack

- **Backend**: Node.js + Express (`server.js` entrada, puerto 3001)
- **BD**: MySQL via `mysql2/promise` (`utils/db.js`)
- **IA**: Anthropic SDK `@0.13.1` — usar `client.beta.messages.create()`, NO `client.messages.create()`
- **PDF**: PDFKit `^0.17.2` (`utils/pdf-generator.js`)
- **WhatsApp**: `whatsapp-web.js` (`utils/whatsapp-client.js`)
- **Sesiones**: `express-session` + `MySQLSessionStore` (`utils/session-store.js`) — sesiones persistentes en tabla `app_sessions`
- **Seguridad HTTP**: `helmet@8.1.0` (CSP, HSTS, etc.)
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
utils/ia.js                        Wrapper Anthropic SDK — generateText(), getClient(), withTimeout(promise, ms)
                                     └─ timeout configurable: CLAUDE_TIMEOUT_MS (texto, default 30s), CLAUDE_VISION_TIMEOUT_MS (visión, default 60s)
utils/whatsapp-client.js           Pool multi-tenant + parche LID + SIGTERM graceful shutdown
utils/wa-handler.js                Listener mensajes entrantes WA — flujo autorización cotizaciones
                                     └─ resuelve LID vía msg.getContact() antes de buscar pendiente
utils/pdf-generator.js             Generación PDFs (quote, maintenance, orden de servicio)
utils/session-store.js             MySQLSessionStore — sesiones MySQL persistentes (tabla app_sessions, cleanup cada 15min)
utils/uploads.js                   { UPLOADS_DIR, checkMagicBytes } — ruta base de uploads + validación magic bytes
                                     └─ UPLOADS_DIR usa UPLOADS_PATH env o public/uploads por defecto
                                     └─ checkMagicBytes(filePath, allowed) — valida bytes mágicos con file-type, borra archivo si falla
utils/dias-habiles.js              addDiasHabiles(fecha, n) + esNoHabil + toISODate — festivos colombianos algorítmicos
utils/phones.js                    parseColombianPhones() — separa múltiples números
routes/auth.js                     GET/POST /login (rate limit 10/15min), /logout, /me
                                     └─ POST /login redirige a /dashboard.html (internos) o /seguimiento.html (C)
routes/orders.js                   GET/PATCH órdenes + estados (10 endpoints, todos requireInterno)
                                     └─ GET /orders, /orders/search, /orders/by-estado
                                     └─ GET /orders/mis-ordenes-tecnico — órdenes asignadas al técnico logueado
                                     └─ GET /orders/:id, GET /orders/:orderId/detalle
                                     └─ PATCH /equipment-order/:uid/assign-technician, /orders/:id/assign-technician
                                     └─ PATCH /equipment-order/:uid/status — cambia estado + WA automático al pasar a 'reparada'
                                     └─ PATCH /equipment-order/:uid/observaciones — guardar observaciones técnico
routes/orders-notificaciones.js    3 endpoints WA manuales (requireInterno)
                                     └─ POST /orders/:id/notify-parts — lista repuestos al encargado
                                     └─ POST /orders/:id/notify-ready — notifica cliente máquinas reparadas
                                     └─ POST /orders/:id/notify-delivered — confirma entrega al cliente
routes/orders-fotos.js             6 endpoints fotos + archivos (requireInterno)
                                     └─ POST /orders/:id/fotos-recepcion/:uid — subir foto recepción post-creación
                                     └─ DELETE /orders/fotos-recepcion/:uid — eliminar foto recepción
                                     └─ POST /orders/:id/fotos-trabajo/:uid — subir foto de trabajo
                                     └─ DELETE /orders/fotos-trabajo/:uid — eliminar foto de trabajo
                                     └─ POST /orders/:id/factura-maquina/:uid — subir PDF factura garantía por máquina
                                     └─ POST /orders/:id/agregar-maquina — agregar máquina a orden existente
routes/orders-cliente.js           3 endpoints portal cliente (NO requireInterno — validan user.tipo === 'C' internamente)
                                     └─ IMPORTANTE: montado ANTES de orders.js en server.js
                                     └─ GET /cliente/mis-ordenes — órdenes del cliente con historial+cotización+informes
                                     └─ GET /cliente/informe/:uid — PDF informe (valida propiedad)
                                     └─ PATCH /cliente/maquina/:uid/autorizar — autorizar/rechazar máquina
routes/quote.js                    GET/POST cotizaciones — mensaje incluye menú WA autorización
routes/whatsapp.js                 POST envío WhatsApp — registra pendiente en b2c_wa_autorizacion_pendiente
routes/pdf.js                      GET descargar/POST enviar PDFs
                                     └─ /pdf/orden — PDF con todas las máquinas de la orden
                                     └─ /print/orden — HTML wrapper con auto-print
                                     └─ /informes/:uid — requireInterno
routes/recibos.js                  6 endpoints recibos de caja (requireInterno)
                                     └─ GET /recibos, POST /recibos, GET /recibos/cotizacion-orden/:uid
                                     └─ GET /recibos/:id, PATCH /recibos/:id/anular, GET /recibos/:id/pdf
routes/ventas.js                   Ventas POS (requireInterno)
                                     └─ GET /ventas/caja-dia — ANTES de /:id (evita conflicto de rutas)
                                     └─ GET /ventas/:id/print — HTML ticket con auto-print
routes/contable.js                 Módulo contable con IA (requireInterno + requireAddonContabilidad)
                                     └─ GET/POST /contable/egresos, PATCH /contable/egresos/:id
                                     └─ PATCH /contable/egresos/:id/anular, /pagar
                                     └─ GET /contable/vencimientos — egresos crédito pendientes
                                     └─ POST /contable/egresos/extraer-factura — Claude Vision con SSE (text/event-stream)
                                     └─ GET /contable/resumen — estado de resultados
routes/crear-orden.js              POST crear cliente/herramienta/orden + fotos + factura garantía
                                     └─ todos los endpoints con requireInterno
                                     └─ POST /crear-orden/factura/:uid_orden — upload PDF factura garantía nivel orden (legacy, compat)
                                     └─ POST /crear-orden/factura-maquina/:uid_herramienta_orden — upload PDF factura por máquina
routes/dashboard.js                KPIs + CRUD clientes, funcionarios, inventario (requireInterno)
                                     └─ GET /dashboard?mes=YYYY-MM — KPIs + alertas reparadas + revisadas sin cotizar
                                     └─ GET /clientes/search, GET /clientes/:id (incluye usu_login del usuario)
                                     └─ PATCH /clientes/:id — editar razón social, teléfono, contacto, dirección
                                     └─ POST /clientes/:id/crear-acceso — crea usuario tipo C para cliente (solo admin)
                                     └─ GET/POST/PATCH /funcionarios, GET/POST/PATCH /inventario
                                     └─ bypass requireInterno para /cliente/mis-ordenes, /cliente/informe/, /cliente/maquina/:id/autorizar
                                     └─ NOTA: el bypass en dashboard.js sigue necesario porque Express evalúa todos los routers en orden
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
                                     └─ Clientes: búsqueda + historial de órdenes + editar cliente (✏️ Editar inline)
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
BEHIND_PROXY          (true = activar redirect HTTP→HTTPS vía x-forwarded-proto)
SUPERADMIN_SECRET     (requerido en producción — clave de acceso al panel superadmin)
UPLOADS_PATH          (ruta base de uploads — en Railway: /data/uploads apuntando al Volume)
CLAUDE_TIMEOUT_MS     (timeout llamadas IA texto, default 30000 ms)
CLAUDE_VISION_TIMEOUT_MS (timeout Claude Vision/PDF, default 60000 ms)
SENTRY_DSN            (opcional — activa monitoreo de errores en producción)
```

---

## Git — ramas

Todo el código de funcionalidades está en `main`. Las ramas de feature fueron incorporadas
durante los sprints de calidad (mar–abr 2026) y eliminadas en limpieza 2026-04-26.

**Backup/rollback**: tag `v2026-04-26-pre-cleanup` apunta al estado completo antes de la limpieza.
Para rollback: `git checkout v2026-04-26-pre-cleanup`.

```
main                           Estado estable (HEAD)
```

### Historial de ramas mergeadas (referencia)
```
feature/modulo-recibos         Módulo A — Recibos de caja — MERGEADO 2026-04-26
feature/pos-mejorado           POS: autocomplete cliente + caja del día + ticket print — MERGEADO 2026-05-20
feature/semana1-demos          GET /cotizaciones/pendientes dedicado — MERGEADO 2026-05-20
feature/modulo-contable        Módulo contable IA completo — MERGEADO 2026-05-20
feature/login                  Login + sesiones + roles — MERGEADO
feature/crear-orden            Módulo crear orden + fotos — MERGEADO
feature/wa-autorizacion        Flujo autorización WA (1/2/3/4) — MERGEADO
feature/ui-fixes               Quitar lista panel izq. cotizaciones — MERGEADO
feature/dashboard              SPA principal + vista técnico + nueva orden — MERGEADO
feature/responsive             Responsive + autorización portal cliente — MERGEADO
feature/helmet-https           Helmet CSP + redirect HTTPS — MERGEADO
feature/wa-plantillas          WA plantillas fijas — MERGEADO
feature/cotizaciones-cola      Tab Cotizaciones → cola de pendientes — MERGEADO
feature/multitenant            Arquitectura multi-tenant completa — MERGEADO 2026-03-21
feature/security-audit-fixes   SEC-001 a SEC-006 — MERGEADO 2026-03-21
feature/mejoras-ordenes        Garantía por máquina + modal agregar + editar cliente — MERGEADO 2026-04-17
feature/code-quality-sprint1   try/finally, .env.example, checkMagicBytes, migrations — MERGEADO 2026-04-19
feature/code-quality-sprint2   Split routes/orders.js en 4 archivos — MERGEADO 2026-04-19
feature/code-quality-sprint3   Rate limiting WA + quotes por usuario — MERGEADO 2026-04-20
feature/code-quality-sprint4   repuestos-notifier + db resilience — MERGEADO 2026-04-20
feature/code-quality-sprint5   pino logger + auditoria + dashboard modularizado — MERGEADO 2026-04-20
feature/code-quality-sprint6   unit tests + isolation IDOR + services layer — MERGEADO 2026-04-20
feature/hotfix-post-auditoria  IDOR quote.js + JSON body limit — MERGEADO 2026-04-20
feature/security-hardening-v1  b2c_audit_log + 13 acciones auditadas — MERGEADO 2026-04-20
hotfix/bugs-produccion         PDF TypeError + requireLogin isApi + mount order — MERGEADO 2026-04-20
hotfix/pre-onboarding          keyByUser fix + LOGS_PATH + SEC-015 — MERGEADO 2026-04-20
hotfix/logs-pii                PII fix wa-handler.js (Ley 1581) — MERGEADO 2026-04-26
hotfix/pdf-cotizacion          PDF cotización fixes + IVA por tenant — MERGEADO 2026-04-26
feature/calidad-fase1-fase2    Sentry, GitHub Actions CI, CHANGELOG, getTenantId, ten_vence enforcement — MERGEADO 2026-05-21
feature/calidad-fase3          Error middleware, timeout Claude, SSE streaming contable — MERGEADO 2026-05-21
```

---

## Seguridad — correcciones aplicadas (feature/security-fixes, mergeado a main 2026-03-11)

### Correcciones originales
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

### Correcciones adicionales (auditoría 2026-03-11)
12. `routes/quote.js` — `router.use(requireInterno)` cubre las 5 rutas de cotización
    - IDOR: sin esto cualquiera podía leer/modificar cotizaciones de cualquier orden
    - Portal cliente NO se ve afectado — usa `/api/cliente/mis-ordenes` (routes/orders.js)
13. `routes/whatsapp.js` — `requireInterno` en POST send-whatsapp y POST /whatsapp/send
    - Sin auth se podía disparar envíos WA al cliente con solo el orderId (entero secuencial)
14. `routes/pdf.js` — `requireInterno` en 7 rutas de descarga/envío PDF
    - GET /pdf/quote, GET /pdf/maintenance/:id, POST /send-pdf/quote, POST /send-pdf/maintenance/:id
    - GET /pdf/orden, GET /print/orden, POST /send-pdf/orden

### Auditoría de seguridad SaaS (feature/security-audit-fixes, mergeado a main 2026-03-21)

Auditoría ofensiva completa documentada en `docs/auditoria-seguridad.md` (17 hallazgos).
Los 6 críticos/altos (SEC-001 a SEC-006) fueron corregidos y mergeados:

| # | Hallazgo | Archivo | Fix aplicado |
|---|---------|---------|-------------|
| SEC-001 | Enumeración de órdenes de otros tenants vía `/orders/search` | `routes/orders.js` | `LIMIT ${limit}` template literal + `AND tenant_id = ?` (ver nota MySQL 8.0) |
| SEC-002 | IDOR en `/crear-orden/herramientas/:clienteId` sin filtro tenant | `routes/crear-orden.js` | `AND tenant_id = ?` en SELECT |
| SEC-003 | INSERT `b2c_herramienta_orden` y `b2c_foto_herramienta_orden` sin `tenant_id` | `routes/crear-orden.js` | Agregado `tenant_id` en ambos INSERTs |
| SEC-004 | MemoryStore volátil (sesiones se borran con cada restart) | `server.js` + nuevo `utils/session-store.js` | MySQLSessionStore + tabla `app_sessions` |
| SEC-005 | Rate limiting ausente en superadmin login | `routes/superadmin.js` | `express-rate-limit` 5 intentos/15 min |
| SEC-006 | `error: e.message` expone stack/schema en HTTP 500 | múltiples rutas | Reemplazado con `'Error interno del servidor'` |

**Nota crítica MySQL 8.0**: `conn.execute('SELECT ... LIMIT ?', [n])` lanza `ER_WRONG_ARGUMENTS`.
MySQL 8.0 no soporta `LIMIT` con parámetros en prepared statements.
Solución: `LIMIT ${limit}` como template literal con valor ya validado (ej: `Math.min(Math.max(1, parseInt(n)||20), 50)`).

Los hallazgos SEC-007 a SEC-017 (medios/bajos) están documentados en `docs/auditoria-seguridad.md` pero no son bloqueantes para comercialización.

---

## Calidad de código — Sprints (mergeados a main 2026-04-19)

### Sprint 1 — feature/code-quality-sprint1

1. **try/finally en todos los conn.release()** — todos los handlers de routes/ garantizan liberación del pool incluso con early return o excepción
2. **.env.example completo** — agrega DB_PORT, SUPERADMIN_SECRET, PARTS_WHATSAPP_NUMBER, WA_AUTH_PATH, UPLOADS_PATH
3. **checkMagicBytes centralizado** — movido de `routes/crear-orden.js` a `utils/uploads.js`; todos los módulos importan `{ UPLOADS_DIR, checkMagicBytes }` desde ahí
4. **GET /api/config/estados** — endpoint que devuelve `ESTADOS_MAQUINA` desde `routes/dashboard.js` (elimina hardcode en frontend)
5. **utils/twilio.js eliminado** — archivo obsoleto, twilio ya desinstalado
6. **Migraciones centralizadas** — `runMigrations()` en `utils/migrations.js` (antes inline en `server.js`)

### Sprint 2 — feature/code-quality-sprint2

Split de `routes/orders.js` (1254 líneas, 22 endpoints) en 4 archivos:

| Archivo | Endpoints | Auth |
|---------|-----------|------|
| `routes/orders.js` | 10 (GET/PATCH órdenes + estados) | requireInterno |
| `routes/orders-notificaciones.js` | 3 (notify-parts, notify-ready, notify-delivered) | requireInterno |
| `routes/orders-fotos.js` | 6 (fotos recepción/trabajo, factura, agregar-maquina) | requireInterno |
| `routes/orders-cliente.js` | 3 (mis-ordenes, informe, autorizar) | valida tipo C internamente |

**Fix crítico de bypass**: `/cliente/informe/:uid` era bloqueado silenciosamente por `requireInterno` de `orders.js` — el bypass pre-existente en ese archivo solo cubría `mis-ordenes` y `autorizar`. Solución: `orders-cliente.js` se monta **antes** de `orders.js` en `server.js`; las rutas cliente nunca llegan al middleware de orders.js. El bypass doble en orders.js fue eliminado, reemplazado por `router.use(requireInterno)` simple.

**Orden de montaje en server.js** (importa para el fix):
```js
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/orders-cliente')); // ANTES de notificaciones/fotos — crítico
app.use('/api', require('./routes/orders-notificaciones'));
app.use('/api', require('./routes/orders-fotos'));
app.use('/api', require('./routes/orders'));
```

**IMPORTANTE**: `orders-cliente` debe montarse ANTES de `orders-notificaciones` y `orders-fotos`.
Ambas tienen `router.use(requireInterno)` sin bypass — si `orders-cliente` queda después, los clientes
reciben 403 antes de llegar a su router. Bug de producción descubierto y corregido 2026-04-20.

### Sprint 3 — feature/code-quality-sprint3 (mergeado a main 2026-04-20)

Rate limiting por usuario (session uid) con fallback IP:

- `waLimiter` — 10 req/5min en `routes/whatsapp.js` (POST send-whatsapp, POST whatsapp/send)
- `notifyLimiter` — 20 req/min en `routes/orders-notificaciones.js` (notify-parts, notify-ready, notify-delivered)
- `quoteSaveLimiter` — 60 req/min en `routes/quote.js` (GET+POST /quotes/machine)
- Todos usan `validate: { keyGeneratorIpFallback: false }` (fix ValidationError express-rate-limit v8.2.1)

### Sprint 4 — feature/code-quality-sprint4 (mergeado a main 2026-04-20)

1. **utils/repuestos-notifier.js** (nuevo) — extrae lógica duplicada de envío de lista de repuestos al encargado. Exporta `enviarListaRepuestos(conn, tenantId, uidOrden, consecutivo)` → `{ sent, maquinas, reason }`. Usado en `orders-notificaciones.js` y `orders-cliente.js`.
2. **utils/db.js** — agrega `charset: 'utf8mb4'` y `connectTimeout: 10000` al pool MySQL.

### Sprint 5 — feature/code-quality-sprint5 (mergeado a main 2026-04-20)

1. **utils/logger.js** (nuevo) — logger estructurado con pino@10.3.1. Nivel configurable via `LOG_LEVEL` env. JSON en producción, legible en dev. Todos los `console.error/warn` reemplazados en 13 archivos.
2. **docs/auditoria-seguridad.md** — actualizado: score riesgo 62→28/100; SEC-001 a SEC-007 + SEC-018/019 RESUELTO; SEC-008/011/015 PARCIAL; resto ABIERTO (no bloqueantes). Nuevos hallazgos: SEC-018 (IDOR quote.js) y SEC-019 (JSON body limit).
3. **public/dashboard.html** — reducido de 3256 → 151 líneas. CSS extraído a `public/assets/dashboard.css` (394 líneas). JS extraído a `public/assets/dashboard.js` (2711 líneas). Servidos vía `express.static('/assets')` existente.

### Sprint 6 — feature/code-quality-sprint6 (mergeado a main 2026-04-20)

1. **tests/** (nuevo directorio) — runner `node:test` nativo (sin dependencias). Script `npm test` → `node --test tests/*.test.js`.
   - `tests/dias-habiles.test.js` — 13 casos: `toISODate`, festivos fijos/Emiliani/Semana Santa, `addDiasHabiles` invariante
   - `tests/phones.test.js` — 13 casos: null/vacío, móvil válido, prefijo 57, fijos descartados, separadores, deduplicación
   - `tests/uploads.test.js` — 5 casos: env override, magic bytes PNG/PDF aceptados, archivo inválido rechazado y borrado
   - **Bug encontrado**: `utils/uploads.js` usaba `fileTypeFromFile` (nombre de `file-type@17+`) en vez de `fromFile` (`file-type@16`). `checkMagicBytes` lanzaba TypeError silenciosamente desde siempre. Corregido.
2. **isolation-test.js Sección 8** — 4 casos IDOR SEC-018: T1 no puede GET/POST cotización de máquina T2 (cross-tenant), T2 sí puede (happy path), T1 orderId+T2 machineId cross-order bloqueado.
3. **services/quote-machine.js** (nuevo) — extrae lógica del `POST /quotes/machine` (~80 líneas, 6 queries, 1 transacción). Firma: `saveMachineQuote(params, { conn, tenantId }) → { subtotal, orderSubtotal, total }`. Lanza `Error` con `.status=403` si la máquina no pertenece a la orden. Handler en `routes/quote.js` queda en ~20 líneas.

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

### Contrato de req.session.user (routes/auth.js)

```js
req.session.user = {
  id:              Number,   // uid_usuario — usar SIEMPRE este campo (no uid_usuario)
  nombre:          String,   // usu_nombre
  login:           String,   // usu_login
  tipo:            String,   // 'A' | 'F' | 'T' | 'C'
  rol:             String,   // 'admin' | 'funcionario' | 'tecnico' | 'cliente'
  tenant_id:       Number,   // uid_tenant del tenant en el momento del login
  pwd_must_change: Boolean,  // forzar cambio de contraseña en próximo login
}
```

**Reglas críticas:**
- Usar `req.session.user.id` (no `uid_usuario` — ese campo no existe en el objeto)
- Rate limiters y audit log usan `req.session.user.id` como clave de usuario
- `tenant_id` en sesión puede diferir de `req.tenant.uid_tenant` si el usuario
  fue creado en otro tenant y la sesión no se renovó — siempre usar `req.tenant` para queries

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
- `b2c_herramienta_orden.hor_es_garantia` TINYINT(1) DEFAULT 0 — máquina en garantía del fabricante
- `b2c_herramienta_orden.hor_garantia_vence` DATE NULL — fecha vencimiento garantía por máquina
- `b2c_herramienta_orden.hor_garantia_factura` VARCHAR(255) NULL — filename PDF factura por máquina
- `b2c_foto_herramienta_orden.fho_tipo` VARCHAR(20) DEFAULT 'recepcion'
- `b2c_orden.ord_tipo` VARCHAR(20) DEFAULT 'normal' — valores: 'normal' | 'garantia' (auto si ≥1 máquina con hor_es_garantia=1)
- `b2c_orden.ord_factura` VARCHAR(255) NULL — factura nivel orden (legacy, solo órdenes antiguas)
- `b2c_orden.ord_garantia_vence` DATE NULL — legacy, no se usa en órdenes nuevas
- `b2c_orden.ord_revision_limite` DATE NULL — fecha límite revisión interna (48h hábiles desde recepción, solo garantías)

---

## Órdenes de garantía

Flujo especial para equipos en período de garantía del fabricante.
Mergeado en `feature/mejoras-ordenes` → main 2026-04-17.

### Garantía por máquina (sistema nuevo — desde 2026-04-17)
Cada máquina de la orden puede ser garantía o no independientemente.
Útil para clientes como Homecenter que traen varias máquinas con facturas distintas.

- Toggle "¿En garantía?" por máquina en el modal de agregar máquina
- Si activado: fecha vencimiento (obligatorio, auto: hoy + 30 días hábiles) + PDF factura (opcional)
- Factura upload por máquina: `POST /api/crear-orden/factura-maquina/:uid_herramienta_orden`
- `ord_tipo='garantia'` se calcula automáticamente si al menos una máquina tiene `hor_es_garantia=1`
- Mismo flujo en nueva orden (`crear-orden.html`) y al agregar máquina a orden existente

### BD — por máquina
- `hor_es_garantia TINYINT(1)` — 1 si esa máquina está en garantía
- `hor_garantia_vence DATE` — fecha límite garantía de esa máquina
- `hor_garantia_factura VARCHAR(255)` — filename PDF factura de esa máquina

### BD — nivel orden (legacy, órdenes anteriores a 2026-04-17)
- `ord_tipo='garantia'` — sigue siendo la forma de distinguir órdenes de garantía
- `ord_factura VARCHAR(255)` — factura a nivel orden (solo órdenes antiguas, se conserva para compat)
- `ord_garantia_vence DATE` — legacy, no se usa en órdenes nuevas

### Dashboard — sección "Garantías activas" en Inicio
- Aparece solo si hay ≥1 garantía activa (ord_tipo='garantia' con alguna máquina no entregada)
- Ordenadas por fecha de ingreso ASC (más antiguas = mayor prioridad)
- Cada fila muestra: badge GARANTÍA, máquinas con fecha vencimiento inline, cliente, orden, badges estado
- Badge vencimiento: 🔴 GARANTÍA VENCIDA (pasada) | ⚠️ Vence pronto (≤7 días) | fecha normal (verde)
- Alerta "⚠️ Sin factura adjunta": para órdenes nuevas usa `sin_factura` (MAX por máquina); para órdenes antiguas usa `ord_factura IS NULL`

### Dashboard — vista Órdenes y Mis Órdenes (técnico)
- Función `ord_garantiaBadges(o)` — genera badges inline en result-cards
- Órdenes garantía aparecen primero (`ORDER BY o.ord_tipo DESC`)
- Búsqueda (`/orders/search`) y filtro por estado (`/orders/by-estado`) incluyen ord_tipo, ord_factura, ord_garantia_vence

### Fechas automáticas (utils/dias-habiles.js)
- `ord_garantia_vence` — auto-calculado en frontend: hoy + 30 días hábiles colombianos (editable)
- `ord_revision_limite` — calculado en backend (`crear-orden.js`): hoy + 2 días hábiles colombianos

#### utils/dias-habiles.js
Módulo Node.js con algoritmo colombiano puro (sin fechas hardcodeadas):
- `addDiasHabiles(desde, n)` — suma n días hábiles saltando fines de semana y festivos
- `esNoHabil(date)` — true si es festivo o fin de semana
- `toISODate(date)` — convierte Date a string YYYY-MM-DD
- Festivos fijos: 12 fechas que no se mueven (Año Nuevo, navidad, etc.)
- Festivos Ley Emiliani (7): si caen entre lunes y sábado, se mueven al próximo lunes
- Festivos religiosos variables: calculados desde Semana Santa con algoritmo Meeus/Jones/Butcher
  - Semana Santa: Jueves y Viernes Santo (no Emiliani)
  - Ascensión, Corpus Christi, Sagrado Corazón, San Pedro/Pablo, Inmaculada (Emiliani)

El mismo algoritmo está inlinado como IIFE en dashboard.html y crear-orden.html para el frontend.

### Badges de garantía en UI
`ord_garantiaBadges(o)` en dashboard.html retorna HTML con:
- Badge "GARANTÍA" (azul oscuro)
- Badge vencimiento: 🔴 si ya venció | ⚠️ si vence en ≤7 días | fecha normal
- Badge revisión (`ord_revision_limite`): 🔴 Revisión vencida | 🔔 Revisar hoy | "Revisar antes: DD/MM/AA"
- Badge "⚠️ Sin factura" si `ord_factura` es null/vacío

### Rutas modificadas para incluir campos de garantía
- `GET /api/orders/search` — incluye ord_tipo, ord_factura, ord_garantia_vence, ord_revision_limite
- `GET /api/orders/by-estado` — incluye idem, ORDER BY ord_tipo DESC primero
- `GET /api/orders/mis-ordenes-tecnico` — incluye idem, ORDER BY ord_tipo DESC primero
- `GET /api/dashboard` — incluye garantiasActivas[] en respuesta (con ord_revision_limite)

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
- **Chrome lock fix**: `removeChromeLocksRecursive(dir)` se ejecuta al arrancar el módulo,
  antes de crear el cliente. Elimina `SingletonLock`, `SingletonCookie`, `SingletonSocket`
  recursivamente en el directorio de auth. Evita el error "profile appears to be in use"
  cuando Railway/cualquier host reinicia el contenedor mientras Chromium estaba corriendo.
  Directorio configurado vía `WA_AUTH_PATH` env (default `./.wwebjs_auth`).
- **Sesión persistente**: apuntar `WA_AUTH_PATH` a un Railway Volume para que la sesión
  sobreviva deploys. Sin Volume, hay que re-escanear QR en cada deploy.

---

## Estados de máquina

| Valor | Label | WA automático |
|-------|-------|---------------|
| pendiente_revision | Pendiente de revisión | — |
| revisada | Revisada | — |
| cotizada | Cotizada | — |
| autorizada | Autorizada | — |
| no_autorizada | No autorizada | — |
| reparada | Reparada | ✅ Automático al cambiar estado |
| entregada | Entregada | — |

**WA automático**: al cambiar `her_estado` a `reparada` en `PATCH /equipment-order/:id/status`,
se envía automáticamente al cliente:
> "Hola [cliente], su *[máquina]* de la orden *#[consecutivo]* está *reparada y lista para recoger* 🔧"
Falla silenciosamente si WhatsApp no está conectado.

**Los demás envíos son manuales** via 3 botones en el frontend:
- Naranja: lista repuestos al encargado (máquinas autorizadas)
- Morado: notifica cliente máquinas reparadas (manual adicional)
- Verde: confirma entrega al cliente

---

## WhatsApp — plantillas de mensaje (feature/wa-plantillas, mergeado a main)

Todos los mensajes WA usan texto fijo (no IA) para facilitar migración futura a Meta Business API.

### Plantilla 1 — Orden recibida (día 1, al enviar PDF)
Enviada en `POST /api/orders/:orderId/send-pdf/orden` justo después del PDF:
```
Hola, le saluda *Su Herramienta CST* 🔧

Hemos recibido su(s) equipo(s) para revisión. Orden #[consecutivo]:

• [Nombre máquina] ([marca])
• [Nombre máquina 2]

Le notificaremos cuando la revisión esté lista. ¡Gracias por confiar en nosotros!
```

### Plantilla 2 — Cotización (días después, al generar mensaje)
Generada en `POST /api/quotes/order/:orderId/generate-message`, guardada en `b2c_cotizacion_orden.mensaje_whatsapp`:
```
Hola, le saluda *Su Herramienta CST* 🔧

Cotización orden #[consecutivo] para [cliente]:

*[Máquina] ([marca])*
  • Mano de obra: $[valor]
  • Repuestos: $[total_repuestos]
    - [repuesto] x[cantidad] = $[subtotal]
  Subtotal: $[subtotal_máquina]

*Total: $[total]*

Por favor indíquenos su decisión:

Responda con el número de su elección:
1️⃣ Autorizar toda la cotización
2️⃣ No autorizar la cotización
3️⃣ Autorización parcial (seleccionar máquinas)
4️⃣ Hablar con un asesor → [PARTS_WHATSAPP_NUMBER]
```

### Plantilla 3 — Reparada (automático al cambiar estado)
Ver sección "Estados de máquina" arriba — enviada por `routes/orders.js`.

---

## Dashboard SPA — public/dashboard.html (feature/dashboard)

- **Entrada**: login redirige a `/dashboard.html` para usuarios internos (A/F/T)
- **Sidebar**: 240px desktop, drawer en móvil (hamburger), logo portrait centrado arriba + nombre
- **Logo sidebar**: wrapper `154×80px` overflow:hidden + img `width:80px` rotate(-90deg)
- **Navegación**: hash-based (`#inicio`, `#ordenes`, `#cotizaciones`, `#clientes`, `#funcionarios`, `#inventario`)
- **Vistas**: objetos JS con `render()` + `init()`, funciones prefijadas (`ord_`, `cot_`, `cli_`, `fun_`, `inv_`, `no_`, `tec_`)
- **KPIs Inicio**: filtro por mes, tarjetas de estado, alertas reparadas sin entregar (amarillo ≥7d, naranja ≥15d, rojo ≥30d)
- **Revisadas sin cotizar**: sección en inicio — máquinas con her_estado='revisada' sin entrada en b2c_cotizacion_maquina
- **Vista Cotizaciones** (feature/cotizaciones-cola, pendiente merge): cola de pendientes de cotizar
  - Muestra tabla de máquinas con her_estado='revisada' sin cotización (reutiliza `revisadasSinCotizar` de `/api/dashboard`)
  - Botón "✏️ Cotizar" por fila abre modal con iframe de `generador-cotizaciones.html?maquina=...`
  - Al guardar cotización, postMessage cierra modal y recarga la lista
  - Las funciones antiguas `cot_*` del buscador se preservan en bloque `{}` por compatibilidad
- **Vista Nueva Orden**: wizard 4 pasos (Views.nuevaOrden, prefijo `no_`), mismos endpoints que crear-orden.html
- **Vista técnico**: `isTecnico()` — sidebar solo muestra Mis Órdenes + Buscar Orden; botón Nueva Orden oculto
  - `Views.misOrdenes`: lista órdenes asignadas al técnico logueado
  - `Views.buscarOrden`: busca cualquier orden por consecutivo o cliente
  - Detalle máquina: observaciones editables, fotos de trabajo, botón "Marcar revisada"
- **Funcionarios**: editar nombre/rol/clave (modal), toggle activo/inactivo — solo admin
- **Técnico asignado**: `getTechnicianWhereClause` filtra `usu_tipo='T'` — solo técnicos
- **Nueva Orden mobile**: ítem `.nueva-orden-nav` en sidebar (display:none en desktop, flex en ≤768px), oculto para técnicos

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

## seguimiento.html — rediseño (feature/dashboard)

- Acordeón por máquina: click para expandir, muestra historial + cotización + informe
- Datos por máquina: `her_estado`, `hor_observaciones`, `hor_fecha_prom_entrega`, historial, cotización, ítems, informe
- Aviso naranja si `her_estado='cotizada'` — máquina pendiente de autorizar
- Batch queries en `GET /api/cliente/mis-ordenes` — sin N+1 (5 queries totales para todas las órdenes)
- Informe PDF cliente: `GET /api/cliente/informe/:uid_herramienta_orden` — valida que la orden pertenece al cliente
- Bug crítico resuelto: `routes/dashboard.js` tenía `router.use(requireInterno)` que bloqueaba rutas `/cliente/*`
  - Fix: bypass con `if (req.path === '/cliente/mis-ordenes' || req.path.startsWith('/cliente/informe/')) return next('router')`

---

## Autorización portal cliente — seguimiento.html (feature/responsive)

El cliente puede autorizar o rechazar máquinas directamente desde `seguimiento.html`,
sin necesidad de responder por WhatsApp.

**Endpoint**: `PATCH /api/cliente/maquina/:uid_herramienta_orden/autorizar`
- Solo accesible para `usu_tipo='C'` (403 si usuario interno intenta usarlo)
- Body: `{ decision: 'autorizada' | 'no_autorizada' }`
- Valida propiedad: JOIN `herramienta_orden → orden → cliente → uid_usuario`
- Solo permite si `her_estado === 'cotizada'` — 409 si ya fue procesada
- Transacción: UPDATE her_estado + INSERT en b2c_herramienta_status_log
- Si `autorizada`: envía lista de repuestos a PARTS_WHATSAPP_NUMBER por WA (falla silenciosamente si WA no está listo)

**Bypass doble** (bug conocido a evitar): el path debe estar en el bypass de AMBOS routers:
- `routes/dashboard.js`: `req.path.match(/^\/cliente\/maquina\/\d+\/autorizar$/)` → `next('router')`
- `routes/orders.js`: mismo regex → `next()`

**Frontend** (`seguimiento.html`):
- Botones ✅ / ❌ por máquina cuando `her_estado === 'cotizada'`
- Botón "Autorizar todas" en header de orden si hay ≥1 máquina cotizada
- `seg_autorizar(uid, decision, btn)` — confirma + PATCH + recarga
- `seg_autorizarTodas(uid_orden, btn)` — itera secuencial + recarga
- `loadOrdenes()` — función reutilizable (guarda `window._ordenesData` para `seg_autorizarTodas`)
- `init()` solo autentica y llama `loadOrdenes()`

---

## Clientes — acceso a seguimiento.html

- Clientes nuevos creados vía `crear-orden.html` reciben usuario automáticamente (login=identificación, clave=últimos 4 dígitos)
- Clientes del ERP anterior (importados de GoDaddy) no tienen usuario — crear manualmente o con SQL:
  ```sql
  INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado)
  SELECT COALESCE(cli_razon_social, cli_contacto, cli_identificacion),
         cli_identificacion, RIGHT(cli_identificacion, 4), 'C', 'A'
  FROM b2c_cliente WHERE uid_usuario IS NULL;

  UPDATE b2c_cliente c
  JOIN b2c_usuario u ON u.usu_login = c.cli_identificacion
  SET c.uid_usuario = u.uid_usuario
  WHERE c.uid_usuario IS NULL AND u.usu_tipo = 'C';
  ```
- Las claves en texto plano migran a bcrypt en el primer login (lazy migration en routes/auth.js)
- `POST /api/clientes/:id/crear-acceso` — crea usuario para un cliente específico (solo admin)

---

## sync-db.js — tablas preservadas en sync con GoDaddy

Las siguientes tablas se respaldan antes del sync y se restauran después:
```
b2c_cotizacion_orden, b2c_cotizacion_maquina, b2c_cotizacion_item,
b2c_herramienta_status_log, b2c_informe_mantenimiento, b2c_wa_autorizacion_pendiente
```
Los archivos PDF de informes se guardan en disco (`public/uploads/informes-mantenimiento/`) — no se borran con el sync.
Si se corre sync sin reiniciar el servidor después, las tablas locales desaparecen hasta el próximo arranque.

### Sync directo a Railway (MySQL 8.0)

El cliente mysql.exe de XAMPP (MariaDB 10.4) **no puede conectar a Railway MySQL 8.0** por incompatibilidad de plugin `caching_sha2_password`. sync-db.js detecta automáticamente conexiones remotas (`DB_PORT !== 3306`) y usa Node.js mysql2 para todas las operaciones.

Comando para sincronizar GoDaddy → Railway:
```bash
DB_HOST=switchback.proxy.rlwy.net DB_PORT=23534 DB_USER=root DB_PASSWORD=<pass> DB_NAME=railway node sync-db.js
```

Funciones Node.js para Railway:
- `importSqlFileNode(file)` — DROP+CREATE BD + importa dump línea a línea (acumulador). Ignora `USE \`db\`` del dump. Ejecuta `/*!...*/` condicionales de MySQL.
- `restoreSqlFileNode(file)` — restaura backup SIN hacer DROP/CREATE (para paso 6 cotizaciones)
- `addColumnSafe(tabla, col, def)` — ALTER TABLE con try/catch ER_DUP_FIELDNAME (MySQL 8.0 no soporta `ADD COLUMN IF NOT EXISTS`)

### Notas críticas sync Railway
- `ADD COLUMN IF NOT EXISTS` es sintaxis MariaDB — NO funciona en MySQL 8.0. Usar `addColumnSafe()`.
- El backup de cotizaciones se restaura con `restoreSqlFileNode`, NO con `importSqlFileNode` (esta última borra la BD).
- El dump de GoDaddy trae `USE \`b2csuherramienta\`` — se ignora en el importador para no romper la conexión a `railway`.

---

## Responsive — feature/responsive (base: feature/dashboard)

Breakpoints aplicados en cada página:

| Página | Breakpoints | Notas |
|--------|-------------|-------|
| `dashboard.html` | 768px, 480px | Tablas scroll horizontal, grids 1 col en 480px |
| `seguimiento.html` | 520px, 360px | Diseñado mobile-first, botones full-width |
| `ordenes.html` | 700px, 480px | Header wrap, acciones full-width |
| `generador-cotizaciones.html` | 768px, 480px | Panel izq max-height:50vh con scroll |
| `login.html` | 480px | Body padding para que card no toque bordes |
| `crear-orden.html` | 600px | grid2/grid3 → 1 columna |

---

## Seguridad HTTP — Helmet + HTTPS (feature/helmet-https)

### Helmet (Commit 1)
`helmet@8.1.0` montado en `server.js` después de CORS con CSP personalizada:
```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:              ["'self'"],
      scriptSrc:               ["'self'", "'unsafe-inline'"],  // páginas usan JS inline
      styleSrc:                ["'self'", "'unsafe-inline'"],  // páginas usan CSS inline
      imgSrc:                  ["'self'", "data:", "blob:"],
      connectSrc:              ["'self'"],
      fontSrc:                 ["'self'"],
      objectSrc:               ["'none'"],
      upgradeInsecureRequests: null,  // redirect HTTPS manejado manualmente
    },
  },
}));
```

### HTTPS redirect (Commit 2) — Escenario B: proxy inverso
Activado solo con `BEHIND_PROXY=true`. Se coloca al inicio de la app (antes de express.json):
```js
if (process.env.BEHIND_PROXY === 'true') {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
    }
    next();
  });
}
```
- `trust proxy 1`: Express confía en `X-Forwarded-*` del primer proxy (nginx, Render, Railway…)
- Sin efecto en desarrollo local (BEHIND_PROXY no configurado)
- `upgradeInsecureRequests: null` en CSP evita conflicto con este redirect manual

---

## Producción — Railway

- **URL**: `taller.suherramienta.com` (subdominio, no reemplaza www.suherramienta.com)
- **Puerto app**: 8080 (Railway inyecta PORT=8080 — el custom domain debe apuntar a ese puerto)
- **Deploy**: automático desde push a `main` en GitHub
- **MySQL**: plugin Railway, acceso externo vía `switchback.proxy.rlwy.net:23534`
- **Volumes**: Volume único montado en `/data` — WhatsApp en `/data/.wwebjs_auth`, uploads en `/data/uploads`
- **Variables requeridas**: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `PARTS_WHATSAPP_NUMBER`, `BEHIND_PROXY=true`, `NODE_ENV=production`, `WA_AUTH_PATH=/data/.wwebjs_auth`, `UPLOADS_PATH=/data/uploads`, `SUPERADMIN_SECRET`
- **SSL**: provisionado automáticamente por Railway vía Let's Encrypt tras verificar DNS

### DNS GoDaddy para taller.suherramienta.com
| Tipo | Nombre | Valor |
|------|--------|-------|
| CNAME | taller | `h9aq1f8x.up.railway.app` |
| TXT | `_railway-verify.taller` | `railway-verify=6d07895d4b64bd125af7a39e7104...` |

---

## Multi-tenant — MERGEADO a main 2026-03-21

Arquitectura: esquema compartido con `tenant_id` en todas las tablas.

### Tabla b2c_tenant
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `uid_tenant` | INT AI PK | Identificador del tenant |
| `ten_nombre` | VARCHAR(100) | Nombre del taller |
| `ten_slug` | VARCHAR(50) UNIQUE | Subdominio (ej: `suherramienta`) |
| `ten_slug_locked` | TINYINT | 1 = inmutable después del primer login |
| `ten_dominio_custom` | VARCHAR(100) NULL | Dominio propio del cliente |
| `ten_logo` | VARCHAR(255) NULL | Ruta del logo |
| `ten_color_primary` | VARCHAR(7) | Color primario (default `#1B2A6B`) |
| `ten_color_accent` | VARCHAR(7) | Color acento (default `#E31E24`) |
| `ten_wa_number` | VARCHAR(20) NULL | Número WhatsApp del taller |
| `ten_wa_parts_number` | VARCHAR(20) NULL | Número encargado repuestos |
| `ten_estado` | ENUM | `activo` \| `suspendido` \| `prueba` |
| `ten_plan` | VARCHAR(20) | `mensual` \| `anual` |
| `ten_vence` | DATE NULL | Fecha vencimiento suscripción |

### Tenant por defecto
- `uid_tenant=1`, `ten_slug='suherramienta'`, `ten_slug_locked=1`, `ten_estado='activo'`
- Todos los datos existentes tienen `tenant_id=1`

### Tablas con tenant_id (13 tablas)
```
b2c_usuario, b2c_cliente, b2c_orden, b2c_herramienta,
b2c_herramienta_orden, b2c_foto_herramienta_orden, b2c_concepto_costos,
b2c_cotizacion_orden, b2c_cotizacion_maquina, b2c_cotizacion_item,
b2c_herramienta_status_log, b2c_wa_autorizacion_pendiente, b2c_informe_mantenimiento
```
Cada tabla: `tenant_id INT NOT NULL DEFAULT 1` + `INDEX idx_tenant(tenant_id)`.

### Migraciones en server.js (auto al arrancar)
1. `ensureTenantTable()` — CREATE TABLE b2c_tenant + INSERT IGNORE tenant default
2. `ensureTenantColumns()` — ADD COLUMN tenant_id a las 13 tablas (try/catch ER_DUP_FIELDNAME)

### Estado de implementación (todas las fases completadas)
- ✅ **Fase 2**: `middleware/tenant.js` — resolve tenant por hostname (slug o dominio custom)
- ✅ **Fase 3**: Auth multi-tenant — login filtra por tenant_id
- ✅ **Fase 4**: Queries con `AND tenant_id = req.tenant.uid_tenant` en todas las rutas principales
- ✅ **Fase 5**: WhatsApp pool — `Map(tenant_id → waClient)` en `utils/whatsapp-client.js`
- ✅ **Fase 6**: Frontend dinámico — CSS variables colores/logo inyectados por tenant
- ✅ **Fase 7**: Panel superadmin en `/superadmin` (ruta separada, sesión `req.session.superadmin`)

### Panel superadmin (`routes/superadmin.js` + `public/superadmin/index.html`)
- Acceso: `/superadmin` — sesión independiente (no usa `req.session.user`)
- Login con `SUPERADMIN_SECRET` env (requerido — error si no está en producción)
- Rate limit: 5 intentos / 15 minutos
- **CRUD tenants**: crear, editar nombre/slug/colores/WA, toggle estado
- **Gestión usuarios por tenant** (implementado 2026-03-21):
  - `GET  /superadmin/api/tenants/:id/usuarios` — lista usuarios del tenant
  - `POST /superadmin/api/tenants/:id/usuarios` — crea usuario (bcrypt, tipo A/F/T)
  - `PATCH /superadmin/api/usuarios/:uid` — editar nombre/tipo/estado
  - UI: botón "👤 Usuarios" por fila → modal con tabla + formulario inline

### isolation-test.js — quirks Railway
- `ord_consecutivo` es `INT` en Railway MySQL 8.0 (no VARCHAR) — usar número: `9999999`
- `ord_estado` es `VARCHAR(2)` — usar `'A'` (no `'abierta'`)
- Requiere `SUPERADMIN_SECRET` env al arrancar el servidor para pruebas superadmin

### Credenciales de prueba (Railway)
- Admin: `admin / 123`
- DB externa: `switchback.proxy.rlwy.net:23534`, DB: `railway`, user: `root`

---

## smoke-test.js — pruebas de integración

Cubre 13 secciones / 34 casos. Requiere servidor corriendo en `http://localhost:3001`.

```bash
node smoke-test.js --admin <login> --pass <clave> \
  [--funcionario <login> --pass-funcionario <clave>] \
  [--tecnico <login>     --pass-tecnico <clave>   ] \
  [--cliente <login>     --pass-cliente <clave>   ]
```

| Sección | Qué verifica |
|---------|--------------|
| 1 | Health check |
| 2 | Login Admin (tipo A) |
| 3 | Login Funcionario (tipo F) — dashboard + orders |
| 4 | Login Técnico (tipo T) — mis-ordenes-tecnico |
| 5 | Catálogo repuestos (con sesión interna) |
| 6 | Lista órdenes |
| 7 | Detalle orden (máquinas + fotos) |
| 8 | Cotización orden |
| 9 | WhatsApp QR |
| 10 | Portal cliente (tipo C) — mis-ordenes |
| 11 | Seguridad sesión cliente — 7 rutas internas devuelven 403 |
| 12 | Seguridad sin sesión — 6 rutas críticas devuelven 401 |
| 13 | Logout |

**Rate limiter**: si se acumulan intentos fallidos de login, el servidor puede responder 429.
Reiniciar el servidor limpia el rate limiter en memoria.

---

## Uploads — utils/uploads.js

Centraliza la ruta base de archivos subidos. Todos los módulos usan `require('../utils/uploads')`.

```js
const UPLOADS_DIR = process.env.UPLOADS_PATH || path.join(__dirname, '..', 'public', 'uploads');
```

| Subdirectorio | Contenido |
|--------------|-----------|
| `fotos-recepcion/` | Fotos de recepción Y trabajo (mismo dir, diferenciadas por `fho_tipo`) |
| `informes-mantenimiento/` | PDFs de informes generados |
| `facturas-garantia/` | PDFs de facturas de garantía |

**En Railway**: Volume montado en `/data`. `UPLOADS_PATH=/data/uploads`, `WA_AUTH_PATH=/data/.wwebjs_auth`.
**En local**: usa `public/uploads` (en .gitignore).

### Fotos de recepción — agregar post-creación
- `POST /api/orders/:id/fotos-recepcion/:uid_herramienta_orden` — sube foto tipo `recepcion`
- `DELETE /api/orders/fotos-recepcion/:uid_foto` — elimina foto de recepción
- `dashboard.html`: botón `+ Agregar foto` en sección Recepción de cada máquina (con ✕ para eliminar)

### Factura garantía — ver desde detalle
- `dashboard.html`: botón `📄 Factura garantía` aparece en acciones si `ord_tipo='garantia'` y `ord_factura` no es null
- Ruta: `/uploads/facturas-garantia/${ord_factura}` (requiere login)
- `GET /orders/:id/detalle` incluye `ord_tipo`, `ord_factura`, `ord_garantia_vence`

### sync-db.js — tablas preservadas (actualizado 2026-03-31)
Además de cotizaciones, ahora también se preservan:
- `b2c_tenant` — evita perder configuración de dominio custom tras sync
- `app_sessions` — evita cerrar sesiones activas al sincronizar

---

## Seguridad — Security Hardening v1 (feature/security-hardening-v1, mergeado a main 2026-04-20)

Score de riesgo tras este sprint: **17/100** (era 28 antes, 62 al inicio).

### Tabla b2c_audit_log
Auto-migrada al arrancar. Columnas: `uid_log` AI PK, `tenant_id`, `uid_usuario`, `accion` VARCHAR(64),
`entidad` VARCHAR(64), `entidad_id` VARCHAR(64), `detalle` JSON, `ip` VARCHAR(45), `created_at`.

### utils/audit.js
```js
logAudit(req, accion, entidad, entidadId, detalle = {})
```
- Fire-and-forget: tiene su propio `try/catch`, **nunca propaga el error** a la operación principal
- `req.tenant?.uid_tenant ?? 1`, `req.session?.user?.id`
- Usado en 7 archivos, 13 acciones instrumentadas:

| Archivo | Acciones auditadas |
|---------|-------------------|
| `routes/auth.js` | login_ok, login_fail, logout |
| `routes/orders.js` | estado_cambiado, tecnico_asignado |
| `routes/orders-cliente.js` | maquina_autorizada, maquina_rechazada |
| `routes/orders-fotos.js` | foto_subida, foto_eliminada |
| `routes/crear-orden.js` | orden_creada |
| `routes/quote.js` | cotizacion_guardada |
| `routes/superadmin.js` | superadmin_login_ok, superadmin_login_fail |

### Otras correcciones del sprint
- `utils/pdf-generator.js` línea 5: `const { UPLOADS_DIR } = require('./uploads')` (era `require('./uploads')` sin desestructurar — TypeError en producción al generar informes)
- `middleware/auth.js`: `isApi` usa `req.originalUrl.startsWith('/api/')` (no `req.path` — el path pierde el prefijo `/api` cuando se monta bajo ese namespace)
- `b2c_usuario.pwd_must_change TINYINT(1) DEFAULT 0` — migración auto; usuarios existentes quedan con `false`

---

## Bugs de producción corregidos (hotfix/bugs-produccion, mergeado a main 2026-04-20)

### Bug 1 — Portal cliente mostraba 403 (sin órdenes)
**Causa**: `orders-cliente.js` estaba montado DESPUÉS de `orders-notificaciones.js` y `orders-fotos.js`
en `server.js`. Ambas tienen `router.use(requireInterno)` — los clientes recibían 403 antes de
llegar a su router.
**Fix**: reordenar mounts en `server.js` — `orders-cliente` primero (ver sección Sprint 2).

### Bug 2 — TypeError al generar informes de mantenimiento PDF
**Causa**: `utils/pdf-generator.js` importaba `require('./uploads')` sin desestructurar.
`UPLOADS_DIR` era el módulo objeto completo, no el string de la ruta.
**Fix**: `const { UPLOADS_DIR } = require('./uploads')`.

---

## Fixes pre-onboarding (hotfix/pre-onboarding, mergeado a main 2026-04-20)

1. **keyByUser** (`routes/dashboard.js` y `routes/orders.js`):
   ```js
   const keyByUser = (req) => String(req.session?.user?.id || req.ip);
   // era: req.session?.user?.uid_usuario — siempre undefined, todos los limiters usaban IP
   ```
   `req.session.user` almacena `id` (no `uid_usuario`). Afectaba `dashboardLimiter` y `ordersLimiter`.

2. **LOGS_PATH en .env.example** — agrega instrucciones paso a paso para activar logs rotativos en Railway Volume.

3. **SEC-015 resuelto** — `docs/auditoria-seguridad.md` actualizado: audit log documentado, score final 17/100.

---

## PII fix wa-handler.js (hotfix/logs-pii, mergeado a main 2026-04-26)

Cumplimiento Ley 1581 Colombia — datos personales no deben persistirse en logs.

Cambios en `utils/wa-handler.js`:
- Teléfonos siempre enmascarados: `****${senderPhone.slice(-4)}` — nunca el número completo
- Contenido del mensaje omitido: `[contenido omitido]` en lugar del texto real
- Todos los `console.log` reemplazados por `log.debug()` (pino)

---

## PDF cotización fixes + IVA por tenant (hotfix/pdf-cotizacion, mergeado a main 2026-04-26)

4 bugs corregidos en `generateQuotePDF` (`utils/pdf-generator.js`) + IVA configurable:

1. **Salto de página** — `checkPageBreak(neededH)`: si `y + neededH > SAFE_Y (A4H-90)` → `doc.addPage()` + redibuja header de tabla. Evita que el contenido se desborde en PDFs con muchas máquinas.
2. **Descripción completa** — `descripcion_trabajo` se renderiza multi-línea con `doc.heightOfString()` para calcular la altura dinámica exacta. Ya no se trunca.
3. **Subtotal por máquina** — fila verde (`#e8efe8`) al final de cada bloque: `Subtotal — [nombre máquina] ... $valor`.
4. **Resumen final** — bloque `RESUMEN DE COTIZACIÓN` alineado a la derecha: fila por máquina + subtotal general + IVA (si aplica) + TOTAL (fondo oscuro, 11pt bold).

**IVA configurable por tenant** — migración en `utils/migrations.js` agrega a `b2c_tenant`:
- `ten_iva_responsable TINYINT(1) DEFAULT 0` — si 0: no se muestra línea IVA, total = subtotal
- `ten_iva_porcentaje DECIMAL(5,2) DEFAULT 19.00` — porcentaje IVA cuando aplica

`generateQuotePDF` recibe `tenant` (pasado desde `routes/pdf.js` como `req.tenant`). Fallback a `process.env.IVA_RATE` para compatibilidad con llamadas antiguas sin tenant.

---

## Plan facturación — Tarea 3

| Módulo | Estado | Esfuerzo | Prerequisito DIAN |
|--------|--------|----------|-------------------|
| A — Recibo de caja | ✅ MERGEADO 2026-04-26 | — | No |
| B — POS básico | ✅ MERGEADO 2026-05-20 (feature/pos-mejorado) | — | No |
| C — Factura electrónica | Pendiente | 3-4 días | Sí (NIT + resolución DIAN + cuenta Factus) |

Orden de ejecución: B → C. Módulo B completo — ver sección "Módulo B — POS mejorado" abajo.

---

## Módulo A — Recibos de caja (MERGEADO 2026-04-26)

### Tabla `b2c_recibo_caja`
Auto-migrada al arrancar. Columnas principales:
- `uid_recibo` AI PK, `tenant_id`, `rc_consecutivo` (por tenant), `uid_orden` NULL, `uid_cliente` NULL
- `rc_nombre_paga` VARCHAR — nombre libre para ventas de mostrador
- `rc_cliente_cedula` VARCHAR(20) NULL — cédula para clientes sin cuenta (aparece en PDF)
- `rc_fecha` DATE, `rc_concepto` TEXT, `rc_valor` DECIMAL(12,2)
- `rc_metodo_pago` ENUM('efectivo','transferencia','tarjeta','cheque','otro') DEFAULT 'efectivo'
- `rc_referencia` VARCHAR(100) NULL, `rc_estado` ENUM('activo','anulado') DEFAULT 'activo'
- `rc_creado_por` FK → b2c_usuario, `rc_items` JSON NULL — ítems manuales opcionales

### Endpoints (`routes/recibos.js`, montado en server.js bajo `/api`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/recibos` | Lista con filtros: estado, fecha_desde/hasta, uid_cliente, uid_orden |
| POST | `/recibos` | Crear recibo (consecutivo auto por tenant, transacción) |
| GET | `/recibos/cotizacion-orden/:uidOrden` | Datos cotización para modal — ANTES de /:id |
| GET | `/recibos/:id` | Detalle con JOIN cliente, orden, usuario |
| PATCH | `/recibos/:id/anular` | Anular recibo (409 si ya anulado) |
| GET | `/recibos/:id/pdf` | PDF del recibo |

### PDF — 3 modos (`generateReciboPDF` en `utils/pdf-generator.js`)
1. **Con cotización** (`cotizacion != null`): desglose completo por máquina igual al PDF de cotización — mano de obra + ítems/repuestos + subtotal por máquina + resumen IVA + total
2. **Con ítems manuales** (`rc_items` JSON array): tabla de 4 columnas — descripción, cantidad, precio unitario, subtotal
3. **Sin detalle**: solo bloque CONCEPTO + VALOR (recibo simple)

PDF siempre incluye: header empresa, datos cliente (CC/NIT si disponible), método de pago, referencia, sello "ANULADO" en rojo si aplica, total recibido en verde.

### Vista dashboard (`Views.recibos` en `public/assets/dashboard.js`)
- Pestaña "Recibos" en sidebar (entre Clientes e Inventario)
- Lista con filtros: estado, fecha desde/hasta, buscar por cliente/orden
- Botones por fila: Ver PDF, Anular
- Modal "Nuevo Recibo":
  - **Buscar orden** (opcional): autocomplete → rellena cliente y concepto automáticamente; si la orden tiene cotización muestra badge verde y pre-llena el valor total
  - **Cédula / NIT**: busca clientes registrados vía `/api/clientes/search` con dropdown; si no hay match, guarda la cédula como texto libre en el PDF
  - **Nombre / Razón social**: búsqueda secundaria por nombre
  - **Ítems del servicio** (opcional): tabla dinámica solo cuando no hay cotización vinculada
  - Campos: Fecha, Concepto, Valor total, Método de pago, Referencia

### Búsqueda por cédula/NIT — fixes aplicados
- `GET /api/clientes/search`: añadida normalización REPLACE para cédulas con puntos/guiones ("9.862.087-1" → encontrado buscando "9862087")
- `GET /api/orders/search`: mismo fix para búsqueda de órdenes por cédula del cliente

---

## Módulo B — POS mejorado (feature/pos-mejorado, MERGEADO 2026-05-20)

Tres mejoras sobre la vista Ventas (`Views.ventas` en `public/assets/dashboard.js`):

### 1. Autocomplete cliente en modal Nueva Venta
- Input "Buscar cliente" con debounce 400ms → `GET /api/clientes/search?q=...`
- Dropdown de resultados debajo del input; al seleccionar: llena `_venClienteId` (estado), muestra nombre del cliente
- Si no se selecciona cliente, la venta se registra sin `uid_cliente` (mostrador)
- Funciones: `ven_buscarCliente()`, `ven_selCliente(uid, nombre)`

### 2. Panel Caja del día
- Widget `<div id="venCajaDia">` arriba de la lista de ventas
- Endpoint: `GET /api/ventas/caja-dia` — agrupa ventas del día por método de pago (SUM de `ven_total`)
- Muestra total general + desglose por método (efectivo, transferencia, tarjeta, Nequi…)
- **IMPORTANTE**: la ruta `/ventas/caja-dia` debe montarse ANTES de `GET /ventas/:id` en `routes/ventas.js` para evitar que Express lo trate como `:id`

### 3. Ticket de impresión
- Botón "🖨️ Ticket" en el detalle de venta
- Endpoint: `GET /api/ventas/:id/print` → devuelve HTML con `window.onload = () => window.print()`
- Se abre en `window.open()` y el diálogo de impresión se dispara automáticamente

---

## Cotizaciones pendientes — endpoint dedicado (feature/semana1-demos, MERGEADO 2026-05-20)

Refactor arquitectural en `routes/dashboard.js`:
- Nuevo endpoint `GET /api/cotizaciones/pendientes` — devuelve máquinas con `her_estado='revisada'` que no tienen entrada en `b2c_cotizacion_maquina`
- Sin filtro por fecha (antes acoplado a `?mes=YYYY-MM` del dashboard general)
- Protegido por `dashLimiter` (rate limiter existente)
- `cot_cargarPendientes()` en `dashboard.js` llama este endpoint en lugar de `/dashboard?mes=...`
- Cambio solo de código — comportamiento visible idéntico

---

## Módulo contable con IA (feature/modulo-contable — pendiente merge a main)

### Addon y acceso
- `addon_contabilidad TINYINT(1) DEFAULT 0` en `b2c_tenant` (migración automática)
- `requireAddonContabilidad` en `middleware/auth.js` — 403 si el tenant no tiene el addon activo
- Local dev: `middleware/tenant.js` tiene `addon_contabilidad: 1` hardcodeado para no bloquearse
- Superadmin puede activar/desactivar el addon por tenant: campo `addon_contabilidad` en el PATCH de tenants (`routes/superadmin.js`)
- `/me` devuelve `addons: { contabilidad: bool }` — frontend oculta el nav item si `false`

### Tabla `b2c_egreso`
Auto-migrada al arrancar. Columnas principales:
- `uid_egreso` AI PK, `tenant_id`, `egr_fecha` DATE, `egr_concepto` TEXT
- `egr_categoria` ENUM('nomina','arriendo','servicios','compras','mantenimiento','impuestos','otros')
- `egr_valor` DECIMAL(12,2), `egr_metodo_pago` VARCHAR(30)
- `egr_proveedor` VARCHAR(150) NULL, `egr_nit_proveedor` VARCHAR(30) NULL
- `egr_referencia` VARCHAR(100) NULL, `egr_factura_imagen` VARCHAR(255) NULL
- `egr_ia_extraido` TINYINT(1) DEFAULT 0, `egr_estado` ENUM('activo','anulado') DEFAULT 'activo'
- **Vencimientos** (migración `ensureEgresoVencimiento`):
  - `egr_forma_pago` ENUM('contado','credito') DEFAULT 'contado'
  - `egr_fecha_vencimiento` DATE NULL — solo cuando `egr_forma_pago='credito'`
  - `egr_estado_pago` ENUM('pagado','pendiente') DEFAULT 'pagado' — auto: 'pendiente' si crédito

### Endpoints (`routes/contable.js`, montado bajo `/api`)
Todos protegidos por `requireInterno` + `requireAddonContabilidad`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/contable/egresos` | Lista con filtros: mes, categoria, estado |
| POST | `/contable/egresos` | Crear egreso — crédito requiere fecha_vencimiento |
| PATCH | `/contable/egresos/:id` | Editar campos permitidos |
| PATCH | `/contable/egresos/:id/anular` | Anular egreso |
| PATCH | `/contable/egresos/:id/pagar` | Marcar como pagado (egr_estado_pago='pagado') |
| GET | `/contable/vencimientos` | Egresos crédito pendientes de pago, ORDER BY fecha_vencimiento ASC |
| POST | `/contable/egresos/extraer-factura` | Claude Vision — extrae campos de imagen/PDF de factura |
| GET | `/contable/resumen` | Estado de resultados: ingresos (ventas+recibos) vs egresos por categoría |

### Claude Vision — extracción de facturas
- Acepta imagen/* y application/pdf (10MB max), validado con `checkMagicBytes`
- Sube archivo a `uploads/facturas-egreso/`, lo envía a Claude como `image` o `document` content block
- **CRÍTICO SDK @0.13.1**: usar `client.beta.messages.create()` SIN el parámetro `betas: [...]` — el SDK @0.13.1 lo rechaza con 400 "Extra inputs are not permitted". El tipo `document` ya salió de beta y funciona sin ese header.
- Singleton `getIAClient()` para no crear instancia Anthropic en cada request
- IA extrae: `proveedor`, `nit_proveedor`, `fecha`, `fecha_vencimiento`, `forma_pago` ('contado'|'credito'), `valor_total`, `categoria_sugerida`, `concepto`, `referencia`
- El usuario revisa y confirma antes de guardar (no auto-save)

### Vista Contable en dashboard
Nav item "📒 Contable" — solo visible para admin si `addons.contabilidad` es true.

Secciones del render:
1. **Panel Vencimientos** (`<div id="conVencimientos">`) — aparece si hay egresos crédito pendientes:
   - Badges de color: 🔴 vencido | ⚠️ ≤7 días | 📅 normal
   - Botón "✅ Marcar pagado" por fila → `con_pagar(uid)` → `PATCH /contable/egresos/:id/pagar`
2. **Estado de resultados** (`<div id="conResumen">`) — ingresos vs egresos del mes, utilidad
3. **Lista de egresos** (`<div id="conEgresos">`) — con filtros mes/categoría/estado

Modal "Nuevo Egreso":
- Campos: fecha, categoría, concepto, valor, forma de pago (Contado/Crédito), fecha vencimiento (condicional — solo si Crédito), método de pago, proveedor, NIT, referencia
- `con_toggleVencimiento()` controla visibilidad del campo fecha vencimiento
- Sección IA: upload factura → "✨ Extraer con IA" → rellena todos los campos incluyendo `forma_pago` y `fecha_vencimiento`

### Estado
La rama `feature/modulo-contable` fue mergeada a main el 2026-05-20.

---

## Plan de calidad post-auditoría (iniciado 2026-05-21)

Fases de mejora de calidad acordadas tras auditoría estricta del codebase.

### Fase 1 + Fase 2 — feature/calidad-fase1-fase2 (MERGEADO 2026-05-21)

**Fase 2 — Observabilidad y CI:**
- Sentry.io integrado en `server.js` (condicional a `SENTRY_DSN` env)
- GitHub Actions CI en `.github/workflows/test.yml` — ejecuta `npm test` en push/PR a main
- `CHANGELOG.md` retroactivo v1.0.0 → Unreleased

**Fase 1 — Fixes urgentes:**
- `utils/tenant-id.js` — helper `getTenantId(req)` centraliza `req.tenant?.uid_tenant ?? 1` (antes repetido en ~40 lugares)
- `middleware/tenant.js` — enforcement de `ten_vence`: API devuelve 402, HTML redirige a `/login?vencido=1`
- `middleware/tenant.js` — SELECT incluye `addon_contabilidad` (antes faltaba)
- `routes/contable.js` — `AND tenant_id = ?` en UPDATE anular y pagar (fix IDOR)
- `utils/ia.js` — unificación de `getClient()` (eliminado duplicado en contable.js)

### Fase 3 — feature/calidad-fase3 (MERGEADO 2026-05-21)

**Middleware de error global (`server.js`):**
- `MulterError.LIMIT_FILE_SIZE` → 413
- Otros `MulterError` → 400
- `err.status`/`err.statusCode` 4xx se propaga — permite `next(err)` desde services/
- Errores inesperados siguen devolviendo 500 sin detalles en producción

**Timeout en llamadas a Claude (`utils/ia.js`):**
- Constructor Anthropic recibe `timeout: AI_TIMEOUT_MS` (env `CLAUDE_TIMEOUT_MS`, default 30s)
- `withTimeout(promise, ms, label?)` exportado — usa `Promise.race`, compatible con SDK `@0.13.x`
- Vision: `CLAUDE_VISION_TIMEOUT_MS` (default 60s) aplicado en `extraer-factura`

**SSE streaming en extraer-factura (`routes/contable.js` + `dashboard.js`):**
- Responde `text/event-stream` — envía `{status:'analyzing'}` de inmediato al cliente
- Llama Claude Vision dentro de `withTimeout(60s)`
- Al terminar envía `{status:'done', extraido:{...}}` o `{status:'error',...}`
- Frontend (`con_extraerIA`) lee el stream con `fetch` + `ReadableStream`
- UX: botón cambia a "🤖 Claude analizando..." en lugar de spinner congelado 15-20s

### WhatsApp — fixes sesión persistente (2026-05-21)

**Problema resuelto:** la sesión se borraba en cada redeploy de Railway.

**Causa 1 — `disconnected` handler:** llamaba `client.initialize()` sobre el mismo cliente roto,
podía levantar dos instancias Chromium sobre el mismo `userDataDir`.
**Fix:** `client.destroy()` + `pool.delete()` + `createTenantClient()` + `initialize()` sobre instancia nueva.

**Causa 2 — Sin handler SIGTERM:** Railway envía SIGTERM al reiniciar. Sin handler, Node.js
terminaba de inmediato → Chromium muerto con escrituras pendientes → sesión corrupta →
WhatsApp Web navega a `post_logout=1` → `LocalAuth.logout()` borra toda la carpeta de sesión.
**Fix:** `process.on('SIGTERM', ...)` en `whatsapp-client.js` llama `client.destroy()` en todos
los tenants del pool antes de `process.exit(0)`.

### Fases pendientes del plan de calidad

| Fase | Descripción | Estado |
|------|-------------|--------|
| 4A | Split `pdf-generator.js` (archivo muy grande) | Pendiente |
| 4B | Split rutas del dashboard | Pendiente |
| 4C | Split `dashboard.js` (mayor riesgo) | Pendiente |
| 5 | Tests de integración con MySQL Docker en GitHub Actions | Pendiente |
| 6 | Migraciones robustas | Pendiente |

---

## Versiones — Hitos del proyecto

| Tag | Commit | Fecha | Descripción |
|-----|--------|-------|-------------|
| `v1.0.0` | `e5fdae2c` | 2026-04-26 | Sistema base: multi-tenant, órdenes, cotizaciones, WA autorización, dashboard SPA, seguridad |
| `v1.1.0` | `d6961e8f` | 2026-05-20 | POS + módulo financiero + inventario + recibos de caja |
| `v1.2.0` | `80c0e3dc` | 2026-05-26 | Módulo contable con IA (Claude Vision, egresos, P&G, alertas vencimientos) |

---

## Visión a largo plazo — Sistema Multi-Agente IA

Objetivo: convertir SU HERRAMIENTA CST en el primer sistema de gestión de talleres con IA nativa en Latinoamérica.

### El pitch comercial

*"No es un software que tu equipo usa — es un equipo de IA que trabaja para tu taller 24/7. Contesta clientes, controla el inventario, lleva la contabilidad y te dice exactamente cuánto debes vender cada día para ser rentable."*

> **Nota**: el "24/7" aplica completamente una vez que Baileys (`feature/baileys-migration`) esté mergeado y verificado en producción. Antes de ese merge, la disponibilidad del canal WA depende de que Chromium no se corrompa en Railway.

### Los 5 agentes planificados

| Agente | Qué hace | Módulo base |
|--------|----------|-------------|
| **Agente Contable** | Facturas, gastos, P&G, paquete para contador | Módulo contable (ya existe — v1.2.0) |
| **Agente WhatsApp** | Contesta clientes, da estados de órdenes, cobra, agenda | WhatsApp ya integrado + órdenes |
| **Agente Inventario** | Monitorea stock, sugiere pedidos, alerta mínimos, predice consumo | Inventario (ya existe — v1.1.0) |
| **Agente Financiero** | Analiza rentabilidad, proyecta meta, alerta desviaciones | Dashboard financiero (ya existe — v1.1.0) |
| **Agente Comercial** | Seguimiento prospectos, recordatorios, cotizaciones automáticas | CRM básico (pendiente — Etapa 6A) |

### Hoja de ruta

```
Etapa 1 — Calidad y estabilidad (EN CURSO)
Etapa 2 — Facturación electrónica DIAN
Etapa 3 — Asistente Contable IA (Sprint 3B = chat financiero con IA)
Etapa 4 — Agente WhatsApp inteligente  ⚠️ requiere router de intenciones (ver nota abajo)
Etapa 5 — Agente Inventario predictivo
Etapa 6A — CRM básico (prerequisito obligatorio de Etapa 6B)
Etapa 6B — Agente Comercial (sobre datos del CRM de 6A)
Etapa 7 — Orquestador: todos los agentes trabajando juntos
```

### Notas técnicas transversales (Etapas 3–7)

**Prompt caching de Claude (control de costos):**
En todos los agentes donde el contexto del sistema (datos del tenant, reglas del negocio, resúmenes financieros) se repite entre llamadas, usar `cache_control: { type: 'ephemeral' }` en el bloque de system del SDK Anthropic. Reduce costos hasta 90% en el prefijo compartido. Aplicar desde Sprint 3B en `buildContextoFinanciero` y en cada agente que construya contexto recurrente.

**Pricing diferenciado por etapa:**
- Etapas 1–3 (Asistente Contable add-on): $60.000 COP/mes
- Etapas 4–7 (agentes adicionales): definir tier superior antes de lanzar Etapa 4 — los costos de API escalan con el volumen de consultas
- Agregar límite diario de consultas por tenant antes de Etapa 4 para controlar costos de API en el MVP multiagente

### Nota Etapa 4 — prerequisito obligatorio: router de intenciones WA

El `wa-handler.js` actual maneja exclusivamente respuestas de autorización (1/2/3/4). Si el Agente WhatsApp en Etapa 4 comienza a atender consultas libres ("¿cómo va mi máquina?"), los dos flujos colisionan: un mensaje de consulta puede bloquear una conversación de autorización activa.

**Tarea obligatoria al inicio de Etapa 4 — antes de cualquier otra tarea del agente:**
- Si el mensaje es un dígito (1–4) Y hay un registro activo en `b2c_wa_autorizacion_pendiente` → flujo de autorización actual (wa-handler.js sin cambios)
- Si no → flujo de consulta libre → Agente WhatsApp
- Sin este router, Etapa 4 rompe el flujo de autorización en producción

### Nota Etapa 6 — CRM básico como prerequisito del Agente Comercial

La estructura actual tiene clientes con órdenes pero no prospectos ni pipeline comercial. El Agente Comercial no tiene datos con qué trabajar sin el CRM.

**Etapa 6A — CRM básico (construir antes de 6B):**
- Tabla `b2c_prospecto`: nombre, empresa, teléfono, canal de origen, estado pipeline, notas, fecha próximo contacto
- Vista "Prospectos" en dashboard (solo admin)
- Registro manual de contactos y seguimiento
- Historial de interacciones por prospecto

**Etapa 6B — Agente Comercial:** construir sobre los datos de 6A. Sin 6A el agente no tiene contexto.

---

## Notas de entorno (Windows / Git Bash)

- Python no disponible (Windows Store shim)
- Heredocs de Bash fallan con comillas simples — usar Write tool
- Rutas Node: forward slashes `C:/...`
- Shell: bash MINGW64 — sintaxis Unix
