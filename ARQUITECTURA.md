# Arquitectura del sistema — universal-cotizaciones

Sistema de cotizaciones y órdenes de servicio para **SU HERRAMIENTA CST**, taller de reparación de herramientas eléctricas en Pereira, Colombia.

---

## 1. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js |
| Framework web | Express |
| Base de datos | MySQL (driver `mysql2/promise`) |
| Inteligencia artificial | Anthropic API — modelo Claude (SDK `@0.13.1`) |
| Generación de PDFs | PDFKit `^0.17.2` |
| Mensajería | WhatsApp Web (`whatsapp-web.js`) |
| Frontend | Una sola página HTML (vanilla JS, sin frameworks) |

---

## 2. Estructura de archivos

```
universal-cotizaciones/
├── server.js                          Punto de entrada, puerto 3001
├── middleware/
│   └── apiKey.js                      Guard de API key (opcional)
├── routes/
│   ├── orders.js                      Órdenes, equipos, estados
│   ├── quote.js                       Cotizaciones por máquina y orden
│   ├── whatsapp.js                    Envío de mensajes WhatsApp
│   └── pdf.js                         Descarga y envío de PDFs
├── utils/
│   ├── db.js                          Pool de conexiones MySQL
│   ├── schema.js                      Helpers de detección de esquema BD
│   ├── ia.js                          Wrapper del SDK de Anthropic
│   ├── pdf-generator.js               Generación de PDFs (cotización + informe)
│   └── whatsapp-client.js             Cliente singleton WhatsApp Web
└── public/
    ├── generador-cotizaciones.html    SPA — interfaz completa
    └── assets/
        └── logo.png                   Logo empresa (portrait 1396×2696 px)
```

---

## 3. Módulos principales

### `server.js` — Entrada y arranque

- Monta el middleware de API key en todas las rutas `/api/*`
- Registra las 4 rutas modulares
- Al arrancar ejecuta en secuencia:
  1. `ensureQuoteTables()` — crea tablas de cotización si no existen
  2. `ensureStatusTables()` — agrega columna `her_estado` y crea tabla de historial
  3. `waClient.initialize()` — inicia sesión de WhatsApp Web
- Expone `GET /health` con estado del servidor y WhatsApp

---

### `routes/orders.js` — Órdenes y estados de máquinas

| Endpoint | Descripción |
|----------|-------------|
| `GET /api/orders` | Órdenes recientes (máx. 50, configurable) |
| `GET /api/orders/search?q=` | Búsqueda por consecutivo, NIT, nombre, teléfono |
| `GET /api/orders/:orderId` | Orden completa: datos cliente + equipos + técnicos disponibles |
| `PATCH /api/equipment-order/:id/assign-technician` | Asigna técnico a una máquina |
| `PATCH /api/orders/:orderId/assign-technician` | Asigna técnico a toda la orden |
| `PATCH /api/equipment-order/:id/status` | Cambia estado de una máquina |

El endpoint de estado valida contra 7 valores permitidos, guarda en historial y envía WhatsApp automático si el estado es `reparada` o `entregada`.

---

### `routes/quote.js` — Cotizaciones

| Endpoint | Descripción |
|----------|-------------|
| `GET /api/quote/catalog` | Catálogo de repuestos (`cco_tipo = 'R'`, estado activo) |
| `GET /api/quotes/machine` | Cotización guardada de una máquina específica |
| `POST /api/quotes/machine` | Guarda/actualiza mano de obra, descripción e ítems de una máquina |
| `GET /api/quotes/order/:orderId` | Resumen consolidado de toda la orden |
| `POST /api/quotes/order/:orderId/generate-message` | Genera mensaje de WhatsApp con IA (Claude) |

Aplica IVA configurable vía `IVA_RATE` (decimal, default `0`).

---

### `routes/whatsapp.js` — Mensajería

| Endpoint | Descripción |
|----------|-------------|
| `POST /api/quotes/order/:orderId/send-whatsapp` | Envía el mensaje de cotización generado |
| `POST /api/whatsapp/send` | Envío genérico de mensaje al teléfono de la orden |

Ambos requieren que WhatsApp Web esté autenticado y listo (`isReady() === true`).

---

### `routes/pdf.js` — Documentos PDF

| Endpoint | Descripción |
|----------|-------------|
| `GET /api/orders/:orderId/pdf/quote` | Descarga PDF de cotización de toda la orden |
| `GET /api/orders/:orderId/pdf/maintenance/:equipmentOrderId` | Descarga informe de mantenimiento de una máquina |
| `POST /api/orders/:orderId/send-pdf/quote` | Envía cotización PDF por WhatsApp |
| `POST /api/orders/:orderId/send-pdf/maintenance/:equipmentOrderId` | Envía informe por WhatsApp |

El informe de mantenimiento es **por máquina** y genera texto técnico con IA (80-150 palabras).

