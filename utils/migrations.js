'use strict';
const db = require('./db');

// Crear tablas de cotización al inicio (si no existen)
async function ensureQuoteTables() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_cotizacion_orden (
        uid_orden VARCHAR(64) PRIMARY KEY,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        iva DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        mensaje_whatsapp TEXT NULL,
        whatsapp_enviado TINYINT(1) NOT NULL DEFAULT 0,
        whatsapp_enviado_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_cotizacion_maquina (
        uid_orden VARCHAR(64) NOT NULL,
        uid_herramienta_orden VARCHAR(64) NOT NULL,
        tecnico_id VARCHAR(64) NULL,
        mano_obra DECIMAL(14,2) NOT NULL DEFAULT 0,
        descripcion_trabajo TEXT NULL,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (uid_orden, uid_herramienta_orden)
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_cotizacion_item (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        uid_orden VARCHAR(64) NOT NULL,
        uid_herramienta_orden VARCHAR(64) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        cantidad INT NOT NULL DEFAULT 1,
        precio DECIMAL(14,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cot_item (uid_orden, uid_herramienta_orden)
      )
    `);

    console.log('✅ Tablas de cotización verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar tablas de cotización. Si tu usuario de BD no tiene permisos CREATE, créalas manualmente.');
    console.warn(String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureStatusTables() {
  const conn = await db.getConnection();
  try {
    // Agregar columna her_estado si no existe
    // IF NOT EXISTS es sintaxis MariaDB — en MySQL 8 usamos try/catch con ER_DUP_FIELDNAME
    try {
      await conn.execute(
        `ALTER TABLE b2c_herramienta_orden ADD COLUMN her_estado VARCHAR(32) NOT NULL DEFAULT 'pendiente_revision'`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // Agregar columna fho_tipo a fotos si no existe
    try {
      await conn.execute(
        `ALTER TABLE b2c_foto_herramienta_orden ADD COLUMN fho_tipo VARCHAR(20) NOT NULL DEFAULT 'recepcion'`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // Columnas para órdenes de garantía
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_tipo VARCHAR(20) NOT NULL DEFAULT 'normal'`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_factura VARCHAR(255) NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_garantia_vence DATE NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_revision_limite DATE NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // Tabla de historial de cambios de estado
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_herramienta_status_log (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        uid_herramienta_orden VARCHAR(64) NOT NULL,
        estado      VARCHAR(32) NOT NULL,
        changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hsl (uid_herramienta_orden)
      )
    `);

    // Tabla de conversaciones de autorización por WhatsApp
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_wa_autorizacion_pendiente (
        uid_autorizacion INT AUTO_INCREMENT PRIMARY KEY,
        uid_orden        INT NOT NULL,
        wa_phone         VARCHAR(20) NOT NULL,
        estado           ENUM('esperando_opcion','esperando_maquinas') NOT NULL DEFAULT 'esperando_opcion',
        created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_wa_phone (wa_phone)
      )
    `);

    // Tabla de informes de mantenimiento persistentes
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_informe_mantenimiento (
        uid_informe           INT AUTO_INCREMENT PRIMARY KEY,
        uid_orden             INT NOT NULL,
        uid_herramienta_orden INT NOT NULL,
        inf_archivo           VARCHAR(255) NOT NULL,
        inf_fecha             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_informe_maquina (uid_herramienta_orden),
        INDEX idx_inf_orden (uid_orden)
      )
    `);

    console.log('✅ Tablas de estado verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar tablas de estado:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TENANT — Fase 1: Crear b2c_tenant + tenant por defecto
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTenantTable() {
  const conn = await db.getConnection();
  try {
    // Crear tabla b2c_tenant
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_tenant (
        uid_tenant        INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ten_nombre        VARCHAR(100) NOT NULL,
        ten_slug          VARCHAR(50)  NOT NULL,
        ten_slug_locked   TINYINT(1)   NOT NULL DEFAULT 0,
        ten_dominio_custom VARCHAR(100) NULL,
        ten_logo          VARCHAR(255) NULL,
        ten_color_primary VARCHAR(7)   NOT NULL DEFAULT '#1B2A6B',
        ten_color_accent  VARCHAR(7)   NOT NULL DEFAULT '#E31E24',
        ten_wa_number     VARCHAR(20)  NULL,
        ten_wa_parts_number VARCHAR(20) NULL,
        ten_estado        ENUM('activo','suspendido','prueba') NOT NULL DEFAULT 'prueba',
        ten_plan          VARCHAR(20)  NOT NULL DEFAULT 'mensual',
        ten_vence         DATE         NULL,
        ten_created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_slug (ten_slug),
        UNIQUE KEY uq_dominio (ten_dominio_custom)
      )
    `);

    // Insertar tenant por defecto (SU HERRAMIENTA CST) si no existe
    await conn.execute(`
      INSERT IGNORE INTO b2c_tenant
        (uid_tenant, ten_nombre, ten_slug, ten_slug_locked, ten_estado,
         ten_color_primary, ten_color_accent,
         ten_wa_number, ten_wa_parts_number)
      VALUES
        (1, 'SU HERRAMIENTA CST', 'suherramienta', 1, 'activo',
         '#1d3557', '#e63946',
         ?, ?)
    `, [
      process.env.PARTS_WHATSAPP_NUMBER || null,
      process.env.PARTS_WHATSAPP_NUMBER || null,
    ]);

    console.log('✅ Tabla b2c_tenant verificada/creada — tenant por defecto listo');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar b2c_tenant:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TENANT — Fase 1: Agregar tenant_id a todas las tablas de negocio
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTenantColumns() {
  const conn = await db.getConnection();

  // Tablas que necesitan tenant_id
  const tablas = [
    'b2c_usuario',
    'b2c_cliente',
    'b2c_orden',
    'b2c_herramienta',
    'b2c_herramienta_orden',
    'b2c_foto_herramienta_orden',
    'b2c_concepto_costos',
    'b2c_cotizacion_orden',
    'b2c_cotizacion_maquina',
    'b2c_cotizacion_item',
    'b2c_herramienta_status_log',
    'b2c_wa_autorizacion_pendiente',
    'b2c_informe_mantenimiento',
  ];

  try {
    for (const tabla of tablas) {
      // Agregar columna tenant_id con DEFAULT 1 (tenant SU HERRAMIENTA CST)
      try {
        await conn.execute(
          `ALTER TABLE \`${tabla}\` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1`
        );
        // Agregar índice para búsquedas eficientes por tenant
        try {
          await conn.execute(
            `ALTER TABLE \`${tabla}\` ADD INDEX idx_tenant (tenant_id)`
          );
        } catch (_) { /* índice ya existe */ }

        console.log(`  ✅ tenant_id agregado a ${tabla}`);
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
          // Columna ya existe — solo asegurarse de que los registros sin asignar queden en tenant 1
          await conn.execute(
            `UPDATE \`${tabla}\` SET tenant_id = 1 WHERE tenant_id = 0`
          );
        } else if (e.code === 'ER_NO_SUCH_TABLE') {
          // Tabla aún no existe (se crea más adelante en el arranque)
          console.log(`  ⏭ ${tabla} aún no existe, se migrará al crearse`);
        } else {
          throw e;
        }
      }
    }
    console.log('✅ Columnas tenant_id verificadas en todas las tablas');
  } catch (e) {
    console.warn('⚠️ Error al agregar tenant_id:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureSessionTable() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        session_id VARCHAR(128) NOT NULL PRIMARY KEY,
        data       TEXT         NOT NULL,
        expires    DATETIME     NOT NULL,
        INDEX idx_sess_expires (expires)
      )
    `);
    console.log('✅ Tabla app_sessions verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear app_sessions:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureGarantiaColumns() {
  const conn = await db.getConnection();
  const cols = [
    ['hor_es_garantia',      'TINYINT(1) NOT NULL DEFAULT 0'],
    ['hor_garantia_vence',   'DATE NULL'],
    ['hor_garantia_factura', 'VARCHAR(255) NULL'],
  ];
  try {
    for (const [col, def] of cols) {
      try {
        await conn.execute(`ALTER TABLE b2c_herramienta_orden ADD COLUMN ${col} ${def}`);
      } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn(`⚠️ ${col}:`, e.message);
      }
    }
    console.log('✅ Columnas garantía por máquina verificadas');
  } finally {
    conn.release();
  }
}


async function ensureAuditLog() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_audit_log (
        uid_log       BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id     INT          NULL,
        uid_usuario   INT          NULL,
        accion        VARCHAR(64)  NOT NULL,
        entidad       VARCHAR(32)  NOT NULL,
        uid_entidad   VARCHAR(64)  NULL,
        datos_antes   JSON         NULL,
        datos_despues JSON         NULL,
        ip_origen     VARCHAR(45)  NOT NULL DEFAULT '',
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_tenant  (tenant_id),
        INDEX idx_audit_usuario (uid_usuario),
        INDEX idx_audit_ts      (created_at)
      )
    `);
    // Agregar columnas pwd a b2c_usuario (para T4 — política de contraseñas)
    try {
      await conn.execute(`ALTER TABLE b2c_usuario ADD COLUMN pwd_changed_at DATETIME NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_usuario ADD COLUMN pwd_must_change TINYINT(1) NOT NULL DEFAULT 0`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Tabla b2c_audit_log y columnas pwd verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_audit_log:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureIvaColumns() {
  const conn = await db.getConnection();
  try {
    try {
      await conn.execute(`ALTER TABLE b2c_tenant ADD COLUMN ten_iva_responsable TINYINT(1) NOT NULL DEFAULT 0`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_tenant ADD COLUMN ten_iva_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 19.00`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Columnas IVA en b2c_tenant verificadas');
  } catch (e) {
    console.warn('⚠️ No pude agregar columnas IVA a b2c_tenant:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureReciboCajaTable() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_recibo_caja (
        uid_recibo      INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id       INT          NOT NULL DEFAULT 1,
        uid_orden       INT          NULL,
        uid_cliente     INT          NULL,
        rc_nombre_paga  VARCHAR(100) NULL,
        rc_consecutivo  INT          NOT NULL DEFAULT 0,
        rc_fecha        DATE         NOT NULL,
        rc_concepto     VARCHAR(255) NOT NULL,
        rc_valor        DECIMAL(14,2) NOT NULL DEFAULT 0,
        rc_metodo_pago  ENUM('efectivo','transferencia','tarjeta','nequi','daviplata')
                        NOT NULL DEFAULT 'efectivo',
        rc_referencia   VARCHAR(100) NULL,
        rc_estado       ENUM('activo','anulado') NOT NULL DEFAULT 'activo',
        rc_creado_por   INT          NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rc_tenant  (tenant_id),
        INDEX idx_rc_orden   (uid_orden),
        INDEX idx_rc_cliente (uid_cliente)
      )
    `);
    console.log('✅ Tabla b2c_recibo_caja verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_recibo_caja:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureReciboCajaItems() {
  const conn = await db.getConnection();
  try {
    try {
      await conn.execute(`ALTER TABLE b2c_recibo_caja ADD COLUMN rc_items JSON NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Columna rc_items en b2c_recibo_caja verificada');
  } catch (e) {
    console.warn('⚠️ No pude agregar rc_items a b2c_recibo_caja:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureReciboCajaCedula() {
  const conn = await db.getConnection();
  try {
    try {
      await conn.execute(`ALTER TABLE b2c_recibo_caja ADD COLUMN rc_cliente_cedula VARCHAR(20) NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Columna rc_cliente_cedula en b2c_recibo_caja verificada');
  } catch (e) {
    console.warn('⚠️ No pude agregar rc_cliente_cedula:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureVentaTables() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_venta (
        uid_venta              INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id              INT NOT NULL,
        uid_orden              INT NULL,
        uid_cliente            INT NULL,
        uid_recibo             INT NULL,
        ven_consecutivo        INT NOT NULL DEFAULT 0,
        ven_fecha              DATE NOT NULL,
        ven_subtotal           DECIMAL(14,2) DEFAULT 0,
        ven_descuento          DECIMAL(14,2) DEFAULT 0,
        ven_iva                DECIMAL(14,2) DEFAULT 0,
        ven_total              DECIMAL(14,2) DEFAULT 0,
        ven_metodo_pago        ENUM('efectivo','transferencia','tarjeta','nequi','daviplata','credito') DEFAULT 'efectivo',
        ven_referencia         VARCHAR(100) NULL,
        ven_notas              TEXT NULL,
        ven_estado             ENUM('abierta','pagada','anulada') DEFAULT 'abierta',
        ven_mano_obra          DECIMAL(14,2) DEFAULT 0,
        ven_costo_repuestos    DECIMAL(14,2) DEFAULT 0,
        ven_utilidad_repuestos DECIMAL(14,2) DEFAULT 0,
        ven_margen_repuestos   DECIMAL(7,4)  DEFAULT 0,
        ven_utilidad_total     DECIMAL(14,2) DEFAULT 0,
        ven_margen_total       DECIMAL(7,4)  DEFAULT 0,
        ven_es_rentable        TINYINT(1)    DEFAULT 0,
        ven_utilidad_objetivo  DECIMAL(14,2) DEFAULT 60000,
        ven_diferencia_utilidad DECIMAL(14,2) DEFAULT 0,
        ven_creado_por         INT NULL,
        created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_venta_tenant  (tenant_id),
        INDEX idx_venta_cliente (uid_cliente),
        INDEX idx_venta_orden   (uid_orden),
        INDEX idx_venta_fecha   (ven_fecha),
        FOREIGN KEY (tenant_id) REFERENCES b2c_tenant(uid_tenant)
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_venta_item (
        uid_item             INT AUTO_INCREMENT PRIMARY KEY,
        uid_venta            INT NOT NULL,
        tenant_id            INT NOT NULL,
        vi_descripcion       VARCHAR(255) NOT NULL,
        vi_tipo              ENUM('mano_obra','repuesto','servicio','otro') DEFAULT 'repuesto',
        vi_cantidad          DECIMAL(10,3) DEFAULT 1,
        vi_precio_unitario   DECIMAL(14,2) DEFAULT 0,
        vi_costo_unitario    DECIMAL(14,2) DEFAULT 0,
        vi_descuento_pct     DECIMAL(5,2)  DEFAULT 0,
        vi_iva_pct           DECIMAL(5,2)  DEFAULT 0,
        vi_subtotal          DECIMAL(14,2) DEFAULT 0,
        vi_total             DECIMAL(14,2) DEFAULT 0,
        INDEX idx_vitem_venta (uid_venta),
        FOREIGN KEY (uid_venta)   REFERENCES b2c_venta(uid_venta),
        FOREIGN KEY (tenant_id)   REFERENCES b2c_tenant(uid_tenant)
      )
    `);

    console.log('✅ Tablas b2c_venta + b2c_venta_item verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear tablas de venta:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureConfigFinanciera() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_config_financiera (
        uid_config               INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id                INT NOT NULL,
        cf_arriendo              DECIMAL(14,2) DEFAULT 0,
        cf_energia               DECIMAL(14,2) DEFAULT 0,
        cf_agua                  DECIMAL(14,2) DEFAULT 0,
        cf_internet              DECIMAL(14,2) DEFAULT 0,
        cf_telefono              DECIMAL(14,2) DEFAULT 0,
        cf_salarios              DECIMAL(14,2) DEFAULT 0,
        cf_seguridad_social      DECIMAL(14,2) DEFAULT 0,
        cf_parafiscales          DECIMAL(14,2) DEFAULT 0,
        cf_mantenimiento         DECIMAL(14,2) DEFAULT 0,
        cf_otros                 DECIMAL(14,2) DEFAULT 0,
        cf_descripcion_otros     VARCHAR(255)  NULL,
        cf_total_costos_fijos    DECIMAL(14,2) DEFAULT 0,
        cf_meta_ahorro_mes       DECIMAL(14,2) DEFAULT 2500000,
        cf_meta_total_mes        DECIMAL(14,2) DEFAULT 13900000,
        cf_mano_obra_base        DECIMAL(14,2) DEFAULT 35000,
        cf_margen_objetivo_rep   DECIMAL(5,4)  DEFAULT 0.5000,
        cf_utilidad_objetivo_min DECIMAL(14,2) DEFAULT 60000,
        cf_utilidad_objetivo_opt DECIMAL(14,2) DEFAULT 85000,
        cf_vigente_desde         DATE          NOT NULL,
        cf_vigente_hasta         DATE          NULL,
        updated_at               DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        updated_by               INT           NULL,
        INDEX idx_cfg_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES b2c_tenant(uid_tenant)
      )
    `);
    console.log('✅ Tabla b2c_config_financiera verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_config_financiera:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function seedConfigFinanciera() {
  const conn = await db.getConnection();
  try {
    // Insertar config inicial solo si no existe ninguna para ese tenant
    const [tenants] = await conn.execute(
      `SELECT uid_tenant FROM b2c_tenant WHERE ten_estado = 'activo'`
    );
    for (const { uid_tenant } of tenants) {
      const [[existing]] = await conn.execute(
        `SELECT uid_config FROM b2c_config_financiera WHERE tenant_id = ? LIMIT 1`,
        [uid_tenant]
      );
      if (existing) continue;

      const hoy = new Date().toISOString().slice(0, 10);
      await conn.execute(
        `INSERT INTO b2c_config_financiera
           (tenant_id, cf_total_costos_fijos, cf_meta_ahorro_mes, cf_meta_total_mes,
            cf_mano_obra_base, cf_margen_objetivo_rep,
            cf_utilidad_objetivo_min, cf_utilidad_objetivo_opt,
            cf_vigente_desde)
         VALUES (?, 11400000, 2500000, 13900000, 35000, 0.5000, 60000, 85000, ?)`,
        [uid_tenant, hoy]
      );
      console.log(`✅ Config financiera inicial insertada para tenant ${uid_tenant}`);
    }
  } catch (e) {
    console.warn('⚠️ No pude insertar config financiera inicial:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureInventarioColumns() {
  const conn = await db.getConnection();
  try {
    // cco_costo — precio de compra del repuesto (para calcular margen)
    try {
      await conn.execute(`ALTER TABLE b2c_concepto_costos ADD COLUMN cco_costo DECIMAL(12,2) NOT NULL DEFAULT 0`);
      console.log('✅ cco_costo agregado a b2c_concepto_costos');
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // cco_stock — unidades disponibles en bodega
    try {
      await conn.execute(`ALTER TABLE b2c_concepto_costos ADD COLUMN cco_stock INT NOT NULL DEFAULT 0`);
      console.log('✅ cco_stock agregado a b2c_concepto_costos');
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  } finally {
    conn.release();
  }
}

async function ensureInventarioRecepciones() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_inventario_recepciones (
        uid_recepcion   INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id       INT NOT NULL DEFAULT 1,
        uid_concepto_costo INT NOT NULL,
        ir_fecha        DATE NOT NULL,
        ir_unidades     INT NOT NULL,
        ir_costo_unitario  DECIMAL(12,2) NOT NULL,
        ir_costo_anterior  DECIMAL(12,2) NOT NULL DEFAULT 0,
        ir_stock_anterior  INT NOT NULL DEFAULT 0,
        ir_costo_resultante DECIMAL(12,2) NOT NULL,
        ir_stock_resultante INT NOT NULL,
        ir_creado_por   INT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant   (tenant_id),
        INDEX idx_concepto (uid_concepto_costo)
      )
    `);
  } finally {
    conn.release();
  }
}

async function fixVentaItemTipos() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      UPDATE b2c_venta_item
      SET vi_tipo = 'mano_obra'
      WHERE vi_tipo != 'mano_obra'
        AND (vi_descripcion LIKE 'Mano de obra%' OR vi_descripcion LIKE 'Mano obra%')
    `);
  } finally {
    conn.release();
  }
}

async function ensureEgresoTable() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_egreso (
        uid_egreso        INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id         INT           NOT NULL DEFAULT 1,
        egr_fecha         DATE          NOT NULL,
        egr_concepto      VARCHAR(255)  NOT NULL,
        egr_categoria     VARCHAR(50)   NOT NULL DEFAULT 'otros',
        egr_valor         DECIMAL(14,2) NOT NULL DEFAULT 0,
        egr_proveedor     VARCHAR(150)  NULL,
        egr_nit_proveedor VARCHAR(30)   NULL,
        egr_metodo_pago   ENUM('efectivo','transferencia','tarjeta','nequi','daviplata','credito','cheque')
                          NOT NULL DEFAULT 'efectivo',
        egr_referencia    VARCHAR(100)  NULL,
        egr_notas         TEXT          NULL,
        egr_factura_imagen VARCHAR(255) NULL,
        egr_ia_extraido   TINYINT(1)   NOT NULL DEFAULT 0,
        egr_estado        ENUM('activo','anulado') NOT NULL DEFAULT 'activo',
        egr_creado_por    INT           NULL,
        created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_egr_tenant (tenant_id),
        INDEX idx_egr_fecha  (egr_fecha),
        INDEX idx_egr_cat    (egr_categoria)
      )
    `);
    console.log('✅ Tabla b2c_egreso verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_egreso:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureEgresoVencimiento() {
  const conn = await db.getConnection();
  try {
    const cols = [
      [`egr_forma_pago`,         `ENUM('contado','credito') NOT NULL DEFAULT 'contado'`],
      [`egr_fecha_vencimiento`,  `DATE NULL`],
      [`egr_estado_pago`,        `ENUM('pendiente','pagado') NOT NULL DEFAULT 'pagado'`],
    ];
    for (const [col, def] of cols) {
      try {
        await conn.execute(`ALTER TABLE b2c_egreso ADD COLUMN ${col} ${def}`);
        console.log(`✅ ${col} agregado a b2c_egreso`);
      } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    }
    // Índice para consultar vencimientos pendientes rápido
    try {
      await conn.execute(
        `ALTER TABLE b2c_egreso ADD INDEX idx_egr_venc (tenant_id, egr_estado_pago, egr_fecha_vencimiento)`
      );
    } catch (_) {}
  } catch (e) {
    console.warn('⚠️ No pude agregar columnas de vencimiento a b2c_egreso:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureContabilidadAddon() {
  const conn = await db.getConnection();
  try {
    try {
      await conn.execute(
        `ALTER TABLE b2c_tenant ADD COLUMN addon_contabilidad TINYINT(1) NOT NULL DEFAULT 0`
      );
      console.log('✅ addon_contabilidad agregado a b2c_tenant');
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  } catch (e) {
    console.warn('⚠️ No pude agregar addon_contabilidad:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureSolicitudRecogida() {
  const conn = await db.getConnection();
  try {
    // Header: datos generales de la solicitud (sin campos de máquina)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_solicitud_recogida (
        uid_solicitud     INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id         INT NOT NULL DEFAULT 1,
        uid_cliente       INT NOT NULL,
        direccion         VARCHAR(255) NOT NULL,
        fecha_sugerida    DATE NULL,
        fecha_confirmada  DATETIME NULL,
        nota_confirmacion VARCHAR(255) NULL,
        fotos             JSON NULL,
        estado            ENUM('pendiente','confirmada','completada','cancelada') NOT NULL DEFAULT 'pendiente',
        created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sol_cliente (uid_cliente),
        INDEX idx_sol_tenant  (tenant_id),
        INDEX idx_sol_estado  (estado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Eliminar columnas de máquina del esquema anterior si existen (upgrade path)
    for (const col of ['uid_herramienta','her_nombre','her_marca','her_serial','tipo_servicio','descripcion']) {
      try { await conn.execute(`ALTER TABLE b2c_solicitud_recogida DROP COLUMN ${col}`); } catch (_) {}
    }
    // Columna para vincular la orden de servicio creada desde esta solicitud
    try {
      await conn.execute(`ALTER TABLE b2c_solicitud_recogida ADD COLUMN uid_orden_creada INT NULL`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.warn('⚠️ uid_orden_creada:', String(e?.message || e));
    }
    console.log('✅ b2c_solicitud_recogida lista');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_solicitud_recogida:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureSolicitudRecogidaItem() {
  const conn = await db.getConnection();
  try {
    // Una fila por máquina incluida en la solicitud
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_solicitud_recogida_item (
        uid_item        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        uid_solicitud   INT NOT NULL,
        tenant_id       INT NOT NULL DEFAULT 1,
        uid_herramienta INT NULL,
        her_nombre      VARCHAR(100) NOT NULL,
        her_marca       VARCHAR(80)  NULL,
        her_serial      VARCHAR(80)  NULL,
        tipo_servicio   ENUM('reparacion','mantenimiento','revision') NOT NULL DEFAULT 'reparacion',
        descripcion     TEXT NULL,
        INDEX idx_sri_solicitud (uid_solicitud),
        INDEX idx_sri_tenant    (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ b2c_solicitud_recogida_item lista');
    // Agregar columna fotos si no existe (upgrade path)
    try {
      await conn.execute(`ALTER TABLE b2c_solicitud_recogida_item ADD COLUMN fotos TEXT NULL`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.warn('⚠️ fotos item:', String(e?.message || e));
    }
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_solicitud_recogida_item:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureWaAgenteTablas() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_wa_conversacion (
        uid_mensaje  BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id    INT          NOT NULL DEFAULT 1,
        wa_phone     VARCHAR(30)  NOT NULL,
        rol          ENUM('user','assistant') NOT NULL,
        contenido    TEXT         NOT NULL,
        created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wac_phone (tenant_id, wa_phone),
        INDEX idx_wac_ts    (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try {
      await conn.execute(
        `ALTER TABLE b2c_tenant ADD COLUMN ten_agente_wa TINYINT(1) NOT NULL DEFAULT 0`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(
        `ALTER TABLE b2c_tenant ADD COLUMN ten_agente_wa_hora_inicio TINYINT NOT NULL DEFAULT 7`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(
        `ALTER TABLE b2c_tenant ADD COLUMN ten_agente_wa_hora_fin TINYINT NOT NULL DEFAULT 20`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Tablas agente WA verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear tablas agente WA:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureAlegraColumns() {
  const conn = await db.getConnection();
  try {
    try { await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_alegra_id INT NULL`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try { await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_alegra_url VARCHAR(255) NULL`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try { await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_factura_estado ENUM('pendiente','emitida','error') NULL`); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Columnas Alegra en b2c_orden verificadas');
  } catch (e) {
    console.warn('⚠️ No pude agregar columnas Alegra:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureWaLidMapping() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_wa_lid_mapping (
        tenant_id  INT         NOT NULL DEFAULT 1,
        wa_lid     VARCHAR(50) NOT NULL,
        wa_phone   VARCHAR(30) NOT NULL,
        created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, wa_lid),
        INDEX idx_wlm_phone (tenant_id, wa_phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ Tabla b2c_wa_lid_mapping verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_wa_lid_mapping:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureWaLidColumn() {
  const conn = await db.getConnection();
  try {
    try {
      await conn.execute(
        `ALTER TABLE b2c_wa_autorizacion_pendiente ADD COLUMN wa_lid VARCHAR(50) NULL`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(
        `ALTER TABLE b2c_wa_autorizacion_pendiente ADD INDEX idx_wa_lid (wa_lid)`
      );
    } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
    console.log('✅ Columna wa_lid en b2c_wa_autorizacion_pendiente verificada');
  } catch (e) {
    console.warn('⚠️ No pude agregar columna wa_lid:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureWaLidMappingUidCliente() {
  const conn = await db.getConnection();
  try {
    try {
      await conn.execute(
        `ALTER TABLE b2c_wa_lid_mapping ADD COLUMN uid_cliente INT NULL`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(
        `ALTER TABLE b2c_wa_lid_mapping MODIFY COLUMN wa_phone VARCHAR(30) NULL`
      );
    } catch (e) { /* MODIFY idempotente — ignorar si ya es NULL */ }
    console.log('✅ b2c_wa_lid_mapping: uid_cliente + wa_phone nullable verificados');
  } catch (e) {
    console.warn('⚠️ No pude actualizar b2c_wa_lid_mapping:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureWaEstadoIdentificacion() {
  const conn = await db.getConnection();
  try {
    // Estado efímero de conversación por wa_sender (LID o teléfono).
    // Separado de b2c_wa_lid_mapping (identidad persistente) — responsabilidades distintas.
    // Limitación conocida: el contador de intentos es por wa_sender; alguien con
    // múltiples SIMs/cuentas WA puede evadirlo iniciando desde otro número.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_wa_estado_identificacion (
        uid_estado              INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id               INT           NOT NULL,
        wa_sender               VARCHAR(50)   NOT NULL,
        estado                  VARCHAR(30)   NOT NULL DEFAULT 'normal',
        estado_desde            DATETIME      NULL,
        uid_cliente_pendiente   INT           NULL,
        intentos_id             TINYINT UNSIGNED NOT NULL DEFAULT 0,
        intentos_reset          DATETIME      NULL,
        UNIQUE KEY uk_sender (tenant_id, wa_sender)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ Tabla b2c_wa_estado_identificacion verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_wa_estado_identificacion:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureRateLimitColumns() {
  const conn = await db.getConnection();
  try {
    // Columnas para rate limiting del agente WA (máximo 20 msgs/hora por número).
    // Viven en b2c_wa_estado_identificacion junto a los demás contadores efímeros
    // por wa_sender. El valor de msgs_hora_count se topa en RATE_CAP (22) vía
    // lógica de aplicación — ver checkRateLimit() en services/wa-agente.js.
    try {
      await conn.execute(
        `ALTER TABLE b2c_wa_estado_identificacion ADD COLUMN msgs_hora_count TINYINT UNSIGNED NOT NULL DEFAULT 0`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(
        `ALTER TABLE b2c_wa_estado_identificacion ADD COLUMN msgs_hora_desde DATETIME NULL`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    console.log('✅ Columnas rate limit agente WA verificadas');
  } catch (e) {
    console.warn('⚠️ No pude agregar columnas rate limit WA:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureConversacionArchivo() {
  const conn = await db.getConnection();
  try {
    // Mismo esquema que b2c_wa_conversacion pero uid_mensaje no es AUTO_INCREMENT
    // porque el PK viene de la tabla fuente.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_wa_conversacion_archivo (
        uid_mensaje  BIGINT       NOT NULL PRIMARY KEY,
        tenant_id    INT          NOT NULL DEFAULT 1,
        wa_phone     VARCHAR(30)  NOT NULL,
        rol          ENUM('user','assistant') NOT NULL,
        contenido    TEXT         NOT NULL,
        created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wca_phone (tenant_id, wa_phone),
        INDEX idx_wca_ts    (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ Tabla b2c_wa_conversacion_archivo verificada/creada');
  } catch (e) {
    console.warn('⚠️ No pude crear b2c_wa_conversacion_archivo:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

/**
 * Lógica de archivado de conversaciones WA antiguas (>90 días).
 * Exportada para testing — recibe conn para que los tests puedan usar un mock.
 * Corre en una transacción: INSERT IGNORE en archivo → DELETE de activa.
 * Si falla, hace rollback y re-lanza para que el caller pueda loguearlo.
 */
async function _doArchivar(conn) {
  try {
    await conn.beginTransaction();
    await conn.execute(`
      INSERT IGNORE INTO b2c_wa_conversacion_archivo
        (uid_mensaje, tenant_id, wa_phone, rol, contenido, created_at)
      SELECT uid_mensaje, tenant_id, wa_phone, rol, contenido, created_at
      FROM b2c_wa_conversacion
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);
    const [del] = await conn.execute(`
      DELETE FROM b2c_wa_conversacion
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);
    await conn.commit();
    if (del.affectedRows > 0) {
      console.log(`✅ [Archivo WA] Archivadas ${del.affectedRows} conversaciones (>90 días)`);
    } else {
      console.log('[Archivo WA] Sin conversaciones >90 días — nada que archivar');
    }
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  }
}

async function archivarConversacionesAntiguas() {
  console.log('[Archivo WA] Iniciando archivado de conversaciones antiguas...');
  const conn = await db.getConnection();
  try {
    await _doArchivar(conn);
  } catch (e) {
    console.warn('⚠️ Error al archivar conversaciones WA:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureEntregaColumns() {
  const conn = await db.getConnection();
  try {
    const cols = [
      [`ALTER TABLE b2c_herramienta_orden ADD COLUMN hor_entrega_nombre   VARCHAR(150) NULL`],
      [`ALTER TABLE b2c_herramienta_orden ADD COLUMN hor_entrega_cedula   VARCHAR(30)  NULL`],
      [`ALTER TABLE b2c_herramienta_orden ADD COLUMN hor_entrega_telefono VARCHAR(20)  NULL`],
      [`ALTER TABLE b2c_herramienta_orden ADD COLUMN hor_entrega_firma    VARCHAR(255) NULL`],
      [`ALTER TABLE b2c_herramienta_orden ADD COLUMN hor_entrega_fecha    DATETIME     NULL`],
    ];
    for (const [sql] of cols) {
      try { await conn.execute(sql); }
      catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    }
    console.log('✅ Columnas de entrega en b2c_herramienta_orden verificadas');
  } catch (e) {
    console.warn('⚠️ No pude agregar columnas de entrega:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function runMigrations() {
  console.log('Ejecutando migraciones BD...');
  await ensureSessionTable();
  await ensureTenantTable();
  await ensureQuoteTables();
  await ensureStatusTables();
  await ensureTenantColumns();
  await ensureGarantiaColumns();
  await ensureAuditLog();
  await ensureIvaColumns();
  await ensureReciboCajaTable();
  await ensureReciboCajaItems();
  await ensureReciboCajaCedula();
  await ensureVentaTables();
  await ensureConfigFinanciera();
  await seedConfigFinanciera();
  await ensureInventarioColumns();
  await ensureInventarioRecepciones();
  await fixVentaItemTipos();
  await ensureEgresoTable();
  await ensureContabilidadAddon();
  await ensureEgresoVencimiento();
  await ensureSolicitudRecogida();
  await ensureSolicitudRecogidaItem();
  await ensureAlegraColumns();
  await ensureWaAgenteTablas();
  await ensureWaLidColumn();
  await ensureWaLidMapping();
  await ensureWaLidMappingUidCliente();
  await ensureWaEstadoIdentificacion();
  await ensureRateLimitColumns();
  await ensureConversacionArchivo();
  await ensureEntregaColumns();
  console.log('Migraciones completadas');
}

module.exports = { runMigrations, archivarConversacionesAntiguas, _doArchivar };
