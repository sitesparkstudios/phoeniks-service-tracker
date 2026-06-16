/* ============================================================
   app.js — UI routing, CRUD, form handling, toast, confirm
   CHANGED FROM ORIGINAL:
   - saveJob() / deleteJob() are now async (await Supabase)
   - Removed resetToDemo() (Supabase doesn't use demo data)
   - init sequence awaits loadData()
   - last_page still uses localStorage (tiny UI pref, not data)
   - Auth modal wired up
   ============================================================ */

/* ── PAGE ROUTING ── */
const PAGE_TITLES = {
  dashboard:  'Dashboard',
  activity:   'Weekly Activity',
  urgent:     'Urgent — Jobs Needing Attention',
  bottleneck: 'Bottleneck Report',
  performance: 'Performance',
  jobs:       'All Jobs',
  parts:      'Parts Tracker',
  suppliers:  'Service Companies',
  reports:    'Meeting Reports',
  sites:      'Recurring Sites',
  'supplier-tags': 'Tag Service Companies',
  import:     'Odoo Import',
  add:        'Add / Edit Job',
  admin:      'Admin',
  audit:      'Audit Log',
};

const NAV_ORDER = ['dashboard','urgent','activity','bottleneck','performance','jobs','parts','suppliers','sites','reports','import','add','admin','audit'];

function toggleStatusDropdown() {
  const dd = document.getElementById('status-filter-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function statusFilterAll(cb) {
  document.querySelectorAll('.fs-cb').forEach(c => c.checked = cb.checked);
  updateStatusFilterLabel();
  renderJobs();
}

function statusFilterChange() {
  const cbs = document.querySelectorAll('.fs-cb');
  const allChecked = [...cbs].every(c => c.checked);
  const allCb = document.getElementById('fs-all');
  if (allCb) allCb.checked = allChecked;
  updateStatusFilterLabel();
  renderJobs();
}

function updateStatusFilterLabel() {
  const cbs = [...document.querySelectorAll('.fs-cb')];
  const checked = cbs.filter(c => c.checked);
  const label = document.getElementById('status-filter-label');
  if (!label) return;
  if (checked.length === 0) label.textContent = 'No statuses';
  else if (checked.length === cbs.length) label.textContent = 'All statuses';
  else if (checked.length === 1) label.textContent = checked[0].value;
  else label.textContent = checked.length + ' statuses';
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('status-filter-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('status-filter-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.toggle('open');
  if (ov) ov.classList.toggle('active');
}

function closeSidebar() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('active');
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    n.classList.toggle('active', NAV_ORDER[i] === name);
  });
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  // Always scroll to top when switching pages
  window.scrollTo(0, 0);
  // Close sidebar on mobile after navigation
  closeSidebar();
  const pageTitle = PAGE_TITLES[name] || name;
  document.getElementById('topbar-title').textContent = pageTitle;
  document.body.setAttribute('data-print-page', pageTitle);
  try { localStorage.setItem('phoeniks_last_page', name); } catch(e) {}

  if (name === 'dashboard')  { if (typeof initDashPeriodFilter === 'function') initDashPeriodFilter(); renderDashboard(); }
  if (name === 'activity')   renderActivity();
  if (name === 'urgent')     renderUrgent();
  if (name === 'bottleneck') { if (typeof initBottleneckFilter === 'function') initBottleneckFilter(); renderBottleneck(); }
  if (name === 'performance') renderPerformance();
  if (name === 'jobs')       { renderJobs(); renderChatterLog(); populateSupplierDatalist(); updateChatterBadge(); }
  if (name === 'parts')      renderParts();
  if (name === 'suppliers')  renderSuppliers();
  if (name === 'sites')      renderSites();
  if (name === 'supplier-tags') { renderSupplierTags(); }
  if (name === 'reports')    renderReports();
  if (name === 'import')     { renderLastImportStamp(); }
  if (name === 'add')        populateSupplierDatalist();
  if (name === 'admin')      renderAdmin();
  if (name === 'audit')      renderAudit();
}

