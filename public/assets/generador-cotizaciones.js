const API_BASE = '/api';

// ── Sesión ──────────────────────────────────────────────────────────────────
(async function checkSession() {
  const res = await fetch('/me').then(r => r.json()).catch(() => ({}));
  if (!res.authenticated) { window.location.href = '/login'; return; }
  document.getElementById('headerUserName').textContent = res.user.nombre;
  const params = new URLSearchParams(window.location.search);
  const ordenParam   = params.get('orden');
  const maquinaParam = params.get('maquina');
  if (maquinaParam) document.body.classList.add('modal-mode');
  if (ordenParam) {
    await loadOrder({ uid_orden: ordenParam });
    // Pre-seleccionar máquina específica si viene el parámetro
    if (maquinaParam && equipmentData.length) {
      const maq = equipmentData.find(e => String(e.uid_herramienta_orden) === String(maquinaParam));
      if (maq) {
        selectedEquipment = maq;
        const sel = document.getElementById('equipmentSelect');
        if (sel) sel.value = String(maq.uid_herramienta_orden);
        paintSelectedEquipment(maq);
        syncTechnicianSelect(maq);
        await loadSavedQuoteForSelectedMachine();
      }
    }
  }
})();

async function doLogout() {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/login';
}

const ESTADOS = [
  { value: 'pendiente_revision', label: 'Pendiente de revisión', color: '#888' },
  { value: 'revisada',           label: 'Revisada',              color: '#2196F3' },
  { value: 'cotizada',           label: 'Cotizada',              color: '#FF9800' },
  { value: 'autorizada',         label: 'Autorizada',            color: '#4CAF50' },
  { value: 'no_autorizada',      label: 'No autorizada',         color: '#F44336' },
  { value: 'reparada',           label: 'Reparada',              color: '#9C27B0' },
  { value: 'entregada',          label: 'Entregada',             color: '#009688' },
];

function showToast(msg, duration = 3000) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#323232;color:#fff;padding:10px 20px;border-radius:6px;font-size:13px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, duration);
}

let currentOrderId = null;
let currentOrderData = null;
let equipmentData = [];
let techniciansData = [];
let selectedEquipment = null;
let currentQuoteItems = [];
let finalMessage = '';

// ── Búsqueda con concepto ────────────────────────────────────────────────────
const PLACEHOLDERS = {
  consecutivo: 'Ej: 7833',
  cedula:      'Ej: 8914110164',
  nombre:      'Ej: Motel Casa Blanca',
};

function actualizarPlaceholder() {
  const concepto = document.getElementById('conceptoSelect').value;
  document.getElementById('searchInput').placeholder = PLACEHOLDERS[concepto];
  document.getElementById('searchInput').value = '';
  document.getElementById('resultsList').innerHTML = '<div class="results-empty">Escribe para buscar</div>';
}

let buscarTimer = null;
function buscarDebounce() {
  clearTimeout(buscarTimer);
  buscarTimer = setTimeout(buscar, 350);
}

