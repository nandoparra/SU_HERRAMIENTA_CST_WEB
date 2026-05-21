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
    addon_contabilidad: document.getElementById('f_addon_contabilidad').checked ? 1 : 0,
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

// ── Init ──────────────────────────────────────────────────────────────────────
checkAuth();