/* ── NAV BADGES ── */
function updateNavBadges() {
  const openJobs  = jobs.filter(isOpenService).length;
  const waiting   = jobs.filter(j => j.status === 'Waiting for Parts').length;

  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); weekStart.setHours(0,0,0,0);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const doneThisWeek = jobs.filter(j => {
    if (j.status !== 'Job Done') return false;
    const last = j.history?.[j.history.length - 1];
    return last && last.date >= weekStartStr;
  }).length;

  const urgentCount = jobs.filter(j => isOpenService(j) && daysBetween(j.poDate, null) >= 21).length;

  const jobsBadge   = document.getElementById('nav-badge-jobs');
  const partsBadge  = document.getElementById('nav-badge-parts');
  const urgentBadge = document.getElementById('nav-badge-urgent');

  if (jobsBadge)   { jobsBadge.textContent   = openJobs || '';    jobsBadge.style.display   = openJobs   > 0 ? 'inline-block' : 'none'; }
  if (partsBadge)  { partsBadge.textContent  = waiting  || '';    partsBadge.style.display  = waiting    > 0 ? 'inline-block' : 'none'; }
  if (urgentBadge) { urgentBadge.textContent = urgentCount || ''; urgentBadge.style.display = urgentCount > 0 ? 'inline-block' : 'none'; }

  updateChatterBadge();

  const pulseOpen  = document.getElementById('pulse-open');
  const pulseParts = document.getElementById('pulse-parts');
  const pulseDone  = document.getElementById('pulse-done');
  const maintCount = jobs.filter(j => j.status === 'Maintenance').length;
  if (pulseOpen)  pulseOpen.textContent  = openJobs;
  if (pulseParts) pulseParts.textContent = waiting;
  if (pulseDone)  pulseDone.textContent  = doneThisWeek;
  const pulseMaint = document.getElementById('pulse-maint');
  if (pulseMaint) {
    pulseMaint.parentElement.style.display = maintCount > 0 ? 'flex' : 'none';
    pulseMaint.textContent = maintCount;
  }
}

function updateChatterBadge() {
  const ODOO_BOILERPLATE = ['purchase order created','rfq','purchase order(status)','rfq purchase order'];
  const isRealNotes = notes => {
    if (!notes || notes.trim().length <= 20) return false;
    const n = notes.trim().toLowerCase();
    return !ODOO_BOILERPLATE.some(b => n === b || n.replace(/[^a-z ]/g,'') === b);
  };
  const noHistory = jobs.filter(j =>
    j.status !== 'Job Done' && j.status !== 'Maintenance' &&
    (j.history||[]).length <= 1 && !isRealNotes(j.notes)
  ).length;
  const badge = document.getElementById('chatter-needs-badge');
  if (badge) {
    badge.textContent   = noHistory > 0 ? noHistory + ' need updating' : '';
    badge.style.display = noHistory > 0 ? 'inline' : 'none';
  }
}

function populateSupplierDatalist() {
  const dl = document.getElementById('supplier-datalist');
  if (!dl) return;
  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  dl.innerHTML = suppliers.map(s => `<option value="${esc(s)}">`).join('');
}

/* ── GLOBAL SEARCH ── */
function openGlobalSearch() {
  const overlay = document.getElementById('global-search-overlay');
  const input   = document.getElementById('global-search-input');
  if (overlay) overlay.classList.remove('hidden');
  if (input)   { input.value = ''; input.focus(); }
  renderGlobalSearchResults('');
}

