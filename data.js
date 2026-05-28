/* ============================================================
   data.js — Supabase-backed storage, constants, helpers,
              CSV import/export, Odoo chatter parser,
              parts ETAs, reports
   ============================================================
   CHANGED FROM ORIGINAL:
   - loadData() / saveData() / savePartsData() / saveReports()
     all replaced with Supabase async equivalents
   - Auth: magic-link email login, signOut
   - Read-only mode: write functions no-op when !isAuthed()
   - phoeniks_last_page + phoeniks_meeting_open remain in
     localStorage (tiny, non-sensitive UI prefs)
   ============================================================ */

// ── SUPABASE CONFIG ─────────────────────────────────────────
// Replace these two values with your project's URL and anon key.
// Dashboard → Settings → API
const SUPABASE_URL = 'https://hoeiwbotdkjqzrygmdhs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZWl3Ym90ZGtqcXpyeWdtZGhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzM5NDQsImV4cCI6MjA5NTMwOTk0NH0.u9yyk578jkoPv1QQJqZGmRL8A9RoS2prJtW4KnefxZk';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── AUTH HELPERS ────────────────────────────────────────────
let _currentSession = null;

function isAuthed() { return !!_currentSession; }

async function initAuth() {
  // Try to restore + refresh the existing session (silently renews access token)
  // Supabase JS client stores the refresh token in localStorage and handles renewal.
  // refreshSession() explicitly forces a new access token if the refresh token is valid.
  const { data: refreshed } = await _sb.auth.refreshSession();
  if (refreshed && refreshed.session) {
    _currentSession = refreshed.session;
  } else {
    // No valid refresh token — fall back to getSession (also handles magic link callback)
    const { data } = await _sb.auth.getSession();
    _currentSession = data.session;
  }

  _sb.auth.onAuthStateChange((_event, session) => {
    _currentSession = session;
    updateAuthUI();
  });
}

async function sendMagicLink(email) {
  const { error } = await _sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      shouldCreateUser: false   // only allow pre-invited users
    }
  });
  // Supabase returns a vague "Database error" when the email isn't in the allowed list.
  // Return a clearer message instead.
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('database error') || msg.includes('saving new user')) {
      error.message = 'That email hasn\'t been invited yet. Ask Sean to add you via the Admin page.';
    }
  }
  return error;
}

async function signOut() {
  await _sb.auth.signOut();
  _currentSession = null;
  updateAuthUI();
}

function updateAuthUI() {
  const signedIn  = document.getElementById('auth-status-bar-signed-in');
  const signedOut = document.getElementById('auth-status-bar-signed-out');
  const authEmail = document.getElementById('auth-email');

  if (signedIn)  signedIn.style.display  = isAuthed() ? 'block' : 'none';
  if (signedOut) signedOut.style.display = isAuthed() ? 'none'  : 'block';
  if (authEmail) authEmail.textContent   = _currentSession?.user?.email || '';
}

// ── LEGACY KEYS (kept only for last_page / meeting UI prefs) ─
const SK_OLD = ['phoeniks_tracker_v3','phoeniks_tracker_v2','phoeniks_tracker_v1',
                'phoeniks_parts_v2','phoeniks_parts_v1',
                'phoeniks_reports_v2','phoeniks_reports_v1'];

let jobs          = [];
let partsData     = {};   // { jobId: { eta, notes } }
let reportsData   = [];   // [ { id, date, …snapshot } ]
let editingId     = null;
let confirmCallback = null;
let _dataLoaded   = false;

/* ── STATUS CONSTANTS ─────────────────────────────────────── */
const STATUSES = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting','Awaiting Closeout','Job Done','Maintenance'];

const STATUS_BADGE = {
  'Incoming Job':      'b-incoming',
  'Job Booked':        'b-booked',
  'Waiting for Parts': 'b-waiting',
  'Revisiting':        'b-revisiting',
  'Job Done':          'b-done',
  'Awaiting Closeout': 'b-closeout',
  'Maintenance':       'b-maintenance',
};

const STAGE_COLORS  = ['#3b82f6','#a855f7','#f59e0b','#ff5f1f','#22c55e','#6b7280'];
const ACTIVE_STAGES = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting'];

const isServiceJob  = j => j.status !== 'Maintenance';
const isOpenService = j => j.status !== 'Job Done' && j.status !== 'Maintenance';

const ODOO_MAP = {
  'order reference':    'po',
  'vendor reference':   'ref',
  'vendor':             'supplier',
  'confirmation date':  'poDate',
  'job status':         'status',
  'status':             'odooStatus',
  'order deadline':     'deadline',
  'total':              'value',
  'untaxed amount':     'valueUntaxed',
  'receipt status':     'receiptStatus',
  'billing status':     'billingStatus',
  'amount to invoice':  'amountToInvoice',
  'priority':           'priority',
  'buyer':              'buyer',
  'source document':    'sourceDoc',
  'source':             'sourceDoc',
  'notes':              'odooNotes',
  'terms and conditions': 'odooNotes',
  'purchase representative': 'buyer',
  'product':            'equipment',
};