async function buscar() {
  const q = document.getElementById('searchInput').value.trim();
  if (q.length < 1) {
    document.getElementById('resultsList').innerHTML = '<div class="results-empty">Escribe para buscar</div>';
    return;
  }
  document.getElementById('resultsList').innerHTML = '<div class="results-empty">Buscando...</div>';
  try {
    const orders = await fetch(`${API_BASE}/orders/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    renderResultados(orders);
  } catch(e) {
    document.getElementById('resultsList').innerHTML = '<div class="results-empty" style="color:#e74c3c;">Error al buscar</div>';
  }
}

function fmtFecha(raw) {
  if (!raw) return '-';
  const s = String(raw);
  const m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return `${m8[3]}/${m8[2]}/${m8[1]}`;
  const miso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (miso) return `${miso[3]}/${miso[2]}/${miso[1]}`;
  return s;
}

function renderResultados(orders) {
  const el = document.getElementById('resultsList');
  if (!orders.length) { el.innerHTML = '<div class="results-empty">Sin resultados</div>'; return; }
  el.innerHTML = '';
  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'result-card';
    div.innerHTML = `
      <div class="rc-top">
        <span class="rc-num">Orden #${o.ord_consecutivo}</span>
        <span class="rc-fecha">${fmtFecha(o.ord_fecha)}</span>
      </div>
      <div class="rc-cliente">${o.cli_razon_social || ''}</div>
      <div class="rc-maq">${o.maquinas_resumen || (o.maquinas ? o.maquinas + ' máquina(s)' : '')}</div>
    `;
    div.onclick = () => loadOrder(o);
    el.appendChild(div);
  });
}

function volverBusqueda() {
  document.getElementById('orderLoadedPanel').style.display = 'none';
  document.getElementById('resultsList').style.display = '';
  document.getElementById('emptyState').style.display = '';
  document.getElementById('cotizadorSection').style.display = 'none';
  currentOrderId = null;
  currentOrderData = null;
  selectedEquipment = null;
  currentQuoteItems = [];
}

// ── Cargar orden ─────────────────────────────────────────────────────────────
async function loadOrder(order) {
  try {
    const resp = await fetch(`${API_BASE}/orders/${encodeURIComponent(order.uid_orden)}`);
    if (!resp.ok) throw new Error('No se pudo cargar el detalle de la orden');
    const data = await resp.json();

    currentOrderId = data.order.uid_orden;
    currentOrderData = data.order;
    equipmentData = Array.isArray(data.equipment) ? data.equipment : [];
    techniciansData = Array.isArray(data.technicians) ? data.technicians : [];

    document.getElementById('orderNumber').textContent = data.order.ord_consecutivo;
    document.getElementById('clientName').textContent = data.order.cli_razon_social;
    document.getElementById('clientPhone').textContent = data.order.cli_telefono || '-';
    document.getElementById('orderDate').textContent = fmtFecha(data.order.ord_fecha);
    document.getElementById('equipmentCount').textContent = String(data.equipmentCount ?? equipmentData.length);
    document.getElementById('savedCount').textContent = String(data.quotesSaved ?? 0);

    const tw = document.getElementById('techWarning');
    tw.textContent = data.techniciansWarning ? `⚠️ ${data.techniciansWarning}` : '';

    // Cambiar de resultados a panel de orden
    document.getElementById('resultsList').style.display = 'none';
    document.getElementById('orderLoadedPanel').style.display = 'flex';

    // Mostrar formulario de cotización
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('cotizadorSection').style.display = 'block';

    renderTechnicians(techniciansData);
    renderEquipment(equipmentData);

    if (equipmentData.length) {
      selectedEquipment = equipmentData[0];
      document.getElementById('equipmentSelect').value = String(selectedEquipment.uid_herramienta_orden);
      paintSelectedEquipment(selectedEquipment);
      syncTechnicianSelect(selectedEquipment);
      await loadSavedQuoteForSelectedMachine();
    } else {
      selectedEquipment = null;
      paintSelectedEquipment(null);
      syncTechnicianSelect(null);
      resetMachineForm();
    }

    loadPartsSelect();
    await refreshSavedCount();

    finalMessage = '';
    document.getElementById('messagePreview').textContent = 'Aquí aparecerá el mensaje FINAL (todas las máquinas)...';
    document.getElementById('sendFinalBtn').disabled = true;
  } catch(e) {
    console.error(e);
    alert(`⚠️ ${e.message}`);
  }
}

function renderEquipment(list) {
  const sel = document.getElementById('equipmentSelect');
  sel.innerHTML = '<option value="">-- Selecciona una máquina --</option>';

  if (!list.length) return;

  list.forEach((eq, idx) => {
    const tech = eq.tecnico_nombre ? ` — Tec: ${eq.tecnico_nombre}` : '';
    const label = `${idx+1}. ${eq.her_nombre||'-'} ${eq.her_marca||''}${eq.her_serial ? ' / '+eq.her_serial : ''}${tech}`;
    const opt = document.createElement('option');
    opt.value = String(eq.uid_herramienta_orden);
    opt.textContent = label.trim();
    sel.appendChild(opt);
  });
}

async function updateEquipmentStatus(uid, selectEl) {
  const status = selectEl.value;
  const prev = selectEl.dataset.prev || selectEl.value;
  selectEl.dataset.prev = status;
  try {
    const res = await fetch(`${API_BASE}/equipment-order/${encodeURIComponent(uid)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!data.success) {
      alert('Error al actualizar estado: ' + (data.error || 'Error desconocido'));
      selectEl.value = prev;
      return;
    }
    const estadoInfo = ESTADOS.find(e => e.value === status) || ESTADOS[0];
    selectEl.style.color = estadoInfo.color;
    selectEl.dataset.prev = status;
    const eq = equipmentData.find(e => String(e.uid_herramienta_orden) === String(uid));
    if (eq) eq.her_estado = status;
  } catch(e) {
    console.error(e);
    alert('Error de red al actualizar estado');
    selectEl.value = prev;
  }
}

async function notifyParts() {
  if (!currentOrderId) return;
  try {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/notify-parts`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!data.success) { alert('Error: ' + (data.error || 'Error desconocido')); return; }
    showToast(`📦 Lista enviada al encargado (${data.maquinas} máquina${data.maquinas !== 1 ? 's' : ''})`);
  } catch(e) { alert('Error de red: ' + e.message); }
}

async function notifyReady() {
  if (!currentOrderId) return;
  try {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/notify-ready`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!data.success) { alert('Error: ' + (data.error || 'Error desconocido')); return; }
    showToast(`🔧 Cliente notificado (${data.maquinas} máquina${data.maquinas !== 1 ? 's' : ''} reparada${data.maquinas !== 1 ? 's' : ''})`);
  } catch(e) { alert('Error de red: ' + e.message); }
}

