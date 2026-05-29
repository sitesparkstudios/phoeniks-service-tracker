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
};

const NAV_ORDER = ['dashboard','urgent','activity','bottleneck','performance','jobs','parts','suppliers','sites','reports','import','add','admin'];

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
  if (name === 'jobs')       { renderJobs(); populateSupplierDatalist(); updateChatterBadge(); }
  if (name === 'parts')      renderParts();
  if (name === 'suppliers')  renderSuppliers();
  if (name === 'sites')      renderSites();
  if (name === 'supplier-tags') { renderSupplierTags(); }
  if (name === 'reports')    renderReports();
  if (name === 'add')        populateSupplierDatalist();
  if (name === 'admin')      renderAdmin();
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
  const noHistory = jobs.filter(j =>
    j.status !== 'Job Done' && j.status !== 'Maintenance' &&
    (j.history||[]).length <= 1 && !(j.notes && j.notes.trim().length > 20)
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
  // Minimum 3 second loading screen so the fun messages can be seen
  const loadStart = Date.now();

  await initAuth();
  await loadData();

  // Ensure at least 3s on loading screen
  const elapsed = Date.now() - loadStart;
  const remaining = Math.max(0, 3000 - elapsed);
  if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

  updateAuthUI();
  const navAdmin = document.getElementById('nav-admin');
  if (navAdmin) navAdmin.style.display = isAuthed() ? 'flex' : 'none';
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
        const date = u.invited_at
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
              <div style="display:flex;gap:6px;align-items:center;margin-top:3px">
                <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;background:${(u.role||'editor')=='editor'?'#fef9c3':'var(--surface3)'};color:${(u.role||'editor')=='editor'?'#854d0e':'var(--text3)'}">${(u.role||'editor')=='editor'?'Full edit':'View only'}</span>
                <span style="font-size:11px;color:var(--text3)">Added ${date}</span>
              </div>
            </div>
          </div>
          ${!isSelf ? `<button onclick="adminRemoveUser('${esc(u.email)}')" style="font-size:11px;padding:4px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--red);cursor:pointer;flex-shrink:0">Remove</button>` : ''}
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
  const input  = document.getElementById('admin-invite-email');
  const roleEl = document.getElementById('admin-invite-role');
  const result = document.getElementById('admin-invite-result');
  const btn    = document.querySelector('#page-admin .btn-primary');
  const email  = input ? input.value.trim() : '';
  const role   = roleEl ? roleEl.value : 'viewer';

  if (!email || !email.includes('@')) {
    if (result) { result.style.color = 'var(--red)'; result.textContent = 'Please enter a valid email address.'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (result) { result.style.color = 'var(--text3)'; result.textContent = ''; }

  try {
    // 1. Send magic link (creates user + sends email)
    const { error: otpErr } = await _sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        shouldCreateUser: true
      }
    });

    if (otpErr) throw otpErr;

    // 2. Record in invited_users table so we can list/remove them
    await _sb.from('invited_users').upsert({ email, role, invited_at: new Date().toISOString() }, { onConflict: 'email' });

    if (result) { result.style.color = 'var(--green)'; result.textContent = `✓ Invite sent to ${email} — they'll receive a magic link shortly.`; }
    if (input)  input.value = '';
    showToast('Invite sent to ' + email);
    renderAdmin();
  } catch(err) {
    const msg = (err.message || '').toLowerCase();
    let friendly = err.message;
    if (msg.includes('rate') || msg.includes('429')) friendly = 'Rate limit reached — wait 60 min and try again.';
    if (result) { result.style.color = 'var(--red)'; result.textContent = 'Error: ' + friendly; }
    showToast('Error: ' + friendly);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send invite'; }
  }
}

function adminInvitePrompt() {
  // Legacy — redirect to inline invite
  document.getElementById('admin-invite-email')?.focus();
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