function closeGlobalSearch() {
  const overlay = document.getElementById('global-search-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function onGlobalSearchInput(val) {
  renderGlobalSearchResults(val);
}

function renderGlobalSearchResults(q) {
  const el = document.getElementById('global-search-results');
  if (!el) return;
  q = (q || '').toLowerCase().trim();
  if (!q) { el.innerHTML = '<div style="padding:20px;color:var(--text3);font-size:13px;text-align:center">Type to search jobs…</div>'; return; }
  const matches = jobs.filter(j =>
    (j.po||'').toLowerCase().includes(q) ||
    (j.ref||'').toLowerCase().includes(q) ||
    (j.supplier||'').toLowerCase().includes(q) ||
    (j.equipment||'').toLowerCase().includes(q) ||
    (j.notes||'').toLowerCase().includes(q)
  ).slice(0, 20);
  if (!matches.length) {
    el.innerHTML = '<div style="padding:20px;color:var(--text3);font-size:13px;text-align:center">No jobs found.</div>';
    return;
  }
  el.innerHTML = matches.map(j => `
    <div class="gs-result" onclick="closeGlobalSearch();showPage('jobs');openJobModal('${j.id}')">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:var(--text)">${esc(j.po)}</span>
        ${badge(j.status)}
        <span style="font-size:12px;color:var(--text3)">${esc(j.supplier)}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-top:3px">${esc(j.ref||'—')}</div>
    </div>
  `).join('');
}

/* ── BULK STATUS UPDATE ── */
let _bulkSelected = new Set();

function toggleBulkSelect(id, cb) {
  if (cb.checked) _bulkSelected.add(id);
  else _bulkSelected.delete(id);
  updateBulkBar();
}

function toggleSelectAll(cb) {
  const checkboxes = document.querySelectorAll('.job-row-cb');
  checkboxes.forEach(c => {
    c.checked = cb.checked;
    if (cb.checked) _bulkSelected.add(c.dataset.id);
    else _bulkSelected.delete(c.dataset.id);
  });
  updateBulkBar();
}

function updateBulkBar() {
  const bar    = document.getElementById('bulk-action-bar');
  const countEl = document.getElementById('bulk-count');
  if (!bar) return;
  const count = _bulkSelected.size;
  bar.style.display = count > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = count + ' job' + (count !== 1 ? 's' : '') + ' selected';
}

function clearBulkSelection() {
  _bulkSelected.clear();
  document.querySelectorAll('.job-row-cb').forEach(c => c.checked = false);
  const allCb = document.getElementById('bulk-select-all');
  if (allCb) allCb.checked = false;
  updateBulkBar();
}

async function applyBulkStatus() {
  if (!isAuthed()) { showToast('Sign in to edit jobs'); return; }
  const newStatus = document.getElementById('bulk-status-select')?.value;
  if (!newStatus || _bulkSelected.size === 0) return;
  const count = _bulkSelected.size;
  const confirmed = await showConfirm(
    `Update ${count} job${count !== 1 ? 's' : ''}?`,
    `Set all selected jobs to "${newStatus}".`,
    'Update'
  );
  if (!confirmed) return;
  const ids = [..._bulkSelected];
  const auditEntries = [];
  ids.forEach(id => {
    const j = jobs.find(x => x.id === id);
    if (!j) return;
    if (j.status !== newStatus) {
      auditEntries.push({ jobId: j.id, jobPo: j.po, jobRef: j.ref, action: 'status_change', fromVal: j.status, toVal: newStatus, meta: { source: 'bulk' } });
      if (!j.history || !j.history.length) j.history = [{ status: j.status, date: j.poDate || today() }];
      j.history.push({ status: newStatus, date: today() });
      j.status = newStatus;
    }
  });
  await saveData();
  auditBulk(auditEntries);
  clearBulkSelection();
  renderAll();
  showToast(`${count} job${count !== 1 ? 's' : ''} updated to ${newStatus}`);
}

/* ── CRUD ── */
async function saveJob() {
  if (!isAuthed()) { showToast('Sign in to add or edit jobs'); openAuthModal(); return; }

  const po      = document.getElementById('f-po').value.trim();
  const supplier= document.getElementById('f-supplier').value.trim();
  const poDate  = document.getElementById('f-po-date').value;
  const status  = document.getElementById('f-status').value;
  const notes   = document.getElementById('f-notes').value.trim();
  const internalNotes = document.getElementById('f-internal-notes').value.trim();
  const ref     = document.getElementById('f-ref').value.trim();
  const equip   = document.getElementById('f-equipment').value.trim();
  const value   = document.getElementById('f-value').value.trim();
  const buyer   = document.getElementById('f-buyer').value.trim();
  const chatter = document.getElementById('f-chatter').value;

  const msgEl = document.getElementById('form-validation-msg');
  if (!po || !supplier || !poDate) {
    msgEl.textContent   = 'PO number, service co. and PO date are required.';
    msgEl.style.display = 'block';
    return;
  }
  msgEl.style.display = 'none';

  const { transitions, notes: cn } = parseChatter(chatter);
  const allNotes = [notes, ...cn.map(n => n.text)].filter(Boolean).join('\n');

  let savedJob;

  if (editingId) {
    const j = jobs.find(x => x.id === editingId);
    if (j) {
      j.po = po; j.supplier = supplier; j.ref = ref; j.equipment = equip;
      j.poDate = poDate; j.notes = allNotes; j.internalNotes = internalNotes; j.value = value; j.buyer = buyer;
      if (transitions.length) {
        j.history = buildHistoryFromTransitions(poDate, transitions);
        j.status  = j.history[j.history.length-1].status;
        // Audit each transition from chatter
        const auditEntries = transitions.map(t => ({
          jobId: j.id, jobPo: j.po, jobRef: j.ref,
          action: 'status_change', fromVal: t.from, toVal: t.to,
          meta: { source: 'chatter', date: t.date }
        }));
        auditBulk(auditEntries);
      } else if (j.status !== status) {
        // Confirm status change
        const confirmed = await showConfirm(
          `Change status?`,
          `${j.status}  →  ${status}`,
          'Confirm'
        );
        if (!confirmed) return;
        const prevStatus = j.status;
        if (!j.history || !j.history.length) j.history = [{ status: j.status, date: j.poDate }];
        j.history.push({ status, date: today() });
        j.status = status;
        auditLog('status_change', j.id, j.po, j.ref, prevStatus, status);
      } else {
        j.status = status;
      }
      // Audit internal notes edit if changed
      const origNotes = jobs.find(x => x.id === editingId)?.internalNotes || '';
      if (internalNotes !== origNotes) {
        auditLog('internal_notes_edited', j.id, j.po, j.ref, null, null);
      }
      savedJob = j;
    }
    editingId = null;
  } else {
    savedJob = {
      id:        'j' + Date.now(),
      po, supplier, ref, equipment: equip, poDate,
      notes: allNotes, internalNotes, value, buyer,
      addedDate: today(),
      status:    transitions.length ? transitions[transitions.length-1].to : status,
      history:   transitions.length ? buildHistoryFromTransitions(poDate, transitions) : [{ status, date: poDate }],
    };
    jobs.push(savedJob);
    auditLog('job_added', savedJob.id, savedJob.po, savedJob.ref, null, savedJob.status);
  }

  await saveOneJob(savedJob);   // fast single-row upsert
  clearForm();
  showToast('Job saved');
  showPage('jobs');
  // If user came from the chatter log tab, return them there
  if (window._returnToChatterTab) {
    window._returnToChatterTab = false;
    if (typeof switchJobsTab === 'function') switchJobsTab('chatter');
  }
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
  document.getElementById('f-internal-notes').value = j.internalNotes || '';
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
  ['f-po','f-supplier','f-ref','f-equipment','f-notes','f-internal-notes','f-chatter','f-value','f-buyer']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-po-date').value = '';
  document.getElementById('f-status').value  = 'Incoming Job';
  document.getElementById('chatter-preview-box').innerHTML = '';
  document.getElementById('chatter-parse-status').textContent = '';
}

async function deleteJob(id) {
  if (!isAuthed()) { showToast('Sign in to delete jobs'); return; }
  const confirmed = await showConfirm('Delete this job?', 'This action cannot be undone.');
  if (!confirmed) return;
  const j = jobs.find(x => x.id === id);
  if (j) auditLog('job_deleted', j.id, j.po, j.ref, j.status, null);
  jobs = jobs.filter(j => j.id !== id);
  delete partsData[id];
  await deleteJobFromDB(id);    // Supabase delete (parts cascade)
  closeModal();
  renderJobs();
  renderDashboard();
  showToast('Job deleted');
}

/* ── AUTH MODAL ── */
function openAuthModal() {
  const el = document.getElementById('auth-modal-overlay');
  if (el) el.classList.remove('hidden');
}

function closeAuthModal() {
  const el = document.getElementById('auth-modal-overlay');
  if (el) el.classList.add('hidden');
  document.getElementById('auth-magic-sent')?.classList.add('hidden');
  document.getElementById('auth-modal-form')?.classList.remove('hidden');
}

async function submitMagicLink() {
  const emailEl = document.getElementById('auth-modal-email');
  const email = emailEl?.value.trim();
  if (!email) { showToast('Enter your email'); return; }

  const btn = document.getElementById('auth-modal-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  const error = await sendMagicLink(email);

  if (btn) { btn.disabled = false; btn.textContent = 'Send magic link'; }

  if (error) {
    showToast('Error: ' + error.message);
  } else {
    document.getElementById('auth-modal-form')?.classList.add('hidden');
    document.getElementById('auth-magic-sent')?.classList.remove('hidden');
  }
}

async function handleSignOut() {
  await signOut();
  showToast('Signed out');
}

/* ── PRINT REPORT ── */
async function printReport() {
  await buildPrintReport();
  const html = document.getElementById('print-report').innerHTML;
  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 10px; color: #1e2024; background: #fff; padding: 8px; }
    @page { size: A4 portrait; margin: 8mm; }
    @media print { body { zoom: 0.78; } }
    table { border-collapse: collapse; width: 100%; }
    td, th { overflow: visible; white-space: normal; }
  `;
  const fonts = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap';
  const w = window.open('', '_blank', 'width=1000,height=800');
  if (!w) { showToast('Allow popups for this site to use Print'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Phoeniks Service Report</title><link rel="stylesheet" href="${fonts}"><style>${css}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 1200);
}


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
    closeAuthModal();
    closeGlobalSearch();
    document.getElementById('confirm-overlay').classList.add('hidden');
  }
  // Cmd+K / Ctrl+K → global search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openGlobalSearch();
  }
  if (document.getElementById('meeting-overlay').classList.contains('active')) {
    if (e.key === 'ArrowRight') meetingNext();
    if (e.key === 'ArrowLeft')  meetingPrev();
  }
});

/* ── SIDEBAR DATE ── */
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

function updateSidebarDate() {
  const el = document.getElementById('sidebar-date-display');
  if (!el) return;
  const now   = new Date();
  const day   = now.toLocaleDateString('en-AU', { weekday: 'long' });
  const month = now.toLocaleDateString('en-AU', { month: 'long' });
  const date  = ordinal(now.getDate());
  el.innerHTML = `
    <div style="color:rgba(255,255,255,0.45);font-size:10px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:2px">${day}</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:500">${date} ${month}</div>
  `;
}

/* ── INIT ── */
(async () => {
  // Minimum 3 second loading screen so the fun messages can be seen
  const loadStart = Date.now();

  await initAuth();
  await loadData();

  // Ensure at least 3s on loading screen
  const elapsed = Date.now() - loadStart;
  const remaining = Math.max(0, 3000 - elapsed);
  if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

  updateAuthUI();

  // Fetch current user's role from invited_users table
  window._userRole = 'editor'; // default
  if (isAuthed()) {
    try {
      const userEmail = _sb.auth.getUser ? (await _sb.auth.getUser()).data?.user?.email : null;
      if (userEmail) {
        const { data: invRow } = await _sb.from('invited_users').select('role').eq('email', userEmail).single();
        if (invRow?.role) window._userRole = invRow.role;
      }
    } catch(e) { /* non-fatal */ }
  }

  const isViewer = () => window._userRole === 'viewer';
  if (isViewer()) document.body.classList.add('viewer-mode');

  const navAdmin = document.getElementById('nav-admin');
  if (navAdmin) navAdmin.style.display = (isAuthed() && !isViewer()) ? 'flex' : 'none';
  const navAudit = document.getElementById('nav-audit');
  if (navAudit) navAudit.style.display = (isAuthed() && !isViewer()) ? 'flex' : 'none';
  updateSidebarDate();
  updateNavBadges();

  const _lastPage = (() => { try { return localStorage.getItem('phoeniks_last_page'); } catch(e) { return null; } })();
  showPage(NAV_ORDER.includes(_lastPage) ? _lastPage : 'dashboard');

  if (typeof initDashPeriodFilter  === 'function') initDashPeriodFilter();
  if (typeof initBottleneckFilter  === 'function') initBottleneckFilter();

  try { if (localStorage.getItem('phoeniks_meeting_open') === '1') { setTimeout(openMeeting, 100); } } catch(e) {}
})();

/* ── ADMIN PAGE ── */

// Stored invited users list (Supabase doesn't expose user list to anon key, so we track in DB)
async function renderAdmin() {
  if (!isAuthed()) { showPage('dashboard'); showToast('Sign in to access admin'); return; }
  if (window._userRole === 'viewer') { showPage('dashboard'); showToast('Admin access is restricted to editors'); return; }

  const navAdmin = document.getElementById('nav-admin');
  if (navAdmin) navAdmin.style.display = 'flex';

  const emailEl    = document.getElementById('admin-your-email');
  const jobCountEl = document.getElementById('admin-job-count');
  const countEl    = document.getElementById('admin-user-count');
  const metaEl     = document.getElementById('admin-users-meta');
  const listEl     = document.getElementById('admin-users-list');

  if (emailEl)    emailEl.textContent    = _currentSession?.user?.email || '—';
  if (jobCountEl) jobCountEl.textContent = jobs.length || '0';
  if (listEl)     listEl.innerHTML       = '<div style="padding:20px;color:var(--text3);font-size:13px">Loading…</div>';

  // Load invited users from invited_users table
  try {
    const { data: invited, error } = await _sb.from('invited_users').select('*').order('invited_at', { ascending: false });

    const currentEmail = _currentSession?.user?.email || '';
    const allUsers = invited && !error ? invited : [];

    // Always include current user if not in list
    const hasSelf = allUsers.some(u => u.email === currentEmail);
    if (!hasSelf) {
      allUsers.unshift({ email: currentEmail, invited_at: _currentSession?.user?.created_at, is_self: true });
    }

    if (countEl) countEl.textContent = allUsers.length;
    if (metaEl)  metaEl.textContent  = `${allUsers.length} user${allUsers.length !== 1 ? 's' : ''} with access`;

    if (listEl) {
      listEl.innerHTML = allUsers.map(u => {
        const isSelf = u.email === currentEmail || u.is_self;
        const role   = u.role || 'editor';
        const date   = u.invited_at
          ? new Date(u.invited_at).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })
          : '—';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            <div style="width:36px;height:36px;border-radius:50%;background:${isSelf ? 'var(--phoenix)' : 'var(--surface2)'};border:${isSelf ? 'none' : '1px solid var(--border)'};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${isSelf ? 'var(--phoenix-dark)' : 'var(--text2)'};flex-shrink:0">
              ${(u.email || '?')[0].toUpperCase()}
            </div>
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${esc(u.email || '—')}
                ${isSelf ? '<span style="background:#fef9c3;color:#854d0e;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700;margin-left:6px">You</span>' : ''}
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:3px">Added ${date}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <select onchange="adminChangeRole('${esc(u.email)}', this.value)"
              style="font-size:12px;padding:5px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:${role==='editor'?'#fef9c3':'var(--surface2)'};color:${role==='editor'?'#854d0e':'var(--text2)'};font-family:var(--font);font-weight:600;cursor:pointer">
              <option value="editor" ${role==='editor'?'selected':''}>Full edit</option>
              <option value="viewer" ${role==='viewer'?'selected':''}>View only</option>
            </select>
            ${!isSelf ? `<button onclick="adminRemoveUser('${esc(u.email)}')" style="font-size:11px;padding:5px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--red);cursor:pointer">Remove</button>` : '<span style="font-size:11px;color:var(--text3)">Your account</span>'}
          </div>
        </div>`;
      }).join('');
    }
  } catch(err) {
    console.error('Admin load error:', err);
    if (listEl) listEl.innerHTML = '<div style="padding:20px;color:var(--text3);font-size:13px">Could not load users.</div>';
    if (countEl) countEl.textContent = '1';
    if (metaEl)  metaEl.textContent  = 'You are signed in';
  }
}