async function notifyDelivered() {
  if (!currentOrderId) return;
  try {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/notify-delivered`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!data.success) { alert('Error: ' + (data.error || 'Error desconocido')); return; }
    showToast(`✅ Entrega confirmada al cliente (${data.maquinas} máquina${data.maquinas !== 1 ? 's' : ''})`);
  } catch(e) { alert('Error de red: ' + e.message); }
}

async function onEquipmentChange() {
  const id = document.getElementById('equipmentSelect').value;
  selectedEquipment = equipmentData.find(e => String(e.uid_herramienta_orden) === String(id)) || null;
  paintSelectedEquipment(selectedEquipment);
  syncTechnicianSelect(selectedEquipment);
  await loadSavedQuoteForSelectedMachine();
  loadPartsSelect();
}

function paintSelectedEquipment(eq) {
  if (!eq) {
    document.getElementById('equipmentName').textContent = '';
    document.getElementById('equipmentBrand').textContent = '';
    return;
  }
  document.getElementById('equipmentName').textContent = eq.her_nombre || '-';
  document.getElementById('equipmentBrand').textContent = (eq.her_marca||'-') + (eq.her_serial ? ` / ${eq.her_serial}` : '');
}

function renderTechnicians(list) {
  const sel = document.getElementById('technicianSelect');
  sel.innerHTML = '<option value="">(Sin asignar)</option>';
  if (!Array.isArray(list) || !list.length) return;
  list.forEach(t => {
    const opt = document.createElement('option');
    opt.value = String(t.uid_usuario);
    opt.textContent = t.usr_nombre || `Técnico ${t.uid_usuario}`;
    sel.appendChild(opt);
  });
}

function syncTechnicianSelect(eq) {
  const sel = document.getElementById('technicianSelect');
  if (!sel) return;
  const techId = eq && (eq.tecnico_id ?? eq.uid_usuario_asignado);
  sel.value = techId ? String(techId) : '';
}

async function onTechnicianChange() {
  if (!currentOrderId || !selectedEquipment) return;
  const sel = document.getElementById('technicianSelect');
  const technicianId = sel.value ? sel.value : null;
  try {
    const resp = await fetch(`${API_BASE}/equipment-order/${encodeURIComponent(selectedEquipment.uid_herramienta_orden)}/assign-technician`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technicianId })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || data.details || 'No se pudo asignar');
    const map = new Map(techniciansData.map(t => [String(t.uid_usuario), t.usr_nombre]));
    selectedEquipment.tecnico_id = technicianId;
    selectedEquipment.tecnico_nombre = technicianId ? (map.get(String(technicianId)) || '') : '';
    equipmentData = equipmentData.map(eq => {
      if (String(eq.uid_herramienta_orden) === String(selectedEquipment.uid_herramienta_orden)) {
        return { ...eq, tecnico_id: technicianId, tecnico_nombre: selectedEquipment.tecnico_nombre };
      }
      return eq;
    });
    renderEquipment(equipmentData);
  } catch(e) {
    console.error(e);
    alert(`⚠️ ${e.message}`);
  }
}

async function assignTechnicianToAll() {
  if (!currentOrderId) return;
  const sel = document.getElementById('technicianSelect');
  const technicianId = sel.value ? sel.value : null;
  if (!technicianId) {
    const ok = confirm('¿Quieres quitar el técnico de TODAS las máquinas?');
    if (!ok) return;
  }
  try {
    const resp = await fetch(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/assign-technician`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technicianId })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || data.details || 'No se pudo asignar');
    const map = new Map(techniciansData.map(t => [String(t.uid_usuario), t.usr_nombre]));
    const techName = technicianId ? (map.get(String(technicianId)) || '') : '';
    equipmentData = equipmentData.map(eq => ({ ...eq, tecnico_id: technicianId, tecnico_nombre: techName }));
    if (selectedEquipment) {
      selectedEquipment.tecnico_id = technicianId;
      selectedEquipment.tecnico_nombre = techName;
    }
    renderEquipment(equipmentData);
  } catch(e) {
    console.error(e);
    alert(`⚠️ ${e.message}`);
  }
}