---

### `utils/db.js` — Conexiones MySQL

Pool de hasta 10 conexiones. Configurado por variables de entorno. Todos los módulos llaman `db.getConnection()` y liberan con `conn.release()`.

---

### `utils/schema.js` — Detección dinámica de esquema

Resuelve diferencias de nombres de columna entre instalaciones del ERP. Cachea resultados en memoria del proceso para evitar `SHOW COLUMNS` repetidos.

| Función | Qué hace |
|---------|----------|
| `resolveOrder(conn, id)` | Busca una orden por `uid_orden` o por `ord_consecutivo` |
| `getHerramientaOrdenTechColumn()` | Detecta qué columna guarda el técnico en `b2c_herramienta_orden` |
| `getUsuarioColumns()` | Mapea columnas de `b2c_usuario` (id, nombre, email, rol, estado) |
| `buildUserNameExpr()` | Construye expresión SQL de nombre completo |
| `getTechnicianWhereClause()` | Filtra técnicos activos por rol |

---

### `utils/ia.js` — Inteligencia artificial

Wrapper del SDK de Anthropic. Usa `client.beta.messages.create()` (requerido por `@anthropic-ai/sdk@0.13.1`).

- Función principal: `generateText(prompt, maxTokens = 450)`
- Modelo configurable por `CLAUDE_MODEL` (default: `claude-opus-4-6`)
- El cliente se inicializa una sola vez (singleton)

---

### `utils/pdf-generator.js` — Generación de PDFs

Produce dos tipos de documentos A4 con PDFKit.

**`generateQuotePDF(orderData)`** — Cotización comercial:
- Encabezado: logo + datos empresa + datos cliente
- Tabla de ítems agrupada por máquina (mano de obra + descripción + repuestos)
- Pie: subtotal / IVA / total / firma

**`generateMaintenancePDF(equipmentData)`** — Informe técnico:
- Logo centrado al tope
- Datos del técnico y solicitante
- Descripción del equipo (nombre, marca, serial)
- Lista de repuestos utilizados
- Observación técnica generada por IA
- Líneas de firma (técnico + cliente)

**Anchos de columnas de la tabla de cotización** (suma = 515 pt):

| Columna | Ancho |
|---------|-------|
| Ítem / descripción | 265 pt |
| Precio unitario | 65 pt |
| Cantidad | 50 pt |
| Descuento | 65 pt |
| Total | 70 pt |

---

### `utils/whatsapp-client.js` — Cliente WhatsApp

Singleton de `whatsapp-web.js` con estrategia `LocalAuth` (sesión persistente en disco). Muestra QR en consola al primer uso. Exporta `waClient` e `isReady()`.

---

### `middleware/apiKey.js` — Protección de API

Si la variable `API_SECRET_KEY` está definida, todas las rutas `/api/*` exigen el header `X-API-Key`. Si no está definida, el middleware es transparente.

---

### `public/generador-cotizaciones.html` — SPA Frontend

Interfaz completa en un solo archivo HTML con vanilla JS. Flujo de uso:

1. **Buscar orden** — por consecutivo, nombre o teléfono
2. **Seleccionar máquina** — dropdown de equipos de la orden
3. **Asignar técnico** — por máquina o a toda la orden
4. **Cambiar estado** — dropdown por cada máquina (7 estados posibles)
5. **Cotizar** — mano de obra + repuestos del catálogo por máquina
6. **Guardar y generar mensaje** — IA produce el texto de WhatsApp
7. **Enviar** — mensaje de texto o PDF por WhatsApp
8. **Descargar PDF** — cotización o informe de mantenimiento

---

## 4. Base de datos

Las tablas provienen de un ERP B2C externo (prefijo `b2c_`). Las tres tablas de cotización y las dos de estado son creadas por este sistema al arrancar.

### Tablas del ERP (solo lectura / lectura-escritura limitada)

| Tabla | Descripción |
|-------|-------------|
| `b2c_orden` | Órdenes de servicio (`uid_orden`, `ord_consecutivo`, `ord_estado`, `ord_fecha`, FK a cliente) |
| `b2c_cliente` | Clientes (`uid_cliente`, `cli_razon_social`, `cli_telefono`, `cli_identificacion`, `cli_contacto`, `cli_direccion`) |
| `b2c_herramienta_orden` | Equipos dentro de una orden (`uid_herramienta_orden`, `uid_orden`, `uid_herramienta`, columna de técnico variable, **`her_estado`** agregado por este sistema) |
| `b2c_herramienta` | Catálogo de equipos (`uid_herramienta`, `her_nombre`, `her_marca`, `her_serial`) |
| `b2c_usuario` | Técnicos / usuarios del ERP (esquema de columnas variable, detectado dinámicamente) |
| `b2c_concepto_costos` | Catálogo de repuestos y servicios (`uid_concepto_costo`, `cco_descripcion`, `cco_valor`, `cco_tipo`, `cco_estado`) |

