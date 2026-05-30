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
  settings: null,
  dashboardYear: 'all', // 'all' o anno (numero) per filtrare l'archivio
  invoices: [],
  importPreview: null,
  importMapping: null,   // { canonicalKey: csvHeader }
  importHeaders: null,   // [csvHeader, ...]
  importFields: null,    // [{key,label,section,required}, ...]
  importSampleRows: null,
  importNumberFormat: 'dot', // 'dot' = punto decimale (default); 'comma' = virgola decimale
  importStartNumber: '',     // numero di partenza per la numerazione batch ('' = usa contatore corrente)
  importUseInvoiceYear: true,
  importSortByDate: true,
};

function handleAuthError(res) {
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Sessione scaduta');
  }
}

const api = {
  async json(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    handleAuthError(res);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Errore richiesta');
    }
    return res.json();
  },
  async form(url, formData, method = 'POST') {
    const res = await fetch(url, { method, body: formData });
    handleAuthError(res);
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
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value == null ? '' : value;
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
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
    else v = el.value;
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

async function loadSettings(force = false) {
  if (state.settings && !force) return state.settings;
  try {
    state.settings = await api.json('/api/settings');
  } catch (_) {
    state.settings = {};
  }
  applySenzaIvaClass();
  return state.settings;
}

function isSenzaIva() {
  return !!state.settings?.fatturazione?.senzaIva;
}

function applySenzaIvaClass() {
  document.body.classList.toggle('senza-iva', isSenzaIva());
}

// ========== Dashboard ==========
function yearOfInvoice(inv) {
  const s = inv.data || '';
  const m = /^(\d{4})/.exec(s);
  if (m) return parseInt(m[1], 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}

function renderYearTabs(list) {
  const tabsEl = $('#invoices-year-tabs');
  if (!tabsEl) return;
  const years = Array.from(
    new Set(list.map((i) => yearOfInvoice(i)).filter(Boolean))
  ).sort((a, b) => b - a);
  if (!years.length) { tabsEl.innerHTML = ''; return; }
  const sel = state.dashboardYear;
  const chips = [
    `<button class="year-chip${sel === 'all' ? ' active' : ''}" data-year="all">Tutte<span class="count">${list.length}</span></button>`,
  ].concat(
    years.map((y) => {
      const n = list.filter((i) => yearOfInvoice(i) === y).length;
      const active = String(sel) === String(y) ? ' active' : '';
      return `<button class="year-chip${active}" data-year="${y}">${y}<span class="count">${n}</span></button>`;
    })
  );
  tabsEl.innerHTML = chips.join('');
  tabsEl.onclick = (e) => {
    const btn = e.target.closest('.year-chip');
    if (!btn) return;
    const y = btn.dataset.year;
    state.dashboardYear = y === 'all' ? 'all' : parseInt(y, 10);
    renderDashboardRows();
  };
}

function renderDashboardRows() {
  const all = state.invoices;
  renderYearTabs(all);
  const list = filteredInvoices();
  updateInvoicesStats(list);
  const tbody = $('#invoices-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">${all.length ? "Nessuna fattura per l'anno selezionato." : 'Nessuna fattura.'}</td></tr>`;
    $('#invoices-tfoot').innerHTML = '';
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
        <button class="btn" data-email="${inv.id}" data-email-to="${escapeAttr(inv.cliente?.email || '')}">Invia email</button>
        <button class="btn" data-edit="${inv.id}">Modifica</button>
        <button class="btn danger" data-del="${inv.id}">Elimina</button>
      </td>`;
    tbody.appendChild(tr);
  });
  const totaleList = list.reduce((s, i) => s + (Number(i.totali?.totale) || 0), 0);
  $('#invoices-tfoot').innerHTML = `
    <tr class="total-row">
      <td colspan="4" class="right"><strong>Totale (${list.length} fatture)</strong></td>
      <td class="right"><strong>${EUR(totaleList)}</strong></td>
      <td></td>
    </tr>`;
}

function filteredInvoices() {
  if (state.dashboardYear === 'all') return state.invoices;
  return state.invoices.filter((i) => yearOfInvoice(i) === state.dashboardYear);
}

async function renderDashboard() {
  $('[data-action="new"]').onclick = () => {
    state.editing = null;
    state.righe = [emptyRiga()];
    setView('nuova');
  };
  const tbody = $('#invoices-tbody');
  tbody.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const pdf = btn.dataset.pdf;
    const edit = btn.dataset.edit;
    const del = btn.dataset.del;
    const email = btn.dataset.email;
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
    if (email) {
      const defaultTo = btn.dataset.emailTo || '';
      const to = prompt('Inviare la fattura a:', defaultTo);
      if (!to) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Invio…';
      try {
        await api.json(`/api/invoices/${email}/send-email`, {
          method: 'POST',
          body: JSON.stringify({ to }),
        });
        toast(`Fattura inviata a ${to}`, 'ok');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  };
  try {
    await loadSettings();
    state.invoices = await api.json('/api/invoices');
    renderDashboardRows();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">Errore: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function updateInvoicesStats(list) {
  const tot = list.reduce(
    (acc, inv) => {
      acc.imponibile += Number(inv.totali?.imponibile) || 0;
      acc.iva += Number(inv.totali?.iva) || 0;
      acc.totale += Number(inv.totali?.totale) || 0;
      return acc;
    },
    { imponibile: 0, iva: 0, totale: 0 }
  );
  const set = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val;
  };
  set('#stat-count', String(list.length));
  set('#stat-imponibile', EUR(tot.imponibile));
  set('#stat-iva', EUR(tot.iva));
  set('#stat-totale', EUR(tot.totale));
}

// ========== Nuova / Modifica ==========
function emptyRiga() {
  const senza = isSenzaIva();
  const def = state.settings?.fatturazione?.aliquotaIvaDefault;
  return {
    descrizione: '',
    codice: '',
    unitaMisura: 'pz',
    quantita: 1,
    prezzoUnitario: 0,
    aliquotaIva: senza ? 0 : (def != null && def !== '' ? Number(def) : 22),
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
      <td data-iva><input data-idx="${idx}" data-field="aliquotaIva" type="number" step="0.01" value="${r.aliquotaIva}" style="width:70px"/></td>
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
  state.importPreview = null;
  state.importMapping = null;
  state.importHeaders = null;
  state.importFields = null;
  state.importSampleRows = null;
  state.importNumberFormat = 'dot';
  state.importStartNumber = '';
  state.importUseInvoiceYear = true;
  state.importSortByDate = true;
  const fileInput = $('#import-file');

  $('#btn-load-headers').onclick = async () => {
    if (!fileInput.files[0]) return toast('Seleziona un file', 'err');
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
      const res = await api.form('/api/import/headers', fd);
      state.importHeaders = res.headers || [];
      state.importFields = res.fields || [];
      state.importMapping = { ...(res.suggestedMapping || {}) };
      state.importSampleRows = res.sampleRows || [];
      state.importPreview = null;
      renderImportMapping();
      renderImportPreview();
      const auto = Object.keys(res.suggestedMapping || {}).length;
      toast(`Trovate ${state.importHeaders.length} colonne (${auto} mappate automaticamente)`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

function renderImportMapping() {
  const root = $('#import-mapping');
  if (!state.importHeaders || !state.importFields) {
    root.innerHTML = '';
    return;
  }
  const sampleFor = (header) => {
    const sample = (state.importSampleRows || [])
      .map((r) => r[header])
      .filter((v) => v !== '' && v != null)
      .slice(0, 1)[0];
    return sample == null ? '' : ` — es. "${String(sample).slice(0, 30)}"`;
  };
  const headerOptions = ['<option value="">— non mappata —</option>']
    .concat(
      state.importHeaders.map(
        (h) => `<option value="${escapeAttr(h)}">${escapeHtml(h)}${escapeHtml(sampleFor(h))}</option>`
      )
    )
    .join('');

  const sections = {};
  state.importFields.forEach((f) => {
    sections[f.section] = sections[f.section] || [];
    sections[f.section].push(f);
  });

  const sectionsHtml = Object.entries(sections)
    .map(([section, fields]) => {
      const rows = fields
        .map((f) => {
          const current = state.importMapping[f.key] || '';
          // Re-render the options with the right one selected
          const opts = ['<option value="">— non mappata —</option>']
            .concat(
              state.importHeaders.map((h) => {
                const sel = h === current ? ' selected' : '';
                return `<option value="${escapeAttr(h)}"${sel}>${escapeHtml(h)}${escapeHtml(sampleFor(h))}</option>`;
              })
            )
            .join('');
          const req = f.required ? '<span class="req" title="obbligatorio">*</span>' : '';
          return `
            <tr>
              <td><label>${escapeHtml(f.label)} ${req}</label></td>
              <td>
                <select data-map-field="${escapeAttr(f.key)}">${opts}</select>
              </td>
            </tr>`;
        })
        .join('');
      return `
        <h4>${escapeHtml(section)}</h4>
        <table class="table mapping-table">
          <thead><tr><th>Campo fattura</th><th>Colonna nel file</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('');

  const fmt = state.importNumberFormat || 'dot';
  const fmtOptions = `
    <option value="dot"${fmt === 'dot' ? ' selected' : ''}>Punto come decimale — es. 365.34 → € 365,34 (default)</option>
    <option value="comma"${fmt === 'comma' ? ' selected' : ''}>Virgola come decimale (stile italiano) — es. 1.234,56 → € 1.234,56</option>
  `;

  root.innerHTML = `
    <div class="card">
      <div class="row-between">
        <h3>Mappatura colonne</h3>
        <div class="btn-group">
          <button class="btn" id="btn-mapping-reset">Ripristina suggerite</button>
          <button class="btn primary" id="btn-mapping-preview">Genera anteprima</button>
        </div>
      </div>
      <p class="muted">Associa ogni colonna del file al campo della fattura. Le voci marcate <span class="req">*</span> sono necessarie per generare almeno una fattura.</p>

      <div class="grid two" style="margin-bottom:14px;">
        <label>
          Formato numerico (per prezzi, quantità, IVA, sconto)
          <select id="import-number-format">${fmtOptions}</select>
        </label>
        <label>
          Numero di partenza per la numerazione
          <input id="import-start-number" type="number" min="1" placeholder="lascia vuoto = usa contatore corrente" value="${escapeAttr(state.importStartNumber || '')}" />
        </label>
        <label class="checkbox">
          <input type="checkbox" id="import-use-invoice-year" ${state.importUseInvoiceYear ? 'checked' : ''} />
          Usa l'anno della fattura nel numero (es. 2024-0001 per fatture del 2024)
        </label>
        <label class="checkbox">
          <input type="checkbox" id="import-sort-by-date" ${state.importSortByDate ? 'checked' : ''} />
          Ordina per data crescente prima di numerare
        </label>
      </div>

      ${sectionsHtml}
    </div>`;

  root.querySelectorAll('select[data-map-field]').forEach((sel) => {
    sel.onchange = () => {
      const key = sel.dataset.mapField;
      const val = sel.value;
      if (val) state.importMapping[key] = val;
      else delete state.importMapping[key];
    };
  });

  $('#import-number-format').onchange = (e) => {
    state.importNumberFormat = e.target.value === 'comma' ? 'comma' : 'dot';
  };
  $('#import-start-number').oninput = (e) => {
    state.importStartNumber = e.target.value;
  };
  $('#import-use-invoice-year').onchange = (e) => {
    state.importUseInvoiceYear = e.target.checked;
  };
  $('#import-sort-by-date').onchange = (e) => {
    state.importSortByDate = e.target.checked;
  };

  $('#btn-mapping-reset').onclick = async () => {
    const fd = new FormData();
    fd.append('file', $('#import-file').files[0]);
    try {
      const res = await api.form('/api/import/headers', fd);
      state.importMapping = { ...(res.suggestedMapping || {}) };
      renderImportMapping();
      toast('Mappatura suggerita ripristinata', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };

  $('#btn-mapping-preview').onclick = runImportPreview;
}

async function runImportPreview() {
  const file = $('#import-file').files[0];
  if (!file) return toast('Seleziona un file', 'err');
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mapping', JSON.stringify(state.importMapping || {}));
  fd.append('numberFormat', state.importNumberFormat || 'dot');
  if (state.importStartNumber) fd.append('startNumber', String(state.importStartNumber));
  fd.append('useInvoiceYear', state.importUseInvoiceYear ? 'true' : 'false');
  fd.append('sortByDate', state.importSortByDate ? 'true' : 'false');
  try {
    const res = await api.form('/api/import/preview', fd);
    state.importPreview = res;
    renderImportPreview();
    if (!res.count) {
      toast('Nessuna fattura trovata: verifica la mappatura dei campi obbligatori', 'err');
    } else {
      toast(`Trovate ${res.count} fattura/e`, 'ok');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runImportCommit() {
  const file = $('#import-file').files[0];
  if (!file) return toast('Seleziona un file', 'err');
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mapping', JSON.stringify(state.importMapping || {}));
  fd.append('numberFormat', state.importNumberFormat || 'dot');
  if (state.importStartNumber) fd.append('startNumber', String(state.importStartNumber));
  fd.append('useInvoiceYear', state.importUseInvoiceYear ? 'true' : 'false');
  fd.append('sortByDate', state.importSortByDate ? 'true' : 'false');
  try {
    const res = await api.form('/api/import/commit', fd);
    toast(`Salvate ${res.count} fattura/e`, 'ok');
    setView('dashboard');
  } catch (err) {
    toast(err.message, 'err');
  }
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
      <div class="row-between">
        <h3>Anteprima import (${data.count})</h3>
        <button class="btn primary" id="btn-commit-import" ${data.count ? '' : 'disabled'}>Importa e salva</button>
      </div>
      <table class="table">
        <thead><tr><th>Numero</th><th>Data</th><th>Cliente</th><th>Righe</th><th class="right">Totale</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  const commitBtn = $('#btn-commit-import');
  if (commitBtn) commitBtn.onclick = runImportCommit;
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
      const saved = await api.json('/api/settings', { method: 'PUT', body: JSON.stringify(values) });
      state.settings = saved;
      applySenzaIvaClass();
      toast('Impostazioni salvate', 'ok');
      if (confirm('Vuoi rigenerare i PDF di tutte le fatture esistenti con i nuovi dati aziendali?')) {
        await regenerateAllPdfs();
      }
    } catch (err) { toast(err.message, 'err'); }
  };

  $('#btn-regen-pdfs').onclick = async () => {
    if (!confirm('Rigenero i PDF di tutte le fatture salvate usando i dati aziendali correnti?')) return;
    await regenerateAllPdfs();
  };
}

async function regenerateAllPdfs() {
  const btn = $('#btn-regen-pdfs');
  const original = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Rigenero…'; }
  try {
    const res = await api.json('/api/invoices/regenerate-pdfs', { method: 'POST' });
    const errs = res.errors?.length || 0;
    const msg = errs
      ? `Rigenerate ${res.regenerated}/${res.total} fatture (${errs} errori)`
      : `Rigenerate ${res.regenerated}/${res.total} fatture`;
    toast(msg, errs ? 'err' : 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
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

// ========== Auth ==========
async function checkAuth() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/login.html';
    return null;
  }
  return res.json();
}

async function doLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
}

// ========== Bootstrap ==========
document.addEventListener('DOMContentLoaded', async () => {
  const me = await checkAuth();
  if (!me) return;
  const chip = $('#user-chip');
  if (chip) chip.textContent = me.username;
  const logoutBtn = $('#btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
  $$('.tab[data-view]').forEach((t) =>
    t.addEventListener('click', () => setView(t.dataset.view))
  );
  await loadSettings();
  render();
});