async function loadPartsSelect() {
  try {
    const r = await fetch(`${API_BASE}/quote/catalog?type=R`);
    if (!r.ok) throw new Error('Error catálogo');
    const parts = await r.json();
    const sel = document.getElementById('partSelect');
    sel.innerHTML = '<option value="">-- Catálogo de Repuestos --</option>';
    parts.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.uid_concepto_costo;
      opt.textContent = `${p.cco_descripcion} ($${Number(p.cco_valor||0).toLocaleString('es-CO')})`;
      opt.dataset.price = p.cco_valor;
      sel.appendChild(opt);
    });
  } catch(e) {
    console.warn(e);
  }
}

function addItem() {
  const partSelect = document.getElementById('partSelect');
  const qty = parseInt(document.getElementById('partQuantity').value || '1', 10) || 1;
  const custom = document.getElementById('customPartName').value.trim();
  let name, price;
  if (partSelect.value) {
    const opt = partSelect.options[partSelect.selectedIndex];
    name = opt.textContent.split(' ($')[0];
    price = Number(opt.dataset.price || 0);
  } else if (custom) {
    name = custom;
    price = 0;
  } else {
    alert('Selecciona o escribe un repuesto');
    return;
  }
  currentQuoteItems.push({ id: Date.now(), name, quantity: qty, price });
  renderItems();
  updateSummary();
  partSelect.value = '';
  document.getElementById('partQuantity').value = '1';
  document.getElementById('customPartName').value = '';
}

