# CHANGELOG — SU HERRAMIENTA CST

Todas las versiones notables de este proyecto están documentadas aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

---

## [Unreleased] — feature/calidad-fase1-fase2
### Added
- GitHub Actions: pipeline `npm test` en cada push/PR a main
- Sentry.io: monitoreo de errores en producción (activo si `SENTRY_DSN` definido)
- CHANGELOG.md retroactivo desde v1.0.0
- Enforcement `ten_vence`: bloquea acceso si la suscripción del tenant venció
- Helper `getTenantId(req)` centralizado en `utils/tenant-id.js`
### Fixed
- `PATCH /contable/egresos/:id/anular` y `/pagar`: UPDATE sin `AND tenant_id = ?`
- Sidebar tablet: botón "Cerrar sesión" siempre visible (`height:100vh` + `min-height:0`)
### Refactor
- Cliente Anthropic unificado: eliminado `getIAClient()` duplicado en `routes/contable.js`

---

## [3.0.0] — 2026-05-20 — Módulo Contable + POS mejorado + Cotizaciones pendientes
### Added
- Módulo Contable con IA: egresos, Claude Vision para facturas, estado de resultados, vencimientos
- Addon `addon_contabilidad` por tenant (activable desde superadmin)
- POS mejorado: autocomplete cliente, panel caja del día, ticket de impresión
- `GET /api/ventas/caja-dia`: resumen ventas del día por método de pago
- `GET /api/ventas/:id/print`: ticket HTML con auto-print
- `GET /api/cotizaciones/pendientes`: endpoint dedicado sin acoplamiento al mes del dashboard
- Banner WhatsApp desconectado en vista Inicio con link directo al QR
- Toggle `addon_contabilidad` en modal editar tenant del panel superadmin
- `GET /api/whatsapp/status`: estado de conexión para el banner del dashboard

---

## [2.5.0] — 2026-04-26 — Recibos de caja + PDF cotización + PII fix
### Added
- Módulo A: Recibos de caja (`b2c_recibo_caja`), 6 endpoints, PDF con 3 modos
- Vista Recibos en dashboard SPA
### Fixed
- PDF cotización: salto de página, descripción completa, subtotal por máquina, resumen final
- IVA configurable por tenant (`ten_iva_responsable`, `ten_iva_porcentaje`)
- PII fix wa-handler.js: teléfonos enmascarados, contenido de mensajes omitido (Ley 1581)
- `utils/pdf-generator.js`: `const { UPLOADS_DIR }` sin desestructurar causaba TypeError

---

## [2.4.0] — 2026-04-20 — Security Hardening + Calidad Sprints 1-6
### Added
- `b2c_audit_log`: 13 acciones auditadas en 7 archivos
- `utils/audit.js`: fire-and-forget, nunca propaga error
- Tests unitarios: `node:test` nativo, 31 casos en 3 archivos
- `services/quote-machine.js`: lógica cotización por máquina extraída de routes
- Logger estructurado pino@10.3.1 en todos los archivos
- Rate limiting por usuario: `waLimiter`, `notifyLimiter`, `quoteSaveLimiter`
- `utils/repuestos-notifier.js`: envío lista repuestos extraído de duplicados
### Fixed
- IDOR `routes/quote.js`: `router.use(requireInterno)` cubre las 5 rutas
- JSON body limit: 100kb (era sin límite)
- `isApi` en `middleware/auth.js`: usa `req.originalUrl` no `req.path`
- `keyByUser`: `req.session.user.id` (era `uid_usuario`, siempre undefined)
- Portal cliente 403: `orders-cliente` montado antes de `orders-notificaciones/fotos`
### Security
- Score riesgo: 62 → 17/100 tras todos los sprints y hotfixes

---

## [2.3.0] — 2026-04-17 — Garantía por máquina + Modal agregar
### Added
- Garantía por máquina: `hor_es_garantia`, `hor_garantia_vence`, `hor_garantia_factura`
- Modal "Agregar máquina a orden existente" en dashboard
- Sección "Garantías activas" en vista Inicio del dashboard
- Badges de garantía y vencimiento en vistas Órdenes y Mis Órdenes
- `utils/dias-habiles.js`: festivos colombianos algorítmicos (Emiliani + Semana Santa)

---

## [2.2.0] — 2026-03-21 — Multi-tenant completo + Auditoría de seguridad
### Added
- Arquitectura multi-tenant: `tenant_id` en 13 tablas
- `b2c_tenant`: CRUD completo, slugs, dominios custom, colores, WA por tenant
- Panel superadmin (`/superadmin`): login independiente, CRUD tenants, gestión usuarios
- WhatsApp pool: `Map(tenantId → waClient)` — instancia separada por tenant
- `middleware/tenant.js`: resolve por subdominio o dominio custom, caché 1 min
- Migraciones automáticas: `ensureTenantTable()` + `ensureTenantColumns()`
### Security
- SEC-001 a SEC-006 corregidos (auditoría ofensiva completa — 17 hallazgos)
- `isolation-test.js`: 4 casos IDOR cross-tenant

---

## [2.1.0] — 2026-03-11 — Seguridad + Helmet + HTTPS
### Added
- Helmet@8.1.0: CSP, HSTS, X-Frame-Options
- HTTPS redirect via proxy inverso (`BEHIND_PROXY=true`)
- Sesiones MySQL persistentes (`MySQLSessionStore`, tabla `app_sessions`)
- Rate limiting POST /login: 10 intentos / 15 minutos
- `requireInterno` devuelve 401/403 JSON para rutas `/api/`
### Fixed
- `SESSION_SECRET` obligatorio en producción
- Cookie: `httpOnly`, `sameSite:lax`, `secure` en producción

---

## [2.0.0] — 2026-03 — Dashboard SPA + Portal cliente + WhatsApp flujo autorización
### Added
- Dashboard SPA (`dashboard.html`): sidebar responsive, 8 vistas, navegación hash-based
- Vista técnico: Mis Órdenes, Buscar Orden, observaciones, fotos de trabajo
- Portal cliente (`seguimiento.html`): acordeón por máquina, autorización web
- Flujo autorización WhatsApp: opciones 1/2/3/4, `b2c_wa_autorizacion_pendiente`
- `wa-handler.js`: listener mensajes entrantes, fix LID para contactos migrados
- Plantillas WA fijas (no IA): orden recibida, cotización, reparada, entregada
- Nueva Orden wizard 4 pasos en dashboard
- Fotos de trabajo por máquina (además de recepción)
- `sync-db.js`: sincronización GoDaddy → Railway con preservación de tablas

---

## [1.0.0] — 2026-02 — Base del sistema
### Added
- Backend Node.js + Express, MySQL via mysql2/promise
- Autenticación con roles: A (admin), F (funcionario), T (técnico), C (cliente)
- CRUD órdenes, clientes, máquinas, cotizaciones
- Generación PDF: cotización, orden de servicio, informe de mantenimiento
- WhatsApp Web (`whatsapp-web.js`): envío manual de mensajes
- Integración Claude AI para informes de mantenimiento y mensajes WA
- POS básico (`b2c_venta`): ventas de mostrador
- Inventario de conceptos de costo
- `crear-orden.html`: wizard con fotos de recepción y factura de garantía
