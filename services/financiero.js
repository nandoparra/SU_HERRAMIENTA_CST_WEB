'use strict';

/**
 * Función 1 — calcularRentabilidad
 *
 * @param {object} params
 * @param {number}   params.manoObra        — mano de obra explícita si no viene como ítem
 * @param {Array}    params.items           — b2c_venta_item rows
 * @param {object}   params.configFinanciera — fila activa de b2c_config_financiera
 * @returns {object} campos financieros calculados
 */
function calcularRentabilidad({ manoObra = 0, items = [], configFinanciera }) {
  const cfg = configFinanciera || {};
  const utilidadObjetivoMin = Number(cfg.cf_utilidad_objetivo_min ?? 60000);
  const utilidadObjetivoOpt = Number(cfg.cf_utilidad_objetivo_opt ?? 85000);

  const itemsRepuestos = items.filter(i => i.vi_tipo !== 'mano_obra');
  const itemsManoObra  = items.filter(i => i.vi_tipo === 'mano_obra');

  const totalRepuestosVenta = itemsRepuestos.reduce(
    (s, i) => s + Number(i.vi_precio_unitario) * Number(i.vi_cantidad), 0
  );
  const totalRepuestosCosto = itemsRepuestos.reduce(
    (s, i) => s + Number(i.vi_costo_unitario)  * Number(i.vi_cantidad), 0
  );
  const manoObraTotal = itemsManoObra.length
    ? itemsManoObra.reduce((s, i) => s + Number(i.vi_precio_unitario) * Number(i.vi_cantidad), 0)
    : Number(manoObra);

  const utilidadRepuestos = totalRepuestosVenta - totalRepuestosCosto;
  const margenRepuestos   = totalRepuestosVenta > 0
    ? utilidadRepuestos / totalRepuestosVenta : 0;

  const utilidadTotal = manoObraTotal + utilidadRepuestos;
  const baseTotal     = manoObraTotal + totalRepuestosVenta;
  const margenTotal   = baseTotal > 0 ? utilidadTotal / baseTotal : 0;

  const esRentable         = utilidadTotal >= utilidadObjetivoMin;
  const diferenciaUtilidad = utilidadTotal - utilidadObjetivoMin;

  return {
    ven_mano_obra:           round2(manoObraTotal),
    ven_costo_repuestos:     round2(totalRepuestosCosto),
    ven_utilidad_repuestos:  round2(utilidadRepuestos),
    ven_margen_repuestos:    round4(margenRepuestos),
    ven_utilidad_total:      round2(utilidadTotal),
    ven_margen_total:        round4(margenTotal),
    ven_es_rentable:         esRentable ? 1 : 0,
    ven_utilidad_objetivo:   round2(utilidadObjetivoMin),
    ven_diferencia_utilidad: round2(diferenciaUtilidad),
    // extras para UI
    _utilidad_objetivo_opt:  round2(utilidadObjetivoOpt),
    _total_repuestos_venta:  round2(totalRepuestosVenta),
  };
}

/**
 * Función 2 — generarSugerencias
 *
 * @param {object} resultado  — retorno de calcularRentabilidad
 * @param {object} config     — fila activa de b2c_config_financiera
 * @returns {string[]} array de sugerencias (vacío si es rentable)
 */
function generarSugerencias({ resultado, config }) {
  const cfg = config || {};
  if (resultado.ven_es_rentable) return [];

  const faltante        = Math.abs(resultado.ven_diferencia_utilidad);
  const margenObj       = Number(cfg.cf_margen_objetivo_rep ?? 0.5);
  const sugerencias     = [];

  sugerencias.push(
    `Aumentar mano de obra en ${cop(faltante)} para alcanzar el objetivo`
  );

  if (resultado._total_repuestos_venta > 0) {
    const costoRep  = resultado.ven_costo_repuestos;
    const precioMin = costoRep > 0 ? round2(costoRep / (1 - margenObj)) : null;
    if (precioMin) {
      sugerencias.push(
        `Precio mínimo de repuestos para margen ${pct(margenObj)}: ${cop(precioMin)}`
      );
    }
    sugerencias.push(
      `Margen actual en repuestos: ${pct(resultado.ven_margen_repuestos)} (objetivo: ${pct(margenObj)})`
    );
  }

  const precioTotalMin = round2(
    resultado.ven_mano_obra +
    (resultado.ven_costo_repuestos > 0
      ? resultado.ven_costo_repuestos / (1 - margenObj)
      : 0) +
    faltante
  );
  sugerencias.push(
    `Con los costos actuales, precio total mínimo recomendado: ${cop(precioTotalMin)}`
  );

  return sugerencias;
}

