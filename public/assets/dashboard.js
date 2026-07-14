const API = '/api';
let _currentUser = null;

// ── Días hábiles colombianos ──────────────────────────────────────────────────
(function() {
  function pascua(y) {
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,
          f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
          h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
          l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
          mo=Math.floor((h+l-7*m+114)/31),dy=((h+l-7*m+114)%31)+1;
    return new Date(y,mo-1,dy);
  }
  function proxLunes(d) {
    const r=new Date(d), dow=r.getDay();
    if(dow===1) return r;
    r.setDate(r.getDate()+(dow===0?1:8-dow));
    return r;
  }
  const _cacheF={};
  function getFestivos(y) {
    if(_cacheF[y]) return _cacheF[y];
    const s=new Set();
    const add=d=>s.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    [[1,1],[5,1],[7,20],[8,7],[12,8],[12,25]].forEach(([m,d])=>add(new Date(y,m-1,d)));
    [[1,6],[3,19],[6,29],[8,15],[10,12],[11,1],[11,11]].forEach(([m,d])=>add(proxLunes(new Date(y,m-1,d))));
    const p=pascua(y);
    [-3,-2].forEach(o=>{const d=new Date(p);d.setDate(d.getDate()+o);add(d);});
    [39,60,68].forEach(o=>{const d=new Date(p);d.setDate(d.getDate()+o);add(proxLunes(d));});
    return (_cacheF[y]=s);
  }
  function esNoHabil(d) {
    const dow=d.getDay();
    if(dow===0||dow===6) return true;
    const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return getFestivos(d.getFullYear()).has(k);
  }
  window.addDiasHabiles = function(desde, n) {
    const d=new Date(desde); d.setHours(0,0,0,0);
    let c=0;
    while(c<n){d.setDate(d.getDate()+1);if(!esNoHabil(d))c++;}
    return d;
  };
  window.toInputDate = function(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
})();

// ── Shared utilities ──────────────────────────────────────────────────────────
function fmtFecha(raw) {
  const m = String(raw || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const iso = String(raw || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw || '-';
}
function money(n) { return '$' + Number(n || 0).toLocaleString('es-CO', {maximumFractionDigits:0}); }
function esc(s)   { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Badge de garantía para result-cards ───────────────────────────────────────
function ord_garantiaBadges(o) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  // Badge vencimiento garantía
  let venceBadge = '';
  if (o.ord_garantia_vence) {
    const vence = new Date(o.ord_garantia_vence); vence.setHours(0,0,0,0);
    const dias = Math.round((vence - hoy) / 86400000);
    if (dias < 0)
      venceBadge = `<span style="background:#c0392b;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">🔴 Garantía vencida</span>`;
    else if (dias <= 7)
      venceBadge = `<span style="background:#e67e22;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">⚠️ Vence en ${dias}d</span>`;
  }

  // Badge límite de revisión (48h hábiles)
  let revBadge = '';
  if (o.ord_revision_limite) {
    const rev = new Date(o.ord_revision_limite); rev.setHours(0,0,0,0);
    const dias = Math.round((rev - hoy) / 86400000);
    if (dias < 0)
      revBadge = `<span style="background:#922b21;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">⚠️ Revisión vencida</span>`;
    else if (dias === 0)
      revBadge = `<span style="background:#e67e22;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">🔔 Revisar hoy</span>`;
    else
      revBadge = `<span style="background:#2980b9;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">Revisar antes: ${fmtFecha(o.ord_revision_limite)}</span>`;
  }

  const sinFactura = !o.ord_factura
    ? `<span style="background:#fff3cd;color:#856404;border:1px solid #ffc107;font-size:10px;padding:1px 6px;border-radius:4px;">⚠️ Sin factura</span>`
    : '';
  return `<div style="margin:2px 0 3px;display:flex;flex-wrap:wrap;gap:3px;align-items:center;">
    <span style="background:#c0392b;color:#fff;font-size:10px;padding:1px 7px;border-radius:4px;font-weight:700;">GARANTÍA</span>
    ${revBadge}${venceBadge}${sinFactura}
  </div>`;
}
function showToast(msg, ms=3000) {
  const t = document.getElementById('_toast');
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity='0', ms);
}
function isAdmin()   { return _currentUser?.tipo === 'A'; }
function isTecnico() { return _currentUser?.tipo === 'T'; }

// ── Modal Cotizar por máquina ──────────────────────────────────────────────────
window.ord_abrirCotizar = (orderId, equipmentOrderId) => {
  document.getElementById('cotizarIframe').src =
    `/generador-cotizaciones.html?orden=${orderId}&maquina=${equipmentOrderId}`;
  document.getElementById('cotizarModal').style.display = 'flex';
};
window.cerrarModalCotizar = () => {
  document.getElementById('cotizarModal').style.display = 'none';
  document.getElementById('cotizarIframe').src = '';
};
window.addEventListener('message', e => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type === 'cotizacionGuardada') {
    cerrarModalCotizar();
    if (location.hash === '#cotizaciones') {
      cot_cargarPendientes();
    } else {
      ord_verDetalle(e.data.orderId);
    }
  }
});
document.getElementById('cotizarModal').addEventListener('click', e => {
  if (e.target === document.getElementById('cotizarModal')) cerrarModalCotizar();
});

// ── Sidebar / navigation shell ────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sbOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sbOverlay').classList.remove('show');
}

const VIEW_LABELS = {
  inicio:'Inicio', ordenes:'Órdenes', cotizaciones:'Cotizaciones',
  clientes:'Clientes', funcionarios:'Funcionarios', inventario:'Inventario',
  recibos:'Recibos', ventas:'Ventas', finanzas:'Finanzas', contable:'Contable',
  solicitudesTaller:'Recogidas', waConversaciones:'Conversaciones WA Agente',
  nuevaOrden:'Nueva Orden',
  misOrdenes:'Mis Órdenes', buscarOrden:'Buscar Orden'
};

const TEC_VIEWS = ['misOrdenes', 'buscarOrden'];

function navigate(viewName) {
  if (!Views[viewName]) return;
  // Técnicos solo pueden ver sus vistas
  if (isTecnico() && !TEC_VIEWS.includes(viewName)) return;
  closeSidebar();
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === viewName));
  document.getElementById('topbarTitle').textContent = VIEW_LABELS[viewName] || viewName;
  const vc = document.getElementById('viewContainer');
  vc.scrollTop = 0;
  vc.innerHTML = Views[viewName].render();
  Views[viewName].init();
  location.hash = viewName;
}

async function doLogout() {
  await fetch('/logout', { method:'POST' });
  location.href = '/login';
}

// ════════════════════════════════════════════════════════════════════════════
// VISTA: INICIO
// ════════════════════════════════════════════════════════════════════════════
const Views = {};

Views.inicio = {
  render() {
    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return `
      <div class="dash-wrap">
        <div class="dash-header">
          <h2>Resumen del negocio</h2>
          <div class="mes-selector">
            <input type="month" id="mesInput" value="${mes}" onchange="ini_load()">
          </div>
        </div>
        <div id="waBanner" style="display:none;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;">
          <span>📵 <strong>WhatsApp desconectado</strong> — no se podrán enviar mensajes a clientes.</span>
          <a href="/api/whatsapp/qr" target="_blank" style="margin-left:auto;white-space:nowrap;background:#1d3557;color:#fff;padding:5px 12px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px;">Conectar WhatsApp →</a>
        </div>
        <div class="kpi-grid" id="kpiGrid">
          <div class="kpi-card kc-grey" style="grid-column:1/-1;justify-content:center;align-items:center;min-height:80px;">
            <span style="color:#aaa;font-size:13px;">Cargando...</span>
          </div>
        </div>
        <div class="alertas-section" id="garantiasSection" style="display:none">
          <div class="alertas-header">
            <h3>🔴 Órdenes de garantía activas</h3>
          </div>
          <div id="garantiasList"></div>
        </div>
        <div class="alertas-section" id="alertasSection" style="display:none">
          <div class="alertas-header">
            <h3>⚠️ Equipos reparados pendientes de entrega</h3>
            <div class="alertas-legend">
              <div class="legend-dot"><div class="dot dot-y"></div>7-14 días</div>
              <div class="legend-dot"><div class="dot dot-o"></div>15-29 días</div>
              <div class="legend-dot"><div class="dot dot-r"></div>30+ días</div>
            </div>
          </div>
          <div id="alertasList"></div>
        </div>
        <div class="alertas-section" id="revSinCotSection" style="display:none">
          <div class="alertas-header">
            <h3>📝 Equipos revisados pendientes de cotizar</h3>
          </div>
          <div id="revSinCotList"></div>
        </div>
        <div id="solPendSection" style="display:none">
          <div class="alertas-section" style="cursor:pointer" onclick="navigate('solicitudesTaller')">
            <div class="alertas-header">
              <h3>🚗 Solicitudes de recogida pendientes</h3>
            </div>
            <div id="solPendList"></div>
          </div>
        </div>
      </div>`;
  },
  async init() {
    window.ini_load = async () => {
      const mes = document.getElementById('mesInput')?.value || '';
      // Banner WhatsApp
      fetch(`${API}/whatsapp/status`).then(r=>r.json()).then(d => {
        const b = document.getElementById('waBanner');
        if (b) b.style.display = d.connected ? 'none' : 'flex';
      }).catch(()=>{});
      const data = await fetch(`${API}/dashboard?mes=${mes}`).then(r=>r.json()).catch(()=>null);
      if (!data) return;
      const k = data.kpis;
      const _mes = document.getElementById('mesInput')?.value || '';
      document.getElementById('kpiGrid').innerHTML = `
        <div class="kpi-card kc-blue" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('','Órdenes del mes','${mes}'),80)">
          <div class="kpi-icon">📋</div>
          <div class="kpi-val">${k.total_ordenes}</div>
          <div class="kpi-lbl">Órdenes del mes</div>
        </div>
        <div class="kpi-card kc-orange" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('cotizada','Cotizadas — esperando respuesta',''),80)">
          <div class="kpi-icon">💬</div>
          <div class="kpi-val">${k.cotizadas}</div>
          <div class="kpi-lbl">Cotizadas — esperando respuesta</div>
        </div>
        <div class="kpi-card kc-green" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('autorizada','Autorizadas — en reparación',''),80)">
          <div class="kpi-icon">✅</div>
          <div class="kpi-val">${k.autorizadas}</div>
          <div class="kpi-lbl">Autorizadas — en reparación</div>
        </div>
        <div class="kpi-card kc-purple" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('reparada','Reparadas — pendientes entrega',''),80)">
          <div class="kpi-icon">🔧</div>
          <div class="kpi-val">${k.reparadas}</div>
          <div class="kpi-lbl">Reparadas — pendientes entrega</div>
        </div>
        <div class="kpi-card kc-red" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('no_autorizada','No autorizadas',''),80)">
          <div class="kpi-icon">🚫</div>
          <div class="kpi-val">${k.no_autorizadas}</div>
          <div class="kpi-lbl">No autorizadas</div>
        </div>
        <div class="kpi-card kc-teal" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('entregada','Entregadas',''),80)">
          <div class="kpi-icon">📦</div>
          <div class="kpi-val">${k.entregadas}</div>
          <div class="kpi-lbl">Entregadas</div>
        </div>
        <div class="kpi-card kc-grey" onclick="navigate('ordenes');setTimeout(()=>ord_filtrarPorEstado('pendiente_revision','Pendientes de revisión',''),80)">
          <div class="kpi-icon">🔍</div>
          <div class="kpi-val">${k.pendiente_revision + k.revisadas}</div>
          <div class="kpi-lbl">Pendientes de revisión</div>
        </div>`;

      const sec = document.getElementById('alertasSection');
      const lst = document.getElementById('alertasList');
      if (!data.alertas.length) {
        sec.style.display = 'block';
        lst.innerHTML = '<div class="alertas-empty">✅ Sin equipos reparados pendientes de entrega</div>';
      } else {
        sec.style.display = 'block';
        lst.innerHTML = data.alertas.map(a => `
          <div class="alerta-row alerta-${a.rango}" onclick="navigate('ordenes');setTimeout(()=>ord_verDetalle(${a.uid_orden}),50)">
            <div class="alerta-info">
              <div class="alerta-maq">${esc(a.her_nombre||'')} ${esc(a.her_marca||'')}</div>
              <div class="alerta-cli">${esc(a.cliente)}</div>
              <div class="alerta-orden">Orden #${a.ord_consecutivo}</div>
            </div>
            <div class="dias-badge dias-${a.rango}">${a.dias} día${a.dias!==1?'s':''}</div>
          </div>`).join('');
      }

      const rsc = data.revisadasSinCotizar || [];
      const rscSec = document.getElementById('revSinCotSection');
      const rscLst = document.getElementById('revSinCotList');
      if (rscSec && rscLst) {
        rscSec.style.display = 'block';
        if (!rsc.length) {
          rscLst.innerHTML = '<div class="alertas-empty">✅ Todas las máquinas revisadas ya tienen cotización</div>';
        } else {
          rscLst.innerHTML = rsc.map(r => `
            <div class="alerta-row alerta-amarillo" onclick="navigate('cotizaciones');setTimeout(()=>cot_loadById(${r.uid_orden}),80)" style="cursor:pointer">
              <div class="alerta-info">
                <div class="alerta-maq">${esc(r.her_nombre||'')} ${esc(r.her_marca||'')}</div>
                <div class="alerta-cli">${esc(r.cliente)}</div>
                <div class="alerta-orden">Orden #${r.ord_consecutivo}</div>
              </div>
              <div class="dias-badge dias-amarillo">Cotizar</div>
            </div>`).join('');
        }
      }

      // Solicitudes de recogida pendientes — KPI card + sección detalle
      fetch('/api/taller/solicitudes-recogida?estado=pendiente').then(r => r.json()).then(solRows => {
        const count = Array.isArray(solRows) ? solRows.length : 0;
        // KPI card (solo aparece si hay pendientes)
        const grid = document.getElementById('kpiGrid');
        const existCard = document.getElementById('solKpiCard');
        if (existCard) existCard.remove();
        if (count > 0 && grid) {
          grid.insertAdjacentHTML('beforeend',
            `<div id="solKpiCard" class="kpi-card kc-orange" onclick="navigate('solicitudesTaller')" style="cursor:pointer">
               <div class="kpi-icon">🚗</div>
               <div class="kpi-val">${count}</div>
               <div class="kpi-lbl">Recogida${count !== 1 ? 's' : ''} pendiente${count !== 1 ? 's' : ''}</div>
             </div>`
          );
        }
        // Sección detalle
        const solSec = document.getElementById('solPendSection');
        const solLst = document.getElementById('solPendList');
        if (!solSec || !solLst || !count) { if (solSec) solSec.style.display = 'none'; return; }
        solSec.style.display = 'block';
        solLst.innerHTML = solRows.slice(0, 5).map(s => {
          const cliente = esc(s.cli_razon_social || s.cli_contacto || 'Cliente');
          const equipos = (s.maquinas || []).map(m => esc(m.her_nombre)).join(', ') || '—';
          const fecha   = s.fecha_sugerida ? s.fecha_sugerida.split('T')[0].split('-').reverse().join('/') : '';
          return `<div class="alerta-row alerta-amarillo">
            <div class="alerta-info">
              <div class="alerta-maq">${equipos}</div>
              <div class="alerta-cli">${cliente}</div>
              ${fecha ? `<div class="alerta-orden">Fecha sugerida: ${fecha}</div>` : ''}
            </div>
            <div class="dias-badge dias-amarillo">Pendiente</div>
          </div>`;
        }).join('');
        if (solRows.length > 5) {
          solLst.innerHTML += `<div class="alertas-empty">… y ${solRows.length - 5} más — ver todas en Recogidas</div>`;
        }
      }).catch(() => {});

      // Garantías activas
      const garantias = data.garantiasActivas || [];
      const garSec = document.getElementById('garantiasSection');
      const garLst = document.getElementById('garantiasList');
      if (garSec && garLst) {
        if (!garantias.length) {
          garSec.style.display = 'none';
        } else {
          garSec.style.display = 'block';
          const GAR_ESTADO = {
            pendiente_revision: { bg:'#888',     label:'Pendiente' },
            revisada:           { bg:'#2196F3',  label:'Revisada' },
            cotizada:           { bg:'#FF9800',  label:'Cotizada' },
            autorizada:         { bg:'#4CAF50',  label:'Autorizada' },
            no_autorizada:      { bg:'#F44336',  label:'No autorizada' },
            reparada:           { bg:'#9C27B0',  label:'Reparada' },
          };
          garLst.innerHTML = garantias.map(g => {
            const hoy = new Date(); hoy.setHours(0,0,0,0);

            // Badge vencimiento garantía (30 días hábiles)
            let venceBadge = '';
            if (g.ord_garantia_vence) {
              const vence = new Date(g.ord_garantia_vence); vence.setHours(0,0,0,0);
              const dias = Math.round((vence - hoy) / 86400000);
              if (dias < 0)
                venceBadge = `<span class="dias-badge" style="background:#c0392b;color:#fff;">🔴 Garantía vencida</span>`;
              else if (dias <= 7)
                venceBadge = `<span class="dias-badge" style="background:#e67e22;color:#fff;">⚠️ Vence en ${dias}d</span>`;
              else
                venceBadge = `<span class="dias-badge" style="background:#27ae60;color:#fff;">Vence: ${fmtFecha(g.ord_garantia_vence)}</span>`;
            }

            // Badge límite de revisión — solo si aún hay máquinas pendientes de revisar
            let revBadge = '';
            if (g.ord_revision_limite && g.pendientes_count > 0) {
              const rev = new Date(g.ord_revision_limite); rev.setHours(0,0,0,0);
              const dias = Math.round((rev - hoy) / 86400000);
              if (dias < 0)
                revBadge = `<span class="dias-badge" style="background:#922b21;color:#fff;">⚠️ Revisión vencida</span>`;
              else if (dias === 0)
                revBadge = `<span class="dias-badge" style="background:#e67e22;color:#fff;">🔔 Revisar hoy</span>`;
              else
                revBadge = `<span class="dias-badge" style="background:#2980b9;color:#fff;">Revisar antes: ${fmtFecha(g.ord_revision_limite)}</span>`;
            }

            const sinFactura = g.sin_factura
              ? `<span style="display:inline-block;font-size:11px;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:4px;padding:1px 7px;">⚠️ Sin factura adjunta</span>`
              : '';

            // Parsear máquinas: formato "nombre||estado||fecha_vence;;nombre2||..."
            const maquinasHtml = (g.maquinas || '').split(';;').map(raw => {
              const parts = raw.split('||');
              const nombre = parts[0] || '';
              const estado = parts.length > 1 ? parts[1] : null;
              const vence  = parts.length > 2 ? parts[2] : '';
              const ec = (estado && GAR_ESTADO[estado]) || { bg:'#888', label: estado || '' };
              const estBadge = ec.label
                ? `<span style="background:${ec.bg};color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:700;flex-shrink:0;">${ec.label}</span>`
                : '';
              const venceStr = vence ? ` <span style="font-size:11px;color:#888;">(vence: ${fmtFecha(vence)})</span>` : '';
              return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;">${estBadge} ${esc(nombre||'')}${venceStr}</div>`;
            }).join('');

            return `
              <div class="alerta-row alerta-rojo" onclick="navigate('ordenes');setTimeout(()=>ord_verDetalle(${g.uid_orden}),50)" style="cursor:pointer;">
                <div class="alerta-info" style="flex:1;">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
                    <span style="background:#c0392b;color:#fff;font-size:11px;padding:1px 7px;border-radius:4px;font-weight:700;">GARANTÍA</span>
                    <span style="font-size:12px;font-weight:700;color:#1d3557;">Orden #${g.ord_consecutivo}</span>
                    <span style="font-size:12px;color:#555;">${esc(g.cliente)}</span>
                  </div>
                  <div>${maquinasHtml}</div>
                  <div style="font-size:11px;color:#aaa;margin-top:3px;">Ingreso: ${fmtFecha(g.ord_fecha)}</div>
                  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;">
                    ${revBadge}${venceBadge}${sinFactura}
                  </div>
                </div>
              </div>`;
          }).join('');
        }
      }
    };

    await window.ini_load();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: ÓRDENES
// ════════════════════════════════════════════════════════════════════════════
Views.ordenes = {
  _timer: null,
  render() {
    return `
      <div class="two-panel" id="ordPanel">
        <div class="pnl-left">
          <div class="search-box">
            <h2>Buscar orden</h2>
            <div class="concept-row">
              <select id="ordConcepto" onchange="ord_placeholder()">
                <option value="consecutivo">Número de orden</option>
                <option value="cedula">Cédula / NIT</option>
                <option value="nombre">Nombre del cliente</option>
              </select>
            </div>
            <div class="input-row">
              <input id="ordSearch" type="text" placeholder="Ej: 7833" oninput="ord_debounce()">
              <button onclick="ord_buscar()">🔍</button>
            </div>
          </div>
          <div class="results-list" id="ordResults">
            <div class="results-empty">Escribe para buscar</div>
          </div>
        </div>
        <div class="pnl-right" id="ordRight">
          <div class="mobile-back" onclick="ord_back()">← Volver a resultados</div>
          <div class="empty-state">
            <div class="es-icon">📋</div>
            <p>Selecciona una orden para ver el detalle</p>
          </div>
        </div>
      </div>`;
  },
  init() {
    const PLCH = { consecutivo:'Ej: 7833', cedula:'Ej: 8914110164', nombre:'Ej: Cliente X' };
    const ELBL = { pendiente_revision:'Pendiente revisión',revisada:'Revisada',cotizada:'Cotizada',autorizada:'Autorizada',no_autorizada:'No autorizada',reparada:'Reparada',entregada:'Entregada' };

    window.ord_placeholder = () => {
      const v = document.getElementById('ordConcepto')?.value;
      const si = document.getElementById('ordSearch');
      if (si) { si.placeholder = PLCH[v]||''; si.value=''; }
      const rl = document.getElementById('ordResults');
      if (rl) rl.innerHTML = '<div class="results-empty">Escribe para buscar</div>';
    };
    window.ord_debounce = () => {
      clearTimeout(Views.ordenes._timer);
      Views.ordenes._timer = setTimeout(ord_buscar, 350);
    };
    window.ord_buscar = async () => {
      const q = document.getElementById('ordSearch')?.value.trim();
      if (!q) return;
      const rl = document.getElementById('ordResults');
      if (!rl) return;
      rl.innerHTML = '<div class="results-empty">Buscando...</div>';
      const data = await fetch(`${API}/orders/search?q=${encodeURIComponent(q)}`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) { rl.innerHTML='<div class="results-empty">Sin resultados</div>'; return; }
      rl.innerHTML = data.map(o=>`
        <div class="result-card" onclick="ord_verDetalle(${o.uid_orden})">
          <div class="rc-top">
            <span class="rc-num">Orden #${o.ord_consecutivo}</span>
            <span class="rc-fecha">${fmtFecha(o.ord_fecha)}</span>
          </div>
          ${o.ord_tipo==='garantia' ? ord_garantiaBadges(o) : ''}
          <div class="rc-cliente">${esc(o.cli_razon_social||'')}</div>
          <div class="rc-maq">${esc(o.maquinas_resumen||(o.maquinas?o.maquinas+' máquina(s)':''))}</div>
        </div>`).join('');
    };
    window.ord_back = () => {
      document.getElementById('ordPanel')?.classList.remove('immersive');
    };
    window.ord_verDetalle = async (uid) => {
      document.querySelectorAll('#ordResults .result-card').forEach(el => {
        el.classList.toggle('active', el.onclick?.toString().includes(`(${uid})`));
      });
      const right = document.getElementById('ordRight');
      if (!right) return;
      document.getElementById('ordPanel')?.classList.add('immersive');
      right.innerHTML = `
        <div class="mobile-back" onclick="ord_back()">← Volver a resultados</div>
        <div style="padding:20px;color:#888;text-align:center;">Cargando...</div>`;
      const data = await fetch(`${API}/orders/${uid}/detalle`).then(r=>r.json()).catch(e=>({error:e.message}));
      if (data.error) { right.innerHTML=`<div class="mobile-back" onclick="ord_back()">← Volver</div><div style="padding:20px;color:#e74c3c;">${data.error}</div>`; return; }
      window._ordDetalleActual = data;
      const {orden,maquinas,tieneCotizacion,cotOrden} = data;

      const maqHtml = maquinas.map(m => {
        const lbl = ELBL[m.her_estado]||m.her_estado||'-';
        const bc  = 'badge b-'+(m.her_estado||'pendiente_revision');
        const sub = [m.her_marca,m.her_serial?'S/N: '+m.her_serial:null,m.her_referencia?'Ref: '+m.her_referencia:null].filter(Boolean).join(' | ');
        const opts = Object.entries(ELBL).map(([v,l])=>`<option value="${v}"${(m.her_estado||'pendiente_revision')===v?' selected':''}>${l}</option>`).join('');
        const fotosRecHtml = (m.fotos||[]).map(f=>`
          <div class="foto-thumb" id="fr-${f.uid_foto_herramienta_orden}">
            <img src="/uploads/fotos-recepcion/${f.fho_archivo}" onclick="window.open(this.src,'_blank')" alt="">
            <button class="del-btn" onclick="ord_delFotoRec(${f.uid_foto_herramienta_orden},event)">✕</button>
          </div>`).join('');
        const fotosRec = `<div class="foto-row" id="fr-row-${m.uid_herramienta_orden}">${fotosRecHtml || '<div class=\'sin-fotos\'>Sin fotos de recepción</div>'}</div>`;
        const fotosTrab = (m.fotos_trabajo||[]).map(f=>`
          <div class="foto-thumb" id="ft-${f.uid_foto_herramienta_orden}">
            <img src="/uploads/fotos-recepcion/${f.fho_archivo}" onclick="window.open(this.src,'_blank')" alt="">
            <button class="del-btn" onclick="ord_delFoto(${f.uid_foto_herramienta_orden},event)">✕</button>
          </div>`).join('');
        const informesHtml = (m.informes?.length)
          ? m.informes.map(inf=>{
              const fd = new Date(inf.inf_fecha).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
              return `<div class="informe-row"><span>${fd}</span><a href="${API}/informes/${inf.uid_informe}" target="_blank">⬇ Descargar</a></div>`;
            }).join('')
          : '<div class="sin-informes">Sin informes generados</div>';
        let cotHtml = '';
        if (m.cotizacion) {
          const c = m.cotizacion;
          cotHtml = `<div class="cot-section">
            <div class="cot-title">💰 Cotización</div>
            <div class="cot-row"><span class="lbl">Mano de obra</span><span class="val">${money(c.mano_obra)}</span></div>
            ${c.descripcion_trabajo?`<div class="cot-row" style="flex-direction:column;gap:2px;"><span class="lbl">Trabajo</span><span style="font-size:12px;color:#444;margin-top:2px;">${esc(c.descripcion_trabajo)}</span></div>`:''}
            ${c.items.length?`<div class="cot-items">${c.items.map(it=>`<div class="cot-item">${it.cantidad}x ${esc(it.nombre)} — ${money(it.precio)} c/u</div>`).join('')}</div>`:''}
            <div class="cot-subtotal"><span>Subtotal</span><span>${money(c.subtotal)}</span></div>
          </div>`;
        }
        const garantiaBadge = m.hor_es_garantia ? (() => {
          const hoy = new Date(); hoy.setHours(0,0,0,0);
          let vb = '';
          if (m.hor_garantia_vence) {
            const vd = new Date(m.hor_garantia_vence); vd.setHours(0,0,0,0);
            const dias = Math.round((vd - hoy) / 86400000);
            if (dias < 0) vb = `<span style="background:#c0392b;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">🔴 Garantía vencida</span>`;
            else if (dias <= 7) vb = `<span style="background:#e67e22;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">⚠️ Vence en ${dias}d</span>`;
            else vb = `<span style="background:#2980b9;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">Garantía: ${fmtFecha(m.hor_garantia_vence)}</span>`;
          }
          return `<div style="margin:3px 0;display:flex;flex-wrap:wrap;gap:3px;">
            <span style="background:#c0392b;color:#fff;font-size:10px;padding:1px 7px;border-radius:4px;font-weight:700;">GARANTÍA</span>
            ${vb}
            ${!m.hor_garantia_factura ? `<span style="background:#fff3cd;color:#856404;border:1px solid #ffc107;font-size:10px;padding:1px 6px;border-radius:4px;">⚠️ Sin factura</span>` : ''}
          </div>`;
        })() : '';
        return `
          <div class="maq-card">
            <div class="maq-top">
              <div>
                <div class="maq-nombre">${esc(m.her_nombre||'-')}</div>
                ${sub?`<div class="maq-sub">${esc(sub)}</div>`:''}
                ${garantiaBadge}
              </div>
              <span id="badge-${m.uid_herramienta_orden}" class="${bc}">${lbl}</span>
            </div>
            <div class="maq-actions">
              <select class="estado-select" data-prev="${m.her_estado||'pendiente_revision'}"
                      onchange="ord_cambiarEstado(${m.uid_herramienta_orden},${orden.uid_orden},this)">${opts}</select>
              <button class="btn btn-sm btn-mid" onclick="ord_abrirCotizar(${orden.uid_orden},${m.uid_herramienta_orden})">✏️ Cotizar</button>
              <button class="btn btn-sm btn-teal" onclick="ord_verInforme(${orden.uid_orden},${m.uid_herramienta_orden})">📋 Informe</button>
              ${m.informes?.length?`<button class="btn btn-sm btn-green" onclick="ord_enviarInformeWA(${orden.uid_orden},${m.uid_herramienta_orden},this)">📤 WA Informe</button>`:''}
              ${m.hor_es_garantia && m.hor_garantia_factura ? `<a class="btn btn-sm btn-teal" href="/uploads/facturas-garantia/${esc(m.hor_garantia_factura)}" target="_blank">📄 Factura</a>` : ''}
              ${m.hor_es_garantia && !m.hor_garantia_factura ? `<label class="btn btn-sm btn-teal" style="cursor:pointer;">📎 Adjuntar factura<input type="file" accept=".pdf" style="display:none" onchange="ord_subirFacturaMaquina(${orden.uid_orden},${m.uid_herramienta_orden},this)"></label>` : ''}
            </div>
            ${m.hor_observaciones?`<div class="maq-obs"><div class="maq-obs-lbl">Observaciones</div>${esc(m.hor_observaciones)}</div>`:''}
            ${(m.historial||[]).length ? `
            <div class="historial-section">
              <div class="maq-obs-lbl" style="margin-bottom:6px;">Historial de estados</div>
              <div class="historial-timeline">
                ${m.historial.map(h => {
                  const ec = { pendiente_revision:'#888',revisada:'#2196F3',cotizada:'#FF9800',autorizada:'#4CAF50',no_autorizada:'#F44336',reparada:'#9C27B0',entregada:'#009688' };
                  const color = ec[h.estado] || '#888';
                  const lbl = ELBL[h.estado] || h.estado;
                  const dt = new Date(h.changed_at);
                  const fecha = `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
                  return `<div class="historial-row">
                    <div class="historial-dot" style="background:${color}"></div>
                    <div><span class="historial-estado">${lbl}</span><span class="historial-fecha">${fecha}</span></div>
                  </div>`;
                }).join('')}
              </div>
            </div>` : ''}
            <div class="fotos-seccion">
              <div class="fotos-lbl">Recepción</div>
              ${fotosRec}
              <label class="upload-foto-btn">+ Agregar fotos
                <input type="file" accept="image/*" multiple style="display:none"
                  onchange="ord_uploadFotoRec(${orden.uid_orden},${m.uid_herramienta_orden},this)">
              </label>
            </div>
            <div class="fotos-seccion">
              <div class="fotos-lbl fotos-trabajo-lbl">Del trabajo</div>
              <div class="foto-row" id="ft-row-${m.uid_herramienta_orden}">${fotosTrab}</div>
              <label class="upload-foto-btn">+ Agregar fotos
                <input type="file" accept="image/*" multiple style="display:none"
                  onchange="ord_uploadFoto(${orden.uid_orden},${m.uid_herramienta_orden},this)">
              </label>
            </div>
            <div class="informes-section">
              <div class="informes-title">📋 Informes de mantenimiento</div>${informesHtml}
            </div>
            ${cotHtml}
            ${m.her_estado === 'entregada' && m.hor_entrega_nombre ? `
            <div style="margin-top:12px;padding:12px 14px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
              <div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;">📦 Datos de entrega</div>
              <div style="font-size:13px;color:#15803d;display:flex;flex-wrap:wrap;gap:6px 18px;margin-bottom:8px;">
                <span><strong>Recibió:</strong> ${esc(m.hor_entrega_nombre)}</span>
                <span><strong>Tel:</strong> ${esc(m.hor_entrega_telefono||'—')}</span>
                ${m.hor_entrega_cedula ? `<span><strong>Cédula:</strong> ${esc(m.hor_entrega_cedula)}</span>` : ''}
                ${m.hor_entrega_fecha ? `<span><strong>Fecha:</strong> ${new Date(m.hor_entrega_fecha).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>` : ''}
              </div>
              ${m.hor_entrega_firma ? `<div style="margin-top:6px;"><div style="font-size:11px;color:#166534;margin-bottom:4px;font-weight:600;">Firma:</div><img src="/uploads/firmas-entrega/${esc(m.hor_entrega_firma)}" alt="firma" style="max-width:280px;border:1px solid #86efac;border-radius:5px;background:#fff;display:block;"></div>` : ''}
            </div>` : ''}
          </div>`;
      }).join('');

      const totalHtml = cotOrden ? `
        <div class="total-card">
          <div class="tc-item"><div class="tc-lbl">Subtotal</div><div class="tc-val">${money(cotOrden.subtotal)}</div></div>
          ${Number(cotOrden.iva)>0?`<div class="tc-item"><div class="tc-lbl">IVA</div><div class="tc-val">${money(cotOrden.iva)}</div></div>`:''}
          <div class="tc-item"><div class="tc-lbl">Total</div><div class="tc-val big">${money(cotOrden.total)}</div></div>
        </div>` : '';

      right.innerHTML = `
        <div class="mobile-back" onclick="ord_back()">← Volver a resultados</div>
        <div style="padding:22px;">
          <div class="ord-detail-header">
            <span class="ord-num">Orden #${orden.ord_consecutivo}</span>
            <span class="ord-fecha">${fmtFecha(orden.ord_fecha)}</span>
          </div>
          <div class="card">
            <div class="card-title">Cliente</div>
            <div class="client-grid">
              <div class="field"><span class="lbl">Nombre / Razón social</span><span class="val">${esc(orden.cli_razon_social||'-')}</span></div>
              <div class="field"><span class="lbl">Cédula / NIT</span><span class="val">${esc(orden.cli_identificacion||'-')}</span></div>
              <div class="field"><span class="lbl">Teléfono</span><span class="val">${esc(orden.cli_telefono||'-')}</span></div>
              <div class="field"><span class="lbl">Dirección</span><span class="val">${esc(orden.cli_direccion||'-')}</span></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
              <span>Equipos (${maquinas.length})</span>
              <button class="btn btn-sm btn-primary" onclick="ord_abrirAgregarMaquina(${orden.uid_orden},${orden.uid_cliente})">+ Agregar máquina</button>
            </div>
            ${maqHtml}
          </div>
          ${totalHtml}
          <div class="ord-acciones">
            <a class="btn btn-dark" href="${API}/orders/${orden.uid_orden}/print/orden" target="_blank">🖨️ Imprimir orden</a>
            ${orden.ord_tipo==='garantia' && orden.ord_factura ? `<a class="btn btn-teal" href="/uploads/facturas-garantia/${orden.ord_factura}" target="_blank">📄 Factura garantía</a>` : ''}
            ${orden.ord_tipo==='garantia' && !orden.ord_factura ? `<label class="btn btn-teal" style="cursor:pointer;">📎 Adjuntar factura<input type="file" accept=".pdf" style="display:none" onchange="ord_subirFactura(${orden.uid_orden},this)"></label>` : ''}
            ${tieneCotizacion?`
            <a class="btn btn-purple" href="${API}/orders/${orden.uid_orden}/pdf/quote" target="_blank">📄 PDF Cotización</a>
            <button class="btn btn-mid" onclick="ord_enviarPDFCotWA(${orden.uid_orden},this)">📤 PDF Cotización WA</button>
            <button class="btn btn-orange" onclick="ord_generarMsgCot(${orden.uid_orden},this)">🤖 Generar mensaje</button>
            <button class="btn btn-orange" id="btnSendCotWA-${orden.uid_orden}" onclick="ord_enviarCotWA(${orden.uid_orden},this)" disabled>📱 Enviar WA</button>
            <button class="btn btn-green" onclick="ord_generarVenta(${orden.uid_orden},this)">💳 Generar venta</button>
            ${orden.ord_factura_estado==='emitida'
              ? `<a class="btn btn-teal" href="${orden.ord_alegra_url||'#'}" target="_blank">✅ Factura emitida</a>`
              : `<button class="btn btn-teal" onclick="ord_abrirModalFactura(${orden.uid_orden})">📄 Factura electrónica</button>`
            }
            <div id="msgPreview-${orden.uid_orden}" style="display:none;margin:8px 0;padding:10px 12px;background:#f1f8e9;border-left:3px solid #66bb6a;border-radius:4px;white-space:pre-wrap;font-size:13px;line-height:1.5;max-height:220px;overflow-y:auto;"></div>
            `:''}
          </div>
        </div>`;
    };
    window.ord_cambiarEstado = async (uid, uidOrden, sel) => {
      const nuevo = sel.value; const prev = sel.dataset.prev||nuevo;
      // Entregar requiere captura de datos y firma — abre modal dedicado
      if (nuevo === 'entregada') {
        sel.value = prev; // revertir selector visualmente mientras se llena el modal
        ord_mostrarModalEntrega(uid, uidOrden, sel, prev);
        return;
      }
      sel.disabled = true;
      try {
        const r = await fetch(`${API}/equipment-order/${uid}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:nuevo})});
        const d = await r.json();
        if (d.success) {
          sel.dataset.prev = nuevo;
          const b = document.getElementById(`badge-${uid}`);
          if (b) { b.className='badge b-'+nuevo; b.textContent=ELBL[nuevo]||nuevo; }
          if (nuevo === 'autorizada') {
            try {
              const rp = await fetch(`${API}/orders/${uidOrden}/notify-parts`,{method:'POST'}).then(r=>r.json());
              showToast(rp.success ? '✅ Lista repuestos enviada al encargado' : '⚠️ '+(rp.error||'Error'));
            } catch(e) { showToast('⚠️ WA repuestos: '+e.message); }
          } else if (nuevo === 'reparada') {
            showToast('✅ Estado actualizado — WA enviado automáticamente al cliente');
          }
        } else { alert('Error: '+(d.error||'desconocido')); sel.value=prev; }
      } catch(e) { alert(e.message); sel.value=prev; }
      sel.disabled = false;
    };
    window._cotMsgs = {};
    window.ord_generarMsgCot = async (uidOrden, btn) => {
      const orig=btn.textContent; btn.disabled=true; btn.textContent='⏳ Generando...';
      try {
        const r = await fetch(`${API}/quotes/order/${uidOrden}/generate-message`,{method:'POST'}).then(r=>r.json());
        if (!r.success) throw new Error(r.error||'Error generando mensaje');
        window._cotMsgs[uidOrden] = r.message || '';
        const preview = document.getElementById(`msgPreview-${uidOrden}`);
        if (preview) { preview.textContent = window._cotMsgs[uidOrden]; preview.style.display='block'; }
        const sendBtn = document.getElementById(`btnSendCotWA-${uidOrden}`);
        if (sendBtn) sendBtn.disabled = false;
        showToast('✅ Mensaje generado — revísalo y envíalo');
      } catch(e) { alert('⚠️ '+e.message); }
      btn.disabled=false; btn.textContent=orig;
    };
    window.ord_subirFactura = async (uidOrden, input) => {
      const file = input.files?.[0];
      if (!file) return;
      const label = input.parentElement;
      const orig = label.childNodes[0].textContent;
      label.childNodes[0].textContent = '⏳ Subiendo...';
      try {
        const fd = new FormData();
        fd.append('factura', file);
        const r = await fetch(`${API}/crear-orden/factura/${uidOrden}`, { method: 'POST', body: fd }).then(r=>r.json());
        if (!r.success) throw new Error(r.error || 'Error subiendo');
        showToast('✅ Factura adjuntada correctamente');
        ord_verDetalle(uidOrden);
      } catch(e) {
        label.childNodes[0].textContent = orig;
        showToast('⚠️ Error: ' + e.message);
      }
    };

    window.ord_subirFacturaMaquina = async (uidOrden, uidHerramientaOrden, input) => {
      const file = input.files?.[0];
      if (!file) return;
      const label = input.parentElement;
      const orig = label.childNodes[0].textContent;
      label.childNodes[0].textContent = '⏳ Subiendo...';
      try {
        const fd = new FormData();
        fd.append('factura', file);
        const r = await fetch(`${API}/orders/${uidOrden}/factura-maquina/${uidHerramientaOrden}`, { method: 'POST', body: fd }).then(r=>r.json());
        if (!r.success) throw new Error(r.error || 'Error subiendo');
        showToast('✅ Factura adjuntada correctamente');
        ord_verDetalle(uidOrden);
      } catch(e) {
        label.childNodes[0].textContent = orig;
        showToast('⚠️ Error: ' + e.message);
      }
    };

    // ── Modal agregar máquina ─────────────────────────────────────────────────
    let _amUidOrden = null, _amUidCliente = null, _amModoNueva = false;

    window.ord_abrirAgregarMaquina = async (uidOrden, uidCliente) => {
      _amUidOrden = uidOrden; _amUidCliente = uidCliente; _amModoNueva = false;
      // Resetear estado
      document.getElementById('amNuevaForm').style.display = 'none';
      document.getElementById('amObsRow').style.display = 'none';
      document.getElementById('amNuevaError').style.display = 'none';
      document.getElementById('amObservaciones').value = '';
      document.getElementById('amNuevaObs').value = '';
      ['amNombre','amMarca','amSerial','amRef'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('amBtnAgregar').disabled = true;
      document.getElementById('amBtnNueva').style.display = 'inline-block';
      document.getElementById('amBtnNueva').textContent = '+ Crear nueva máquina';
      document.getElementById('amSeparador').style.display = 'block';
      document.getElementById('amSelectMaquina').closest('.no-fgroup').style.display = 'block';
      // Reset guarantee
      document.getElementById('amChkGarantia').checked = false;
      document.getElementById('amGarantiaFields').style.display = 'none';
      document.getElementById('amGarantiaVence').value = '';
      document.getElementById('amFacturaFile').value = '';
      document.getElementById('amFacturaLabel').firstChild.textContent = '📄 Seleccionar PDF';
      // Cargar máquinas del cliente
      const sel = document.getElementById('amSelectMaquina');
      sel.innerHTML = '<option value="">-- Cargando... --</option>';
      const modal = document.getElementById('agregarMaquinaModal');
      modal.style.display = 'flex';
      try {
        const maquinas = await fetch(`${API}/crear-orden/herramientas/${uidCliente}`).then(r=>r.json());
        if (maquinas.length === 0) {
          sel.innerHTML = '<option value="">-- Este cliente no tiene máquinas registradas --</option>';
        } else {
          sel.innerHTML = '<option value="">-- Seleccionar máquina --</option>' +
            maquinas.map(m => `<option value="${m.uid_herramienta}">${esc(m.her_nombre)}${m.her_marca?' — '+esc(m.her_marca):''}${m.her_serial?' ('+esc(m.her_serial)+')':''}</option>`).join('');
        }
        document.getElementById('amBtnNueva').style.display = 'inline-block';
      } catch(e) {
        sel.innerHTML = '<option value="">-- Error cargando máquinas --</option>';
        document.getElementById('amBtnNueva').style.display = 'inline-block';
      }
    };

    window.ord_cerrarAgregarMaquina = () => {
      document.getElementById('agregarMaquinaModal').style.display = 'none';
      _amUidOrden = null; _amUidCliente = null;
    };

    window.ord_onSelectMaquina = (sel) => {
      const obsRow = document.getElementById('amObsRow');
      const btn = document.getElementById('amBtnAgregar');
      if (sel.value) {
        obsRow.style.display = 'block';
        btn.disabled = false;
        if (_amModoNueva) {
          _amModoNueva = false;
          document.getElementById('amNuevaForm').style.display = 'none';
          document.getElementById('amBtnNueva').textContent = '+ Crear nueva máquina';
          document.getElementById('amSeparador').style.display = 'block';
        }
      } else {
        obsRow.style.display = 'none';
        btn.disabled = _amModoNueva ? false : true;
      }
    };

    window.ord_toggleNuevaMaquina = () => {
      _amModoNueva = !_amModoNueva;
      document.getElementById('amNuevaForm').style.display = _amModoNueva ? 'block' : 'none';
      document.getElementById('amBtnNueva').textContent = _amModoNueva ? '✕ Cancelar nueva máquina' : '+ Crear nueva máquina';
      // Ocultar selector y separador en modo nueva
      document.getElementById('amSelectMaquina').closest('.no-fgroup').style.display = _amModoNueva ? 'none' : 'block';
      document.getElementById('amSeparador').style.display = _amModoNueva ? 'none' : 'block';
      if (_amModoNueva) {
        document.getElementById('amSelectMaquina').value = '';
        document.getElementById('amObsRow').style.display = 'none';
        document.getElementById('amBtnAgregar').disabled = false;
      } else {
        document.getElementById('amBtnAgregar').disabled = !document.getElementById('amSelectMaquina').value;
      }
    };

    window.am_toggleGarantia = (checked) => {
      document.getElementById('amGarantiaFields').style.display = checked ? 'block' : 'none';
      if (checked) {
        const vence = addDiasHabiles(new Date(), 30);
        document.getElementById('amGarantiaVence').value = toInputDate(vence);
      } else {
        document.getElementById('amGarantiaVence').value = '';
      }
    };
    window.am_onFacturaChange = (input) => {
      const lbl = document.getElementById('amFacturaLabel');
      if (lbl) lbl.firstChild.textContent = input.files?.[0]?.name ? '✅ ' + input.files[0].name : '📄 Seleccionar PDF';
    };

    window.ord_confirmarAgregarMaquina = async () => {
      const btn = document.getElementById('amBtnAgregar');
      btn.disabled = true; btn.textContent = '⏳ Agregando...';
      try {
        const esGarantia   = document.getElementById('amChkGarantia').checked;
        const garantiaVence = document.getElementById('amGarantiaVence').value;
        const facturaFile  = document.getElementById('amFacturaFile').files?.[0] || null;

        if (esGarantia && !garantiaVence) {
          showToast('⚠️ La fecha de vencimiento es obligatoria para máquinas en garantía');
          btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
        }

        let uidHerramienta;
        let observaciones;
        if (_amModoNueva) {
          // Crear nueva máquina primero
          const nombre = document.getElementById('amNombre').value.trim();
          if (!nombre) {
            document.getElementById('amNuevaError').textContent = 'El nombre de la máquina es obligatorio';
            document.getElementById('amNuevaError').style.display = 'block';
            btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
          }
          const r = await fetch(`${API}/crear-orden/herramienta`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
              uid_cliente: _amUidCliente,
              her_nombre: nombre,
              her_marca: document.getElementById('amMarca').value.trim(),
              her_serial: document.getElementById('amSerial').value.trim(),
              her_referencia: document.getElementById('amRef').value.trim(),
            })
          }).then(r=>r.json());
          if (!r.herramienta?.uid_herramienta) throw new Error(r.error || 'Error creando máquina');
          uidHerramienta = r.herramienta.uid_herramienta;
          observaciones = document.getElementById('amNuevaObs').value.trim();
        } else {
          uidHerramienta = parseInt(document.getElementById('amSelectMaquina').value);
          observaciones = document.getElementById('amObservaciones').value.trim();
        }
        const r2 = await fetch(`${API}/orders/${_amUidOrden}/agregar-maquina`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ uid_herramienta: uidHerramienta, observaciones,
            es_garantia: esGarantia, garantia_vence: garantiaVence || null })
        }).then(r=>r.json());
        if (!r2.success) throw new Error(r2.error || 'Error agregando');

        // Subir factura si se adjuntó
        if (esGarantia && facturaFile && r2.uid_herramienta_orden) {
          const fd = new FormData();
          fd.append('factura', facturaFile);
          await fetch(`${API}/orders/${_amUidOrden}/factura-maquina/${r2.uid_herramienta_orden}`, { method: 'POST', body: fd });
        }

        const uidOrdenAgregada = _amUidOrden;
        showToast('✅ Máquina agregada a la orden');
        ord_cerrarAgregarMaquina();
        ord_verDetalle(uidOrdenAgregada);
      } catch(e) {
        showToast('⚠️ ' + e.message);
        btn.disabled = false; btn.textContent = 'Agregar a la orden';
      }
    };
    // ─────────────────────────────────────────────────────────────────────────

    window.ord_enviarCotWA = async (uidOrden, btn) => {
      const orig=btn.textContent; btn.disabled=true; btn.textContent='⏳ Enviando...';
      try {
        const r = await fetch(`${API}/quotes/order/${uidOrden}/send-whatsapp`,{method:'POST'}).then(r=>r.json());
        if (!r.success) throw new Error(r.error||'Error enviando');
        showToast('✅ Mensaje WA enviado');
        const preview = document.getElementById(`msgPreview-${uidOrden}`);
        if (preview) preview.style.display='none';
        btn.disabled=true;
      } catch(e) { alert('⚠️ '+e.message); btn.disabled=false; }
      btn.textContent=orig;
    };
    window.ord_enviarPDFCotWA = async (uidOrden, btn) => {
      const orig=btn.textContent; btn.disabled=true; btn.textContent='⏳...';
      try {
        const d = await fetch(`${API}/orders/${uidOrden}/send-pdf/quote`,{method:'POST'}).then(r=>r.json());
        if (!d.success) throw new Error(d.error||'Error');
        showToast('✅ PDF cotización enviado por WA');
      } catch(e) { alert('⚠️ '+e.message); }
      btn.disabled=false; btn.textContent=orig;
    };
    window.ord_uploadFotoRec = async (uidOrden, uidHo, input) => {
      const files = Array.from(input.files);
      if (!files.length) return;
      input.value = '';
      const row = document.getElementById(`fr-row-${uidHo}`);
      for (const file of files) {
        try {
          const fd = new FormData(); fd.append('foto', file);
          const d = await fetch(`${API}/orders/${uidOrden}/fotos-recepcion/${uidHo}`,{method:'POST',body:fd}).then(r=>r.json());
          if (d.success) {
            row?.querySelector('.sin-fotos')?.remove();
            const div = document.createElement('div');
            div.className='foto-thumb'; div.id=`fr-${d.uid_foto}`;
            div.innerHTML=`<img src="${d.url}" onclick="window.open(this.src,'_blank')" alt=""><button class="del-btn" onclick="ord_delFotoRec(${d.uid_foto},event)">✕</button>`;
            row?.appendChild(div);
          } else showToast('⚠️ Error al subir foto: '+(d.error||''));
        } catch(e) { showToast('⚠️ ' + e.message); }
      }
    };
    window.ord_delFotoRec = async (uid, e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar esta foto de recepción?')) return;
      await fetch(`${API}/orders/fotos-recepcion/${uid}`,{method:'DELETE'});
      document.getElementById(`fr-${uid}`)?.remove();
    };
    window.ord_uploadFoto = async (uidOrden, uidHo, input) => {
      const files = Array.from(input.files);
      if (!files.length) return;
      input.value = '';
      const row = document.getElementById(`ft-row-${uidHo}`);
      for (const file of files) {
        try {
          const fd = new FormData(); fd.append('foto', file);
          const d = await fetch(`${API}/orders/${uidOrden}/fotos-trabajo/${uidHo}`,{method:'POST',body:fd}).then(r=>r.json());
          if (d.success) {
            const div = document.createElement('div');
            div.className='foto-thumb'; div.id=`ft-${d.uid_foto}`;
            div.innerHTML=`<img src="${d.url}" onclick="window.open(this.src,'_blank')" alt=""><button class="del-btn" onclick="ord_delFoto(${d.uid_foto},event)">✕</button>`;
            row?.appendChild(div);
          } else showToast('⚠️ Error al subir foto: '+(d.error||''));
        } catch(e) { showToast('⚠️ ' + e.message); }
      }
    };
    window.ord_delFoto = async (uid, e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar esta foto?')) return;
      await fetch(`${API}/orders/fotos-trabajo/${uid}`,{method:'DELETE'});
      document.getElementById(`ft-${uid}`)?.remove();
    };
    // Trigger load by order ID (called from dashboard alerts or cotizaciones)
    window.ord_verDetalleById = window.ord_verDetalle;

    window.ord_verInforme = async (orderId, uid) => {
      const r = await fetch(`${API}/orders/${orderId}/pdf/maintenance/${uid}`);
      if (r.status === 404) {
        const d = await r.json().catch(() => ({}));
        showToast('⚠️ ' + (d.error || 'No hay cotización para esta máquina. Cotízala primero.'), 5000);
        return;
      }
      if (!r.ok) { showToast('⚠️ Error generando informe', 4000); return; }
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
    };
    window.ord_enviarInformeWA = async (uidOrden, uidHo, btn) => {
      const orig=btn.textContent; btn.disabled=true; btn.textContent='⏳...';
      try {
        const d = await fetch(`${API}/orders/${uidOrden}/send-pdf/maintenance/${uidHo}`,{method:'POST'}).then(r=>r.json());
        if (!d.success) throw new Error(d.error||'Error');
        showToast('✅ Informe enviado por WA');
      } catch(e) { alert('⚠️ '+e.message); }
      btn.disabled=false; btn.textContent=orig;
    };
  }
};

