'use strict';
// SEC-07: logAudit en ventas.js, financiero.js y contable.js usaba firma incorrecta.
// La firma correcta es logAudit(db, { tenantId, userId, accion, ... }) donde `db`
// es el pool mysql2 con .getConnection(). Las tres rutas la llamaban como
// logAudit(req, 'venta_creada', 'b2c_venta', id, detalle) — req no tiene getConnection()
// → TypeError capturado silenciosamente → el registro nunca llegaba a b2c_audit_log.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { logAudit } = require('../utils/audit');

function makeDb(onExecute) {
  return {
    getConnection: async () => ({
      execute: onExecute,
      release: () => {},
    }),
  };
}

describe('logAudit — firma correcta (db pool como primer arg)', () => {
  it('llama execute con INSERT y los parámetros correctos', async () => {
    let captured = null;
    const db = makeDb(async (sql, params) => {
      captured = { sql, params };
      return [{}];
    });

    await logAudit(db, {
      tenantId: 2,
      userId: 5,
      accion: 'venta_creada',
      entidad: 'b2c_venta',
      uidEntidad: '42',
      datosDespues: { ven_consecutivo: 7, ven_total: 50000 },
      ip: '10.0.0.1',
    });

    assert.ok(captured, 'execute nunca fue llamado');
    assert.ok(captured.sql.includes('INSERT INTO b2c_audit_log'));
    assert.strictEqual(captured.params[0], 2,             'tenant_id');
    assert.strictEqual(captured.params[1], 5,             'uid_usuario');
    assert.strictEqual(captured.params[2], 'venta_creada','accion');
    assert.strictEqual(captured.params[3], 'b2c_venta',  'entidad');
    assert.strictEqual(captured.params[4], '42',          'uid_entidad');
  });

  it('acepta userId null para acciones de sistema', async () => {
    let capturedParams = null;
    const db = makeDb(async (sql, params) => {
      capturedParams = params;
      return [{}];
    });
    await logAudit(db, {
      tenantId: 1,
      userId: null,
      accion: 'sistema',
      entidad: 'test',
      ip: '',
    });
    assert.strictEqual(capturedParams[1], null, 'userId null debe persistirse como null');
  });

  it('no propaga error si la BD falla — fire and forget', async () => {
    const db = makeDb(async () => { throw new Error('BD no disponible'); });
    await assert.doesNotReject(() =>
      logAudit(db, { tenantId: 1, userId: 1, accion: 'test', entidad: 'test', ip: '127.0.0.1' })
    );
  });

  it('serializa datosDespues como JSON en el INSERT', async () => {
    let capturedParams = null;
    const db = makeDb(async (sql, params) => {
      capturedParams = params;
      return [{}];
    });
    const detalle = { egr_concepto: 'Arriendo', egr_valor: 1200000 };
    await logAudit(db, {
      tenantId: 1, userId: 3, accion: 'egreso_creado',
      entidad: 'b2c_egreso', uidEntidad: '99',
      datosDespues: detalle, ip: '127.0.0.1',
    });
    assert.strictEqual(capturedParams[6], JSON.stringify(detalle));
  });
});

describe('logAudit — firma INCORRECTA (req como primer arg — bug SEC-07)', () => {
  it('falla silenciosamente: no propaga error aunque req.getConnection no exista', async () => {
    const req = { ip: '127.0.0.1', session: { user: { id: 1 } } };
    // Llamada incorrecta — nunca debe lanzar
    await assert.doesNotReject(() =>
      logAudit(req, 'venta_creada', 'b2c_venta', '42', { ven_total: 50000 })
    );
  });

  it('no persiste nada en la BD cuando se usa req como primer arg', async () => {
    let executeWasCalled = false;
    // req con execute adjunto para detectar si se llama
    const req = {
      ip: '127.0.0.1',
      session: { user: { id: 1 } },
      execute: async () => { executeWasCalled = true; },
    };
    await logAudit(req, 'venta_anulada', 'b2c_venta', '10', {}).catch(() => {});
    // logAudit llama req.getConnection() que no existe → TypeError → catch interno
    // execute nunca se alcanza
    assert.strictEqual(executeWasCalled, false,
      'El registro se pierde silenciosamente — el bug del original');
  });
});