/* ── ROW MAPPING (DB ↔ JS) ──────────────────────────────────
   DB uses snake_case; JS uses camelCase. These two functions
   convert between them so the rest of the app is unchanged.
   ─────────────────────────────────────────────────────────── */
function dbRowToJob(row) {
  return {
    id:               row.id,
    po:               row.po,
    supplier:         row.supplier,
    ref:              row.ref,
    equipment:        row.equipment,
    poDate:           row.po_date,
    status:           row.status,
    value:            row.value,
    valueUntaxed:     row.value_untaxed,
    buyer:            row.buyer,
    deadline:         row.deadline,
    priority:         row.priority,
    receiptStatus:    row.receipt_status,
    billingStatus:    row.billing_status,
    amountToInvoice:  row.amount_to_invoice,
    sourceDoc:        row.source_doc,
    notes:            row.notes,
    addedDate:        row.added_date,
    history:          row.history || [],
  };
}

function jobToDbRow(j) {
  return {
    id:               j.id,
    po:               j.po               || '',
    supplier:         j.supplier         || '',
    ref:              j.ref              || '',
    equipment:        j.equipment        || '',
    po_date:          j.poDate           || null,
    status:           j.status           || 'Incoming Job',
    value:            j.value            || '',
    value_untaxed:    j.valueUntaxed     || '',
    buyer:            j.buyer            || '',
    deadline:         j.deadline         || '',
    priority:         j.priority         || '',
    receipt_status:   j.receiptStatus    || '',
    billing_status:   j.billingStatus    || '',
    amount_to_invoice: j.amountToInvoice || '',
    source_doc:       j.sourceDoc        || '',
    notes:            j.notes            || '',
    added_date:       j.addedDate        || null,
    history:          j.history          || [],
  };
}

function dbRowToParts(row) {
  return { eta: row.eta || '', notes: row.notes || '' };
}

function dbRowToReport(row) {
  return {
    id:        row.id,
    date:      row.report_date,
    openJobs:  row.open_jobs,
    doneJobs:  row.done_jobs,
    stuck:     row.stuck,
    avgDays:   row.avg_days,
    openValue: Number(row.open_value),
    totalJobs: row.total_jobs,
    byStatus:  row.by_status,
    attention: row.attention,
  };
}

/* ── LOAD ───────────────────────────────────────────────────
   Fetches all data from Supabase. Called once on init.
   Shows a loading screen while in flight.
   ─────────────────────────────────────────────────────────── */
async function loadData() {
  showLoadingScreen(true);

  // Wipe old localStorage data keys (keep UI prefs)
  try { SK_OLD.forEach(k => localStorage.removeItem(k)); } catch(e) {}

  // Require authentication — show login wall if not signed in
  if (!isAuthed()) {
    showLoadingScreen(false);
    showLoginWall();
    return;
  }

  try {
    // Jobs — order by po_date desc, then updated_at desc
    const { data: jobRows, error: jobErr } = await _sb
      .from('jobs')
      .select('*')
      .order('updated_at', { ascending: false });

    if (jobErr) throw jobErr;
    jobs = (jobRows || []).map(dbRowToJob);

    // Parts
    const { data: partsRows, error: partsErr } = await _sb
      .from('parts')
      .select('*');

    if (partsErr) throw partsErr;
    partsData = {};
    (partsRows || []).forEach(r => { partsData[r.job_id] = dbRowToParts(r); });

    // Reports — newest first
    const { data: reportRows, error: rptErr } = await _sb
      .from('reports')
      .select('*')
      .order('report_date', { ascending: false });

    if (rptErr) throw rptErr;
    reportsData = (reportRows || []).map(dbRowToReport);

    _dataLoaded = true;
  } catch(err) {
    console.error('Supabase loadData error:', err);
    showToast('Failed to load data — check Supabase config');
  }

  showLoadingScreen(false);
}

const _loadingMessages = [
  'Checking the job queue…',
  'Counting the overdue ones…',
  'Chasing up suppliers…',
  'Reviewing the parts ETAs…',
  'Almost ready…',
];
let _loadingMsgInterval = null;

function showLoadingScreen(visible) {
  const el  = document.getElementById('loading-screen');
  const msg = document.getElementById('loading-msg');
  if (!el) return;

  if (visible) {
    el.classList.remove('hidden');
    // Rotate messages
    let i = 0;
    if (msg) msg.textContent = _loadingMessages[0];
    _loadingMsgInterval = setInterval(() => {
      i = (i + 1) % _loadingMessages.length;
      if (msg) msg.textContent = _loadingMessages[i];
    }, 900);
  } else {
    clearInterval(_loadingMsgInterval);
    el.classList.add('hidden');
  }
}

