'use strict';
const API = '/api';

// ── Constants ────────────────────────────────────────────────────────────────

const ESTADOS = {
  pendiente_revision: { label: 'Pendiente de revisión', color: '#888' },
  revisada:           { label: 'Revisada',              color: '#2196F3' },
  cotizada:           { label: 'Cotizada',              color: '#FF9800' },
  autorizada:         { label: 'Autorizada',            color: '#4CAF50' },
  no_autorizada:      { label: 'No autorizada',         color: '#F44336' },
  reparada:           { label: 'Reparada',              color: '#9C27B0' },
  entregada:          { label: 'Entregada',             color: '#009688' },
};

const VIEW_LABELS = {
  dashboard: 'Inicio',
  ordenes:   'Mis Órdenes',
  maquinas:  'Mis Máquinas',
  solicitud: 'Solicitar Recogida',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmtDatetimeLong(raw) {
  if (!raw) return '-';
  const d = new Date(raw);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('es-CO', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
       + ' ' + d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
}

function fmtCop(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

function toggleMaq(el) {
  el.closest('.maq-item').classList.toggle('open');
}

// ── SPA Navigation ────────────────────────────────────────────────────────────

function navigate(view) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.getElementById('topbarTitle').textContent = VIEW_LABELS[view] || view;
  closeSidebar();

  const vc = document.getElementById('viewContent');
  switch (view) {
    case 'dashboard': renderDashboard(vc); break;
    case 'ordenes':   renderOrdenes(vc);   break;
    case 'maquinas':  renderMaquinas(vc);  break;
    case 'solicitud': renderSolicitud(vc); break;
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sbOverlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sbOverlay').classList.remove('open');
}

// ── View: Dashboard (KPIs) ────────────────────────────────────────────────────

function renderDashboard(vc) {
  vc.innerHTML = '<div class="loading">Cargando...</div>';
  fetch(`${API}/cliente/kpis`)
    .then(r => r.json())
    .then(k => {
      vc.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-val">${k.ordenes_activas}</div>
            <div class="kpi-label">Órdenes activas</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">${k.maquinas_registradas}</div>
            <div class="kpi-label">Máquinas registradas</div>
          </div>
          <div class="kpi-card kpi-reparada">
            <div class="kpi-val">${k.listas_para_recoger}</div>
            <div class="kpi-label">Listas para recoger</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">${k.solicitudes_pendientes}</div>
            <div class="kpi-label">Recogidas pendientes</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn-primary" onclick="navigate('ordenes')">📋 Ver mis órdenes</button>
          <button class="btn-primary" style="background:#f0f4f8;color:#1d3557;border:1px solid #d1d5db;" onclick="navigate('solicitud')">🚗 Solicitar recogida</button>
        </div>`;
    })
    .catch(() => {
      vc.innerHTML = '<div class="empty">No se pudo cargar el resumen.</div>';
    });
}

// ── View: Mis Órdenes ─────────────────────────────────────────────────────────

function renderOrdenes(vc) {
  vc.innerHTML = '<div id="ordenesList" class="loading">Cargando...</div>';
  loadOrdenes();
}

function buildMaqHtml(m, maqIdx) {
  const est = ESTADOS[m.her_estado] || ESTADOS.pendiente_revision;
  const badgeClass = 'estado-badge eb-' + (m.her_estado || 'pendiente_revision');

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

  const fechaEnt = m.hor_fecha_prom_entrega
    ? `<div class="sec-block"><div class="sec-lbl">Fecha estimada de entrega</div>
       <div style="font-size:13px;font-weight:600;color:#1d6a3a;">${fmtFecha(m.hor_fecha_prom_entrega)}</div></div>`
    : '';

  const obsHtml = m.hor_observaciones ? `
    <div class="sec-block">
      <div class="sec-lbl">Observaciones del técnico</div>
      <div class="obs-text">${esc(m.hor_observaciones)}</div>
    </div>` : '';

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

  const informeHtml = m.informe ? `
    <div class="sec-block">
      <div class="sec-lbl">Informe de mantenimiento</div>
      <button class="btn-informe" onclick="seg_descargarInforme(${m.uid_herramienta_orden})">
        📄 Descargar informe PDF
      </button>
    </div>` : '';

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
  if (!el) return;
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

// ── View: Mis Máquinas ────────────────────────────────────────────────────────

function renderMaquinas(vc) {
  vc.innerHTML = '<div class="loading">Cargando...</div>';
  fetch(`${API}/cliente/mis-maquinas`)
    .then(r => r.json())
    .then(maquinas => {
      if (!maquinas.length) {
        vc.innerHTML = '<div class="empty"><div style="font-size:36px;margin-bottom:8px;">🔧</div>Aún no tienes máquinas registradas.</div>';
        return;
      }
      const cards = maquinas.map(m => {
        const est = m.ultimo_estado ? (ESTADOS[m.ultimo_estado] || ESTADOS.pendiente_revision) : null;
        const badgeHtml = est
          ? `<div class="maq-card-badge"><span class="estado-badge eb-${esc(m.ultimo_estado || '')}" style="background:${est.color}">${esc(est.label)}</span></div>`
          : '';
        const sub = [m.her_marca, m.her_serial ? `S/N: ${m.her_serial}` : ''].filter(Boolean).join(' · ');
        return `<div class="maq-card-item">
          <div class="maq-card-name">${esc(m.her_nombre || '-')}</div>
          ${sub ? `<div class="maq-card-sub">${esc(sub)}</div>` : ''}
          ${m.her_referencia ? `<div class="maq-card-sub">Ref: ${esc(m.her_referencia)}</div>` : ''}
          ${badgeHtml}
        </div>`;
      }).join('');
      vc.innerHTML = `
        <div class="sec-hdr" style="margin-bottom:14px;">${maquinas.length} equipo${maquinas.length !== 1 ? 's' : ''} registrado${maquinas.length !== 1 ? 's' : ''}</div>
        <div class="maq-grid">${cards}</div>`;
    })
    .catch(() => {
      vc.innerHTML = '<div class="empty">No se pudieron cargar las máquinas.</div>';
    });
}

// ── View: Nueva Solicitud de Recogida ─────────────────────────────────────────

let _solMaquinas = [];   // equipos existentes del cliente
let _solFotosFiles = [];
let _solMaqCounter = 0;  // contador monotónico para IDs de formulario

function _solMaqOpts() {
  return _solMaquinas.map(m =>
    `<option value="${m.uid_herramienta}">${esc(m.her_nombre)}${m.her_marca ? ' — ' + esc(m.her_marca) : ''}</option>`
  ).join('');
}

function seg_renderMaquinaItem(idx) {
  return `<div class="sol-maq-item" id="smi-${idx}">
    <div class="sol-maq-item-hdr">
      <span class="sol-maq-num">Máquina</span>
      <button type="button" class="sol-maq-remove-btn" onclick="seg_removeMaquina(${idx})" title="Eliminar">✕</button>
    </div>
    <div class="fgroup">
      <select id="smi-sel-${idx}" onchange="seg_onMaqSelect(${idx})">
        <option value="">Seleccionar equipo existente...</option>
        ${_solMaqOpts()}
      </select>
    </div>
    <button type="button" id="smi-newtgl-${idx}" class="btn-nuevo-equipo" onclick="seg_toggleNuevo(${idx})">
      ➕ Registrar equipo nuevo
    </button>
    <div id="smi-nuevo-${idx}" style="display:none;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="fgroup">
          <label>Nombre / Modelo <span class="req">*</span></label>
          <input type="text" id="smi-nom-${idx}" placeholder="Ej: Taladro, Esmeril...">
        </div>
        <div class="fgroup">
          <label>Marca</label>
          <input type="text" id="smi-mar-${idx}" placeholder="Bosch, DeWalt...">
        </div>
      </div>
      <div class="fgroup">
        <label>Serial</label>
        <input type="text" id="smi-ser-${idx}" placeholder="Número de serie (opcional)">
      </div>
    </div>
    <div class="fgroup">
      <label>Tipo de servicio <span class="req">*</span></label>
      <select id="smi-tipo-${idx}">
        <option value="reparacion">Reparación</option>
        <option value="mantenimiento">Mantenimiento preventivo</option>
        <option value="revision">Revisión / Diagnóstico</option>
      </select>
    </div>
    <div class="fgroup">
      <label>Descripción del problema</label>
      <textarea id="smi-desc-${idx}" rows="2" placeholder="Cuéntenos qué le pasa al equipo..."></textarea>
    </div>
  </div>`;
}

function seg_toggleNuevo(idx) {
  const div = document.getElementById(`smi-nuevo-${idx}`);
  const sel = document.getElementById(`smi-sel-${idx}`);
  const btn = document.getElementById(`smi-newtgl-${idx}`);
  if (!div) return;
  const opening = div.style.display === 'none';
  div.style.display = opening ? 'block' : 'none';
  if (opening && sel) sel.value = '';
  if (btn) {
    btn.classList.toggle('active', opening);
    btn.textContent = opening ? '✕ Cancelar equipo nuevo' : '➕ Registrar equipo nuevo';
  }
}

function seg_addMaquina() {
  const container = document.getElementById('solMaquinasContainer');
  if (!container) return;
  const idx = _solMaqCounter++;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = seg_renderMaquinaItem(idx);
  container.appendChild(wrapper.firstElementChild);
  _seg_updateRemoveBtns();
}

function seg_removeMaquina(idx) {
  document.getElementById(`smi-${idx}`)?.remove();
  _seg_updateRemoveBtns();
}

function _seg_updateRemoveBtns() {
  const items = document.querySelectorAll('#solMaquinasContainer .sol-maq-item');
  items.forEach((el, i) => {
    const numEl = el.querySelector('.sol-maq-num');
    if (numEl) numEl.textContent = `Máquina ${i + 1}`;
    const btn = el.querySelector('.sol-maq-remove-btn');
    if (btn) btn.style.display = items.length <= 1 ? 'none' : '';
  });
}

function seg_onMaqSelect(idx) {
  const val = document.getElementById(`smi-sel-${idx}`)?.value;
  const nuevoDiv = document.getElementById(`smi-nuevo-${idx}`);
  const btn = document.getElementById(`smi-newtgl-${idx}`);
  if (val && nuevoDiv) { nuevoDiv.style.display = 'none'; }
  if (val && btn) {
    btn.classList.remove('active');
    btn.textContent = '➕ Registrar equipo nuevo';
  }
}

function renderSolicitud(vc) {
  vc.innerHTML = '<div class="loading">Cargando...</div>';
  fetch(`${API}/cliente/mis-maquinas`)
    .then(r => r.json())
    .then(maquinas => {
      _solMaquinas = maquinas;
      _solFotosFiles = [];
      _solMaqCounter = 0;
      const hoy = new Date().toISOString().split('T')[0];

      vc.innerHTML = `
        <div style="max-width:600px;">
          <div id="solMsg"></div>

          <div class="form-section" style="margin-bottom:16px;">
            <div class="sec-hdr" style="margin-bottom:14px;">Mis solicitudes previas</div>
            <div id="solLista"><span style="color:#9ca3af;font-size:13px;">Cargando...</span></div>
          </div>

          <div class="form-section">
            <div class="sec-hdr" style="margin-bottom:14px;">Nueva solicitud de recogida</div>

            <div id="solMaquinasContainer"></div>

            <button type="button" class="add-maq-btn" onclick="seg_addMaquina()">+ Agregar otra máquina</button>

            <hr class="form-sep">

            <div class="fgroup">
              <label>Dirección de recogida <span class="req">*</span></label>
              <input type="text" id="solDireccion" placeholder="Calle, barrio, ciudad...">
              <div class="form-hint">El taller irá a recoger los equipos en esta dirección.</div>
            </div>

            <div class="fgroup">
              <label>Fecha sugerida</label>
              <input type="date" id="solFecha" min="${hoy}">
              <div class="form-hint">El taller confirmará la fecha y hora exactas por WhatsApp.</div>
            </div>

            <div class="fgroup">
              <label>Fotos generales <span style="color:#9ca3af;font-size:11px;">— hasta 5 imágenes, opcional</span></label>
              <label class="foto-upload-label">
                📷 Seleccionar fotos
                <input type="file" id="solFotosInput" accept="image/*" multiple style="display:none" onchange="seg_onFotosChange(this)">
              </label>
              <div id="fotoPreview"></div>
            </div>

            <button class="btn-primary" id="solBtnEnviar" onclick="seg_submitSolicitud()">
              🚗 Enviar solicitud de recogida
            </button>
          </div>
        </div>`;

      seg_addMaquina();
      seg_loadSolicitudes();
    })
    .catch(() => {
      vc.innerHTML = '<div class="empty">No se pudo cargar el formulario.</div>';
    });
}

function seg_onFotosChange(input) {
  _solFotosFiles = Array.from(input.files).slice(0, 5);
  const preview = document.getElementById('fotoPreview');
  preview.innerHTML = '';
  _solFotosFiles.forEach(f => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    preview.appendChild(img);
  });
}

async function seg_submitSolicitud() {
  const btn   = document.getElementById('solBtnEnviar');
  const msgEl = document.getElementById('solMsg');
  msgEl.innerHTML = '';

  const direccion = document.getElementById('solDireccion').value.trim();
  if (!direccion) { msgEl.innerHTML = '<div class="alert-err">La dirección de recogida es obligatoria.</div>'; return; }

  // Recoger máquinas desde el formulario
  const maquinas = [];
  for (const item of document.querySelectorAll('#solMaquinasContainer .sol-maq-item')) {
    const idx    = item.id.replace('smi-', '');
    const selVal = document.getElementById(`smi-sel-${idx}`)?.value;
    const tipo   = document.getElementById(`smi-tipo-${idx}`)?.value || 'reparacion';
    const desc   = document.getElementById(`smi-desc-${idx}`)?.value?.trim() || null;
    if (selVal) {
      maquinas.push({ uid_herramienta: Number(selVal), tipo_servicio: tipo, descripcion: desc });
    } else {
      const nombre = document.getElementById(`smi-nom-${idx}`)?.value?.trim();
      if (!nombre) { msgEl.innerHTML = '<div class="alert-err">Escribe el nombre de cada máquina nueva.</div>'; return; }
      maquinas.push({
        her_nombre: nombre,
        her_marca:  document.getElementById(`smi-mar-${idx}`)?.value?.trim() || null,
        her_serial: document.getElementById(`smi-ser-${idx}`)?.value?.trim() || null,
        tipo_servicio: tipo, descripcion: desc,
      });
    }
  }
  if (!maquinas.length) { msgEl.innerHTML = '<div class="alert-err">Agrega al menos una máquina.</div>'; return; }

  btn.disabled = true;
  btn.textContent = '⏳ Enviando...';
  try {
    const body = { maquinas, direccion, fecha_sugerida: document.getElementById('solFecha').value || undefined };
    const r = await fetch(`${API}/cliente/solicitudes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error al crear solicitud');

    if (_solFotosFiles.length) {
      const fd = new FormData();
      _solFotosFiles.forEach(f => fd.append('fotos', f));
      await fetch(`${API}/cliente/solicitudes/${data.uid_solicitud}/fotos`, { method: 'POST', body: fd });
    }

    msgEl.innerHTML = '<div class="alert-ok">✅ Solicitud enviada. El taller confirmará la fecha por WhatsApp.</div>';
    // Reset form: vaciar máquinas y agregar una vacía
    const container = document.getElementById('solMaquinasContainer');
    if (container) { container.innerHTML = ''; _solMaqCounter = 0; seg_addMaquina(); }
    document.getElementById('solDireccion').value = '';
    document.getElementById('solFecha').value = '';
    document.getElementById('fotoPreview').innerHTML = '';
    _solFotosFiles = [];
    seg_loadSolicitudes();
  } catch (e) {
    msgEl.innerHTML = `<div class="alert-err">Error: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🚗 Enviar solicitud de recogida';
  }
}

async function seg_loadSolicitudes() {
  const el = document.getElementById('solLista');
  if (!el) return;
  const rows = await fetch(`${API}/cliente/solicitudes`).then(r => r.json()).catch(() => []);
  if (!rows.length) {
    el.innerHTML = '<span style="color:#9ca3af;font-size:13px;">Aún no tienes solicitudes.</span>';
    return;
  }
  const tipoLabel = { reparacion:'Reparación', mantenimiento:'Mantenimiento', revision:'Revisión' };
  el.innerHTML = '<div class="sol-list">' + rows.map(s => {
    const badgeClass  = `sol-badge sol-${esc(s.estado)}`;
    const estadoLabel = { pendiente:'Pendiente', confirmada:'Confirmada', completada:'Completada', cancelada:'Cancelada' }[s.estado] || s.estado;
    const maqsHtml = (s.maquinas || []).map(m =>
      `<div style="font-size:12px;padding:2px 0;"><b>${esc(m.her_nombre)}</b>${m.her_marca ? ` — ${esc(m.her_marca)}` : ''} · <span style="color:#6b7280">${tipoLabel[m.tipo_servicio]||m.tipo_servicio}</span>${m.descripcion ? `<br><span style="color:#9ca3af;font-size:11px;">${esc(m.descripcion)}</span>` : ''}</div>`
    ).join('');
    const confirmBox = s.estado === 'confirmada' && s.fecha_confirmada
      ? `<div class="sol-confirmada-box">📅 Recogida confirmada: ${fmtDatetimeLong(s.fecha_confirmada)}${s.nota_confirmacion ? '<br>' + esc(s.nota_confirmacion) : ''}</div>`
      : '';
    return `<div class="sol-card">
      <div class="sol-card-top">
        <div>
          <div class="sol-equipo">${(s.maquinas||[]).map(m=>esc(m.her_nombre)).join(', ')||'Sin equipos'}</div>
          <div class="sol-detalle" style="margin-top:2px;">📍 ${esc(s.direccion)}${s.fecha_sugerida?` · 📅 ${fmtFecha(s.fecha_sugerida)}`:''} · <span style="color:#9ca3af">${fmtDatetime(s.created_at)}</span></div>
        </div>
        <span class="${badgeClass}">${estadoLabel}</span>
      </div>
      ${maqsHtml ? `<div style="margin-top:8px;">${maqsHtml}</div>` : ''}
      ${confirmBox}
    </div>`;
  }).join('') + '</div>';
}

// ── Auth + Init ───────────────────────────────────────────────────────────────

async function doLogout() {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/login';
}

async function init() {
  const me = await fetch('/me').then(r => r.json()).catch(() => ({}));
  if (!me.authenticated) { window.location.href = '/login'; return; }
  document.getElementById('sbUser').textContent = me.user.nombre;
  navigate('dashboard');
}

init();
