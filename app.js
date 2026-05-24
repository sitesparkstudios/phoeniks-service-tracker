/* ============================================================
   app.js — UI routing, CRUD, form handling, toast, confirm
   ============================================================ */

/* ── PAGE ROUTING ── */
const PAGE_TITLES = {
  dashboard:  'Dashboard',
  activity:   'Weekly Activity',
  bottleneck: 'Bottleneck Report',
  jobs:       'All Jobs',
  parts:      'Parts Tracker',
  suppliers:  'Suppliers',
  reports:    'Meeting Reports',
  import:     'Odoo Import',
  add:        'Add / Edit Job',
};

const NAV_ORDER = ['dashboard','activity','bottleneck','jobs','parts','suppliers','reports','import','add'];

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    n.classList.toggle('active', NAV_ORDER[i] === name);
  });
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[name] || name;

  if (name === 'dashboard')  renderDashboard();
  if (name === 'activity')   renderActivity();
  if (name === 'bottleneck') renderBottleneck();
  if (name === 'jobs')       { renderJobs(); populateSupplierDatalist(); }
  if (name === 'parts')      renderParts();
  if (name === 'suppliers')  renderSuppliers();
  if (name === 'reports')    renderReports();
  if (name === 'add')        populateSupplierDatalist();
}

function populateSupplierDatalist() {
  const dl = document.getElementById('supplier-datalist');
  if (!dl) return;
  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  dl.innerHTML = suppliers.map(s => `<option value="${esc(s)}">`).join('');
}

/* ── CRUD ── */
function saveJob() {
  const po      = document.getElementById('f-po').value.trim();
  const supplier= document.getElementById('f-supplier').value.trim();
  const poDate  = document.getElementById('f-po-date').value;
  const status  = document.getElementById('f-status').value;
  const notes   = document.getElementById('f-notes').value.trim();
  const ref     = document.getElementById('f-ref').value.trim();
  const equip   = document.getElementById('f-equipment').value.trim();
  const value   = document.getElementById('f-value').value.trim();
  const buyer   = document.getElementById('f-buyer').value.trim();
  const chatter = document.getElementById('f-chatter').value;

  const msgEl = document.getElementById('form-validation-msg');
  if (!po || !supplier || !poDate) {
    msgEl.textContent   = 'PO number, supplier and PO date are required.';
    msgEl.style.display = 'block';
    return;
  }
  msgEl.style.display = 'none';

  const { transitions, notes: cn } = parseChatter(chatter);
  const allNotes = [notes, ...cn.map(n => n.text)].filter(Boolean).join('\n');

  if (editingId) {
    const j = jobs.find(x => x.id === editingId);
    if (j) {
      j.po = po; j.supplier = supplier; j.ref = ref; j.equipment = equip;
      j.poDate = poDate; j.notes = allNotes; j.value = value; j.buyer = buyer;
      if (transitions.length) {
        j.history = buildHistoryFromTransitions(poDate, transitions);
        j.status  = j.history[j.history.length-1].status;
      } else if (j.status !== status) {
        if (!j.history || !j.history.length) j.history = [{ status: j.status, date: j.poDate }];
        j.history.push({ status, date: today() });
        j.status = status;
      } else {
        j.status = status;
      }
    }
    editingId = null;
  } else {
    jobs.push({
      id:        'j' + Date.now(),
      po, supplier, ref, equipment: equip, poDate,
      notes: allNotes, value, buyer,
      addedDate: today(),
      status:    transitions.length ? transitions[transitions.length-1].to : status,
      history:   transitions.length ? buildHistoryFromTransitions(poDate, transitions) : [{ status, date: poDate }],
    });
  }

  saveData();
  clearForm();
  showToast('Job saved');
  showPage('jobs');
}

function editJob(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  editingId = id;
  closeModal();
  showPage('add');
  document.getElementById('form-page-title').textContent  = 'Edit Job — ' + j.po;
  document.getElementById('save-btn-label').textContent   = 'Save changes';
  document.getElementById('f-po').value        = j.po;
  document.getElementById('f-supplier').value  = j.supplier;
  document.getElementById('f-ref').value       = j.ref       || '';
  document.getElementById('f-equipment').value = j.equipment || '';
  document.getElementById('f-po-date').value   = j.poDate    || '';
  document.getElementById('f-status').value    = j.status;
  document.getElementById('f-notes').value     = j.notes     || '';
  document.getElementById('f-value').value     = j.value     || '';
  document.getElementById('f-buyer').value     = j.buyer     || '';
  document.getElementById('f-chatter').value   = '';
  document.getElementById('chatter-preview-box').innerHTML = '';
  document.getElementById('chatter-parse-status').textContent = '';
}

function clearForm() {
  editingId = null;
  document.getElementById('form-page-title').textContent = 'Add New Job';
  document.getElementById('save-btn-label').textContent  = 'Save job';
  document.getElementById('form-validation-msg').style.display = 'none';
  ['f-po','f-supplier','f-ref','f-equipment','f-notes','f-chatter','f-value','f-buyer']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-po-date').value = '';
  document.getElementById('f-status').value  = 'Incoming Job';
  document.getElementById('chatter-preview-box').innerHTML = '';
  document.getElementById('chatter-parse-status').textContent = '';
}

async function deleteJob(id) {
  const confirmed = await showConfirm('Delete this job?', 'This action cannot be undone.');
  if (!confirmed) return;
  jobs = jobs.filter(j => j.id !== id);
  delete partsData[id];
  saveData();
  savePartsData();
  closeModal();
  renderJobs();
  renderDashboard();
  showToast('Job deleted');
}

/* ── TOAST ── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

/* ── CONFIRM DIALOG ── */
function showConfirm(title, msg, okLabel = 'Delete') {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent  = title;
    document.getElementById('confirm-msg').textContent    = msg;
    document.getElementById('confirm-ok-btn').textContent = okLabel;
    document.getElementById('confirm-overlay').classList.remove('hidden');
    confirmCallback = resolve;
  });
}

function confirmResolve(val) {
  document.getElementById('confirm-overlay').classList.add('hidden');
  if (confirmCallback) { confirmCallback(val); confirmCallback = null; }
}

/* ── KEYBOARD SHORTCUTS ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeMeeting();
    document.getElementById('confirm-overlay').classList.add('hidden');
  }
  if (document.getElementById('meeting-overlay').classList.contains('active')) {
    if (e.key === 'ArrowRight') meetingNext();
    if (e.key === 'ArrowLeft')  meetingPrev();
  }
});

/* ── SIDEBAR DATE — shows day + date ── */
function updateSidebarDate() {
  const el = document.getElementById('sidebar-date-display');
  if (!el) return;
  const now  = new Date();
  const day  = now.toLocaleDateString('en-AU', { weekday: 'long' });
  const date = now.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  el.innerHTML = `<span style="color:rgba(255,255,255,0.5);font-weight:600">${day}</span> <span>${date}</span>`;
}

/* ── INIT ── */
loadData();
updateSidebarDate();
renderDashboard();

/* Reset localStorage to load demo data if needed */
function resetToDemo() {
  localStorage.removeItem('phoeniks_tracker_v2');
  localStorage.removeItem('phoeniks_parts_v1');
  localStorage.removeItem('phoeniks_reports_v1');
  location.reload();
}
