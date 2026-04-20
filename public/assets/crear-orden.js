const API = '/api';
const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let clienteSeleccionado = null;
let maquinasEnOrden = []; // [{ uid_herramienta, her_nombre, her_marca, her_serial, observaciones, fotos:[] }]
let ordenCreada = null;
let clientMap = {};
let herramientaMap = {};

// ── Sesión ────────────────────────────────────────────────────────────────────
(async function() {
  const me = await fetch('/me').then(r => r.json()).catch(() => ({}));
  if (!me.authenticated) { window.location.href = '/login'; return; }
  document.getElementById('headerUser').textContent = me.user.nombre;
})();

async function doLogout() {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/login';
}

// ── Steps ─────────────────────────────────────────────────────────────────────
function setStep(n) {
  ['step1','step2','step3','stepSuccess'].forEach((id,i) => {
    document.getElementById(id).style.display = (i === n-1 || (n===4 && i===3)) ? 'block' : 'none';
  });
  [1,2,3].forEach(i => {
    const t = document.getElementById(`step${i}-tab`);
    if (!t) return;
    t.className = 'step' + (i < n ? ' done' : i === n ? ' active' : '');
  });
}

function goStep1() { setStep(1); }

async function goStep2() {
  if (!clienteSeleccionado) return;
  setStep(2);
  document.getElementById('step2ClientCard').innerHTML = `
    <div class="selected-client-card" style="margin-bottom:16px;">
      <div><div class="name">${clienteSeleccionado.cli_razon_social}</div>
      <div class="sub">NIT/CC: ${clienteSeleccionado.cli_identificacion} | Tel: ${clienteSeleccionado.cli_telefono||'-'}</div></div>
    </div>`;
  await cargarHistorial();
  renderMaquinasEnOrden();
}

function goStep3() {
  if (!maquinasEnOrden.length) return;
  setStep(3);
  renderResumen();
}

// ── Cliente ───────────────────────────────────────────────────────────────────
let buscarTimer = null;
function buscarCliente() {
  clearTimeout(buscarTimer);
  buscarTimer = setTimeout(async () => {
    const q = document.getElementById('clientSearch').value.trim();
    if (q.length < 2) { document.getElementById('clientResults').innerHTML = ''; return; }
    const data = await fetch(`${API}/crear-orden/cliente/buscar?q=${encodeURIComponent(q)}`).then(r => r.json());
    const el = document.getElementById('clientResults');
    if (!data.length) { el.innerHTML = '<div class="muted">No se encontraron clientes.</div>'; return; }
    data.forEach(c => { clientMap[c.uid_cliente] = c; });
    el.innerHTML = data.map(c => `
      <div class="result-item" onclick="seleccionarCliente(${c.uid_cliente})">
        <div>
          <div class="result-name">${c.cli_razon_social}</div>
          <div class="result-sub">CC/NIT: ${c.cli_identificacion} | Tel: ${c.cli_telefono||'-'}</div>
        </div>
        <button class="btn-primary btn-sm">Seleccionar</button>
      </div>`).join('');
  }, 300);
}

function seleccionarCliente(uid) {
  const c = clientMap[uid];
  clienteSeleccionado = c;
  document.getElementById('clientResults').innerHTML = '';
  document.getElementById('clientSearch').value = '';
  document.getElementById('newClientForm').style.display = 'none';
  document.getElementById('selectedClientCard').style.display = 'block';
  document.getElementById('selectedClientCard').innerHTML = `
    <div class="selected-client-card">
      <div>
        <div class="name">${c.cli_razon_social}</div>
        <div class="sub">CC/NIT: ${c.cli_identificacion} | Tel: ${c.cli_telefono||'-'} | ${c.cli_direccion||''}</div>
      </div>
      <button class="btn-secondary btn-sm" onclick="deseleccionarCliente()">Cambiar</button>
    </div>`;
  document.getElementById('btnStep1Next').disabled = false;
}

