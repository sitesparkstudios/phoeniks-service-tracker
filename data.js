/* ============================================================
   data.js — Storage, constants, helpers, CSV import/export,
              Odoo chatter parser, parts ETAs, reports
   ============================================================ */

const SK        = 'phoeniks_tracker_v3';
const SK_PARTS  = 'phoeniks_parts_v2';
const SK_REPORTS= 'phoeniks_reports_v2';
const SK_OLD    = ['phoeniks_tracker_v2','phoeniks_tracker_v1','phoeniks_parts_v1','phoeniks_reports_v1'];

let jobs          = [];
let partsData     = {};   // { jobId: { eta, notes } }
let reportsData   = [];   // [ { date, snapshot } ]
let editingId     = null;
let confirmCallback = null;

/* ── STATUS CONSTANTS ── */
const STATUSES = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting','Job Done','Maintenance'];

const STATUS_BADGE = {
  'Incoming Job':      'b-incoming',
  'Job Booked':        'b-booked',
  'Waiting for Parts': 'b-waiting',
  'Revisiting':        'b-revisiting',
  'Job Done':          'b-done',
  'Maintenance':       'b-maintenance',
};

const STAGE_COLORS  = ['#3b82f6','#a855f7','#f59e0b','#ff5f1f','#22c55e','#6b7280'];
const ACTIVE_STAGES = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting'];

const ODOO_MAP = {
  'order reference':    'po',
  'vendor reference':   'ref',
  'vendor':             'supplier',
  'confirmation date':  'poDate',
  'job status':         'status',
  'status':             'odooStatus',
  'order deadline':     'deadline',
  'total':              'value',
  'receipt status':     'receiptStatus',
  'priority':           'priority',
  'buyer':              'buyer',
  'source document':    'sourceDoc',
  'source':             'sourceDoc',
  'notes':              'odooNotes',
  'terms and conditions': 'odooNotes',
  'purchase representative': 'buyer',  // alternate Odoo label for buyer
};

/* ── DEMO DATA ── */
const DEMO_JOBS = [];

const DEMO_PARTS = {};

/* ── PERSISTENCE ── */
function loadData() {
  // Wipe all old versioned keys
  try { SK_OLD.forEach(k => localStorage.removeItem(k)); } catch(e) {}

  try {
    const raw = localStorage.getItem(SK);
    if (raw) {
      const parsed = JSON.parse(raw);
      // If stored data contains demo jobs (id starts with 'demo-'), wipe it
      const hasDemo = Array.isArray(parsed) && parsed.some(j => (j.id || '').startsWith('demo-'));
      if (hasDemo) {
        localStorage.removeItem(SK);
        localStorage.removeItem(SK_PARTS);
        localStorage.removeItem(SK_REPORTS);
        jobs = [];
        saveData();
      } else {
        jobs = parsed;
      }
    } else {
      jobs = [];
      saveData();
    }
  } catch(e) { jobs = []; }

  try {
    const rp = localStorage.getItem(SK_PARTS);
    partsData = rp ? JSON.parse(rp) : {};
    if (!rp) savePartsData();
  } catch(e) { partsData = {}; }

  try {
    const rr = localStorage.getItem(SK_REPORTS);
    reportsData = rr ? JSON.parse(rr) : [];
  } catch(e) { reportsData = []; }
}

function saveData()      { localStorage.setItem(SK, JSON.stringify(jobs)); }
function savePartsData() { localStorage.setItem(SK_PARTS, JSON.stringify(partsData)); }
function saveReports()   { localStorage.setItem(SK_REPORTS, JSON.stringify(reportsData)); }

/* ── REPORT SNAPSHOTS ── */
function saveReport() {
  const open   = jobs.filter(j => j.status !== 'Job Done');
  const done   = jobs.filter(j => j.status === 'Job Done');
  const stuck  = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14);
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
  saveReports();
  showToast('Report saved');
  renderReports();
}