function showLoginWall() {
  if (document.getElementById('login-wall')) return;
  const app = document.querySelector('.app');
  if (app) app.style.display = 'none';

  const wall = document.createElement('div');
  wall.id = 'login-wall';
  wall.style.cssText = 'position:fixed;inset:0;background:#FFD100;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;padding:16px';
  wall.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;flex-shrink:0">
        <div style="width:12px;height:12px;border-radius:50%;background:#3d4043"></div>
        <div style="width:12px;height:12px;border-radius:50%;background:#3d4043"></div>
        <div style="width:12px;height:12px;border-radius:50%;background:#3d4043"></div>
        <div style="width:12px;height:12px;border-radius:50%;background:#3d4043"></div>
        <div style="width:12px;height:12px;border-radius:50%;background:#3d4043"></div>
        <div style="width:12px;height:12px;border-radius:50%;border:2.5px solid #3d4043;box-sizing:border-box"></div>
      </div>
      <div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:28px;color:#3d4043;letter-spacing:2px;line-height:1">PHOENIKS</div>
        <div style="font-size:10px;color:rgba(61,64,67,0.6);letter-spacing:0.12em;text-transform:uppercase;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;margin-top:3px">Electric Kitchen Specialists</div>
      </div>
    </div>
    <div style="width:60px;height:2px;background:rgba(61,64,67,0.2);border-radius:2px;margin-bottom:24px"></div>
    <div style="background:white;border-radius:14px;padding:28px;width:340px;max-width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.15);text-align:center">
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:17px;font-weight:800;color:#1e2024;margin-bottom:4px">Service Tracker</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:20px">Sign in to view service data</div>

      <!-- Tabs -->
      <div style="display:flex;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px">
        <button id="wall-tab-magic" onclick="wallSetTab('magic')" style="flex:1;padding:8px;font-size:12px;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;border:none;cursor:pointer;background:#3d4043;color:white;transition:all 0.15s">Magic Link</button>
        <button id="wall-tab-password" onclick="wallSetTab('password')" style="flex:1;padding:8px;font-size:12px;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;border:none;cursor:pointer;background:white;color:#6b7280;transition:all 0.15s">Password</button>
      </div>

      <!-- Magic link form -->
      <div id="wall-form-magic">
        <input id="wall-email" type="email" placeholder="your@email.com" onkeydown="if(event.key==='Enter')wallSignIn()" style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:11px 14px;font-size:14px;margin-bottom:12px;font-family:'Plus Jakarta Sans',sans-serif">
        <button id="wall-btn" onclick="wallSignIn()" style="width:100%;background:#3d4043;color:white;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif">Send magic link</button>
      </div>

      <!-- Password form -->
      <div id="wall-form-password" style="display:none">
        <input id="wall-pw-email" type="email" placeholder="your@email.com" onkeydown="if(event.key==='Enter')wallPasswordSignIn()" style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:11px 14px;font-size:14px;margin-bottom:10px;font-family:'Plus Jakarta Sans',sans-serif">
        <input id="wall-pw-pass" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')wallPasswordSignIn()" style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:11px 14px;font-size:14px;margin-bottom:12px;font-family:'Plus Jakarta Sans',sans-serif">
        <button id="wall-pw-btn" onclick="wallPasswordSignIn()" style="width:100%;background:#3d4043;color:white;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif">Sign in</button>
      </div>

      <div id="wall-msg" style="margin-top:12px;font-size:12px;color:#6b7280;min-height:16px"></div>
    </div>
    <div style="position:absolute;bottom:20px;font-family:'Plus Jakarta Sans',sans-serif;font-size:11px;color:rgba(61,64,67,0.45);text-align:center;line-height:1.6">
      Created by <strong style="color:rgba(61,64,67,0.65)">Sean Pickford</strong> · Technical Service Manager<br>
      Tracking Phoeniks service levels, one job at a time 🔥
    </div>
  `;
  document.body.appendChild(wall);

  setTimeout(() => {
    const emailEl = document.getElementById('wall-email');
    if (emailEl) {
      emailEl.focus();
      emailEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); wallSignIn(); }
      });
    }
  }, 50);
}

function wallSetTab(tab) {
  const isMagic = tab === 'magic';
  document.getElementById('wall-form-magic').style.display    = isMagic ? 'block' : 'none';
  document.getElementById('wall-form-password').style.display = isMagic ? 'none'  : 'block';
  document.getElementById('wall-tab-magic').style.background    = isMagic ? '#3d4043' : 'white';
  document.getElementById('wall-tab-magic').style.color         = isMagic ? 'white'   : '#6b7280';
  document.getElementById('wall-tab-password').style.background = isMagic ? 'white'   : '#3d4043';
  document.getElementById('wall-tab-password').style.color      = isMagic ? '#6b7280' : 'white';
  document.getElementById('wall-msg').textContent = '';
  // Focus the email field of whichever tab
  setTimeout(() => {
    const el = document.getElementById(isMagic ? 'wall-email' : 'wall-pw-email');
    if (el) el.focus();
  }, 50);
}

async function wallPasswordSignIn() {
  const emailEl = document.getElementById('wall-pw-email');
  const passEl  = document.getElementById('wall-pw-pass');
  const btn     = document.getElementById('wall-pw-btn');
  const msg     = document.getElementById('wall-msg');
  const email   = emailEl ? emailEl.value.trim() : '';
  const password= passEl  ? passEl.value : '';

  if (!email || !password) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Please enter your email and password.'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  if (msg) { msg.style.color = '#6b7280'; msg.textContent = ''; }

  try {
    const { error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Success — auth state change will handle the rest
  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    if (msg) {
      msg.style.color = '#dc2626';
      const m = (err.message || '').toLowerCase();
      if (m.includes('invalid') || m.includes('credentials') || m.includes('wrong')) {
        msg.textContent = 'Incorrect email or password.';
      } else {
        msg.textContent = 'Error: ' + (err.message || 'Something went wrong.');
      }
    }
  }
}

async function wallSignIn() {
  const emailInput = document.getElementById('wall-email');
  const btn        = document.getElementById('wall-btn');
  const msg        = document.getElementById('wall-msg');
  const email      = emailInput ? emailInput.value.trim() : '';

  if (!email) {
    if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Please enter your email address.'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (msg) { msg.style.color = '#6b7280'; msg.textContent = ''; }

  let error = null;
  try {
    error = await sendMagicLink(email);
  } catch (e) {
    error = e;
  }

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send magic link'; }
    if (msg) {
      msg.style.color = '#dc2626';
      const errMsg = (error.message || '').toLowerCase();
      const errStatus = error.status || error.statusCode || 0;
      if (errStatus === 429 || errMsg.includes('rate') || errMsg.includes('too many')) {
        msg.textContent = '⏳ Rate limit reached — please wait 60 minutes and try again.';
      } else if (errMsg.includes('not found') || errMsg.includes('invalid') || errMsg.includes('not registered')) {
        msg.textContent = "That email isn't authorised. Contact Sean to be added.";
      } else if (errMsg.includes('network') || errMsg.includes('fetch')) {
        msg.textContent = 'Network error — check your connection and try again.';
      } else {
        msg.textContent = 'Error: ' + (error.message || 'Something went wrong. Try again.');
      }
    }
  } else {
    if (msg) { msg.style.color = '#16a34a'; msg.textContent = '✓ Magic link sent! Check your email and click the link to sign in.'; }
    if (btn) { btn.disabled = true; btn.textContent = '✓ Link sent!'; }
  }
}

/* ── SAVE SINGLE JOB ────────────────────────────────────────
   Upserts one job. Used by saveJob() in app.js.
   No-op when not authenticated (read-only visitors).
   ─────────────────────────────────────────────────────────── */
async function saveData() {
  if (!isAuthed()) { showToast('Sign in to save changes'); return; }

  // saveData() is called after the in-memory `jobs` array has already
  // been mutated (by saveJob / deleteJob / importCSV). We upsert the
  // full array so bulk imports (CSV) are covered in one call.
  const rows = jobs.map(jobToDbRow);
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await _sb.from('jobs').upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' });
    if (error) { console.error('saveData error:', error); showToast('Save failed — see console'); return; }
  }
}

/* ── SAVE ONE JOB (fast path) ───────────────────────────────
   Called by saveJob() for add/edit to avoid re-upserting
   the whole array. Falls back to saveData() for bulk imports.
   ─────────────────────────────────────────────────────────── */
async function saveOneJob(job) {
  if (!isAuthed()) { showToast('Sign in to save changes'); return; }
  const { error } = await _sb.from('jobs').upsert(jobToDbRow(job), { onConflict: 'id' });
  if (error) { console.error('saveOneJob error:', error); showToast('Save failed — see console'); }
}

/* ── DELETE JOB ─────────────────────────────────────────────
   Removes from Supabase. Parts cascade on delete via FK.
   ─────────────────────────────────────────────────────────── */
async function deleteJobFromDB(id) {
  if (!isAuthed()) return;
  const { error } = await _sb.from('jobs').delete().eq('id', id);
  if (error) { console.error('deleteJob error:', error); showToast('Delete failed — see console'); }
}

/* ── PARTS ──────────────────────────────────────────────────
   partsData is kept in memory. This flushes the whole map.
   For a single-user tracker the extra roundtrip is negligible.
   ─────────────────────────────────────────────────────────── */
async function savePartsData() {
  if (!isAuthed()) return;
  // Build upsert rows for all entries
  const rows = Object.entries(partsData).map(([jobId, v]) => ({
    job_id: jobId,
    eta:    v.eta   || '',
    notes:  v.notes || '',
  }));
  if (!rows.length) return;
  const { error } = await _sb.from('parts').upsert(rows, { onConflict: 'job_id' });
  if (error) { console.error('savePartsData error:', error); showToast('Parts save failed'); }
}

/* ── REPORTS ────────────────────────────────────────────────
   saveReports() is called from saveReport() in this file.
   ─────────────────────────────────────────────────────────── */
async function saveReports() {
  if (!isAuthed()) return;
  if (!reportsData.length) return;
  // Only upsert the newest (index 0) — already prepended by saveReport()
  const r = reportsData[0];
  const row = {
    id:          r.id,
    report_date: r.date,
    open_jobs:   r.openJobs   || 0,
    done_jobs:   r.doneJobs   || 0,
    stuck:       r.stuck      || 0,
    avg_days:    r.avgDays    || null,
    open_value:  r.openValue  || 0,
    total_jobs:  r.totalJobs  || 0,
    by_status:   r.byStatus   || {},
    attention:   r.attention  || [],
  };
  const { error } = await _sb.from('reports').upsert(row, { onConflict: 'id' });
  if (error) { console.error('saveReports error:', error); showToast('Report save failed'); }
}

/* ── REPORT SNAPSHOTS ───────────────────────────────────────
   Unchanged logic; async only because saveReports() is async
   ─────────────────────────────────────────────────────────── */
async function saveReport() {
  if (!isAuthed()) { showToast('Sign in to save reports'); return; }
  const open   = jobs.filter(j => j.status !== 'Job Done' && j.status !== 'Maintenance');
  const done   = jobs.filter(j => j.status === 'Job Done');
  const stuck  = jobs.filter(j => j.status !== 'Job Done' && j.status !== 'Maintenance' && daysBetween(j.poDate, null) > 14);
  const avgTotal = done.length ? Math.round(done.reduce((a,j) => a + (getTotalDays(j)||0), 0) / done.length) : null;
  const totalValue = open.reduce((a,j) => a + (parseFloat(j.value)||0), 0);

  const snapshot = {
    id:        'r' + Date.now(),
    date:      today(),
    openJobs:  open.length,
    doneJobs:  done.length,
    stuck:     stuck.length,
    avgDays:   avgTotal,
    openValue: totalValue,
    totalJobs: jobs.length,
    byStatus:  {},
    attention: stuck.slice(0,5).map(j => ({ po: j.po, ref: j.ref, supplier: j.supplier, status: j.status, days: daysBetween(j.poDate, null) })),
  };
  STATUSES.forEach(s => { snapshot.byStatus[s] = jobs.filter(j => j.status === s).length; });

  reportsData.unshift(snapshot);
  await saveReports();
  showToast('Report saved');
  renderReports();
}

/* ── MONTHLY SPEND ──────────────────────────────────────────
   Unchanged — pure computation from in-memory jobs array
   ─────────────────────────────────────────────────────────── */
function getMonthlySpend() {
  const now = new Date();
  const jobDates = jobs.filter(j => j.poDate).map(j => j.poDate).sort();
  const earliest = jobDates.length ? new Date(jobDates[0] + 'T12:00:00') : new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const startMonth = new Date(Math.max(earliest.getTime(), new Date(now.getFullYear(), now.getMonth() - 23, 1).getTime()));
  const months = [];
  let d = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  while (d <= now) {
    months.push({
      key:   `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      total: 0,
      count: 0,
    });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  jobs.forEach(j => {
    if (!j.poDate) return;
    const key  = j.poDate.substring(0, 7);
    const slot = months.find(m => m.key === key);
    if (!slot) return;
    slot.count++;
    const val = parseFloat(j.value);
    if (!isNaN(val) && val > 0) slot.total += val;
  });
  return months;
}

