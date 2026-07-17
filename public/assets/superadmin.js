const API = '/superadmin/api';
let _editId = null;
let _logoId = null;

// ── Utilidades ────────────────────────────────────────────────────────────────
function showToast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.style.display = 'block';
  clearTimeout(t._to);
  t._to = setTimeout(() => t.style.display = 'none', 3000);
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const r = await fetch(API + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    await api('GET', '/me');
    showApp();
  } catch (_) {
    document.getElementById('loginScreen').style.display = 'flex';
  }
}

async function saLogin() {
  const btn = document.getElementById('saBtn');
  const err = document.getElementById('saErr');
  btn.disabled = true;
  err.textContent = '';
  try {
    await api('POST', '/login', { password: document.getElementById('saPass').value });
    showApp();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function saLogout() {
  await api('POST', '/logout').catch(() => {});
  location.reload();
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadTenants();
}

// ── Tabla tenants ─────────────────────────────────────────────────────────────
async function loadTenants() {
  try {
    const tenants = await api('GET', '/tenants');
    document.getElementById('tenantCount').textContent = `${tenants.length} tenant(s)`;
    const tbody = document.getElementById('tenantsTbody');
    tbody.innerHTML = tenants.map(t => `
      <tr>
        <td>${t.uid_tenant}</td>
        <td><strong style="color:#f1f5f9">${esc(t.ten_nombre)}</strong></td>
        <td><code style="font-size:12px;color:#a78bfa">${esc(t.ten_slug)}</code>${t.ten_slug_locked ? ' 🔒' : ''}</td>
        <td style="color:#64748b;font-size:12px">${t.ten_dominio_custom ? esc(t.ten_dominio_custom) : '—'}</td>
        <td>
          <span class="color-swatch" style="background:${esc(t.ten_color_primary)}"></span>${esc(t.ten_color_primary)}
          &nbsp;
          <span class="color-swatch" style="background:${esc(t.ten_color_accent)}"></span>${esc(t.ten_color_accent)}
        </td>
        <td><span class="badge badge-${esc(t.ten_estado)}">${esc(t.ten_estado)}</span></td>
        <td style="font-size:12px">${esc(t.ten_plan)}</td>
        <td style="font-size:12px;color:#64748b">${t.ten_vence ? t.ten_vence.slice(0,10) : '—'}</td>
        <td style="font-size:12px;color:#64748b">${t.ten_wa_number || '—'}</td>
        <td>
          <div class="td-actions">
            <button class="btn-sm btn-edit"  onclick="openEdit(${t.uid_tenant})">✏️ Editar</button>
            <button class="btn-sm btn-users" onclick="openUsers(${t.uid_tenant}, '${esc(t.ten_nombre)}')">👤 Usuarios</button>
            <button class="btn-sm btn-logo"  onclick="openLogo(${t.uid_tenant})">🖼 Logo</button>
            <button class="btn-sm btn-wa"    onclick="initWA(${t.uid_tenant})">📱 Init WA</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    showToast(e.message, true);
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Modal crear / editar ──────────────────────────────────────────────────────
function openCreate() {
  _editId = null;
  document.getElementById('modalTitle').textContent = 'Nuevo tenant';
  document.getElementById('f_nombre').value  = '';
  document.getElementById('f_slug').value    = '';
  document.getElementById('f_dominio').value = '';
  document.getElementById('f_colorPrimary').value = '#1d3557';
  document.getElementById('f_colorAccent').value  = '#e63946';
  document.getElementById('f_waNumber').value = '';
  document.getElementById('f_waParts').value  = '';
  document.getElementById('f_estado').value   = 'prueba';
  document.getElementById('f_plan').value     = 'mensual';
  document.getElementById('f_vence').value    = '';
  document.getElementById('f_addon_contabilidad').checked = false;
  document.getElementById('f_agente_wa').checked = false;
  document.getElementById('f_hora_inicio').value = 7;
  document.getElementById('f_hora_fin').value    = 21;
  document.getElementById('f_ten_nit').value              = '';
  document.getElementById('f_ten_direccion').value        = '';
  document.getElementById('f_ten_telefono_empresa').value = '';
  document.getElementById('f_ten_email').value            = '';
  document.getElementById('f_ten_website').value          = '';
  document.getElementById('f_slug').disabled  = false;
  document.getElementById('modalOverlay').classList.add('open');
}

async function openEdit(id) {
  _editId = id;
  try {
    const tenants = await api('GET', '/tenants');
    const t = tenants.find(x => x.uid_tenant === id);
    if (!t) return showToast('Tenant no encontrado', true);

    document.getElementById('modalTitle').textContent = `Editar tenant #${id}`;
    document.getElementById('f_nombre').value  = t.ten_nombre   || '';
    document.getElementById('f_slug').value    = t.ten_slug     || '';
    document.getElementById('f_dominio').value = t.ten_dominio_custom || '';
    document.getElementById('f_colorPrimary').value = t.ten_color_primary || '#1d3557';
    document.getElementById('f_colorAccent').value  = t.ten_color_accent  || '#e63946';
    document.getElementById('f_waNumber').value = t.ten_wa_number       || '';
    document.getElementById('f_waParts').value  = t.ten_wa_parts_number  || '';
    document.getElementById('f_estado').value   = t.ten_estado  || 'prueba';
    document.getElementById('f_plan').value     = t.ten_plan    || 'mensual';
    document.getElementById('f_vence').value    = t.ten_vence ? t.ten_vence.slice(0, 10) : '';
    document.getElementById('f_addon_contabilidad').checked = !!t.addon_contabilidad;
    document.getElementById('f_agente_wa').checked          = !!t.ten_agente_wa;
    document.getElementById('f_hora_inicio').value          = t.ten_agente_wa_hora_inicio ?? 7;
    document.getElementById('f_hora_fin').value             = t.ten_agente_wa_hora_fin    ?? 21;
    document.getElementById('f_ten_nit').value              = t.ten_nit              || '';
    document.getElementById('f_ten_direccion').value        = t.ten_direccion        || '';
    document.getElementById('f_ten_telefono_empresa').value = t.ten_telefono_empresa || '';
    document.getElementById('f_ten_email').value            = t.ten_email            || '';
    document.getElementById('f_ten_website').value          = t.ten_website          || '';
    document.getElementById('f_slug').disabled  = !!t.ten_slug_locked;
    document.getElementById('modalOverlay').classList.add('open');
  } catch (e) {
    showToast(e.message, true);
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

async function saveModal() {
  const body = {
    ten_nombre:        document.getElementById('f_nombre').value.trim(),
    ten_slug:          document.getElementById('f_slug').value.trim(),
    ten_dominio_custom:document.getElementById('f_dominio').value.trim() || null,
    ten_color_primary: document.getElementById('f_colorPrimary').value,
    ten_color_accent:  document.getElementById('f_colorAccent').value,
    ten_wa_number:     document.getElementById('f_waNumber').value.trim() || null,
    ten_wa_parts_number: document.getElementById('f_waParts').value.trim() || null,
    ten_estado:        document.getElementById('f_estado').value,
    ten_plan:          document.getElementById('f_plan').value,
    ten_vence:         document.getElementById('f_vence').value || null,
    addon_contabilidad:          document.getElementById('f_addon_contabilidad').checked ? 1 : 0,
    ten_agente_wa:               document.getElementById('f_agente_wa').checked ? 1 : 0,
    ten_agente_wa_hora_inicio:   Number(document.getElementById('f_hora_inicio').value) || 7,
    ten_agente_wa_hora_fin:      Number(document.getElementById('f_hora_fin').value)    || 21,
    ten_nit:              document.getElementById('f_ten_nit').value.trim()              || null,
    ten_direccion:        document.getElementById('f_ten_direccion').value.trim()        || null,
    ten_telefono_empresa: document.getElementById('f_ten_telefono_empresa').value.trim() || null,
    ten_email:            document.getElementById('f_ten_email').value.trim()            || null,
    ten_website:          document.getElementById('f_ten_website').value.trim()          || null,
  };

  if (!body.ten_nombre) return showToast('El nombre es obligatorio', true);

  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true;
  try {
    if (_editId) {
      await api('PATCH', `/tenants/${_editId}`, body);
      showToast('Tenant actualizado');
    } else {
      if (!body.ten_slug) return showToast('El slug es obligatorio', true);
      await api('POST', '/tenants', body);
      showToast('Tenant creado');
    }
    closeModal();
    loadTenants();
  } catch (e) {
    showToast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function openLogo(id) {
  _logoId = id;
  document.getElementById('logoFile').value = '';
  document.getElementById('logoOverlay').classList.add('open');
}
function closeLogo() {
  document.getElementById('logoOverlay').classList.remove('open');
}
async function uploadLogo() {
  const file = document.getElementById('logoFile').files[0];
  if (!file) return showToast('Selecciona un archivo', true);
  const fd = new FormData();
  fd.append('logo', file);
  try {
    await api('POST', `/tenants/${_logoId}/logo`, fd);
    showToast('Logo subido correctamente');
    closeLogo();
    loadTenants();
  } catch (e) {
    showToast(e.message, true);
  }
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
let _usersId = null;

async function openUsers(id, nombre) {
  _usersId = id;
  document.getElementById('usersTitle').textContent = `Usuarios — ${nombre}`;
  document.getElementById('u_nombre').value = '';
  document.getElementById('u_login').value  = '';
  document.getElementById('u_clave').value  = '';
  document.getElementById('u_tipo').value   = 'A';
  document.getElementById('usersOverlay').classList.add('open');
  await loadUsers();
}

function closeUsers() {
  document.getElementById('usersOverlay').classList.remove('open');
  _usersId = null;
}

async function loadUsers() {
  const wrap = document.getElementById('usersTableWrap');
  try {
    const users = await api('GET', `/tenants/${_usersId}/usuarios`);
    if (!users.length) {
      wrap.innerHTML = '<p style="color:#64748b;font-size:13px">Sin usuarios aún.</p>';
      return;
    }
    const tipoLabel = { A: 'Admin', F: 'Funcionario', T: 'Técnico' };
    wrap.innerHTML = `
      <table class="users-table">
        <thead><tr><th>#</th><th>Nombre</th><th>Login</th><th>Tipo</th><th>Estado</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td style="color:#64748b">${u.uid_usuario}</td>
              <td style="color:#f1f5f9">${esc(u.usu_nombre)}</td>
              <td><code style="color:#a78bfa;font-size:12px">${esc(u.usu_login)}</code></td>
              <td><span class="badge badge-${u.usu_tipo}">${esc(tipoLabel[u.usu_tipo] || u.usu_tipo)}</span></td>
              <td>
                <button class="btn-sm ${u.usu_estado === 'A' ? 'btn-wa' : 'btn-edit'}"
                  onclick="toggleUser(${u.uid_usuario}, '${u.usu_estado}')">
                  ${u.usu_estado === 'A' ? '✅ Activo' : '⛔ Inactivo'}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    wrap.innerHTML = `<p style="color:#f87171;font-size:13px">${esc(e.message)}</p>`;
  }
}

async function createUser() {
  const nombre = document.getElementById('u_nombre').value.trim();
  const login  = document.getElementById('u_login').value.trim();
  const clave  = document.getElementById('u_clave').value;
  const tipo   = document.getElementById('u_tipo').value;

  if (!nombre || !login || !clave) return showToast('Nombre, login y clave son obligatorios', true);

  const btn = document.getElementById('createUserBtn');
  btn.disabled = true;
  try {
    await api('POST', `/tenants/${_usersId}/usuarios`, {
      usu_nombre: nombre, usu_login: login, usu_clave: clave, usu_tipo: tipo,
    });
    showToast('Usuario creado');
    document.getElementById('u_nombre').value = '';
    document.getElementById('u_login').value  = '';
    document.getElementById('u_clave').value  = '';
    await loadUsers();
  } catch (e) {
    showToast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function toggleUser(uid, estadoActual) {
  const nuevo = estadoActual === 'A' ? 'I' : 'A';
  try {
    await api('PATCH', `/usuarios/${uid}`, { usu_estado: nuevo });
    showToast(nuevo === 'A' ? 'Usuario activado' : 'Usuario desactivado');
    await loadUsers();
  } catch (e) {
    showToast(e.message, true);
  }
}

// ── Init WA ───────────────────────────────────────────────────────────────────
async function initWA(id) {
  if (!confirm(`¿Inicializar WhatsApp para el tenant #${id}? Se mostrará el QR en la terminal del servidor.`)) return;
  try {
    const d = await api('POST', `/tenants/${id}/init-wa`);
    showToast(d.message || 'WA inicializado');
  } catch (e) {
    showToast(e.message, true);
  }
}

// ── Consumo IA ────────────────────────────────────────────────────────────────
function toggleIaUso() {
  const panel = document.getElementById('iaUsoPanel');
  if (panel.style.display === 'flex') {
    panel.style.display = 'none';
  } else {
    panel.style.display = 'flex';
    // Defaults: últimos 30 días
    const hoy    = new Date().toISOString().slice(0, 10);
    const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (!document.getElementById('iaDesde').value) document.getElementById('iaDesde').value = hace30;
    if (!document.getElementById('iaHasta').value) document.getElementById('iaHasta').value = hoy;
    loadIaUso();
  }
}

function closeIaUso() {
  document.getElementById('iaUsoPanel').style.display = 'none';
}

async function loadIaUso() {
  const el     = document.getElementById('iaUsoContenido');
  const desde  = document.getElementById('iaDesde')?.value  || '';
  const hasta  = document.getElementById('iaHasta')?.value  || '';
  el.innerHTML = '<p style="color:#64748b">Cargando...</p>';

  try {
    const params = new URLSearchParams();
    if (desde) params.set('fecha_desde', desde);
    if (hasta)  params.set('fecha_hasta', hasta);
    const rows = await api('GET', `/ia/uso?${params}`);

    if (!rows.length) {
      el.innerHTML = '<p style="color:#64748b;">Sin registros en ese período.</p>';
      return;
    }

    const fmtN   = n => Number(n).toLocaleString('es-CO');
    const fmtUSD = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

    // Agrupar por tenant
    const tenants = {};
    for (const r of rows) {
      if (!tenants[r.tenant_id]) tenants[r.tenant_id] = { nombre: r.ten_nombre, filas: [], subtotal: 0 };
      tenants[r.tenant_id].filas.push(r);
      tenants[r.tenant_id].subtotal += Number(r.costo_usd);
    }

    let html = '<div style="overflow-x:auto;">';
    for (const tid of Object.keys(tenants).sort((a, b) => a - b)) {
      const t = tenants[tid];
      html += `
        <div style="margin-bottom:20px;">
          <div style="padding:8px 12px;background:#0f172a;border-radius:6px 6px 0 0;display:flex;align-items:center;gap:12px;">
            <strong style="color:#a78bfa;font-size:13px;">Tenant #${esc(String(tid))} — ${esc(t.nombre)}</strong>
            <span style="margin-left:auto;font-size:12px;color:#94a3b8;">Subtotal: <strong style="color:#6ee7b7;">${fmtUSD(t.subtotal)}</strong></span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#1e293b;">
                <th style="padding:7px 10px;text-align:left;color:#64748b;font-weight:600;">Función</th>
                <th style="padding:7px 10px;text-align:left;color:#64748b;font-weight:600;">Modelo</th>
                <th style="padding:7px 10px;text-align:right;color:#64748b;font-weight:600;">Llamadas</th>
                <th style="padding:7px 10px;text-align:right;color:#64748b;font-weight:600;">Tokens entrada</th>
                <th style="padding:7px 10px;text-align:right;color:#64748b;font-weight:600;">Tokens salida</th>
                <th style="padding:7px 10px;text-align:right;color:#64748b;font-weight:600;">Costo USD</th>
              </tr>
            </thead>
            <tbody>
              ${t.filas.map((r, i) => `
                <tr style="background:${i % 2 === 0 ? '#0f172a55' : ''};">
                  <td style="padding:7px 10px;color:#e2e8f0;font-weight:500;">${esc(r.funcion)}</td>
                  <td style="padding:7px 10px;color:#64748b;font-size:11px;">${esc(r.modelo)}</td>
                  <td style="padding:7px 10px;text-align:right;color:#e2e8f0;">${fmtN(r.llamadas)}</td>
                  <td style="padding:7px 10px;text-align:right;color:#94a3b8;">${fmtN(r.total_input)}</td>
                  <td style="padding:7px 10px;text-align:right;color:#94a3b8;">${fmtN(r.total_output)}</td>
                  <td style="padding:7px 10px;text-align:right;color:#6ee7b7;font-weight:600;">${fmtUSD(r.costo_usd)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    const totalGeneral = Object.values(tenants).reduce((s, t) => s + t.subtotal, 0);
    html += `<div style="text-align:right;padding:10px 12px;background:#064e3b;border-radius:6px;font-size:13px;font-weight:700;color:#6ee7b7;">
      TOTAL GENERAL: ${fmtUSD(totalGeneral)}
    </div></div>`;

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<p style="color:#f87171;">Error: ${esc(e.message)}</p>`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkAuth();
