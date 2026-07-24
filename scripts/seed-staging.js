'use strict';
/**
 * scripts/seed-staging.js
 *
 * Siembra datos de prueba en el ambiente de staging.
 *
 * SEGURIDAD — 3 capas antes de escribir cualquier dato:
 *   Capa 1: requiere flag --staging-confirmed en argv
 *   Capa 2: rechaza si NODE_ENV=production
 *   Capa 3: rechaza si b2c_cliente contiene clientes reales (identificacion NOT LIKE '999%')
 *           — si la tabla no existe (BD vacía) lo trata como "seguro para continuar"
 *
 * Uso:
 *   node scripts/seed-staging.js --staging-confirmed
 *   node scripts/seed-staging.js --staging-confirmed --clean   # borra seed anterior y resiembra
 *
 * Credenciales de prueba que genera:
 *   admin_test   (A) — Admin#Cst2026
 *   fun_test     (F) — Fun#Cst2026
 *   tec_test     (T) — Tec#Cst2026
 *   cliente_test (C) — 0004
 */

require('dotenv').config();

const bcrypt = require('bcrypt');
const pool   = require('../utils/db');

const TENANT_ID     = 1;
const BCRYPT_ROUNDS = 10;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers exportados — puros / sin llamadas a BD (testeables con mocks)
// ═══════════════════════════════════════════════════════════════════════════════

/** Capa 1: verifica presencia del flag de confirmación explícita. */
function hasFlag(argv) {
  return argv.includes('--staging-confirmed');
}

/** Capa 2: bloquea si el entorno es producción. */
function isProduction(env) {
  return env.NODE_ENV === 'production';
}

/**
 * Capa 3: consulta la BD en busca de clientes reales.
 * @returns {'safe'|'unsafe'|'table_missing'}
 *   safe         — tabla existe y no hay clientes reales
 *   unsafe       — hay clientes con identificacion que no empieza en '999'
 *   table_missing — b2c_cliente no existe aún (BD vacía — definitivamente staging)
 */