async function ord_filtrarPorEstado(estado, label, mes) {
  const rl = document.getElementById('ordResults');
  if (!rl) return;
  rl.innerHTML = '<div class="results-empty">Cargando...</div>';

  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (mes)    params.set('mes', mes);
  const data = await fetch(`${API}/orders/by-estado?${params}`).then(r=>r.json()).catch(()=>[]);

  if (!data.length) {
    rl.innerHTML = `<div class="results-empty">Sin órdenes en este estado</div>`;
    return;
  }
  rl.innerHTML = `
    <div style="padding:8px 12px 4px;font-size:12px;font-weight:600;color:#1d3557;border-bottom:1px solid #eee;margin-bottom:4px;">
      ${esc(label)} (${data.length})
    </div>` +
    data.map(o=>`
      <div class="result-card" onclick="ord_verDetalle(${o.uid_orden})">
        <div class="rc-top">
          <span class="rc-num">Orden #${o.ord_consecutivo}</span>
          <span class="rc-fecha">${fmtFecha(o.ord_fecha)}</span>
        </div>
        ${o.ord_tipo==='garantia' ? ord_garantiaBadges(o) : ''}
        <div class="rc-cliente">${esc(o.cli_razon_social||'')}</div>
        <div class="rc-maq">${esc(o.maquinas_resumen||'')}</div>
      </div>`).join('');
}

