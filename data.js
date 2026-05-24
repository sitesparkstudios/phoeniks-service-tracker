/* ============================================================
   data.js — Storage, constants, helpers, CSV import/export,
              Odoo chatter parser, parts ETAs, reports
   ============================================================ */

const SK        = 'phoeniks_tracker_v2';
const SK_PARTS  = 'phoeniks_parts_v1';
const SK_REPORTS= 'phoeniks_reports_v1';

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
  'order reference':   'po',
  'vendor reference':  'ref',
  'vendor':            'supplier',
  'confirmation date': 'poDate',
  'job status':        'status',
  'status':            'odooStatus',
  'order deadline':    'deadline',
  'total':             'value',
  'receipt status':    'receiptStatus',
  'priority':          'priority',
  'buyer':             'buyer',
};

/* ── DEMO DATA ── */
const DEMO_JOBS = [
  { id:'demo-01', po:'PO-2025-0841', supplier:'Moffat', ref:'KFC Ringwood — Combi Oven E35', equipment:'Combi Oven E35 20GN', poDate:'2025-01-08', status:'Job Done', value:'1480.00', buyer:'Peter Houchin', notes:'Fan motor replaced. Unit back in service.', history:[{status:'Incoming Job',date:'2025-01-08'},{status:'Job Booked',date:'2025-01-10'},{status:'Waiting for Parts',date:'2025-01-14'},{status:'Job Done',date:'2025-01-28'}] },
  { id:'demo-02', po:'PO-2025-0902', supplier:'Hobart', ref:'Grill\'d Fitzroy — AM15 Dishwasher', equipment:'AM15 Pass-through Dishwasher', poDate:'2025-01-20', status:'Job Done', value:'920.00', buyer:'Lisa Tran', notes:'Rinse arm blocked. Descaled and replaced rinse nozzles.', history:[{status:'Incoming Job',date:'2025-01-20'},{status:'Job Booked',date:'2025-01-21'},{status:'Job Done',date:'2025-01-27'}] },
  { id:'demo-03', po:'PO-2025-1044', supplier:'Rational', ref:'McDonald\'s Doncaster — SCC WE 61', equipment:'SCC WE 61 Oven', poDate:'2025-02-03', status:'Job Done', value:'2150.00', buyer:'Peter Houchin', notes:'Control board replaced under extended warranty.', history:[{status:'Incoming Job',date:'2025-02-03'},{status:'Job Booked',date:'2025-02-05'},{status:'Waiting for Parts',date:'2025-02-10'},{status:'Revisiting',date:'2025-02-24'},{status:'Job Done',date:'2025-03-01'}] },
  { id:'demo-04', po:'PO-2025-1120', supplier:'Moffat', ref:'Subway Collins St — Proofer', equipment:'Proofer/Warmer Cabinet', poDate:'2025-02-14', status:'Job Done', value:'640.00', buyer:'Lisa Tran', notes:'Heating element failed. Replaced and tested.', history:[{status:'Incoming Job',date:'2025-02-14'},{status:'Job Booked',date:'2025-02-17'},{status:'Job Done',date:'2025-02-22'}] },
  { id:'demo-05', po:'PO-2025-1288', supplier:'Hobart', ref:'Nando\'s Richmond — FT900 Dishwasher', equipment:'FT900 Flight Dishwasher', poDate:'2025-03-01', status:'Job Done', value:'3400.00', buyer:'Peter Houchin', notes:'Conveyor motor seized. Motor and belt assembly replaced.', history:[{status:'Incoming Job',date:'2025-03-01'},{status:'Job Booked',date:'2025-03-04'},{status:'Waiting for Parts',date:'2025-03-07'},{status:'Job Done',date:'2025-03-21'}] },
  { id:'demo-06', po:'PO-2025-1355', supplier:'Electrolux', ref:'The Pancake Parlour — Air-o-Steam', equipment:'Air-o-Steam 61', poDate:'2025-03-12', status:'Job Done', value:'1760.00', buyer:'Lisa Tran', notes:'Steam generator calcified. Full descale + new gaskets.', history:[{status:'Incoming Job',date:'2025-03-12'},{status:'Job Booked',date:'2025-03-13'},{status:'Waiting for Parts',date:'2025-03-18'},{status:'Job Done',date:'2025-04-02'}] },
  { id:'demo-07', po:'PO-2025-1490', supplier:'Rational', ref:'Hungry Jack\'s Footscray — SCC 101', equipment:'SCC WE 101 Oven', poDate:'2025-03-25', status:'Job Done', value:'890.00', buyer:'Peter Houchin', notes:'Temperature probe replaced. Calibrated on-site.', history:[{status:'Incoming Job',date:'2025-03-25'},{status:'Job Booked',date:'2025-03-26'},{status:'Job Done',date:'2025-04-01'}] },
  { id:'demo-08', po:'PO-2025-1602', supplier:'Moffat', ref:'Boost Juice Chadstone — Blender Bank', equipment:'Waring Blender x4', poDate:'2025-04-07', status:'Job Done', value:'480.00', buyer:'Lisa Tran', notes:'Two blender couplings replaced. All four units tested OK.', history:[{status:'Incoming Job',date:'2025-04-07'},{status:'Job Booked',date:'2025-04-08'},{status:'Job Done',date:'2025-04-11'}] },
  { id:'demo-09', po:'PO-2025-1744', supplier:'Hobart', ref:'Grill\'d Brunswick — LXeH Dishwasher', equipment:'LXeH Undercounter Dishwasher', poDate:'2025-04-15', status:'Job Done', value:'1120.00', buyer:'Peter Houchin', notes:'Door latch assembly and door gasket replaced.', history:[{status:'Incoming Job',date:'2025-04-15'},{status:'Job Booked',date:'2025-04-17'},{status:'Waiting for Parts',date:'2025-04-21'},{status:'Job Done',date:'2025-05-02'}] },
  { id:'demo-10', po:'PO-2025-1890', supplier:'Electrolux', ref:'Cafe Greco South Yarra — PR2 Fridge', equipment:'PR2 Undercounter Fridge', poDate:'2025-04-28', status:'Job Done', value:'760.00', buyer:'Lisa Tran', notes:'Compressor start relay replaced.', history:[{status:'Incoming Job',date:'2025-04-28'},{status:'Job Booked',date:'2025-04-29'},{status:'Job Done',date:'2025-05-05'}] },
  { id:'demo-11', po:'PO-2025-2011', supplier:'Rational', ref:'McDonald\'s Southbank — SCC WE 101', equipment:'SCC WE 101 Oven', poDate:'2025-05-02', status:'Waiting for Parts', value:'2200.00', buyer:'Peter Houchin', notes:'Control display unit faulty. Part on order from Rational AU.', history:[{status:'Incoming Job',date:'2025-05-02'},{status:'Job Booked',date:'2025-05-05'},{status:'Waiting for Parts',date:'2025-05-08'}] },
  { id:'demo-12', po:'PO-2025-2055', supplier:'Moffat', ref:'KFC Northland — Turbofan E33D5', equipment:'Turbofan E33D5', poDate:'2025-05-05', status:'Job Booked', value:'550.00', buyer:'Lisa Tran', notes:'Thermostat not regulating. Technician booked 27 May.', history:[{status:'Incoming Job',date:'2025-05-05'},{status:'Job Booked',date:'2025-05-09'}] },
  { id:'demo-13', po:'PO-2025-2088', supplier:'Hobart', ref:'Nando\'s Chadstone — FT900 Dishwasher', equipment:'FT900 Flight Dishwasher', poDate:'2025-04-28', status:'Revisiting', value:'1850.00', buyer:'Peter Houchin', notes:'First visit: cleared blockage. Unit failed again. Revisiting to check pump assembly.', history:[{status:'Incoming Job',date:'2025-04-28'},{status:'Job Booked',date:'2025-04-30'},{status:'Waiting for Parts',date:'2025-05-06'},{status:'Revisiting',date:'2025-05-14'}] },
  { id:'demo-14', po:'PO-2025-2103', supplier:'Electrolux', ref:'The Pancake Parlour St Kilda — Griddle', equipment:'900XP Electric Griddle', poDate:'2025-05-10', status:'Incoming Job', value:'980.00', buyer:'Lisa Tran', notes:'Uneven heat across cooking surface. Needs diagnostics.', history:[{status:'Incoming Job',date:'2025-05-10'}] },
  { id:'demo-15', po:'PO-2025-2140', supplier:'Rational', ref:'Hungry Jack\'s Coburg — iCombi Pro 10', equipment:'iCombi Pro 10-1/1', poDate:'2025-05-12', status:'Waiting for Parts', value:'3100.00', buyer:'Peter Houchin', notes:'Steam injection system failure. Core unit needs replacement. ETA from supplier: 2 weeks.', history:[{status:'Incoming Job',date:'2025-05-12'},{status:'Job Booked',date:'2025-05-14'},{status:'Waiting for Parts',date:'2025-05-16'}] },
  { id:'demo-16', po:'PO-2025-2177', supplier:'Moffat', ref:'Subway Bourke St — Turbofan E23D3', equipment:'Turbofan E23D3', poDate:'2025-04-30', status:'Revisiting', value:'720.00', buyer:'Lisa Tran', notes:'Original repair didn\'t resolve intermittent fault. Booked for further diagnostics.', history:[{status:'Incoming Job',date:'2025-04-30'},{status:'Job Booked',date:'2025-05-02'},{status:'Revisiting',date:'2025-05-13'}] },
  { id:'demo-17', po:'PO-2025-2210', supplier:'Hobart', ref:'Grill\'d Prahran — AM15 Dishwasher', equipment:'AM15 Dishwasher', poDate:'2025-05-15', status:'Job Booked', value:'430.00', buyer:'Peter Houchin', notes:'Wash pump making noise. Technician scheduled 28 May.', history:[{status:'Incoming Job',date:'2025-05-15'},{status:'Job Booked',date:'2025-05-16'}] },
  { id:'demo-18', po:'PO-2025-2244', supplier:'Electrolux', ref:'Cafe Greco Richmond — Air-o-Steam', equipment:'Air-o-Steam Touchline 101', poDate:'2025-05-01', status:'Waiting for Parts', value:'1650.00', buyer:'Lisa Tran', notes:'Boiler element failed. Waiting on Electrolux to ship element kit.', history:[{status:'Incoming Job',date:'2025-05-01'},{status:'Job Booked',date:'2025-05-05'},{status:'Waiting for Parts',date:'2025-05-09'}] },
  { id:'demo-19', po:'PO-2025-2280', supplier:'Moffat', ref:'KFC Preston — Combi Oven E35', equipment:'Combi Oven E35', poDate:'2025-05-19', status:'Incoming Job', value:'870.00', buyer:'Peter Houchin', notes:'Error code E08 on display. Just received — awaiting booking.', history:[{status:'Incoming Job',date:'2025-05-19'}] },
  { id:'demo-20', po:'PO-2025-2301', supplier:'Rational', ref:'McDonald\'s Coburg — SCC WE 61', equipment:'SCC WE 61 Oven', poDate:'2025-05-20', status:'Incoming Job', value:'1100.00', buyer:'Lisa Tran', notes:'Unit displaying fault on self-clean cycle. Just logged.', history:[{status:'Incoming Job',date:'2025-05-20'}] },
  { id:'demo-21', po:'PO-2025-2055-M', supplier:'Moffat', ref:'Preventive Maintenance — KFC Northland Fleet', equipment:'Various — 6 units', poDate:'2025-05-08', status:'Maintenance', value:'2400.00', buyer:'Peter Houchin', notes:'Annual PM visit. Covers all Moffat units at KFC Northland. Scheduled 30 May.', history:[{status:'Maintenance',date:'2025-05-08'}] },
];

