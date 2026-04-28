const stepEmail = document.getElementById('step-email');
const stepCode = document.getElementById('step-code');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');

let loginEmail = '';

function showError(msg) { errorEl.textContent = msg; errorEl.classList.add('show'); successEl.classList.remove('show'); }
function showSuccess(msg) { successEl.textContent = msg; successEl.classList.add('show'); errorEl.classList.remove('show'); }
function clearMessages() { errorEl.classList.remove('show'); successEl.classList.remove('show'); }

stepEmail.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessages();
  const btn = stepEmail.querySelector('button');
  loginEmail = document.getElementById('email').value.trim();
  if (!loginEmail) return;

  btn.disabled = true;
  btn.textContent = 'Code wird gesendet...';

  try {
    const res = await fetch('/api/auth/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Code konnte nicht gesendet werden');
    stepEmail.style.display = 'none';
    stepCode.style.display = '';
    showSuccess(`Code wurde an ${loginEmail} gesendet.`);
    document.getElementById('code').focus();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Code senden';
  }
});

stepCode.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessages();
  const btn = stepCode.querySelector('button');
  const code = document.getElementById('code').value.trim();
  if (!code) return;

  btn.disabled = true;
  btn.textContent = 'Wird überprüft...';

  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Anmeldung fehlgeschlagen');
    if (data.token) localStorage.setItem('invoice_hub_token', data.token);
    window.location.href = '/';
  } catch (err) {
    showError(err.message);
    document.getElementById('code').value = '';
    document.getElementById('code').focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
});

document.getElementById('back-to-email').addEventListener('click', (e) => {
  e.preventDefault();
  clearMessages();
  stepCode.style.display = 'none';
  stepEmail.style.display = '';
  document.getElementById('email').focus();
});