### Tablas creadas por este sistema

| Tabla | Descripción |
|-------|-------------|
| `b2c_cotizacion_orden` | Totales de cotización por orden (`uid_orden`, `subtotal`, `iva`, `total`, `mensaje_whatsapp`, `whatsapp_enviado`, timestamps) |
| `b2c_cotizacion_maquina` | Cotización por máquina (`uid_orden`, `uid_herramienta_orden`, `tecnico_id`, `mano_obra`, `descripcion_trabajo`, `subtotal`) |
| `b2c_cotizacion_item` | Ítems de repuesto por máquina (`uid_orden`, `uid_herramienta_orden`, `nombre`, `cantidad`, `precio`, `subtotal`) |
| `b2c_herramienta_status_log` | Historial de cambios de estado por máquina (`uid_herramienta_orden`, `estado`, `changed_at`) |

### Columna agregada al ERP

| Tabla | Columna | Tipo | Default |
|-------|---------|------|---------|
| `b2c_herramienta_orden` | `her_estado` | `VARCHAR(32)` | `'pendiente_revision'` |

---

## 5. Estados de máquina

| Valor | Etiqueta | Acción automática |
|-------|----------|-------------------|
| `pendiente_revision` | Pendiente de revisión | — |
| `revisada` | Revisada | — |
| `cotizada` | Cotizada | — |
| `autorizada` | Autorizada | — |
| `no_autorizada` | No autorizada | — |
| `reparada` | Reparada | Envía WhatsApp al cliente |
| `entregada` | Entregada | Envía WhatsApp al cliente |

---

## 6. Datos hardcodeados del negocio

Estos valores están escritos directamente en el código fuente y **deben editarse manualmente** si cambian.

### `utils/pdf-generator.js` — Datos de la empresa en PDFs

```js
const COMPANY = {
  name:    'HERNANDO PARRA ZAPATA',
  nit:     'NIT 9862087-1',
  address: 'calle 21 No 10 02 - Pereira',
  phone:   '3104650437',
  website: 'www.suherramienta.com',
  email:   'suherramientapereira@gmail.com',
};
```

### `routes/orders.js` — Mensajes automáticos de WhatsApp

```js
reparada: `...lista para recoger en nuestro taller.
  📍 Calle 21 No 10 02, Pereira
  📞 3104650437
  — SU HERRAMIENTA CST`

entregada: `...ha sido entregada. ¡Gracias por confiar en nosotros!
  — SU HERRAMIENTA CST`
```

### `public/generador-cotizaciones.html` — URL base de la API

```js
const API_BASE = 'http://localhost:3001/api';
```

Si el servidor se despliega en otra máquina, esta URL debe actualizarse.

---

## 7. Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `DB_HOST` | Sí | Host MySQL |
| `DB_USER` | Sí | Usuario MySQL |
| `DB_PASSWORD` | Sí | Contraseña MySQL |
| `DB_NAME` | Sí | Nombre de la base de datos |
| `ANTHROPIC_API_KEY` | Sí | Clave API de Anthropic (IA) |
| `PORT` | No | Puerto del servidor (default `3001`) |
| `NODE_ENV` | No | `development` activa endpoint de debug |
| `CLAUDE_MODEL` | No | Modelo de IA (default `claude-opus-4-6`) |
| `IVA_RATE` | No | Tasa IVA decimal (default `0`, ej: `0.19` para 19 %) |
| `API_SECRET_KEY` | No | Activa guard de API key en rutas `/api/*` |

---

## 8. Flujo de datos — cotización completa

```
Usuario busca orden
        │
        ▼
GET /api/orders/search  →  b2c_orden + b2c_cliente
        │
        ▼
GET /api/orders/:id     →  b2c_herramienta_orden + b2c_herramienta + b2c_usuario
        │
        ▼
Usuario selecciona máquina y agrega repuestos
        │
        ▼
POST /api/quotes/machine  →  b2c_cotizacion_maquina + b2c_cotizacion_item
        │
        ▼
POST /api/quotes/order/:id/generate-message  →  IA (Claude)  →  texto WhatsApp
        │
        ├── POST /api/quotes/order/:id/send-whatsapp  →  WhatsApp Web
        └── GET  /api/orders/:id/pdf/quote            →  PDF descargable
                                                     └── POST send-pdf/quote → WhatsApp
```

## 9. Flujo de datos — informe de mantenimiento

```
Usuario elige máquina en selector PDF
        │
        ▼
GET /api/orders/:id/pdf/maintenance/:equipmentOrderId
        │
        ├── Consulta máquina + ítems de b2c_cotizacion_item
        ├── Llama a IA (Claude) → observación técnica ~150 palabras
        └── generateMaintenancePDF() → PDF descargable / enviable por WhatsApp
```