function renderItems() {
  const c = document.getElementById('itemsContainer');
  if (!currentQuoteItems.length) {
    c.innerHTML = '<p style="color:#999;text-align:center;padding:16px;">(Sin repuestos aún)</p>';
    return;
  }
  c.innerHTML = '';
  currentQuoteItems.forEach(it => {
    const div = document.createElement('div');
    div.className = 'item-row';
    div.innerHTML = `
      <div><input type="text" value="${escapeHtml(it.name)}" readonly style="background:#fff;border:none;font-weight:500;"></div>
      <div><input type="number" value="${it.quantity}" min="1" onchange="updateItemQty(${it.id}, this.value)"></div>
      <div><input type="number" value="${it.price}" min="0" onchange="updateItemPrice(${it.id}, this.value)"></div>
      <button onclick="removeItem(${it.id})">❌</button>
    `;
    c.appendChild(div);
  });
}

function updateItemQty(id, v) {
  const it = currentQuoteItems.find(x => x.id === id);
  if (it) { it.quantity = parseInt(v||'1',10)||1; updateSummary(); }
}
function updateItemPrice(id, v) {
  const it = currentQuoteItems.find(x => x.id === id);
  if (it) { it.price = Number(v)||0; updateSummary(); }
}
function removeItem(id) {
  currentQuoteItems = currentQuoteItems.filter(x => x.id !== id);
  renderItems();
  updateSummary();
}

function updateSummary() {
  const labor = Number(document.getElementById('laborCost').value) || 0;
  const itemsSubtotal = currentQuoteItems.reduce((s,it) => s + (Number(it.quantity)||0)*(Number(it.price)||0), 0);
  const subtotal = labor + itemsSubtotal;
  document.getElementById('subtotalDisplay').textContent = `$${subtotal.toLocaleString('es-CO',{maximumFractionDigits:0})}`;
  document.getElementById('taxDisplay').textContent = `$0`;
  document.getElementById('totalDisplay').textContent = `$${subtotal.toLocaleString('es-CO',{maximumFractionDigits:0})}`;
}

function resetMachineForm() {
  currentQuoteItems = [];
  document.getElementById('laborCost').value = '';
  document.getElementById('workDescription').value = '';
  document.getElementById('partSelect').value = '';
  document.getElementById('partQuantity').value = '1';
  document.getElementById('customPartName').value = '';
  renderItems();
  updateSummary();
}