/* ── DATE / CALC HELPERS ────────────────────────────────────
   All unchanged — pure functions, no storage
   ─────────────────────────────────────────────────────────── */
function today() { return new Date().toISOString().split('T')[0]; }

function daysBetween(a, b) {
  if (!a) return null;
  const end   = b ? new Date(b + 'T12:00:00') : new Date();
  const start = new Date(a + 'T12:00:00');
  return Math.max(0, Math.round((end - start) / 86400000));
}

function daysUntil(target) {
  if (!target) return null;
  const now = new Date();
  now.setHours(12,0,0,0);
  const t = new Date(target + 'T12:00:00');
  return Math.round((t - now) / 86400000);
}

function getDwellTimes(job) {
  const hist  = job.history || [];
  const dwell = {};
  hist.forEach((h, i) => {
    const next = hist[i + 1];
    const end  = next ? next.date : (job.status === 'Job Done' ? hist[hist.length-1]?.date : null);
    const days = end ? daysBetween(h.date, end) : daysBetween(h.date, null);
    dwell[h.status] = (dwell[h.status] || 0) + (days || 0);
  });
  return dwell;
}

function getTotalDays(job) {
  if (!job.poDate) return null;
  if (job.status === 'Job Done') {
    const hist = job.history || [];
    // Multi-entry history: use first → last date
    if (hist.length > 1) {
      const lastDate = hist[hist.length - 1]?.date;
      if (lastDate && lastDate !== job.poDate) {
        return daysBetween(job.poDate, lastDate);
      }
      // History entries exist but same date — job done same day, count as 1
      if (lastDate === job.poDate) return 1;
    }
    // Single history entry (Odoo import with no chatter): we don't know completion date
    // Return null so it's excluded from duration averages rather than skewing them to 0
    return null;
  }
  return daysBetween(job.poDate, null);
}

