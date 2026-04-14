'use strict';

(function () {
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    const fd = new FormData(form);
    const payload = {
      username: fd.get('username'),
      password: fd.get('password'),
    };
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Accesso in corso…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Errore' }));
        throw new Error(err.error || 'Credenziali non valide');
      }
      window.location.href = '/';
    } catch (err) {
      errorBox.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Accedi';
    }
  });
})();