function deseleccionarCliente() {
  clienteSeleccionado = null;
  document.getElementById('selectedClientCard').style.display = 'none';
  document.getElementById('selectedClientCard').innerHTML = '';
  document.getElementById('btnStep1Next').disabled = true;
}

function toggleNewClient() {
  const f = document.getElementById('newClientForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

function sugerirClave() {
  const id = document.getElementById('nc_id').value;
  if (id.length >= 4) document.getElementById('nc_clave').value = id.slice(-4);
}

async function crearCliente() {
  const errEl = document.getElementById('newClientError');
  errEl.style.display = 'none';
  const body = {
    cli_identificacion: document.getElementById('nc_id').value.trim(),
    cli_razon_social:   document.getElementById('nc_nombre').value.trim(),
    cli_telefono:       document.getElementById('nc_tel').value.trim(),
    cli_direccion:      document.getElementById('nc_dir').value.trim(),
    cli_contacto:       document.getElementById('nc_contacto').value.trim(),
    cli_tel_contacto:   document.getElementById('nc_tel_contacto').value.trim(),
    clave:              document.getElementById('nc_clave').value.trim(),
  };
  const res = await fetch(`${API}/crear-orden/cliente`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  }).then(r => r.json());
  if (!res.success) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
  if (res.clave_acceso) alert(`✅ Cliente creado.\n\nClave de acceso al portal: ${res.clave_acceso}\n\nAnótela — no se volverá a mostrar.`);
  clientMap[res.cliente.uid_cliente] = res.cliente;
  seleccionarCliente(res.cliente.uid_cliente);
  document.getElementById('newClientForm').style.display = 'none';
}

// ── Máquinas — modal ─────────────────────────────────────────────────────────
let _mmModoNueva = false;

async function abrirModalMaquina() {
  _mmModoNueva = false;
  // Resetear
  document.getElementById('mm_select').innerHTML = '<option value="">-- Cargando... --</option>';
  document.getElementById('mm_obsRow').style.display = 'none';
  document.getElementById('mm_obs').value = '';
  document.getElementById('mm_nuevaForm').style.display = 'none';
  document.getElementById('mm_btnNueva').textContent = '+ Crear nueva máquina';
  document.getElementById('mm_error').style.display = 'none';
  document.getElementById('mm_nuevaObs').value = '';
  ['mm_nombre','mm_marca','mm_serial','mm_ref'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('mm_btnAgregar').disabled = true;
  // Reset guarantee fields
  document.getElementById('mm_chkGarantia').checked = false;
  document.getElementById('mm_garantiaFields').style.display = 'none';
  document.getElementById('mm_garantiaVence').value = '';
  document.getElementById('mm_facturaFile').value = '';
  document.getElementById('mm_facturaLabel').firstChild.textContent = '📄 Seleccionar PDF';
  document.getElementById('modalMaquina').style.display = 'flex';

  // Cargar máquinas del cliente
  const data = await fetch(`${API}/crear-orden/herramientas/${clienteSeleccionado.uid_cliente}`).then(r => r.json());
  data.forEach(h => { herramientaMap[h.uid_herramienta] = h; });
  const sel = document.getElementById('mm_select');
  if (!data.length) {
    sel.innerHTML = '<option value="">-- Este cliente no tiene máquinas registradas --</option>';
  } else {
    sel.innerHTML = '<option value="">-- Seleccionar máquina --</option>' +
      data.map(h => {
        const yaAgregada = maquinasEnOrden.find(m => m.uid_herramienta === h.uid_herramienta);
        return `<option value="${h.uid_herramienta}" ${yaAgregada ? 'disabled' : ''}>${esc(h.her_nombre)}${h.her_marca ? ' — '+esc(h.her_marca) : ''}${h.her_serial ? ' ('+esc(h.her_serial)+')' : ''}${yaAgregada ? ' ✓ ya en orden' : ''}</option>`;
      }).join('');
  }
}

function cerrarModalMaquina() {
  document.getElementById('modalMaquina').style.display = 'none';
}

function onSelectMaquinaModal(sel) {
  const obsRow = document.getElementById('mm_obsRow');
  const btn = document.getElementById('mm_btnAgregar');
  if (sel.value) {
    obsRow.style.display = 'block';
    btn.disabled = false;
    // Si estaba en modo nueva, cerrar
    if (_mmModoNueva) {
      _mmModoNueva = false;
      document.getElementById('mm_nuevaForm').style.display = 'none';
      document.getElementById('mm_btnNueva').textContent = '+ Crear nueva máquina';
    }
  } else {
    obsRow.style.display = 'none';
    btn.disabled = _mmModoNueva ? false : true;
  }
}

function toggleNuevaMaqModal() {
  _mmModoNueva = !_mmModoNueva;
  document.getElementById('mm_nuevaForm').style.display = _mmModoNueva ? 'block' : 'none';
  document.getElementById('mm_btnNueva').textContent = _mmModoNueva ? '✕ Cancelar nueva máquina' : '+ Crear nueva máquina';
  document.getElementById('mm_selectRow').style.display = _mmModoNueva ? 'none' : 'block';
  document.getElementById('mm_separador').style.display = _mmModoNueva ? 'none' : 'block';
  if (_mmModoNueva) {
    document.getElementById('mm_select').value = '';
    document.getElementById('mm_obsRow').style.display = 'none';
    document.getElementById('mm_btnAgregar').disabled = false;
  } else {
    document.getElementById('mm_btnAgregar').disabled = !document.getElementById('mm_select').value;
  }
}

async function confirmarAgregarMaquina() {
  const btn = document.getElementById('mm_btnAgregar');
  btn.disabled = true; btn.textContent = '⏳ Agregando...';
  try {
    const errEl = document.getElementById('mm_error');
    // Leer campos de garantía (comunes para ambos modos)
    const esGarantia   = document.getElementById('mm_chkGarantia').checked;
    const garantiaVence = document.getElementById('mm_garantiaVence').value;
    const facturaFile  = document.getElementById('mm_facturaFile').files?.[0] || null;

    if (esGarantia && !garantiaVence) {
      errEl.textContent = 'La fecha de vencimiento es obligatoria para máquinas en garantía';
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
    }

    if (_mmModoNueva) {
      errEl.style.display = 'none';
      const body = {
        uid_cliente:    clienteSeleccionado.uid_cliente,
        her_nombre:     document.getElementById('mm_nombre').value.trim(),
        her_marca:      document.getElementById('mm_marca').value.trim(),
        her_serial:     document.getElementById('mm_serial').value.trim(),
        her_referencia: document.getElementById('mm_ref').value.trim(),
      };
      if (!body.her_nombre) {
        errEl.textContent = 'El nombre de la máquina es obligatorio';
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
      }
      const res = await fetch(`${API}/crear-orden/herramienta`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      }).then(r => r.json());
      if (!res.success) { errEl.textContent = res.error; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Agregar a la orden'; return; }
      const obs = document.getElementById('mm_nuevaObs').value.trim();
      maquinasEnOrden.push({ ...res.herramienta, observaciones: obs, fotos: [],
        es_garantia: esGarantia, garantia_vence: garantiaVence, factura: facturaFile });
    } else {
      const uid = parseInt(document.getElementById('mm_select').value);
      const h = herramientaMap[uid];
      const obs = document.getElementById('mm_obs').value.trim();
      maquinasEnOrden.push({ ...h, observaciones: obs, fotos: [],
        es_garantia: esGarantia, garantia_vence: garantiaVence, factura: facturaFile });
    }
    renderMaquinasEnOrden();
    cerrarModalMaquina();
  } catch(e) {
    document.getElementById('mm_error').textContent = e.message;
    document.getElementById('mm_error').style.display = 'block';
    btn.disabled = false; btn.textContent = 'Agregar a la orden';
  }
}

// Mantener compatibilidad: cargarHistorial ya no renderiza HTML, solo carga el mapa
async function cargarHistorial() {
  const data = await fetch(`${API}/crear-orden/herramientas/${clienteSeleccionado.uid_cliente}`).then(r => r.json());
  data.forEach(h => { herramientaMap[h.uid_herramienta] = h; });
}

function quitarMaquina(uid) {
  maquinasEnOrden = maquinasEnOrden.filter(m => m.uid_herramienta !== uid);
  renderMaquinasEnOrden();
}

function setObservacion(uid, val) {
  const m = maquinasEnOrden.find(m => m.uid_herramienta === uid);
  if (m) m.observaciones = val;
}

function renderMaquinasEnOrden() {
  const el = document.getElementById('maquinasEnOrden');
  document.getElementById('btnStep2Next').disabled = maquinasEnOrden.length === 0;
  if (!maquinasEnOrden.length) { el.innerHTML = '<div class="muted" style="margin-bottom:12px;">Ninguna máquina agregada aún.</div>'; return; }
  el.innerHTML = maquinasEnOrden.map((m, i) => `
    <div class="card maq-item">
      <div class="maq-header">
        <div>
          <div class="maq-nombre">${i+1}. ${m.her_nombre} ${m.her_marca||''}${m.es_garantia ? ' <span style="font-size:11px;font-weight:700;background:#c0392b;color:#fff;padding:1px 6px;border-radius:4px;vertical-align:middle;">GARANTÍA</span>' : ''}</div>
          <div class="maq-sub">${m.her_serial ? 'S/N: '+m.her_serial : 'Sin serial'}${m.her_referencia ? ' | Ref: '+m.her_referencia : ''}${m.es_garantia && m.garantia_vence ? ' | Vence: '+m.garantia_vence : ''}${m.es_garantia && m.factura ? ' | 📄 '+m.factura.name : ''}</div>
        </div>
        <button class="btn-danger" onclick="quitarMaquina(${m.uid_herramienta})">Quitar</button>
      </div>
      <div class="form-group">
        <label>Observaciones de recepción</label>
        <textarea placeholder="Estado visible, accesorios entregados, falla reportada..." onchange="setObservacion(${m.uid_herramienta}, this.value)">${m.observaciones||''}</textarea>
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label>Fotos de recepción</label>
        <div class="foto-preview" id="fotoPreview_${m.uid_herramienta}"></div>
        <label style="display:inline-block;margin-top:6px;padding:6px 12px;background:#f0f4f8;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:12px;">
          📷 Agregar fotos
          <input type="file" accept="image/*" multiple style="display:none;"
            onchange="agregarFotosPreview(${m.uid_herramienta}, this.files)">
        </label>
        <span class="muted" style="margin-left:8px;" id="fotoCount_${m.uid_herramienta}"></span>
      </div>
    </div>`).join('');
  // Re-renderizar previews en memoria
  maquinasEnOrden.forEach(m => renderFotoPreviews(m.uid_herramienta));
}

// ── Fotos en preview (Step 2) ─────────────────────────────────────────────────
function agregarFotosPreview(uid, files) {
  const m = maquinasEnOrden.find(m => m.uid_herramienta === uid);
  if (!m) return;
  Array.from(files).forEach(f => {
    m.fotos.push({ file: f, url: URL.createObjectURL(f) });
  });
  renderFotoPreviews(uid);
}

function quitarFotoPreview(uid, idx) {
  const m = maquinasEnOrden.find(m => m.uid_herramienta === uid);
  if (!m) return;
  URL.revokeObjectURL(m.fotos[idx].url);
  m.fotos.splice(idx, 1);
  renderFotoPreviews(uid);
}

function renderFotoPreviews(uid) {
  const m = maquinasEnOrden.find(m => m.uid_herramienta === uid);
  const previewEl = document.getElementById('fotoPreview_' + uid);
  const countEl   = document.getElementById('fotoCount_'   + uid);
  if (!m || !previewEl) return;
  previewEl.innerHTML = m.fotos.map((f, i) => `
    <div class="foto-thumb">
      <img src="${f.url}" alt="foto">
      <button class="del" onclick="quitarFotoPreview(${uid}, ${i})" title="Quitar">×</button>
    </div>`).join('');
  if (countEl) countEl.textContent = m.fotos.length ? m.fotos.length + ' foto(s)' : '';
}

// ── Resumen ───────────────────────────────────────────────────────────────────
function renderResumen() {
  document.getElementById('resumenOrden').innerHTML = `
    <div class="selected-client-card" style="margin-bottom:16px;">
      <div>
        <div class="name">${clienteSeleccionado.cli_razon_social}</div>
        <div class="sub">CC/NIT: ${clienteSeleccionado.cli_identificacion} | Tel: ${clienteSeleccionado.cli_telefono||'-'}</div>
      </div>
    </div>
    <h3 style="margin-bottom:10px;">Máquinas (${maquinasEnOrden.length})</h3>
    ${maquinasEnOrden.map((m,i) => `
      <div style="padding:8px 12px;border:1px solid #eee;border-radius:6px;margin-bottom:6px;">
        <div style="font-weight:600;font-size:13px;">${i+1}. ${m.her_nombre} ${m.her_marca||''}${m.es_garantia ? ' <span style="font-size:11px;font-weight:700;background:#c0392b;color:#fff;padding:1px 6px;border-radius:4px;">GARANTÍA</span>' : ''}</div>
        ${m.her_serial ? `<div class="muted">S/N: ${m.her_serial}</div>` : ''}
        ${m.es_garantia && m.garantia_vence ? `<div class="muted">Garantía vence: ${m.garantia_vence}${m.factura ? ' | 📄 '+m.factura.name : ''}</div>` : ''}
        ${m.observaciones ? `<div class="muted" style="margin-top:4px;">${m.observaciones}</div>` : ''}
        ${m.fotos.length ? `<div class="muted" style="margin-top:2px;">📷 ${m.fotos.length} foto(s) adjunta(s)</div>` : ''}
      </div>`).join('')}`;
}

// ── Días hábiles colombianos (inline, mismo algoritmo que dashboard) ──────────
(function() {
  function pascua(y) {
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,
          f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
          h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
          l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
          mo=Math.floor((h+l-7*m+114)/31),dy=((h+l-7*m+114)%31)+1;
    return new Date(y,mo-1,dy);
  }
  function proxLunes(d){const r=new Date(d),dow=r.getDay();if(dow===1)return r;r.setDate(r.getDate()+(dow===0?1:8-dow));return r;}
  const _cf={};
  function getFestivos(y){
    if(_cf[y])return _cf[y];const s=new Set();
    const add=d=>s.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    [[1,1],[5,1],[7,20],[8,7],[12,8],[12,25]].forEach(([m,d])=>add(new Date(y,m-1,d)));
    [[1,6],[3,19],[6,29],[8,15],[10,12],[11,1],[11,11]].forEach(([m,d])=>add(proxLunes(new Date(y,m-1,d))));
    const p=pascua(y);[-3,-2].forEach(o=>{const d=new Date(p);d.setDate(d.getDate()+o);add(d);});
    [39,60,68].forEach(o=>{const d=new Date(p);d.setDate(d.getDate()+o);add(proxLunes(d));});
    return(_cf[y]=s);
  }
  function esNoHabil(d){const dow=d.getDay();if(dow===0||dow===6)return true;const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return getFestivos(d.getFullYear()).has(k);}
  window.addDiasHabiles=function(desde,n){const d=new Date(desde);d.setHours(0,0,0,0);let c=0;while(c<n){d.setDate(d.getDate()+1);if(!esNoHabil(d))c++;}return d;};
  window.toInputDate=function(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
})();

// ── Toggle garantía por máquina (en modal) ────────────────────────────────────
function mm_toggleGarantia(checked) {
  document.getElementById('mm_garantiaFields').style.display = checked ? 'block' : 'none';
  if (checked) {
    document.getElementById('mm_garantiaVence').value = toInputDate(addDiasHabiles(new Date(), 30));
  } else {
    document.getElementById('mm_garantiaVence').value = '';
  }
}

function mm_onFacturaChange(input) {
  const lbl = document.getElementById('mm_facturaLabel');
  lbl.firstChild.textContent = input.files?.[0]?.name ? '✅ ' + input.files[0].name : '📄 Seleccionar PDF';
}

// ── Crear orden ───────────────────────────────────────────────────────────────
async function crearOrden() {
  const btn = document.getElementById('btnCrear');
  const errEl = document.getElementById('step3Error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Creando...';

  const res = await fetch(`${API}/crear-orden/orden`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      uid_cliente: clienteSeleccionado.uid_cliente,
      maquinas: maquinasEnOrden.map(m => ({
        uid_herramienta: m.uid_herramienta,
        observaciones:   m.observaciones,
        es_garantia:     m.es_garantia || false,
        garantia_vence:  m.garantia_vence || null,
      })),
    }),
  }).then(r => r.json());

  if (!res.success) {
    btn.disabled = false; btn.textContent = '✓ Crear Orden';
    errEl.textContent = res.error; errEl.style.display = 'block'; return;
  }
  ordenCreada = res;

  // Subir fotos adjuntadas en Step 2
  btn.textContent = 'Subiendo fotos...';
  for (let i = 0; i < res.herramientas.length; i++) {
    const fotos = maquinasEnOrden[i]?.fotos || [];
    for (const f of fotos) {
      const fd = new FormData();
      fd.append('foto', f.file);
      await fetch(`${API}/crear-orden/foto/${res.herramientas[i].uid_herramienta_orden}`, { method: 'POST', body: fd });
    }
  }

  // Subir factura PDF por máquina (si se adjuntó)
  btn.textContent = 'Subiendo facturas...';
  for (let i = 0; i < res.herramientas.length; i++) {
    const factura = maquinasEnOrden[i]?.factura;
    if (factura) {
      const fd = new FormData();
      fd.append('factura', factura);
      await fetch(`${API}/crear-orden/factura-maquina/${res.herramientas[i].uid_herramienta_orden}`, { method: 'POST', body: fd });
    }
  }

  btn.disabled = false;
  btn.textContent = '✓ Crear Orden';

  mostrarExito();
}

// ── Éxito + fotos ─────────────────────────────────────────────────────────────
function mostrarExito() {
  setStep(4);
  document.getElementById('successConsecutivo').textContent = `Orden #${ordenCreada.ord_consecutivo}`;
  document.getElementById('successMaqList').innerHTML = maquinasEnOrden.map((m,i) => `
    <div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">
      ${i+1}. ${m.her_nombre} ${m.her_marca||''}${m.her_serial ? ' / S/N: '+m.her_serial : ''}
    </div>`).join('');

  const accionesEl = document.getElementById('ordenAcciones');
  const uid_orden = ordenCreada.uid_orden;
  accionesEl.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
      <a href="${API}/orders/${uid_orden}/print/orden" target="_blank"
         style="padding:9px 20px;background:var(--color-primary, #1d3557);color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
        🖨️ Imprimir orden
      </a>
      <button onclick="enviarOrdenWA(${uid_orden}, this)"
         style="padding:9px 20px;background:#25D366;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
        📱 Enviar por WhatsApp
      </button>
    </div>`;
}

async function enviarOrdenWA(uid_orden, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const res = await fetch(`${API}/orders/${uid_orden}/send-pdf/orden`, { method: 'POST' }).then(r => r.json());
    btn.textContent = res.success ? '✓ Enviado' : '✗ Error';
    if (!res.success) setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  } catch {
    btn.textContent = '✗ Error';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  }
}

function nuevaOrden() {
  maquinasEnOrden.forEach(m => m.fotos.forEach(f => URL.revokeObjectURL(f.url)));
  clienteSeleccionado = null;
  maquinasEnOrden = [];
  ordenCreada = null;
  document.getElementById('clientSearch').value = '';
  document.getElementById('clientResults').innerHTML = '';
  document.getElementById('selectedClientCard').style.display = 'none';
  document.getElementById('btnStep1Next').disabled = true;
  setStep(1);
}