async function checkRealClients(conn) {
  try {
    const [[row]] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM b2c_cliente WHERE cli_identificacion NOT LIKE '999%'`
    );
    return row.cnt > 0 ? 'unsafe' : 'safe';
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return 'table_missing';
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bootstrap de esquema ERP (tablas que el servidor no crea via runMigrations)
// ═══════════════════════════════════════════════════════════════════════════════

async function ensureErpSchema(conn) {
  console.log('\n📐 Verificando/creando esquema ERP en staging...');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_usuario (
      uid_usuario     INT(11)      NOT NULL AUTO_INCREMENT PRIMARY KEY,
      usu_nombre      VARCHAR(150) NOT NULL,
      usu_login       VARCHAR(100) NOT NULL,
      usu_clave       VARCHAR(255) NOT NULL,
      usu_tipo        ENUM('A','F','T','C') NOT NULL DEFAULT 'F',
      usu_estado      ENUM('A','I')         NOT NULL DEFAULT 'A',
      tenant_id       INT          NOT NULL DEFAULT 1,
      pwd_must_change TINYINT(1)   NOT NULL DEFAULT 0,
      pwd_changed_at  DATETIME     NULL,
      UNIQUE KEY uq_login_tenant (usu_login, tenant_id),
      INDEX idx_usuario_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_cliente (
      uid_cliente       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uid_usuario       INT          NULL,
      cli_identificacion VARCHAR(30) NOT NULL,
      cli_razon_social  VARCHAR(150) NOT NULL,
      cli_direccion     VARCHAR(150) NULL,
      cli_telefono      VARCHAR(50)  NULL,
      cli_contacto      VARCHAR(100) NULL,
      cli_tel_contacto  VARCHAR(30)  NULL,
      cli_estado        ENUM('A','I') NOT NULL DEFAULT 'A',
      tenant_id         INT          NOT NULL DEFAULT 1,
      INDEX idx_cliente_tenant (tenant_id),
      INDEX idx_cliente_id     (cli_identificacion)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_herramienta (
      uid_herramienta         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uid_cliente             INT          NOT NULL,
      her_nombre              VARCHAR(150) NOT NULL,
      her_marca               VARCHAR(80)  NULL,
      her_serial              VARCHAR(80)  NULL,
      her_referencia          VARCHAR(80)  NULL,
      her_tipo_medicion       VARCHAR(80)  NULL,
      her_cantidad            INT          NOT NULL DEFAULT 1,
      her_ultima_medicion     VARCHAR(100) NULL,
      her_proximo_mantenimiento DATE       NULL,
      her_estado              ENUM('A','I') NOT NULL DEFAULT 'A',
      tenant_id               INT          NOT NULL DEFAULT 1,
      INDEX idx_her_cliente (uid_cliente),
      INDEX idx_her_tenant  (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_orden (
      uid_orden         INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ord_consecutivo   INT           NOT NULL DEFAULT 0,
      uid_cliente       INT           NOT NULL,
      ord_estado        VARCHAR(2)    NOT NULL DEFAULT 'A',
      ord_total         DECIMAL(14,2) NOT NULL DEFAULT 0,
      ord_impuestos     DECIMAL(14,2) NOT NULL DEFAULT 0,
      ord_valor_total   DECIMAL(14,2) NOT NULL DEFAULT 0,
      ord_fecha         VARCHAR(16)   NOT NULL,
      tenant_id         INT           NOT NULL DEFAULT 1,
      ord_tipo          VARCHAR(20)   NOT NULL DEFAULT 'normal',
      ord_factura       VARCHAR(255)  NULL,
      ord_garantia_vence DATE         NULL,
      ord_revision_limite DATE        NULL,
      INDEX idx_ord_tenant  (tenant_id),
      INDEX idx_ord_cliente (uid_cliente),
      INDEX idx_ord_consec  (ord_consecutivo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_herramienta_orden (
      uid_herramienta_orden INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uid_orden             INT           NOT NULL,
      uid_herramienta       INT           NOT NULL,
      hor_tiene_arreglo     TINYINT(1)    NOT NULL DEFAULT 0,
      hor_fecha_prom_entrega DATE         NULL,
      hor_fecha_real_entrega DATE         NULL,
      hor_aceptada_cliente  TINYINT(1)    NOT NULL DEFAULT 0,
      hor_fecha_aceptada    DATETIME      NULL,
      hor_observaciones     TEXT          NULL,
      hor_tecnico           INT           NULL,
      hor_cargo_tecnico     DECIMAL(14,2) NOT NULL DEFAULT 0,
      hor_proximo_mantenimiento DATE      NULL,
      her_estado            VARCHAR(32)   NOT NULL DEFAULT 'pendiente_revision',
      tenant_id             INT           NOT NULL DEFAULT 1,
      hor_es_garantia       TINYINT(1)    NOT NULL DEFAULT 0,
      hor_garantia_vence    DATE          NULL,
      hor_garantia_factura  VARCHAR(255)  NULL,
      hor_entrega_nombre    VARCHAR(150)  NULL,
      hor_entrega_cedula    VARCHAR(30)   NULL,
      hor_entrega_telefono  VARCHAR(20)   NULL,
      hor_entrega_firma     VARCHAR(255)  NULL,
      hor_entrega_fecha     DATETIME      NULL,
      INDEX idx_hor_orden  (uid_orden),
      INDEX idx_hor_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_concepto_costos (
      uid_concepto_costo INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
      cco_descripcion    VARCHAR(150)  NOT NULL,
      cco_valor          DECIMAL(12,2) NOT NULL DEFAULT 0,
      cco_tipo           VARCHAR(30)   NOT NULL DEFAULT 'repuesto',
      cco_estado         ENUM('A','I') NOT NULL DEFAULT 'A',
      tenant_id          INT           NOT NULL DEFAULT 1,
      cco_costo          DECIMAL(12,2) NOT NULL DEFAULT 0,
      cco_stock          INT           NOT NULL DEFAULT 0,
      INDEX idx_cco_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Tablas de cotización (normalmente creadas por runMigrations al arrancar el servidor,
  // pero las creamos aquí para que el seed sea autocontenido)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS b2c_cotizacion_maquina (
      uid_orden              VARCHAR(64) NOT NULL,
      uid_herramienta_orden  VARCHAR(64) NOT NULL,
      tecnico_id             VARCHAR(64) NULL,
      mano_obra              DECIMAL(14,2) NOT NULL DEFAULT 0,
      descripcion_trabajo    TEXT          NULL,
      subtotal               DECIMAL(14,2) NOT NULL DEFAULT 0,
      created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (uid_orden, uid_herramienta_orden)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('  ✅ Esquema ERP verificado/creado');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Datos de seed
// ═══════════════════════════════════════════════════════════════════════════════

const SEED_USUARIOS = [
  { login: 'admin_test', nombre: 'Admin de Prueba',        tipo: 'A', pass: 'Admin#Cst2026' },
  { login: 'fun_test',   nombre: 'Funcionario de Prueba',  tipo: 'F', pass: 'Fun#Cst2026'   },
  { login: 'tec_test',   nombre: 'Técnico de Prueba',      tipo: 'T', pass: 'Tec#Cst2026'   },
  // cliente_test se crea aparte porque necesita el uid de b2c_cliente
];

const SEED_CLIENTES = [
  { id: '99000001', nombre: 'FERRETERÍA EL TORNILLO',  tel: '3001112233', dir: 'Calle 10 # 5-23, Pereira'             },
  { id: '99000002', nombre: 'CONSTRUCTORA PRUEBAS SA', tel: '3004445566', dir: 'Av. 30 de Agosto # 40-10, Pereira'    },
  { id: '99000003', nombre: 'INDUSTRIAS TEST LTDA',    tel: '3007778899', dir: 'Zona Industrial Calle 6, Dosquebradas' },
  { id: '99000004', nombre: 'CLIENTE PORTAL TEST',     tel: '3009998877', dir: 'Carrera 8 # 20-15, Pereira',
    loginVinculado: 'cliente_test' },
];

const SEED_HERRAMIENTAS = [
  { serial: 'SEED-TAL-001', nombre: 'Taladro Percutor 1/2"',  marca: 'DeWalt',       clienteId: '99000001' },
  { serial: 'SEED-AMO-001', nombre: 'Amoladora Angular 7"',   marca: 'Bosch',        clienteId: '99000001' },
  { serial: 'SEED-SIE-001', nombre: 'Sierra Circular 7-1/4"', marca: 'Makita',       clienteId: '99000002' },
  { serial: 'SEED-COM-001', nombre: 'Compresor de Aire 24L',  marca: 'Black+Decker', clienteId: '99000003' },
];

const SEED_ORDENES = [
  {
    consec: 9001, clienteId: '99000001', fecha: '20260101',
    maquinas: [
      { serial: 'SEED-TAL-001', estado: 'revisada' },
      { serial: 'SEED-AMO-001', estado: 'cotizada', cotizacion: {
        manoObra: 45000,
        descripcion: 'Cambio de carbones y rodamiento — prueba [SEED]',
        subtotal: 45000,
      }},
    ],
  },
  {
    consec: 9002, clienteId: '99000002', fecha: '20260110',
    maquinas: [
      { serial: 'SEED-SIE-001', estado: 'reparada' },
    ],
  },
  {
    consec: 9003, clienteId: '99000003', fecha: '20260115',
    maquinas: [
      { serial: 'SEED-COM-001', estado: 'entregada', entrega: {
        nombre:   'Pedro Gómez Prueba',
        cedula:   '12345678',
        telefono: '3001234567',
        firma:    'firma-seed-placeholder.png',
        fecha:    new Date('2026-01-20 10:30:00'),
      }},
    ],
  },
];

const SEED_CONCEPTOS = [
  { desc: 'Mano de obra general [SEED]',      valor: 35000, costo: 0,     tipo: 'mano_obra', stock: 0  },
  { desc: 'Carbones de motor [SEED]',         valor: 18000, costo: 12000, tipo: 'repuesto',  stock: 10 },
  { desc: 'Rodamiento 6002 [SEED]',           valor: 22000, costo: 14000, tipo: 'repuesto',  stock: 8  },
  { desc: 'Interruptor universal [SEED]',     valor: 15000, costo: 9000,  tipo: 'repuesto',  stock: 15 },
  { desc: 'Cable eléctrico por metro [SEED]', valor:  4500, costo: 2500,  tipo: 'repuesto',  stock: 50 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers de búsqueda (lookup idempotente)
// ═══════════════════════════════════════════════════════════════════════════════

async function findClienteId(conn, identificacion) {
  const [[row]] = await conn.execute(
    `SELECT uid_cliente FROM b2c_cliente WHERE cli_identificacion = ? AND tenant_id = ?`,
    [identificacion, TENANT_ID]
  );
  return row?.uid_cliente ?? null;
}

async function findUsuarioId(conn, login) {
  const [[row]] = await conn.execute(
    `SELECT uid_usuario FROM b2c_usuario WHERE usu_login = ? AND tenant_id = ?`,
    [login, TENANT_ID]
  );
  return row?.uid_usuario ?? null;
}

async function findHerramientaId(conn, serial) {
  const [[row]] = await conn.execute(
    `SELECT uid_herramienta FROM b2c_herramienta WHERE her_serial = ? AND tenant_id = ?`,
    [serial, TENANT_ID]
  );
  return row?.uid_herramienta ?? null;
}

async function findOrdenId(conn, consecutivo) {
  const [[row]] = await conn.execute(
    `SELECT uid_orden FROM b2c_orden WHERE ord_consecutivo = ? AND tenant_id = ?`,
    [consecutivo, TENANT_ID]
  );
  return row?.uid_orden ?? null;
}

async function findHerOrdenId(conn, uidOrden, uidHerramienta) {
  const [[row]] = await conn.execute(
    `SELECT uid_herramienta_orden FROM b2c_herramienta_orden
     WHERE uid_orden = ? AND uid_herramienta = ? AND tenant_id = ?`,
    [uidOrden, uidHerramienta, TENANT_ID]
  );
  return row?.uid_herramienta_orden ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Funciones de siembra
// ═══════════════════════════════════════════════════════════════════════════════

async function seedUsuarios(conn) {
  console.log('\n👤 Sembrando usuarios...');
  for (const u of SEED_USUARIOS) {
    const hash = await bcrypt.hash(u.pass, BCRYPT_ROUNDS);
    await conn.execute(`
      INSERT IGNORE INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id)
      VALUES (?, ?, ?, ?, 'A', ?)
    `, [u.nombre, u.login, hash, u.tipo, TENANT_ID]);
    console.log(`  ✅ ${u.login} (${u.tipo})`);
  }
  // cliente_test — tipo C, clave = últimos 4 dígitos de 99000004
  const hashC = await bcrypt.hash('0004', BCRYPT_ROUNDS);
  await conn.execute(`
    INSERT IGNORE INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id)
    VALUES ('Cliente Portal Test', 'cliente_test', ?, 'C', 'A', ?)
  `, [hashC, TENANT_ID]);
  console.log('  ✅ cliente_test (C)  ← clave: 0004');
}

async function seedClientes(conn) {
  console.log('\n🏢 Sembrando clientes...');
  for (const c of SEED_CLIENTES) {
    const existing = await findClienteId(conn, c.id);
    if (existing) {
      console.log(`  ⏭ ${c.id} — ${c.nombre} ya existe`);
      continue;
    }

    let uidUsuario = null;
    if (c.loginVinculado) {
      uidUsuario = await findUsuarioId(conn, c.loginVinculado);
    }

    await conn.execute(`
      INSERT INTO b2c_cliente
        (uid_usuario, cli_identificacion, cli_razon_social, cli_telefono, cli_direccion, cli_estado, tenant_id)
      VALUES (?, ?, ?, ?, ?, 'A', ?)
    `, [uidUsuario, c.id, c.nombre, c.tel, c.dir, TENANT_ID]);
    console.log(`  ✅ ${c.id} — ${c.nombre}`);
  }
}

async function seedHerramientas(conn) {
  console.log('\n🔧 Sembrando herramientas...');
  for (const h of SEED_HERRAMIENTAS) {
    const existing = await findHerramientaId(conn, h.serial);
    if (existing) {
      console.log(`  ⏭ ${h.serial} ya existe`);
      continue;
    }
    const uidCliente = await findClienteId(conn, h.clienteId);
    if (!uidCliente) {
      console.warn(`  ⚠️ Cliente ${h.clienteId} no encontrado — saltando ${h.serial}`);
      continue;
    }
    await conn.execute(`
      INSERT INTO b2c_herramienta (uid_cliente, her_nombre, her_marca, her_serial, her_estado, tenant_id)
      VALUES (?, ?, ?, ?, 'A', ?)
    `, [uidCliente, h.nombre, h.marca, h.serial, TENANT_ID]);
    console.log(`  ✅ ${h.serial} — ${h.nombre} (${h.marca})`);
  }
}

async function seedOrdenes(conn) {
  console.log('\n📋 Sembrando órdenes...');
  for (const o of SEED_ORDENES) {
    const uidCliente = await findClienteId(conn, o.clienteId);
    if (!uidCliente) {
      console.warn(`  ⚠️ Cliente ${o.clienteId} no encontrado — saltando orden #${o.consec}`);
      continue;
    }

    let uidOrden = await findOrdenId(conn, o.consec);
    if (!uidOrden) {
      const [res] = await conn.execute(`
        INSERT INTO b2c_orden (ord_consecutivo, uid_cliente, ord_estado, ord_fecha, tenant_id)
        VALUES (?, ?, 'A', ?, ?)
      `, [o.consec, uidCliente, o.fecha, TENANT_ID]);
      uidOrden = res.insertId;
      console.log(`  ✅ Orden #${o.consec} (uid=${uidOrden})`);
    } else {
      console.log(`  ⏭ Orden #${o.consec} ya existe (uid=${uidOrden})`);
    }

    for (const m of o.maquinas) {
      const uidHer = await findHerramientaId(conn, m.serial);
      if (!uidHer) {
        console.warn(`    ⚠️ ${m.serial} no encontrada — saltando`);
        continue;
      }

      let uidHorId = await findHerOrdenId(conn, uidOrden, uidHer);
      if (!uidHorId) {
        const ent = m.entrega || {};
        const [res] = await conn.execute(`
          INSERT INTO b2c_herramienta_orden
            (uid_orden, uid_herramienta, her_estado, tenant_id,
             hor_entrega_nombre, hor_entrega_cedula, hor_entrega_telefono,
             hor_entrega_firma,  hor_entrega_fecha)
          VALUES (?, ?, ?, ?,  ?, ?, ?,  ?, ?)
        `, [
          uidOrden, uidHer, m.estado, TENANT_ID,
          ent.nombre   ?? null,
          ent.cedula   ?? null,
          ent.telefono ?? null,
          ent.firma    ?? null,
          ent.fecha    ?? null,
        ]);
        uidHorId = res.insertId;
        console.log(`    ✅ ${m.serial} → ${m.estado} (uid_hor=${uidHorId})`);
      } else {
        console.log(`    ⏭ ${m.serial} ya registrada en orden #${o.consec}`);
      }

      // Cotización para la máquina en estado "cotizada"
      if (m.cotizacion && uidHorId) {
        await conn.execute(`
          INSERT IGNORE INTO b2c_cotizacion_maquina
            (uid_orden, uid_herramienta_orden, mano_obra, descripcion_trabajo, subtotal)
          VALUES (?, ?, ?, ?, ?)
        `, [
          String(uidOrden), String(uidHorId),
          m.cotizacion.manoObra,
          m.cotizacion.descripcion,
          m.cotizacion.subtotal,
        ]);
        console.log(`    ✅ Cotización: $${m.cotizacion.subtotal.toLocaleString('es-CO')}`);
      }
    }
  }
}

