/* global fetch */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const EUR = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

const state = {
  view: 'dashboard',
  editing: null, // invoice under edit
  righe: [],
  importPreview: null,
};

const api = {
  async json(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Errore richiesta');
    }
    return res.json();
  },
  async form(url, formData, method = 'POST') {
    const res = await fetch(url, { method, body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Errore richiesta');
    }
    return res.json();
  },
};

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  setTimeout(() => t.classList.add('hidden'), 4000);
}

function setView(name) {
  state.view = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  render();
}

function setFormValue(root, name, value) {
  const el = $(`[name="${name}"]`, root);
  if (el) el.value = value == null ? '' : value;
}

function getFormValues(root) {
  const out = {};
  $$('input[name], textarea[name], select[name]', root).forEach((el) => {
    const keys = el.name.split('.');
    let cur = out;
    for (let i = 0; i < keys.length - 1; i++) {
      cur[keys[i]] = cur[keys[i]] || {};
      cur = cur[keys[i]];
    }
    const k = keys[keys.length - 1];
    const v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    cur[k] = v;
  });
  return out;
}

function render() {
  const app = $('#app');
  app.innerHTML = '';
  const tpl = $(`#tpl-${state.view}`);
  if (!tpl) return;
  app.appendChild(tpl.content.cloneNode(true));

  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'nuova') renderNuova();
  if (state.view === 'import') renderImport();
  if (state.view === 'woocommerce') renderWoo();
  if (state.view === 'impostazioni') renderSettings();
}