async function adminInviteFromInput() {
  const input    = document.getElementById('admin-invite-email');
  const roleEl   = document.getElementById('admin-invite-role');
  const result   = document.getElementById('admin-invite-result');
  const btn      = document.querySelector('#page-admin .btn-primary');
  const email    = input ? input.value.trim() : '';
  const role     = roleEl ? roleEl.value : 'viewer';

  if (!email || !email.includes('@')) {
    if (result) { result.style.color = 'var(--red)'; result.textContent = 'Please enter a valid email address.'; }
    return;
  }

  // Generate a random temp password
  const tempPass = 'Phoeniks-' + Math.random().toString(36).slice(2, 8).toUpperCase();

  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  if (result) { result.style.color = 'var(--text3)'; result.textContent = ''; }

  try {
    // 1. Create user with temp password via admin API
    //    Supabase free plan: use signUp — user is created and can sign in immediately
    const { error: signUpErr } = await _sb.auth.admin
      ? await _sb.auth.admin.createUser({ email, password: tempPass, email_confirm: true })
      : await _sb.auth.signUp({ email, password: tempPass, options: { emailRedirectTo: null } });

    // Fallback: if admin API not available (anon key), use signUp which sends a confirmation email
    // We suppress the error if user already exists — just update their role
    if (signUpErr && !signUpErr.message?.toLowerCase().includes('already')) throw signUpErr;

    // 2. Record in invited_users table
    await _sb.from('invited_users').upsert({ email, role, invited_at: new Date().toISOString() }, { onConflict: 'email' });

    // 3. Show temp password to copy
    if (result) {
      result.innerHTML = `
        <div style="color:var(--green);font-weight:700;margin-bottom:6px">✓ User created — ${esc(email)}</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">Share this temporary password with them. They should change it after first sign-in.</div>
        <div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:8px 12px">
          <code style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:var(--text);flex:1">${esc(tempPass)}</code>
          <button onclick="navigator.clipboard.writeText('${esc(tempPass)}').then(()=>showToast('Copied!'))" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);cursor:pointer;font-family:var(--font)">Copy</button>
        </div>
      `;
    }
    if (input) input.value = '';
    showToast('User created: ' + email);
    renderAdmin();
  } catch(err) {
    const msg = (err.message || '').toLowerCase();
    let friendly = err.message;
    if (msg.includes('rate') || msg.includes('429')) friendly = 'Rate limit reached — wait a moment and try again.';
    if (msg.includes('already registered') || msg.includes('already exists')) {
      // User exists — just update role record
      await _sb.from('invited_users').upsert({ email, role, invited_at: new Date().toISOString() }, { onConflict: 'email' });
      if (result) { result.style.color = 'var(--amber)'; result.textContent = `${email} already exists — role updated to ${role === 'editor' ? 'Full edit' : 'View only'}.`; }
      if (input) input.value = '';
      renderAdmin();
      return;
    }
    if (result) { result.innerHTML = `<span style="color:var(--red)">Error: ${esc(friendly)}</span>`; }
    showToast('Error: ' + friendly);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create user'; }
  }
}