/* ── MONTHLY SPEND ── */
function getMonthlySpend() {
  const now = new Date();
  // Find earliest job date so we always show relevant data
  const jobDates = jobs.filter(j => j.poDate).map(j => j.poDate).sort();
  const earliest = jobDates.length ? new Date(jobDates[0] + 'T12:00:00') : new Date(now.getFullYear(), now.getMonth() - 11, 1);
  // Show from earliest month (up to 24 months back) through current month
  const startMonth = new Date(Math.max(earliest.getTime(), new Date(now.getFullYear(), now.getMonth() - 23, 1).getTime()));
  const months = [];
  let d = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  while (d <= now) {
    months.push({
      key:   `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      total: 0,
    });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  jobs.forEach(j => {
    if (!j.poDate || !j.value) return;
    const val = parseFloat(j.value);
    if (isNaN(val) || val <= 0) return;
    const key  = j.poDate.substring(0, 7);
    const slot = months.find(m => m.key === key);
    if (slot) slot.total += val;
  });
  return months;
}

/* ── DATE / CALC HELPERS ── */
function today() { return new Date().toISOString().split('T')[0]; }

function daysBetween(a, b) {
  if (!a) return null;
  const end   = b ? new Date(b + 'T12:00:00') : new Date();
  const start = new Date(a + 'T12:00:00');
  return Math.max(0, Math.round((end - start) / 86400000));
}

// Like daysBetween but returns negative if end is before start (used for ETA countdown)
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
  const endDate = job.status === 'Job Done' && job.history
    ? job.history[job.history.length - 1]?.date : null;
  return daysBetween(job.poDate, endDate);
}

/* ── RENDER HELPERS ── */
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

/* ── ODOO CSV IMPORT ── */
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
    'job done':'Job Done','done':'Job Done','completed':'Job Done',
    'maintenance':'Maintenance',
  };
  return map[v.toLowerCase().trim()] || null;
}

function processCSVFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const lines   = ev.target.result.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) { showImportResult('warn','File appears empty.'); return; }
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g,''));
    const colIdx  = {};
    headers.forEach((h,i) => { const mapped = ODOO_MAP[h]; if (mapped) colIdx[mapped] = i; });
    if (colIdx.po === undefined) { showImportResult('warn',`Could not find "Order Reference" column.`); return; }
    let added = 0, updated = 0, skipped = 0, noStatus = 0;
    const seenPOs = new Set(); // track POs already processed in this CSV
    lines.slice(1).forEach(line => {
      const cols = parseCSVLine(line);
      const get  = key => colIdx[key] !== undefined ? (cols[colIdx[key]]||'').trim() : '';
      const po   = get('po').replace(/^"|"$/g,'').trim().toUpperCase();
      if (!po) { skipped++; return; }
      if (seenPOs.has(po)) { skipped++; return; } // skip duplicate rows in same CSV
      seenPOs.add(po);
      const rawStatus = get('status');
      const newStatus = mapOdooStatus(rawStatus);
      // Skip POs with no Job Status — these are procurement/equipment POs, not service jobs
      if (!newStatus) { skipped++; noStatus++; return; }
      const poDate    = normalizeOdooDate(get('poDate')) || today();
      // Match existing job case-insensitively
      const existing  = jobs.find(j => j.po.trim().toUpperCase() === po);
      if (existing) {
        if (get('supplier'))      existing.supplier      = get('supplier');
        if (get('ref'))           existing.ref           = get('ref');
        if (get('value'))         existing.value         = get('value');
        if (get('buyer'))         existing.buyer         = get('buyer');
        if (get('deadline'))      existing.deadline      = normalizeOdooDate(get('deadline'));
        if (get('priority'))      existing.priority      = get('priority');
        if (get('receiptStatus')) existing.receiptStatus = get('receiptStatus');
        if (get('sourceDoc'))     existing.sourceDoc     = get('sourceDoc');
        if (get('odooNotes') && !existing.notes) existing.notes = get('odooNotes'); // don't overwrite manual notes
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
          deadline: normalizeOdooDate(get('deadline')), priority: get('priority'),
          receiptStatus: get('receiptStatus'),
          sourceDoc: get('sourceDoc') || '',
          notes: get('odooNotes') || '',
          history: [{ status: newStatus, date: poDate }],
          addedDate: today(),
        });
        added++;
      }
    });
    saveData();
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
  const fields = 'Order Reference,Vendor,Vendor Reference,Confirmation Date,Job Status,Total,Buyer,Order Deadline,Source Document,Notes';
  navigator.clipboard.writeText(fields).then(() => showToast('Field names copied — paste into Odoo export column selector'));
}

/* ── CSV EXPORT ── */
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

/* ── ODOO CHATTER PARSER ── */
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
