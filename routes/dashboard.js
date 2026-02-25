const express = require('express');
const router  = express.Router();
const db      = require('../utils/db');
const bcrypt  = require('bcrypt');
const { requireInterno } = require('../middleware/auth');

router.use((req, res, next) => {
  if (req.path === '/cliente/mis-ordenes' || req.path.startsWith('/cliente/informe/')) return next('router');
  return requireInterno(req, res, next);
});

// ── Dashboard KPIs ─────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const raw = String(req.query.mes || '');
    const now  = new Date();
    const year  = raw.slice(0, 4)  || String(now.getFullYear());
    const month = raw.slice(5, 7)  || String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}${month}`;

    const conn = await db.getConnection();

    const [[totalRow]] = await conn.execute(
      `SELECT COUNT(*) AS total FROM b2c_orden WHERE ord_fecha LIKE ?`,
      [`${prefix}%`]
    );

    const [estadoRows] = await conn.execute(
      `SELECT COALESCE(ho.her_estado,'pendiente_revision') AS estado, COUNT(*) AS cant
       FROM b2c_herramienta_orden ho
       JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
       WHERE o.ord_fecha LIKE ?
       GROUP BY ho.her_estado`,
      [`${prefix}%`]
    );
    const em = {};
    estadoRows.forEach(r => { em[r.estado] = Number(r.cant); });

    const [reparadas] = await conn.execute(`
      SELECT ho.uid_herramienta_orden, ho.uid_orden,
             o.ord_consecutivo, o.ord_fecha,
             COALESCE(c.cli_razon_social, c.cli_contacto, '') AS cliente,
             h.her_nombre, h.her_marca
      FROM b2c_herramienta_orden ho
      JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
      JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
      JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
      WHERE ho.her_estado = 'reparada'
      ORDER BY o.ord_fecha ASC
    `);

    const [revisadasSinCotizar] = await conn.execute(`
      SELECT ho.uid_herramienta_orden, ho.uid_orden,
             o.ord_consecutivo, o.ord_fecha,
             COALESCE(c.cli_razon_social, c.cli_contacto, '') AS cliente,
             h.her_nombre, h.her_marca
      FROM b2c_herramienta_orden ho
      JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
      JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
      JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
      LEFT JOIN b2c_cotizacion_maquina cm ON cm.uid_herramienta_orden = ho.uid_herramienta_orden
      WHERE ho.her_estado = 'revisada'
        AND cm.uid_herramienta_orden IS NULL
      ORDER BY o.ord_fecha ASC
    `);

    const hoy = Date.now();
    const alertas = reparadas.map(r => {
      const s = String(r.ord_fecha);
      const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      const ms = m ? new Date(`${m[1]}-${m[2]}-${m[3]}`).getTime() : hoy;
      const dias = Math.floor((hoy - ms) / 86400000);
      return {
        uid_herramienta_orden: r.uid_herramienta_orden,
        uid_orden:             r.uid_orden,
        ord_consecutivo:       r.ord_consecutivo,
        cliente:               r.cliente,
        her_nombre:            r.her_nombre,
        her_marca:             r.her_marca,
        dias,
        rango: dias >= 30 ? 'rojo' : dias >= 15 ? 'naranja' : 'amarillo',
      };
    });

    conn.release();
    res.json({
      mes: `${year}-${month}`,
      kpis: {
        total_ordenes:      Number(totalRow.total),
        pendiente_revision: em['pendiente_revision'] || 0,
        revisadas:          em['revisada']            || 0,
        cotizadas:          em['cotizada']            || 0,
        autorizadas:        em['autorizada']          || 0,
        no_autorizadas:     em['no_autorizada']       || 0,
        reparadas:          em['reparada']            || 0,
        entregadas:         em['entregada']           || 0,
      },
      alertas,
      revisadasSinCotizar,
    });
  } catch (e) {
    console.error('Error /api/dashboard:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Clientes ───────────────────────────────────────────────────────────────────
router.get('/clientes/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const like   = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const conn   = await db.getConnection();
    const params = digits
      ? [like, like, like, `%${digits}%`]
      : [like, like, like];
    const [rows] = await conn.execute(
      `SELECT c.uid_cliente, c.cli_razon_social, c.cli_identificacion,
              c.cli_telefono, c.cli_contacto, c.cli_estado,
              COUNT(o.uid_orden) AS total_ordenes
       FROM b2c_cliente c
       LEFT JOIN b2c_orden o ON o.uid_cliente = c.uid_cliente
       WHERE c.cli_razon_social  LIKE ?
          OR c.cli_identificacion LIKE ?
          OR c.cli_contacto       LIKE ?
          ${digits ? 'OR c.cli_telefono LIKE ?' : ''}
       GROUP BY c.uid_cliente
       ORDER BY c.cli_razon_social
       LIMIT 30`,
      params
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/clientes/:id', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const [[cliente]] = await conn.execute(
      `SELECT c.*, u.usu_login
       FROM b2c_cliente c
       LEFT JOIN b2c_usuario u ON u.uid_usuario = c.uid_usuario
       WHERE c.uid_cliente = ?`,
      [req.params.id]
    );
    if (!cliente) { conn.release(); return res.status(404).json({ error: 'No encontrado' }); }
    const [ordenes] = await conn.execute(
      `SELECT uid_orden, ord_consecutivo, ord_fecha, ord_estado
       FROM b2c_orden WHERE uid_cliente = ?
       ORDER BY ord_fecha DESC LIMIT 50`,
      [cliente.uid_cliente]
    );
    conn.release();
    res.json({ cliente, ordenes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/clientes/:id/crear-acceso', async (req, res) => {
  if (req.session?.user?.tipo !== 'A')
    return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { login, clave } = req.body;
    if (!login || !clave)
      return res.status(400).json({ error: 'Login y clave son requeridos' });
    const conn = await db.getConnection();
    const [[c]] = await conn.execute(
      `SELECT uid_cliente, cli_razon_social, uid_usuario FROM b2c_cliente WHERE uid_cliente = ?`,
      [req.params.id]
    );
    if (!c) { conn.release(); return res.status(404).json({ error: 'Cliente no encontrado' }); }
    if (c.uid_usuario) { conn.release(); return res.status(400).json({ error: 'Este cliente ya tiene acceso creado' }); }
    const hash = await bcrypt.hash(String(clave), 10);
    const [uRes] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado)
       VALUES (?, ?, ?, 'C', 'A')`,
      [c.cli_razon_social, login, hash]
    );
    await conn.execute(
      `UPDATE b2c_cliente SET uid_usuario = ? WHERE uid_cliente = ?`,
      [uRes.insertId, req.params.id]
    );
    conn.release();
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ error: 'Ese login ya está en uso' });
    res.status(500).json({ error: e.message });
  }
});

