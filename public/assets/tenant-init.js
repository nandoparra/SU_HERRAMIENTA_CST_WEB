/**
 * tenant-init.js — Aplica branding dinámico del tenant activo.
 * Incluir en el <head> de todas las páginas internas y públicas.
 * Falla silenciosamente si el servidor no responde (usa defaults del CSS).
 */
(async function () {
  try {
    const r = await fetch('/api/tenant/config');
    if (!r.ok) return;
    const d = await r.json();

    const root = document.documentElement;

    // Aplicar variables CSS de color
    if (d.colorPrimary) {
      root.style.setProperty('--color-primary', d.colorPrimary);
      // dashboard.html usa --dark; mantener sincronizado
      root.style.setProperty('--dark', d.colorPrimary);
    }
    if (d.colorAccent) {
      root.style.setProperty('--color-accent', d.colorAccent);
    }

    // Actualizar logo en páginas que usan .logo-wrap img
    if (d.logo) {
      document.querySelectorAll('.logo-wrap img, [data-tenant-logo]').forEach(img => {
        img.src = d.logo;
      });
    }

    // Actualizar nombre del tenant en elementos marcados
    if (d.nombre) {
      document.querySelectorAll('[data-tenant-name]').forEach(el => {
        // Preservar texto posterior (ej: "<br><span>Seguimiento</span>")
        const inner = el.innerHTML;
        const brIdx = inner.indexOf('<br');
        if (brIdx !== -1) {
          el.innerHTML = d.nombre + inner.slice(brIdx);
        } else {
          el.textContent = d.nombre;
        }
      });

      // Actualizar <title> de la página
      if (document.title.includes('SU HERRAMIENTA CST')) {
        document.title = document.title.replace('SU HERRAMIENTA CST', d.nombre);
      }
    }
  } catch (_) {
    // Error de red o JSON inválido — los defaults del CSS siguen activos
  }
})();