/**
 * Función 3 — calcularDashboardMensual
 *
 * @param {object} params
 * @param {number}   params.tenantId
 * @param {string}   params.mes       — 'YYYY-MM'
 * @param {object}   params.conn      — conexión mysql2 activa
 * @returns {object} métricas del mes
 */
async function calcularDashboardMensual({ tenantId, mes, conn }) {
  const [year, month] = mes.split('-').map(Number);
  const fechaInicio   = `${mes}-01`;
  const diasDelMes    = new Date(year, month, 0).getDate();
  const hoy           = new Date();
  const diasTranscurridos = (hoy.getFullYear() === year && hoy.getMonth() + 1 === month)
    ? hoy.getDate()
    : diasDelMes;

  // Config activa
  const [[cfg]] = await conn.execute(
    `SELECT * FROM b2c_config_financiera
     WHERE tenant_id = ? AND cf_vigente_hasta IS NULL
     ORDER BY cf_vigente_desde DESC LIMIT 1`,
    [tenantId]
  );
  const metaTotalMes = Number(cfg?.cf_meta_total_mes ?? 13900000);

  // Ventas del mes (solo pagadas o abiertas, no anuladas)
  const [ventas] = await conn.execute(
    `SELECT ven_fecha, ven_utilidad_total, ven_es_rentable,
            ven_mano_obra, ven_costo_repuestos, ven_utilidad_repuestos,
            ven_margen_repuestos, ven_total
     FROM b2c_venta
     WHERE tenant_id = ?
       AND ven_fecha >= ?
       AND ven_fecha <= LAST_DAY(?)
       AND ven_estado != 'anulada'`,
    [tenantId, fechaInicio, fechaInicio]
  );

  const utilidadAcumulada    = ventas.reduce((s, v) => s + Number(v.ven_utilidad_total), 0);
  const ventasRentables      = ventas.filter(v => v.ven_es_rentable).length;
  const ventasNoRentables    = ventas.length - ventasRentables;
  const utilidadPromedio     = ventas.length ? utilidadAcumulada / ventas.length : 0;
  const margenPromedioRep    = ventas.length
    ? ventas.reduce((s, v) => s + Number(v.ven_margen_repuestos), 0) / ventas.length : 0;
  const ventasManoObraTotal  = ventas.reduce((s, v) => s + Number(v.ven_mano_obra), 0);
  const ventasRepuestosTotal = ventas.reduce((s, v) => s + Number(v.ven_total) - Number(v.ven_mano_obra), 0);
  const costoRepuestosTotal  = ventas.reduce((s, v) => s + Number(v.ven_costo_repuestos), 0);

  const cumplimientoMetaPct  = metaTotalMes > 0 ? utilidadAcumulada / metaTotalMes : 0;
  const faltanteParaMeta     = Math.max(0, metaTotalMes - utilidadAcumulada);
  const proyeccionFinMes     = diasTranscurridos > 0
    ? (utilidadAcumulada / diasTranscurridos) * diasDelMes : 0;

  // Utilidad por día (agrupada)
  const porDia = {};
  for (const v of ventas) {
    const dia = String(v.ven_fecha).slice(0, 10);
    porDia[dia] = (porDia[dia] || 0) + Number(v.ven_utilidad_total);
  }
  const utilidadPorDia = Object.entries(porDia)
    .map(([dia, utilidad]) => ({ dia, utilidad: round2(utilidad) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  return {
    utilidad_acumulada:        round2(utilidadAcumulada),
    utilidad_por_dia:          utilidadPorDia,
    ventas_rentables:          ventasRentables,
    ventas_no_rentables:       ventasNoRentables,
    total_ventas:              ventas.length,
    utilidad_promedio:         round2(utilidadPromedio),
    margen_promedio_repuestos: round4(margenPromedioRep),
    ventas_mano_obra_total:    round2(ventasManoObraTotal),
    ventas_repuestos_total:    round2(ventasRepuestosTotal),
    costo_repuestos_total:     round2(costoRepuestosTotal),
    cumplimiento_meta_pct:     round4(cumplimientoMetaPct),
    faltante_para_meta:        round2(faltanteParaMeta),
    proyeccion_fin_mes:        round2(proyeccionFinMes),
    meta_total_mes:            round2(metaTotalMes),
    dias_transcurridos:        diasTranscurridos,
    dias_del_mes:              diasDelMes,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function round2(n) { return Math.round(Number(n) * 100) / 100; }
function round4(n) { return Math.round(Number(n) * 10000) / 10000; }
function cop(n)    { return '$' + Math.round(n).toLocaleString('es-CO'); }
function pct(n)    { return (Number(n) * 100).toFixed(1) + '%'; }

module.exports = { calcularRentabilidad, generarSugerencias, calcularDashboardMensual };