// ── Funcionarios ───────────────────────────────────────────────────────────────
router.get('/funcionarios', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT uid_usuario, usu_nombre, usu_login, usu_tipo, usu_estado
       FROM b2c_usuario
       WHERE usu_tipo IN ('A','F','T')
       ORDER BY usu_tipo, usu_nombre`
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/funcionarios', async (req, res) => {
  if (req.session?.user?.tipo !== 'A')
    return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { nombre, login, clave, tipo } = req.body;
    if (!nombre || !login || !clave || !['A','F','T'].includes(tipo))
      return res.status(400).json({ error: 'Datos incompletos o tipo inválido' });
    const hash = await bcrypt.hash(String(clave), 10);
    const conn = await db.getConnection();
    const [r] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado)
       VALUES (?, ?, ?, ?, 'A')`,
      [nombre, login, hash, tipo]
    );
    conn.release();
    res.json({ success: true, uid_usuario: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ error: 'El login ya existe' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/funcionarios/:id', async (req, res) => {
  if (req.session?.user?.tipo !== 'A')
    return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { nombre, tipo, estado, clave } = req.body;
    const sets = []; const params = [];
    if (nombre) { sets.push('usu_nombre = ?'); params.push(nombre); }
    if (tipo   && ['A','F','T'].includes(tipo))  { sets.push('usu_tipo = ?');   params.push(tipo); }
    if (estado && ['A','I'].includes(estado))     { sets.push('usu_estado = ?'); params.push(estado); }
    if (clave)  { const h = await bcrypt.hash(String(clave), 10); sets.push('usu_clave = ?'); params.push(h); }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const conn = await db.getConnection();
    await conn.execute(`UPDATE b2c_usuario SET ${sets.join(', ')} WHERE uid_usuario = ?`, params);
    conn.release();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Inventario ─────────────────────────────────────────────────────────────────
router.get('/inventario', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT uid_concepto_costo, cco_descripcion, cco_valor, cco_tipo, cco_estado
       FROM b2c_concepto_costos
       ORDER BY cco_tipo, cco_descripcion`
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/inventario', async (req, res) => {
  if (req.session?.user?.tipo !== 'A')
    return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { descripcion, valor, tipo } = req.body;
    if (!descripcion || !tipo)
      return res.status(400).json({ error: 'Descripción y tipo son requeridos' });
    const conn = await db.getConnection();
    const [r] = await conn.execute(
      `INSERT INTO b2c_concepto_costos (cco_descripcion, cco_valor, cco_tipo, cco_estado)
       VALUES (?, ?, ?, 'A')`,
      [descripcion, Number(valor) || 0, tipo]
    );
    conn.release();
    res.json({ success: true, uid_concepto_costo: r.insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/inventario/:id', async (req, res) => {
  if (req.session?.user?.tipo !== 'A')
    return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { descripcion, valor, estado } = req.body;
    const sets = []; const params = [];
    if (descripcion)        { sets.push('cco_descripcion = ?'); params.push(descripcion); }
    if (valor !== undefined){ sets.push('cco_valor = ?');       params.push(Number(valor) || 0); }
    if (estado && ['A','I'].includes(estado)) { sets.push('cco_estado = ?'); params.push(estado); }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const conn = await db.getConnection();
    await conn.execute(`UPDATE b2c_concepto_costos SET ${sets.join(', ')} WHERE uid_concepto_costo = ?`, params);
    conn.release();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
