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
};

const NAV_ORDER = ['dashboard','urgent','activity','bottleneck','performance','jobs','parts','suppliers','sites','reports','import','add'];

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    n.classList.toggle('active', NAV_ORDER[i] === name);
  });
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  const pageTitle = PAGE_TITLES[name] || name;
  document.getElementById('topbar-title').textContent = pageTitle;
  document.body.setAttribute('data-print-page', pageTitle);
  try { localStorage.setItem('phoeniks_last_page', name); } catch(e) {}

  if (name === 'dashboard')  { if (typeof initDashPeriodFilter === 'function') initDashPeriodFilter(); renderDashboard(); }
  if (name === 'activity')   renderActivity();
  if (name === 'urgent')     renderUrgent();
  if (name === 'bottleneck') { if (typeof initBottleneckFilter === 'function') initBottleneckFilter(); renderBottleneck(); }
  if (name === 'performance') renderPerformance();
  if (name === 'jobs')       { renderJobs(); populateSupplierDatalist(); }
  if (name === 'parts')      renderParts();
  if (name === 'suppliers')  renderSuppliers();
  if (name === 'sites')      renderSites();
  if (name === 'supplier-tags') { renderSupplierTags(); }
  if (name === 'reports')    renderReports();
  if (name === 'add')        populateSupplierDatalist();
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

function populateSupplierDatalist() {
  const dl = document.getElementById('supplier-datalist');
  if (!dl) return;
  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  dl.innerHTML = suppliers.map(s => `<option value="${esc(s)}">`).join('');
}

/* ── CRUD ── */
async function saveJob() {
  if (!isAuthed()) { showToast('Sign in to add or edit jobs'); openAuthModal(); return; }

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
      savedJob = j;
    }
    editingId = null;
  } else {
    savedJob = {
      id:        'j' + Date.now(),
      po, supplier, ref, equipment: equip, poDate,
      notes: allNotes, value, buyer,
      addedDate: today(),
      status:    transitions.length ? transitions[transitions.length-1].to : status,
      history:   transitions.length ? buildHistoryFromTransitions(poDate, transitions) : [{ status, date: poDate }],
    };
    jobs.push(savedJob);
  }

  await saveOneJob(savedJob);   // fast single-row upsert
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
  if (!isAuthed()) { showToast('Sign in to delete jobs'); return; }
  const confirmed = await showConfirm('Delete this job?', 'This action cannot be undone.');
  if (!confirmed) return;
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
    closeAuthModal();
    document.getElementById('confirm-overlay').classList.add('hidden');
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
  await initAuth();     // set _currentSession, wire onAuthStateChange
  await loadData();     // fetch from Supabase
  updateAuthUI();
  updateSidebarDate();
  updateNavBadges();

  const _lastPage = (() => { try { return localStorage.getItem('phoeniks_last_page'); } catch(e) { return null; } })();
  showPage(NAV_ORDER.includes(_lastPage) ? _lastPage : 'dashboard');

  if (typeof initDashPeriodFilter  === 'function') initDashPeriodFilter();
  if (typeof initBottleneckFilter  === 'function') initBottleneckFilter();

  // Re-open meeting if it was open before refresh
  try { if (localStorage.getItem('phoeniks_meeting_open') === '1') { setTimeout(openMeeting, 100); } } catch(e) {}
})();