function adminInvitePrompt() {
  // Legacy — redirect to inline invite
  document.getElementById('admin-invite-email')?.focus();
}

async function adminChangeRole(email, newRole) {
  if (!email || !newRole) return;
  try {
    const { error } = await _sb.from('invited_users')
      .update({ role: newRole })
      .eq('email', email);
    if (error) throw error;
    showToast(`${email} updated to ${newRole === 'editor' ? 'Full edit' : 'View only'}`);
    // If changing own role, update in-memory role too
    const currentEmail = _currentSession?.user?.email;
    if (email === currentEmail) {
      window._userRole = newRole;
      if (newRole === 'viewer') document.body.classList.add('viewer-mode');
      else document.body.classList.remove('viewer-mode');
    }
    renderAdmin();
  } catch(err) {
    showToast('Failed to update role — ' + (err.message||'unknown error'));
    renderAdmin(); // re-render to reset the dropdown
  }
}

async function adminRemoveUser(email) {
  if (!confirm(`Remove ${email} from the tracker?\nThey will need to be re-invited to regain access.`)) return;

  try {
    await _sb.from('invited_users').delete().eq('email', email);
    showToast(`${email} removed`);
    renderAdmin();
  } catch(err) {
    showToast('Error removing user: ' + err.message);
  }
}