window.ord_generarVenta = async function(uidOrden, btn) {
  if (!confirm('¿Crear una venta con los ítems de la cotización aprobada de esta orden?')) return;
  const orig = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Generando...';
  try {
    const r = await fetch(`${API}/ventas/desde-orden/${uidOrden}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error al crear la venta');
    showToast(`✅ Venta #${d.ven_consecutivo} creada`);
    navigate('ventas');
  } catch (e) {
    alert('⚠️ ' + e.message);
    btn.disabled = false; btn.textContent = orig;
  }
};

window.ord_abrirModalFactura = function(uidOrden) {
  const data = window._ordDetalleActual;
  if (!data) return;
  const { orden, maquinas } = data;

  const maqConCot = maquinas.filter(m => m.cotizacion && Number(m.cotizacion.subtotal) > 0);
  if (!maqConCot.length) { alert('Esta orden no tiene cotización para facturar'); return; }

  const total = maqConCot.reduce((s, m) => s + Number(m.cotizacion.subtotal), 0);
  const today = new Date().toISOString().slice(0, 10);

  const serviciosHtml = maqConCot.map(m =>
    `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #f0f0f0;">
       <span>${[m.her_nombre,m.her_marca].filter(Boolean).join(' ')}</span>
       <span style="font-weight:600;">$${Number(m.cotizacion.subtotal).toLocaleString('es-CO')}</span>
     </div>`
  ).join('');

  document.getElementById('facturaModal')?.remove();
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'facturaModal';
  bg.innerHTML = `<div class="modal" style="max-width:480px;">
    <h3>📄 Factura electrónica — Orden #${orden.ord_consecutivo}</h3>

    <label>Cliente</label>
    <div style="padding:8px 10px;background:#f5f5f5;border-radius:6px;font-size:13px;margin-bottom:2px;">
      ${orden.cli_razon_social||''} &nbsp;·&nbsp; ${orden.cli_identificacion||''}
    </div>

    <label>Fecha</label>
    <input id="facFecha" type="date" value="${today}">

    <label>Forma de pago</label>
    <select id="facFormaPago">
      <option value="CASH">Contado</option>
      <option value="CREDIT">A crédito</option>
    </select>

    <label>Método de pago</label>
    <select id="facMetodoPago">
      <option value="CASH">Efectivo</option>
      <option value="BANK_TRANSFER">Transferencia bancaria</option>
      <option value="CREDIT_CARD">Tarjeta crédito</option>
      <option value="DEBIT_CARD">Tarjeta débito</option>
      <option value="CHECK">Cheque</option>
      <option value="NEQUI">Nequi</option>
    </select>

    <label style="margin-top:14px;">Servicios a facturar</label>
    <div style="background:#f9f9f9;border-radius:6px;padding:8px 10px;">
      ${serviciosHtml}
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding:7px 0 0;">
        <span>Total</span>
        <span>$${total.toLocaleString('es-CO')}</span>
      </div>
    </div>

    <div id="facturaModalError" style="display:none;margin:10px 0 0;padding:10px 12px;background:#fdecea;border:1px solid #e57373;border-radius:6px;color:#b71c1c;font-size:13px;line-height:1.5;"></div>
    <div class="modal-actions">
      <button class="btn btn-grey" onclick="document.getElementById('facturaModal').remove()">Cancelar</button>
      <button class="btn btn-teal" id="btnEnviarFactura" onclick="ord_enviarFactura(${uidOrden},this)">Generar en Alegra</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
};

window.ord_enviarFactura = async function(uidOrden, btn) {
  const paymentForm   = document.getElementById('facFormaPago').value;
  const paymentMethod = document.getElementById('facMetodoPago').value;
  const date          = document.getElementById('facFecha').value;
  const errDiv = document.getElementById('facturaModalError');
  if (errDiv) errDiv.style.display = 'none';
  const orig = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Generando...';
  try {
    const r = await fetch(`${API}/alegra/invoices/${uidOrden}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentForm, paymentMethod, date }),
    });
    const ct = r.headers.get('content-type') || '';
    const d = ct.includes('json') ? await r.json() : {};
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    document.getElementById('facturaModal').remove();
    showToast('✅ Factura electrónica emitida en Alegra');
    ord_verDetalle(uidOrden);
  } catch (e) {
    if (errDiv) {
      errDiv.textContent = '⚠️ ' + e.message;
      errDiv.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = orig;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: COTIZACIONES
// ════════════════════════════════════════════════════════════════════════════
Views.cotizaciones = {
  render() {
    return `
      <div class="card" style="margin:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0;font-size:18px;color:#1d3557">📝 Pendientes de cotizar</h2>
          <button class="btn btn-sm" onclick="cot_cargarPendientes()">🔄 Actualizar</button>
        </div>
        <div id="cotPendList"><div class="loading-state">Cargando...</div></div>
      </div>`;
  },
  async init() {
    await cot_cargarPendientes();
  }
};

window.cot_cargarPendientes = async () => {
  const el = document.getElementById('cotPendList');
  if (!el) return;
  el.innerHTML = '<div class="loading-state">Cargando...</div>';
  try {
    const rsc = await fetch(`${API}/cotizaciones/pendientes`).then(r => r.json());
    if (!rsc.length) {
      el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>No hay máquinas pendientes de cotizar</p></div>';
      return;
    }
    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f0f4f8;text-align:left">
            <th style="padding:10px 12px;font-weight:600;color:#555">Cliente</th>
            <th style="padding:10px 12px;font-weight:600;color:#555">Orden</th>
            <th style="padding:10px 12px;font-weight:600;color:#555">Máquina</th>
            <th style="padding:10px 12px;font-weight:600;color:#555">Ingreso</th>
            <th style="padding:10px 12px;font-weight:600;color:#555"></th>
          </tr>
        </thead>
        <tbody>
          ${rsc.map(r => `
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:10px 12px">${esc(r.cliente)}</td>
              <td style="padding:10px 12px;white-space:nowrap">#${r.ord_consecutivo}</td>
              <td style="padding:10px 12px">${esc(r.her_nombre || '')} ${esc(r.her_marca || '')}</td>
              <td style="padding:10px 12px;white-space:nowrap;color:#666">${fmtFecha(r.ord_fecha)}</td>
              <td style="padding:10px 12px;text-align:right">
                <button class="btn btn-sm btn-mid" onclick="ord_abrirCotizar(${r.uid_orden},${r.uid_herramienta_orden})">✏️ Cotizar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    el.innerHTML = `<div class="empty-state">Error cargando: ${esc(e.message)}</div>`;
  }
};

// Las funciones cot_ de búsqueda se mantienen para compatibilidad con el modal
{
  const S = { orderId:null, equipment:[], technicians:[], selected:null, items:[], finalMsg:'', fromOrden:null };
  // fromOrden se preserva: lo setea el botón en Órdenes y lo limpia cot_volverAOrden / sidebar
    const PLCH = {consecutivo:'Ej: 7833',cedula:'Ej: 8914110164',nombre:'Ej: Cliente X'};
    const ESTADOS = [
      {value:'pendiente_revision',label:'Pendiente de revisión',color:'#888'},
      {value:'revisada',label:'Revisada',color:'#2196F3'},
      {value:'cotizada',label:'Cotizada',color:'#FF9800'},
      {value:'autorizada',label:'Autorizada',color:'#4CAF50'},
      {value:'no_autorizada',label:'No autorizada',color:'#F44336'},
      {value:'reparada',label:'Reparada',color:'#9C27B0'},
      {value:'entregada',label:'Entregada',color:'#009688'},
    ];

    window.cot_placeholder = () => {
      const v = document.getElementById('cotConcepto')?.value;
      const si = document.getElementById('cotSearch');
      if (si) { si.placeholder=PLCH[v]||''; si.value=''; }
      const rl = document.getElementById('cotResults');
      if (rl) rl.innerHTML='<div class="results-empty">Escribe para buscar</div>';
    };
    window.cot_debounce = () => {
      clearTimeout(Views.cotizaciones._timer);
      Views.cotizaciones._timer = setTimeout(cot_buscar, 350);
    };
    window.cot_buscar = async () => {
      const q = document.getElementById('cotSearch')?.value.trim(); if (!q) return;
      const rl = document.getElementById('cotResults'); if (!rl) return;
      rl.innerHTML='<div class="results-empty">Buscando...</div>';
      const data = await fetch(`${API}/orders/search?q=${encodeURIComponent(q)}`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) { rl.innerHTML='<div class="results-empty">Sin resultados</div>'; return; }
      rl.innerHTML = data.map(o=>`
        <div class="result-card" onclick="cot_loadOrder(${o.uid_orden})">
          <div class="rc-top">
            <span class="rc-num">Orden #${o.ord_consecutivo}</span>
            <span class="rc-fecha">${fmtFecha(o.ord_fecha)}</span>
          </div>
          <div class="rc-cliente">${esc(o.cli_razon_social||'')}</div>
          <div class="rc-maq">${esc(o.maquinas_resumen||(o.maquinas?o.maquinas+' máquina(s)':''))}</div>
        </div>`).join('');
    };
    window.cot_back = () => document.getElementById('cotPanel')?.classList.remove('immersive');
    window.cot_loadById = (uid) => cot_loadOrder(uid);
    window.cot_volverAOrden = (uid) => {
      S.fromOrden = null;
      navigate('ordenes');
      setTimeout(() => ord_verDetalle(uid), 80);
    };
    window.cot_loadOrder = async (uid) => {
      const data = await fetch(`${API}/orders/${uid}`).then(r=>r.json()).catch(()=>null);
      if (!data) return;
      S.orderId = data.order.uid_orden;
      S.equipment = data.equipment||[];
      S.technicians = data.technicians||[];
      S.selected = S.equipment[0]||null;
      S.items = []; S.finalMsg = '';
      document.getElementById('cotPanel')?.classList.add('immersive');
      // Render left panel order info
      const op = document.getElementById('cotOrderPanel');
      if (op) {
        op.style.display='block';
        op.innerHTML = cot_renderOrderPanel(data);
      }
      // Render right panel
      cot_renderRight();
      await cot_refreshSavedCount();
      await cot_loadPartsSelect();
      if (S.selected) await cot_loadSavedQuote();
    };

    function cot_renderOrderPanel(data) {
      const o = data.order;
      const eqOpts = S.equipment.map((eq,i)=>`<option value="${eq.uid_herramienta_orden}">${i+1}. ${esc(eq.her_nombre||'-')} ${esc(eq.her_marca||'')}</option>`).join('');
      const techOpts = '<option value="">(Sin asignar)</option>' +
        S.technicians.map(t=>`<option value="${t.uid_usuario}">${esc(t.usr_nombre||t.uid_usuario)}</option>`).join('');
      return `
        <div class="orden-badge">
          <span class="num">Orden #${o.ord_consecutivo}</span>
          ${S.fromOrden ? `<button class="btn btn-sm btn-dark" onclick="cot_volverAOrden(${S.fromOrden})" style="margin-left:auto">← Volver a la orden</button>` : ''}
          <button class="back-btn" onclick="cot_back()">← Volver</button>
        </div>
        <div class="info-field"><strong>Cliente:</strong> ${esc(o.cli_razon_social||'-')}</div>
        <div class="info-field"><strong>Fecha:</strong> ${fmtFecha(o.ord_fecha)}</div>
        <div class="info-field"><strong>Tel:</strong> ${esc(o.cli_telefono||'-')}</div>
        <div class="info-field" style="color:#666"><span id="cotEqCount">${S.equipment.length}</span> equipo(s) | <span id="cotSavedCount">0</span> cotizado(s)</div>
        <div class="slabel">Máquina a cotizar</div>
        <div class="maq-sel"><select id="cotEqSel" onchange="cot_onEqChange()">${eqOpts}</select></div>
        <div class="eq-info" id="cotEqInfo"></div>
        <div class="slabel">Notificaciones WhatsApp</div>
        <div class="wa-buttons">
          <button class="wa-btn btn-parts" onclick="cot_notifyParts()">📦 Lista repuestos al encargado</button>
          <button class="wa-btn btn-ready" onclick="cot_notifyReady()">🔧 Cliente — máquinas listas</button>
          <button class="wa-btn btn-deliv" onclick="cot_notifyDeliv()">✅ Confirmar entrega</button>
        </div>
        <div class="slabel">Técnico asignado</div>
        <div class="tech-row">
          <select id="cotTechSel" onchange="cot_onTechChange()">${techOpts}</select>
          <button onclick="cot_assignAll()">A todas</button>
        </div>`;
    }

    function cot_renderRight() {
      const right = document.getElementById('cotRight'); if (!right) return;
      if (!S.orderId) {
        right.innerHTML='<div class="mobile-back" onclick="cot_back()">← Volver</div><div class="empty-state"><div class="es-icon">💰</div><p>Selecciona una orden</p></div>';
        return;
      }
      right.innerHTML = `
        <div class="mobile-back" onclick="cot_back()">← Volver a resultados</div>
        <div style="padding:18px;">
          <div class="card">
            <div class="card-title">💰 Cotizar máquina seleccionada</div>
            <div style="margin-bottom:12px;">
              <label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px;">Mano de obra ($)</label>
              <input type="number" id="cotLabor" placeholder="Ej: 50000" min="0" style="width:100%;padding:9px 11px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none;" onchange="cot_updateSummary()">
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px;">Descripción del trabajo</label>
              <textarea id="cotDesc" rows="3" style="width:100%;padding:9px 11px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit;outline:none;" placeholder="Describe el trabajo..."></textarea>
            </div>
          </div>
          <div class="card">
            <div class="card-title">⚙️ Repuestos</div>
            <div class="items-container" id="cotItemsContainer"><p style="color:#999;text-align:center;padding:16px;">(Sin repuestos aún)</p></div>
            <div class="add-item-group">
              <input type="text" id="cotPartSearch" list="cotPartDatalist" autocomplete="off" placeholder="🔍 Buscar o escribir repuesto...">
              <datalist id="cotPartDatalist"></datalist>
              <input type="number" id="cotPartQty" value="1" min="1" placeholder="Cant.">
              <button onclick="cot_addItem()">+ Agregar</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">📊 Resumen</div>
            <div class="summary-box">
              <div class="summary-row"><span>Subtotal máquina:</span><strong id="cotSubtotal">$0</strong></div>
              <div class="summary-row"><span>IVA:</span><strong id="cotIva">$0</strong></div>
              <div class="summary-total"><span>TOTAL:</span><span id="cotTotal">$0</span></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">⚡ Acciones</div>
            <div class="btn-group">
              <button class="btn btn-dark" id="cotSaveBtn" onclick="cot_save()">💾 Guardar máquina</button>
              <button class="btn btn-purple" id="cotGenBtn" onclick="cot_genMsg()">🤖 Mensaje final</button>
              <button class="btn btn-green" id="cotSendBtn" onclick="cot_sendWA()" disabled>📱 Enviar WA</button>
              <button class="btn btn-grey" onclick="cot_reset()">🔄 Limpiar</button>
            </div>
            <div style="margin-top:12px;font-size:11px;color:#888;">📄 PDF cotización</div>
            <div class="btn-group" style="margin-top:4px;">
              <button class="btn btn-mid" onclick="cot_dlPDF()">📄 Descargar PDF</button>
              <button class="btn btn-mid" id="cotSendPdfBtn" onclick="cot_sendPDF()">📤 Enviar WA PDF</button>
            </div>
            <div style="margin-top:10px;font-size:11px;color:#888;">🔧 Informe de mantenimiento</div>
            <div class="btn-group" style="margin-top:4px;">
              <button class="btn btn-teal" onclick="cot_dlMaint()">📄 Descargar Informe</button>
              <button class="btn btn-teal" id="cotSendMaintBtn" onclick="cot_sendMaint()">📤 Enviar Informe WA</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">👀 Vista previa WhatsApp</div>
            <div class="preview-box"><div class="preview-content" id="cotPreview">Aquí aparecerá el mensaje final...</div></div>
          </div>
        </div>`;
      cot_syncEqInfo();
    }

    window.cot_onEqChange = async () => {
      const id = document.getElementById('cotEqSel')?.value;
      S.selected = S.equipment.find(e=>String(e.uid_herramienta_orden)===String(id))||null;
      cot_syncEqInfo();
      cot_syncTech();
      await cot_loadSavedQuote();
    };
    function cot_syncEqInfo() {
      const el = document.getElementById('cotEqInfo'); if (!el) return;
      el.textContent = S.selected ? `${S.selected.her_nombre||''} ${S.selected.her_marca||''}` : '';
    }
    function cot_syncTech() {
      const sel = document.getElementById('cotTechSel'); if (!sel) return;
      sel.value = S.selected?.tecnico_id ? String(S.selected.tecnico_id) : '';
    }
    window.cot_onTechChange = async () => {
      if (!S.orderId||!S.selected) return;
      const tid = document.getElementById('cotTechSel')?.value||null;
      await fetch(`${API}/equipment-order/${S.selected.uid_herramienta_orden}/assign-technician`,
        {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({technicianId:tid})});
    };
    window.cot_assignAll = async () => {
      if (!S.orderId) return;
      const tid = document.getElementById('cotTechSel')?.value||null;
      await fetch(`${API}/orders/${S.orderId}/assign-technician`,
        {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({technicianId:tid})});
      showToast('Técnico asignado a todas las máquinas');
    };
    window.cot_addItem = () => {
      const searchEl = document.getElementById('cotPartSearch');
      const qty = parseInt(document.getElementById('cotPartQty')?.value||'1',10)||1;
      const rawName = searchEl?.value.trim();
      if (!rawName) { alert('Escribe o selecciona un repuesto'); return; }
      const price = (window._cotPartsMap && window._cotPartsMap.has(rawName))
        ? window._cotPartsMap.get(rawName) : 0;
      S.items.push({id:Date.now(), name:rawName, quantity:qty, price});
      cot_renderItems(); cot_updateSummary();
      if (searchEl) searchEl.value = '';
      const qEl = document.getElementById('cotPartQty'); if (qEl) qEl.value='1';
    };
    function cot_renderItems() {
      const c = document.getElementById('cotItemsContainer'); if (!c) return;
      if (!S.items.length) { c.innerHTML='<p style="color:#999;text-align:center;padding:16px;">(Sin repuestos aún)</p>'; return; }
      c.innerHTML = S.items.map(it=>`
        <div class="item-row">
          <div><input type="text" value="${esc(it.name)}" readonly style="background:#fff;border:none;font-weight:500;padding:5px;width:100%;"></div>
          <div><input type="number" value="${it.quantity}" min="1" style="width:100%;" onchange="cot_updQty(${it.id},this.value)"></div>
          <div><input type="number" value="${it.price}" min="0" style="width:100%;" onchange="cot_updPrice(${it.id},this.value)"></div>
          <button class="del-item" onclick="cot_delItem(${it.id})">❌</button>
        </div>`).join('');
    }
    window.cot_updQty   = (id,v) => { const it=S.items.find(x=>x.id===id); if(it){it.quantity=parseInt(v)||1;cot_updateSummary();} };
    window.cot_updPrice = (id,v) => { const it=S.items.find(x=>x.id===id); if(it){it.price=Number(v)||0;cot_updateSummary();} };
    window.cot_delItem  = (id)   => { S.items=S.items.filter(x=>x.id!==id); cot_renderItems(); cot_updateSummary(); };
    window.cot_updateSummary = () => {
      const labor = Number(document.getElementById('cotLabor')?.value)||0;
      const sub = labor + S.items.reduce((s,it)=>s+(it.quantity||0)*(it.price||0),0);
      const el = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
      el('cotSubtotal',money(sub)); el('cotIva',money(0)); el('cotTotal',money(sub));
    };
    window.cot_reset = () => {
      S.items=[];
      ['cotLabor','cotDesc'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
      cot_renderItems(); cot_updateSummary();
    };
    async function cot_loadSavedQuote() {
      cot_reset();
      if (!S.orderId||!S.selected) return;
      const r = await fetch(`${API}/quotes/machine?orderId=${S.orderId}&equipmentOrderId=${S.selected.uid_herramienta_orden}`).then(r=>r.json()).catch(()=>null);
      if (!r?.exists) return;
      const mq = r.machineQuote;
      const lEl = document.getElementById('cotLabor'); if(lEl) lEl.value=mq?.mano_obra??'';
      const dEl = document.getElementById('cotDesc');  if(dEl) dEl.value=mq?.descripcion_trabajo??'';
      S.items = (r.items||[]).map(it=>({id:it.id||Date.now()+Math.random(),name:it.nombre,quantity:Number(it.cantidad||1),price:Number(it.precio||0)}));
      cot_renderItems(); cot_updateSummary();
    }
    async function cot_loadPartsSelect() {
      const parts = await fetch(`${API}/quote/catalog?type=R`).then(r=>r.json()).catch(()=>[]);
      const dl = document.getElementById('cotPartDatalist'); if (!dl) return;
      window._cotPartsMap = new Map();
      dl.innerHTML = parts.map(p => {
        const label = p.cco_descripcion;
        window._cotPartsMap.set(label, Number(p.cco_valor || 0));
        return `<option value="${esc(label)}" data-price="${p.cco_valor}">`;
      }).join('');
    }
    async function cot_refreshSavedCount() {
      if (!S.orderId) return;
      const r = await fetch(`${API}/quotes/order/${S.orderId}`).then(r=>r.json()).catch(()=>null);
      const el = document.getElementById('cotSavedCount'); if(el&&r?.success) el.textContent=String(r.savedCount||0);
    }
    window.cot_save = async () => {
      if (!S.orderId||!S.selected) return;
      const btn = document.getElementById('cotSaveBtn'); if(btn){btn.disabled=true;btn.textContent='💾 Guardando...';}
      try {
        const r = await fetch(`${API}/quotes/machine`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          orderId:S.orderId, equipmentOrderId:String(S.selected.uid_herramienta_orden),
          technicianId:document.getElementById('cotTechSel')?.value||null,
          laborCost:Number(document.getElementById('cotLabor')?.value)||0,
          workDescription:document.getElementById('cotDesc')?.value||'',
          items:S.items
        })});
        const d = await r.json();
        if (!d.success) throw new Error(d.error||'Error');
        showToast('✅ Cotización guardada'); await cot_refreshSavedCount();
      } catch(e) { alert('⚠️ '+e.message); }
      if(btn){btn.disabled=false;btn.textContent='💾 Guardar máquina';}
    };
    window.cot_genMsg = async () => {
      if (!S.orderId) return;
      const btn = document.getElementById('cotGenBtn'); if(btn){btn.disabled=true;btn.textContent='⏳ Generando...';}
      const prev = document.getElementById('cotPreview'); if(prev) prev.textContent='Generando mensaje...';
      try {
        const r = await fetch(`${API}/quotes/order/${S.orderId}/generate-message`,{method:'POST'});
        const d = await r.json();
        if (!d.success) throw new Error(d.error||'Error');
        S.finalMsg = d.message;
        if(prev) prev.textContent=S.finalMsg;
        const sb = document.getElementById('cotSendBtn'); if(sb) sb.disabled=false;
      } catch(e) { if(prev) prev.textContent='⚠️ '+e.message; }
      if(btn){btn.disabled=false;btn.textContent='🤖 Mensaje final';}
    };
    window.cot_sendWA = async () => {
      if (!S.orderId) return;
      const btn = document.getElementById('cotSendBtn'); if(btn){btn.disabled=true;btn.textContent='📤 Enviando...';}
      try {
        const r = await fetch(`${API}/quotes/order/${S.orderId}/send-whatsapp`,{method:'POST'});
        const d = await r.json();
        if (!d.success) throw new Error(d.error||'Error');
        alert('✅ Mensaje enviado a '+d.cliente);
      } catch(e) { alert('⚠️ '+e.message); }
      if(btn){btn.disabled=false;btn.textContent='📱 Enviar WA';}
    };
    window.cot_dlPDF    = () => { if(!S.orderId)return; window.open(`${API}/orders/${S.orderId}/pdf/quote`,'_blank'); };
    window.cot_dlMaint  = () => { if(!S.orderId||!S.selected)return; window.open(`${API}/orders/${S.orderId}/pdf/maintenance/${S.selected.uid_herramienta_orden}`,'_blank'); };
    window.cot_sendPDF  = async () => {
      if (!S.orderId) return;
      const btn=document.getElementById('cotSendPdfBtn'); if(btn){btn.disabled=true;btn.textContent='⏳...';}
      try { const r=await fetch(`${API}/orders/${S.orderId}/send-pdf/quote`,{method:'POST'}); const d=await r.json(); if(!d.success)throw new Error(d.error); showToast('✅ PDF enviado'); } catch(e){alert('⚠️ '+e.message);}
      if(btn){btn.disabled=false;btn.textContent='📤 Enviar WA PDF';}
    };
    window.cot_sendMaint = async () => {
      if (!S.orderId||!S.selected) return;
      const btn=document.getElementById('cotSendMaintBtn'); if(btn){btn.disabled=true;btn.textContent='⏳...';}
      try { const r=await fetch(`${API}/orders/${S.orderId}/send-pdf/maintenance/${S.selected.uid_herramienta_orden}`,{method:'POST'}); const d=await r.json(); if(!d.success)throw new Error(d.error); showToast('✅ Informe enviado'); } catch(e){alert('⚠️ '+e.message);}
      if(btn){btn.disabled=false;btn.textContent='📤 Enviar Informe WA';}
    };
    window.cot_notifyParts = async () => {
      if(!S.orderId)return;
      const r=await fetch(`${API}/orders/${S.orderId}/notify-parts`,{method:'POST'}).then(r=>r.json()).catch(()=>({success:false}));
      if(r.success)showToast(`📦 Lista enviada al encargado (${r.maquinas} máquina${r.maquinas!==1?'s':''})`);
      else alert('Error: '+(r.error||''));
    };
    window.cot_notifyReady = async () => {
      if(!S.orderId)return;
      const r=await fetch(`${API}/orders/${S.orderId}/notify-ready`,{method:'POST'}).then(r=>r.json()).catch(()=>({success:false}));
      if(r.success)showToast(`🔧 Cliente notificado (${r.maquinas} reparada${r.maquinas!==1?'s':''})`);
      else alert('Error: '+(r.error||''));
    };
    window.cot_notifyDeliv = async () => {
      if(!S.orderId)return;
      const r=await fetch(`${API}/orders/${S.orderId}/notify-delivered`,{method:'POST'}).then(r=>r.json()).catch(()=>({success:false}));
      if(r.success)showToast(`✅ Entrega confirmada`);
      else alert('Error: '+(r.error||''));
    };
}

// ════════════════════════════════════════════════════════════════════════════
// VISTA: CLIENTES
// ════════════════════════════════════════════════════════════════════════════
Views.clientes = {
  _timer: null,
  render() {
    return `
      <div class="two-panel" id="cliPanel">
        <div class="pnl-left">
          <div class="search-box">
            <h2>Buscar cliente</h2>
            <div class="input-row" style="margin-top:0;">
              <input id="cliSearch" type="text" placeholder="Nombre, NIT o teléfono" oninput="cli_debounce()">
              <button onclick="cli_buscar()">🔍</button>
            </div>
          </div>
          <div class="results-list" id="cliResults">
            <div class="results-empty">Escribe para buscar</div>
          </div>
        </div>
        <div class="pnl-right" id="cliRight">
          <div class="mobile-back" onclick="cli_back()">← Volver a resultados</div>
          <div class="empty-state">
            <div class="es-icon">👥</div>
            <p>Selecciona un cliente para ver su detalle</p>
          </div>
        </div>
      </div>`;
  },
  init() {
    window.cli_debounce = () => {
      clearTimeout(Views.clientes._timer);
      Views.clientes._timer = setTimeout(cli_buscar, 350);
    };
    window.cli_back = () => document.getElementById('cliPanel')?.classList.remove('immersive');
    window.cli_buscar = async () => {
      const q = document.getElementById('cliSearch')?.value.trim(); if (!q) return;
      const rl = document.getElementById('cliResults'); if (!rl) return;
      rl.innerHTML='<div class="results-empty">Buscando...</div>';
      const data = await fetch(`${API}/clientes/search?q=${encodeURIComponent(q)}`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) { rl.innerHTML='<div class="results-empty">Sin resultados</div>'; return; }
      rl.innerHTML = data.map(c=>`
        <div class="result-card" onclick="cli_verDetalle(${c.uid_cliente})">
          <div class="rc-top">
            <span class="rc-num">${esc(c.cli_razon_social||c.cli_contacto||'-')}</span>
            <span style="font-size:11px;color:${c.cli_estado==='A'?'#27ae60':'#e74c3c'}">${c.cli_estado==='A'?'Activo':'Inactivo'}</span>
          </div>
          <div class="rc-cliente">${esc(c.cli_identificacion||'')}</div>
          <div class="rc-maq">${c.total_ordenes||0} orden(es) | ${esc(c.cli_telefono||'')}</div>
        </div>`).join('');
    };
    window.cli_verDetalle = async (uid) => {
      const right = document.getElementById('cliRight'); if (!right) return;
      document.getElementById('cliPanel')?.classList.add('immersive');
      right.innerHTML='<div class="mobile-back" onclick="cli_back()">← Volver</div><div style="padding:20px;color:#888;text-align:center;">Cargando...</div>';
      const data = await fetch(`${API}/clientes/${uid}`).then(r=>r.json()).catch(()=>null);
      if (!data) { right.innerHTML='<div class="mobile-back" onclick="cli_back()">← Volver</div><div style="padding:20px;color:#e74c3c;">Error cargando cliente</div>'; return; }
      cli_renderDetalle(uid, data);
    };

    window.cli_renderDetalle = (uid, data) => {
      const right = document.getElementById('cliRight'); if (!right) return;
      const c = data.cliente;
      const ordsHtml = data.ordenes.length
        ? `<table class="ordenes-list-table">
            <thead><tr><th>Orden</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
            <tbody>${data.ordenes.map(o=>`
              <tr>
                <td><strong>#${o.ord_consecutivo}</strong></td>
                <td>${fmtFecha(o.ord_fecha)}</td>
                <td><span class="badge b-${o.ord_estado||'pendiente_revision'}" style="font-size:10px;">${o.ord_estado||'-'}</span></td>
                <td><span class="ord-link" onclick="navigate('ordenes');setTimeout(()=>ord_verDetalle(${o.uid_orden}),80)">Ver →</span></td>
              </tr>`).join('')}
            </tbody>
           </table>`
        : '<div style="color:#aaa;font-size:13px;padding:8px 0;">Sin órdenes registradas</div>';
      right.innerHTML = `
        <div class="mobile-back" onclick="cli_back()">← Volver a resultados</div>
        <div style="padding:22px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px;">
            <div>
              <div class="cli-name">${esc(c.cli_razon_social||c.cli_contacto||'-')}</div>
              <div class="cli-sub">NIT / CC: ${esc(c.cli_identificacion||'-')}</div>
            </div>
            <button class="btn btn-mid" onclick="cli_abrirEditar(${uid})">✏️ Editar</button>
          </div>
          <div class="card" id="cli-info-card-${uid}">
            <div class="card-title">Información de contacto</div>
            <div class="client-grid">
              <div class="field"><span class="lbl">Teléfono</span><span class="val">${esc(c.cli_telefono||'-')}</span></div>
              <div class="field"><span class="lbl">Contacto</span><span class="val">${esc(c.cli_contacto||'-')}</span></div>
              <div class="field"><span class="lbl">Tel. contacto</span><span class="val">${esc(c.cli_tel_contacto||'-')}</span></div>
              <div class="field"><span class="lbl">Dirección</span><span class="val">${esc(c.cli_direccion||'-')}</span></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Historial de órdenes (${data.ordenes.length})</div>
            ${ordsHtml}
          </div>
        </div>`;
      // guardar datos del cliente para el form de edición
      right._cliData = data;
    };

    window.cli_abrirEditar = (uid) => {
      const right = document.getElementById('cliRight'); if (!right) return;
      const data = right._cliData; if (!data) return;
      const c = data.cliente;
      const card = document.getElementById(`cli-info-card-${uid}`); if (!card) return;
      card.innerHTML = `
        <div class="card-title">Editar información</div>
        <div class="no-fgroup">
          <label class="no-lbl">Razón social / Nombre <span class="no-req">*</span></label>
          <input class="no-input" id="cli_e_razon" value="${esc(c.cli_razon_social||'')}">
        </div>
        <div class="no-grid2" style="margin-top:10px;">
          <div class="no-fgroup">
            <label class="no-lbl">Teléfono <span class="no-req">*</span></label>
            <input class="no-input" id="cli_e_tel" value="${esc(c.cli_telefono||'')}">
          </div>
          <div class="no-fgroup">
            <label class="no-lbl">Nombre contacto</label>
            <input class="no-input" id="cli_e_contacto" value="${esc(c.cli_contacto||'')}">
          </div>
        </div>
        <div class="no-grid2" style="margin-top:10px;">
          <div class="no-fgroup">
            <label class="no-lbl">Tel. contacto</label>
            <input class="no-input" id="cli_e_tel_contacto" value="${esc(c.cli_tel_contacto||'')}">
          </div>
          <div class="no-fgroup">
            <label class="no-lbl">Dirección</label>
            <input class="no-input" id="cli_e_direccion" value="${esc(c.cli_direccion||'')}">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn btn-dark" onclick="cli_guardarEditar(${uid})">💾 Guardar</button>
          <button class="btn btn-mid" onclick="cli_renderDetalle(${uid}, document.getElementById('cliRight')._cliData)">Cancelar</button>
        </div>
        <div id="cli-edit-err-${uid}" class="no-alert-err" style="display:none;margin-top:8px;"></div>`;
    };

    window.cli_guardarEditar = async (uid) => {
      const razon = document.getElementById('cli_e_razon')?.value.trim();
      const tel   = document.getElementById('cli_e_tel')?.value.trim();
      const errEl = document.getElementById(`cli-edit-err-${uid}`);
      if (!razon || !tel) {
        errEl.textContent = 'Razón social y teléfono son obligatorios'; errEl.style.display='block'; return;
      }
      errEl.style.display = 'none';
      const body = {
        cli_razon_social:  razon,
        cli_telefono:      tel,
        cli_contacto:      document.getElementById('cli_e_contacto')?.value.trim() || '',
        cli_tel_contacto:  document.getElementById('cli_e_tel_contacto')?.value.trim() || '',
        cli_direccion:     document.getElementById('cli_e_direccion')?.value.trim() || '',
      };
      const r = await fetch(`${API}/clientes/${uid}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(x=>x.json()).catch(()=>null);
      if (!r?.success) { errEl.textContent = r?.error||'Error al guardar'; errEl.style.display='block'; return; }
      // actualizar datos en memoria y re-renderizar
      const right = document.getElementById('cliRight');
      Object.assign(right._cliData.cliente, body);
      cli_renderDetalle(uid, right._cliData);
      showToast('Cliente actualizado');
    };
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: FUNCIONARIOS
// ════════════════════════════════════════════════════════════════════════════
Views.funcionarios = {
  render() {
    return `<div style="padding:22px;" id="funcWrap">
      <div class="func-header">
        <h2>Funcionarios</h2>
        ${isAdmin()?`<button class="btn btn-dark" onclick="fun_openCreate()">+ Nuevo funcionario</button>`:''}
      </div>
      <div class="card" style="overflow-x:auto;">
        <table class="func-table" id="funcTable">
          <thead><tr><th>Nombre</th><th>Login</th><th>Rol</th><th>Estado</th>${isAdmin()?'<th>Acciones</th>':''}</tr></thead>
          <tbody><tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px;">Cargando...</td></tr></tbody>
        </table>
      </div>
    </div>`;
  },
  async init() {
    const TIPOS = {A:'Administrador',F:'Funcionario',T:'Técnico'};
    async function fun_reload() {
      const rows = await fetch(`${API}/funcionarios`).then(r=>r.json()).catch(()=>[]);
      const tb = document.querySelector('#funcTable tbody'); if (!tb) return;
      if (!rows.length) { tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px;">Sin funcionarios</td></tr>'; return; }
      tb.innerHTML = rows.map(u=>`
        <tr>
          <td style="font-weight:600">${esc(u.usu_nombre||'-')}</td>
          <td style="color:#666">${esc(u.usu_login||'-')}</td>
          <td><span class="tipo-badge tipo-${u.usu_tipo}">${TIPOS[u.usu_tipo]||u.usu_tipo}</span></td>
          <td><span class="estado-pill est-${u.usu_estado}">${u.usu_estado==='A'?'Activo':'Inactivo'}</span></td>
          ${isAdmin()?`<td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-dark" onclick="fun_openEdit(${u.uid_usuario},'${esc(u.usu_nombre||'')}','${u.usu_tipo}')">Editar</button>
            <button class="btn btn-sm btn-grey" onclick="fun_toggleEstado(${u.uid_usuario},'${u.usu_estado==='A'?'I':'A'}')">${u.usu_estado==='A'?'Desactivar':'Activar'}</button>
          </td>`:''}
        </tr>`).join('');
    }
    window.fun_openCreate = () => {
      const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='funModal';
      bg.innerHTML=`<div class="modal">
        <h3>Nuevo Funcionario</h3>
        <label>Nombre completo</label><input id="funNombre" type="text" placeholder="Ej: Juan Pérez">
        <label>Login</label><input id="funLogin" type="text" placeholder="Ej: jperez">
        <label>Contraseña inicial</label><input id="funClave" type="password" placeholder="Mínimo 6 caracteres">
        <label>Rol</label>
        <select id="funTipo"><option value="T">Técnico</option><option value="F">Funcionario</option><option value="A">Administrador</option></select>
        <div class="modal-actions">
          <button class="btn btn-grey" onclick="document.getElementById('funModal').remove()">Cancelar</button>
          <button class="btn btn-dark" onclick="fun_create()">Crear</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
    };
    window.fun_create = async () => {
      const nombre=document.getElementById('funNombre')?.value.trim();
      const login =document.getElementById('funLogin')?.value.trim();
      const clave =document.getElementById('funClave')?.value;
      const tipo  =document.getElementById('funTipo')?.value;
      if (!nombre||!login||!clave) { alert('Completa todos los campos'); return; }
      if (clave.length<6) { alert('La contraseña debe tener al menos 6 caracteres'); return; }
      const r = await fetch(`${API}/funcionarios`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre,login,clave,tipo})}).then(r=>r.json()).catch(()=>({success:false}));
      if (r.success) { document.getElementById('funModal')?.remove(); showToast('✅ Funcionario creado'); await fun_reload(); }
      else alert('Error: '+(r.error||'Error desconocido'));
    };
    window.fun_openEdit = (uid, nombre, tipo) => {
      const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='funEditModal';
      bg.innerHTML=`<div class="modal">
        <h3>Editar Funcionario</h3>
        <label>Nombre completo</label><input id="editNombre" type="text" value="${nombre}">
        <label>Rol</label>
        <select id="editTipo">
          <option value="T"${tipo==='T'?' selected':''}>Técnico</option>
          <option value="F"${tipo==='F'?' selected':''}>Funcionario</option>
          <option value="A"${tipo==='A'?' selected':''}>Administrador</option>
        </select>
        <label>Nueva contraseña <span style="color:#999;font-weight:400">(dejar vacío para no cambiar)</span></label>
        <input id="editClave" type="password" placeholder="Opcional">
        <div class="modal-actions">
          <button class="btn btn-grey" onclick="document.getElementById('funEditModal').remove()">Cancelar</button>
          <button class="btn btn-dark" onclick="fun_save(${uid})">Guardar</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
    };
    window.fun_save = async (uid) => {
      const nombre = document.getElementById('editNombre')?.value.trim();
      const tipo   = document.getElementById('editTipo')?.value;
      const clave  = document.getElementById('editClave')?.value;
      if (!nombre) { alert('El nombre es requerido'); return; }
      const body = { nombre, tipo };
      if (clave) { if (clave.length<6){alert('La contraseña debe tener al menos 6 caracteres');return;} body.clave=clave; }
      const r = await fetch(`${API}/funcionarios/${uid}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).catch(()=>({success:false}));
      if (r.success) { document.getElementById('funEditModal')?.remove(); showToast('✅ Funcionario actualizado'); await fun_reload(); }
      else alert('Error: '+(r.error||'Error desconocido'));
    };
    window.fun_toggleEstado = async (uid, nuevoEstado) => {
      const r = await fetch(`${API}/funcionarios/${uid}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:nuevoEstado})}).then(r=>r.json()).catch(()=>({success:false}));
      if (r.success) { showToast('✅ Estado actualizado'); await fun_reload(); }
      else alert('Error: '+(r.error||''));
    };
    await fun_reload();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: INVENTARIO
// ════════════════════════════════════════════════════════════════════════════
Views.inventario = {
  render() {
    return `<div style="padding:22px;">
      <div class="inv-header">
        <h2>Inventario de repuestos</h2>
        ${isAdmin()?`<button class="btn btn-dark" onclick="inv_openCreate()">+ Nuevo repuesto</button>`:''}
      </div>
      <div style="margin-bottom:12px;">
        <input type="text" id="invBuscar" placeholder="Buscar por nombre o código..."
          oninput="inv_filter()"
          style="width:100%;max-width:380px;padding:8px 12px;border:1px solid #c7d2dd;border-radius:8px;font-size:13px;box-sizing:border-box;">
      </div>
      <div class="card" style="overflow-x:auto;">
        <table class="inv-table" id="invTable">
          <thead><tr><th>Descripción</th><th>Tipo</th><th>Costo</th><th>Precio</th><th>Margen</th><th>Stock</th><th>Estado</th>${isAdmin()?'<th>Acciones</th>':''}</tr></thead>
          <tbody><tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px;">Cargando...</td></tr></tbody>
        </table>
      </div>
    </div>`;
  },
  async init() {
    const TIPOS = {R:'Repuesto',S:'Servicio',M:'Mano de obra'};
    let _invAllRows = [];
    function inv_renderRows(rows) {
      const tb = document.querySelector('#invTable tbody'); if (!tb) return;
      if (!rows.length) { tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px;">Sin resultados</td></tr>'; return; }
      tb.innerHTML = rows.map(p=>{
        const precio = Number(p.cco_valor) || 0;
        const costo  = Number(p.cco_costo) || 0;
        const margen = precio > 0 ? Math.round((precio - costo) / precio * 100) : 0;
        const margenColor = margen >= 40 ? '#27ae60' : margen >= 20 ? '#e67e22' : '#e74c3c';
        const stockColor  = Number(p.cco_stock) <= 2 ? '#e74c3c' : '#333';
        return `
        <tr>
          <td style="font-weight:500">${esc(p.cco_descripcion||'-')}</td>
          <td style="color:#666">${TIPOS[p.cco_tipo]||p.cco_tipo||'-'}</td>
          <td class="inv-precio" style="color:#555">${money(costo)}</td>
          <td class="inv-precio">${money(precio)}</td>
          <td style="font-weight:700;color:${margenColor}">${margen}%</td>
          <td style="font-weight:600;color:${stockColor}">${Number(p.cco_stock)||0}</td>
          <td><span class="estado-pill est-${p.cco_estado}">${p.cco_estado==='A'?'Activo':'Inactivo'}</span></td>
          ${isAdmin()?`<td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm" style="background:#0e7490;color:#fff;" onclick="inv_recibir(${p.uid_concepto_costo},'${esc(p.cco_descripcion)}',${costo},${Number(p.cco_stock)||0},${precio})">📥 Recibir</button>
            <button class="btn btn-sm btn-mid" onclick="inv_edit(${p.uid_concepto_costo},'${esc(p.cco_descripcion)}',${precio},${costo},${Number(p.cco_stock)||0},'${p.cco_tipo}')">Editar</button>
            <button class="btn btn-sm btn-grey" onclick="inv_toggle(${p.uid_concepto_costo},'${p.cco_estado==='A'?'I':'A'}')">${p.cco_estado==='A'?'Desactivar':'Activar'}</button>
          </td>`:''}
        </tr>`;
      }).join('');
    }
    async function inv_reload() {
      _invAllRows = await fetch(`${API}/inventario`).then(r=>r.json()).catch(()=>[]);
      inv_renderRows(_invAllRows);
    }
    window.inv_filter = function() {
      const q = (document.getElementById('invBuscar')?.value || '').toLowerCase().trim();
      if (!q) { inv_renderRows(_invAllRows); return; }
      inv_renderRows(_invAllRows.filter(p =>
        (p.cco_descripcion || '').toLowerCase().includes(q) ||
        String(p.uid_concepto_costo).includes(q)
      ));
    };
    window.inv_openCreate = () => inv_openModal();
    window.inv_edit = (id, desc, val, costo, stock, tipo) => inv_openModal(id, desc, val, costo, stock, tipo);
    function inv_openModal(id=null, desc='', val=0, costo=0, stock=0, tipo='R') {
      document.getElementById('invModal')?.remove();
      const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='invModal';
      bg.innerHTML=`<div class="modal">
        <h3>${id?'Editar repuesto':'Nuevo repuesto'}</h3>
        <label>Descripción</label>
        <input id="invDesc" type="text" value="${esc(desc)}" placeholder="Ej: Carbones de motor">
        <label>Tipo</label>
        <select id="invTipo">
          <option value="R"${tipo==='R'?' selected':''}>Repuesto</option>
          <option value="S"${tipo==='S'?' selected':''}>Servicio</option>
          <option value="M"${tipo==='M'?' selected':''}>Mano de obra</option>
        </select>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
          <div>
            <label style="margin-top:0">Costo ($)</label>
            <input id="invCosto" type="number" value="${costo}" min="0" placeholder="0" oninput="inv_calcMargen()">
          </div>
          <div>
            <label style="margin-top:0">Precio ($)</label>
            <input id="invVal" type="number" value="${val}" min="0" placeholder="0" oninput="inv_calcMargen()">
          </div>
        </div>
        <div id="invMargenPreview" style="font-size:12px;color:#888;margin-top:4px;text-align:right;"></div>
        <label>Stock (unidades)</label>
        <input id="invStock" type="number" value="${stock}" min="0" placeholder="0">
        <div class="modal-actions">
          <button class="btn btn-grey" onclick="document.getElementById('invModal').remove()">Cancelar</button>
          <button class="btn btn-dark" onclick="inv_save(${id||'null'})">${id?'Guardar':'Crear'}</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
      inv_calcMargen();
    }
    window.inv_calcMargen = () => {
      const precio = Number(document.getElementById('invVal')?.value) || 0;
      const costo  = Number(document.getElementById('invCosto')?.value) || 0;
      const el = document.getElementById('invMargenPreview'); if (!el) return;
      if (!precio) { el.textContent = ''; return; }
      const margen = Math.round((precio - costo) / precio * 100);
      const color = margen >= 40 ? '#27ae60' : margen >= 20 ? '#e67e22' : '#e74c3c';
      el.innerHTML = `Margen: <strong style="color:${color}">${margen}%</strong>`;
    };
    window.inv_save = async (id) => {
      const desc  = document.getElementById('invDesc')?.value.trim();
      const val   = document.getElementById('invVal')?.value;
      const costo = document.getElementById('invCosto')?.value;
      const stock = document.getElementById('invStock')?.value;
      const tipo  = document.getElementById('invTipo')?.value;
      if (!desc) { showToast('⚠️ Escribe una descripción'); return; }
      let r;
      if (id) {
        r = await fetch(`${API}/inventario/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({descripcion:desc,valor:Number(val)||0,costo:Number(costo)||0,stock:Number(stock)||0})}).then(r=>r.json()).catch(()=>({success:false}));
      } else {
        r = await fetch(`${API}/inventario`,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({descripcion:desc,valor:Number(val)||0,costo:Number(costo)||0,stock:Number(stock)||0,tipo})}).then(r=>r.json()).catch(()=>({success:false}));
      }
      if (r.success) { document.getElementById('invModal')?.remove(); showToast('✅ Guardado'); await inv_reload(); }
      else showToast('⚠️ Error: '+(r.error||''));
    };
    window.inv_toggle = async (id, estado) => {
      const r = await fetch(`${API}/inventario/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado})}).then(r=>r.json()).catch(()=>({success:false}));
      if (r.success) { showToast('✅ Actualizado'); await inv_reload(); }
      else alert('Error: '+(r.error||''));
    };

    window.inv_recibir = async function(id, desc, costoActual, stockActual, precioActual) {
      document.getElementById('invRecModal')?.remove();
      const today = new Date().toISOString().slice(0,10);
      const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='invRecModal';
      bg.innerHTML=`<div class="modal" style="max-width:460px;">
        <h3>📥 Recibir compra</h3>
        <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:14px;">${esc(desc)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Fecha</label>
            <input id="irFecha" type="date" value="${today}" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          </div>
          <div>
            <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Unidades recibidas <span style="color:#e53e3e">*</span></label>
            <input id="irUnids" type="number" min="1" placeholder="Ej: 10" oninput="inv_prevPromedio(${costoActual},${stockActual})"
              style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
          <div>
            <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Costo unitario de esta compra ($) <span style="color:#e53e3e">*</span></label>
            <input id="irCosto" type="number" min="0" placeholder="Ej: 32000" oninput="inv_prevPromedio(${costoActual},${stockActual},${precioActual})"
              style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          </div>
          <div>
            <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Nuevo precio de venta ($) <span style="color:#aaa;font-weight:400;">(opcional)</span></label>
            <input id="irPrecio" type="number" min="0" placeholder="${precioActual}" oninput="inv_prevPromedio(${costoActual},${stockActual},${precioActual})"
              style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          </div>
        </div>
        <div id="irPreview" style="margin-top:12px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;font-size:12px;display:none;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;text-align:center;">
            <div><div style="color:#888;margin-bottom:2px;">Costo ant.</div><strong style="color:#555;">${money(costoActual)}</strong></div>
            <div><div style="color:#888;margin-bottom:2px;">Stock ant.</div><strong style="color:#555;">${stockActual} un.</strong></div>
            <div><div style="color:#888;margin-bottom:2px;">→ Costo prom.</div><strong id="irNuevoCosto" style="color:#0e7490;font-size:14px;"></strong></div>
            <div><div style="color:#888;margin-bottom:2px;">Margen</div><strong id="irMargen" style="font-size:14px;"></strong></div>
          </div>
          <div style="text-align:center;margin-top:6px;color:#555;font-size:11px;">
            Nuevo stock: <strong id="irNuevoStock" style="color:#1d3557;"></strong> unidades
          </div>
        </div>
        <div id="irHistorial" style="margin-top:14px;"></div>
        <div class="modal-actions" style="margin-top:14px;">
          <button class="btn btn-grey" onclick="document.getElementById('invRecModal').remove()">Cancelar</button>
          <button class="btn btn-dark" onclick="inv_guardarRecepcion(${id})">Registrar recepción</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
      bg.addEventListener('click', e => { if (e.target===bg) bg.remove(); });
      fetch(`${API}/inventario/${id}/recepciones`).then(r=>r.json()).then(rows => {
        const el = document.getElementById('irHistorial'); if (!el || !rows.length) return;
        el.innerHTML = `<div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">Últimas recepciones</div>
          <div style="max-height:140px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;">
          ${rows.map(r => `
            <div style="display:grid;grid-template-columns:80px 60px 1fr 1fr;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid #f0f4f8;font-size:11px;">
              <span style="color:#888;">${String(r.ir_fecha).slice(0,10)}</span>
              <span style="font-weight:600;">${r.ir_unidades} un.</span>
              <span style="color:#555;">Costo: ${money(r.ir_costo_unitario)}</span>
              <span style="color:#0e7490;">→ Prom: ${money(r.ir_costo_resultante)}</span>
            </div>`).join('')}
          </div>`;
      }).catch(()=>{});
    };

    window.inv_prevPromedio = function(costoAnt, stockAnt, precioAnt) {
      const unids  = parseInt(document.getElementById('irUnids')?.value) || 0;
      const costo  = parseFloat(document.getElementById('irCosto')?.value);
      const precio = parseFloat(document.getElementById('irPrecio')?.value) || precioAnt;
      const prev   = document.getElementById('irPreview');
      if (!prev) return;
      if (!unids || isNaN(costo)) { prev.style.display='none'; return; }
      const stockNuevo = stockAnt + unids;
      const costoNuevo = ((stockAnt * costoAnt) + (unids * costo)) / stockNuevo;
      const margen = precio > 0 ? Math.round((precio - costoNuevo) / precio * 100) : null;
      const margenColor = margen === null ? '#888' : margen >= 40 ? '#27ae60' : margen >= 20 ? '#e67e22' : '#e74c3c';
      document.getElementById('irNuevoCosto').textContent = money(Math.round(costoNuevo));
      document.getElementById('irNuevoStock').textContent = stockNuevo;
      document.getElementById('irMargen').innerHTML = margen !== null
        ? `<span style="color:${margenColor}">${margen}%</span>` : '—';
      prev.style.display = '';
    };

    window.inv_guardarRecepcion = async function(id) {
      const unids  = parseInt(document.getElementById('irUnids')?.value);
      const costo  = parseFloat(document.getElementById('irCosto')?.value);
      const fecha  = document.getElementById('irFecha')?.value;
      const precio = document.getElementById('irPrecio')?.value;
      if (!unids || unids <= 0) { showToast('⚠️ Ingresa las unidades recibidas'); return; }
      if (isNaN(costo) || costo < 0) { showToast('⚠️ Ingresa el costo unitario'); return; }
      const body = { unidades: unids, costo_unitario: costo, fecha };
      if (precio && !isNaN(parseFloat(precio))) body.nuevo_precio = parseFloat(precio);
      const r = await fetch(`${API}/inventario/${id}/recepcion`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      }).then(r=>r.json()).catch(()=>({error:'Error de red'}));
      if (r.success) {
        document.getElementById('invRecModal')?.remove();
        const precioMsg = r.cco_valor ? ` · Precio: ${money(r.cco_valor)}` : '';
        showToast(`✅ Recepción registrada — costo prom: ${money(r.cco_costo)} · Stock: ${r.cco_stock} un.${precioMsg}`);
        await inv_reload();
      } else {
        showToast('⚠️ ' + (r.error || 'Error al registrar'));
      }
    };

    await inv_reload();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: RECIBOS DE CAJA
// ════════════════════════════════════════════════════════════════════════════
Views.recibos = {
  render() {
    return `<div style="padding:22px;">
      <div class="inv-header">
        <h2>Recibos de Caja</h2>
        <button class="btn btn-dark" onclick="rc_openCreate()">+ Nuevo Recibo</button>
      </div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <label style="font-size:12px;color:#666;display:block;margin-bottom:3px;">Desde</label>
          <input type="date" id="rcFechaDesde" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
        </div>
        <div>
          <label style="font-size:12px;color:#666;display:block;margin-bottom:3px;">Hasta</label>
          <input type="date" id="rcFechaHasta" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
        </div>
        <div>
          <label style="font-size:12px;color:#666;display:block;margin-bottom:3px;">Estado</label>
          <select id="rcEstado" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="anulado">Anulados</option>
          </select>
        </div>
        <button class="btn btn-mid" onclick="rc_reload()">Buscar</button>
      </div>
      <div class="card" style="overflow-x:auto;">
        <table class="inv-table" id="rcTable">
          <thead><tr><th>No.</th><th>Fecha</th><th>Cliente / Nombre</th><th>Orden</th><th>Concepto</th><th>Valor</th><th>Método</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody><tr><td colspan="9" style="text-align:center;color:#aaa;padding:20px;">Cargando...</td></tr></tbody>
        </table>
      </div>
    </div>`;
  },
  async init() {
    const METODOS = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', nequi:'Nequi', daviplata:'Daviplata' };

    window.rc_reload = async function() {
      const params = new URLSearchParams();
      const desde  = document.getElementById('rcFechaDesde')?.value;
      const hasta  = document.getElementById('rcFechaHasta')?.value;
      const estado = document.getElementById('rcEstado')?.value;
      if (desde)  params.set('fecha_desde', desde);
      if (hasta)  params.set('fecha_hasta', hasta);
      if (estado) params.set('estado', estado);

      const rows = await fetch(`${API}/recibos?${params}`).then(r=>r.json()).catch(()=>[]);
      const tb = document.querySelector('#rcTable tbody'); if (!tb) return;
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:20px;">Sin recibos</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(r => {
        const nombre = esc(r.cli_razon_social || r.cli_contacto || r.rc_nombre_paga || 'Mostrador');
        const anulado = r.rc_estado === 'anulado';
        return `<tr style="${anulado ? 'opacity:.55;' : ''}">
          <td style="font-weight:600">${r.rc_consecutivo}</td>
          <td style="white-space:nowrap">${fmtFecha(r.rc_fecha)}</td>
          <td>${nombre}</td>
          <td style="color:#666">${r.ord_consecutivo ? '#' + r.ord_consecutivo : '—'}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.rc_concepto)}">${esc(r.rc_concepto)}</td>
          <td style="font-weight:600;white-space:nowrap">${money(r.rc_valor)}</td>
          <td style="color:#666">${METODOS[r.rc_metodo_pago] || r.rc_metodo_pago}</td>
          <td><span class="estado-pill" style="background:${anulado?'#fee2e2':'#dcfce7'};color:${anulado?'#b91c1c':'#166534'}">${anulado ? 'Anulado' : 'Activo'}</span></td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <a href="${API}/recibos/${r.uid_recibo}/pdf" target="_blank" class="btn btn-sm btn-mid">PDF</a>
            ${!anulado ? `<button class="btn btn-sm btn-grey" onclick="rc_anular(${r.uid_recibo})">Anular</button>` : ''}
          </td>
        </tr>`;
      }).join('');
    };

    window.rc_anular = async function(id) {
      if (!confirm('¿Anular este recibo? Esta acción no se puede deshacer.')) return;
      const r = await fetch(`${API}/recibos/${id}/anular`, { method: 'PATCH' }).then(r=>r.json()).catch(()=>({error:'Error de red'}));
      if (r.ok) { showToast('✅ Recibo anulado'); await rc_reload(); }
      else alert('Error: ' + (r.error || 'No se pudo anular'));
    };

    const SUGG_STYLE = 'background:#fff;border:1px solid #ddd;border-radius:6px;display:none;max-height:150px;overflow-y:auto;margin-top:2px;position:relative;z-index:10;';
    const SUGG_ROW   = 'padding:9px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5;';

    const fmtCOP = n => '$' + Number(n||0).toLocaleString('es-CO');

    // ── Items manuales (mostrador / orden sin cotización) ──────────────────
    let _rcItems = [];
    let _rcHasCotiz = false;

    function rc_renderItems() {
      const tbl = document.getElementById('rcItemsTable'); if (!tbl) return;
      if (!_rcItems.length) {
        tbl.innerHTML = '<div style="color:#bbb;font-size:12px;padding:4px 0;">Sin ítems — el PDF mostrará solo el concepto.</div>';
        document.getElementById('rcValorHint') && (document.getElementById('rcValorHint').textContent = '');
        return;
      }
      tbl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f0f4f8;">
          <th style="padding:4px 5px;text-align:left;">Descripción</th>
          <th style="padding:4px 4px;width:48px;text-align:center;">Cant.</th>
          <th style="padding:4px 5px;width:88px;text-align:right;">Precio</th>
          <th style="padding:4px 5px;width:78px;text-align:right;">Subtotal</th>
          <th style="width:22px;"></th>
        </tr></thead>
        <tbody>${_rcItems.map((it, i) => {
          const sub = (Number(it.cantidad)||1) * (Number(it.precio)||0);
          return `<tr style="border-top:1px solid #f0f0f0;">
            <td><input style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 5px;font-size:12px;" value="${esc(it.nombre||'')}" oninput="rc_onItemChange(${i},'nombre',this.value)"></td>
            <td><input type="number" min="1" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 3px;font-size:12px;text-align:center;" value="${it.cantidad||1}" oninput="rc_onItemChange(${i},'cantidad',this.value)"></td>
            <td><input type="number" min="0" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 3px;font-size:12px;text-align:right;" value="${it.precio||0}" oninput="rc_onItemChange(${i},'precio',this.value)"></td>
            <td style="text-align:right;padding-right:4px;">${fmtCOP(sub)}</td>
            <td><button type="button" onclick="rc_removeItem(${i})" style="background:none;border:none;cursor:pointer;color:#e53e3e;font-size:14px;padding:0 2px;">✕</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
      const total = _rcItems.reduce((s, it) => s + (Number(it.cantidad)||1)*(Number(it.precio)||0), 0);
      const valEl = document.getElementById('rcNValor');
      const hint  = document.getElementById('rcValorHint');
      if (valEl && total > 0) valEl.value = total;
      if (hint) hint.textContent = total > 0 ? `Total calculado desde ítems: ${fmtCOP(total)}` : '';
    }

    window.rc_addItem    = function() { _rcItems.push({ nombre:'', cantidad:1, precio:0 }); rc_renderItems(); };
    window.rc_removeItem = function(i) { _rcItems.splice(i, 1); rc_renderItems(); };
    window.rc_onItemChange = function(i, field, val) {
      if (!_rcItems[i]) return;
      _rcItems[i][field] = field === 'nombre' ? val : (Number(val)||0);
      rc_renderItems();
    };
    window.rc_onValorChange = function() {
      const hint = document.getElementById('rcValorHint'); if (hint) hint.textContent = '';
    };

    window.rc_openCreate = function() {
      document.getElementById('rcModal')?.remove();
      _rcItems = []; _rcHasCotiz = false;
      const today = new Date().toISOString().slice(0,10);
      const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='rcModal';
      bg.innerHTML = `<div class="modal" style="max-width:540px;width:94%;max-height:90vh;overflow-y:auto;">
        <h3>Nuevo Recibo de Caja</h3>

        <label style="margin-top:6px;">Buscar orden <span style="font-size:11px;color:#888;">— opcional, rellena cliente y concepto</span></label>
        <input type="text" id="rcNOrdenQ" placeholder="# consecutivo, nombre o NIT del cliente" style="width:100%;" oninput="rc_buscarOrden(this.value)">
        <div id="rcOrdenSugg" style="${SUGG_STYLE}"></div>
        <input type="hidden" id="rcNOrdenId">

        <div id="rcCotizInfo" style="display:none;margin-top:6px;padding:7px 10px;background:#ebf8f0;border:1px solid #68d391;border-radius:6px;font-size:12px;color:#276749;">
          ✅ <strong>Cotización disponible</strong> — el PDF incluirá el desglose completo de la orden.
        </div>

        <div style="margin:10px 0 4px;border-top:1px solid #f0f0f0;padding-top:10px;">
          <label>Cédula / NIT <span style="font-size:11px;color:#888;">— busca cliente registrado o déjalo para mostrador</span></label>
          <input type="text" id="rcNCedula" placeholder="Ej: 9862087" style="width:100%;margin-top:3px;" oninput="rc_buscarPorCedula(this.value)">
          <div id="rcCedulaSugg" style="${SUGG_STYLE}"></div>
          <label style="margin-top:8px;">Nombre / Razón social <span style="font-size:11px;color:#888;">— o escribe libre para mostrador</span></label>
          <input type="text" id="rcNCliente" placeholder="Nombre o razón social" style="width:100%;" oninput="rc_buscarCliente(this.value);rc_toggleCedula()">
          <div id="rcClienteSugg" style="${SUGG_STYLE}"></div>
          <input type="hidden" id="rcNClienteId">
        </div>

        <label style="margin-top:10px;">Fecha <span style="color:#e53e3e">*</span></label>
        <input type="date" id="rcNFecha" value="${today}" style="width:100%;">

        <label style="margin-top:10px;">Concepto <span style="color:#e53e3e">*</span></label>
        <textarea id="rcNConcepto" rows="2" placeholder="Descripción del pago recibido..." style="width:100%;resize:vertical;"></textarea>

        <div id="rcItemsSection" style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f0f0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <label style="margin:0;font-size:13px;">Ítems del servicio <span style="font-size:11px;color:#888;font-weight:400;">— opcional</span></label>
            <button type="button" class="btn btn-grey" style="padding:2px 10px;font-size:12px;" onclick="rc_addItem()">+ Agregar ítem</button>
          </div>
          <div id="rcItemsTable"></div>
        </div>

        <label style="margin-top:12px;">Valor total <span style="color:#e53e3e">*</span></label>
        <input type="number" id="rcNValor" min="1" placeholder="0" style="width:100%;" oninput="rc_onValorChange()">
        <div id="rcValorHint" style="font-size:11px;color:#888;margin-top:2px;"></div>

        <label style="margin-top:10px;">Método de pago</label>
        <select id="rcNMetodo" style="width:100%;">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia bancaria</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="nequi">Nequi</option>
          <option value="daviplata">Daviplata</option>
        </select>

        <label style="margin-top:10px;">Referencia <span style="font-size:11px;color:#888;">— No. transferencia, voucher...</span></label>
        <input type="text" id="rcNRef" placeholder="Opcional" style="width:100%;">

        <div id="rcNError" style="color:#c53030;font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions">
          <button class="btn btn-grey" onclick="document.getElementById('rcModal').remove()">Cancelar</button>
          <button class="btn btn-dark" onclick="rc_guardar()">Crear Recibo</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
      rc_renderItems();
    };

    // Buscar orden por consecutivo / nombre / NIT
    let _rcOrdenTimer;
    window.rc_buscarOrden = function(q) {
      const sugg = document.getElementById('rcOrdenSugg'); if (!sugg) return;
      document.getElementById('rcNOrdenId').value = '';
      clearTimeout(_rcOrdenTimer);
      if (!q || q.length < 1) { sugg.style.display='none'; return; }
      _rcOrdenTimer = setTimeout(async () => {
        const data = await fetch(`${API}/orders/search?q=${encodeURIComponent(q)}&limit=6`).then(r=>r.json()).catch(()=>[]);
        if (!data.length) { sugg.style.display='none'; return; }
        sugg.style.display = 'block';
        sugg.innerHTML = data.map(o => {
          const nombre = esc(o.cli_razon_social || o.cli_contacto || '');
          const maq    = o.maquinas_resumen ? ` — ${esc(o.maquinas_resumen)}` : '';
          return `<div style="${SUGG_ROW}" onmousedown="rc_selOrden(${o.uid_orden},${o.ord_consecutivo},'${nombre}',${o.uid_cliente||'null'},'${esc(o.cli_direccion||'')}','${esc(o.cli_telefono||'')}','${maq.replace(/'/g,"\\'")}')">
            <span style="font-weight:600">Orden #${o.ord_consecutivo}</span> · ${nombre}${maq}
          </div>`;
        }).join('');
      }, 280);
    };

    // Al seleccionar una orden: rellena uid_orden, cliente, concepto y verifica cotización
    window.rc_selOrden = async function(uid, consec, nombre, clienteId, dir, tel, maqSuffix) {
      document.getElementById('rcNOrdenId').value  = uid;
      document.getElementById('rcNOrdenQ').value   = `#${consec} — ${nombre}`;
      document.getElementById('rcOrdenSugg').style.display = 'none';
      if (clienteId) {
        document.getElementById('rcNClienteId').value = clienteId;
        document.getElementById('rcNCliente').value   = nombre;
      }
      const concEl = document.getElementById('rcNConcepto');
      if (concEl && !concEl.value.trim()) concEl.value = `Pago orden de servicio #${consec}${maqSuffix}`;

      const cotizInfo   = document.getElementById('rcCotizInfo');
      const itemsSection = document.getElementById('rcItemsSection');
      try {
        const data = await fetch(`${API}/recibos/cotizacion-orden/${uid}`).then(r=>r.json());
        _rcHasCotiz = data.hasCotizacion;
        if (data.hasCotizacion) {
          if (cotizInfo)    cotizInfo.style.display    = 'block';
          if (itemsSection) itemsSection.style.display = 'none';
          // Pre-fill valor con total de la cotización
          const total = (data.machines||[]).reduce((s, m) => {
            const mis = (data.items||[]).filter(it => String(it.uid_herramienta_orden) === String(m.uid_herramienta_orden));
            return s + Number(m.mano_obra||0) + mis.reduce((si, it) => si + (Number(it.cantidad)||1)*Number(it.precio||0), 0);
          }, 0);
          if (total > 0) {
            document.getElementById('rcNValor').value = total;
            const hint = document.getElementById('rcValorHint');
            if (hint) hint.textContent = `Total de la cotización: ${fmtCOP(total)}`;
          }
        } else {
          if (cotizInfo)    cotizInfo.style.display    = 'none';
          if (itemsSection) itemsSection.style.display = 'block';
        }
      } catch {}
    };

    // Buscar cliente por nombre / NIT (sin orden)
    // Buscar por cédula/NIT — auto-rellena el campo Nombre si hay match
    window.rc_buscarPorCedula = async function(q) {
      const sugg = document.getElementById('rcCedulaSugg'); if (!sugg) return;
      document.getElementById('rcNClienteId').value = '';
      document.getElementById('rcNCliente').value   = '';
      if (!q || q.length < 2) { sugg.style.display='none'; return; }
      const data = await fetch(`${API}/clientes/search?q=${encodeURIComponent(q)}&limit=6`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) { sugg.style.display='none'; return; }
      sugg.style.display = 'block';
      sugg.innerHTML = data.map(c => {
        const nombre = esc(c.cli_razon_social || c.cli_contacto || c.cli_identificacion);
        const nit    = esc(c.cli_identificacion || '');
        return `<div style="${SUGG_ROW}" onmousedown="rc_selClienteCedula(${c.uid_cliente},'${nombre}','${nit}')">${nombre} <span style="color:#888;font-size:11px;">${nit}</span></div>`;
      }).join('');
    };

    window.rc_selClienteCedula = function(id, nombre, nit) {
      document.getElementById('rcNClienteId').value = id;
      document.getElementById('rcNCliente').value   = nombre;
      document.getElementById('rcNCedula').value    = nit;
      document.getElementById('rcCedulaSugg').style.display = 'none';
    };

    // Buscar cliente por nombre (campo secundario)
    window.rc_buscarCliente = async function(q) {
      const sugg = document.getElementById('rcClienteSugg'); if (!sugg) return;
      document.getElementById('rcNClienteId').value = '';
      if (!q || q.length < 2) { sugg.style.display='none'; return; }
      const data = await fetch(`${API}/clientes/search?q=${encodeURIComponent(q)}&limit=6`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) { sugg.style.display='none'; return; }
      sugg.style.display = 'block';
      sugg.innerHTML = data.map(c => {
        const nombre = esc(c.cli_razon_social || c.cli_contacto || c.cli_identificacion);
        return `<div style="${SUGG_ROW}" onmousedown="rc_selCliente(${c.uid_cliente},'${nombre}')">${nombre}</div>`;
      }).join('');
    };

    window.rc_selCliente = function(id, nombre) {
      document.getElementById('rcNClienteId').value = id;
      document.getElementById('rcNCliente').value   = nombre;
      document.getElementById('rcClienteSugg').style.display = 'none';
    };

    // No-op mantenido por compatibilidad con oninput en rcNCliente
    window.rc_toggleCedula = function() {};

    window.rc_guardar = async function() {
      const errEl      = document.getElementById('rcNError');
      const fecha      = document.getElementById('rcNFecha')?.value;
      const concepto   = document.getElementById('rcNConcepto')?.value.trim();
      const valor      = document.getElementById('rcNValor')?.value;
      const metodo     = document.getElementById('rcNMetodo')?.value;
      const ref        = document.getElementById('rcNRef')?.value.trim();
      const clienteId  = document.getElementById('rcNClienteId')?.value || null;
      const clienteTxt = document.getElementById('rcNCliente')?.value.trim();
      const uidOrden   = document.getElementById('rcNOrdenId')?.value || null;

      if (!fecha)    { errEl.textContent='La fecha es obligatoria.';   errEl.style.display='block'; return; }
      if (!concepto) { errEl.textContent='El concepto es obligatorio.'; errEl.style.display='block'; return; }
      if (!valor || Number(valor) <= 0) { errEl.textContent='El valor debe ser mayor a cero.'; errEl.style.display='block'; return; }
      errEl.style.display = 'none';

      // Incluir ítems solo si hay tabla manual visible (no cuando hay cotización)
      const items = (!_rcHasCotiz && _rcItems.length)
        ? _rcItems.filter(it => it.nombre || Number(it.precio) > 0)
        : [];

      const cedula = document.getElementById('rcNCedula')?.value.trim() || null;
      const body = {
        rc_fecha: fecha, rc_concepto: concepto,
        rc_valor: Number(valor), rc_metodo_pago: metodo,
        rc_referencia: ref || null,
        uid_cliente:       clienteId ? Number(clienteId) : null,
        uid_orden:         uidOrden  ? Number(uidOrden)  : null,
        rc_nombre_paga:    (!clienteId && clienteTxt) ? clienteTxt : null,
        rc_cliente_cedula: (!clienteId && cedula)      ? cedula     : null,
        rc_items:          items.length ? items : undefined,
      };

      const r = await fetch(`${API}/recibos`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      }).then(r=>r.json()).catch(()=>({error:'Error de red'}));

      if (r.uid_recibo) {
        document.getElementById('rcModal')?.remove();
        showToast('✅ Recibo #' + r.rc_consecutivo + ' creado');
        await rc_reload();
      } else {
        errEl.textContent = r.error || 'No se pudo crear el recibo';
        errEl.style.display = 'block';
      }
    };

    await rc_reload();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: NUEVA ORDEN (wizard)
// ════════════════════════════════════════════════════════════════════════════
Views.nuevaOrden = {
  render() {
    return `
    <div class="no-wrap">
      <div class="no-steps">
        <div class="no-step active" id="no_step1_tab">1. Cliente</div>
        <div class="no-step" id="no_step2_tab">2. Máquinas</div>
        <div class="no-step" id="no_step3_tab">3. Confirmar</div>
      </div>

      <!-- STEP 1: CLIENTE -->
      <div id="no_step1">
        <div class="card">
          <h2 style="font-size:16px;color:var(--dark);margin-bottom:16px;">Buscar cliente</h2>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <input id="no_clientSearch" type="text"
              style="flex:1;padding:9px 11px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none;"
              placeholder="Cédula, NIT, nombre o teléfono..." oninput="no_buscarCliente()">
          </div>
          <div id="no_clientResults"></div>
          <div id="no_selectedClientCard" style="display:none;"></div>
          <hr class="no-divider">
          <button class="no-toggle-link" onclick="no_toggleNewClient()">+ Crear nuevo cliente</button>
          <div id="no_newClientForm" style="display:none;margin-top:16px;">
            <h3 style="font-size:14px;color:#333;margin-bottom:12px;">Nuevo cliente</h3>
            <div class="no-grid2">
              <div class="no-fgroup">
                <label>Identificación <span class="no-req">*</span></label>
                <input id="no_nc_id" type="text" placeholder="Cédula o NIT" inputmode="numeric"
                  oninput="this.value=this.value.replace(/[^0-9]/g,'')" onblur="no_sugerirClave()">
              </div>
              <div class="no-fgroup">
                <label>Razón Social <span class="no-req">*</span></label>
                <input id="no_nc_nombre" type="text" placeholder="Nombre o empresa">
              </div>
            </div>
            <div class="no-grid2">
              <div class="no-fgroup">
                <label>Teléfono <span class="no-req">*</span></label>
                <input id="no_nc_tel" type="text" inputmode="numeric" placeholder="Teléfono"
                  oninput="this.value=this.value.replace(/[^0-9\\s\\/\\-]/g,'')">
              </div>
              <div class="no-fgroup">
                <label>Dirección</label>
                <input id="no_nc_dir" type="text" placeholder="Dirección">
              </div>
            </div>
            <div class="no-grid2">
              <div class="no-fgroup">
                <label>Contacto</label>
                <input id="no_nc_contacto" type="text" placeholder="Nombre del contacto">
              </div>
              <div class="no-fgroup">
                <label>Teléfono Contacto</label>
                <input id="no_nc_tel_contacto" type="text" inputmode="numeric" placeholder="Teléfono contacto"
                  oninput="this.value=this.value.replace(/[^0-9\\s\\/\\-]/g,'')">
              </div>
            </div>
            <div class="no-fgroup" style="max-width:220px;">
              <label>Clave asignada <span class="no-req">*</span></label>
              <input id="no_nc_clave" type="text" placeholder="Últimos 4 dígitos">
              <div class="no-muted" style="margin-top:4px;">Por defecto: últimos 4 dígitos de la identificación</div>
            </div>
            <div id="no_newClientError" class="no-alert-err" style="display:none;"></div>
            <button class="btn btn-dark" onclick="no_crearCliente()">Crear cliente</button>
          </div>
        </div>
        <div class="no-nav-row">
          <span></span>
          <button class="btn btn-dark" id="no_btnStep1Next" onclick="no_goStep2()" disabled>Siguiente →</button>
        </div>
      </div>

      <!-- STEP 2: MÁQUINAS -->
      <div id="no_step2" style="display:none;">
        <div class="card">
          <div id="no_step2ClientCard"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h2 style="font-size:16px;color:var(--dark);margin:0;">Máquinas en esta orden</h2>
            <button class="btn btn-dark" onclick="no_abrirModalMaquina()">+ Agregar máquina</button>
          </div>
          <div id="no_maquinasEnOrden"></div>
        </div>
        <div class="no-nav-row">
          <button class="btn btn-grey" onclick="no_goStep1()">← Atrás</button>
          <button class="btn btn-dark" id="no_btnStep2Next" onclick="no_goStep3()" disabled>Siguiente →</button>
        </div>
      </div>

      <!-- Modal agregar máquina nueva orden -->
      <div id="no_modalMaquina" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);align-items:center;justify-content:center;">
        <div style="background:#fff;width:94%;max-width:520px;border-radius:12px;overflow:hidden;max-height:90vh;display:flex;flex-direction:column;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
            <span style="font-weight:600;font-size:15px;">Agregar máquina a la orden</span>
            <button onclick="no_cerrarModalMaquina()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;">✕</button>
          </div>
          <div style="padding:16px;overflow-y:auto;">
            <div id="no_mm_selectRow" class="no-fgroup">
              <label>Máquinas del cliente</label>
              <select id="no_mm_select" style="width:100%;" onchange="no_onSelectMaquinaModal(this)">
                <option value="">-- Seleccionar máquina --</option>
              </select>
            </div>
            <div id="no_mm_obsRow" style="display:none;" class="no-fgroup">
              <label>Observaciones de recepción</label>
              <textarea id="no_mm_obs" rows="3" style="width:100%;resize:vertical;" placeholder="Estado visible, falla reportada, accesorios..."></textarea>
            </div>
            <div id="no_mm_separador" style="text-align:center;margin:12px 0;color:#999;font-size:13px;">— o —</div>
            <button id="no_mm_btnNueva" class="no-toggle-link" style="width:100%;text-align:center;" onclick="no_toggleNuevaMaqModal()">+ Crear nueva máquina</button>
            <div id="no_mm_nuevaForm" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;">
              <div class="no-grid2">
                <div class="no-fgroup"><label>Nombre <span class="no-req">*</span></label><input id="no_mm_nombre" type="text" placeholder="Ej: Taladro, Esmeril..."></div>
                <div class="no-fgroup"><label>Marca</label><input id="no_mm_marca" type="text" placeholder="Bosch, DeWalt..."></div>
                <div class="no-fgroup"><label>Serial</label><input id="no_mm_serial" type="text"></div>
                <div class="no-fgroup"><label>Referencia</label><input id="no_mm_ref" type="text"></div>
              </div>
              <div class="no-fgroup">
                <label>Observaciones de recepción</label>
                <textarea id="no_mm_nuevaObs" rows="3" style="width:100%;resize:vertical;" placeholder="Estado visible, falla reportada, accesorios..."></textarea>
              </div>
              <div id="no_mm_error" class="no-alert-err" style="display:none;"></div>
            </div>
            <!-- Bloque garantía por máquina -->
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="no_mm_chkGarantia" onchange="no_mm_toggleGarantia(this.checked)"
                  style="width:16px;height:16px;cursor:pointer;accent-color:var(--dark);">
                <span style="font-size:13px;font-weight:600;">¿Esta máquina está en garantía?</span>
                <span style="font-size:11px;font-weight:700;background:#c0392b;color:#fff;padding:1px 7px;border-radius:4px;letter-spacing:.3px;">GARANTÍA</span>
              </label>
              <div id="no_mm_garantiaFields" style="display:none;margin-top:10px;">
                <div class="no-fgroup">
                  <label>Fecha de vencimiento <span class="no-req">*</span></label>
                  <input type="date" id="no_mm_garantiaVence" style="max-width:200px;">
                </div>
                <div class="no-fgroup" style="margin-top:8px;">
                  <label>Factura de compra (PDF) <span style="font-size:11px;color:#888;">— opcional</span></label>
                  <label class="upload-foto-btn" id="no_mm_facturaLabel" style="display:inline-block;padding:6px 12px;background:#f0f4f8;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:12px;">📄 Seleccionar PDF
                    <input type="file" id="no_mm_facturaFile" accept=".pdf" style="display:none"
                      onchange="no_mm_onFacturaChange(this)">
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div style="padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;">
            <button class="btn btn-grey" onclick="no_cerrarModalMaquina()">Cancelar</button>
            <button id="no_mm_btnAgregar" class="btn btn-dark" onclick="no_confirmarAgregarMaquina()" disabled>Agregar a la orden</button>
          </div>
        </div>
      </div>

      <!-- STEP 3: CONFIRMAR -->
      <div id="no_step3" style="display:none;">
        <div class="card">
          <h2 style="font-size:16px;color:var(--dark);margin-bottom:12px;">Confirmar orden</h2>
          <div id="no_resumenOrden"></div>
          <div id="no_step3Error" class="no-alert-err" style="display:none;margin-top:12px;"></div>
        </div>
        <div class="no-nav-row">
          <button class="btn btn-grey" onclick="no_goStep2()">← Atrás</button>
          <button class="btn btn-green" id="no_btnCrear" onclick="no_crearOrden()">✓ Crear Orden</button>
        </div>
      </div>

      <!-- ÉXITO -->
      <div id="no_stepSuccess" style="display:none;">
        <div class="card no-success">
          <div style="font-size:40px;">✅</div>
          <div class="no-snum" id="no_successConsecutivo"></div>
          <div class="no-slbl">Orden creada exitosamente</div>
          <div class="no-slist" id="no_successMaqList"></div>
          <div id="no_ordenAcciones"></div>
          <hr class="no-divider">
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-dark" onclick="navigate('cotizaciones')">Ir a Cotizaciones</button>
            <button class="btn btn-grey" onclick="no_nuevaOrden()">Nueva Orden</button>
          </div>
        </div>
      </div>
    </div>`;
  },
  init() {
    // Revoke any blob URLs from a previous session
    if (typeof window.no_nuevaOrden === 'function') window.no_nuevaOrden();

    let no_cliente       = null;
    let no_maquinas      = [];
    let no_ordenCreada   = null;
    let no_clientMap     = {};
    let no_herramientaMap= {};
    let no_buscarTimer   = null;

    function no_setStep(n) {
      ['no_step1','no_step2','no_step3','no_stepSuccess'].forEach((id,i) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (i === n-1 || (n===4 && i===3)) ? 'block' : 'none';
      });
      [1,2,3].forEach(i => {
        const t = document.getElementById(`no_step${i}_tab`);
        if (!t) return;
        t.className = 'no-step' + (i < n ? ' done' : i === n ? ' active' : '');
      });
    }

    window.no_goStep1 = () => no_setStep(1);

    window.no_goStep2 = async () => {
      if (!no_cliente) return;
      no_setStep(2);
      const c = no_cliente;
      const cc = document.getElementById('no_step2ClientCard');
      if (cc) cc.innerHTML = `
        <div class="no-cli-card" style="margin-bottom:16px;">
          <div>
            <div class="no-cli-name">${esc(c.cli_razon_social)}</div>
            <div class="no-cli-sub">NIT/CC: ${esc(c.cli_identificacion)} | Tel: ${esc(c.cli_telefono||'-')}</div>
          </div>
        </div>`;
      await no_cargarHistorial();
      no_renderMaquinasEnOrden();
    };

    window.no_goStep3 = () => {
      if (!no_maquinas.length) return;
      no_setStep(3);
      no_renderResumen();
    };

    window.no_buscarCliente = () => {
      clearTimeout(no_buscarTimer);
      no_buscarTimer = setTimeout(async () => {
        const q = document.getElementById('no_clientSearch')?.value.trim() || '';
        const resEl = document.getElementById('no_clientResults');
        if (!resEl) return;
        if (q.length < 2) { resEl.innerHTML = ''; return; }
        const data = await fetch(`${API}/crear-orden/cliente/buscar?q=${encodeURIComponent(q)}`)
          .then(r=>r.json()).catch(()=>[]);
        if (!data.length) { resEl.innerHTML = '<div class="no-muted">No se encontraron clientes.</div>'; return; }
        data.forEach(c => { no_clientMap[c.uid_cliente] = c; });
        resEl.innerHTML = data.map(c => `
          <div class="no-result-item" onclick="no_seleccionarCliente(${c.uid_cliente})">
            <div>
              <div class="no-result-name">${esc(c.cli_razon_social)}</div>
              <div class="no-result-sub">CC/NIT: ${esc(c.cli_identificacion)} | Tel: ${esc(c.cli_telefono||'-')}</div>
            </div>
            <button class="btn btn-dark btn-sm">Seleccionar</button>
          </div>`).join('');
      }, 300);
    };

    window.no_seleccionarCliente = (uid) => {
      const c = no_clientMap[uid];
      if (!c) return;
      no_cliente = c;
      const resEl   = document.getElementById('no_clientResults');
      const searchEl= document.getElementById('no_clientSearch');
      const formEl  = document.getElementById('no_newClientForm');
      const cardEl  = document.getElementById('no_selectedClientCard');
      const btnEl   = document.getElementById('no_btnStep1Next');
      if (resEl)    resEl.innerHTML = '';
      if (searchEl) searchEl.value = '';
      if (formEl)   formEl.style.display = 'none';
      if (cardEl) {
        cardEl.style.display = 'block';
        cardEl.innerHTML = `
          <div class="no-cli-card">
            <div>
              <div class="no-cli-name">${esc(c.cli_razon_social)}</div>
              <div class="no-cli-sub">CC/NIT: ${esc(c.cli_identificacion)} | Tel: ${esc(c.cli_telefono||'-')} | ${esc(c.cli_direccion||'')}</div>
            </div>
            <button class="btn btn-grey btn-sm" onclick="no_deseleccionarCliente()">Cambiar</button>
          </div>`;
      }
      if (btnEl) btnEl.disabled = false;
    };

    window.no_deseleccionarCliente = () => {
      no_cliente = null;
      const cardEl = document.getElementById('no_selectedClientCard');
      const btnEl  = document.getElementById('no_btnStep1Next');
      if (cardEl) { cardEl.style.display = 'none'; cardEl.innerHTML = ''; }
      if (btnEl)  btnEl.disabled = true;
    };

    window.no_toggleNewClient = () => {
      const f = document.getElementById('no_newClientForm');
      if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
    };

    window.no_sugerirClave = () => {
      const idEl = document.getElementById('no_nc_id');
      const clEl = document.getElementById('no_nc_clave');
      if (idEl && clEl && idEl.value.length >= 4) clEl.value = idEl.value.slice(-4);
    };

    window.no_crearCliente = async () => {
      const errEl = document.getElementById('no_newClientError');
      if (errEl) errEl.style.display = 'none';
      const body = {
        cli_identificacion: document.getElementById('no_nc_id')?.value.trim() || '',
        cli_razon_social:   document.getElementById('no_nc_nombre')?.value.trim() || '',
        cli_telefono:       document.getElementById('no_nc_tel')?.value.trim() || '',
        cli_direccion:      document.getElementById('no_nc_dir')?.value.trim() || '',
        cli_contacto:       document.getElementById('no_nc_contacto')?.value.trim() || '',
        cli_tel_contacto:   document.getElementById('no_nc_tel_contacto')?.value.trim() || '',
        clave:              document.getElementById('no_nc_clave')?.value.trim() || '',
      };
      const res = await fetch(`${API}/crear-orden/cliente`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      }).then(r=>r.json()).catch(()=>({success:false,error:'Error de red'}));
      if (!res.success) {
        if (errEl) { errEl.textContent = res.error||'Error'; errEl.style.display = 'block'; }
        return;
      }
      if (res.clave_acceso) alert(`✅ Cliente creado.\n\nClave de acceso al portal: ${res.clave_acceso}\n\nAnótela — no se volverá a mostrar.`);
      no_clientMap[res.cliente.uid_cliente] = res.cliente;
      window.no_seleccionarCliente(res.cliente.uid_cliente);
      const f = document.getElementById('no_newClientForm');
      if (f) f.style.display = 'none';
    };

    async function no_cargarHistorial() {
      // cargarHistorial solo carga el mapa, el modal lo usa al abrir
      const data = await fetch(`${API}/crear-orden/herramientas/${no_cliente.uid_cliente}`)
        .then(r=>r.json()).catch(()=>[]);
      data.forEach(h => { no_herramientaMap[h.uid_herramienta] = h; });
    }

    let _no_mmModoNueva = false;

    window.no_abrirModalMaquina = async () => {
      _no_mmModoNueva = false;
      document.getElementById('no_mm_select').innerHTML = '<option value="">-- Cargando... --</option>';
      document.getElementById('no_mm_obsRow').style.display = 'none';
      document.getElementById('no_mm_obs').value = '';
      document.getElementById('no_mm_nuevaForm').style.display = 'none';
      document.getElementById('no_mm_btnNueva').textContent = '+ Crear nueva máquina';
      document.getElementById('no_mm_error').style.display = 'none';
      document.getElementById('no_mm_nuevaObs').value = '';
      ['no_mm_nombre','no_mm_marca','no_mm_serial','no_mm_ref'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('no_mm_btnAgregar').disabled = true;
      // Reset guarantee fields
      document.getElementById('no_mm_chkGarantia').checked = false;
      document.getElementById('no_mm_garantiaFields').style.display = 'none';
      document.getElementById('no_mm_garantiaVence').value = '';
      document.getElementById('no_mm_facturaFile').value = '';
      document.getElementById('no_mm_facturaLabel').firstChild.textContent = '📄 Seleccionar PDF';
      document.getElementById('no_modalMaquina').style.display = 'flex';
      const data = await fetch(`${API}/crear-orden/herramientas/${no_cliente.uid_cliente}`)
        .then(r=>r.json()).catch(()=>[]);
      data.forEach(h => { no_herramientaMap[h.uid_herramienta] = h; });
      const sel = document.getElementById('no_mm_select');
      if (!data.length) {
        sel.innerHTML = '<option value="">-- Este cliente no tiene máquinas registradas --</option>';
      } else {
        sel.innerHTML = '<option value="">-- Seleccionar máquina --</option>' +
          data.map(h => {
            const ya = no_maquinas.find(m => m.uid_herramienta === h.uid_herramienta);
            return `<option value="${h.uid_herramienta}" ${ya?'disabled':''}>${esc(h.her_nombre)}${h.her_marca?' — '+esc(h.her_marca):''}${h.her_serial?' ('+esc(h.her_serial)+')':''}${ya?' ✓ ya en orden':''}</option>`;
          }).join('');
      }
    };

    window.no_cerrarModalMaquina = () => {
      document.getElementById('no_modalMaquina').style.display = 'none';
    };

    window.no_onSelectMaquinaModal = (sel) => {
      const obsRow = document.getElementById('no_mm_obsRow');
      const btn = document.getElementById('no_mm_btnAgregar');
      if (sel.value) {
        obsRow.style.display = 'block'; btn.disabled = false;
        if (_no_mmModoNueva) {
          _no_mmModoNueva = false;
          document.getElementById('no_mm_nuevaForm').style.display = 'none';
          document.getElementById('no_mm_btnNueva').textContent = '+ Crear nueva máquina';
        }
      } else {
        obsRow.style.display = 'none';
        btn.disabled = _no_mmModoNueva ? false : true;
      }
    };

    window.no_toggleNuevaMaqModal = () => {
      _no_mmModoNueva = !_no_mmModoNueva;
      document.getElementById('no_mm_nuevaForm').style.display = _no_mmModoNueva ? 'block' : 'none';
      document.getElementById('no_mm_btnNueva').textContent = _no_mmModoNueva ? '✕ Cancelar nueva máquina' : '+ Crear nueva máquina';
      // Ocultar/mostrar selector según modo
      document.getElementById('no_mm_selectRow').style.display = _no_mmModoNueva ? 'none' : 'block';
      document.getElementById('no_mm_separador').style.display = _no_mmModoNueva ? 'none' : 'block';
      if (_no_mmModoNueva) {
        document.getElementById('no_mm_select').value = '';
        document.getElementById('no_mm_obsRow').style.display = 'none';
        document.getElementById('no_mm_btnAgregar').disabled = false;
      } else {
        document.getElementById('no_mm_btnAgregar').disabled = !document.getElementById('no_mm_select').value;
      }
    };

    window.no_mm_toggleGarantia = (checked) => {
      document.getElementById('no_mm_garantiaFields').style.display = checked ? 'block' : 'none';
      if (checked) {
        const vence = addDiasHabiles(new Date(), 30);
        document.getElementById('no_mm_garantiaVence').value = toInputDate(vence);
      } else {
        document.getElementById('no_mm_garantiaVence').value = '';
      }
    };

    window.no_mm_onFacturaChange = (input) => {
      const lbl = document.getElementById('no_mm_facturaLabel');
      if (lbl) lbl.firstChild.textContent = input.files?.[0]?.name ? '✅ ' + input.files[0].name : '📄 Seleccionar PDF';
    };

    window.no_confirmarAgregarMaquina = async () => {
      const btn = document.getElementById('no_mm_btnAgregar');
      btn.disabled = true; btn.textContent = '⏳ Agregando...';
      try {
        // Leer campos de garantía (comunes para ambos modos)
        const esGarantia   = document.getElementById('no_mm_chkGarantia').checked;
        const garantiaVence = document.getElementById('no_mm_garantiaVence').value;
        const facturaFile  = document.getElementById('no_mm_facturaFile').files?.[0] || null;
        const errEl = document.getElementById('no_mm_error');

        if (esGarantia && !garantiaVence) {
          errEl.textContent = 'La fecha de vencimiento es obligatoria para máquinas en garantía';
          errEl.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
        }

        if (_no_mmModoNueva) {
          errEl.style.display = 'none';
          const body = {
            uid_cliente:    no_cliente.uid_cliente,
            her_nombre:     document.getElementById('no_mm_nombre').value.trim(),
            her_marca:      document.getElementById('no_mm_marca').value.trim(),
            her_serial:     document.getElementById('no_mm_serial').value.trim(),
            her_referencia: document.getElementById('no_mm_ref').value.trim(),
          };
          if (!body.her_nombre) {
            errEl.textContent = 'El nombre es obligatorio'; errEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
          }
          const res = await fetch(`${API}/crear-orden/herramienta`, {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
          }).then(r=>r.json()).catch(()=>({success:false,error:'Error de red'}));
          if (!res.success) {
            errEl.textContent = res.error||'Error'; errEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Agregar a la orden'; return;
          }
          const obs = document.getElementById('no_mm_nuevaObs').value.trim();
          no_maquinas.push({ ...res.herramienta, observaciones: obs, fotos: [],
            es_garantia: esGarantia, garantia_vence: garantiaVence, factura: facturaFile });
        } else {
          const uid = parseInt(document.getElementById('no_mm_select').value);
          const h = no_herramientaMap[uid];
          const obs = document.getElementById('no_mm_obs').value.trim();
          no_maquinas.push({ ...h, observaciones: obs, fotos: [],
            es_garantia: esGarantia, garantia_vence: garantiaVence, factura: facturaFile });
        }
        no_renderMaquinasEnOrden();
        no_cerrarModalMaquina();
      } catch(e) {
        document.getElementById('no_mm_error').textContent = e.message;
        document.getElementById('no_mm_error').style.display = 'block';
        btn.disabled = false; btn.textContent = 'Agregar a la orden';
      }
    };

    window.no_quitarMaquina = (uid) => {
      no_maquinas = no_maquinas.filter(m => m.uid_herramienta !== uid);
      no_renderMaquinasEnOrden();
    };

    window.no_setObservacion = (uid, val) => {
      const m = no_maquinas.find(m => m.uid_herramienta === uid);
      if (m) m.observaciones = val;
    };

    function no_renderMaquinasEnOrden() {
      const el  = document.getElementById('no_maquinasEnOrden');
      const btn = document.getElementById('no_btnStep2Next');
      if (btn) btn.disabled = no_maquinas.length === 0;
      if (!el) return;
      if (!no_maquinas.length) {
        el.innerHTML = '<div class="no-muted" style="margin-bottom:12px;">Ninguna máquina agregada aún.</div>';
        return;
      }
      el.innerHTML = no_maquinas.map((m,i) => `
        <div class="card no-maq-item">
          <div class="no-maq-hdr">
            <div>
              <div class="no-maq-title">${i+1}. ${esc(m.her_nombre)} ${esc(m.her_marca||'')}${m.es_garantia ? ' <span style="font-size:11px;font-weight:700;background:#c0392b;color:#fff;padding:1px 6px;border-radius:4px;vertical-align:middle;">GARANTÍA</span>' : ''}</div>
              <div class="no-maq-sub">${m.her_serial ? 'S/N: '+esc(m.her_serial) : 'Sin serial'}${m.her_referencia ? ' | Ref: '+esc(m.her_referencia) : ''}${m.es_garantia && m.garantia_vence ? ' | Vence: '+esc(m.garantia_vence) : ''}${m.es_garantia && m.factura ? ' | 📄 '+esc(m.factura.name) : ''}</div>
            </div>
            <button class="btn btn-red btn-sm" onclick="no_quitarMaquina(${m.uid_herramienta})">Quitar</button>
          </div>
          <div class="no-fgroup">
            <label>Observaciones de recepción</label>
            <textarea placeholder="Estado visible, accesorios entregados, falla reportada..."
              onchange="no_setObservacion(${m.uid_herramienta}, this.value)">${esc(m.observaciones||'')}</textarea>
          </div>
          <div class="no-fgroup" style="margin-top:8px;">
            <label>Fotos de recepción</label>
            <div class="no-foto-row" id="no_fotoPreview_${m.uid_herramienta}"></div>
            <label style="display:inline-block;margin-top:6px;padding:6px 12px;background:#f0f4f8;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:12px;">
              📷 Agregar fotos
              <input type="file" accept="image/*" multiple style="display:none;"
                onchange="no_agregarFotosPreview(${m.uid_herramienta}, this.files)">
            </label>
            <span class="no-muted" style="margin-left:8px;" id="no_fotoCount_${m.uid_herramienta}"></span>
          </div>
        </div>`).join('');
      no_maquinas.forEach(m => no_renderFotoPreviews(m.uid_herramienta));
    }

    window.no_agregarFotosPreview = (uid, files) => {
      const m = no_maquinas.find(m => m.uid_herramienta === uid);
      if (!m) return;
      Array.from(files).forEach(f => { m.fotos.push({ file: f, url: URL.createObjectURL(f) }); });
      no_renderFotoPreviews(uid);
    };

    window.no_quitarFotoPreview = (uid, idx) => {
      const m = no_maquinas.find(m => m.uid_herramienta === uid);
      if (!m) return;
      URL.revokeObjectURL(m.fotos[idx].url);
      m.fotos.splice(idx, 1);
      no_renderFotoPreviews(uid);
    };

    function no_renderFotoPreviews(uid) {
      const m         = no_maquinas.find(m => m.uid_herramienta === uid);
      const previewEl = document.getElementById('no_fotoPreview_' + uid);
      const countEl   = document.getElementById('no_fotoCount_'   + uid);
      if (!m || !previewEl) return;
      previewEl.innerHTML = m.fotos.map((f,i) => `
        <div class="no-foto-thumb">
          <img src="${f.url}" alt="foto">
          <button class="no-del" onclick="no_quitarFotoPreview(${uid},${i})" title="Quitar">×</button>
        </div>`).join('');
      if (countEl) countEl.textContent = m.fotos.length ? m.fotos.length + ' foto(s)' : '';
    }

    function no_renderResumen() {
      const c  = no_cliente;
      const el = document.getElementById('no_resumenOrden');
      if (!el) return;
      el.innerHTML = `
        <div class="no-cli-card" style="margin-bottom:16px;">
          <div>
            <div class="no-cli-name">${esc(c.cli_razon_social)}</div>
            <div class="no-cli-sub">CC/NIT: ${esc(c.cli_identificacion)} | Tel: ${esc(c.cli_telefono||'-')}</div>
          </div>
        </div>
        <h3 style="font-size:14px;color:#333;margin-bottom:10px;">Máquinas (${no_maquinas.length})</h3>
        ${no_maquinas.map((m,i) => `
          <div style="padding:8px 12px;border:1px solid #eee;border-radius:6px;margin-bottom:6px;">
            <div style="font-weight:600;font-size:13px;">${i+1}. ${esc(m.her_nombre)} ${esc(m.her_marca||'')}${m.es_garantia ? ' <span style="font-size:11px;font-weight:700;background:#c0392b;color:#fff;padding:1px 6px;border-radius:4px;">GARANTÍA</span>' : ''}</div>
            ${m.her_serial ? `<div class="no-muted">S/N: ${esc(m.her_serial)}</div>` : ''}
            ${m.es_garantia && m.garantia_vence ? `<div class="no-muted">Garantía vence: ${esc(m.garantia_vence)}${m.factura ? ' | 📄 '+esc(m.factura.name) : ''}</div>` : ''}
            ${m.observaciones ? `<div class="no-muted" style="margin-top:4px;">${esc(m.observaciones)}</div>` : ''}
            ${m.fotos.length ? `<div class="no-muted" style="margin-top:2px;">📷 ${m.fotos.length} foto(s) adjunta(s)</div>` : ''}
          </div>`).join('')}`;
    }

    window.no_crearOrden = async () => {
      const btn   = document.getElementById('no_btnCrear');
      const errEl = document.getElementById('no_step3Error');
      if (errEl) errEl.style.display = 'none';
      if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

      const res = await fetch(`${API}/crear-orden/orden`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          uid_cliente: no_cliente.uid_cliente,
          maquinas: no_maquinas.map(m => ({
            uid_herramienta: m.uid_herramienta,
            observaciones:   m.observaciones,
            es_garantia:     m.es_garantia || false,
            garantia_vence:  m.garantia_vence || null,
          })),
        }),
      }).then(r=>r.json()).catch(()=>({success:false,error:'Error de red'}));

      if (!res.success) {
        if (btn) { btn.disabled = false; btn.textContent = '✓ Crear Orden'; }
        if (errEl) { errEl.textContent = res.error||'Error al crear la orden'; errEl.style.display = 'block'; }
        return;
      }
      no_ordenCreada = res;

      // Subir fotos de recepción
      if (btn) btn.textContent = 'Subiendo fotos...';
      for (let i = 0; i < res.herramientas.length; i++) {
        const fotos = no_maquinas[i]?.fotos || [];
        for (const f of fotos) {
          const fd = new FormData();
          fd.append('foto', f.file);
          await fetch(`${API}/crear-orden/foto/${res.herramientas[i].uid_herramienta_orden}`, { method:'POST', body:fd });
        }
      }

      // Subir factura PDF por máquina (si se adjuntó)
      if (btn) btn.textContent = 'Subiendo facturas...';
      for (let i = 0; i < res.herramientas.length; i++) {
        const factura = no_maquinas[i]?.factura;
        if (factura) {
          const fd = new FormData();
          fd.append('factura', factura);
          await fetch(`${API}/crear-orden/factura-maquina/${res.herramientas[i].uid_herramienta_orden}`, { method:'POST', body:fd });
        }
      }

      if (btn) { btn.disabled = false; btn.textContent = '✓ Crear Orden'; }
      no_mostrarExito();
    };

    function no_mostrarExito() {
      no_setStep(4);
      const consEl    = document.getElementById('no_successConsecutivo');
      const listEl    = document.getElementById('no_successMaqList');
      const accionesEl= document.getElementById('no_ordenAcciones');
      if (consEl) consEl.textContent = `Orden #${no_ordenCreada.ord_consecutivo}`;
      if (listEl) listEl.innerHTML = no_maquinas.map((m,i) => `
        <div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">
          ${i+1}. ${esc(m.her_nombre)} ${esc(m.her_marca||'')}${m.her_serial ? ' / S/N: '+esc(m.her_serial) : ''}
        </div>`).join('');
      if (accionesEl) {
        const uid_orden = no_ordenCreada.uid_orden;
        accionesEl.innerHTML = `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
            <a href="${API}/orders/${uid_orden}/print/orden" target="_blank" class="btn btn-dark">
              🖨️ Imprimir orden
            </a>
            <button onclick="no_enviarOrdenWA(${uid_orden}, this)" class="btn btn-green">
              📱 Enviar por WhatsApp
            </button>
          </div>`;
      }
    }

    window.no_enviarOrdenWA = async (uid_orden, btn) => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const res = await fetch(`${API}/orders/${uid_orden}/send-pdf/orden`, { method:'POST' }).then(r=>r.json());
        if (res.success) {
          btn.textContent = res.waWarning ? '⚠️ Sin WA' : '✓ Enviado';
          if (res.waWarning) {
            showToast('⚠️ ' + res.waWarning, 6000);
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 4000);
          }
        } else {
          btn.textContent = '✗ Error';
          setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
        }
      } catch {
        btn.textContent = '✗ Error';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
      }
    };

    window.no_nuevaOrden = () => {
      no_maquinas.forEach(m => m.fotos.forEach(f => URL.revokeObjectURL(f.url)));
      no_cliente     = null;
      no_maquinas    = [];
      no_ordenCreada = null;
      const searchEl = document.getElementById('no_clientSearch');
      const resEl    = document.getElementById('no_clientResults');
      const cardEl   = document.getElementById('no_selectedClientCard');
      const btnEl    = document.getElementById('no_btnStep1Next');
      if (searchEl) searchEl.value = '';
      if (resEl)    resEl.innerHTML = '';
      if (cardEl)   cardEl.style.display = 'none';
      if (btnEl)    btnEl.disabled = true;
      no_setStep(1);
    };

    no_setStep(1);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Detalle de orden para técnico (compartido por misOrdenes y buscarOrden)
// ════════════════════════════════════════════════════════════════════════════
const TEC_ELBL = {
  pendiente_revision:'Pendiente revisión', revisada:'Revisada', cotizada:'Cotizada',
  autorizada:'Autorizada', no_autorizada:'No autorizada', reparada:'Reparada', entregada:'Entregada'
};

async function tec_verDetalle(uid, rightId, panelId) {
  document.getElementById(panelId)?.classList.add('immersive');
  const right = document.getElementById(rightId);
  if (!right) return;
  const backHtml = `<div class="mobile-back" onclick="document.getElementById('${panelId}')?.classList.remove('immersive')">← Volver</div>`;
  right.innerHTML = backHtml + `<div style="padding:20px;color:#888;text-align:center;">Cargando...</div>`;

  let det;
  try {
    const res = await fetch(`${API}/orders/${uid}/detalle`);
    det = await res.json();
  } catch(e) {
    right.innerHTML = backHtml + `<div style="padding:20px;color:#e74c3c;">Error de red: ${esc(e.message)}</div>`;
    return;
  }

  // Verificar error o respuesta inesperada del servidor
  if (det.error || !det.orden) {
    right.innerHTML = backHtml + `<div style="padding:20px;color:#e74c3c;">${esc(det.error || 'Error al cargar la orden')}</div>`;
    return;
  }

  const { orden, maquinas } = det;

  // Auto-asignar técnico en máquinas sin asignación (fire & forget)
  for (const m of maquinas) {
    fetch(`${API}/equipment-order/${m.uid_herramienta_orden}/assign-technician`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ technicianId: _currentUser.id })
    }).catch(() => {});
  }

  const maqHtml = maquinas.map(m => {
    const lbl = TEC_ELBL[m.her_estado] || m.her_estado || '-';
    const bc  = 'badge b-' + (m.her_estado || 'pendiente_revision');
    const sub = [m.her_marca, m.her_serial ? 'S/N: '+m.her_serial : null, m.her_referencia ? 'Ref: '+m.her_referencia : null].filter(Boolean).join(' | ');

    const fotosRec = m.fotos?.length
      ? `<div class="foto-row">${m.fotos.map(f => `
          <div class="foto-thumb" onclick="window.open('/uploads/fotos-recepcion/${f.fho_archivo}','_blank')">
            <img src="/uploads/fotos-recepcion/${f.fho_archivo}" alt="">
          </div>`).join('')}</div>`
      : `<div class="sin-fotos">Sin fotos de recepción</div>`;

    const fotosTrab = (m.fotos_trabajo || []).map(f => `
      <div class="foto-thumb" id="tft-${f.uid_foto_herramienta_orden}">
        <img src="/uploads/fotos-recepcion/${f.fho_archivo}" onclick="window.open(this.src,'_blank')" alt="">
        <button class="del-btn" onclick="tec_delFoto(${f.uid_foto_herramienta_orden},event)">✕</button>
      </div>`).join('');

    return `
      <div class="maq-card">
        <div class="maq-top">
          <div>
            <div class="maq-nombre">${esc(m.her_nombre||'-')}</div>
            ${sub ? `<div class="maq-sub">${esc(sub)}</div>` : ''}
          </div>
          <span id="tec-badge-${m.uid_herramienta_orden}" class="${bc}">${lbl}</span>
        </div>
        <div class="maq-actions">
          ${m.her_estado === 'revisada'
            ? `<span class="badge b-revisada">✓ Revisada</span>`
            : ''}
          <button class="btn btn-sm btn-teal" onclick="ord_verInforme(${orden.uid_orden},${m.uid_herramienta_orden})">📋 Informe</button>
        </div>
        <div style="margin-top:8px;">
          <div class="maq-obs-lbl">Descripción del trabajo</div>
          <textarea id="tec-obs-${m.uid_herramienta_orden}" rows="3"
            style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:inherit;resize:vertical;margin-top:4px;"
            placeholder="Describe el trabajo realizado...">${esc(m.hor_observaciones||'')}</textarea>
          ${m.her_estado !== 'revisada'
            ? `<button class="btn btn-sm btn-mid" style="margin-top:4px;" id="tec-btn-${m.uid_herramienta_orden}"
                onclick="tec_guardarYRevisar(${m.uid_herramienta_orden})">💾 Guardar y marcar revisada</button>`
            : `<button class="btn btn-sm" style="margin-top:4px;background:#f0f4f8;color:#555;"
                onclick="tec_guardarObs(${m.uid_herramienta_orden})">💾 Guardar observaciones</button>`}
        </div>
        <div class="fotos-seccion">
          <div class="fotos-lbl">Recepción</div>${fotosRec}
        </div>
        <div class="fotos-seccion">
          <div class="fotos-lbl fotos-trabajo-lbl">Del trabajo</div>
          <div class="foto-row" id="tft-row-${m.uid_herramienta_orden}">${fotosTrab}</div>
          <label class="upload-foto-btn">+ Agregar fotos
            <input type="file" accept="image/*" multiple style="display:none"
              onchange="tec_uploadFoto(${orden.uid_orden},${m.uid_herramienta_orden},this)">
          </label>
        </div>
      </div>`;
  }).join('');

  right.innerHTML = backHtml + `
    <div style="padding:22px;">
      <div class="ord-detail-header">
        <span class="ord-num">Orden #${orden.ord_consecutivo}</span>
        <span class="ord-fecha">${fmtFecha(orden.ord_fecha)}</span>
      </div>
      <div class="card">
        <div class="card-title">Cliente</div>
        <div class="client-grid">
          <div class="field"><span class="lbl">Nombre / Razón social</span><span class="val">${esc(orden.cli_razon_social||'-')}</span></div>
          <div class="field"><span class="lbl">Teléfono</span><span class="val">${esc(orden.cli_telefono||'-')}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Equipos (${maquinas.length})</div>
        ${maqHtml}
      </div>
    </div>`;
}

