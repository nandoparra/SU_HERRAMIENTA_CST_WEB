async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btnLogin');
  const err = document.getElementById('errorMsg');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Ingresando...';

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (data.success) {
      window.location.href = data.redirect;
    } else {
      err.textContent = data.error || 'Error al ingresar';
      err.style.display = 'block';
    }
  } catch(e) {
    err.textContent = 'Error de conexión';
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}