async function loadSavedQuoteForSelectedMachine() {
  resetMachineForm();
  if (!currentOrderId || !selectedEquipment) return;
  try {
    const resp = await fetch(`${API_BASE}/quotes/machine?orderId=${encodeURIComponent(currentOrderId)}&equipmentOrderId=${encodeURIComponent(selectedEquipment.uid_herramienta_orden)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.exists) return;
    const mq = data.machineQuote;
    document.getElementById('laborCost').value = mq?.mano_obra ?? '';
    document.getElementById('workDescription').value = mq?.descripcion_trabajo ?? '';
    currentQuoteItems = (data.items || []).map(it => ({
      id: it.id || Date.now()+Math.random(),
      name: it.nombre,
      quantity: Number(it.cantidad||1),
      price: Number(it.precio||0)
    }));
    renderItems();
    updateSummary();
  } catch(e) {
    console.warn(e);
  }
}

async function saveMachineQuote() {
  if (!currentOrderId) return alert('Selecciona una orden');
  if (!selectedEquipment) return alert('Selecciona una máquina');
  const laborCost = Number(document.getElementById('laborCost').value) || 0;
  const workDescription = document.getElementById('workDescription').value || '';
  const technicianId = document.getElementById('technicianSelect').value || null;
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '💾 Guardando...';
  try {
    const resp = await fetch(`${API_BASE}/quotes/machine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: currentOrderId,
        equipmentOrderId: String(selectedEquipment.uid_herramienta_orden),
        technicianId,
        laborCost,
        workDescription,
        items: currentQuoteItems
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'No se pudo guardar');
    showToast('✅ Cotización guardada para esta máquina');
    // Notificar al padre si estamos dentro de un modal iframe
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: 'cotizacionGuardada', orderId: currentOrderId },
        window.location.origin
      );
    }
    await refreshSavedCount();
  } catch(e) {
    console.error(e);
    alert(`⚠️ ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = '💾 Guardar máquina';
  }
}

async function refreshSavedCount() {
  if (!currentOrderId) return;
  try {
    const r = await fetch(`${API_BASE}/quotes/order/${encodeURIComponent(currentOrderId)}`);
    if (!r.ok) return;
    const data = await r.json();
    if (!data.success) return;
    document.getElementById('savedCount').textContent = String(data.savedCount ?? 0);
  } catch(e) {}
}

async function generateFinalMessage() {
  if (!currentOrderId) return alert('Selecciona una orden');
  const btn = document.getElementById('genFinalBtn');
  btn.disabled = true; btn.textContent = '⏳ Generando...';
  document.getElementById('messagePreview').textContent = 'Generando mensaje final...';
  try {
    const resp = await fetch(`${API_BASE}/quotes/order/${encodeURIComponent(currentOrderId)}/generate-message`, { method: 'POST' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'No se pudo generar');
    finalMessage = data.message;
    document.getElementById('messagePreview').textContent = finalMessage;
    document.getElementById('sendFinalBtn').disabled = false;
  } catch(e) {
    console.error(e);
    document.getElementById('messagePreview').textContent = `⚠️ ${e.message}`;
    document.getElementById('sendFinalBtn').disabled = true;
  } finally {
    btn.disabled = false; btn.textContent = '🤖 Mensaje final';
  }
}

async function sendFinalWhatsApp() {
  if (!currentOrderId) return;
  const btn = document.getElementById('sendFinalBtn');
  btn.disabled = true; btn.textContent = '📤 Enviando...';
  try {
    const resp = await fetch(`${API_BASE}/quotes/order/${encodeURIComponent(currentOrderId)}/send-whatsapp`, { method: 'POST' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'No se pudo enviar');
    alert(`✅ Mensaje enviado a ${data.cliente || 'cliente'}`);
    btn.textContent = '📱 Enviar WA final';
  } catch(e) {
    console.error(e);
    alert(`⚠️ ${e.message}`);
    btn.disabled = false; btn.textContent = '📱 Enviar WA final';
  }
}

function downloadQuotePDF() {
  if (!currentOrderId) return alert('Selecciona una orden');
  window.open(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/pdf/quote`, '_blank');
}

async function sendQuotePDF() {
  if (!currentOrderId) return alert('Selecciona una orden');
  const btn = document.getElementById('sendQuotePDFBtn');
  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  try {
    const resp = await fetch(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/send-pdf/quote`, { method: 'POST' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'No se pudo enviar');
    alert('✅ Cotización PDF enviada por WhatsApp');
  } catch(e) { alert(`⚠️ ${e.message}`); }
  finally { btn.disabled = false; btn.textContent = '📤 Enviar por WA'; }
}

function downloadMaintenancePDF() {
  if (!currentOrderId) return alert('Selecciona una orden');
  if (!selectedEquipment) return alert('Selecciona una máquina');
  window.open(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/pdf/maintenance/${encodeURIComponent(selectedEquipment.uid_herramienta_orden)}`, '_blank');
}

async function sendMaintenancePDF() {
  if (!currentOrderId) return alert('Selecciona una orden');
  if (!selectedEquipment) return alert('Selecciona una máquina');
  const btn = document.getElementById('sendMaintPDFBtn');
  btn.disabled = true; btn.textContent = '⏳ Generando y enviando...';
  try {
    const resp = await fetch(`${API_BASE}/orders/${encodeURIComponent(currentOrderId)}/send-pdf/maintenance/${encodeURIComponent(selectedEquipment.uid_herramienta_orden)}`, { method: 'POST' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'No se pudo enviar');
    alert('✅ Informe de mantenimiento enviado por WhatsApp');
  } catch(e) { alert(`⚠️ ${e.message}`); }
  finally { btn.disabled = false; btn.textContent = '📤 Enviar Informe WA'; }
}

function escapeHtml(str) {
  return String(str||'').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

document.addEventListener('DOMContentLoaded', () => {
  loadPartsSelect();
});

document.getElementById('searchInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') buscar();
});