const DEMO_PARTS = {
  'demo-11': { eta: '2025-05-30', notes: 'Display unit — Rational part #CTR-4401' },
  'demo-15': { eta: '2025-06-02', notes: 'Steam core assembly — awaiting Rational AU stock' },
  'demo-18': { eta: '2025-05-28', notes: 'Boiler element kit — Electrolux ELX-8821' },
};

/* ── PERSISTENCE ── */
function loadData() {
  try {
    const raw = localStorage.getItem(SK);
    if (raw) {
      jobs = JSON.parse(raw);
    } else {
      jobs = DEMO_JOBS.map(j => Object.assign({}, j));
      saveData();
    }
  } catch(e) { jobs = []; }

  try {
    const rp = localStorage.getItem(SK_PARTS);
    partsData = rp ? JSON.parse(rp) : Object.assign({}, DEMO_PARTS);
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
    let added = 0, updated = 0, skipped = 0;
    lines.slice(1).forEach(line => {
      const cols = parseCSVLine(line);
      const get  = key => colIdx[key] !== undefined ? (cols[colIdx[key]]||'').trim() : '';
      const po   = get('po').replace(/^"|"$/g,'');
      if (!po) { skipped++; return; }
      const newStatus = mapOdooStatus(get('status')) || 'Incoming Job';
      const poDate    = normalizeOdooDate(get('poDate')) || today();
      const existing  = jobs.find(j => j.po === po);
      if (existing) {
        if (get('supplier'))      existing.supplier      = get('supplier');
        if (get('ref'))           existing.ref           = get('ref');
        if (get('value'))         existing.value         = get('value');
        if (get('buyer'))         existing.buyer         = get('buyer');
        if (get('deadline'))      existing.deadline      = normalizeOdooDate(get('deadline'));
        if (get('priority'))      existing.priority      = get('priority');
        if (get('receiptStatus')) existing.receiptStatus = get('receiptStatus');
        if (existing.status !== newStatus && existing.status !== 'Job Done') {
          if (!existing.history) existing.history = [{ status: existing.status, date: existing.poDate || today() }];
          existing.history.push({ status: newStatus, date: today() });
          existing.status = newStatus;
        }
        updated++;
      } else {
        jobs.push({
          id: 'j' + Date.now() + Math.random().toString(36).slice(2),
          po, supplier: get('supplier'), ref: get('ref'), equipment: '',
          poDate, status: newStatus, value: get('value'), buyer: get('buyer'),
          deadline: normalizeOdooDate(get('deadline')), priority: get('priority'),
          receiptStatus: get('receiptStatus'), notes: '',
          history: [{ status: newStatus, date: poDate }],
          addedDate: today(),
        });
        added++;
      }
    });
    saveData();
    renderAll();
    showImportResult('success',`Import complete — ${added} new job${added!==1?'s':''} added, ${updated} updated${skipped?`, ${skipped} skipped`:''}.`);
    showToast(`Import: +${added} new, ${updated} updated`);
  };
  reader.readAsText(file);
}

function showImportResult(type, msg) {
  document.getElementById('import-result').innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function copyOdooTemplate() {
  const fields = 'Order Reference,Vendor,Vendor Reference,Confirmation Date,Job Status,Status,Order Deadline,Total,Receipt Status,Priority,Buyer';
  navigator.clipboard.writeText(fields).then(() => showToast('Field names copied to clipboard'));
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