async function seedConceptos(conn) {
  console.log('\n📦 Sembrando inventario (conceptos de costo)...');
  for (const c of SEED_CONCEPTOS) {
    const [[existing]] = await conn.execute(
      `SELECT uid_concepto_costo FROM b2c_concepto_costos WHERE cco_descripcion = ? AND tenant_id = ?`,
      [c.desc, TENANT_ID]
    );
    if (existing) {
      console.log(`  ⏭ "${c.desc}" ya existe`);
      continue;
    }
    await conn.execute(`
      INSERT INTO b2c_concepto_costos
        (cco_descripcion, cco_valor, cco_costo, cco_tipo, cco_stock, cco_estado, tenant_id)
      VALUES (?, ?, ?, ?, ?, 'A', ?)
    `, [c.desc, c.valor, c.costo, c.tipo, c.stock, TENANT_ID]);
    console.log(`  ✅ ${c.desc} — $${c.valor.toLocaleString('es-CO')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// --clean: elimina SOLO registros creados por este seed
// ═══════════════════════════════════════════════════════════════════════════════

async function cleanSeedData(conn) {
  console.log('\n🧹 --clean: eliminando registros de seed anteriores...');

  // Obtener uid_orden de las órdenes seed (para borrar cotizaciones y herramienta_orden)
  const seedConsecs = SEED_ORDENES.map(o => o.consec);
  let seedOrdenIds = [];
  if (seedConsecs.length) {
    const ph = seedConsecs.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT uid_orden FROM b2c_orden WHERE ord_consecutivo IN (${ph}) AND tenant_id = ?`,
      [...seedConsecs, TENANT_ID]
    );
    seedOrdenIds = rows.map(r => r.uid_orden);
  }

  // 1. Cotizaciones (borrar hijos antes que padres)
  for (const uid of seedOrdenIds) {
    const uidStr = String(uid);
    await conn.execute(`DELETE FROM b2c_cotizacion_item    WHERE uid_orden = ?`, [uidStr]).catch(() => {});
    await conn.execute(`DELETE FROM b2c_cotizacion_maquina WHERE uid_orden = ?`, [uidStr]).catch(() => {});
    await conn.execute(`DELETE FROM b2c_cotizacion_orden   WHERE uid_orden = ?`, [uidStr]).catch(() => {});
  }

  // 2. Herramienta_orden de las órdenes seed
  if (seedOrdenIds.length) {
    const ph = seedOrdenIds.map(() => '?').join(',');
    await conn.execute(
      `DELETE FROM b2c_herramienta_orden WHERE uid_orden IN (${ph}) AND tenant_id = ?`,
      [...seedOrdenIds, TENANT_ID]
    );
  }

  // 3. Órdenes seed
  if (seedConsecs.length) {
    const ph = seedConsecs.map(() => '?').join(',');
    await conn.execute(
      `DELETE FROM b2c_orden WHERE ord_consecutivo IN (${ph}) AND tenant_id = ?`,
      [...seedConsecs, TENANT_ID]
    );
  }

  // 4. Herramientas seed (por serial único)
  const seedSerials = SEED_HERRAMIENTAS.map(h => h.serial);
  if (seedSerials.length) {
    const ph = seedSerials.map(() => '?').join(',');
    await conn.execute(
      `DELETE FROM b2c_herramienta WHERE her_serial IN (${ph}) AND tenant_id = ?`,
      [...seedSerials, TENANT_ID]
    );
  }

  // 5. Clientes seed (identificacion prefijo '999')
  await conn.execute(
    `DELETE FROM b2c_cliente WHERE cli_identificacion LIKE '999%' AND tenant_id = ?`,
    [TENANT_ID]
  );

  // 6. Usuarios seed (logins terminados en _test)
  const seedLogins = [...SEED_USUARIOS.map(u => u.login), 'cliente_test'];
  const ph = seedLogins.map(() => '?').join(',');
  await conn.execute(
    `DELETE FROM b2c_usuario WHERE usu_login IN (${ph}) AND tenant_id = ?`,
    [...seedLogins, TENANT_ID]
  );

  // 7. Conceptos seed (marcados con [SEED] en descripción)
  await conn.execute(
    `DELETE FROM b2c_concepto_costos WHERE cco_descripcion LIKE '%[SEED]%' AND tenant_id = ?`,
    [TENANT_ID]
  );

  console.log('  ✅ Limpieza completada');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const argv    = process.argv.slice(2);
  const isClean = argv.includes('--clean');

  console.log('🌱  Script de siembra — Staging CST');
  console.log('━'.repeat(52));
  console.log(`   DB_HOST : ${process.env.DB_HOST ?? '(no definido)'}`);
  console.log(`   DB_NAME : ${process.env.DB_NAME ?? '(no definido)'}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV ?? '(no definido)'}`);
  console.log('━'.repeat(52));

  // ── Capa 1 ──────────────────────────────────────────────────────────────────
  if (!hasFlag(argv)) {
    console.error('\n❌ Capa 1 falló — flag requerido ausente.');
    console.error('   Este script solo corre en staging. Ejecuta:');
    console.error('   node scripts/seed-staging.js --staging-confirmed');
    process.exit(1);
  }
  console.log('\n✅ Capa 1: --staging-confirmed presente');

  // ── Capa 2 ──────────────────────────────────────────────────────────────────
  if (isProduction(process.env)) {
    console.error('\n❌ Capa 2 falló — NODE_ENV=production detectado.');
    console.error('   Aborting. Este script no debe ejecutarse en producción.');
    process.exit(1);
  }
  console.log('✅ Capa 2: NODE_ENV ≠ production');

  // ── Capa 3 ──────────────────────────────────────────────────────────────────
  const conn = await pool.getConnection();
  try {
    const capa3 = await checkRealClients(conn);
    if (capa3 === 'unsafe') {
      console.error('\n❌ Capa 3 falló — clientes reales detectados en b2c_cliente.');
      console.error('   Esta BD parece ser producción o contiene datos reales.');
      console.error('   Aborting. No se realizó ningún cambio.');
      process.exit(1);
    }
    const capa3msg = capa3 === 'table_missing'
      ? 'b2c_cliente no existe aún — BD vacía, definitivamente no es producción'
      : 'sin clientes reales detectados en b2c_cliente';
    console.log(`✅ Capa 3: ${capa3msg}`);

    console.log('\n🚀 Todas las capas superadas. Iniciando siembra...');
    console.log('━'.repeat(52));

    if (isClean) await cleanSeedData(conn);

    await ensureErpSchema(conn);
    await seedUsuarios(conn);
    await seedClientes(conn);
    await seedHerramientas(conn);
    await seedOrdenes(conn);
    await seedConceptos(conn);

    console.log('\n' + '━'.repeat(52));
    console.log('✅ Seed completado exitosamente.\n');
    console.log('Credenciales de prueba:');
    console.log('  admin_test    (A) — Admin#Cst2026');
    console.log('  fun_test      (F) — Fun#Cst2026');
    console.log('  tec_test      (T) — Tec#Cst2026');
    console.log('  cliente_test  (C) — 0004   (últimos 4 de 99000004)\n');
    console.log('Datos sembrados:');
    console.log('  Clientes    : FERRETERÍA EL TORNILLO, CONSTRUCTORA PRUEBAS SA,');
    console.log('                INDUSTRIAS TEST LTDA, CLIENTE PORTAL TEST');
    console.log('  Orden #9001 : Taladro (revisada) + Amoladora (cotizada) — Ferretería');
    console.log('  Orden #9002 : Sierra Circular (reparada) — Constructora');
    console.log('  Orden #9003 : Compresor (entregada con firma) — Industrias');
    console.log('  Inventario  : 5 conceptos de costo/repuesto');
  } finally {
    conn.release();
    process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports (para tests) y punto de entrada
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { hasFlag, isProduction, checkRealClients };

if (require.main === module) {
  main().catch(e => {
    console.error('\n💥 Error inesperado:', e.message || e);
    process.exit(1);
  });
}