window.tec_guardarYRevisar = async (uid) => {
  const btn = document.getElementById(`tec-btn-${uid}`);
  const obs = document.getElementById(`tec-obs-${uid}`)?.value || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando...'; }
  try {
    // 1. Guardar observaciones
    const r1 = await fetch(`${API}/equipment-order/${uid}/observaciones`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({observaciones:obs})
    }).then(r=>r.json());
    if (!r1.success) throw new Error(r1.error||'Error guardando observaciones');
    // 2. Cambiar estado a revisada
    const r2 = await fetch(`${API}/equipment-order/${uid}/status`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status:'revisada'})
    }).then(r=>r.json());
    if (!r2.success) throw new Error(r2.error||'Error actualizando estado');
    // Actualizar badge de estado
    const badge = document.getElementById(`tec-badge-${uid}`);
    if (badge) { badge.className = 'badge b-revisada'; badge.textContent = 'Revisada'; }
    // Reemplazar botón
    if (btn) btn.outerHTML = `<button class="btn btn-sm" style="margin-top:4px;background:#f0f4f8;color:#555;"
      onclick="tec_guardarObs(${uid})">💾 Guardar observaciones</button>`;
    showToast('✅ Guardado — máquina marcada como revisada');
  } catch(e) {
    alert('⚠️ ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar y marcar revisada'; }
  }
};

