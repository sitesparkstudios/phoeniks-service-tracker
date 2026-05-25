/* ============================================================
   render.js — All page render functions
   ============================================================ */

let statusChartInst, dwellChartInst, supplierChartInst, spendChartInst;

const CHART_GRID = { color: 'rgba(0,0,0,0.06)' };
const CHART_TICK = { color: '#9ba3af', font: { size: 11, family: 'Plus Jakarta Sans' } };

function renderAll() {
  renderDashboard();
  renderJobs();
  renderSuppliers();
  renderParts();
  renderReports();
  renderActivity();
  if (typeof updateNavBadges === 'function') updateNavBadges();
}

/* ── DASHBOARD ── */
function renderDashboard() {
  const open      = jobs.filter(j => j.status !== 'Job Done');
  const done      = jobs.filter(j => j.status === 'Job Done');
  const stuck     = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14);
  const avgTotal  = done.length ? Math.round(done.reduce((a,j) => a + (getTotalDays(j)||0), 0) / done.length) : null;
  const yearSpend = jobs.reduce((a,j) => a + (parseFloat(j.value)||0), 0);

  const _now = new Date();
  const _ord = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  const _day = _now.toLocaleDateString('en-AU', { weekday:'long' });
  const _month = _now.toLocaleDateString('en-AU', { month:'long', year:'numeric' });
  document.getElementById('dash-date').textContent = `${_day}, ${_ord(_now.getDate())} ${_month}`;

  document.getElementById('kpi-grid').innerHTML = `
    <div class="metric-card accent-blue">
      <div class="metric-label">Open Jobs</div>
      <div class="metric-value">${open.length}</div>
      <div class="metric-sub">${done.length} completed total</div>
    </div>
    <div class="metric-card ${stuck.length > 0 ? 'warn' : 'accent-green'}">
      <div class="metric-label">Needs Attention</div>
      <div class="metric-value">${stuck.length}</div>
      <div class="metric-sub">Open &gt; 14 days</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Avg Duration</div>
      <div class="metric-value">${avgTotal !== null ? avgTotal + 'd' : '—'}</div>
      <div class="metric-sub">PO sent → done</div>
    </div>
    <div class="metric-card accent-yellow">
      <div class="metric-label">Year Spend</div>
      <div class="metric-value" style="font-size:${yearSpend > 99999 ? '20px' : '26px'}">
        ${yearSpend > 0 ? '$' + Math.round(yearSpend).toLocaleString() : '—'}
      </div>
      <div class="metric-sub">All POs this year</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Jobs</div>
      <div class="metric-value">${jobs.length}</div>
      <div class="metric-sub">All time</div>
    </div>
  `;

  /* Stage dwell — prominent section */
  const dwellEl = document.getElementById('stage-dwell-prominent');
  if (dwellEl) {
    const totals = {};
    ACTIVE_STAGES.forEach(s => { totals[s] = { sum:0, c:0 }; });
    jobs.forEach(j => {
      const dw = getDwellTimes(j);
      ACTIVE_STAGES.forEach(s => { if (dw[s] !== undefined) { totals[s].sum += dw[s]; totals[s].c++; } });
    });
    const avgs   = ACTIVE_STAGES.map(s => totals[s].c ? Math.round(totals[s].sum / totals[s].c) : 0);
    const maxAvg = Math.max(...avgs, 1);
    dwellEl.innerHTML = ACTIVE_STAGES.map((s, i) => {
      const pct    = Math.round(avgs[i] / maxAvg * 100);
      const isBad  = avgs[i] > 14;
      const count  = jobs.filter(j => j.status === s).length;
      return `<div class="stage-bar-row" style="margin-bottom:18px">
        <div class="stage-bar-meta" style="margin-bottom:8px">
          <span style="font-size:13px;font-weight:600;color:var(--text)">${s}</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:12px;color:var(--text3)">${count} job${count!==1?'s':''} here now</span>
            <span class="day-chip ${isBad?'danger':''}" style="font-size:13px">${avgs[i]}d avg</span>
          </div>
        </div>
        <div class="stage-bar-bg" style="height:10px">
          <div class="stage-bar-fill" style="width:${pct}%;background:${STAGE_COLORS[i]}"></div>
        </div>
      </div>`;
    }).join('');
  }

  if (!jobs.length) {
    document.getElementById('stage-bars-dash').innerHTML =
      '<div style="color:var(--text3);font-size:13px;padding:8px 0">No jobs yet — import your Odoo CSV to get started.</div>';
    document.getElementById('attention-table').innerHTML =
      '<div class="empty-state"><p>No data yet. Use <strong>Odoo Import</strong> to load your jobs.</p></div>';
    if (statusChartInst) { statusChartInst.destroy(); statusChartInst = null; }
    renderSpendChart();
    return;
  }

  /* Status doughnut */
  const sc = {};
  jobs.forEach(j => { sc[j.status] = (sc[j.status]||0) + 1; });
  const slabels = Object.keys(sc);
  const sColors = { 'Incoming Job':'#2563eb','Job Booked':'#7c3aed','Waiting for Parts':'#d97706','Revisiting':'#b8960a','Job Done':'#16a34a','Maintenance':'#6b7280' };
  if (statusChartInst) statusChartInst.destroy();
  statusChartInst = new Chart(document.getElementById('statusChart'), {
    type: 'doughnut',
    data: { labels: slabels, datasets: [{ data: slabels.map(l => sc[l]), backgroundColor: slabels.map(l => sColors[l]||'#ccc'), borderWidth: 2, borderColor: '#ffffff' }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 11, family:'Plus Jakarta Sans' }, color: '#5a6270' } } } }
  });

  /* Stage bars */
  document.getElementById('stage-bars-dash').innerHTML = ACTIVE_STAGES.map((s, i) => {
    const inStage = jobs.filter(j => j.status === s);
    if (!inStage.length) return '';
    const avg = Math.round(inStage.reduce((a,j) => a + daysBetween(j.poDate, null), 0) / inStage.length);
    const pct = Math.min(100, Math.round(avg / 30 * 100));
    return `<div class="stage-bar-row">
      <div class="stage-bar-meta">
        <span class="stage-bar-name">${s}</span>
        <span class="stage-bar-val">${avg}d · ${inStage.length}</span>
      </div>
      <div class="stage-bar-bg"><div class="stage-bar-fill" style="width:${pct}%;background:${STAGE_COLORS[i]}"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--text3);font-size:13px;padding:8px 0">No open jobs in active stages.</div>';

  /* Attention table */
  const attn = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14)
                   .sort((a,b) => daysBetween(b.poDate,null) - daysBetween(a.poDate,null));
  document.getElementById('attention-table').innerHTML = !attn.length
    ? '<div class="empty-state"><p>✓ No jobs overdue — great work!</p></div>'
    : `<table><thead><tr>
        <th style="width:90px">PO</th><th>Reference</th>
        <th style="width:150px">Service Co.</th><th style="width:130px">Status</th><th style="width:68px">Open</th>
      </tr></thead>
      <tbody>${attn.map(j => `<tr class="flagged" onclick="openJobModal('${j.id}')">
        <td><span class="po-link">${esc(j.po)}</span></td>
        <td class="ref-cell">${esc(j.ref)}</td>
        <td>${esc(j.supplier)}</td>
        <td>${badge(j.status)}</td>
        <td>${dayChip(daysBetween(j.poDate,null),false)}</td>
      </tr>`).join('')}</tbody></table>`;

  renderSpendChart();
}

/* ── SPEND CHART ── */
function renderSpendChart() {
  const canvas = document.getElementById('spendChart');
  if (!canvas) return;
  const months  = getMonthlySpend();
  const hasData = months.some(m => m.total > 0);
  if (spendChartInst) spendChartInst.destroy();
  if (!hasData) {
    canvas.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3);font-size:12px">Spend data appears after importing jobs with values from Odoo</div>';
    return;
  }
  spendChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [{ label:'Monthly Spend ($)', data: months.map(m => m.total),
        backgroundColor: months.map(m => m.total > 0 ? 'rgba(61,64,67,0.85)' : 'rgba(0,0,0,0.06)'),
        borderRadius: 6, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' $' + Math.round(ctx.raw).toLocaleString() } } },
      scales: {
        y: { beginAtZero: true, ticks: { ...CHART_TICK, callback: v => '$'+(v>=1000?(v/1000).toFixed(0)+'k':v) }, grid: CHART_GRID },
        x: { ticks: CHART_TICK, grid: { display: false } }
      }
    }
  });
}

/* ── WEEKLY ACTIVITY ── */
function renderActivity() {
  const days   = parseInt(document.getElementById('activity-range')?.value || '7');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const events = [];

  jobs.forEach(j => {
    const addedDate = j.addedDate || (j.history && j.history[0]?.date) || j.poDate;
    if (addedDate && addedDate >= cutoffStr) {
      events.push({ date: addedDate, type: 'new', job: j,
        title: `New job added — ${j.po}`,
        meta:  `${j.supplier} · ${j.ref || 'No reference'}` });
    }
    if (j.history && j.history.length > 1) {
      j.history.slice(1).forEach(h => {
        if (h.date && h.date >= cutoffStr) {
          const isDone = h.status === 'Job Done';
          events.push({ date: h.date, type: isDone ? 'done' : 'moved', job: j,
            title: isDone ? `Job completed — ${j.po}` : `Status changed — ${j.po}`,
            meta:  isDone
              ? `${j.supplier} · ${j.ref || ''} · marked done`
              : `${j.supplier} · moved to ${h.status}` });
        }
      });
    }
  });

  events.sort((a,b) => b.date.localeCompare(a.date));

  const newCount  = events.filter(e => e.type === 'new').length;
  const doneCount = events.filter(e => e.type === 'done').length;

  const actNew  = document.getElementById('act-new');
  const actDone = document.getElementById('act-done');
  if (actNew)  actNew.textContent  = newCount;
  if (actDone) actDone.textContent = doneCount;

  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  if (!events.length) {
    feed.innerHTML = '<div class="empty-state"><p>No activity in this period.</p></div>';
    return;
  }

  const grouped = {};
  events.forEach(e => {
    if (!grouped[e.date]) grouped[e.date] = [];
    grouped[e.date].push(e);
  });

  const iconMap = { new:'＋', done:'✓', moved:'→', flag:'!' };
  feed.innerHTML = Object.keys(grouped).sort((a,b) => b.localeCompare(a)).map(date => {
    const label = new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' });
    const items = grouped[date].map(e => `
      <div class="activity-item" onclick="openJobModal('${e.job.id}')" style="cursor:pointer">
        <div class="activity-icon ${e.type}">${iconMap[e.type]||'·'}</div>
        <div class="activity-body">
          <div class="activity-title">${esc(e.title)}</div>
          <div class="activity-meta">${esc(e.meta)}</div>
        </div>
      </div>`).join('');
    return `<div class="activity-day-group">
      <div class="activity-day-label">${label}</div>
      ${items}
    </div>`;
  }).join('');
}

/* ── BOTTLENECK ── */
let bottleneckDays = 7; // default to last 7 days

function initBottleneckFilter() {
  document.querySelectorAll('.bottleneck-period').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bottleneck-period').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      bottleneckDays = btn.dataset.days === 'all' ? null : parseInt(btn.dataset.days);
      renderBottleneck();
    });
  });
}

function renderBottleneck() {
  // Filter jobs by period
  const now = new Date();
  const cutoff = bottleneckDays
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - bottleneckDays).toISOString().split('T')[0]
    : null;

  // For dwell times: include jobs active in the period
  // A job is "active in period" if it was raised before the period end AND is still open OR was completed after cutoff
  const periodJobs = jobs.filter(j => {
    if (!j.poDate) return false;
    if (!cutoff) return true;
    // Job raised within period, OR job still open and raised before period (shows current dwell)
    const lastDate = j.history?.[j.history.length - 1]?.date || j.poDate;
    return j.poDate >= cutoff || (j.status !== 'Job Done' && lastDate >= cutoff) || lastDate >= cutoff;
  });

  const totals = {};
  ACTIVE_STAGES.forEach(s => { totals[s] = { sum:0, c:0 }; });

  periodJobs.forEach(j => {
    // For open jobs: count days in CURRENT status only (more relevant for short periods)
    if (j.status !== 'Job Done' && ACTIVE_STAGES.includes(j.status)) {
      const daysInCurrent = daysBetween(j.poDate, null); // rough proxy
      // Use getDwellTimes for richer history, fallback to current status
      const dw = getDwellTimes(j);
      if (Object.keys(dw).length > 1) {
        ACTIVE_STAGES.forEach(s => { if (dw[s] !== undefined) { totals[s].sum += dw[s]; totals[s].c++; } });
      } else {
        // Single-entry job — count all time in current status
        totals[j.status].sum += daysInCurrent;
        totals[j.status].c++;
      }
    } else {
      const dw = getDwellTimes(j);
      ACTIVE_STAGES.forEach(s => { if (dw[s] !== undefined) { totals[s].sum += dw[s]; totals[s].c++; } });
    }
  });

  const avgs   = ACTIVE_STAGES.map(s => totals[s].c ? Math.round(totals[s].sum / totals[s].c) : 0);
  const maxAvg = Math.max(...avgs, 1);

  // Update subtitle
  const periodLabel = bottleneckDays
    ? `Last ${bottleneckDays} day${bottleneckDays !== 1 ? 's' : ''} · ${periodJobs.length} jobs`
    : `All time · ${periodJobs.length} jobs`;
  const subEl = document.getElementById('bottleneck-period-sub');
  if (subEl) subEl.textContent = `Average time in each stage — ${periodLabel}`;

  document.getElementById('bottleneck-bars').innerHTML = ACTIVE_STAGES.map((s, i) => {
    const pct     = Math.round(avgs[i] / maxAvg * 100);
    const flagged = avgs[i] > 14;
    return `<div class="stage-bar-row">
      <div class="stage-bar-meta">
        <span class="stage-bar-name">${s}</span>
        <span class="stage-bar-val" style="${flagged ? 'color:var(--red);font-weight:700' : ''}">${avgs[i]}d avg · ${totals[s].c} jobs</span>
      </div>
      <div class="stage-bar-bg"><div class="stage-bar-fill" style="width:${pct}%;background:${flagged ? 'var(--red)' : STAGE_COLORS[i]}"></div></div>
    </div>`;
  }).join('');

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: CHART_TICK, grid: CHART_GRID }, x: { ticks: CHART_TICK, grid: CHART_GRID } }
  };

  if (dwellChartInst) dwellChartInst.destroy();
  dwellChartInst = new Chart(document.getElementById('dwellChart'), {
    type: 'bar',
    data: { labels: ACTIVE_STAGES.map(s => s.replace('Waiting for ','Wait ')),
      datasets: [{ label:'Avg days', data: avgs,
        backgroundColor: avgs.map((v, i) => v > 14 ? 'rgba(220,38,38,0.7)' : STAGE_COLORS[i]),
        borderRadius: 6, borderWidth: 0 }] },
    options: { ...chartOpts,
      plugins: { ...chartOpts.plugins, tooltip: { callbacks: { label: ctx => ` ${ctx.raw}d avg` } } },
      scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, ticks: { ...CHART_TICK, callback: v => v + 'd' } } }
    }
  });

  const suppliers = [...new Set(periodJobs.map(j => j.supplier))].sort();
  const supAvg    = suppliers.map(s => {
    const sj = periodJobs.filter(j => j.supplier === s && j.status === 'Job Done');
    return sj.length ? Math.round(sj.reduce((a,j) => a + (getTotalDays(j)||0), 0) / sj.length) : 0;
  }).map((v, i) => ({ s: suppliers[i], v }))
    .filter(d => d.v > 0)
    .sort((a, b) => b.v - a.v);

  if (supplierChartInst) supplierChartInst.destroy();
  supplierChartInst = new Chart(document.getElementById('supplierChart'), {
    type: 'bar',
    data: { labels: supAvg.map(d => d.s), datasets: [{ label:'Avg days',
        data: supAvg.map(d => d.v),
        backgroundColor: supAvg.map(d => d.v > 21 ? 'rgba(220,38,38,0.7)' : d.v > 14 ? 'rgba(217,119,6,0.7)' : 'rgba(22,163,74,0.7)'),
        borderRadius: 6, borderWidth: 0 }] },
    options: { ...chartOpts, indexAxis: 'y',
      plugins: { ...chartOpts.plugins, tooltip: { callbacks: { label: ctx => ` ${ctx.raw}d avg` } } },
      scales: {
        x: { beginAtZero:true, ticks: { ...CHART_TICK, callback: v => v+'d' }, grid: CHART_GRID },
        y: { ticks: CHART_TICK, grid: { display:false } }
      }
    }
  });

  document.getElementById('dwell-tbody').innerHTML = periodJobs.map(j => {
    const dw   = getDwellTimes(j);
    const done = j.status === 'Job Done';
    const total= getTotalDays(j);
    const cell = (key, protect) => dw[key] !== undefined
      ? dayChip(dw[key], protect ? done : false)
      : '<span class="text-muted text-sm">—</span>';
    return `<tr onclick="openJobModal('${j.id}')">
      <td><span class="po-link">${esc(j.po)}</span></td>
      <td>${esc(j.supplier)}</td>
      <td class="ref-cell">${esc(j.ref||'—')}</td>
      <td>${cell('Incoming Job',true)}</td>
      <td>${cell('Job Booked',true)}</td>
      <td>${cell('Waiting for Parts',false)}</td>
      <td>${cell('Revisiting',false)}</td>
      <td>${badge(j.status)}</td>
      <td><strong class="mono" style="color:var(--text)">${total !== null ? total+'d' : '—'}</strong></td>
    </tr>`;
  }).join('');
}

/* ── ALL JOBS ── */
function renderJobs() {
  const fs  = document.getElementById('filter-status')?.value  || '';
  const fsu = document.getElementById('filter-supplier')?.value || '';
  const fq  = (document.getElementById('filter-search')?.value || '').toLowerCase();

  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  const supSel    = document.getElementById('filter-supplier');
  if (supSel) {
    const cur = supSel.value;
    supSel.innerHTML = '<option value="">All suppliers</option>' +
      suppliers.map(s => `<option ${s===cur?'selected':''}>${esc(s)}</option>`).join('');
  }

  const filtered = jobs.filter(j => {
    if (fs  && j.status   !== fs)  return false;
    if (fsu && j.supplier !== fsu) return false;
    if (fq  && !`${j.po} ${j.ref} ${j.supplier} ${j.equipment}`.toLowerCase().includes(fq)) return false;
    return true;
  });

  document.getElementById('jobs-count').textContent = `${filtered.length} of ${jobs.length} jobs`;

  if (!filtered.length) {
    document.getElementById('jobs-tbody').innerHTML =
      '<tr><td colspan="8"><div class="empty-state"><p>No jobs match your filters.</p></div></td></tr>';
    return;
  }

  document.getElementById('jobs-tbody').innerHTML = filtered.map(j => {
    const open    = daysBetween(j.poDate, j.status === 'Job Done' ? j.history?.[j.history.length-1]?.date : null);
    const dw      = getDwellTimes(j);
    const inStage = dw[j.status] !== undefined ? dw[j.status] : null;
    const isDone  = j.status === 'Job Done';
    const flagged = !isDone && (open||0) > 14;
    return `<tr class="${flagged?'flagged':''}" onclick="openJobModal('${j.id}')">
      <td><span class="po-link">${esc(j.po)}</span></td>
      <td class="ref-cell">${esc(j.ref||'—')}</td>
      <td>${esc(j.supplier)}</td>
      <td>${badge(j.status)}</td>
      <td>${dayChip(open,isDone)}</td>
      <td>${!isDone && inStage !== null ? dayChip(inStage,false) : '<span class="text-muted text-sm">—</span>'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtValue(j.value)}</td>
      <td onclick="event.stopPropagation()" style="text-align:right">
        <button class="btn btn-ghost btn-sm btn-icon" title="Edit" onclick="editJob('${j.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-danger btn-sm btn-icon" title="Delete" onclick="deleteJob('${j.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  const dl = document.getElementById('supplier-datalist');
  if (dl) dl.innerHTML = suppliers.map(s => `<option value="${esc(s)}">`).join('');
}

/* ── PARTS TRACKER ── */
function renderParts() {
  const tbody = document.getElementById('parts-tbody');
  if (!tbody) return;

  const waiting = jobs.filter(j => j.status === 'Waiting for Parts');

  if (!waiting.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>No jobs currently waiting on parts.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = waiting.map(j => {
    const pd      = partsData[j.id] || {};
    const waiting = daysBetween(j.poDate, null);
    const eta     = pd.eta || '';
    const etaDays = eta ? daysUntil(eta) : null;
    const etaOverdue = etaDays !== null && etaDays < 0;
    const etaToday   = etaDays !== null && etaDays === 0;
    let etaLabel = '';
    if (etaOverdue) {
      etaLabel = `<div style="font-size:10px;color:var(--red);margin-top:2px;font-weight:600">${Math.abs(etaDays)}d OVERDUE</div>`;
    } else if (etaToday) {
      etaLabel = `<div style="font-size:10px;color:var(--amber);margin-top:2px;font-weight:600">DUE TODAY</div>`;
    } else if (etaDays !== null) {
      etaLabel = `<div style="font-size:10px;color:var(--text3);margin-top:2px">${etaDays}d away</div>`;
    }
    return `<tr onclick="openJobModal('${j.id}')">
      <td><span class="po-link">${esc(j.po)}</span></td>
      <td class="ref-cell">${esc(j.ref||'—')}</td>
      <td>${esc(j.supplier)}</td>
      <td>${dayChip(waiting, false)}</td>
      <td onclick="event.stopPropagation()">
        <input class="parts-eta-input" type="text" placeholder="Part name / notes"
          value="${esc(pd.notes||'')}"
          onchange="updatePartsData('${j.id}','notes',this.value)"
          style="width:100%;max-width:200px">
      </td>
      <td onclick="event.stopPropagation()">
        <input class="parts-eta-input" type="date"
          value="${eta}"
          onchange="updatePartsData('${j.id}','eta',this.value)"
          style="${etaOverdue?'border-color:var(--red);color:var(--red)':etaToday?'border-color:var(--amber);color:var(--amber)':''}">
        ${etaLabel}
      </td>
      <td>${badge(j.status)}</td>
    </tr>`;
  }).join('');
}

function updatePartsData(jobId, field, value) {
  if (!partsData[jobId]) partsData[jobId] = {};
  partsData[jobId][field] = value;
  savePartsData();
  showToast('Parts info saved');
}

/* ── SUPPLIERS ── */
function renderSuppliers() {
  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  if (!suppliers.length) {
    document.getElementById('supplier-grid').innerHTML = '<div class="empty-state"><p>No jobs yet.</p></div>';
    return;
  }
  document.getElementById('supplier-grid').innerHTML = suppliers.map(s => {
    const sj      = jobs.filter(j => j.supplier === s);
    const done    = sj.filter(j => j.status === 'Job Done');
    const open    = sj.filter(j => j.status !== 'Job Done');
    const stuck   = open.filter(j => daysBetween(j.poDate,null) > 14).length;
    const avgTotal= done.length ? Math.round(done.reduce((a,j) => a + (getTotalDays(j)||0), 0) / done.length) : null;
    const pct     = sj.length ? Math.round(done.length / sj.length * 100) : 0;
    const st      = {};
    ACTIVE_STAGES.forEach(x => { st[x] = { sum:0, c:0 }; });
    sj.forEach(j => {
      const dw = getDwellTimes(j);
      ACTIVE_STAGES.forEach(x => { if (dw[x] !== undefined) { st[x].sum += dw[x]; st[x].c++; } });
    });
    return `<div class="card supplier-card">
      <div class="flex-between mb-12">
        <div class="supplier-name">${esc(s)}</div>
        ${stuck > 0 ? `<span class="badge b-waiting" style="cursor:pointer" onclick="openSupplierModal('${s}','overdue');event.stopPropagation()" title="Click to see overdue jobs">${stuck} overdue ↗</span>` : '<span class="badge b-done">On track</span>'}
      </div>
      <div class="supplier-meta">${sj.length} total · ${open.length} open · ${done.length} completed</div>
      <div class="supplier-stats">
        <div class="supplier-stat">
          <div class="supplier-stat-val">${pct}%</div>
          <div class="supplier-stat-label">Completion</div>
        </div>
        <div class="supplier-stat">
          <div class="supplier-stat-val">${avgTotal !== null ? avgTotal+'d' : '—'}</div>
          <div class="supplier-stat-label">Avg duration</div>
        </div>
        <div class="supplier-stat">
          <div class="supplier-stat-val" style="color:${stuck>0?'var(--amber)':'var(--text)'}">${stuck}</div>
          <div class="supplier-stat-label" style="color:${stuck>0?'var(--amber)':'inherit'}">Overdue</div>
        </div>
      </div>
      <div style="margin-bottom:14px">
        ${ACTIVE_STAGES.slice(1,3).map(x => {
          const avg = st[x].c ? Math.round(st[x].sum / st[x].c) : null;
          return `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span style="color:var(--text3)">${x}</span>
            <span class="mono" style="font-size:11px;color:var(--text2)">${avg !== null ? avg+'d avg' : '—'}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="completion-bar"><div class="completion-fill" style="width:${pct}%"></div></div>
      <div style="margin-top:12px;display:flex;gap:8px">
        ${open.length ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 10px" onclick="openSupplierModal('${s}','open');event.stopPropagation()">View open jobs (${open.length})</button>` : ''}
        ${done.length ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 10px" onclick="openSupplierModal('${s}','all');event.stopPropagation()">All jobs (${sj.length})</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ── REPORTS ── */
function renderReports() {
  const el = document.getElementById('reports-list');
  if (!el) return;

  if (!reportsData.length) {
    el.innerHTML = `<div class="empty-state">
      <p style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">No reports saved yet</p>
      <p>Click <strong>Save this week's snapshot</strong> after your Monday meeting to start building a history.</p>
    </div>`;
    return;
  }

  el.innerHTML = reportsData.map(r => {
    const d = new Date(r.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    return `<div class="card report-card">
      <div class="report-card-header">
        <div class="report-date">${d}</div>
        <button class="btn btn-danger btn-xs" onclick="deleteReport('${r.id}');event.stopPropagation()">Delete</button>
      </div>
      <div class="report-kpis">
        <div class="report-kpi"><strong>${r.openJobs}</strong>Open jobs</div>
        <div class="report-kpi"><strong>${r.doneJobs}</strong>Completed</div>
        <div class="report-kpi"><strong style="color:${r.stuck>0?'var(--amber)':'var(--green)'}">${r.stuck}</strong>Needs attention</div>
        <div class="report-kpi"><strong>${r.avgDays !== null ? r.avgDays+'d' : '—'}</strong>Avg duration</div>
        <div class="report-kpi"><strong>${r.openValue > 0 ? '$'+Math.round(r.openValue).toLocaleString() : '—'}</strong>Open value</div>
        <div class="report-kpi"><strong>${r.totalJobs}</strong>Total jobs</div>
      </div>
      ${r.attention && r.attention.length ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:8px">Needed attention at time of report</div>
          ${r.attention.map(a => `<div style="display:flex;gap:10px;align-items:center;padding:4px 0;font-size:12px">
            <span class="po-link">${esc(a.po)}</span>
            <span style="color:var(--text2)">${esc(a.ref||'—')}</span>
            <span style="color:var(--text3)">${esc(a.supplier)}</span>
            ${dayChip(a.days,false)}
          </div>`).join('')}
        </div>` : ''}
    </div>`;
  }).join('');
}

function deleteReport(id) {
  reportsData = reportsData.filter(r => r.id !== id);
  saveReports();
  renderReports();
  showToast('Report deleted');
}

/* ── JOB DETAIL MODAL ── */
function openJobModal(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  const hist  = j.history || [];
  const total = getTotalDays(j);

  const poEl = document.getElementById('modal-po');
  poEl.textContent = j.po;
  poEl.style.cursor = 'pointer';
  poEl.title = 'Click to copy PO number';
  poEl.onclick = () => {
    navigator.clipboard.writeText(j.po).then(() => showToast('PO number copied: ' + j.po));
  };
  document.getElementById('modal-ref').textContent  = j.ref || '';
  document.getElementById('modal-edit-btn').onclick = () => editJob(id);
  document.getElementById('modal-del-btn').onclick  = () => deleteJob(id);

  const tlHtml = hist.map((h, i) => {
    const next      = hist[i+1];
    const end       = next ? next.date : (j.status==='Job Done' ? hist[hist.length-1]?.date : null);
    const days      = end ? daysBetween(h.date,end) : daysBetween(h.date,null);
    const isCurrent = i === hist.length-1 && j.status !== 'Job Done';
    const isDone    = j.status === 'Job Done';
    const dotClass  = isDone ? 'done' : isCurrent ? 'current' : '';
    const chipCls   = isDone ? 'ok' : days > 14 ? 'danger' : days > 7 ? 'warn' : '';
    const isFinalDone = h.status === 'Job Done' && i === hist.length - 1;
    return `<div class="tl-item">
      <div class="tl-line-col">
        <div class="tl-dot ${dotClass}"></div>
        ${i < hist.length-1 ? '<div class="tl-connector"></div>' : ''}
      </div>
      <div class="tl-body">
        <div class="tl-status-name">${esc(h.status)} ${isCurrent ? badge(h.status) : ''}</div>
        <div class="tl-date">${h.date}${next?' → '+next.date:''}</div>
        ${!isFinalDone ? `<span class="day-chip ${chipCls}" style="margin-top:4px;display:inline-block">${days}d${isCurrent?' (still here)':''}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('modal-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:13px;margin-bottom:16px">
      <div><div class="text-muted text-sm mb-4">Supplier</div><div style="font-weight:600;color:var(--text)">${esc(j.supplier)}</div></div>
      <div><div class="text-muted text-sm mb-4">Equipment</div><div style="color:var(--text)">${esc(j.equipment||'—')}</div></div>
      <div><div class="text-muted text-sm mb-4">PO Date</div><div class="mono" style="color:var(--text)">${j.poDate}</div></div>
      <div><div class="text-muted text-sm mb-4">Total Open</div><div class="mono" style="font-weight:700;color:var(--text)">${total !== null ? total+' days' : '—'}</div></div>
      ${j.value ? `<div><div class="text-muted text-sm mb-4">Value</div><div class="mono" style="color:var(--text)">${fmtValue(j.value)}</div></div>` : ''}
      ${j.buyer ? `<div><div class="text-muted text-sm mb-4">Buyer</div><div style="color:var(--text)">${esc(j.buyer)}</div></div>` : ''}
      ${j.sourceDoc ? `<div><div class="text-muted text-sm mb-4">Source Doc</div><div class="mono" style="color:var(--text);font-size:12px">${esc(j.sourceDoc)}</div></div>` : ''}
    </div>
    ${j.notes ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;font-size:12px;color:var(--text2);margin-bottom:16px;white-space:pre-wrap">${esc(j.notes)}</div>` : ''}
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);margin-bottom:12px">Status history</div>
    <div class="timeline">${tlHtml}</div>
  `;
  document.getElementById('job-modal').classList.remove('hidden');
}

/* ── SUPPLIER JOBS MODAL ── */
function openSupplierModal(supplier, filter) {
  const sj = jobs.filter(j => j.supplier === supplier);
  let filtered, subtitle;
  if (filter === 'overdue') {
    filtered = sj.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14)
                  .sort((a,b) => daysBetween(b.poDate,null) - daysBetween(a.poDate,null));
    subtitle = `${filtered.length} overdue job${filtered.length !== 1 ? 's' : ''} (open > 14 days)`;
  } else if (filter === 'open') {
    filtered = sj.filter(j => j.status !== 'Job Done')
                  .sort((a,b) => daysBetween(b.poDate,null) - daysBetween(a.poDate,null));
    subtitle = `${filtered.length} open job${filtered.length !== 1 ? 's' : ''}`;
  } else {
    filtered = [...sj].sort((a,b) => (b.poDate||'').localeCompare(a.poDate||''));
    subtitle = `${filtered.length} total job${filtered.length !== 1 ? 's' : ''}`;
  }

  document.getElementById('supplier-modal-title').textContent = supplier;
  document.getElementById('supplier-modal-sub').textContent = subtitle;

  if (!filtered.length) {
    document.getElementById('supplier-modal-body').innerHTML =
      '<div class="empty-state" style="padding:24px"><p>No jobs in this category.</p></div>';
  } else {
    document.getElementById('supplier-modal-body').innerHTML = `
      <table style="margin-top:0">
        <thead><tr>
          <th style="width:120px">PO</th>
          <th>Reference</th>
          <th style="width:120px">Status</th>
          <th style="width:68px">Open</th>
          <th style="width:90px">Value</th>
        </tr></thead>
        <tbody>${filtered.map(j => {
          const open = daysBetween(j.poDate, j.status === 'Job Done' ? j.history?.[j.history.length-1]?.date : null);
          const isDone = j.status === 'Job Done';
          const flagged = !isDone && (open||0) > 14;
          return `<tr class="${flagged?'flagged':''}" onclick="openJobModal('${j.id}');closeSupplierModal()" style="cursor:pointer">
            <td><span class="po-link">${esc(j.po)}</span></td>
            <td class="ref-cell">${esc(j.ref||'—')}</td>
            <td>${badge(j.status)}</td>
            <td>${dayChip(open, isDone)}</td>
            <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtValue(j.value)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  document.getElementById('supplier-modal').classList.remove('hidden');
}

function closeSupplierModal() {
  document.getElementById('supplier-modal').classList.add('hidden');
}


function closeModal() {
  document.getElementById('job-modal').classList.add('hidden');
}

/* ── PERFORMANCE PAGE ── */
let perfThroughputInst, perfFixRateInst, perfDurationInst, perfSupplierInst;

function renderPerformance() {
  const periodEl = document.getElementById('perf-period');
  const months   = periodEl ? parseInt(periodEl.value) || 999 : 6;
  const now      = new Date();

  // Date cutoff
  const cutoff = isNaN(months) ? null : new Date(now.getFullYear(), now.getMonth() - months, 1);
  const cutoffStr = cutoff ? cutoff.toISOString().split('T')[0] : '2000-01-01';

  // Jobs completed in period
  const donePeriod = jobs.filter(j => {
    if (j.status !== 'Job Done') return false;
    const last = j.history?.[j.history.length - 1];
    return last && last.date >= cutoffStr;
  });

  // All jobs active in period (open or closed)
  const activePeriod = jobs.filter(j => (j.poDate || '') >= cutoffStr || j.status !== 'Job Done');

  // ── HELPER: get completion date ──
  const completedOn = j => j.history?.[j.history.length - 1]?.date || null;

  // ── DATA QUALITY NOTE ──
  // Jobs imported from Odoo without chatter history have only one history entry (import date)
  // For these jobs, getTotalDays counts from poDate → today for open jobs,
  // or poDate → poDate (=0) for done jobs with no separate completion date.
  // Duration metrics are most accurate for jobs where status changes have been tracked manually.

  // ── SCORECARD METRICS ──
  const totalDone    = donePeriod.length;
  const revisited    = donePeriod.filter(j => j.history?.some(h => h.status === 'Revisiting')).length;
  const fixRate      = totalDone > 0 ? Math.round((1 - revisited / totalDone) * 100) : null;
  const avgDuration  = totalDone > 0
    ? Math.round(donePeriod.reduce((a, j) => a + (getTotalDays(j) || 0), 0) / totalDone)
    : null;

  // Compare to previous period for trend arrows
  const prevCutoff    = cutoff ? new Date(cutoff.getFullYear(), cutoff.getMonth() - months, 1) : null;
  const prevCutoffStr = prevCutoff ? prevCutoff.toISOString().split('T')[0] : '2000-01-01';
  const prevDone = prevCutoff ? jobs.filter(j => {
    if (j.status !== 'Job Done') return false;
    const last = j.history?.[j.history.length - 1];
    return last && last.date >= prevCutoffStr && last.date < cutoffStr;
  }) : [];
  const prevFixRate   = prevDone.length > 0 ? Math.round((1 - prevDone.filter(j => j.history?.some(h => h.status === 'Revisiting')).length / prevDone.length) * 100) : null;
  const prevAvgDur    = prevDone.length > 0 ? Math.round(prevDone.reduce((a, j) => a + (getTotalDays(j) || 0), 0) / prevDone.length) : null;

  // Currently open jobs > 30 days
  const longOpen = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 30).length;

  // Avg parts wait — use open Waiting for Parts jobs (daysBetween poDate→now) + done jobs with dwell history
  const openPartsJobs = jobs.filter(j => j.status === 'Waiting for Parts' && (j.poDate||'') >= cutoffStr);
  const openPartsWaits = openPartsJobs.map(j => daysBetween(j.poDate, null)).filter(d => d > 0);
  const donePartsWaits = donePeriod.map(j => getDwellTimes(j)['Waiting for Parts']).filter(d => d !== undefined && d > 0);
  const allPartsWaits = [...openPartsWaits, ...donePartsWaits];
  const avgPartsWait = allPartsWaits.length ? Math.round(allPartsWaits.reduce((a, b) => a + b, 0) / allPartsWaits.length) : null;

  function trend(current, previous, lowerIsBetter = false) {
    if (current === null || previous === null) return '';
    const better = lowerIsBetter ? current < previous : current > previous;
    const same   = current === previous;
    if (same) return '<span style="color:var(--text3);font-size:12px;margin-left:6px">→ same</span>';
    const arrow  = better ? '↑' : '↓';
    const color  = better ? 'var(--green)' : 'var(--red)';
    const diff   = Math.abs(current - previous);
    return `<span style="color:${color};font-size:12px;font-weight:700;margin-left:6px">${arrow} ${diff}</span>`;
  }

  // ── RENDER SCORECARD ──
  const scorecard = document.getElementById('perf-scorecard');
  if (scorecard) {
    const fixClass  = fixRate === null ? '' : fixRate >= 80 ? 'good' : fixRate >= 70 ? '' : 'warn';
    const durClass  = avgDuration === null ? '' : avgDuration <= 14 ? 'good' : avgDuration <= 21 ? '' : 'warn';
    const openClass = longOpen === 0 ? 'good' : longOpen <= 3 ? '' : 'warn';
    scorecard.innerHTML = `
      <div class="metric-card ${fixRate !== null && fixRate >= 80 ? 'accent-green' : fixRate !== null && fixRate < 70 ? 'danger' : 'accent-blue'}">
        <div class="metric-label">First-Time Fix Rate</div>
        <div class="metric-value ${fixClass}">${fixRate !== null ? fixRate + '%' : '—'}${trend(fixRate, prevFixRate)}</div>
        <div class="metric-sub">Benchmark: 75–80% · ${revisited} revisit${revisited !== 1 ? 's' : ''} in period</div>
      </div>
      <div class="metric-card ${durClass === 'good' ? 'accent-green' : ''}">
        <div class="metric-label">Avg Job Duration</div>
        <div class="metric-value ${durClass}">${avgDuration !== null ? avgDuration + 'd' : '—'}${trend(avgDuration, prevAvgDur, true)}</div>
        <div class="metric-sub">PO raised → completed · ${totalDone} jobs</div>
      </div>
      <div class="metric-card accent-blue">
        <div class="metric-label">Jobs Completed</div>
        <div class="metric-value">${totalDone}${trend(totalDone, prevDone.length)}</div>
        <div class="metric-sub">In selected period</div>
      </div>
      <div class="metric-card ${openClass === 'good' ? 'accent-green' : openClass === 'warn' ? 'warn' : ''}">
        <div class="metric-label">Open > 30 Days</div>
        <div class="metric-value">${longOpen}</div>
        <div class="metric-sub">Needs escalation</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Parts Wait</div>
        <div class="metric-value">${avgPartsWait !== null ? avgPartsWait + 'd' : '—'}</div>
        <div class="metric-sub">Avg days in Waiting for Parts · ${openPartsJobs.length} currently waiting</div>
      </div>
    `;
  }

  // ── BUILD MONTHLY BUCKETS ──
  const buckets = [];
  for (let i = (isNaN(months) ? 23 : months - 1); i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key:   `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      completed: 0, revisited: 0, totalDays: 0, durCount: 0,
    });
  }

  donePeriod.forEach(j => {
    const cd = completedOn(j);
    if (!cd) return;
    const key  = cd.substring(0, 7);
    const slot = buckets.find(b => b.key === key);
    if (!slot) return;
    slot.completed++;
    if (j.history?.some(h => h.status === 'Revisiting')) slot.revisited++;
    const dur = getTotalDays(j);
    if (dur !== null) { slot.totalDays += dur; slot.durCount++; }
  });

  const labels   = buckets.map(b => b.label);
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { ...CHART_TICK }, grid: CHART_GRID },
      x: { ticks: { ...CHART_TICK, maxRotation: 45 }, grid: { display: false } }
    }
  };

  // ── THROUGHPUT CHART ──
  if (perfThroughputInst) perfThroughputInst.destroy();
  perfThroughputInst = new Chart(document.getElementById('perfThroughputChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: buckets.map(b => b.completed),
        backgroundColor: buckets.map(b => b.completed > 0 ? 'rgba(37,99,235,0.75)' : 'rgba(0,0,0,0.05)'),
        borderRadius: 6, borderWidth: 0,
      }]
    },
    options: { ...chartOpts,
      plugins: { ...chartOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} job${ctx.raw !== 1 ? 's' : ''} completed` } }
      }
    }
  });

  // ── FIX RATE CHART ──
  const fixRates = buckets.map(b => b.completed > 0 ? Math.round((1 - b.revisited / b.completed) * 100) : null);
  if (perfFixRateInst) perfFixRateInst.destroy();
  perfFixRateInst = new Chart(document.getElementById('perfFixRateChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: fixRates,
          borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.08)',
          tension: 0.35, fill: true, borderWidth: 2.5,
          pointBackgroundColor: fixRates.map(v => v === null ? 'transparent' : v >= 75 ? '#16a34a' : '#dc2626'),
          pointRadius: 4, spanGaps: true,
        },
        {
          // benchmark line at 75%
          data: buckets.map(() => 75),
          borderColor: 'rgba(217,119,6,0.5)', borderDash: [6, 4],
          borderWidth: 1.5, pointRadius: 0, fill: false,
          label: '75% benchmark',
        }
      ]
    },
    options: { ...chartOpts,
      plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 11, family: 'Plus Jakarta Sans' }, color: '#9ba3af' } },
        tooltip: { callbacks: { label: ctx => ctx.datasetIndex === 0 ? ` ${ctx.raw}% fix rate` : ' 75% benchmark' } }
      },
      scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, min: 0, max: 100, ticks: { ...CHART_TICK, callback: v => v + '%' } } }
    }
  });

  // ── AVG DURATION CHART ──
  const avgDurs = buckets.map(b => b.durCount > 0 ? Math.round(b.totalDays / b.durCount) : null);
  if (perfDurationInst) perfDurationInst.destroy();
  perfDurationInst = new Chart(document.getElementById('perfDurationChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: avgDurs,
        borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.07)',
        tension: 0.35, fill: true, borderWidth: 2.5,
        pointBackgroundColor: '#7c3aed', pointRadius: 4, spanGaps: true,
      }]
    },
    options: { ...chartOpts,
      plugins: { ...chartOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw}d avg` } }
      },
      scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, ticks: { ...CHART_TICK, callback: v => v + 'd' } } }
    }
  });

  // ── SERVICE CO. LEAGUE TABLE + CHART ──
  const suppliers = [...new Set(donePeriod.map(j => j.supplier))].sort();
  const supData   = suppliers.map(s => {
    const sj        = donePeriod.filter(j => j.supplier === s);
    const revisits  = sj.filter(j => j.history?.some(h => h.status === 'Revisiting')).length;
    const durations = sj.map(j => getTotalDays(j)).filter(d => d !== null);
    const avg       = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const fastest   = durations.length ? Math.min(...durations) : null;
    const slowest   = durations.length ? Math.max(...durations) : null;
    const fix       = sj.length ? Math.round((1 - revisits / sj.length) * 100) : null;
    return { s, count: sj.length, revisits, avg, fastest, slowest, fix };
  }).sort((a, b) => (a.avg || 999) - (b.avg || 999));

  if (perfSupplierInst) perfSupplierInst.destroy();
  perfSupplierInst = new Chart(document.getElementById('perfSupplierChart'), {
    type: 'bar',
    data: {
      labels: supData.map(d => d.s),
      datasets: [{
        data: supData.map(d => d.avg),
        backgroundColor: supData.map(d =>
          d.avg === null ? 'rgba(0,0,0,0.05)' :
          d.avg <= 14 ? 'rgba(22,163,74,0.7)' :
          d.avg <= 21 ? 'rgba(245,158,11,0.7)' : 'rgba(220,38,38,0.7)'
        ),
        borderRadius: 6, borderWidth: 0,
      }]
    },
    options: { ...chartOpts, indexAxis: 'y',
      plugins: { ...chartOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw}d avg` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { ...CHART_TICK, callback: v => v + 'd' }, grid: CHART_GRID },
        y: { ticks: CHART_TICK, grid: { display: false } }
      }
    }
  });

  // ── SUPPLIER TBODY ──
  const tbody = document.getElementById('perf-supplier-tbody');
  if (tbody) {
    tbody.innerHTML = !supData.length
      ? '<tr><td colspan="7"><div class="empty-state"><p>No completed jobs in this period.</p></div></td></tr>'
      : supData.map(d => {
          const fixCls = d.fix === null ? '' : d.fix >= 80 ? 'color:var(--green)' : d.fix < 70 ? 'color:var(--red)' : 'color:var(--amber)';
          const avgCls = d.avg === null ? '' : d.avg <= 14 ? 'color:var(--green)' : d.avg > 21 ? 'color:var(--red)' : '';
          return `<tr onclick="openSupplierModal('${esc(d.s)}','all')" style="cursor:pointer">
            <td style="font-weight:600">${esc(d.s)}</td>
            <td style="text-align:center">${d.count}</td>
            <td style="text-align:center">${d.revisits > 0 ? `<span style="color:var(--amber);font-weight:600">${d.revisits}</span>` : '<span style="color:var(--green)">0</span>'}</td>
            <td style="text-align:center;font-weight:700;${fixCls}">${d.fix !== null ? d.fix + '%' : '—'}</td>
            <td style="text-align:center;font-weight:700;${avgCls}">${d.avg !== null ? d.avg + 'd' : '—'}</td>
            <td style="text-align:center;color:var(--green)">${d.fastest !== null ? d.fastest + 'd' : '—'}</td>
            <td style="text-align:center;color:var(--red)">${d.slowest !== null ? d.slowest + 'd' : '—'}</td>
          </tr>`;
        }).join('');
  }

  // ── REVISIT LOG ──
  const revisitJobs = jobs.filter(j => j.history?.some(h => h.status === 'Revisiting') && (j.poDate || '') >= cutoffStr)
    .sort((a, b) => (b.poDate || '').localeCompare(a.poDate || ''));
  const revisitEl = document.getElementById('perf-revisit-list');
  if (revisitEl) {
    revisitEl.innerHTML = !revisitJobs.length
      ? '<div class="empty-state" style="padding:32px"><p>✓ No revisited jobs in this period.</p></div>'
      : `<table><thead><tr>
          <th style="width:110px">PO</th><th>Reference</th>
          <th style="width:140px">Service Co.</th>
          <th style="width:110px">Status</th>
          <th style="width:80px">Total days</th>
        </tr></thead>
        <tbody>${revisitJobs.map(j => `<tr onclick="openJobModal('${j.id}')" style="cursor:pointer">
          <td><span class="po-link">${esc(j.po)}</span></td>
          <td class="ref-cell">${esc(j.ref || '—')}</td>
          <td>${esc(j.supplier)}</td>
          <td>${badge(j.status)}</td>
          <td>${dayChip(getTotalDays(j), j.status === 'Job Done')}</td>
        </tr>`).join('')}</tbody></table>`;
  }
}

/* ── URGENT PAGE ── */
function renderUrgent() {
  const threshold = parseInt(document.getElementById('urgent-threshold')?.value || 21);
  const urgentJobs = jobs
    .filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) >= threshold)
    .sort((a, b) => daysBetween(b.poDate, null) - daysBetween(a.poDate, null));

  const criticalJobs = urgentJobs.filter(j => daysBetween(j.poDate, null) > 30);
  const revisiting   = urgentJobs.filter(j => j.status === 'Revisiting');
  const waitingParts = urgentJobs.filter(j => j.status === 'Waiting for Parts');

  // Sub label
  const subEl = document.getElementById('urgent-sub');
  if (subEl) subEl.textContent = `${urgentJobs.length} job${urgentJobs.length !== 1 ? 's' : ''} open ${threshold}+ days — review and take action`;

  // KPIs
  const kpiEl = document.getElementById('urgent-kpis');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="metric-card danger accent-red" style="--accent:var(--red)">
        <div class="metric-label">Total Overdue</div>
        <div class="metric-value" style="color:var(--red)">${urgentJobs.length}</div>
        <div class="metric-sub">Open ${threshold}+ days</div>
      </div>
      <div class="metric-card ${criticalJobs.length > 0 ? 'danger' : 'accent-green'}">
        <div class="metric-label">Critical (30d+)</div>
        <div class="metric-value" style="color:${criticalJobs.length > 0 ? 'var(--red)' : 'var(--green)'}">${criticalJobs.length}</div>
        <div class="metric-sub">Needs escalation now</div>
      </div>
      <div class="metric-card ${revisiting.length > 0 ? 'warn' : 'accent-green'}">
        <div class="metric-label">Revisiting</div>
        <div class="metric-value" style="color:${revisiting.length > 0 ? 'var(--amber)' : 'var(--green)'}">${revisiting.length}</div>
        <div class="metric-sub">Second visit required</div>
      </div>
      <div class="metric-card ${waitingParts.length > 0 ? 'warn' : 'accent-green'}">
        <div class="metric-label">Waiting on Parts</div>
        <div class="metric-value" style="color:${waitingParts.length > 0 ? 'var(--amber)' : 'var(--green)'}">${waitingParts.length}</div>
        <div class="metric-sub">Parts delay overdue</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Days Open</div>
        <div class="metric-value" style="color:var(--red)">${urgentJobs.length ? Math.round(urgentJobs.reduce((a,j) => a + daysBetween(j.poDate,null), 0) / urgentJobs.length) + 'd' : '—'}</div>
        <div class="metric-sub">Among overdue jobs</div>
      </div>
    `;
  }

  // By service co.
  const supEl = document.getElementById('urgent-by-supplier');
  if (supEl) {
    const supBreakdown = [...new Set(urgentJobs.map(j => j.supplier))]
      .map(s => {
        const sj      = urgentJobs.filter(j => j.supplier === s);
        const critical = sj.filter(j => daysBetween(j.poDate,null) > 30).length;
        const maxDays  = Math.max(...sj.map(j => daysBetween(j.poDate,null)));
        return { s, count: sj.length, critical, maxDays };
      })
      .sort((a, b) => b.count - a.count || b.maxDays - a.maxDays);

    supEl.innerHTML = !supBreakdown.length
      ? '<div class="empty-state" style="padding:24px"><p>No overdue jobs.</p></div>'
      : `<table>
          <thead><tr>
            <th>Service Co.</th>
            <th style="width:100px;text-align:center">Overdue jobs</th>
            <th style="width:100px;text-align:center">Critical (30d+)</th>
            <th style="width:110px;text-align:center">Longest open</th>
          </tr></thead>
          <tbody>${supBreakdown.map(d => `
            <tr onclick="openSupplierModal('${esc(d.s)}','overdue')" style="cursor:pointer">
              <td style="font-weight:600">${esc(d.s)}</td>
              <td style="text-align:center"><span class="day-chip danger">${d.count}</span></td>
              <td style="text-align:center">${d.critical > 0 ? `<span class="day-chip danger">${d.critical}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
              <td style="text-align:center">${dayChip(d.maxDays, false)}</td>
            </tr>`).join('')}</tbody>
        </table>`;
  }

  // Full list
  const tbody = document.getElementById('urgent-tbody');
  if (tbody) {
    tbody.innerHTML = !urgentJobs.length
      ? '<tr><td colspan="7"><div class="empty-state"><p>✓ No overdue jobs at this threshold.</p></div></td></tr>'
      : urgentJobs.map(j => {
          const days    = daysBetween(j.poDate, null);
          const chipCls = days > 30 ? 'danger' : days > 21 ? 'warn' : '';
          const rowCls  = days > 30 ? 'flagged' : '';
          return `<tr class="${rowCls}" onclick="openJobModal('${j.id}')" style="cursor:pointer">
            <td><span class="po-link">${esc(j.po)}</span></td>
            <td class="ref-cell">${esc(j.ref || '—')}</td>
            <td>${esc(j.supplier)}</td>
            <td>${badge(j.status)}</td>
            <td><span class="day-chip ${chipCls}">${days}d</span></td>
            <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtValue(j.value)}</td>
            <td style="font-size:11px;color:var(--text3);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(j.notes||'')}">${esc(j.notes||'—')}</td>
          </tr>`;
        }).join('');
  }
}