/* ── RENDER HELPERS ─────────────────────────────────────────
   Unchanged
   ─────────────────────────────────────────────────────────── */
function badge(status) {
  const cls = STATUS_BADGE[status] || 'b-incoming';
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${status}</span>`;
}

function dayChip(d, isDone) {
  if (d === null || d === undefined) return '<span class="text-muted text-sm">—</span>';
  const cls = isDone ? 'ok' : d > 21 ? 'danger' : d > 14 ? 'warn' : '';
  return `<span class="day-chip ${cls}">${d}d</span>`;
}

function fmtValue(v) {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── ODOO CSV IMPORT ────────────────────────────────────────
   Identical logic; saveData() is now async so we await it
   ─────────────────────────────────────────────────────────── */
function handleDragOver(e)  { e.preventDefault(); document.getElementById('drop-zone').classList.add('drag-over'); }
function handleDragLeave()  { document.getElementById('drop-zone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.name.endsWith('.csv')) processCSVFile(f);
  else showToast('Please drop a .csv file');
}
function handleCSVImport(e) {
  const f = e.target.files[0];
  if (!f) return;
  processCSVFile(f);
  e.target.value = '';
}

function parseCSVLine(line) {
  const result = [];
  let current = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { current += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(current.trim()); current = '';
    } else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function normalizeOdooDate(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return null;
}

function mapOdooStatus(v) {
  if (!v) return null;
  const map = {
    'incoming job':'Incoming Job','incoming':'Incoming Job',
    'job booked':'Job Booked','booked':'Job Booked',
    'waiting for parts':'Waiting for Parts','waiting':'Waiting for Parts',
    'revisiting':'Revisiting',
    'awaiting closeout':'Awaiting Closeout','closeout':'Awaiting Closeout',
    'job done':'Job Done','done':'Job Done','completed':'Job Done',
    'maintenance':'Maintenance',
  };
  return map[v.toLowerCase().trim()] || null;
}

function processCSVFile(file) {
  if (!isAuthed()) { showToast('Sign in to import'); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    const lines   = ev.target.result.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) { showImportResult('warn','File appears empty.'); return; }
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g,''));
    const colIdx  = {};
    headers.forEach((h,i) => { const mapped = ODOO_MAP[h]; if (mapped) colIdx[mapped] = i; });
    if (colIdx.po === undefined) { showImportResult('warn',`Could not find "Order Reference" column.`); return; }
    let added = 0, updated = 0, skipped = 0, noStatus = 0;
    const seenPOs = new Set();
    lines.slice(1).forEach(line => {
      const cols = parseCSVLine(line);
      const get  = key => colIdx[key] !== undefined ? (cols[colIdx[key]]||'').trim() : '';
      const po   = get('po').replace(/^"|"$/g,'').trim().toUpperCase();
      if (!po) { skipped++; return; }
      if (seenPOs.has(po)) { skipped++; return; }
      seenPOs.add(po);
      const rawStatus = get('status');
      const newStatus = mapOdooStatus(rawStatus);
      if (!newStatus) { skipped++; noStatus++; return; }
      const poDate    = normalizeOdooDate(get('poDate')) || today();
      const existing  = jobs.find(j => j.po.trim().toUpperCase() === po);
      if (existing) {
        if (get('supplier'))      existing.supplier      = get('supplier');
        if (get('ref'))           existing.ref           = get('ref');
        if (get('value'))         existing.value         = get('value');
        if (get('buyer'))         existing.buyer         = get('buyer');
        const dl = normalizeOdooDate(get('deadline')); if (dl && dl !== existing.poDate) existing.deadline = dl;
        if (get('priority'))      existing.priority      = get('priority');
        if (get('receiptStatus')) existing.receiptStatus = get('receiptStatus');
        if (get('sourceDoc'))     existing.sourceDoc     = get('sourceDoc');
        if (get('odooNotes') && !existing.notes) existing.notes = get('odooNotes');
        if (get('billingStatus'))    existing.billingStatus  = get('billingStatus');
        if (get('amountToInvoice'))  existing.amountToInvoice= get('amountToInvoice');
        if (get('valueUntaxed'))     existing.valueUntaxed   = get('valueUntaxed');
        if (get('receiptStatus'))    existing.receiptStatus  = get('receiptStatus');
        if (!parseFloat(existing.value) && parseFloat(get('valueUntaxed'))) existing.value = get('valueUntaxed');
        if (existing.status !== newStatus && existing.status !== 'Job Done') {
          if (!existing.history) existing.history = [{ status: existing.status, date: existing.poDate || today() }];
          existing.history.push({ status: newStatus, date: today() });
          existing.status = newStatus;
        }
        updated++;
      } else {
        jobs.push({
          id: 'j' + Date.now() + Math.random().toString(36).slice(2),
          po: po, supplier: get('supplier'), ref: get('ref'), equipment: '',
          poDate, status: newStatus, value: get('value'), buyer: get('buyer'),
          deadline: (() => { const dl = normalizeOdooDate(get('deadline')); return (dl && dl !== poDate) ? dl : ''; })(), priority: get('priority'),
          receiptStatus: get('receiptStatus'),
          sourceDoc:       get('sourceDoc') || '',
          notes:           get('odooNotes') || '',
          billingStatus:   get('billingStatus') || '',
          amountToInvoice: get('amountToInvoice') || '',
          valueUntaxed:    get('valueUntaxed') || '',
          history: [{ status: newStatus, date: poDate }],
          addedDate: today(),
        });
        added++;
      }
    });
    await saveData();   // bulk upsert via Supabase
    renderAll();
    const skipNote = noStatus > 0 ? ` · ${noStatus} skipped (no Job Status — procurement POs)` : skipped > 0 ? ` · ${skipped} skipped` : '';
    showImportResult('success', `Import complete — ${added} new job${added!==1?'s':''} added, ${updated} updated${skipNote}.`);
    showToast(`Import: +${added} new, ${updated} updated`);
  };
  reader.readAsText(file);
}

function showImportResult(type, msg) {
  document.getElementById('import-result').innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function copyOdooTemplate() {
  const fields = 'Order Reference,Vendor,Vendor Reference,Confirmation Date,Job Status,Total,Untaxed Amount,Billing Status,Amount to Invoice,Receipt Status,Buyer,Order Deadline,Source Document,Terms and Conditions';
  navigator.clipboard.writeText(fields).then(() => showToast('Field names copied — paste into Odoo export column selector'));
}

/* ── CSV EXPORT ─────────────────────────────────────────────
   Unchanged — reads in-memory jobs array
   ─────────────────────────────────────────────────────────── */
function exportCSV() {
  const header = 'PO,Supplier,Reference,Equipment,PO Date,Status,Value,Buyer,Notes,Total Days';
  const rows   = jobs.map(j =>
    [j.po, j.supplier, j.ref, j.equipment, j.poDate, j.status, j.value||'', j.buyer||'',
     (j.notes||'').replace(/\n/g,' '), getTotalDays(j)]
    .map(v => `"${(v??'').toString().replace(/"/g,'""')}"`)
    .join(',')
  );
  const csv = [header, ...rows].join('\n');
  const a   = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'phoeniks-jobs-' + today() + '.csv';
  a.click();
  showToast('CSV exported');
}

