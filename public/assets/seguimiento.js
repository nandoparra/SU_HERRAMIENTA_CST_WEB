const API = '/api';

const ESTADOS = {
  pendiente_revision: { label: 'Pendiente de revisión', color: '#888' },
  revisada:           { label: 'Revisada',              color: '#2196F3' },
  cotizada:           { label: 'Cotizada',              color: '#FF9800' },
  autorizada:         { label: 'Autorizada',            color: '#4CAF50' },
  no_autorizada:      { label: 'No autorizada',         color: '#F44336' },
  reparada:           { label: 'Reparada',              color: '#9C27B0' },
  entregada:          { label: 'Entregada',             color: '#009688' },
};

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtFecha(raw) {
  if (!raw) return '-';
  const s = String(raw);
  const m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return `${m8[3]}/${m8[2]}/${m8[1]}`;
  const miso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (miso) return `${miso[3]}/${miso[2]}/${miso[1]}`;
  return '-';
}

function fmtDatetime(raw) {
  if (!raw) return '-';
  const d = new Date(raw);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtCop(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

function toggleMaq(el) {
  el.closest('.maq-item').classList.toggle('open');
}

function buildMaqHtml(m, maqIdx) {
  const est = ESTADOS[m.her_estado] || ESTADOS.pendiente_revision;
  const badgeClass = 'estado-badge eb-' + (m.her_estado || 'pendiente_revision');

  // Aviso cotización pendiente + botones de autorización
  const avisoHtml = (m.her_estado === 'cotizada' && m.cotizacion) ? `
    <div class="cot-aviso">
      <span class="cot-aviso-txt">⚠️ Tiene una cotización pendiente de autorizar</span>
      <button class="btn-ver-cot" onclick="document.getElementById('cot-${maqIdx}').scrollIntoView({behavior:'smooth',block:'nearest'})">Ver cotización ↓</button>
    </div>` : '';

  const authHtml = (m.her_estado === 'cotizada') ? `
    <div class="auth-actions">
      <button class="btn-autorizar" onclick="seg_autorizar(${m.uid_herramienta_orden}, 'autorizada', this)">
        ✅ Autorizar reparación
      </button>
      <button class="btn-no-autorizar" onclick="seg_autorizar(${m.uid_herramienta_orden}, 'no_autorizada', this)">
        ❌ No autorizar
      </button>
    </div>` : '';

  // Fecha estimada de entrega
  const fechaEnt = m.hor_fecha_prom_entrega
    ? `<div class="sec-block"><div class="sec-lbl">Fecha estimada de entrega</div>
       <div style="font-size:13px;font-weight:600;color:#1d6a3a;">${fmtFecha(m.hor_fecha_prom_entrega)}</div></div>`
    : '';

  // Observaciones
  const obsHtml = m.hor_observaciones ? `
    <div class="sec-block">
      <div class="sec-lbl">Observaciones del técnico</div>
      <div class="obs-text">${esc(m.hor_observaciones)}</div>
    </div>` : '';

  // Historial de estados
  let histHtml = '';
  if (m.historial && m.historial.length) {
    const rows = m.historial.map(h => {
      const est2 = ESTADOS[h.estado] || ESTADOS.pendiente_revision;
      return `<div class="tl-row">
        <div class="tl-dot" style="background:${est2.color}"></div>
        <div class="tl-info">
          <span class="tl-estado">${esc(est2.label)}</span>
          <span class="tl-fecha">${fmtDatetime(h.changed_at)}</span>
        </div>
      </div>`;
    }).join('');
    histHtml = `<div class="sec-block">
      <div class="sec-lbl">Historial de estados</div>
      <div class="timeline">${rows}</div>
    </div>`;
  }

  // Informe de mantenimiento
  const informeHtml = m.informe ? `
    <div class="sec-block">
      <div class="sec-lbl">Informe de mantenimiento</div>
      <button class="btn-informe" onclick="seg_descargarInforme(${m.uid_herramienta_orden})">
        📄 Descargar informe PDF
      </button>
    </div>` : '';

  // Cotización
  let cotHtml = '';
  if (m.cotizacion) {
    const manoObra = Number(m.cotizacion.mano_obra || 0);
    let totalRepuestos = 0;
    let itemRows = '';
    (m.items || []).forEach(it => {
      totalRepuestos += Number(it.subtotal || 0);
      itemRows += `<tr>
        <td class="td-lbl">${esc(it.nombre)} <span style="color:#aaa">(x${it.cantidad})</span></td>
        <td class="td-num">${fmtCop(it.subtotal)}</td>
      </tr>`;
    });
    const total = manoObra + totalRepuestos;
    const descHtml = m.cotizacion.descripcion_trabajo
      ? `<div class="cot-desc">${esc(m.cotizacion.descripcion_trabajo)}</div>` : '';

    cotHtml = `<div class="sec-block" id="cot-${maqIdx}">
      <div class="sec-lbl">Cotización</div>
      ${descHtml}
      <table class="cot-table">
        <tr>
          <td class="td-lbl">Mano de obra</td>
          <td class="td-num">${fmtCop(manoObra)}</td>
        </tr>
        ${itemRows}
        <tr class="cot-sep cot-total">
          <td>Total</td>
          <td class="td-num">${fmtCop(total)}</td>
        </tr>
      </table>
    </div>`;
  } else if (m.her_estado !== 'pendiente_revision') {
    cotHtml = `<div class="sec-block" id="cot-${maqIdx}">
      <div class="sec-lbl">Cotización</div>
      <div class="no-cot">Aún no disponible</div>
    </div>`;
  }

  const serial = m.her_serial ? `S/N: ${esc(m.her_serial)}` : '';
  const marca  = m.her_marca  ? esc(m.her_marca) : '';
  const sub    = [marca, serial].filter(Boolean).join(' · ');

  return `
    <div class="maq-item" id="maqitem-${maqIdx}">
      <div class="maq-header" onclick="toggleMaq(this)">
        <div class="maq-info">
          <div class="maq-nombre">${esc(m.her_nombre || '-')}</div>
          ${sub ? `<div class="maq-serial">${sub}</div>` : ''}
        </div>
        <div class="maq-right">
          <span class="${badgeClass}">${esc(est.label)}</span>
          <span class="maq-chevron">▼</span>
        </div>
      </div>
      <div class="maq-body">
        ${avisoHtml}
        ${authHtml}
        ${fechaEnt}
        ${obsHtml}
        ${histHtml}
        ${informeHtml}
        ${cotHtml}
      </div>
    </div>`;
}

async function loadOrdenes() {
  const data = await fetch(`${API}/cliente/mis-ordenes`).then(r => r.json()).catch(() => []);
  window._ordenesData = data;
  const el = document.getElementById('ordenesList');
  if (!data.length) {
    el.innerHTML = '<div class="empty">No tienes órdenes de servicio registradas.</div>';
    return;
  }
  let maqCounter = 0;
  el.innerHTML = data.map(orden => {
    const fechasEnt = (orden.maquinas || [])
      .filter(m => m.hor_fecha_prom_entrega && m.her_estado !== 'entregada')
      .map(m => m.hor_fecha_prom_entrega).sort();
    const fechaEntBadge = fechasEnt.length
      ? `<span class="orden-entrega">📅 Entrega est. ${fmtFecha(fechasEnt[0])}</span>` : '';
    const tieneCotizadas = (orden.maquinas || []).some(m => m.her_estado === 'cotizada');
    const autorizarTodasHtml = tieneCotizadas ? `
      <div class="auth-global">
        <button class="btn-autorizar-todas"
          onclick="seg_autorizarTodas(${orden.uid_orden}, this)">
          ✅ Autorizar todas las máquinas cotizadas de esta orden
        </button>
      </div>` : '';
    const maquinasHtml = (orden.maquinas || []).map(m => buildMaqHtml(m, maqCounter++)).join('');
    return `<div class="orden-card">
      <div class="orden-header">
        <span class="orden-num">Orden #${orden.ord_consecutivo}</span>
        <span class="orden-meta">Ingreso: ${fmtFecha(orden.ord_fecha)}</span>
        ${fechaEntBadge}
        ${autorizarTodasHtml}
      </div>
      ${maquinasHtml || '<div style="padding:12px 18px;font-size:13px;color:#aaa;">Sin equipos registrados</div>'}
    </div>`;
  }).join('');
  document.querySelectorAll('.maq-item').forEach(item => {
    if (item.querySelector('.cot-aviso')) item.classList.add('open');
  });
}

async function seg_descargarInforme(uid) {
  const r = await fetch(`/api/cliente/informe/${uid}`);
  if (!r.ok) {
    alert('El informe aún no está disponible. Por favor consulte con el taller.');
    return;
  }
  const blob = await r.blob();
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

async function seg_autorizar(uid, decision, btn) {
  const accion = decision === 'autorizada' ? 'autorizar' : 'NO autorizar';
  if (!confirm(`¿Confirma que desea ${accion} la reparación de esta máquina?`)) return;
  btn.parentElement.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    const r = await fetch(`${API}/cliente/maquina/${uid}/autorizar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    await loadOrdenes();
  } catch (e) {
    alert('Error: ' + e.message);
    btn.parentElement.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

async function seg_autorizarTodas(uid_orden, btn) {
  if (!confirm('¿Confirma que desea autorizar TODAS las máquinas cotizadas de esta orden?')) return;
  btn.disabled = true;
  const maquinas = (window._ordenesData || [])
    .find(o => o.uid_orden === uid_orden)
    ?.maquinas.filter(m => m.her_estado === 'cotizada') || [];
  try {
    for (const m of maquinas) {
      await fetch(`${API}/cliente/maquina/${m.uid_herramienta_orden}/autorizar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'autorizada' })
      });
    }
    await loadOrdenes();
  } catch (e) {
    alert('Error: ' + e.message);
    btn.disabled = false;
  }
}

async function init() {
  const me = await fetch('/me').then(r => r.json()).catch(() => ({}));
  if (!me.authenticated) { window.location.href = '/login'; return; }
  document.getElementById('userName').textContent = me.user.nombre;
  await loadOrdenes();
}

async function logout() {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/login';
}

init();
