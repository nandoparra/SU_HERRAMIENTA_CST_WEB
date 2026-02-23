// Cache de columnas detectadas (vive mientras el proceso corra)
let HO_TECH_COL_CACHE = undefined; // undefined=no revisado, null=no existe, string=col
let USR_COLS_CACHE = undefined;    // cache esquema b2c_usuario
let TECH_FILTER_CACHE = undefined; // cache roles/status detectados

async function getHerramientaOrdenTechColumn(connection) {
  if (HO_TECH_COL_CACHE !== undefined) return HO_TECH_COL_CACHE;

  const [cols] = await connection.execute(`SHOW COLUMNS FROM b2c_herramienta_orden`);
  const names = cols.map((c) => c.Field);

  const candidates = [
    'uid_usuario_asignado',
    'uid_tecnico_asignado',
    'uid_usuario_tecnico',
    'uid_tecnico',
    'uid_usuario',
    'tecnico_id',
    'id_tecnico',
    'hor_tecnico',
  ];

  HO_TECH_COL_CACHE = candidates.find((c) => names.includes(c)) || null;
  return HO_TECH_COL_CACHE;
}

async function getUsuarioColumns(connection) {
  if (USR_COLS_CACHE !== undefined) return USR_COLS_CACHE;

  const [cols] = await connection.execute(`SHOW COLUMNS FROM b2c_usuario`);
  const names = cols.map((c) => c.Field);

  const pick = (candidates) => candidates.find((c) => names.includes(c)) || null;

  const idCol = pick(['uid_usuario', 'id_usuario', 'usuario_id', 'id']);
  const nameCol = pick(['usu_nombre', 'usr_nombre', 'usr_nombre_completo', 'nombre_completo', 'full_name', 'usr_name', 'name']);
  const firstNameCol = pick(['usr_nombres', 'nombres', 'nombre', 'first_name', 'firstname']);
  const lastNameCol = pick(['usr_apellidos', 'apellidos', 'last_name', 'lastname']);
  const emailCol = pick(['usu_email', 'usr_email', 'email', 'correo', 'mail', 'usr_correo']);
  const roleCol = pick(['usu_tipo', 'usr_rol', 'rol', 'role', 'perfil', 'tipo', 'usr_role']);
  const statusCol = pick(['usu_estado', 'usr_estado', 'estado', 'status', 'activo', 'habilitado', 'usr_status']);

  USR_COLS_CACHE = { idCol, nameCol, firstNameCol, lastNameCol, emailCol, roleCol, statusCol, all: names };
  return USR_COLS_CACHE;
}

function buildUserNameExpr(usrCols) {
  if (usrCols.nameCol) return `u.\`${usrCols.nameCol}\``;
  if (usrCols.firstNameCol && usrCols.lastNameCol) return `TRIM(CONCAT(u.\`${usrCols.firstNameCol}\`,' ',u.\`${usrCols.lastNameCol}\`))`;
  if (usrCols.firstNameCol) return `u.\`${usrCols.firstNameCol}\``;
  if (usrCols.idCol) return `CAST(u.\`${usrCols.idCol}\` AS CHAR)`;
  return `''`;
}

async function getTechnicianWhereClause(connection, usrCols) {
  if (TECH_FILTER_CACHE) return TECH_FILTER_CACHE;

  const where = [];
  const params = [];

  if (usrCols.statusCol) {
    where.push(`LOWER(CAST(u.\`${usrCols.statusCol}\` AS CHAR)) IN ('a','activo','1','true','s','si')`);
  }

  if (usrCols.roleCol) {
    const [roles] = await connection.execute(
      `SELECT DISTINCT LOWER(CAST(\`${usrCols.roleCol}\` AS CHAR)) AS r FROM b2c_usuario WHERE \`${usrCols.roleCol}\` IS NOT NULL LIMIT 200`
    );
    const match = roles
      .map(x => (x && x.r ? String(x.r).trim() : ''))
      .filter(Boolean)
      .filter(r => r.includes('tecn') || r === 't');

    if (match.length === 0) {
      TECH_FILTER_CACHE = { whereSql: 'WHERE 1=0', warning: 'No se pudo detectar el rol de técnicos en b2c_usuario.' };
      return TECH_FILTER_CACHE;
    }

    const placeholders = match.map(() => '?').join(',');
    where.push(`LOWER(CAST(u.\`${usrCols.roleCol}\` AS CHAR)) IN (${placeholders})`);
    params.push(...match);
  } else {
    TECH_FILTER_CACHE = { whereSql: 'WHERE 1=0', warning: 'No existe columna de rol en b2c_usuario; no se pueden filtrar técnicos.' };
    return TECH_FILTER_CACHE;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  TECH_FILTER_CACHE = { whereSql, params, warning: null };
  return TECH_FILTER_CACHE;
}

async function resolveOrder(connection, orderKeyRaw) {
  const orderKey = String(orderKeyRaw || '').trim();
  if (!orderKey) return null;
  const isNum = /^\d+$/.test(orderKey);

  // 1) uid_orden
  {
    const [rows] = await connection.execute(
      `
      SELECT
        o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
        c.uid_cliente, c.cli_identificacion, c.cli_razon_social,
        c.cli_telefono, c.cli_contacto, c.cli_direccion
      FROM b2c_orden o
      JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
      WHERE o.uid_orden = ?
      LIMIT 1
      `,
      [orderKey]
    );
    if (rows.length) return rows[0];
  }

  // 2) consecutivo exacto como texto
  if (isNum) {
    const [rows] = await connection.execute(
      `
      SELECT
        o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
        c.uid_cliente, c.cli_identificacion, c.cli_razon_social,
        c.cli_telefono, c.cli_contacto, c.cli_direccion
      FROM b2c_orden o
      JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
      WHERE CAST(o.ord_consecutivo AS CHAR) = ?
      LIMIT 1
      `,
      [orderKey]
    );
    if (rows.length) return rows[0];
  }

  // 3) consecutivo LIKE
  if (isNum) {
    const [rows] = await connection.execute(
      `
      SELECT
        o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
        c.uid_cliente, c.cli_identificacion, c.cli_razon_social,
        c.cli_telefono, c.cli_contacto, c.cli_direccion
      FROM b2c_orden o
      JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
      WHERE CAST(o.ord_consecutivo AS CHAR) LIKE ?
      ORDER BY o.ord_fecha DESC
      LIMIT 1
      `,
      [`%${orderKey}%`]
    );
    if (rows.length) return rows[0];
  }

  return null;
}

module.exports = {
  getHerramientaOrdenTechColumn,
  getUsuarioColumns,
  buildUserNameExpr,
  getTechnicianWhereClause,
  resolveOrder,
};