/* ── ODOO CHATTER PARSER ────────────────────────────────────
   All unchanged — pure parsing, no storage
   ─────────────────────────────────────────────────────────── */
const MONTH_MAP = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11
};

function parseOdooDate(str) {
  if (!str) return null;
  str = str.trim();
  const now = new Date();
  if (/^today/i.test(str))     return now.toISOString().split('T')[0];
  if (/^yesterday/i.test(str)) { const d=new Date(now); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]; }
  const m = str.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (m) {
    const day = parseInt(m[1]);
    const mon = MONTH_MAP[m[2].toLowerCase()];
    const yr  = m[3] ? parseInt(m[3]) : now.getFullYear();
    if (mon !== undefined) return new Date(yr, mon, day).toISOString().split('T')[0];
  }
  return null;
}

function parseChatter(text) {
  if (!text || !text.trim()) return { transitions: [], notes: [] };
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const transitions = [], notes = [];
  let contextDate = null;
  const sp = STATUSES.map(s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const arrowRe   = new RegExp(`(${sp})\\s*[→\\->]+\\s*(${sp})\\s*\\(Job Status\\)`,'i');
  const concatRe  = new RegExp(`(${sp})(${sp})\\s*\\(Job Status\\)`,'i');
  const dateHdrRe = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;
  const inlineRe  = /^(\d{1,2}\s+[A-Za-z]+,\s*\d{1,2}:\d{2}\s*[ap]m|yesterday\s+at|today\s+at)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (dateHdrRe.test(line))  { contextDate = parseOdooDate(line); continue; }
    if (inlineRe.test(line))   { const d = parseOdooDate(line); if (d) contextDate = d; continue; }
    const am = line.match(arrowRe);
    if (am) { let ed=contextDate; for(let k=i-1;k>=Math.max(0,i-5);k--){const d=parseOdooDate(lines[k]);if(d){ed=d;break;}} transitions.push({from:am[1],to:am[2],date:ed||today()}); continue; }
    const cm = line.match(concatRe);
    if (cm) { let ed=contextDate; for(let k=i-1;k>=Math.max(0,i-5);k--){const d=parseOdooDate(lines[k]);if(d){ed=d;break;}} transitions.push({from:cm[1],to:cm[2],date:ed||today()}); continue; }
    if (line.length > 15 && !/^(Purchase Order|RFQ|Status\)|Job Status\))/i.test(line) && !/^\d+\s+[A-Za-z]/.test(line) && !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(line)) {
      notes.push({ date: contextDate || today(), text: line });
    }
  }
  return { transitions, notes };
}

