# Contexto del proyecto — universal-cotizaciones

Sistema de cotizaciones y órdenes de servicio para **SU HERRAMIENTA CST** (taller de reparación de herramientas eléctricas, Pereira - Colombia).

---

## Stack

- **Backend**: Node.js + Express (`server.js` entrada, puerto 3001)
- **BD**: MySQL via `mysql2/promise` (`utils/db.js`)
- **IA**: Anthropic SDK `@0.13.1` — usar `client.beta.messages.create()`, NO `client.messages.create()`
- **PDF**: PDFKit `^0.17.2` (`utils/pdf-generator.js`)
- **WhatsApp**: `whatsapp-web.js` (`utils/whatsapp-client.js`)
- **Frontend**: una sola página (`public/generador-cotizaciones.html`)

---

## Estructura de archivos clave

```
server.js                    Entrada, ~133 líneas
middleware/apiKey.js         Guard API key opcional (env API_SECRET_KEY)
utils/db.js                  Pool MySQL
utils/schema.js              Helpers BD + resolveOrder
utils/ia.js                  Wrapper Anthropic SDK
utils/whatsapp-client.js     Singleton waClient
utils/pdf-generator.js       Generación PDFs (cotización + informe mantenimiento)
routes/orders.js             GET/PATCH órdenes
routes/quote.js              GET/POST cotizaciones
routes/whatsapp.js           POST envío WhatsApp
routes/pdf.js                GET descargar/POST enviar PDFs
public/generador-cotizaciones.html   UI completa (vanilla JS)
public/assets/logo.png       Logo empresa (portrait 1396x2696 px)
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
```

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

## Rutas PDF (routes/pdf.js)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/orders/:orderId/pdf/quote` | Descarga cotización de TODA la orden |
| GET | `/api/orders/:orderId/pdf/maintenance/:equipmentOrderId` | Descarga informe de UNA máquina |
| POST | `/api/orders/:orderId/send-pdf/quote` | Envía cotización PDF por WhatsApp |
| POST | `/api/orders/:orderId/send-pdf/maintenance/:equipmentOrderId` | Envía informe por WhatsApp |

**El informe de mantenimiento es por máquina**: el frontend tiene un select para elegir
la máquina y llama al endpoint con su `uid_herramienta_orden`. Diseñado así intencionalmente.

---

## Logo — problema conocido y solución aplicada

`public/assets/logo.png` es portrait (1396x2696 px). Se aplica rotacion -90 en PDFKit:

```js
doc.save()
  .translate(cx, cy)
  .rotate(-90)
  .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
  .restore();
// cx = logoX + LOGO_FW/2,  cy = logoY + LOGO_FH/2
// LOGO_FH = Math.round(LOGO_FW * 1396 / 2696)
```

- **Informe mantenimiento**: `LOGO_FW = 200`, centrado al tope
- **Cotización**: `LOGO_FW = 110`, columna izquierda del header

Si se reemplaza el logo por una version horizontal, eliminar la logica de rotacion
y volver a `doc.image(LOGO, x, y, { width: W, height: H })`.

---

## Cotización PDF — tabla de ítems

Por cada máquina se generan:
1. Fila **negrita** fondo azul claro: `"Reparación [maquina (marca) S/N:x]"` + mano de obra
2. Sub-fila gris 14px: `"arrow [descripcion_trabajo]"` — solo si existe descripcion
3. Filas normales: repuestos de esa máquina

Anchos columnas (suma = 515 = CW):
```
Item: 265 | Precio: 65 | Cantidad: 50 | Descuento: 65 | Total: 70
```

---

## Informe de mantenimiento PDF — flujo

1. Frontend elige maquina en select → `GET .../pdf/maintenance/:equipmentOrderId`
2. Backend consulta maquina + items de BD
3. IA genera texto tecnico (~150 palabras, Anthropic)
4. `generateMaintenancePDF()` arma PDF: logo, datos tecnico/cliente, equipo, repuestos, observacion IA, firmas

---

## Notas de entorno (Windows / Git Bash)

- Python no disponible (Windows Store shim)
- Heredocs de Bash fallan con comillas simples — usar Write tool
- Rutas Node: forward slashes `C:/...`
- Shell: bash MINGW64 — sintaxis Unix