// ========== Dashboard ==========
async function renderDashboard() {
  $('[data-action="new"]').onclick = () => {
    state.editing = null;
    state.righe = [emptyRiga()];
    setView('nuova');
  };
  const tbody = $('#invoices-tbody');
  try {
    const list = await api.json('/api/invoices');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted center">Nessuna fattura. Crea la prima dal pulsante in alto.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    list.forEach((inv) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(inv.numero || '-')}</strong></td>
        <td>${formatDate(inv.data)}</td>
        <td>${escapeHtml(inv.cliente?.ragioneSociale || '-')}</td>
        <td><span class="badge">${escapeHtml(inv.origine || 'manuale')}</span></td>
        <td class="right">${EUR(inv.totali?.totale)}</td>
        <td class="right">
          <button class="btn" data-pdf="${inv.id}">PDF</button>
          <button class="btn" data-edit="${inv.id}">Modifica</button>
          <button class="btn danger" data-del="${inv.id}">Elimina</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const pdf = e.target.dataset.pdf;
      const edit = e.target.dataset.edit;
      const del = e.target.dataset.del;
      if (pdf) window.open(`/api/invoices/${pdf}/pdf`, '_blank');
      if (edit) {
        const inv = await api.json(`/api/invoices/${edit}`);
        state.editing = inv;
        state.righe = inv.righe.length ? [...inv.righe] : [emptyRiga()];
        setView('nuova');
      }
      if (del) {
        if (!confirm('Eliminare la fattura?')) return;
        await fetch(`/api/invoices/${del}`, { method: 'DELETE' });
        toast('Fattura eliminata', 'ok');
        renderDashboard();
      }
    };
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">Errore: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ========== Nuova / Modifica ==========
function emptyRiga() {
  return {
    descrizione: '',
    codice: '',
    unitaMisura: 'pz',
    quantita: 1,
    prezzoUnitario: 0,
    aliquotaIva: 22,
    scontoPct: 0,
  };
}

async function renderNuova() {
  const root = $('.view');
  if (state.editing) {
    $('#form-title').textContent = `Modifica fattura ${state.editing.numero}`;
    const inv = state.editing;
    setFormValue(root, 'numero', inv.numero);
    setFormValue(root, 'data', inv.data);
    setFormValue(root, 'scadenza', inv.scadenza);
    setFormValue(root, 'metodoPagamento', inv.metodoPagamento);
    setFormValue(root, 'note', inv.note);
    Object.entries(inv.cliente || {}).forEach(([k, v]) =>
      setFormValue(root, `cliente.${k}`, v)
    );
  } else {
    try {
      const { numero } = await api.json('/api/invoices/next-number');
      const settings = await api.json('/api/settings');
      $('[name="numero"]').placeholder = numero;
      $('[name="data"]').value = new Date().toISOString().slice(0, 10);
      $('[name="metodoPagamento"]').value = 'Bonifico bancario';
      $('[name="note"]').value = settings.fatturazione?.noteDefault || '';
    } catch (err) { toast(err.message, 'err'); }
  }

  if (!state.righe.length) state.righe = [emptyRiga()];
  renderRighe();

  $('[data-action="add-row"]').onclick = () => {
    state.righe.push(emptyRiga());
    renderRighe();
  };
  $('[data-action="save"]').onclick = saveInvoice;
  $('[data-action="preview"]').onclick = previewInvoicePDF;
}

function renderRighe() {
  const tbody = $('#righe-tbody');
  tbody.innerHTML = '';
  state.righe.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-idx="${idx}" data-field="descrizione" value="${escapeAttr(r.descrizione)}" /></td>
      <td><input data-idx="${idx}" data-field="codice" value="${escapeAttr(r.codice || '')}" /></td>
      <td><input data-idx="${idx}" data-field="unitaMisura" value="${escapeAttr(r.unitaMisura || 'pz')}" style="width:60px"/></td>
      <td><input data-idx="${idx}" data-field="quantita" type="number" step="any" value="${r.quantita}" style="width:70px"/></td>
      <td><input data-idx="${idx}" data-field="prezzoUnitario" type="number" step="0.01" value="${r.prezzoUnitario}" style="width:90px"/></td>
      <td><input data-idx="${idx}" data-field="scontoPct" type="number" step="0.01" value="${r.scontoPct || 0}" style="width:70px"/></td>
      <td><input data-idx="${idx}" data-field="aliquotaIva" type="number" step="0.01" value="${r.aliquotaIva}" style="width:70px"/></td>
      <td class="right" data-total="${idx}">—</td>
      <td><button class="btn danger" data-del-row="${idx}">×</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.oninput = (e) => {
    const idx = Number(e.target.dataset.idx);
    const field = e.target.dataset.field;
    if (field == null) return;
    const val = e.target.type === 'number' ? Number(e.target.value) || 0 : e.target.value;
    state.righe[idx][field] = val;
    recalcTotals();
  };
  tbody.onclick = (e) => {
    const del = e.target.dataset.delRow;
    if (del != null) {
      state.righe.splice(Number(del), 1);
      if (!state.righe.length) state.righe.push(emptyRiga());
      renderRighe();
    }
  };
  recalcTotals();
}

function recalcTotals() {
  let imp = 0, iva = 0;
  state.righe.forEach((r, idx) => {
    const qta = Number(r.quantita) || 0;
    const prezzo = Number(r.prezzoUnitario) || 0;
    const scontoPct = Number(r.scontoPct) || 0;
    const aliq = Number(r.aliquotaIva) || 0;
    const lordo = qta * prezzo;
    const sconto = lordo * (scontoPct / 100);
    const imponibile = lordo - sconto;
    const ivaRiga = imponibile * (aliq / 100);
    imp += imponibile;
    iva += ivaRiga;
    const tot = imponibile + ivaRiga;
    const cell = document.querySelector(`[data-total="${idx}"]`);
    if (cell) cell.textContent = EUR(tot);
  });
  $('#t-imponibile').textContent = EUR(imp);
  $('#t-iva').textContent = EUR(iva);
  $('#t-totale').textContent = EUR(imp + iva);
}

function collectInvoiceFromForm() {
  const root = $('.view');
  const values = getFormValues(root);
  return { ...values, righe: state.righe };
}

async function saveInvoice() {
  try {
    const payload = collectInvoiceFromForm();
    let saved;
    if (state.editing?.id) {
      saved = await api.json(`/api/invoices/${state.editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      saved = await api.json('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    toast(`Fattura ${saved.numero} salvata`, 'ok');
    window.open(`/api/invoices/${saved.id}/pdf`, '_blank');
    state.editing = null;
    state.righe = [];
    setView('dashboard');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function previewInvoicePDF() {
  try {
    const payload = collectInvoiceFromForm();
    const res = await fetch('/api/invoices/preview-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Impossibile generare l\'anteprima');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ========== Import ==========
function renderImport() {
  const fileInput = $('#import-file');
  $('#btn-preview-import').onclick = async () => {
    if (!fileInput.files[0]) return toast('Seleziona un file', 'err');
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
      const res = await api.form('/api/import/preview', fd);
      state.importPreview = res;
      renderImportPreview();
      $('#btn-commit-import').disabled = false;
      toast(`Trovate ${res.count} fattura/e`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  $('#btn-commit-import').onclick = async () => {
    if (!fileInput.files[0]) return;
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
      const res = await api.form('/api/import/commit', fd);
      toast(`Salvate ${res.count} fattura/e`, 'ok');
      setView('dashboard');
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

function renderImportPreview() {
  const root = $('#import-preview');
  const data = state.importPreview;
  if (!data) { root.innerHTML = ''; return; }
  const rows = data.invoices.map((inv) => `
    <tr>
      <td>${escapeHtml(inv.numero || '(auto)')}</td>
      <td>${formatDate(inv.data)}</td>
      <td>${escapeHtml(inv.cliente?.ragioneSociale || '-')}</td>
      <td>${inv.righe.length}</td>
      <td class="right">${EUR(inv.totali?.totale)}</td>
    </tr>
  `).join('');
  root.innerHTML = `
    <div class="card">
      <h3>Anteprima import (${data.count})</h3>
      <table class="table">
        <thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Righe</th><th class="right">Totale</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ========== WooCommerce ==========
function renderWoo() {
  $('#btn-wc-test').onclick = async () => {
    try {
      const res = await api.json('/api/woocommerce/test');
      toast(`Connessione OK${res.environment ? ' • ' + res.environment : ''}`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#btn-wc-load').onclick = loadWooOrders;
}

async function loadWooOrders() {
  const tbody = $('#wc-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="muted center">Caricamento…</td></tr>';
  try {
    const status = $('#wc-status').value;
    const search = $('#wc-search').value;
    const res = await api.json(`/api/woocommerce/orders?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&per_page=50`);
    if (!res.orders.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted center">Nessun ordine trovato.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    res.orders.forEach((o) => {
      const b = o.billing || {};
      const name = b.company || [b.first_name, b.last_name].filter(Boolean).join(' ') || 'Cliente';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${o.id}</strong><br><small class="muted">${escapeHtml(o.number || '')}</small></td>
        <td>${formatDate(o.date_created)}</td>
        <td>${escapeHtml(name)}<br><small class="muted">${escapeHtml(b.email || '')}</small></td>
        <td><span class="badge">${escapeHtml(o.status)}</span></td>
        <td class="right">${EUR(o.total)}</td>
        <td class="right"><button class="btn primary" data-wc-import="${o.id}">Importa</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const id = e.target.dataset.wcImport;
      if (!id) return;
      e.target.disabled = true;
      e.target.textContent = '…';
      try {
        const inv = await api.json(`/api/woocommerce/orders/${id}/import`, { method: 'POST' });
        toast(`Importata fattura ${inv.numero}`, 'ok');
        window.open(`/api/invoices/${inv.id}/pdf`, '_blank');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Importa';
      }
    };
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">Errore: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ========== Settings ==========
async function renderSettings() {
  const root = $('.view');
  try {
    const s = await api.json('/api/settings');
    Object.entries(s).forEach(([section, fields]) => {
      Object.entries(fields || {}).forEach(([k, v]) => setFormValue(root, `${section}.${k}`, v));
    });
  } catch (err) { toast(err.message, 'err'); }

  $('#btn-save-settings').onclick = async () => {
    try {
      const values = getFormValues(root);
      await api.json('/api/settings', { method: 'PUT', body: JSON.stringify(values) });
      toast('Impostazioni salvate', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ========== Utils ==========
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }
function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('it-IT');
}

// ========== Bootstrap ==========
document.addEventListener('DOMContentLoaded', () => {
  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  render();
});