function buildHistoryFromTransitions(poDate, transitions) {
  if (!transitions.length) return null;
  const hist = [{ status: transitions[0].from, date: poDate }];
  transitions.forEach(t => hist.push({ status: t.to, date: t.date }));
  return hist;
}

function liveParseChatter() {
  const text = document.getElementById('f-chatter').value;
  const { transitions, notes } = parseChatter(text);
  const se = document.getElementById('chatter-parse-status');
  const pe = document.getElementById('chatter-preview-box');
  if (!transitions.length && !notes.length) { se.textContent=''; pe.innerHTML=''; return; }
  se.textContent = transitions.length ? `✓ ${transitions.length} transition${transitions.length>1?'s':''} found` : '';
  let h = '<div class="chatter-preview">';
  if (transitions.length) {
    h += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:6px">Transitions detected</div>`;
    transitions.forEach(t => { h += `<div class="parse-transition"><span class="parse-date">${t.date}</span>${badge(t.from)}<span style="color:var(--text3);font-size:12px">→</span>${badge(t.to)}</div>`; });
  }
  if (notes.length) {
    h += `<div style="margin-top:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:4px">${notes.length} note${notes.length>1?'s':''} captured</div>`;
    notes.slice(0,3).forEach(n => { h += `<div style="font-size:11px;color:var(--text2);padding:2px 0">${esc(n.text.substring(0,100))}${n.text.length>100?'…':''}</div>`; });
  }
  h += '</div>';
  pe.innerHTML = h;
}

