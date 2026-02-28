// Cache de columnas detectadas (vive mientras el proceso corra)
let HO_TECH_COL_CACHE = undefined; // undefined=no revisado, null=no existe, string=col
let USR_COLS_CACHE = undefined;    // cache esquema b2c_usuario
let TECH_FILTER_CACHE = undefined; // cache roles/status detectados

async function getHerramientaOrdenTechColumn(connection) {
  if (HO_TECH_COL_CACHE !== undefined) return HO_TECH_COL_CACHE;
  // Columna conocida del ERP — hardcodeada para evitar SHOW COLUMNS que crashea MariaDB 10.4 con tablas latin1
  HO_TECH_COL_CACHE = 'hor_tecnico';
  return HO_TECH_COL_CACHE;
}

async function getUsuarioColumns(connection) {
  if (USR_COLS_CACHE !== undefined) return USR_COLS_CACHE;
  // Columnas conocidas del ERP — hardcodeadas para evitar SHOW COLUMNS que crashea MariaDB 10.4 con tablas latin1
  USR_COLS_CACHE = {
    idCol:        'uid_usuario',
    nameCol:      'usu_nombre',
    firstNameCol: null,
    lastNameCol:  null,
    emailCol:     null,
    roleCol:      'usu_tipo',
    statusCol:    'usu_estado',
    all: ['uid_usuario','usu_nombre','usu_login','usu_clave','usu_tipo','usu_estado'],
  };
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