window.tec_guardarObs = async (uid) => {
  const obs = document.getElementById(`tec-obs-${uid}`)?.value || '';
  const r = await fetch(`${API}/equipment-order/${uid}/observaciones`, {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({observaciones:obs})
  }).then(r=>r.json()).catch(()=>({success:false}));
  if (r.success) showToast('✅ Observaciones guardadas');
  else alert('Error al guardar: ' + (r.error||''));
};

window.tec_uploadFoto = async (uidOrden, uidHo, input) => {
  const files = Array.from(input.files);
  if (!files.length) return;
  input.value = '';
  const row = document.getElementById(`tft-row-${uidHo}`);
  for (const file of files) {
    try {
      const fd = new FormData(); fd.append('foto', file);
      const d = await fetch(`${API}/orders/${uidOrden}/fotos-trabajo/${uidHo}`, {method:'POST',body:fd}).then(r=>r.json());
      if (d.success) {
        const div = document.createElement('div');
        div.className = 'foto-thumb'; div.id = `tft-${d.uid_foto}`;
        div.innerHTML = `<img src="${d.url}" onclick="window.open(this.src,'_blank')" alt=""><button class="del-btn" onclick="tec_delFoto(${d.uid_foto},event)">✕</button>`;
        row?.appendChild(div);
      } else showToast('⚠️ Error al subir foto: '+(d.error||''));
    } catch(e) { showToast('⚠️ ' + e.message); }
  }
};