/* ── INVOICE VALUE IMPORT ───────────────────────────────────
   saveData() call is now async — awaited
   ─────────────────────────────────────────────────────────── */
function handleInvoiceDrop(e) {
  e.preventDefault();
  document.getElementById('invoice-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processInvoiceFile(file);
}

function handleInvoiceImport(e) {
  const file = e.target.files[0];
  if (file) processInvoiceFile(file);
  e.target.value = '';
}

function processInvoiceFile(file) {
  if (!isAuthed()) { showToast('Sign in to import'); return; }
  const resEl = document.getElementById('invoice-import-result');
  resEl.innerHTML = '<div class="alert alert-info">Reading file…</div>';
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = e => parseInvoiceCSV(e.target.result);
    reader.readAsText(file);
  } else if (ext === 'xlsx') {
    const reader = new FileReader();
    reader.onload = e => parseInvoiceXLSX(e.target.result);
    reader.readAsArrayBuffer(file);
  } else {
    resEl.innerHTML = '<div class="alert alert-warn">Please upload a .xlsx or .csv file.</div>';
  }
}

function parseInvoiceXLSX(buffer) {
  try {
    if (typeof XLSX === 'undefined') {
      document.getElementById('invoice-import-result').innerHTML =
        '<div class="alert alert-warn">Please save the file as CSV from Excel and re-upload.</div>';
      return;
    }
    const wb   = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    applyInvoiceRows(rows);
  } catch(err) {
    document.getElementById('invoice-import-result').innerHTML =
      `<div class="alert alert-warn">Could not read XLSX: ${err.message}. Try saving as CSV.</div>`;
  }
}

function parseInvoiceCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    document.getElementById('invoice-import-result').innerHTML =
      '<div class="alert alert-warn">File appears empty.</div>';
    return;
  }
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i]||'').trim(); });
    return obj;
  });
  applyInvoiceRows(rows);
}

async function applyInvoiceRows(rows) {
  let matched = 0, updated = 0, skipped = 0, noMatch = 0;
  const firstRow = rows[0] || {};
  const keys = Object.keys(firstRow);
  const findCol = (...names) => keys.find(k => names.some(n => k.toLowerCase().trim() === n.toLowerCase())) || null;
  const colPO    = findCol('po#', 'po', 'purchase order', 'order reference');
  const colDebit = findCol('debit', 'amount', 'total', 'untaxed amount');
  if (!colPO || !colDebit) {
    document.getElementById('invoice-import-result').innerHTML =
      `<div class="alert alert-warn">Could not find required columns. Need "PO#" and "Debit" columns. Found: ${keys.join(', ')}</div>`;
    return;
  }
  const poTotals = {};
  rows.forEach(row => {
    const rawPO = (row[colPO] || '').toString().trim();
    const poMatch = rawPO.match(/^(P\d+)/i);
    if (!poMatch) { skipped++; return; }
    const po = poMatch[1].toUpperCase();
    const val = parseFloat((row[colDebit]||'0').toString().replace(/[,$]/g,'')) || 0;
    if (!poTotals[po]) poTotals[po] = 0;
    poTotals[po] += val;
    matched++;
  });
  const updatedPOs = [];
  Object.entries(poTotals).forEach(([po, total]) => {
    const job = jobs.find(j => j.po.trim().toUpperCase() === po);
    if (!job) { noMatch++; return; }
    if (total > 0) { job.value = total.toFixed(2); updatedPOs.push(po); updated++; }
  });
  if (updated > 0) {
    await saveData();
    renderAll();
  }
  const msg = `Invoice import complete — <strong>${updated} jobs updated</strong> with invoice values · ${skipped} rows had no PO# · ${noMatch} POs not found in tracker.
    ${updatedPOs.length ? `<div style="margin-top:6px;font-size:11px;color:var(--text3)">Updated: ${updatedPOs.slice(0,10).join(', ')}${updatedPOs.length>10?' …and '+(updatedPOs.length-10)+' more':''}</div>` : ''}`;
  document.getElementById('invoice-import-result').innerHTML =
    `<div class="alert alert-${updated > 0 ? 'success' : 'warn'}">${msg}</div>`;
}