window.tec_delFoto = async (uid, e) => {
  e?.stopPropagation();
  if (!confirm('¿Eliminar esta foto?')) return;
  const r = await fetch(`${API}/orders/fotos-trabajo/${uid}`, {method:'DELETE'}).then(r=>r.json()).catch(()=>({success:false}));
  if (r.success) document.getElementById(`tft-${uid}`)?.remove();
  else alert('Error al eliminar foto');
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: MIS ÓRDENES (técnico)
// ════════════════════════════════════════════════════════════════════════════
Views.misOrdenes = {
  render() {
    return `
      <div class="two-panel" id="misPanel">
        <div class="pnl-left">
          <div class="search-box">
            <h2>Mis órdenes asignadas</h2>
            <div style="margin-top:8px;">
              <button class="btn btn-dark" style="width:100%;padding:8px;" onclick="mis_load()">🔄 Actualizar</button>
            </div>
          </div>
          <div class="results-list" id="misResults">
            <div class="results-empty">Cargando...</div>
          </div>
        </div>
        <div class="pnl-right" id="misRight">
          <div class="mobile-back" onclick="mis_back()">← Volver a mis órdenes</div>
          <div class="empty-state">
            <div class="es-icon">🔧</div>
            <p>Selecciona una orden para ver el detalle</p>
          </div>
        </div>
      </div>`;
  },
  async init() {
    window.mis_back = () => { document.getElementById('misPanel')?.classList.remove('immersive'); };
    window.mis_verDetalle = (uid) => tec_verDetalle(uid, 'misRight', 'misPanel');
    window.mis_load = async () => {
      const rl = document.getElementById('misResults');
      if (!rl) return;
      rl.innerHTML = '<div class="results-empty">Cargando...</div>';
      const data = await fetch(`${API}/orders/mis-ordenes-tecnico`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) {
        rl.innerHTML = '<div class="results-empty">No tienes órdenes asignadas</div>';
        return;
      }
      rl.innerHTML = data.map(o => `
        <div class="result-card" onclick="mis_verDetalle(${o.uid_orden})">
          <div class="rc-top">
            <span class="rc-num">Orden #${o.ord_consecutivo}</span>
            <span class="rc-fecha">${fmtFecha(o.ord_fecha)}</span>
          </div>
          ${o.ord_tipo==='garantia' ? ord_garantiaBadges(o) : ''}
          <div class="rc-cliente">${esc(o.cli_razon_social||'')}</div>
          <div class="rc-maq">${esc(o.maquinas_resumen||'')}</div>
        </div>`).join('');
    };
    await window.mis_load();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: BUSCAR ORDEN (técnico)
// ════════════════════════════════════════════════════════════════════════════
Views.buscarOrden = {
  _timer: null,
  render() {
    return `
      <div class="two-panel" id="busPanel">
        <div class="pnl-left">
          <div class="search-box">
            <h2>Buscar orden</h2>
            <div class="input-row">
              <input id="busSearch" type="text" placeholder="Número o nombre del cliente"
                     oninput="bus_debounce()">
              <button onclick="bus_buscar()">🔍</button>
            </div>
          </div>
          <div class="results-list" id="busResults">
            <div class="results-empty">Escribe para buscar</div>
          </div>
        </div>
        <div class="pnl-right" id="busRight">
          <div class="mobile-back" onclick="bus_back()">← Volver a resultados</div>
          <div class="empty-state">
            <div class="es-icon">🔍</div>
            <p>Busca y selecciona una orden</p>
          </div>
        </div>
      </div>`;
  },
  init() {
    window.bus_back = () => { document.getElementById('busPanel')?.classList.remove('immersive'); };
    window.bus_debounce = () => {
      clearTimeout(Views.buscarOrden._timer);
      Views.buscarOrden._timer = setTimeout(bus_buscar, 350);
    };
    window.bus_buscar = async () => {
      const q = document.getElementById('busSearch')?.value.trim();
      if (!q) return;
      const rl = document.getElementById('busResults');
      if (!rl) return;
      rl.innerHTML = '<div class="results-empty">Buscando...</div>';
      const data = await fetch(`${API}/orders/search?q=${encodeURIComponent(q)}`).then(r=>r.json()).catch(()=>[]);
      if (!data.length) { rl.innerHTML='<div class="results-empty">Sin resultados</div>'; return; }
      rl.innerHTML = data.map(o => `
        <div class="result-card" onclick="bus_verDetalle(${o.uid_orden})">
          <div class="rc-top">
            <span class="rc-num">Orden #${o.ord_consecutivo}</span>
            <span class="rc-fecha">${fmtFecha(o.ord_fecha)}</span>
          </div>
          ${o.ord_tipo==='garantia' ? ord_garantiaBadges(o) : ''}
          <div class="rc-cliente">${esc(o.cli_razon_social||'')}</div>
          <div class="rc-maq">${esc(o.maquinas_resumen||(o.maquinas?o.maquinas+' máquina(s)':''))}</div>
        </div>`).join('');
    };
    window.bus_verDetalle = (uid) => tec_verDetalle(uid, 'busRight', 'busPanel');
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VISTA: VENTAS (POS)
// ════════════════════════════════════════════════════════════════════════════
Views.ventas = {
  render() {
    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return `
      <div class="two-panel" id="venPanel">
        <div class="pnl-left">
          <div class="search-box">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <h2>Ventas</h2>
              <button class="btn btn-dark" onclick="ven_openCreate()">+ Nueva</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
              <div>
                <label style="font-size:11px;color:#888;display:block;margin-bottom:2px;">Mes</label>
                <input type="month" id="venMes" value="${mes}"
                       style="padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;"
                       onchange="ven_reload()">
              </div>
              <div>
                <label style="font-size:11px;color:#888;display:block;margin-bottom:2px;">Estado</label>
                <select id="venEstado"
                        style="padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;"
                        onchange="ven_reload()">
                  <option value="">Todos</option>
                  <option value="borrador">Borrador</option>
                  <option value="pagada">Pagada</option>
                  <option value="anulada">Anulada</option>
                </select>
              </div>
            </div>
          </div>
          <div id="venCajaDia" style="margin:10px 0 4px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;font-size:12px;">
            <div style="font-weight:600;color:#0369a1;margin-bottom:6px;">💰 Caja del día</div>
            <div style="color:#aaa;font-size:12px;">Cargando...</div>
          </div>
          <div class="results-list" id="venResults">
            <div class="results-empty">Cargando...</div>
          </div>
        </div>
        <div class="pnl-right" id="venRight">
          <div class="mobile-back" onclick="ven_back()">← Volver a ventas</div>
          <div class="empty-state">
            <div class="es-icon">🛒</div>
            <p>Selecciona una venta para ver el detalle</p>
          </div>
        </div>
      </div>`;
  },

  async init() {
    const VEN_ESTADO_COLORS = {
      borrador: { bg:'#fef9c3', color:'#854d0e' },
      pagada:   { bg:'#dcfce7', color:'#166534' },
      anulada:  { bg:'#fee2e2', color:'#991b1b' },
    };
    const VEN_METODOS = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', cheque:'Cheque', otro:'Otro' };

    window.ven_back = () => { document.getElementById('venPanel')?.classList.remove('immersive'); };

    window.ven_reload = async function() {
      const mes    = document.getElementById('venMes')?.value    || '';
      const estado = document.getElementById('venEstado')?.value || '';
      const params = new URLSearchParams();
      if (mes)    { params.set('fecha_desde', mes + '-01'); params.set('fecha_hasta', mes + '-31'); }
      if (estado) params.set('estado', estado);

      const rl = document.getElementById('venResults'); if (!rl) return;
      rl.innerHTML = '<div class="results-empty">Cargando...</div>';
      const rows = await fetch(`${API}/ventas?${params}`).then(r=>r.json()).catch(()=>[]);
      if (!rows.length) { rl.innerHTML = '<div class="results-empty">Sin ventas en el período</div>'; return; }

      rl.innerHTML = rows.map(v => {
        const est   = VEN_ESTADO_COLORS[v.ven_estado] || { bg:'#f3f4f6', color:'#374151' };
        const label = esc(v.cli_razon_social || v.cli_contacto || 'Mostrador');
        const orden = v.ord_consecutivo ? `<span style="color:#888;font-size:11px;"> · Orden #${v.ord_consecutivo}</span>` : '';
        return `<div class="result-card" onclick="ven_verDetalle(${v.uid_venta})">
          <div class="rc-top">
            <span class="rc-num">Venta #${v.ven_consecutivo}</span>
            <span class="rc-fecha">${fmtFecha(v.ven_fecha)}</span>
          </div>
          <div class="rc-cliente">${label}${orden}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
            <span style="font-weight:700;font-size:14px;">${money(v.ven_total)}</span>
            <span class="estado-pill" style="background:${est.bg};color:${est.color};">${v.ven_estado}</span>
          </div>
        </div>`;
      }).join('');
    };

    await window.ven_reload();

    // ── Caja del día ───────────────────────────────────────────────────────
    window.ven_loadCajaDia = async function() {
      const el = document.getElementById('venCajaDia'); if (!el) return;
      try {
        const d = await fetch(`${API}/ventas/caja-dia`).then(r => r.json());
        const METODOS = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', cheque:'Cheque', otro:'Otro' };
        const filas = (d.desglose || []).map(r =>
          `<div style="display:flex;justify-content:space-between;">
            <span style="color:#374151;">${METODOS[r.ven_metodo_pago] || r.ven_metodo_pago}</span>
            <span style="font-weight:600;">${money(Number(r.total))}</span>
          </div>`
        ).join('');
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-weight:600;color:#0369a1;">💰 Caja del día</span>
            <span style="font-size:11px;color:#888;">${d.cantidad} venta${d.cantidad !== 1 ? 's' : ''}</span>
          </div>
          ${filas || '<div style="color:#aaa;font-size:11px;">Sin ventas hoy</div>'}
          <div style="border-top:1px solid #bae6fd;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;">
            <span style="font-weight:600;color:#0369a1;">Total</span>
            <span style="font-weight:700;color:#0369a1;font-size:14px;">${money(d.total)}</span>
          </div>`;
      } catch (_) {
        const el2 = document.getElementById('venCajaDia');
        if (el2) el2.innerHTML = '<div style="color:#aaa;font-size:12px;">No se pudo cargar la caja.</div>';
      }
    };
    await window.ven_loadCajaDia();

    // ── Modal nueva venta ──────────────────────────────────────────────────
    let _venItems = [];
    let _venShowCosto = false;
    let _venOrdenId = null;
    let _venClienteId = null;

    function ven_calcItem(it) {
      const precio   = Number(it.vi_precio_unitario) || 0;
      const cantidad = Number(it.vi_cantidad)        || 1;
      const dscto    = Number(it.vi_descuento_pct)   || 0;
      const subtotal = precio * cantidad;
      const total    = subtotal * (1 - dscto / 100);
      const costo    = Number(it.vi_costo_unitario)  || 0;
      const margen   = precio > 0 ? ((precio - costo) / precio * 100) : null;
      return { ...it, _subtotal: total, _margen: margen };
    }

    function ven_renderItems() {
      const tbl = document.getElementById('venItemsTbl'); if (!tbl) return;

      // Save focus before DOM rebuild so typing isn't interrupted
      const active = document.activeElement;
      let focusRow = null, focusField = null, selStart = null, selEnd = null;
      if (active && tbl.contains(active) && active.dataset.venRow !== undefined) {
        focusRow   = active.dataset.venRow;
        focusField = active.dataset.venField;
        selStart   = active.selectionStart;
        selEnd     = active.selectionEnd;
      }

      const showC = _venShowCosto;
      const colHeader = showC
        ? `<th style="padding:4px 5px;width:78px;text-align:right;">Costo</th><th style="padding:4px 4px;width:54px;text-align:center;">Margen</th>`
        : '';
      tbl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f0f4f8;">
          <th style="padding:4px 5px;text-align:left;">Descripción</th>
          <th style="padding:4px 4px;width:72px;">Tipo</th>
          <th style="padding:4px 3px;width:42px;text-align:center;">Cant</th>
          <th style="padding:4px 5px;width:80px;text-align:right;">Precio</th>
          ${colHeader}
          <th style="padding:4px 3px;width:46px;text-align:center;">Dscto%</th>
          <th style="padding:4px 5px;width:78px;text-align:right;">Total</th>
          <th style="width:20px;"></th>
        </tr></thead>
        <tbody>${_venItems.map((it, i) => {
          const calc = ven_calcItem(it);
          const costoCol = showC ? `
            <td><input type="number" min="0" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px;font-size:12px;text-align:right;" value="${it.vi_costo_unitario||0}" data-ven-row="${i}" data-ven-field="vi_costo_unitario" oninput="ven_onItem(${i},'vi_costo_unitario',this.value)"></td>
            <td style="text-align:center;padding-right:3px;color:${calc._margen!==null&&calc._margen>=40?'#166534':'#991b1b'};font-size:11px;font-weight:600;">${calc._margen !== null ? calc._margen.toFixed(1)+'%' : '—'}</td>
          ` : '';
          return `<tr style="border-top:1px solid #f0f0f0;">
            <td><input style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 5px;font-size:12px;" value="${esc(it.vi_descripcion||'')}" data-ven-row="${i}" data-ven-field="vi_descripcion" oninput="ven_onItem(${i},'vi_descripcion',this.value)" placeholder="Descripción..."></td>
            <td><select style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 2px;font-size:11px;" onchange="ven_onItem(${i},'vi_tipo',this.value)">
              <option value="repuesto" ${it.vi_tipo==='repuesto'?'selected':''}>Repuesto</option>
              <option value="mano_obra" ${it.vi_tipo==='mano_obra'?'selected':''}>M.Obra</option>
            </select></td>
            <td><input type="number" min="1" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px;font-size:12px;text-align:center;" value="${it.vi_cantidad||1}" data-ven-row="${i}" data-ven-field="vi_cantidad" oninput="ven_onItem(${i},'vi_cantidad',this.value)"></td>
            <td><input type="number" min="0" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px;font-size:12px;text-align:right;" value="${it.vi_precio_unitario||0}" data-ven-row="${i}" data-ven-field="vi_precio_unitario" oninput="ven_onItem(${i},'vi_precio_unitario',this.value)"></td>
            ${costoCol}
            <td><input type="number" min="0" max="100" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px;font-size:12px;text-align:center;" value="${it.vi_descuento_pct||0}" data-ven-row="${i}" data-ven-field="vi_descuento_pct" oninput="ven_onItem(${i},'vi_descuento_pct',this.value)"></td>
            <td style="text-align:right;padding-right:4px;font-weight:600;white-space:nowrap;">${money(calc._subtotal)}</td>
            <td><button type="button" onclick="ven_removeItem(${i})" style="background:none;border:none;cursor:pointer;color:#e53e3e;font-size:14px;padding:0 2px;">✕</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;

      // Restore focus to the same input after rebuild
      if (focusRow !== null) {
        const el = tbl.querySelector(`[data-ven-row="${focusRow}"][data-ven-field="${focusField}"]`);
        if (el) {
          el.focus();
          if (selStart !== null && el.setSelectionRange) {
            try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
          }
        }
      }

      ven_recalcTotales();
    }

    function ven_recalcTotales() {
      let subtotal = 0, descuento = 0, total = 0;
      _venItems.forEach(it => {
        const c = ven_calcItem(it);
        const base = (Number(it.vi_precio_unitario)||0) * (Number(it.vi_cantidad)||1);
        subtotal  += base;
        descuento += base * ((Number(it.vi_descuento_pct)||0) / 100);
        total     += c._subtotal;
      });
      const el = document.getElementById('venTotales'); if (!el) return;
      el.innerHTML = `
        <div style="display:flex;justify-content:flex-end;gap:24px;font-size:13px;margin-top:10px;">
          <div style="text-align:right;">
            ${descuento > 0 ? `<div style="color:#888;">Subtotal: ${money(subtotal)}</div><div style="color:#991b1b;">Descuento: −${money(descuento)}</div>` : ''}
            <div style="font-size:16px;font-weight:700;color:#1d3557;border-top:2px solid #1d3557;padding-top:4px;margin-top:4px;">
              TOTAL: ${money(total)}
            </div>
          </div>
        </div>`;
    }

    window.ven_addItem = function() {
      _venItems.push({ vi_descripcion:'', vi_tipo:'repuesto', vi_cantidad:1,
                       vi_precio_unitario:0, vi_costo_unitario:0, vi_descuento_pct:0 });
      ven_renderItems();
    };
    let _venCatalog = [];
    window.ven_catBuscar = function() {
      const q  = (document.getElementById('venCatInput')?.value || '').toLowerCase().trim();
      const dd = document.getElementById('venCatDrop'); if (!dd) return;
      if (!q) { dd.style.display = 'none'; return; }
      const hits = _venCatalog.filter(p =>
        (p.cco_descripcion || '').toLowerCase().includes(q) ||
        String(p.uid_concepto_costo).includes(q)
      ).slice(0, 10);
      if (!hits.length) { dd.style.display = 'none'; return; }
      dd.style.display = '';
      dd.innerHTML = hits.map(p => `
        <div onclick="ven_catSeleccionar(${p.uid_concepto_costo})"
             style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f0f4f8;font-size:12px;"
             onmouseenter="this.style.background='#f0f4f8'" onmouseleave="this.style.background=''">
          <div style="font-weight:500">${esc(p.cco_descripcion)}</div>
          <div style="color:#888;font-size:11px;">Cód. ${p.uid_concepto_costo} · ${money(Number(p.cco_valor)||0)}</div>
        </div>`).join('');
    };
    window.ven_catSeleccionar = function(id) {
      const p = _venCatalog.find(x => x.uid_concepto_costo === id); if (!p) return;
      _venItems.push({
        vi_descripcion:     p.cco_descripcion || '',
        vi_tipo:            p.cco_tipo === 'M' ? 'mano_obra' : 'repuesto',
        vi_cantidad:        1,
        vi_precio_unitario: Number(p.cco_valor) || 0,
        vi_costo_unitario:  p.cco_tipo === 'M' ? 0 : (Number(p.cco_costo) || 0),
        vi_descuento_pct:   0,
      });
      const inp = document.getElementById('venCatInput'); if (inp) inp.value = '';
      const dd  = document.getElementById('venCatDrop');  if (dd)  dd.style.display = 'none';
      ven_renderItems();
    };
    window.ven_removeItem = function(i) { _venItems.splice(i,1); ven_renderItems(); };
    window.ven_onItem = function(i, field, val) {
      if (!_venItems[i]) return;
      _venItems[i][field] = ['vi_descripcion','vi_tipo'].includes(field) ? val : (Number(val)||0);

      // Texto y tipo: no afectan columnas calculadas — solo recalcular totales
      if (field === 'vi_descripcion' || field === 'vi_tipo') { ven_recalcTotales(); return; }

      // Campos numéricos: actualizar SOLO las celdas Total y Margen de la fila en-place.
      // No reconstruir el DOM — type="number" no soporta setSelectionRange y pierde el cursor.
      const calc = ven_calcItem(_venItems[i]);
      const tbl  = document.getElementById('venItemsTbl');
      if (tbl) {
        const row = tbl.querySelector(`[data-ven-row="${i}"]`)?.closest('tr');
        if (row) {
          const cells = row.cells;
          // Total: siempre en la penúltima celda (antes del botón ✕)
          const totalCell = cells[cells.length - 2];
          if (totalCell) {
            totalCell.textContent = money(calc._subtotal);
            totalCell.style.cssText = 'text-align:right;padding-right:4px;font-weight:600;white-space:nowrap;';
          }
          // Margen: índice 5 cuando la columna costo está visible
          if (_venShowCosto && cells[5]) {
            const m = calc._margen;
            cells[5].textContent = m !== null ? m.toFixed(1) + '%' : '—';
            cells[5].style.color = m !== null && m >= 40 ? '#166534' : '#991b1b';
          }
        }
      }
      ven_recalcTotales();
    };
    window.ven_toggleCostos = function() {
      _venShowCosto = document.getElementById('venChkCostos')?.checked || false;
      ven_renderItems();
    };

    window.ven_openCreate = function() {
      document.getElementById('venCreateModal')?.remove();
      _venItems = [{ vi_descripcion:'', vi_tipo:'repuesto', vi_cantidad:1,
                     vi_precio_unitario:0, vi_costo_unitario:0, vi_descuento_pct:0 }];
      _venShowCosto = false;
      _venOrdenId = null;
      _venClienteId = null;
      const today = new Date().toISOString().slice(0,10);
      const bg = document.createElement('div');
      bg.className = 'modal-bg'; bg.id = 'venCreateModal';
      bg.innerHTML = `<div class="modal" style="max-width:720px;width:96%;max-height:92vh;overflow-y:auto;">
        <h3>Nueva Venta</h3>

        <!-- Cargar ítems desde orden existente -->
        <div style="margin-bottom:14px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">📦 Cargar desde orden <span style="font-weight:400;color:#888;">(opcional)</span></div>
          <div style="position:relative;">
            <input type="text" id="venOrdBuscar" autocomplete="off"
              placeholder="Número de orden o nombre del cliente..."
              style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;"
              oninput="ven_buscarOrden(this.value)">
            <div id="venOrdResultados" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:1000;max-height:180px;overflow-y:auto;margin-top:2px;"></div>
          </div>
          <div id="venOrdSelMsg" style="font-size:12px;margin-top:6px;display:none;"></div>
        </div>

        <!-- Cliente (opcional) -->
        <div style="margin-bottom:14px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">👤 Cliente <span style="font-weight:400;color:#888;">(opcional)</span></div>
          <div style="position:relative;">
            <input type="text" id="venCliBuscar" autocomplete="off"
              placeholder="Cédula, NIT o nombre del cliente..."
              style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;"
              oninput="ven_buscarCliente(this.value)">
            <div id="venCliResultados" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:1000;max-height:180px;overflow-y:auto;margin-top:2px;"></div>
          </div>
          <div id="venCliSelMsg" style="font-size:12px;margin-top:6px;display:none;"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div>
            <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Fecha <span style="color:#e53e3e">*</span></label>
            <input type="date" id="venFecha" value="${today}" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          </div>
          <div>
            <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Método de pago</label>
            <select id="venMetodo" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#555;">
            <input type="checkbox" id="venChkCostos" onchange="ven_toggleCostos()" style="width:14px;height:14px;accent-color:#1d3557;">
            Mostrar columna de costo (para análisis de margen)
          </label>
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:600;color:#1d3557;">ÍTEMS DEL SERVICIO</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <div style="position:relative;">
                <input type="text" id="venCatInput" placeholder="Buscar en catálogo..." autocomplete="off"
                  oninput="ven_catBuscar()"
                  style="font-size:12px;padding:5px 9px;border:1px solid #c7d2dd;border-radius:6px;width:200px;">
                <div id="venCatDrop" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:1000;max-height:200px;overflow-y:auto;margin-top:2px;min-width:240px;"></div>
              </div>
              <button type="button" class="btn btn-sm btn-mid" onclick="ven_addItem()">+ Manual</button>
            </div>
          </div>
          <div id="venItemsTbl"></div>
          <div id="venTotales"></div>
        </div>

        <div>
          <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Notas</label>
          <textarea id="venNotas" rows="2" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;" placeholder="Observaciones opcionales..."></textarea>
        </div>

        <div id="venCreateErr" style="display:none;margin-top:8px;padding:8px 10px;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:13px;"></div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button class="btn btn-grey" onclick="document.getElementById('venCreateModal')?.remove()">Cancelar</button>
          <button class="btn btn-dark" onclick="ven_guardar()">Crear Venta</button>
        </div>
      </div>`;
      document.body.appendChild(bg);
      bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
      ven_renderItems();
      fetch(`${API}/inventario`).then(r=>r.json()).then(items => {
        _venCatalog = items.filter(p => p.cco_estado === 'A');
      }).catch(() => {});
    };

    window.ven_guardar = async function() {
      const fecha  = document.getElementById('venFecha')?.value;
      const metodo = document.getElementById('venMetodo')?.value || 'efectivo';
      const notas  = document.getElementById('venNotas')?.value?.trim() || null;
      const errEl  = document.getElementById('venCreateErr');

      if (!fecha) { errEl.textContent = 'La fecha es requerida.'; errEl.style.display='block'; return; }
      if (!_venItems.length) { errEl.textContent = 'Agrega al menos un ítem.'; errEl.style.display='block'; return; }
      const sinDesc = _venItems.find(i => !i.vi_descripcion?.trim());
      if (sinDesc) { errEl.textContent = 'Todos los ítems deben tener descripción.'; errEl.style.display='block'; return; }
      errEl.style.display = 'none';

      const body = {
        ven_fecha:       fecha,
        ven_metodo_pago: metodo,
        ven_notas:       notas,
        uid_orden:       _venOrdenId || undefined,
        uid_cliente:     _venClienteId || undefined,
        items:           _venItems,
      };
      const r = await fetch(`${API}/ventas`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
                        .then(r=>r.json()).catch(()=>({error:'Error de red'}));
      if (r.uid_venta) {
        document.getElementById('venCreateModal')?.remove();
        showToast(`✅ Venta #${r.ven_consecutivo} creada`);
        await ven_reload();
        ven_loadCajaDia();
        ven_verDetalle(r.uid_venta);
      } else {
        errEl.textContent = r.error || 'Error al crear la venta.';
        errEl.style.display = 'block';
      }
    };

    // ── Buscador de órdenes dentro del modal Nueva Venta ─────────────────
    let _venOrdTimer = null;
    window.ven_buscarOrden = function(q) {
      clearTimeout(_venOrdTimer);
      const rEl = document.getElementById('venOrdResultados');
      if (!rEl) return;
      if (!q || q.trim().length < 2) { rEl.style.display = 'none'; return; }
      _venOrdTimer = setTimeout(async () => {
        rEl.style.display = '';
        rEl.innerHTML = '<div style="padding:8px 12px;color:#aaa;font-size:13px;">Buscando...</div>';
        try {
          const rows = await fetch(`${API}/orders/search?q=${encodeURIComponent(q.trim())}&limit=8`)
            .then(r => r.json());
          const list = Array.isArray(rows) ? rows : [];
          if (!list.length) {
            rEl.innerHTML = '<div style="padding:8px 12px;color:#aaa;font-size:13px;">Sin resultados.</div>';
            return;
          }
          rEl.innerHTML = list.map(o => {
            const cl = esc(o.cli_razon_social || o.cli_contacto || '—');
            const fecha = fmtFecha(o.ord_fecha);
            return `<div style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f4f8;font-size:13px;"
                         onmouseover="this.style.background='#f0f4f8'" onmouseout="this.style.background=''"
                         onclick="ven_seleccionarOrden(${o.uid_orden},${o.ord_consecutivo},'${cl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
              <strong>#${o.ord_consecutivo}</strong> — ${cl}
              <span style="float:right;color:#aaa;font-size:11px;">${fecha}</span>
            </div>`;
          }).join('');
        } catch (_) {
          rEl.innerHTML = '<div style="padding:8px 12px;color:#aaa;font-size:13px;">Error buscando órdenes.</div>';
        }
      }, 300);
    };

    window.ven_seleccionarOrden = async function(uidOrden, consecutivo, cliente) {
      const rEl  = document.getElementById('venOrdResultados');
      const bEl  = document.getElementById('venOrdBuscar');
      const msgEl = document.getElementById('venOrdSelMsg');
      if (rEl)  rEl.style.display  = 'none';
      if (bEl)  bEl.value = `#${consecutivo} — ${cliente}`;
      if (msgEl) { msgEl.style.color = '#555'; msgEl.textContent = 'Cargando cotización...'; msgEl.style.display = ''; }

      try {
        const data = await fetch(`${API}/recibos/cotizacion-orden/${uidOrden}`).then(r => r.json());
        if (!data.hasCotizacion) {
          if (msgEl) { msgEl.style.color = '#991b1b'; msgEl.textContent = `La orden #${consecutivo} no tiene cotización registrada.`; }
          return;
        }
        const items = [];
        for (const m of data.machines) {
          const label = [m.her_nombre, m.her_marca].filter(Boolean).join(' ');
          if (Number(m.mano_obra) > 0) {
            items.push({ vi_descripcion:`Mano de obra — ${label}`, vi_tipo:'mano_obra',
              vi_cantidad:1, vi_precio_unitario:Number(m.mano_obra), vi_costo_unitario:0, vi_descuento_pct:0 });
          }
          for (const it of data.items.filter(i => String(i.uid_herramienta_orden) === String(m.uid_herramienta_orden))) {
            items.push({ vi_descripcion:it.nombre, vi_tipo:'repuesto',
              vi_cantidad:Number(it.cantidad), vi_precio_unitario:Number(it.precio), vi_costo_unitario:0, vi_descuento_pct:0 });
          }
        }
        if (!items.length) {
          if (msgEl) { msgEl.style.color = '#991b1b'; msgEl.textContent = 'La cotización no tiene ítems cargables.'; }
          return;
        }
        _venItems = items;
        _venOrdenId = uidOrden;
        ven_renderItems();
        if (msgEl) {
          msgEl.style.color = '#166534';
          msgEl.textContent = `✅ ${items.length} ítem(s) cargados desde orden #${consecutivo}`;
        }
      } catch (_) {
        if (msgEl) { msgEl.style.color = '#991b1b'; msgEl.textContent = 'Error al cargar la cotización.'; }
      }
    };

    // ── Buscador de cliente dentro del modal Nueva Venta ─────────────────
    let _venCliTimer = null;
    window.ven_buscarCliente = function(q) {
      clearTimeout(_venCliTimer);
      const rEl = document.getElementById('venCliResultados');
      if (!rEl) return;
      if (!q || q.trim().length < 2) { rEl.style.display = 'none'; return; }
      _venCliTimer = setTimeout(async () => {
        rEl.style.display = '';
        rEl.innerHTML = '<div style="padding:8px 12px;color:#aaa;font-size:13px;">Buscando...</div>';
        try {
          const rows = await fetch(`${API}/clientes/search?q=${encodeURIComponent(q.trim())}&limit=8`)
            .then(r => r.json());
          const list = Array.isArray(rows) ? rows : [];
          if (!list.length) {
            rEl.innerHTML = '<div style="padding:8px 12px;color:#aaa;font-size:13px;">Sin resultados.</div>';
            return;
          }
          rEl.innerHTML = list.map(c => {
            const nombre = esc(c.cli_razon_social || c.cli_contacto || '—');
            const id = esc(c.cli_identificacion || '');
            return `<div style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f4f8;font-size:13px;"
                         onmouseover="this.style.background='#f0f4f8'" onmouseout="this.style.background=''"
                         onclick="ven_selCliente(${c.uid_cliente},'${nombre.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${id}')">
              <strong>${nombre}</strong>
              <span style="float:right;color:#aaa;font-size:11px;">${id}</span>
            </div>`;
          }).join('');
        } catch (_) {
          rEl.innerHTML = '<div style="padding:8px 12px;color:#aaa;font-size:13px;">Error buscando clientes.</div>';
        }
      }, 300);
    };

    window.ven_selCliente = function(uid, nombre, cedula) {
      const rEl  = document.getElementById('venCliResultados');
      const bEl  = document.getElementById('venCliBuscar');
      const msgEl = document.getElementById('venCliSelMsg');
      if (rEl)  rEl.style.display = 'none';
      if (bEl)  bEl.value = cedula ? `${nombre} (${cedula})` : nombre;
      _venClienteId = uid;
      if (msgEl) { msgEl.style.color = '#166534'; msgEl.textContent = `✅ Cliente: ${nombre}`; msgEl.style.display = ''; }
    };

    // ── Detalle venta ──────────────────────────────────────────────────────
    window.ven_verDetalle = async function(id) {
      const rp = document.getElementById('venRight'); if (!rp) return;
      document.getElementById('venPanel')?.classList.add('immersive');
      rp.innerHTML = `<div style="padding:20px;color:#aaa;">Cargando...</div>`;

      const venta = await fetch(`${API}/ventas/${id}`).then(r=>r.json()).catch(()=>null);
      if (!venta) { rp.innerHTML = `<div style="padding:20px;color:#e53e3e;">Error al cargar la venta.</div>`; return; }

      const est     = VEN_ESTADO_COLORS[venta.ven_estado] || { bg:'#f3f4f6', color:'#374151' };
      const cliente = esc(venta.cli_razon_social || venta.cli_contacto || 'Mostrador');
      const esBorr  = venta.ven_estado === 'borrador';
      const esAnul  = venta.ven_estado === 'anulada';

      // Panel financiero — solo admin
      let financieroHtml = '';
      if (isAdmin() && venta.financiero) {
        const f   = venta.financiero;
        const sug = venta.sugerencias || [];
        const pct = n => (Number(n)*100).toFixed(1) + '%';
        const rentColor = f.ven_es_rentable ? '#166534' : '#991b1b';
        const rentLabel = f.ven_es_rentable ? '✅ RENTABLE' : '❌ NO RENTABLE';
        financieroHtml = `
          <div class="card" style="margin-top:14px;border:2px solid ${f.ven_es_rentable?'#86efac':'#fca5a5'};">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="font-size:13px;font-weight:700;color:#1d3557;">📊 Análisis financiero</span>
              <span style="font-size:12px;font-weight:700;color:${rentColor};background:${f.ven_es_rentable?'#dcfce7':'#fee2e2'};padding:2px 10px;border-radius:12px;">${rentLabel}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
              <div><span style="color:#666;">Mano de obra:</span> <strong>${money(f.ven_mano_obra)}</strong></div>
              <div><span style="color:#666;">Costo repuestos:</span> <strong>${money(f.ven_costo_repuestos)}</strong></div>
              <div><span style="color:#666;">Utilidad repuestos:</span> <strong>${money(f.ven_utilidad_repuestos)}</strong></div>
              <div><span style="color:#666;">Margen repuestos:</span> <strong>${pct(f.ven_margen_repuestos)}</strong></div>
              <div><span style="color:#666;">Utilidad total:</span> <strong style="color:${rentColor};">${money(f.ven_utilidad_total)}</strong></div>
              <div><span style="color:#666;">Objetivo mínimo:</span> <strong>${money(f.ven_utilidad_objetivo)}</strong></div>
            </div>
            ${!f.ven_es_rentable && sug.length ? `
              <div style="margin-top:10px;padding:8px;background:#fef9c3;border-radius:6px;">
                <div style="font-size:11px;font-weight:700;color:#854d0e;margin-bottom:5px;">💡 Sugerencias para mejorar rentabilidad:</div>
                ${sug.map(s => `<div style="font-size:11px;color:#854d0e;padding:2px 0;">• ${esc(s)}</div>`).join('')}
              </div>` : ''}
          </div>`;
      }

      rp.innerHTML = `
        <div style="padding:16px 20px;">
          <div class="mobile-back" onclick="ven_back()">← Volver a ventas</div>

          <div class="card" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div>
                <div style="font-size:18px;font-weight:700;color:#1d3557;">Venta #${venta.ven_consecutivo}</div>
                <div style="font-size:13px;color:#666;margin-top:2px;">${fmtFecha(venta.ven_fecha)} · ${VEN_METODOS[venta.ven_metodo_pago] || venta.ven_metodo_pago}</div>
              </div>
              <span class="estado-pill" style="font-size:13px;background:${est.bg};color:${est.color};">${venta.ven_estado}</span>
            </div>
            ${venta.cli_razon_social || venta.cli_contacto ? `<div style="margin-top:8px;font-size:13px;"><span style="color:#888;">Cliente:</span> <strong>${cliente}</strong>${venta.cli_identificacion?`<span style="color:#aaa;font-size:11px;"> · CC/NIT ${esc(venta.cli_identificacion)}</span>`:''}</div>` : ''}
            ${venta.ord_consecutivo ? `<div style="font-size:12px;color:#888;margin-top:3px;">Orden #${venta.ord_consecutivo}</div>` : ''}
            ${venta.ven_notas ? `<div style="font-size:12px;color:#666;margin-top:6px;padding:6px 8px;background:#f8fafc;border-radius:5px;">📝 ${esc(venta.ven_notas)}</div>` : ''}

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <a href="${API}/ventas/${venta.uid_venta}/pdf" target="_blank" class="btn btn-sm btn-mid">📄 PDF</a>
              <a href="${API}/ventas/${venta.uid_venta}/print" target="_blank" class="btn btn-sm btn-mid">🖨️ Ticket</a>
              ${esBorr ? `<button class="btn btn-sm btn-dark" onclick="ven_pagar(${venta.uid_venta})">💳 Marcar pagada</button>` : ''}
              ${!esAnul ? `<button class="btn btn-sm btn-grey" onclick="ven_anular(${venta.uid_venta})">🚫 Anular</button>` : ''}
            </div>
          </div>

          <div class="card">
            <div style="font-size:12px;font-weight:600;color:#1d3557;margin-bottom:8px;">ÍTEMS</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead><tr style="background:#f0f4f8;">
                <th style="padding:5px 6px;text-align:left;">Descripción</th>
                <th style="padding:5px 4px;width:52px;text-align:center;">Tipo</th>
                <th style="padding:5px 3px;width:36px;text-align:center;">Cant</th>
                <th style="padding:5px 6px;width:80px;text-align:right;">Precio</th>
                <th style="padding:5px 6px;width:80px;text-align:right;">Total</th>
              </tr></thead>
              <tbody>
                ${(venta.items||[]).map((it,i) => `
                  <tr style="${i%2===1?'background:#fafafa;':''}border-top:1px solid #f0f0f0;">
                    <td style="padding:5px 6px;">${esc(it.vi_descripcion||'')}</td>
                    <td style="padding:5px 4px;text-align:center;color:#888;font-size:11px;">${it.vi_tipo==='mano_obra'?'M.Obra':'Repuesto'}</td>
                    <td style="padding:5px 3px;text-align:center;">${it.vi_cantidad}</td>
                    <td style="padding:5px 6px;text-align:right;">${money(it.vi_precio_unitario)}</td>
                    <td style="padding:5px 6px;text-align:right;font-weight:600;">${money(it.vi_total)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
            <div style="display:flex;justify-content:flex-end;margin-top:10px;padding-top:8px;border-top:2px solid #1d3557;">
              <div style="text-align:right;font-size:14px;">
                ${Number(venta.ven_descuento)>0 ? `<div style="color:#888;font-size:12px;">Subtotal: ${money(venta.ven_subtotal)}</div><div style="color:#991b1b;font-size:12px;">Descuento: −${money(venta.ven_descuento)}</div>` : ''}
                ${Number(venta.ven_iva)>0 ? `<div style="color:#888;font-size:12px;">IVA: ${money(venta.ven_iva)}</div>` : ''}
                <div style="font-size:16px;font-weight:700;color:#1d3557;">TOTAL: ${money(venta.ven_total)}</div>
              </div>
            </div>
          </div>

          ${financieroHtml}
        </div>`;
    };

    window.ven_pagar = async function(id) {
      if (!confirm('¿Marcar esta venta como pagada?')) return;
      const r = await fetch(`${API}/ventas/${id}/pagar`, { method:'PATCH' }).then(r=>r.json()).catch(()=>({error:'Error de red'}));
      if (r.ok) { showToast('✅ Venta marcada como pagada'); await ven_reload(); ven_verDetalle(id); }
      else alert('Error: ' + (r.error || 'No se pudo marcar como pagada'));
    };

    window.ven_anular = async function(id) {
      if (!confirm('¿Anular esta venta? Esta acción no se puede deshacer.')) return;
      const r = await fetch(`${API}/ventas/${id}/anular`, { method:'PATCH' }).then(r=>r.json()).catch(()=>({error:'Error de red'}));
      if (r.ok) { showToast('✅ Venta anulada'); await ven_reload(); ven_verDetalle(id); }
      else alert('Error: ' + (r.error || 'No se pudo anular'));
    };
  } // fin Views.ventas.init
}; // fin Views.ventas

// ════════════════════════════════════════════════════════════════════════════
// VISTA: FINANZAS (solo admin)
// ════════════════════════════════════════════════════════════════════════════
Views.finanzas = {
  _data: null,

  render() {
    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return `
      <div class="dash-wrap" id="finWrap" style="max-width:900px;margin:0 auto;">
        <div class="dash-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <h2>📊 Dashboard Financiero</h2>
          <input type="month" id="finMes" value="${mes}"
                 style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                 onchange="fin_load()">
        </div>

        <!-- KPI cards -->
        <div class="kpi-grid" id="finKpis" style="margin-bottom:14px;">
          <div class="kpi-card kc-grey" style="grid-column:1/-1;justify-content:center;min-height:70px;">
            <span style="color:#aaa;font-size:13px;">Cargando...</span>
          </div>
        </div>

        <!-- Barra de progreso hacia meta mensual -->
        <div class="card" id="finMetaCard" style="margin-bottom:14px;display:none;"></div>

        <!-- Gráfica utilidad diaria -->
        <div class="card" id="finChartCard" style="margin-bottom:14px;display:none;">
          <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:10px;">Utilidad diaria del mes</div>
          <div id="finChart"></div>
        </div>

        <!-- Desglose + Meta diaria inteligente -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;" id="finDesgloseRow">
          <div class="card" id="finDesgloseCard"></div>
          <div class="card" id="finMetaDiariaCard"></div>
        </div>

        <!-- Configuración financiera -->
        <div class="card" id="finConfigCard" style="margin-bottom:14px;"></div>

        <!-- Historial de configuraciones -->
        <div class="card" id="finHistCard"></div>
      </div>`;
  },

  async init() {
    const pct  = (n, d) => d > 0 ? ((Number(n)/Number(d))*100).toFixed(1)+'%' : '—';
    const fmtK = n => { const v = Math.round(Number(n||0)/1000); return (v>=0?'':'−')+'$'+Math.abs(v)+'K'; };

    window.fin_load = async function() {
      const mes    = document.getElementById('finMes')?.value || new Date().toISOString().slice(0,7);
      const kpiEl  = document.getElementById('finKpis'); if (!kpiEl) return;

      kpiEl.innerHTML = `<div class="kpi-card kc-grey" style="grid-column:1/-1;justify-content:center;min-height:70px;"><span style="color:#aaa;font-size:13px;">Cargando...</span></div>`;

      const [dashboard, cfg] = await Promise.all([
        fetch(`${API}/financiero/dashboard?mes=${mes}`).then(r=>r.json()).catch(()=>null),
        fetch(`${API}/financiero/config`).then(r=>r.json()).catch(()=>null),
      ]);

      Views.finanzas._data = { dashboard, cfg, mes };

      if (!dashboard) {
        kpiEl.innerHTML = `<div class="kpi-card kc-grey" style="grid-column:1/-1;"><span style="color:#aaa;">Error al cargar datos.</span></div>`;
        return;
      }

      // ── KPI cards ──────────────────────────────────────────────────────
      const rentPct = dashboard.total_ventas > 0
        ? Math.round(dashboard.ventas_rentables / dashboard.total_ventas * 100) : 0;
      const cumplPct = Math.min(100, Math.round((dashboard.cumplimiento_meta_pct || 0) * 100));

      kpiEl.innerHTML = `
        <div class="kpi-card kc-blue">
          <div class="kpi-icon">💰</div>
          <div class="kpi-val">${fmtK(dashboard.utilidad_acumulada)}</div>
          <div class="kpi-lbl">Utilidad acumulada</div>
        </div>
        <div class="kpi-card kc-green">
          <div class="kpi-icon">🎯</div>
          <div class="kpi-val">${cumplPct}%</div>
          <div class="kpi-lbl">Cumplimiento meta</div>
        </div>
        <div class="kpi-card kc-orange">
          <div class="kpi-icon">📋</div>
          <div class="kpi-val">${dashboard.total_ventas}</div>
          <div class="kpi-lbl">Ventas del mes</div>
        </div>
        <div class="kpi-card ${rentPct>=80?'kc-green':rentPct>=50?'kc-orange':'kc-grey'}">
          <div class="kpi-icon">✅</div>
          <div class="kpi-val">${rentPct}%</div>
          <div class="kpi-lbl">Ventas rentables</div>
        </div>`;

      // ── Barra progreso meta ─────────────────────────────────────────────
      const metaCard = document.getElementById('finMetaCard');
      if (metaCard) {
        const utilidad = Number(dashboard.utilidad_acumulada);
        const meta     = Number(dashboard.meta_total_mes);
        const faltante = Number(dashboard.faltante_para_meta);
        const proyec   = Number(dashboard.proyeccion_fin_mes);
        const barPct   = Math.min(100, meta > 0 ? (utilidad/meta)*100 : 0);
        const barColor = barPct >= 100 ? '#22c55e' : barPct >= 60 ? '#f59e0b' : '#ef4444';
        metaCard.style.display = '';
        metaCard.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;flex-wrap:wrap;gap:6px;">
            <span style="font-size:13px;font-weight:600;color:#1d3557;">Meta mensual: ${money(meta)}</span>
            <span style="font-size:12px;color:#666;">Día ${dashboard.dias_transcurridos}/${dashboard.dias_del_mes}</span>
          </div>
          <div style="height:18px;background:#f0f4f8;border-radius:9px;overflow:hidden;margin-bottom:8px;">
            <div style="height:100%;width:${barPct.toFixed(1)}%;background:${barColor};border-radius:9px;transition:width .6s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;flex-wrap:wrap;gap:6px;">
            <span>Acumulado: <strong style="color:${barColor}">${money(utilidad)}</strong> (${barPct.toFixed(1)}%)</span>
            ${faltante > 0
              ? `<span>Faltante: <strong style="color:#991b1b;">${money(faltante)}</strong></span>`
              : `<span style="color:#166534;font-weight:700;">✅ Meta alcanzada</span>`}
            <span>Proyección: <strong>${money(proyec)}</strong></span>
          </div>`;
      }

      fin_renderChart(dashboard);
      fin_renderDesglose(dashboard);
      await fin_renderMetaDiaria(dashboard, mes);
      fin_renderConfig(cfg);
      await fin_renderHistorial();
    };

    await fin_load();
  },
};

// ─── Finanzas — gráfica utilidad diaria (SVG) ────────────────────────────────
function fin_renderChart(dashboard) {
  const el   = document.getElementById('finChart');
  const card = document.getElementById('finChartCard');
  if (!el || !card) return;

  const dias = dashboard.utilidad_por_dia || [];
  if (dias.length === 0) {
    el.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px 0;">Sin ventas registradas este mes.</p>';
    card.style.display = '';
    return;
  }

  const values = dias.map(d => Number(d.utilidad));
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  const W = 600, H = 130, BOTTOM = 20, AREA = H - BOTTOM;
  const step = (W - 20) / Math.max(dias.length, 1);
  const barW = Math.max(4, Math.floor(step) - 2);

  let svg = '';
  dias.forEach((d, i) => {
    const v = Number(d.utilidad);
    const h = Math.max(2, Math.round((Math.abs(v) / maxAbs) * (AREA - 4)));
    const x = (10 + i * step).toFixed(1);
    const y = AREA - h;
    const c = v >= 0 ? '#22c55e' : '#ef4444';
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${c}" rx="2" opacity="0.85"><title>${d.dia}: ${money(v)}</title></rect>`;
    if (dias.length <= 15 || i % Math.ceil(dias.length / 10) === 0 || i === dias.length - 1) {
      const day = String(d.dia || '').slice(-2).replace(/^0/, '');
      svg += `<text x="${(Number(x) + barW / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="9" fill="#999">${day}</text>`;
    }
  });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  card.style.display = '';
}

// ─── Finanzas — desglose mensual ─────────────────────────────────────────────
function fin_renderDesglose(dashboard) {
  const el = document.getElementById('finDesgloseCard');
  if (!el) return;

  const utilMO    = Number(dashboard.utilidad_mano_obra   || 0);
  const utilRep   = Number(dashboard.utilidad_repuestos   || 0);
  const utilTotal = Number(dashboard.utilidad_acumulada   || 0);
  const ingrMO    = Number(dashboard.ventas_mano_obra_total  || 0);
  const ingrRep   = Number(dashboard.ventas_repuestos_total  || 0);
  const costoRep  = Number(dashboard.costo_repuestos_total   || 0);
  const pctMO     = Number(dashboard.pct_mo_sobre_utilidad   || 0);
  const pctRep    = Number(dashboard.pct_rep_sobre_utilidad  || 0);
  const margenRep = Number(dashboard.margen_repuestos || 0);

  const pct  = n => (n * 100).toFixed(1) + '%';
  const bar  = (w, color) =>
    `<div style="height:6px;border-radius:3px;background:#f0f4f8;margin-top:4px;">
       <div style="height:6px;border-radius:3px;background:${color};width:${Math.min(100,Math.max(0,w*100)).toFixed(1)}%;transition:width .4s;"></div>
     </div>`;

  const moColor  = '#1d4ed8';
  const repColor = '#059669';
  const negColor = '#dc2626';

  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:12px;">Desglose del mes</div>

    <!-- Mano de obra -->
    <div style="padding:10px;background:#eff6ff;border-radius:8px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:12px;font-weight:600;color:${moColor};">🔧 Mano de obra</span>
        <span style="font-size:15px;font-weight:700;color:${moColor};">${money(utilMO)}</span>
      </div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        Ingresos: ${money(ingrMO)} · Margen: 100%
      </div>
      ${bar(pctMO, moColor)}
      <div style="font-size:10px;color:#6b7280;margin-top:2px;text-align:right;">${pct(pctMO)} de la utilidad total</div>
    </div>

    <!-- Repuestos -->
    <div style="padding:10px;background:#f0fdf4;border-radius:8px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:12px;font-weight:600;color:${repColor};">📦 Repuestos</span>
        <span style="font-size:15px;font-weight:700;color:${utilRep>=0?repColor:negColor};">${money(utilRep)}</span>
      </div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        Ingresos: ${money(ingrRep)} · Costo: ${money(costoRep)} · Margen: ${pct(margenRep)}
      </div>
      ${bar(pctRep, repColor)}
      <div style="font-size:10px;color:#6b7280;margin-top:2px;text-align:right;">${pct(pctRep)} de la utilidad total</div>
    </div>

    <!-- Total -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:2px solid #1d3557;">
      <span style="font-size:12px;font-weight:700;color:#1d3557;">Utilidad neta acumulada</span>
      <span style="font-size:16px;font-weight:700;color:${utilTotal>=0?'#166534':negColor};">${money(utilTotal)}</span>
    </div>`;
}

// ─── Finanzas — meta diaria inteligente (promedio 30 días) ───────────────────
async function fin_renderMetaDiaria(dashboard, mes) {
  const el = document.getElementById('finMetaDiariaCard');
  if (!el) return;

  // Fetch mes anterior para calcular promedio histórico 30 días
  const [y, m] = mes.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMes  = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
  let prevData = null;
  try {
    const r = await fetch(`${API}/financiero/dashboard?mes=${prevMes}`);
    if (r.ok) prevData = await r.json();
  } catch (_) {}

  const allDays = [
    ...(prevData?.utilidad_por_dia || []),
    ...(dashboard.utilidad_por_dia || []),
  ].sort((a, b) => (a.dia||'').localeCompare(b.dia||''));

  const last30 = allDays.slice(-30);
  const promedioHist = last30.length
    ? Math.round(last30.reduce((s, d) => s + Number(d.utilidad), 0) / last30.length)
    : 0;

  const diasRestantes = Math.max(0, dashboard.dias_del_mes - dashboard.dias_transcurridos);
  const faltante      = Number(dashboard.faltante_para_meta || 0);
  const metaDiaria    = diasRestantes > 0 ? Math.round(faltante / diasRestantes) : 0;
  const alcanzable    = promedioHist >= metaDiaria;

  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:10px;">Meta diaria inteligente</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:#1d3557;">${money(metaDiaria)}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Necesario/día</div>
      </div>
      <div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:#374151;">${money(promedioHist)}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Promedio ${last30.length}d</div>
      </div>
    </div>
    <div style="font-size:12px;color:#666;margin-bottom:8px;">
      ${diasRestantes > 0
        ? `Quedan <strong>${diasRestantes} días</strong> · Faltante: <strong style="color:#991b1b;">${money(faltante)}</strong>`
        : '<strong>Mes finalizado.</strong>'}
    </div>
    <div style="padding:8px 10px;border-radius:6px;font-size:12px;
                background:${alcanzable?'#f0fdf4':'#fef2f2'};
                color:${alcanzable?'#166534':'#991b1b'};">
      ${alcanzable
        ? '✅ Meta alcanzable con el ritmo histórico'
        : `⚠️ Meta ${money(metaDiaria - promedioHist)} por encima del promedio histórico`}
    </div>`;
}

// ─── Finanzas — formulario configuración de costos ───────────────────────────
function fin_renderConfig(cfg) {
  const el = document.getElementById('finConfigCard');
  if (!el) return;
  const c   = cfg || {};
  const raw = (f, def = 0) => Number(c[f] ?? def);

  function cfRow(field, label, def = 0) {
    return `<div class="no-fgroup">
      <label style="font-size:11px;color:#555;">${label}</label>
      <input id="cfInput_${field}" type="number" step="1000" min="0"
        style="width:100%;font-size:12px;" value="${raw(field, def)}">
    </div>`;
  }

  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:12px;">
      ⚙️ Configuración financiera
      <span style="font-size:11px;font-weight:400;color:#888;margin-left:8px;">vigente desde ${c.cf_vigente_desde||'—'}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:8px;letter-spacing:.5px;">Costos Fijos / Mes</div>
        ${cfRow('cf_arriendo','Arriendo')}
        ${cfRow('cf_energia','Energía')}
        ${cfRow('cf_agua','Agua')}
        ${cfRow('cf_internet','Internet')}
        ${cfRow('cf_telefono','Teléfono')}
        ${cfRow('cf_mantenimiento','Mantenimiento')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:8px;letter-spacing:.5px;">Personal / Mes</div>
        ${cfRow('cf_salarios','Salarios')}
        ${cfRow('cf_seguridad_social','Seguridad social')}
        ${cfRow('cf_parafiscales','Parafiscales')}
        ${cfRow('cf_otros','Otros costos')}
        <div class="no-fgroup" style="margin-top:4px;">
          <label style="font-size:11px;color:#555;">Descripción otros</label>
          <input id="cfInput_cf_descripcion_otros" type="text" style="width:100%;font-size:12px;"
            value="${(c.cf_descripcion_otros||'').replace(/"/g,'&quot;')}"
            placeholder="Ej: publicidad, contabilidad...">
        </div>
      </div>
    </div>
    <div style="border-top:1px solid #e5e7eb;margin-top:14px;padding-top:14px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:8px;letter-spacing:.5px;">Objetivos de rentabilidad por venta</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        ${cfRow('cf_utilidad_objetivo_min','Utilidad mínima',60000)}
        ${cfRow('cf_utilidad_objetivo_opt','Utilidad óptima',85000)}
        ${cfRow('cf_mano_obra_base','Mano de obra base',35000)}
        <div class="no-fgroup">
          <label style="font-size:11px;color:#555;">Margen obj. repuestos (0–1)</label>
          <input id="cfInput_cf_margen_objetivo_rep" type="number" step="0.05" min="0" max="1"
            style="width:100%;font-size:12px;" value="${Number(c.cf_margen_objetivo_rep??0.5).toFixed(2)}">
        </div>
        ${cfRow('cf_meta_ahorro_mes','Meta ahorro / mes',2500000)}
        ${cfRow('cf_meta_total_mes','Meta total / mes',13900000)}
      </div>
    </div>
    <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-dark" style="min-width:150px;" onclick="fin_guardarConfig()">💾 Guardar configuración</button>
      <span id="finConfigMsg" style="font-size:12px;"></span>
    </div>`;
}

window.fin_guardarConfig = async function() {
  const get = id => {
    const el = document.getElementById(`cfInput_${id}`);
    if (!el) return null;
    return el.type === 'text' ? el.value.trim() : Number(el.value) || 0;
  };
  const body = {
    cf_arriendo:              get('cf_arriendo'),
    cf_energia:               get('cf_energia'),
    cf_agua:                  get('cf_agua'),
    cf_internet:              get('cf_internet'),
    cf_telefono:              get('cf_telefono'),
    cf_salarios:              get('cf_salarios'),
    cf_seguridad_social:      get('cf_seguridad_social'),
    cf_parafiscales:          get('cf_parafiscales'),
    cf_mantenimiento:         get('cf_mantenimiento'),
    cf_otros:                 get('cf_otros'),
    cf_descripcion_otros:     get('cf_descripcion_otros'),
    cf_utilidad_objetivo_min: get('cf_utilidad_objetivo_min'),
    cf_utilidad_objetivo_opt: get('cf_utilidad_objetivo_opt'),
    cf_mano_obra_base:        get('cf_mano_obra_base'),
    cf_margen_objetivo_rep:   get('cf_margen_objetivo_rep'),
    cf_meta_ahorro_mes:       get('cf_meta_ahorro_mes'),
    cf_meta_total_mes:        get('cf_meta_total_mes'),
  };
  const msgEl = document.getElementById('finConfigMsg');
  if (msgEl) { msgEl.style.color = '#555'; msgEl.textContent = 'Guardando...'; }
  try {
    const r = await fetch(`${API}/financiero/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error al guardar');
    showToast('Configuración financiera guardada');
    if (msgEl) msgEl.textContent = '';
    await fin_load();
  } catch (e) {
    if (msgEl) { msgEl.style.color = '#dc2626'; msgEl.textContent = e.message; }
  }
};

// ─── Finanzas — historial de configuraciones ─────────────────────────────────
async function fin_renderHistorial() {
  const el = document.getElementById('finHistCard');
  if (!el) return;
  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:10px;">📋 Historial de configuraciones</div>
    <div style="color:#aaa;font-size:13px;">Cargando...</div>`;
  try {
    const r    = await fetch(`${API}/financiero/config/historial`);
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      el.querySelector('div:last-child').textContent = 'Sin historial.';
      return;
    }
    const tbody = rows.map(c => `
      <tr style="border-bottom:1px solid #f0f4f8;font-size:12px;">
        <td style="padding:6px 4px;">${c.cf_vigente_desde||'—'}</td>
        <td style="padding:6px 4px;color:#888;">${c.cf_vigente_hasta||'—'}</td>
        <td style="padding:6px 4px;text-align:right;">${money(c.cf_meta_total_mes)}</td>
        <td style="padding:6px 4px;text-align:right;">${money(c.cf_utilidad_objetivo_min)}</td>
        <td style="padding:6px 4px;text-align:right;color:#dc2626;">${money(c.cf_total_costos_fijos)}</td>
        <td style="padding:6px 4px;text-align:center;">
          ${c.cf_vigente_hasta === null
            ? '<span style="background:#166534;color:#fff;padding:1px 7px;border-radius:4px;font-size:11px;">Activa</span>'
            : '<span style="font-size:11px;color:#888;">Cerrada</span>'}
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#1d3557;margin-bottom:10px;">📋 Historial de configuraciones</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="font-size:11px;text-transform:uppercase;color:#888;border-bottom:1px solid #e5e7eb;">
              <th style="padding:6px 4px;text-align:left;font-weight:600;">Desde</th>
              <th style="padding:6px 4px;text-align:left;font-weight:600;">Hasta</th>
              <th style="padding:6px 4px;text-align:right;font-weight:600;">Meta mes</th>
              <th style="padding:6px 4px;text-align:right;font-weight:600;">Util. mínima</th>
              <th style="padding:6px 4px;text-align:right;font-weight:600;">Costos fijos</th>
              <th style="padding:6px 4px;text-align:center;font-weight:600;">Estado</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;
  } catch (_) {
    el.innerHTML = `<div style="color:#aaa;font-size:13px;">Error cargando historial.</div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Views.contable — Módulo contable
// ════════════════════════════════════════════════════════════════════════════
Views.contable = {
  render() {
    const now = new Date();
    const mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return `
      <div style="padding:20px;max-width:960px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <h2 style="margin:0;color:#1d3557;">📒 Contabilidad</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="month" id="conMes" value="${mes}"
              style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
              onchange="con_cargar()">
            <button class="btn btn-dark" onclick="con_openEgreso()">+ Registrar egreso</button>
          </div>
        </div>

        <!-- Estado de resultados -->
        <!-- Alertas de vencimientos -->
        <div id="conVencimientos" style="margin-bottom:16px;"></div>

        <div id="conResumen" style="margin-bottom:20px;">
          <div style="color:#aaa;font-size:13px;padding:20px;text-align:center;">Cargando...</div>
        </div>

        <!-- Lista de egresos -->
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:13px;font-weight:600;color:#1d3557;">EGRESOS DEL MES</span>
            <select id="conCatFiltro" style="font-size:12px;padding:4px 8px;border:1px solid #ddd;border-radius:5px;" onchange="con_cargarEgresos()">
              <option value="">Todas las categorías</option>
              <option value="nomina">Nómina</option>
              <option value="arriendo">Arriendo</option>
              <option value="servicios">Servicios</option>
              <option value="compras">Compras</option>
              <option value="mantenimiento">Mantenimiento</option>
              <option value="impuestos">Impuestos</option>
              <option value="otros">Otros</option>
            </select>
          </div>
          <div id="conEgresosList"><div style="color:#aaa;font-size:13px;">Cargando...</div></div>
        </div>
      </div>`;
  },

  async init() {
    await con_cargar();
  },
};

const CON_CAT_LABELS = {
  nomina:'Nómina', arriendo:'Arriendo', servicios:'Servicios',
  compras:'Compras', mantenimiento:'Mantenimiento', impuestos:'Impuestos', otros:'Otros',
};
const CON_CAT_COLORS = {
  nomina:'#3b82f6', arriendo:'#f59e0b', servicios:'#8b5cf6',
  compras:'#10b981', mantenimiento:'#ef4444', impuestos:'#6366f1', otros:'#94a3b8',
};

window.con_cargar = async function() {
  await Promise.all([con_cargarVencimientos(), con_cargarResumen(), con_cargarEgresos()]);
};

window.con_cargarVencimientos = async function() {
  const el = document.getElementById('conVencimientos'); if (!el) return;
  try {
    const rows = await fetch(`${API}/contable/vencimientos`).then(r => r.json());
    if (!rows.length) { el.innerHTML = ''; return; }
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const items = rows.map(r => {
      const venc = new Date(r.egr_fecha_vencimiento + 'T00:00:00');
      const diff = Math.round((venc - hoy) / 86400000);
      let badge, border;
      if (diff < 0)      { badge = `🔴 Venció hace ${Math.abs(diff)} día(s)`;  border = '#ef4444'; }
      else if (diff <= 7){ badge = `⚠️ Vence en ${diff} día(s)`;               border = '#f59e0b'; }
      else               { badge = `📅 Vence ${venc.toLocaleDateString('es-CO')}`; border = '#3b82f6'; }
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-left:4px solid ${border};background:#fff;margin-bottom:6px;border-radius:0 6px 6px 0;gap:8px;flex-wrap:wrap;">
        <div>
          <span style="font-size:13px;font-weight:600;">${esc(r.egr_concepto)}</span>
          ${r.egr_proveedor ? `<span style="font-size:11px;color:#888;margin-left:6px;">${esc(r.egr_proveedor)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:11px;color:#555;">${badge}</span>
          <span style="font-weight:700;font-size:13px;">${money(r.egr_valor)}</span>
          <button class="btn btn-sm btn-dark" style="font-size:11px;padding:3px 10px;" onclick="con_pagar(${r.uid_egreso},this)">✅ Marcar pagado</button>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-bottom:4px;">
      <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:10px;">⏰ PAGOS PENDIENTES (${rows.length})</div>
      ${items}
    </div>`;
  } catch (_) { el.innerHTML = ''; }
};

window.con_pagar = async function(id, btn) {
  if (!confirm('¿Marcar este egreso como pagado?')) return;
  const orig = btn.textContent; btn.disabled = true; btn.textContent = '...';
  const r = await fetch(`${API}/contable/egresos/${id}/pagar`, { method:'PATCH' }).then(r => r.json()).catch(() => ({}));
  if (r.ok) { showToast('✅ Egreso marcado como pagado'); await con_cargar(); }
  else { btn.disabled = false; btn.textContent = orig; alert(r.error || 'Error'); }
};

window.con_cargarResumen = async function() {
  const el  = document.getElementById('conResumen'); if (!el) return;
  const mes = document.getElementById('conMes')?.value || new Date().toISOString().slice(0,7);
  el.innerHTML = '<div style="color:#aaa;font-size:13px;padding:16px;text-align:center;">Cargando estado de resultados...</div>';
  try {
    const d = await fetch(`${API}/contable/resumen?mes=${mes}`).then(r => r.json());
    if (d.error) { el.innerHTML = `<div style="color:#991b1b;padding:12px;">${esc(d.error)}</div>`; return; }

    const pct = (n, total) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '—';
    const row = (label, valor, sub='', color='#374151') =>
      `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f4f8;">
        <span style="color:#555;font-size:13px;">${label}${sub?`<span style="font-size:11px;color:#aaa;margin-left:6px;">${sub}</span>`:''}}</span>
        <span style="font-weight:600;font-size:13px;color:${color};">${money(valor)}</span>
      </div>`;

    // Barras de egresos por categoría
    const cats = (d.egresos.por_categoria || []).sort((a,b) => b.total - a.total);
    const maxCat = cats[0]?.total || 1;
    const barras = cats.map(c => {
      const pctBar = Math.round((c.total / maxCat) * 100);
      const col = CON_CAT_COLORS[c.categoria] || '#94a3b8';
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span style="color:#374151;">${CON_CAT_LABELS[c.categoria] || c.categoria}</span>
          <span style="font-weight:600;">${money(c.total)}</span>
        </div>
        <div style="background:#f0f4f8;border-radius:4px;height:8px;">
          <div style="background:${col};width:${pctBar}%;height:8px;border-radius:4px;"></div>
        </div>
      </div>`;
    }).join('');

    const netaColor = d.utilidad_neta >= 0 ? '#166534' : '#991b1b';
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">

        <!-- Ingresos -->
        <div class="card" style="border-left:4px solid #10b981;">
          <div style="font-size:12px;font-weight:700;color:#10b981;margin-bottom:10px;">💵 INGRESOS</div>
          ${row('Ventas pagadas', d.ingresos.ventas, `${d.ingresos.num_ventas} ventas`)}
          ${row('Recibos de caja', d.ingresos.recibos, `${d.ingresos.num_recibos} recibos`)}
          <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:4px;">
            <span style="font-weight:700;color:#10b981;">Total ingresos</span>
            <span style="font-weight:700;font-size:15px;color:#10b981;">${money(d.ingresos.total)}</span>
          </div>
        </div>

        <!-- Egresos -->
        <div class="card" style="border-left:4px solid #ef4444;">
          <div style="font-size:12px;font-weight:700;color:#ef4444;margin-bottom:10px;">💸 EGRESOS</div>
          ${row('Costo de ventas', d.costo_ventas)}
          ${row('Compras inventario', d.egresos.compras_inventario)}
          ${row('Gastos operativos', d.egresos.operativos)}
          <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:4px;">
            <span style="font-weight:700;color:#ef4444;">Total egresos</span>
            <span style="font-weight:700;font-size:15px;color:#ef4444;">${money(d.costo_ventas + d.egresos.total)}</span>
          </div>
        </div>
      </div>

      <!-- Utilidad neta -->
      <div style="background:${d.utilidad_neta>=0?'#dcfce7':'#fee2e2'};border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div>
          <div style="font-size:12px;color:${netaColor};font-weight:700;">UTILIDAD NETA DEL MES</div>
          <div style="font-size:11px;color:${netaColor};opacity:.8;">Ingresos − Costo ventas − Egresos operativos − Compras</div>
        </div>
        <div style="font-size:24px;font-weight:800;color:${netaColor};">${money(d.utilidad_neta)}</div>
      </div>

      <!-- Desglose por categoría -->
      ${cats.length ? `<div class="card"><div style="font-size:12px;font-weight:700;color:#1d3557;margin-bottom:12px;">DESGLOSE EGRESOS POR CATEGORÍA</div>${barras}</div>` : ''}`;
  } catch (e) {
    const el2 = document.getElementById('conResumen');
    if (el2) el2.innerHTML = `<div style="color:#991b1b;padding:12px;">Error: ${esc(e.message)}</div>`;
  }
};

window.con_cargarEgresos = async function() {
  const el  = document.getElementById('conEgresosList'); if (!el) return;
  const mes = document.getElementById('conMes')?.value || new Date().toISOString().slice(0,7);
  const cat = document.getElementById('conCatFiltro')?.value || '';
  el.innerHTML = '<div style="color:#aaa;font-size:13px;">Cargando...</div>';
  try {
    const params = new URLSearchParams({ mes });
    if (cat) params.set('categoria', cat);
    const rows = await fetch(`${API}/contable/egresos?${params}`).then(r => r.json());
    if (!rows.length) {
      el.innerHTML = '<div style="color:#aaa;font-size:13px;padding:12px 0;">Sin egresos registrados para este período.</div>';
      return;
    }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f0f4f8;">
        <th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;">Fecha</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;">Concepto</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;">Categoría</th>
        <th style="padding:8px 10px;text-align:left;font-weight:600;color:#555;">Proveedor</th>
        <th style="padding:8px 10px;text-align:right;font-weight:600;color:#555;">Valor</th>
        <th style="padding:8px 6px;text-align:center;font-weight:600;color:#555;">IA</th>
        <th style="padding:8px 6px;width:60px;"></th>
      </tr></thead>
      <tbody>${rows.map((r,i) => {
        const col = CON_CAT_COLORS[r.egr_categoria] || '#94a3b8';
        const lbl = CON_CAT_LABELS[r.egr_categoria] || r.egr_categoria;
        const anulado = r.egr_estado === 'anulado';
        return `<tr style="${i%2===1?'background:#fafafa;':''}border-bottom:1px solid #f0f0f0;${anulado?'opacity:.5;':''}" >
          <td style="padding:8px 10px;white-space:nowrap;color:#666;">${r.egr_fecha?.slice?.(0,10)||''}</td>
          <td style="padding:8px 10px;">${esc(r.egr_concepto)}</td>
          <td style="padding:8px 10px;"><span style="background:${col}22;color:${col};font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">${lbl}</span></td>
          <td style="padding:8px 10px;color:#666;font-size:12px;">${esc(r.egr_proveedor||'—')}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:600;">${money(r.egr_valor)}</td>
          <td style="padding:8px 6px;text-align:center;">${r.egr_ia_extraido?'🤖':'—'}</td>
          <td style="padding:8px 6px;text-align:center;">
            ${!anulado?`<button class="btn btn-sm btn-grey" style="font-size:11px;padding:2px 7px;" onclick="con_anular(${r.uid_egreso},this)">Anular</button>`:'<span style="font-size:11px;color:#aaa;">Anulado</span>'}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch (e) {
    const el2 = document.getElementById('conEgresosList');
    if (el2) el2.innerHTML = `<div style="color:#991b1b;">Error: ${esc(e.message)}</div>`;
  }
};

window.con_anular = async function(id, btn) {
  if (!confirm('¿Anular este egreso? No se puede deshacer.')) return;
  const orig = btn.textContent; btn.disabled = true; btn.textContent = '...';
  const r = await fetch(`${API}/contable/egresos/${id}/anular`, { method: 'PATCH' }).then(r => r.json()).catch(() => ({}));
  if (r.ok) { showToast('Egreso anulado'); await con_cargar(); }
  else { btn.disabled = false; btn.textContent = orig; alert(r.error || 'Error al anular'); }
};

// ── Modal nuevo egreso ────────────────────────────────────────────────────────
window.con_openEgreso = function(prefill = {}) {
  document.getElementById('conEgresoModal')?.remove();
  const today = prefill.fecha || new Date().toISOString().slice(0,10);
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'conEgresoModal';
  bg.innerHTML = `<div class="modal" style="max-width:560px;width:96%;">
    <h3>${prefill._ia ? '🤖 Confirmar egreso extraído con IA' : 'Nuevo Egreso'}</h3>
    ${prefill._ia ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 12px;font-size:12px;color:#1e40af;margin-bottom:14px;">
      IA extrajo estos datos — revisa y corrige antes de guardar.
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Fecha <span style="color:#e53e3e">*</span></label>
        <input type="date" id="conEgrFecha" value="${today}" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
      </div>
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Categoría <span style="color:#e53e3e">*</span></label>
        <select id="conEgrCat" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          ${['nomina','arriendo','servicios','compras','mantenimiento','impuestos','otros'].map(c =>
            `<option value="${c}" ${(prefill.categoria_sugerida||'otros')===c?'selected':''}>${CON_CAT_LABELS[c]}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    <div style="margin-bottom:10px;">
      <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Concepto <span style="color:#e53e3e">*</span></label>
      <input type="text" id="conEgrConcepto" value="${esc(prefill.concepto||'')}" placeholder="Ej: Arriendo local mes de mayo"
        style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;">
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Valor <span style="color:#e53e3e">*</span></label>
        <input type="number" id="conEgrValor" min="0" value="${prefill.valor_total||''}" placeholder="0"
          style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
      </div>
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Forma de pago</label>
        <select id="conEgrFormaPago" onchange="con_toggleVencimiento()" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
          <option value="contado" ${(prefill.forma_pago||'contado')==='contado'?'selected':''}>Contado</option>
          <option value="credito" ${(prefill.forma_pago||'')==='credito'?'selected':''}>Crédito</option>
        </select>
      </div>
    </div>

    <div id="conEgrVencRow" style="margin-bottom:10px;display:${(prefill.forma_pago==='credito')?'block':'none'};">
      <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Fecha de vencimiento <span style="color:#e53e3e">*</span></label>
      <input type="date" id="conEgrVence" value="${prefill.fecha_vencimiento||''}"
        style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
    </div>

    <div style="margin-bottom:10px;">
      <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Método de pago</label>
      <select id="conEgrMetodo" style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
        <option value="efectivo">Efectivo</option>
        <option value="transferencia">Transferencia</option>
        <option value="tarjeta">Tarjeta</option>
        <option value="nequi">Nequi</option>
        <option value="daviplata">Daviplata</option>
        <option value="cheque">Cheque</option>
      </select>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Proveedor</label>
        <input type="text" id="conEgrProv" value="${esc(prefill.proveedor||'')}" placeholder="Nombre del proveedor"
          style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">NIT / Cédula proveedor</label>
        <input type="text" id="conEgrNit" value="${esc(prefill.nit_proveedor||'')}" placeholder="9862087-1"
          style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
    </div>

    <div style="margin-bottom:10px;">
      <label style="font-size:12px;color:#555;display:block;margin-bottom:3px;">Referencia / N° factura</label>
      <input type="text" id="conEgrRef" value="${esc(prefill.referencia||'')}" placeholder="FV-2026-001"
        style="width:100%;padding:7px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;">
    </div>

    <!-- Subir factura con IA -->
    <div style="margin-bottom:14px;padding:12px;background:#f8fafc;border-radius:8px;border:1px dashed #c7d2dd;">
      <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">🤖 Subir factura con IA <span style="font-weight:400;color:#888;">(opcional — extrae datos automáticamente)</span></div>
      <input type="file" id="conEgrFile" accept="image/*,application/pdf"
        style="font-size:12px;width:100%;margin-bottom:6px;">
      <button type="button" class="btn btn-sm btn-mid" onclick="con_extraerIA()" id="conEgrIABtn">
        ✨ Extraer con IA
      </button>
      <div id="conEgrIAMsg" style="font-size:12px;margin-top:6px;display:none;"></div>
    </div>

    <input type="hidden" id="conEgrFacturaImagen" value="${esc(prefill._factura_imagen||'')}">
    <input type="hidden" id="conEgrIAExtraido" value="${prefill._ia?'1':'0'}">

    <div id="conEgrErr" style="display:none;margin-bottom:8px;padding:8px 10px;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:13px;"></div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
      <button class="btn btn-grey" onclick="document.getElementById('conEgresoModal')?.remove()">Cancelar</button>
      <button class="btn btn-dark" onclick="con_guardarEgreso()">💾 Guardar egreso</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
};

window.con_toggleVencimiento = function() {
  const fp = document.getElementById('conEgrFormaPago')?.value;
  const row = document.getElementById('conEgrVencRow');
  if (row) row.style.display = fp === 'credito' ? 'block' : 'none';
};

// Comprime una imagen en el navegador usando Canvas si supera maxBytes.
// PDFs y archivos ya pequeños se devuelven sin cambios.
async function _comprimirImagen(file, maxBytes = 4.5 * 1024 * 1024) {
  if (file.size <= maxBytes) return file;
  const isImage = (file.type || '').startsWith('image/')
    || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name || '');
  if (!isImage) return file;

  const MAX = 1568;
  const quality = 0.80;
  const outName = file.name.replace(/\.[^.]+$/, '.jpg');

  // Intento 1: createImageBitmap — más eficiente en memoria, mejor soporte móvil
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      let w = bitmap.width, h = bitmap.height;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
        if (blob && blob.size < file.size) return new File([blob], outName, { type: 'image/jpeg' });
      } else {
        bitmap.close();
      }
    } catch (_) {}
  }

  // Intento 2: Image + object URL (fallback para navegadores sin createImageBitmap)
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          const r = Math.min(MAX / w, MAX / h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => resolve(blob && blob.size < file.size ? new File([blob], outName, { type: 'image/jpeg' }) : file),
          'image/jpeg', quality
        );
      } catch (_) { resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

window.con_extraerIA = async function() {
  const fileEl = document.getElementById('conEgrFile');
  const msgEl  = document.getElementById('conEgrIAMsg');
  const btn    = document.getElementById('conEgrIABtn');
  if (!fileEl?.files?.length) { msgEl.style.display=''; msgEl.style.color='#991b1b'; msgEl.textContent='Selecciona una imagen o PDF primero.'; return; }
  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  msgEl.style.display = ''; msgEl.style.color = '#888'; msgEl.textContent = 'Preparando imagen...';
  try {
    const archivo = await _comprimirImagen(fileEl.files[0]);
    msgEl.textContent = 'Enviando archivo...';
    const form = new FormData();
    form.append('factura', archivo);
    const resp = await fetch(`${API}/contable/egresos/extraer-factura`, { method:'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Error ${resp.status}`);
    }

    // Leer SSE: el servidor envía {status:'analyzing'} de inmediato y {status:'done',...} al terminar
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop(); // fragmento incompleto al final
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        const data = JSON.parse(part.slice(6));
        if (data.status === 'analyzing') {
          btn.textContent = '🤖 Claude analizando...';
          msgEl.textContent = 'Claude está analizando la factura...';
        } else if (data.status === 'done') {
          const e = data.extraido;
          if (e.fecha)          document.getElementById('conEgrFecha').value    = e.fecha;
          if (e.valor_total)    document.getElementById('conEgrValor').value    = e.valor_total;
          if (e.concepto)       document.getElementById('conEgrConcepto').value = e.concepto;
          if (e.proveedor)      document.getElementById('conEgrProv').value     = e.proveedor;
          if (e.nit_proveedor)  document.getElementById('conEgrNit').value      = e.nit_proveedor;
          if (e.referencia)     document.getElementById('conEgrRef').value      = e.referencia;
          if (e.categoria_sugerida) {
            const sel = document.getElementById('conEgrCat');
            if (sel) sel.value = e.categoria_sugerida;
          }
          if (e.forma_pago) {
            const fpSel = document.getElementById('conEgrFormaPago');
            if (fpSel) { fpSel.value = e.forma_pago; con_toggleVencimiento(); }
          }
          if (e.fecha_vencimiento) {
            const vEl = document.getElementById('conEgrVence');
            if (vEl) vEl.value = e.fecha_vencimiento;
          }
          document.getElementById('conEgrFacturaImagen').value = data.factura_imagen || '';
          document.getElementById('conEgrIAExtraido').value    = '1';
          msgEl.style.color = '#166534';
          msgEl.textContent = '✅ Datos extraídos — revisa y confirma antes de guardar.';
        } else if (data.status === 'error') {
          throw new Error(data.error || 'Error IA');
        }
      }
    }
  } catch (err) {
    msgEl.style.color = '#991b1b'; msgEl.textContent = '⚠️ ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = '✨ Extraer con IA';
  }
};

window.con_guardarEgreso = async function() {
  const errEl = document.getElementById('conEgrErr');
  const formaPago = document.getElementById('conEgrFormaPago')?.value || 'contado';
  const body = {
    egr_fecha:              document.getElementById('conEgrFecha')?.value,
    egr_concepto:           document.getElementById('conEgrConcepto')?.value?.trim(),
    egr_categoria:          document.getElementById('conEgrCat')?.value,
    egr_valor:              document.getElementById('conEgrValor')?.value,
    egr_metodo_pago:        document.getElementById('conEgrMetodo')?.value,
    egr_forma_pago:         formaPago,
    egr_fecha_vencimiento:  formaPago === 'credito' ? (document.getElementById('conEgrVence')?.value || null) : null,
    egr_proveedor:          document.getElementById('conEgrProv')?.value?.trim() || null,
    egr_nit_proveedor:      document.getElementById('conEgrNit')?.value?.trim() || null,
    egr_referencia:         document.getElementById('conEgrRef')?.value?.trim() || null,
    egr_factura_imagen:     document.getElementById('conEgrFacturaImagen')?.value || null,
    egr_ia_extraido:        document.getElementById('conEgrIAExtraido')?.value === '1' ? 1 : 0,
  };
  if (!body.egr_fecha)    { errEl.textContent='La fecha es requerida.';  errEl.style.display=''; return; }
  if (!body.egr_concepto) { errEl.textContent='El concepto es requerido.'; errEl.style.display=''; return; }
  if (!body.egr_valor || Number(body.egr_valor) <= 0) { errEl.textContent='El valor debe ser mayor a 0.'; errEl.style.display=''; return; }
  if (formaPago === 'credito' && !body.egr_fecha_vencimiento) { errEl.textContent='La fecha de vencimiento es requerida para crédito.'; errEl.style.display=''; return; }
  errEl.style.display = 'none';

  const r = await fetch(`${API}/contable/egresos`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => ({ error:'Error de red' }));

  if (r.uid_egreso) {
    document.getElementById('conEgresoModal')?.remove();
    showToast('✅ Egreso registrado');
    await con_cargar();
  } else {
    errEl.textContent = r.error || 'Error al guardar.';
    errEl.style.display = '';
  }
};

// ════════════════════════════════════════════════════════════════════════════
// Views.solicitudesTaller — Gestión de solicitudes de recogida
// ════════════════════════════════════════════════════════════════════════════
Views.solicitudesTaller = {
  render() {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="stFiltroEstado" onchange="sol_cargar()" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
            <option value="">Todos los estados</option>
            <option value="pendiente" selected>Pendientes</option>
            <option value="confirmada">Confirmadas</option>
            <option value="completada">Completadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>
      </div>
      <div id="stLista"><div style="text-align:center;padding:40px;color:#888">Cargando...</div></div>
      <!-- Modal confirmar -->
      <div id="stConfirmarModal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;"></div>
    `;
  },
  async init() {
    await sol_cargar();
  }
};

async function sol_checkPending() {
  try {
    const rows = await fetch('/api/taller/solicitudes-recogida?estado=pendiente').then(r => r.json());
    const count = Array.isArray(rows) ? rows.length : 0;
    const badge = document.getElementById('solPendBadge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  } catch (_) {}
}

async function sol_cargar() {
  const estado = document.getElementById('stFiltroEstado')?.value || '';
  const url = `/api/taller/solicitudes-recogida${estado ? '?estado=' + estado : ''}`;
  const rows = await fetch(url).then(r => r.json()).catch(() => []);
  const el = document.getElementById('stLista');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">No hay solicitudes en este estado.</div>';
    return;
  }
  const estadoLabel = { pendiente:'Pendiente', confirmada:'Confirmada', completada:'Completada', cancelada:'Cancelada' };
  const estadoColor = { pendiente:'#fef3c7;color:#92400e', confirmada:'#d1fae5;color:#065f46', completada:'#dbeafe;color:#1e40af', cancelada:'#fee2e2;color:#991b1b' };
  const tipoLabel   = { reparacion:'Reparación', mantenimiento:'Mantenimiento', revision:'Revisión' };

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">` + rows.map(s => {
    const badge    = `<span style="background:${estadoColor[s.estado]||'#e5e7eb;color:#374151'};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">${estadoLabel[s.estado]||s.estado}</span>`;
    const cliente  = s.cli_razon_social || s.cli_contacto || 'Cliente desconocido';
    const maquinas = s.maquinas || [];
    const maqsTitulo = maquinas.map(m => esc(m.her_nombre)).join(', ') || 'Sin equipos';
    const fechaCon = s.fecha_confirmada ? new Date(s.fecha_confirmada).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : null;

    const maqsDetalleHtml = maquinas.map(m =>
      `<div style="font-size:12px;padding:2px 0;">
        <b>${esc(m.her_nombre)}</b>${m.her_marca?` — ${esc(m.her_marca)}`:''}${m.her_serial?` (S/N: ${esc(m.her_serial)})`:''} · <span style="color:#6b7280">${tipoLabel[m.tipo_servicio]||m.tipo_servicio}</span>
        ${m.descripcion?`<br><span style="color:#9ca3af">${esc(m.descripcion)}</span>`:''}
      </div>`
    ).join('');

    const safeDir  = (s.direccion||'').replace(/'/g,"\\'");
    const safeEqs  = maqsTitulo.replace(/'/g,"\\'");
    const accionesHtml = s.estado === 'pendiente'
      ? `<button onclick="sol_abrirConfirmar(${s.uid_solicitud}, '${safeEqs}', '${safeDir}');" style="background:#1d3557;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-right:6px;">📅 Confirmar fecha</button>
         <button onclick="sol_cambiarEstado(${s.uid_solicitud},'cancelada')" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">Cancelar</button>`
      : s.estado === 'confirmada' && !s.uid_orden_creada
      ? `<button onclick="sol_crearOrden(${s.uid_solicitud})" style="background:#065f46;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-right:6px;">📦 Recibida → Crear orden</button>
         <button onclick="sol_cambiarEstado(${s.uid_solicitud},'cancelada')" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">Cancelar</button>`
      : s.uid_orden_creada
      ? `<span style="font-size:12px;font-weight:600;color:#065f46;">✅ Orden #${s.ord_consecutivo || s.uid_orden_creada} creada</span>
         <button onclick="navigate('ordenes')" style="margin-left:10px;background:none;border:1px solid #d1d5db;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Ver órdenes →</button>`
      : '';
    const confirmBox = fechaCon
      ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:13px;font-weight:600;color:#065f46;">📅 ${fechaCon}${s.nota_confirmacion ? ' — ' + esc(s.nota_confirmacion) : ''}</div>` : '';

    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
        <div>
          <div style="font-weight:700;font-size:14px;">${maqsTitulo}</div>
          <div style="font-size:12px;color:#6b7280;">${cliente}${s.cli_identificacion?' · CC '+s.cli_identificacion:''}</div>
        </div>
        ${badge}
      </div>
      ${maqsDetalleHtml ? `<div style="margin:6px 0 8px;">${maqsDetalleHtml}</div>` : ''}
      <div style="font-size:12px;color:#374151;line-height:1.7;">
        <b>📍</b> ${esc(s.direccion)}
        ${s.fecha_sugerida?` &nbsp; <b>Fecha sugerida:</b> ${s.fecha_sugerida.split('T')[0].split('-').reverse().join('/')}` : ''}
        ${s.cli_telefono?`<br><b>Tel:</b> ${esc(s.cli_telefono)}`:''}
        <br><b>Recibida:</b> ${new Date(s.created_at).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
      </div>
      ${confirmBox}
      ${accionesHtml ? `<div style="margin-top:10px;">${accionesHtml}</div>` : ''}
    </div>`;
  }).join('') + '</div>';
}

function sol_abrirConfirmar(uid, equipos, direccion) {
  const hoy = new Date().toISOString().slice(0,16);
  const modal = document.getElementById('stConfirmarModal');
  modal.innerHTML = `
    <div style="background:#fff;width:94%;max-width:440px;border-radius:12px;padding:20px;">
      <div style="font-weight:700;font-size:15px;margin-bottom:14px;">📅 Confirmar recogida</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:14px;">
        <b>Equipos:</b> ${esc(equipos)}<br><b>Dirección:</b> ${esc(direccion)}
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:5px;">Fecha y hora de recogida <span style="color:#dc2626">*</span></label>
        <input type="datetime-local" id="stFechaConf" value="${hoy}" min="${hoy}" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:5px;">Nota para el cliente <span style="font-size:11px;font-weight:400;color:#9ca3af;">— opcional, se envía por WA</span></label>
        <input type="text" id="stNota" placeholder="Ej: Llegamos entre 9am y 10am" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
      </div>
      <div id="stConfErr" style="display:none;background:#fef2f2;color:#991b1b;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:12px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="document.getElementById('stConfirmarModal').style.display='none'" style="background:#f1f5f9;border:1px solid #d1d5db;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;">Cancelar</button>
        <button onclick="sol_confirmar(${uid})" style="background:#1d3557;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;" id="stBtnConf">📅 Confirmar y notificar</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

async function sol_confirmar(uid) {
  const fecha = document.getElementById('stFechaConf')?.value;
  const nota  = document.getElementById('stNota')?.value?.trim() || null;
  const errEl = document.getElementById('stConfErr');
  if (!fecha) { errEl.textContent = 'La fecha es requerida.'; errEl.style.display=''; return; }
  document.getElementById('stBtnConf').disabled = true;
  const r = await fetch(`/api/taller/solicitudes-recogida/${uid}/confirmar`, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ fecha_confirmada: fecha, nota_confirmacion: nota }),
  }).then(x => x.json()).catch(() => ({ error:'Error de red' }));
  if (r.success) {
    document.getElementById('stConfirmarModal').style.display = 'none';
    showToast('✅ Recogida confirmada — cliente notificado por WA');
    await sol_cargar();
    sol_checkPending();
  } else {
    errEl.textContent = r.error || 'Error al confirmar';
    errEl.style.display = '';
    document.getElementById('stBtnConf').disabled = false;
  }
}

async function sol_crearOrden(uid) {
  if (!confirm('¿Las máquinas ya están en el taller?\nEsto creará una orden de servicio y marcará la solicitud como completada.')) return;
  const btn = document.querySelector(`[onclick="sol_crearOrden(${uid})"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Creando orden...'; }
  const r = await fetch(`/api/taller/solicitudes-recogida/${uid}/crear-orden`, { method: 'POST' })
    .then(x => x.json()).catch(() => ({ error: 'Error de red' }));
  if (r.success) {
    showToast(`✅ Orden #${r.consecutivo} creada exitosamente`);
    await sol_cargar();
    sol_checkPending();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '📦 Recibida → Crear orden'; }
    alert('Error: ' + (r.error || 'No se pudo crear la orden'));
  }
}

async function sol_cambiarEstado(uid, estado) {
  const label = { completada:'marcar como completada', cancelada:'cancelar' }[estado];
  if (!confirm(`¿Confirma ${label} esta solicitud?`)) return;
  const r = await fetch(`/api/taller/solicitudes-recogida/${uid}/estado`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ estado }),
  }).then(x => x.json()).catch(() => ({ error:'Error de red' }));
  if (r.success) { showToast('✅ Estado actualizado'); await sol_cargar(); sol_checkPending(); }
  else alert('Error: ' + (r.error || 'No se pudo actualizar'));
}

// ════════════════════════════════════════════════════════════════════════════
// VISTA: WA CONVERSACIONES — historial del agente IA con clientes
// ════════════════════════════════════════════════════════════════════════════
Views.waConversaciones = {
  render() {
    return `
      <div style="max-width:820px;margin:0 auto;padding:20px 16px;">
        <div style="margin-bottom:18px;">
          <input id="wacSearch" type="text" placeholder="Buscar por nombre de cliente o número de teléfono..."
            style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #d1d5db;
                   border-radius:8px;font-size:14px;outline:none;"
            oninput="wac_buscarDebounce()">
        </div>
        <div id="wacContent"></div>
      </div>`;
  },
  init() { wac_cargar(); },
};

let _wacTimer = null;

function wac_buscarDebounce() {
  clearTimeout(_wacTimer);
  _wacTimer = setTimeout(wac_cargar, 350);
}

function wac_fmtFecha(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) {
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

async function wac_cargar() {
  const q   = (document.getElementById('wacSearch')?.value || '').trim();
  const cnt = document.getElementById('wacContent');
  if (!cnt) return;
  cnt.innerHTML = '<p style="color:#9ca3af;font-size:14px;text-align:center;padding:30px 0;">Cargando...</p>';
  try {
    const url  = `${API}/wa/conversaciones${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    const data = await fetch(url).then(r => r.json());
    if (!Array.isArray(data) || data.length === 0) {
      cnt.innerHTML = `<p style="color:#9ca3af;font-size:14px;text-align:center;padding:40px 0;">
        ${q ? 'Sin resultados para esa búsqueda.' : 'No hay conversaciones registradas todavía.'}</p>`;
      return;
    }
    cnt.innerHTML = data.map(c => `
      <div onclick="wac_verDetalle('${esc(c.token)}')"
        style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;
               margin-bottom:10px;cursor:pointer;transition:box-shadow .15s;"
        onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.1)'"
        onmouseout="this.style.boxShadow='none'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="min-width:0;">
            <div style="font-size:14px;font-weight:600;color:#1d3557;">${esc(c.wa_phone_masked)}</div>
            <div style="font-size:12px;margin-top:2px;color:${c.nombre_cliente ? '#4b5563' : '#9ca3af'};">
              ${c.nombre_cliente ? esc(c.nombre_cliente) : 'Cliente no identificado'}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:11px;color:#9ca3af;">${wac_fmtFecha(c.ultimo_at)}</div>
            <span style="display:inline-block;background:#e0e7ff;color:#3730a3;font-size:11px;
                         padding:1px 8px;border-radius:10px;margin-top:3px;">
              ${c.total_mensajes} msgs
            </span>
          </div>
        </div>
        <div style="margin-top:8px;font-size:13px;color:#6b7280;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          <span style="font-size:11px;padding:1px 6px;border-radius:4px;margin-right:6px;
                       background:${c.ultimo_mensaje_rol === 'assistant' ? '#dbeafe' : '#f3f4f6'};
                       color:${c.ultimo_mensaje_rol === 'assistant' ? '#1d4ed8' : '#6b7280'};">
            ${c.ultimo_mensaje_rol === 'assistant' ? '🤖 Agente' : '👤 Cliente'}
          </span>${esc(c.ultimo_mensaje || '')}
        </div>
      </div>`).join('');
  } catch (e) {
    cnt.innerHTML = '<p style="color:#e53e3e;font-size:14px;">Error cargando conversaciones.</p>';
  }
}

async function wac_verDetalle(token) {
  const cnt = document.getElementById('wacContent');
  if (!cnt) return;
  cnt.innerHTML = '<p style="color:#9ca3af;font-size:14px;text-align:center;padding:30px 0;">Cargando conversación...</p>';
  try {
    const data = await fetch(`${API}/wa/conversaciones/detalle/${encodeURIComponent(token)}`).then(r => r.json());
    if (data.error) { cnt.innerHTML = `<p style="color:#e53e3e;">${esc(data.error)}</p>`; return; }

    const clienteHtml = data.nombre_cliente
      ? `<span style="font-weight:600;">${esc(data.nombre_cliente)}</span>` +
        (data.cli_identificacion
          ? ` <span style="color:#9ca3af;font-size:12px;">CC/NIT ${esc(data.cli_identificacion)}</span>`
          : '')
      : '<span style="color:#9ca3af;">Cliente no identificado</span>';

    const mensajesHtml = (data.mensajes || []).map(m => {
      const esAgente = m.rol === 'assistant';
      return `
        <div style="display:flex;justify-content:${esAgente ? 'flex-end' : 'flex-start'};margin-bottom:10px;">
          <div style="max-width:72%;padding:10px 14px;font-size:13px;line-height:1.5;
                      border-radius:${esAgente ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
                      background:${esAgente ? '#dbeafe' : '#f3f4f6'};
                      color:${esAgente ? '#1e3a5f' : '#374151'};">
            <div style="white-space:pre-wrap;word-break:break-word;">${esc(m.contenido)}</div>
            <div style="font-size:10px;margin-top:5px;text-align:right;
                        color:${esAgente ? '#60a5fa' : '#9ca3af'};">
              ${esAgente ? '🤖 Agente' : '👤 Cliente'} · ${wac_fmtFecha(m.created_at)}
            </div>
          </div>
        </div>`;
    }).join('');

    cnt.innerHTML = `
      <div>
        <button onclick="wac_cargar()"
          style="background:none;border:1px solid #d1d5db;border-radius:7px;padding:6px 14px;
                 font-size:13px;cursor:pointer;color:#374151;margin-bottom:16px;">
          ← Volver a la lista
        </button>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:14px;">
          <div style="font-size:16px;font-weight:700;color:#1d3557;margin-bottom:4px;">
            ${esc(data.wa_phone)}
          </div>
          <div style="font-size:13px;">${clienteHtml}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;
                    max-height:65vh;overflow-y:auto;">
          ${mensajesHtml || '<p style="color:#9ca3af;text-align:center;padding:20px 0;">Sin mensajes registrados.</p>'}
        </div>
      </div>`;
  } catch (e) {
    cnt.innerHTML = '<p style="color:#e53e3e;font-size:14px;">Error cargando la conversación.</p>';
  }
}

// ── pwd_must_change — cambio obligatorio de contraseña ────────────────────────
function pwd_mostrarModal() {
  const el = document.getElementById('pwdChangeOverlay');
  if (el) { el.style.display = 'flex'; }
}

async function pwd_confirmarCambio() {
  const actual    = document.getElementById('pwdActual')?.value    || '';
  const nueva     = document.getElementById('pwdNueva')?.value     || '';
  const confirmar = document.getElementById('pwdConfirmar')?.value || '';
  const errEl     = document.getElementById('pwdError');
  const btn       = document.getElementById('pwdBtnConfirmar');

  errEl.style.display = 'none';

  if (!actual)             { errEl.textContent = 'Ingrese su contraseña actual.';                 errEl.style.display=''; return; }
  if (nueva.length < 8)   { errEl.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; errEl.style.display=''; return; }
  if (nueva !== confirmar) { errEl.textContent = 'Las contraseñas no coinciden.';                 errEl.style.display=''; return; }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const r = await fetch('/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: actual, newPassword: nueva }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) {
      errEl.textContent = data.error || 'Error al cambiar la contraseña.';
      errEl.style.display = '';
      return;
    }
    // Contraseña cambiada — ocultar modal y continuar normalmente
    document.getElementById('pwdChangeOverlay').style.display = 'none';
    showToast('Contraseña actualizada correctamente.', 'success');
  } catch (e) {
    errEl.textContent = 'Error de conexión. Intente nuevamente.';
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cambiar contraseña';
  }
}

// ── Session init ──────────────────────────────────────────────────────────────
(async function() {
  const me = await fetch('/me').then(r=>r.json()).catch(()=>({}));
  if (!me.authenticated) { location.href='/login'; return; }
  _currentUser = me.user;
  document.getElementById('sidebarUser').textContent = me.user.nombre;
  document.getElementById('topbarUser').textContent  = me.user.nombre;

  // Adaptar sidebar según rol
  if (isTecnico()) {
    // Mostrar solo los nav-items del técnico
    document.querySelectorAll('.nav-item').forEach(el => {
      el.style.display = TEC_VIEWS.includes(el.dataset.view) ? '' : 'none';
    });
    // Ocultar botón y nav-item "Nueva Orden"
    const btnNO = document.querySelector('.btn-nueva-orden');
    if (btnNO) btnNO.style.display = 'none';
    const navNO = document.querySelector('.nueva-orden-nav');
    if (navNO) navNO.style.display = 'none';
  } else {
    // Para otros roles, ocultar los nav-items exclusivos del técnico
    document.querySelectorAll('.nav-item').forEach(el => {
      if (TEC_VIEWS.includes(el.dataset.view)) el.style.display = 'none';
    });
    // Mostrar nav-items solo para admin
    if (isAdmin()) {
      document.querySelectorAll('.nav-item.admin-only').forEach(el => el.style.display = '');
      // Módulo contable solo si el add-on está activo
      if (!me.addons?.contabilidad) {
        const navC = document.getElementById('navContable');
        if (navC) navC.style.display = 'none';
      }
    }
  }

  // Forzar cambio de contraseña si el flag está activo
  if (me.user.pwd_must_change) {
    pwd_mostrarModal();
    return; // No navegar al dashboard hasta que cambie la contraseña
  }

  // Hash-based routing
  const hash = location.hash.slice(1);
  const defaultView = isTecnico() ? 'misOrdenes' : 'inicio';
  const allowedHash = isTecnico() ? (TEC_VIEWS.includes(hash) ? hash : null) : hash;
  navigate(Views[allowedHash] ? allowedHash : defaultView);

  // Badge solicitudes pendientes (solo personal interno)
  if (!isTecnico()) sol_checkPending();
})();

// ─── Modal de entrega con firma ───────────────────────────────────────────────
// Estado del modal (uid/uidOrden/sel/prev del selector que abrió el modal)
let _entUid = null, _entUidOrden = null, _entSel = null, _entPrev = null;
let _entFirmoAlgo = false;
let _entDrawing = false;
let _entLastX = 0, _entLastY = 0;

function ord_mostrarModalEntrega(uid, uidOrden, sel, prev) {
  _entUid = uid; _entUidOrden = uidOrden; _entSel = sel; _entPrev = prev;
  document.getElementById('entNombre').value   = '';
  document.getElementById('entTelefono').value = '';
  document.getElementById('entCedula').value   = '';
  document.getElementById('entError').style.display = 'none';
  document.getElementById('entBtnConfirmar').disabled = false;
  ord_limpiarFirma();
  document.getElementById('entregaOverlay').style.display = 'block';
  setTimeout(() => document.getElementById('entNombre').focus(), 80);
  _ent_initCanvas();
}

function ord_cancelarEntrega() {
  document.getElementById('entregaOverlay').style.display = 'none';
  if (_entSel) { _entSel.value = _entPrev; _entSel.disabled = false; }
  _entUid = _entUidOrden = _entSel = _entPrev = null;
}

function ord_limpiarFirma() {
  _entFirmoAlgo = false;
  const canvas = document.getElementById('entFirmaCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('entFirmaHint').style.display = 'flex';
}

function _ent_initCanvas() {
  const canvas = document.getElementById('entFirmaCanvas');
  if (!canvas || canvas._entInited) return;
  canvas._entInited = true;
  const ctx = canvas.getContext('2d');

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
  }

  function startDraw(e) {
    e.preventDefault();
    _entDrawing = true;
    const p = getPos(e);
    _entLastX = p.x; _entLastY = p.y;
    document.getElementById('entFirmaHint').style.display = 'none';
    _entFirmoAlgo = true;
  }
  function draw(e) {
    if (!_entDrawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(_entLastX, _entLastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    _entLastX = p.x; _entLastY = p.y;
  }
  function stopDraw() { _entDrawing = false; }

  canvas.addEventListener('mousedown',  startDraw);
  canvas.addEventListener('mousemove',  draw);
  canvas.addEventListener('mouseup',    stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove',  draw,      { passive: false });
  canvas.addEventListener('touchend',   stopDraw);
}

function _ent_showError(msg) {
  const el = document.getElementById('entError');
  el.textContent = msg;
  el.style.display = 'block';
}

async function ord_confirmarEntrega() {
  const nombre   = document.getElementById('entNombre').value.trim();
  const telefono = document.getElementById('entTelefono').value.trim();
  const cedula   = document.getElementById('entCedula').value.trim();
  document.getElementById('entError').style.display = 'none';

  if (!nombre)    { _ent_showError('El nombre de quien recoge es obligatorio.'); document.getElementById('entNombre').focus(); return; }
  if (!telefono)  { _ent_showError('El teléfono de quien recoge es obligatorio.'); document.getElementById('entTelefono').focus(); return; }
  if (!_entFirmoAlgo) { _ent_showError('La firma es obligatoria. Por favor firme en el recuadro.'); return; }

  const btn = document.getElementById('entBtnConfirmar');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    const canvas = document.getElementById('entFirmaCanvas');
    const firmaBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    const fd = new FormData();
    fd.append('entrega_nombre',   nombre);
    fd.append('entrega_telefono', telefono);
    if (cedula) fd.append('entrega_cedula', cedula);
    fd.append('firma', firmaBlob, 'firma.png');

    const r = await fetch(`${API}/orders/equipment/${_entUid}/entregar`, { method: 'POST', body: fd });
    const d = await r.json();

    if (d.success) {
      document.getElementById('entregaOverlay').style.display = 'none';
      // Actualizar badge y selector en la UI
      const badge = document.getElementById(`badge-${_entUid}`);
      if (badge) { badge.className = 'badge b-entregada'; badge.textContent = 'Entregada'; }
      if (_entSel) { _entSel.value = 'entregada'; _entSel.dataset.prev = 'entregada'; _entSel.disabled = false; }
      showToast('✅ Entrega registrada — WA enviado al cliente');
      // Recargar detalle para mostrar datos y firma
      if (_entUidOrden) ord_verDetalle(_entUidOrden);
      _entUid = _entUidOrden = _entSel = _entPrev = null;
    } else {
      _ent_showError(d.error || 'Error registrando la entrega');
      btn.disabled = false;
      btn.textContent = '✅ Confirmar entrega';
    }
  } catch(e) {
    _ent_showError('Error de conexión: ' + e.message);
    btn.disabled = false;
    btn.textContent = '✅ Confirmar entrega';
  }
}
