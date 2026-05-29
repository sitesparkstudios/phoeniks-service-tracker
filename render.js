/* ============================================================
   render.js — All page render functions
   ============================================================ */

let statusChartInst, dwellChartInst, supplierChartInst, spendChartInst;

const CHART_GRID = { color: 'rgba(0,0,0,0.06)' };
const CHART_TICK = { color: '#9ba3af', font: { size: 11, family: 'Plus Jakarta Sans' } };

function renderAll() {
  renderDashboard();
  renderJobs();
  renderChatterLog();
  renderSuppliers();
  renderParts();
  renderReports();
  renderActivity();
  if (typeof updateNavBadges === 'function') updateNavBadges();
  if (typeof updateChatterBadge === 'function') updateChatterBadge();
  // Ops health banner — quick bottleneck snapshot
  const _allOpen = jobs.filter(isOpenService);
  const _totals = {};
  ACTIVE_STAGES.forEach(s => { _totals[s] = { sum:0, c:0 }; });
  _allOpen.forEach(j => {
    const dw = getDwellTimes(j);
    if (Object.keys(dw).length > 1) {
      ACTIVE_STAGES.forEach(s => { if (dw[s]!==undefined) { _totals[s].sum+=dw[s]; _totals[s].c++; } });
    } else if (ACTIVE_STAGES.includes(j.status)) {
      _totals[j.status].sum += daysBetween(j.poDate,null);
      _totals[j.status].c++;
    }
  });
  const _avgs = ACTIVE_STAGES.map(s => _totals[s].c ? Math.round(_totals[s].sum/_totals[s].c) : 0);
  renderDashHealthBanner(_avgs, _totals);
}

/* ── DASHBOARD ── */

/* ── DASHBOARD PERIOD FILTER ── */
let dashPeriodDays = 30;

function initDashPeriodFilter() {
  document.querySelectorAll('.dash-period').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-period').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dashPeriodDays = btn.dataset.days === 'all' ? null : parseInt(btn.dataset.days);
      renderDashboard();
    });
  });
}

function renderDashboard() {
  const now     = new Date();
  const cutoff  = dashPeriodDays
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - dashPeriodDays).toISOString().split('T')[0]
    : null;
  const periodJobs = cutoff ? jobs.filter(j => (j.poDate||'') >= cutoff) : jobs;
  const allOpen    = jobs.filter(isOpenService);
  const open       = periodJobs.filter(isOpenService);
  const done       = periodJobs.filter(j => j.status === 'Job Done');
  const stuck      = periodJobs.filter(j => isOpenService(j) && daysBetween(j.poDate, null) > 14);
  const maintenance = jobs.filter(j => j.status === 'Maintenance').length;
  const avgTotal   = done.length ? Math.round(done.reduce((a,j) => a + (getTotalDays(j)||0), 0) / done.length) : null;
  const yearSpend  = periodJobs.reduce((a,j) => a + (parseFloat(j.value)||0), 0);

  const _now = new Date();
  const _ord = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  const _day = _now.toLocaleDateString('en-AU', { weekday:'long' });
  const _month = _now.toLocaleDateString('en-AU', { month:'long', year:'numeric' });
  document.getElementById('dash-date').textContent = `${_day}, ${_ord(_now.getDate())} ${_month}`;

  // Week boundaries (needed for wins hero)
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1); weekStart.setHours(0,0,0,0);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const completedThisWeek = jobs.filter(j => {
    if (j.status !== 'Job Done') return false;
    const last = j.history?.[j.history.length-1];
    return last && last.date >= weekStartStr;
  });

  // ── WINS HERO BANNER ──
  const heroEl = document.getElementById('dash-wins-hero');
  if (heroEl) {
    // Compute quick wins for dashboard (reuse same logic as print report)
    const dashWins = [];
    const _weekDoneWithDur = done.filter(j => getTotalDays(j) !== null && ([...(j.history||[])].sort((a,b)=>(a.date||'')<(b.date||'')?-1:1).pop()?.date||'') >= weekStartStr);
    const _fastest = _weekDoneWithDur.length ? _weekDoneWithDur.reduce((a,b) => getTotalDays(a)<getTotalDays(b)?a:b) : null;
    const _allOpenNow = jobs.filter(isOpenService);
    const _critical = _allOpenNow.filter(j=>daysBetween(j.poDate,null)>=30);
    const _waiting  = _allOpenNow.filter(j=>j.status==='Waiting for Parts');
    const _revisit  = _allOpenNow.filter(j=>j.status==='Revisiting');
    const _suppAll  = [...new Set(_allOpenNow.map(j=>j.supplier))];
    const _onTrack  = _suppAll.filter(s=>_allOpenNow.filter(j=>j.supplier===s).every(j=>daysBetween(j.poDate,null)<21));
    const _newThis  = jobs.filter(j=>(j.poDate||'')>=weekStartStr).length;
    const _thisMonthKey2 = now.toISOString().substring(0,7);
    const _lastMonth2 = new Date(now.getFullYear(),now.getMonth()-1,1);
    const _lastMonthKey2 = _lastMonth2.toISOString().substring(0,7);
    const _doneThisMonth2 = done.filter(j=>{const l=j.history?.[j.history.length-1];return l&&l.date&&l.date.startsWith(_thisMonthKey2);}).length;
    const _doneLastMonth2 = done.filter(j=>{const l=j.history?.[j.history.length-1];return l&&l.date&&l.date.startsWith(_lastMonthKey2);}).length;
    const _resolvedStuck = completedThisWeek.filter(j=>getTotalDays(j)>=21);
    if (completedThisWeek.length > 0) dashWins.push(completedThisWeek.length + ' job' + (completedThisWeek.length!==1?'s':'') + ' completed this week');
    if (_fastest && getTotalDays(_fastest)<=7) dashWins.push('Fastest: ' + esc(_fastest.ref||_fastest.po) + ' in ' + getTotalDays(_fastest) + 'd');
    if (_doneThisMonth2 > _doneLastMonth2 && _doneLastMonth2>0) dashWins.push(_doneThisMonth2 + ' closed this month — up ' + (_doneThisMonth2-_doneLastMonth2) + ' vs last');
    if (_resolvedStuck.length > 0) dashWins.push(_resolvedStuck.length + ' long-runner' + (_resolvedStuck.length!==1?'s':'') + ' resolved');
    if (_onTrack.length===_suppAll.length && _suppAll.length>=2) dashWins.push('All ' + _suppAll.length + ' service cos. on track');
    else if (_onTrack.length>0) dashWins.push(_onTrack.length + ' service co' + (_onTrack.length!==1?'s':'') + ' fully on track');
    if (_newThis>0 && completedThisWeek.length>=_newThis) dashWins.push('Closed as many as opened — holding steady');
    if (_critical.length===0 && _allOpenNow.length>0) dashWins.push('No critical jobs (30d+)');
    if (_waiting.length===0 && _allOpenNow.length>0) dashWins.push('No parts delays');
    if (_revisit.length===0 && _allOpenNow.length>0) dashWins.push('Zero revisits this week');

    if (dashWins.length > 0) {
      heroEl.style.display = 'block';
      heroEl.innerHTML = `
        <div style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #86efac;border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#15803d;white-space:nowrap;flex-shrink:0">✅ This week</span>
          <div style="display:flex;flex-wrap:wrap;gap:6px;flex:1">
            ${dashWins.map(w=>`<span style="font-size:12px;color:#166534;padding:4px 12px;background:white;border:1px solid #86efac;border-radius:20px;font-weight:600">${w}</span>`).join('')}
          </div>
        </div>`;
    } else {
      heroEl.style.display = 'block';
      heroEl.innerHTML = `
        <div style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #86efac;border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">✅</span>
          <span style="font-size:13px;font-weight:600;color:#166534">All service jobs tracking normally — no issues detected</span>
        </div>`;
    }
  }

  // ── INVOICING HEALTH BANNER ──
  const now90h       = new Date(); now90h.setDate(now90h.getDate()-90);
  const cut90h       = now90h.toISOString().split('T')[0];
  const last90h      = jobs.filter(j=>(j.poDate||'')>=cut90h);
  const hasBillingData = last90h.some(j=>j.billingStatus);
  const waitingBillsJobs = last90h.filter(j=>j.billingStatus==='Waiting Bills');
  const healthEl = document.getElementById('invoicing-health');
  if (healthEl) {
    if (hasBillingData && waitingBillsJobs.length > 0) {
      const poList = waitingBillsJobs.map(j=>
        `<span onclick="openJobModal('${j.id}')" style="cursor:pointer;text-decoration:underline;font-family:'DM Mono',monospace;font-size:11px">${esc(j.po)}</span>`
      ).join(', ');
      healthEl.style.display = 'flex';
      healthEl.innerHTML = `<span style="font-size:15px;flex-shrink:0">📋</span>
        <span><strong>${waitingBillsJobs.length} job${waitingBillsJobs.length!==1?'s':''} waiting on bills</strong> — invoices raised in Odoo but supplier bills not yet matched. <strong>Action:</strong> Odoo → Purchases → match/confirm the supplier invoice on these POs: ${poList}</span>`;
    } else if (!hasBillingData) {
      const inv90h   = last90h.filter(j=>parseFloat(j.value)>0).length;
      const invRateH = last90h.length ? Math.round(inv90h/last90h.length*100) : null;
      if (invRateH !== null && invRateH < 50) {
        healthEl.style.display = 'flex';
        healthEl.innerHTML = `<span style="font-size:16px;flex-shrink:0">⚠️</span>
          <span><strong>Invoicing data incomplete:</strong> Only ${invRateH}% of jobs in last 90 days have a value. Re-import your Odoo CSV with the Billing Status column included for better visibility.</span>`;
      } else {
        healthEl.style.display = 'none';
      }
    } else {
      healthEl.style.display = 'none';
    }
  }

  document.getElementById('kpi-grid').innerHTML = `
    <div class="metric-card accent-blue">
      <div class="metric-label">Open Jobs</div>
      <div class="metric-value">${open.length}</div>
      <div class="metric-sub">${done.length} completed in period</div>
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
      <div class="metric-label">Total Spend</div>
      <div class="metric-value" style="font-size:${yearSpend > 99999 ? '20px' : '26px'}">
        ${yearSpend > 0 ? '$' + Math.round(yearSpend).toLocaleString() : '—'}
      </div>
      <div class="metric-sub">${dashPeriodDays ? 'Last ' + dashPeriodDays + 'd' : 'All time'} · ${periodJobs.length} POs</div>
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
  const sColors = { 'Incoming Job':'#2563eb','Job Booked':'#7c3aed','Waiting for Parts':'#d97706','Revisiting':'#b8960a','Awaiting Closeout':'#0d9488','Job Done':'#16a34a','Maintenance':'#6b7280' };
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

  // Ops health banner — computed from all open jobs (not period-filtered)
  const _allOpen = jobs.filter(isOpenService);
  const _totals = {};
  ACTIVE_STAGES.forEach(s => { _totals[s] = { sum:0, c:0 }; });
  _allOpen.forEach(j => {
    const dw = getDwellTimes(j);
    if (Object.keys(dw).length > 1) {
      ACTIVE_STAGES.forEach(s => { if (dw[s] !== undefined) { _totals[s].sum += dw[s]; _totals[s].c++; } });
    } else if (ACTIVE_STAGES.includes(j.status)) {
      _totals[j.status].sum += daysBetween(j.poDate, null);
      _totals[j.status].c++;
    }
  });
  const _avgs = ACTIVE_STAGES.map(s => _totals[s].c ? Math.round(_totals[s].sum / _totals[s].c) : 0);
  renderDashHealthBanner(_avgs, _totals);
}

/* ── SPEND CHART ── */
function renderSpendChart() {
  const canvas = document.getElementById('spendChart');
  if (!canvas) return;
  const allMonths = getMonthlySpend();
  // Always show last 12 months only — slice from the end
  const months  = allMonths.slice(-12);
  const hasSpend = months.some(m => m.total > 0);
  const hasJobs  = months.some(m => m.count > 0);
  if (spendChartInst) spendChartInst.destroy();
  if (!hasJobs) {
    canvas.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3);font-size:12px">Spend data appears after importing jobs with values from Odoo</div>';
    return;
  }

  // If we have job counts but no spend values, show job volume instead with a note
  const noteEl = canvas.parentElement.querySelector('.spend-note');
  if (!hasSpend) {
    if (!noteEl) {
      const note = document.createElement('div');
      note.className = 'spend-note';
      note.style.cssText = 'font-size:11px;color:var(--text3);margin-bottom:6px;padding:0 4px';
      note.textContent = 'Showing job volume — re-import Odoo CSV with Order Total column to see spend';
      canvas.parentElement.insertBefore(note, canvas);
    }
  } else if (noteEl) {
    noteEl.remove();
  }

  spendChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        hasSpend ? {
          label: 'Monthly Spend ($)',
          data: months.map(m => m.total),
          backgroundColor: months.map((m,i) => i === months.length-1 ? 'rgba(61,64,67,0.95)' : m.total > 0 ? 'rgba(61,64,67,0.75)' : 'rgba(0,0,0,0.06)'),
          borderRadius: 6, borderWidth: 0,
          yAxisID: 'y',
        } : {
          label: 'Jobs',
          data: months.map(m => m.count),
          backgroundColor: months.map((m,i) => i === months.length-1 ? 'rgba(61,64,67,0.95)' : 'rgba(61,64,67,0.65)'),
          borderRadius: 6, borderWidth: 0,
          yAxisID: 'y',
        },
        hasSpend && months.some(m => m.count > 0) ? {
          label: 'Jobs',
          data: months.map(m => m.count),
          type: 'line',
          borderColor: 'rgba(255,209,0,0.9)',
          backgroundColor: 'rgba(255,209,0,0.15)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(255,209,0,1)',
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'y2',
        } : null,
      ].filter(Boolean),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: hasSpend, labels: { boxWidth: 10, padding: 12, font: { size: 11, family: 'Plus Jakarta Sans' }, color: '#5a6270' } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y2' ? ` ${ctx.raw} jobs` : hasSpend ? ' $' + Math.round(ctx.raw).toLocaleString() : ` ${ctx.raw} jobs` } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { ...CHART_TICK, callback: v => hasSpend ? '$'+(v>=1000?(v/1000).toFixed(0)+'k':v) : v }, grid: CHART_GRID },
        ...(hasSpend ? { y2: { beginAtZero: true, position: 'right', ticks: { ...CHART_TICK, callback: v => v+'j' }, grid: { display: false } } } : {}),
        x: { ticks: CHART_TICK, grid: { display: false } },
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
    const sjd = sj.filter(j => getTotalDays(j) !== null);
    return sjd.length ? Math.round(sjd.reduce((a,j) => a + getTotalDays(j), 0) / sjd.length) : 0;
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
      <td>${cell('Awaiting Closeout',false)}</td>
      <td>${badge(j.status)}</td>
      <td><strong class="mono" style="color:var(--text)">${total !== null ? total+'d' : '—'}</strong></td>
    </tr>`;
  }).join('');

  // ── ACTIONABLE STEPS ──
  renderBottleneckActions(avgs, totals);
  renderDashHealthBanner(avgs, totals);
}

function renderBottleneckActions(avgs, totals) {
  const el = document.getElementById('bottleneck-actions');
  if (!el) return;

  const stageNames = ACTIVE_STAGES;
  const actions = [];

  // Incoming Job slow
  const incomingAvg = avgs[0];
  if (incomingAvg > 7) {
    actions.push({
      stage: 'Incoming Job',
      color: incomingAvg > 14 ? 'var(--red)' : 'var(--amber)',
      icon: '📥',
      title: `Incoming Job averaging ${incomingAvg}d before being booked`,
      steps: [
        'Review all "Incoming Job" POs — are service cos. acknowledging receipt?',
        'Set a 48-hour acknowledgement SLA — if no response, call and escalate',
        'Check if POs are being sent to the right contact at each service company',
        'Consider chasing any job sitting Incoming for more than 3 days directly',
      ]
    });
  }

  // Job Booked slow
  const bookedAvg = avgs[1];
  if (bookedAvg > 10) {
    actions.push({
      stage: 'Job Booked',
      color: bookedAvg > 21 ? 'var(--red)' : 'var(--amber)',
      icon: '📅',
      title: `Job Booked averaging ${bookedAvg}d before work starts`,
      steps: [
        'Ask service companies for their next available booking dates — long delays suggest capacity issues',
        'For urgent jobs, request priority booking and follow up by phone',
        'If a service co. is consistently slow to book, consider splitting work with an alternative in that region',
        'Set a target: jobs should move from Booked to active within 5 working days',
      ]
    });
  }

  // Waiting for Parts slow
  const partsAvg = avgs[2];
  const partsCount = totals['Waiting for Parts']?.c || 0;
  if (partsAvg > 14 || partsCount > 3) {
    actions.push({
      stage: 'Waiting for Parts',
      color: partsAvg > 21 ? 'var(--red)' : 'var(--amber)',
      icon: '🔩',
      title: `${partsCount} jobs stuck waiting on parts (avg ${partsAvg}d)`,
      steps: [
        'Ask each service co. for an ETA on parts — log these in the Parts Tracker',
        'For parts overdue by more than 2 weeks, contact the OEM or supplier directly',
        'Check if a different supplier has the part in stock — sometimes faster to source elsewhere',
        'Consider pre-stocking common consumables (elements, igniters, thermostats) to reduce wait times',
        'Ask service cos. to confirm part orders have been placed, not just requested',
      ]
    });
  }

  // Revisiting slow
  const revisitAvg = avgs[3];
  const revisitCount = totals['Revisiting']?.c || 0;
  if (revisitAvg > 14 || revisitCount > 2) {
    actions.push({
      stage: 'Revisiting',
      color: revisitAvg > 21 ? 'var(--red)' : 'var(--amber)',
      icon: '🔁',
      title: `${revisitCount} jobs revisiting (avg ${revisitAvg}d) — indicates first-visit failures`,
      steps: [
        'Review each revisiting job — was the fault properly diagnosed on the first visit?',
        'Request a written debrief from the service co. on why a second visit was needed',
        'Track which service cos. have the most revisits — feed into performance reviews',
        'For jobs revisiting more than twice, escalate to a senior technician or different company',
        'Check if revisits are due to parts arriving and needing fitting — these may be unavoidable',
      ]
    });
  }

  if (!actions.length) {
    el.innerHTML = `<div class="card" style="padding:20px 24px;margin-top:20px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:22px">✅</span>
        <div>
          <div style="font-weight:700;color:var(--text)">All stages within normal thresholds</div>
          <div style="font-size:13px;color:var(--text3);margin-top:2px">No bottlenecks detected for this period. Keep monitoring weekly.</div>
        </div>
      </div>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="margin-top:20px">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);margin-bottom:12px">Actionable Steps</div>
    <div style="display:flex;flex-direction:column;gap:12px">
    ${actions.map(a => `
      <div class="card" style="padding:16px 20px;border-left:3px solid ${a.color}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:18px">${a.icon}</span>
          <span style="font-weight:700;font-size:13px;color:var(--text)">${a.title}</span>
        </div>
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px">
          ${a.steps.map(s => `<li style="font-size:12px;color:var(--text2);line-height:1.5">${s}</li>`).join('')}
        </ol>
      </div>
    `).join('')}
    </div>
  </div>`;
}

/* ── ALL JOBS ── */
function getSelectedStatuses() {
  const cbs = document.querySelectorAll('.fs-cb');
  if (!cbs.length) return null; // no filter = all
  const checked = [...cbs].filter(c => c.checked).map(c => c.value);
  return checked;
}

function switchJobsTab(tab) {
  const allBtn  = document.getElementById('jobs-tab-all');
  const chatBtn = document.getElementById('jobs-tab-chatter');
  const allDiv  = document.getElementById('jobs-tab-all-content');
  const chatDiv = document.getElementById('jobs-tab-chatter-content');
  if (!allBtn) return;
  if (tab === 'all') {
    allBtn.style.borderBottomColor  = 'var(--text)';
    allBtn.style.color              = 'var(--text)';
    chatBtn.style.borderBottomColor = 'transparent';
    chatBtn.style.color             = 'var(--text3)';
    allDiv.style.display  = 'block';
    chatDiv.style.display = 'none';
  } else {
    chatBtn.style.borderBottomColor = 'var(--text)';
    chatBtn.style.color             = 'var(--text)';
    allBtn.style.borderBottomColor  = 'transparent';
    allBtn.style.color              = 'var(--text3)';
    allDiv.style.display  = 'none';
    chatDiv.style.display = 'block';
    renderChatterLog();
  }
}

function renderChatterLog() {
  const el = document.getElementById('chatter-log-body');
  if (!el) return;

  // A job "has chatter" if it has status transitions OR notes were captured from a chatter paste
  const hasChatter = j => (j.history||[]).length > 1 || (j.notes && j.notes.trim().length > 20);

  // Open jobs only — exclude Job Done and Maintenance
  const open = jobs
    .filter(j => j.status !== 'Job Done' && j.status !== 'Maintenance')
    .sort((a, b) => {
      const aHist = hasChatter(a);
      const bHist = hasChatter(b);
      if (aHist !== bHist) return aHist ? 1 : -1;
      return daysBetween(b.poDate, null) - daysBetween(a.poDate, null);
    });

  const noHistory  = open.filter(j => !hasChatter(j));
  const hasHistory = open.filter(j => hasChatter(j));

  // Update badge
  const badge = document.getElementById('chatter-needs-badge');
  if (badge) {
    if (noHistory.length > 0) { badge.textContent = noHistory.length + ' need updating'; badge.style.display = 'inline'; }
    else { badge.style.display = 'none'; }
  }

  const STATUS_COLOR = {'Incoming Job':'#2563eb','Job Booked':'#7c3aed','Waiting for Parts':'#d97706','Revisiting':'#b8960a','Awaiting Closeout':'#0d9488'};

  const row = j => {
    const hist   = hasChatter(j);
    const stages = (j.history||[]).length > 1 ? [...new Set(j.history.map(h=>h.status))].length - 1 : 0;
    const d      = daysBetween(j.poDate, null);
    const sc     = STATUS_COLOR[j.status] || '#6b7280';
    const lastEntry = hist ? [...j.history].sort((a,b)=>(a.date||'')<(b.date||'')?1:-1)[0] : null;
    const lastUpdated = lastEntry ? lastEntry.date : null;
    const daysSinceUpdate = lastUpdated ? daysBetween(lastUpdated, null) : null;
    const stale = hist && daysSinceUpdate !== null && daysSinceUpdate > 14;

    let indicator, indicatorText, rowBg;
    if (!hist) {
      // Never had chatter pasted — genuinely needs updating
      indicator = '#dc2626'; indicatorText = 'No chatter logged'; rowBg = 'rgba(220,38,38,0.03)';
    } else if (stale) {
      indicator = '#d97706'; indicatorText = `Last update ${daysSinceUpdate}d ago — worth checking`; rowBg = 'rgba(217,119,6,0.03)';
    } else {
      indicator = '#16a34a'; indicatorText = `${stages} transition${stages!==1?'s':''}${lastUpdated?' · updated '+lastUpdated:''}`; rowBg = '';
    }

    return `<tr style="background:${rowBg};cursor:pointer" onclick="openJobModal('${j.id}')">
      <td style="padding:10px 12px;width:8px">
        <div style="width:8px;height:8px;border-radius:50%;background:${indicator};flex-shrink:0"></div>
      </td>
      <td style="padding:10px 8px;white-space:nowrap">
        <span class="po-link" style="font-family:'DM Mono',monospace;font-size:12px">${esc(j.po)}</span>
      </td>
      <td style="padding:10px 8px;max-width:320px">
        <div style="font-weight:600;font-size:13px;color:var(--text)">${esc(j.ref||'—')}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px">${esc(j.supplier||'')}</div>
      </td>
      <td style="padding:10px 8px">
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${sc}18;color:${sc}">${j.status}</span>
      </td>
      <td style="padding:10px 8px;white-space:nowrap">
        <span style="font-size:12px;font-weight:600;color:${d>21?'#dc2626':d>14?'#d97706':'var(--text2)'}">${d}d open</span>
      </td>
      <td style="padding:10px 8px">
        <span style="font-size:11px;color:${indicator};font-weight:600">${indicatorText}</span>
      </td>
      <td style="padding:10px 8px;text-align:right" onclick="event.stopPropagation()">
        <button class="btn btn-primary btn-sm" onclick="editJob('${j.id}')" style="font-size:11px;padding:5px 12px">
          + Update chatter
        </button>
      </td>
    </tr>`;
  };

  let html = '';

  if (noHistory.length > 0) {
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0"></div>
      <span style="font-size:12px;font-weight:700;color:#dc2626">${noHistory.length} job${noHistory.length!==1?'s':''} with no chatter history — needs updating</span>
    </div>`;
  }

  html += `<div class="card" style="margin-bottom:20px">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:16px">
        <span style="font-size:13px;font-weight:700">${open.length} open jobs</span>
        <span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:12px">
          <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#dc2626;margin-right:4px"></span>No chatter (${noHistory.length})</span>
          <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#d97706;margin-right:4px"></span>Stale &gt;14d</span>
          <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a;margin-right:4px"></span>Up to date</span>
        </span>
      </div>
      <span style="font-size:11px;color:var(--text3)">Click any row to view · "+ Update chatter" to edit</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th style="width:16px"></th>
          <th style="width:90px">PO</th>
          <th>Reference / Service Co.</th>
          <th style="width:140px">Status</th>
          <th style="width:90px">Age</th>
          <th>Chatter</th>
          <th style="width:140px"></th>
        </tr></thead>
        <tbody>${open.map(j => row(j)).join('')}</tbody>
      </table>
    </div>
  </div>`;

  el.innerHTML = html;
}

function renderJobs() {
  const selectedStatuses = getSelectedStatuses();
  const fsu = document.getElementById('filter-supplier')?.value || '';
  const fq  = (document.getElementById('filter-search')?.value || '').toLowerCase();

  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  const supSel    = document.getElementById('filter-supplier');
  if (supSel) {
    const cur = supSel.value;
    supSel.innerHTML = '<option value="">All service cos.</option>' +
      suppliers.map(s => `<option ${s===cur?'selected':''}>${esc(s)}</option>`).join('');
  }

  const filtered = jobs.filter(j => {
    if (selectedStatuses && selectedStatuses.length < 8 && !selectedStatuses.includes(j.status)) return false;
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
    const open    = daysBetween(j.poDate, (j.status === 'Job Done' || j.status === 'Awaiting Closeout') ? [...(j.history||[])].sort((a,b)=>(a.date||'')<(b.date||'')?-1:1).pop()?.date : null);
    const dw      = getDwellTimes(j);
    const inStage = dw[j.status] !== undefined ? dw[j.status] : null;
    const isDone  = j.status === 'Job Done';
    const isCloseout = j.status === 'Awaiting Closeout';
    const flagged = !isDone && !isCloseout && (open||0) > 14;
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
function renderSuppliers() {  const sortEl  = document.getElementById('supplier-sort');  const stateEl = document.getElementById('supplier-state');  const sortBy  = sortEl ? sortEl.value : 'name';  const stateFilter = stateEl ? stateEl.value : '';  const tags = loadSupplierTags();  let suppliers = [...new Set(jobs.map(j => j.supplier).filter(Boolean))];  // State filter using pre-loaded map + user tags  if (stateFilter) {    suppliers = suppliers.filter(s => getSupplierState(s, tags) === stateFilter);  }  if (!suppliers.length) {    document.getElementById('supplier-grid').innerHTML = stateFilter      ? `<div class="empty-state"><p>No service companies tagged as <strong>${stateFilter}</strong>. <a href="#" onclick="showPage('supplier-tags');return false" style="color:var(--blue)">Tag your companies →</a></p></div>`      : '<div class="empty-state"><p>No jobs yet.</p></div>';    return;  }
  // Build stats for sorting
  const stats = suppliers.map(s => {
    const sj      = jobs.filter(j => j.supplier === s);
    const done    = sj.filter(j => j.status === 'Job Done');
    const open    = sj.filter(j => j.status !== 'Job Done' && j.status !== 'Maintenance');
    const overdue = open.filter(j => daysBetween(j.poDate,null) > 14).length;
    const critical= open.filter(j => daysBetween(j.poDate,null) > 30).length;
    const doneWithDur = done.filter(j => getTotalDays(j) !== null);
    const avgTotal= doneWithDur.length ? Math.round(doneWithDur.reduce((a,j) => a + getTotalDays(j), 0) / doneWithDur.length) : null;
    const pct     = sj.length ? Math.round(done.length / sj.length * 100) : 0;
    const st      = {};
    ACTIVE_STAGES.forEach(x => { st[x] = { sum:0, c:0 }; });
    sj.forEach(j => {
      const dw = getDwellTimes(j);
      ACTIVE_STAGES.forEach(x => { if (dw[x] !== undefined) { st[x].sum += dw[x]; st[x].c++; } });
    });
    return { s, sj, done, open, overdue, critical, avgTotal, pct, st };
  });

  // Sort
  if (sortBy === 'overdue') stats.sort((a,b) => b.overdue - a.overdue || b.open.length - a.open.length);
  else if (sortBy === 'open') stats.sort((a,b) => b.open.length - a.open.length || b.overdue - a.overdue);
  else if (sortBy === 'avg') stats.sort((a,b) => (b.avgTotal||0) - (a.avgTotal||0));
  else stats.sort((a,b) => a.s.localeCompare(b.s));

  document.getElementById('supplier-grid').innerHTML = stats.map(({ s, sj, done, open, overdue, critical, avgTotal, pct, st }) => {
    return `<div class="card supplier-card">
      <div class="flex-between mb-12">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="supplier-name">${esc(s)}</div>
          ${getSupplierState(s,tags) ? `<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;background:var(--surface2);border:1px solid var(--border);color:var(--text3)">${getSupplierState(s,tags)}</span>` : `<span style="font-size:10px;color:var(--text3);cursor:pointer" onclick="showPage('supplier-tags')" title="Tag this company's state">+ tag</span>`}
        </div>
        ${critical > 0
          ? `<span class="badge b-waiting" style="cursor:pointer;background:var(--red);color:#fff" onclick="openSupplierModal('${s}','overdue');event.stopPropagation()" title="Click to see overdue jobs">${critical} critical ↗</span>`
          : overdue > 0
            ? `<span class="badge b-waiting" style="cursor:pointer" onclick="openSupplierModal('${s}','overdue');event.stopPropagation()" title="Click to see overdue jobs">${overdue} overdue ↗</span>`
            : '<span class="badge b-done">On track</span>'}
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
          <div class="supplier-stat-val" style="color:${overdue>0?'var(--amber)':'var(--text)'}">${overdue}</div>
          <div class="supplier-stat-label" style="color:${overdue>0?'var(--amber)':'inherit'}">Overdue</div>
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
        ${(r.byStatus?.['Awaiting Closeout']||0) > 0 ? `<div class="report-kpi"><strong style="color:#0d9488">${r.byStatus['Awaiting Closeout']}</strong>Awaiting closeout</div>` : ''}
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
  // Always sort history oldest→newest for display and dwell calculation
  const hist  = [...(j.history || [])].sort((a,b) => (a.date||'') < (b.date||'') ? -1 : (a.date||'') > (b.date||'') ? 1 : 0);
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
    const isDone    = j.status === 'Job Done';
    const end       = next ? next.date : (isDone ? hist[hist.length-1]?.date : null);
    const days      = end ? daysBetween(h.date,end) : daysBetween(h.date,null);
    const isCurrent = i === hist.length-1 && !isDone;
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
      ${j.billingStatus ? `<div><div class="text-muted text-sm mb-4">Billing Status</div><div style="font-weight:600;color:${j.billingStatus==='Fully Billed'?'var(--green)':j.billingStatus==='Waiting Bills'?'var(--amber)':'var(--text2)'}">${esc(j.billingStatus)}</div></div>` : ''}
      ${j.amountToInvoice && parseFloat(j.amountToInvoice) < 0 ? `<div><div class="text-muted text-sm mb-4">Amount Overbilled</div><div class="mono" style="color:var(--red);font-weight:700">${fmtValue(Math.abs(parseFloat(j.amountToInvoice)))}</div></div>` : ''}
      ${j.amountToInvoice && parseFloat(j.amountToInvoice) > 0 ? `<div><div class="text-muted text-sm mb-4">Amount to Invoice</div><div class="mono" style="color:var(--amber);font-weight:700">${fmtValue(j.amountToInvoice)}</div></div>` : ''}
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
          const open = daysBetween(j.poDate, (j.status === 'Job Done' || j.status === 'Awaiting Closeout') ? [...(j.history||[])].sort((a,b)=>(a.date||'')<(b.date||'')?-1:1).pop()?.date : null);
          const isDone = j.status === 'Job Done';
          const isCloseout = j.status === 'Awaiting Closeout';
          const flagged = !isDone && !isCloseout && (open||0) > 14;
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
  const months   = periodEl ? parseInt(periodEl.value) || 999 : 999;
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

  // ── DATA QUALITY BANNER ──
  const doneJobs        = jobs.filter(j => j.status === 'Job Done');
  const withDuration    = doneJobs.filter(j => getTotalDays(j) !== null).length;
  const withHistory     = doneJobs.filter(j => (j.history||[]).length > 1).length;
  const noHistory       = doneJobs.length - withHistory;
  const durPct          = doneJobs.length ? Math.round(withDuration / doneJobs.length * 100) : 0;
  const histPct         = doneJobs.length ? Math.round(withHistory / doneJobs.length * 100) : 0;
  const openNoHistory   = jobs.filter(j => j.status !== 'Job Done' && (j.history||[]).length <= 1).length;
  const dataNote        = document.getElementById('perf-data-note');
  if (dataNote) {
    if (doneJobs.length === 0) {
      dataNote.style.display = 'none';
    } else if (durPct >= 80 && histPct >= 80) {
      dataNote.style.background = 'rgba(22,163,74,0.06)';
      dataNote.style.borderColor = 'rgba(22,163,74,0.2)';
      dataNote.innerHTML = '<span style="font-size:16px;flex-shrink:0">✅</span> '
        + '<span style="color:var(--green)"><strong>Good data quality</strong> — ' + durPct + '% of completed jobs have duration data. Metrics are reliable.</span>';
    } else {
      dataNote.style.background = 'rgba(217,119,6,0.08)';
      dataNote.style.borderColor = 'rgba(217,119,6,0.25)';
      const lines = [];
      if (durPct < 80) lines.push('<div>📅 <strong>' + noHistory + ' completed job' + (noHistory !== 1 ? 's' : '') + '</strong> have no chatter history — duration and fix rate data is missing. Open each job → Edit → paste the Odoo chatter to fix.</div>');
      if (openNoHistory > 0) lines.push('<div>📋 <strong>' + openNoHistory + ' open job' + (openNoHistory !== 1 ? 's' : '') + '</strong> only have their import date — status changes not yet recorded.</div>');
      lines.push('<div style="color:var(--text3);margin-top:2px">Duration data: <strong>' + durPct + '%</strong> complete · History: <strong>' + histPct + '%</strong> complete.</div>');
      dataNote.innerHTML = '<span style="font-size:16px;flex-shrink:0">⚠️</span>'
        + '<div style="color:var(--text2)">'
        + '<div style="font-weight:700;color:var(--text);margin-bottom:6px">Data quality check — some metrics may be incomplete</div>'
        + '<div style="display:flex;flex-direction:column;gap:4px;font-size:12px">' + lines.join('') + '</div>'
        + '</div>';
    }
  }

  // ── SCORECARD METRICS ──
  const totalDone    = donePeriod.length;
  // A job counts as revisited if: history shows Revisiting status, OR notes/ref mention revisit
  // For Odoo imports without full history, we can only detect via history entries
  const isRevisited = j => j.history?.some(h => h.status === 'Revisiting') || j.status === 'Revisiting';
  const revisited    = donePeriod.filter(isRevisited).length;
  const fixRate      = totalDone > 0 ? Math.round((1 - revisited / totalDone) * 100) : null;
  const _durJobs = donePeriod.filter(j => getTotalDays(j) !== null);
  const avgDuration  = _durJobs.length > 0
    ? Math.round(_durJobs.reduce((a, j) => a + getTotalDays(j), 0) / _durJobs.length)
    : null;

  // Compare to previous period for trend arrows
  const prevCutoff    = cutoff ? new Date(cutoff.getFullYear(), cutoff.getMonth() - months, 1) : null;
  const prevCutoffStr = prevCutoff ? prevCutoff.toISOString().split('T')[0] : '2000-01-01';
  const prevDone = prevCutoff ? jobs.filter(j => {
    if (j.status !== 'Job Done') return false;
    const last = j.history?.[j.history.length - 1];
    return last && last.date >= prevCutoffStr && last.date < cutoffStr;
  }) : [];
  const prevFixRate   = prevDone.length > 0 ? Math.round((1 - prevDone.filter(isRevisited).length / prevDone.length) * 100) : null;
  const _prevDurJobs = prevDone.filter(j => getTotalDays(j) !== null);
  const prevAvgDur    = _prevDurJobs.length > 0 ? Math.round(_prevDurJobs.reduce((a, j) => a + getTotalDays(j), 0) / _prevDurJobs.length) : null;

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
    if (isRevisited(j)) slot.revisited++;
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
  const perfSortEl = document.getElementById('perf-supplier-sort');
  const perfSort = perfSortEl ? perfSortEl.value : 'jobs';
  let sortedSupData = [...supData];
  if (perfSort === 'jobs') sortedSupData.sort((a,b) => b.count - a.count);
  else if (perfSort === 'fix') sortedSupData.sort((a,b) => (b.fix||0) - (a.fix||0));
  else sortedSupData.sort((a,b) => (a.avg||999) - (b.avg||999));
  if (tbody) {
    tbody.innerHTML = !sortedSupData.length
      ? '<tr><td colspan="7"><div class="empty-state"><p>No completed jobs in this period.</p></div></td></tr>'
      : sortedSupData.map(d => {
          const fixCls = d.fix === null ? '' : d.fix >= 80 ? 'color:var(--green)' : d.fix < 70 ? 'color:var(--red)' : 'color:var(--amber)';
          const avgCls = d.avg === null ? 'color:var(--text3)' : d.avg <= 14 ? 'color:var(--green)' : d.avg > 21 ? 'color:var(--red)' : '';
          return `<tr onclick="openSupplierModal('${esc(d.s)}','all')" style="cursor:pointer">
            <td style="font-weight:600">${esc(d.s)}</td>
            <td style="text-align:center">${d.count}</td>
            <td style="text-align:center">${d.revisits > 0 ? `<span style="color:var(--amber);font-weight:600">${d.revisits}</span>` : '<span style="color:var(--green)">0</span>'}</td>
            <td style="text-align:center;font-weight:700;${fixCls}">${d.fix !== null ? d.fix + '%' : '—'}</td>
            <td style="text-align:center;font-weight:700;${avgCls}">${d.avg !== null ? d.avg + 'd' : '<span style="font-size:11px;color:var(--text3)" title="No tracked completion dates for this company in period">—</span>'}</td>
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
    .filter(j => isOpenService(j) && daysBetween(j.poDate, null) >= threshold)
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

/* ══════════════════════════════════════════════════════
   PRINT REPORT — Monday Morning Summary
   One A4 page, portrait, all key info at a glance
   ══════════════════════════════════════════════════════ */
function buildPrintReport() {
  const now     = new Date();
  const ordinal = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  const dateStr = `${ordinal(now.getDate())} ${now.toLocaleDateString('en-AU',{month:'long',year:'numeric'})}`;
  const dayName = now.toLocaleDateString('en-AU',{weekday:'long'});
  const fmtD    = v => v != null ? v + 'd' : '—';

  const allOpen    = jobs.filter(isOpenService);
  const done       = jobs.filter(j => j.status === 'Job Done');
  const urgent     = allOpen.filter(j => daysBetween(j.poDate,null) >= 21).sort((a,b)=>daysBetween(b.poDate,null)-daysBetween(a.poDate,null));
  const critical   = allOpen.filter(j => daysBetween(j.poDate,null) >= 30);
  const waiting    = allOpen.filter(j => j.status === 'Waiting for Parts').sort((a,b)=>daysBetween(b.poDate,null)-daysBetween(a.poDate,null));
  const revisiting = allOpen.filter(j => j.status === 'Revisiting').sort((a,b)=>daysBetween(b.poDate,null)-daysBetween(a.poDate,null));

  const now90 = new Date(); now90.setDate(now90.getDate()-90);
  const cut90 = now90.toISOString().split('T')[0];
  const recent90    = done.filter(j=>(j.poDate||'')>=cut90);
  const _r90dur     = recent90.filter(j=>getTotalDays(j)!==null);
  const avgDur      = _r90dur.length ? Math.round(_r90dur.reduce((a,j)=>a+getTotalDays(j),0)/_r90dur.length) : null;
  const revisited90 = recent90.filter(j=>j.history?.some(h=>h.status==='Revisiting')).length;
  const fixRate     = recent90.length ? Math.round((1-revisited90/recent90.length)*100) : null;

  const partsWaits = waiting.map(j=>daysBetween(j.poDate,null)).filter(d=>d>0);
  const avgParts   = partsWaits.length ? Math.round(partsWaits.reduce((a,b)=>a+b,0)/partsWaits.length) : null;
  const avgRevisit = revisiting.length ? Math.round(revisiting.reduce((a,j)=>a+daysBetween(j.poDate,null),0)/revisiting.length) : null;

  // Bottleneck
  const stageTotals = {};
  ACTIVE_STAGES.forEach(s=>{ stageTotals[s]={sum:0,c:0}; });
  allOpen.forEach(j=>{ if(ACTIVE_STAGES.includes(j.status)){ stageTotals[j.status].sum+=daysBetween(j.poDate,null); stageTotals[j.status].c++; } });
  const stageAvgs = ACTIVE_STAGES.map(s=>({ s, avg: stageTotals[s].c?Math.round(stageTotals[s].sum/stageTotals[s].c):0, count:stageTotals[s].c })).filter(d=>d.count>0).sort((a,b)=>b.avg-a.avg);

  // Billing status
  const waitingBills = jobs.filter(j=>j.billingStatus==='Waiting Bills');
  const fullyBilled  = jobs.filter(j=>j.billingStatus==='Fully Billed').length;

  // Week number
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);

  // Completed this week
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1); weekStart.setHours(0,0,0,0);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const completedThisWeek = done.filter(j => {
    const last = j.history?.[j.history.length-1];
    return last && last.date >= weekStartStr;
  });

  // Last week comparison
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate()-7);
  const lastWeekStartStr = lastWeekStart.toISOString().split('T')[0];
  const completedLastWeek = done.filter(j => {
    const last = j.history?.[j.history.length-1];
    return last && last.date >= lastWeekStartStr && last.date < weekStartStr;
  });
  const weekVsLastWeek = completedThisWeek.length - completedLastWeek.length;

  // Longest single open job
  const longestJob = allOpen.length ? allOpen.reduce((a,b) => daysBetween(b.poDate,null) > daysBetween(a.poDate,null) ? b : a) : null;
  const longestDays = longestJob ? daysBetween(longestJob.poDate,null) : 0;

  // ── WINS DATA ──
  // Fastest job completed this week
  const weekDoneWithDur = completedThisWeek.filter(j => getTotalDays(j) !== null);
  const fastestThisWeek = weekDoneWithDur.length
    ? weekDoneWithDur.reduce((a,b) => getTotalDays(a) < getTotalDays(b) ? a : b)
    : null;

  // Jobs completed this month vs last month
  const thisMonthKey = now.toISOString().substring(0,7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastMonthKey = lastMonth.toISOString().substring(0,7);
  const doneThisMonth = done.filter(j => {
    const last = j.history?.[j.history.length-1];
    return last && last.date && last.date.startsWith(thisMonthKey);
  }).length;
  const doneLastMonth = done.filter(j => {
    const last = j.history?.[j.history.length-1];
    return last && last.date && last.date.startsWith(lastMonthKey);
  }).length;

  // Suppliers with zero overdue jobs (have open jobs but none overdue)
  const suppliersWithOpenJobs = [...new Set(allOpen.map(j=>j.supplier))];
  const onTrackSuppliers = suppliersWithOpenJobs.filter(s => {
    const sOpen = allOpen.filter(j=>j.supplier===s);
    return sOpen.length > 0 && sOpen.every(j=>daysBetween(j.poDate,null) < 21);
  });

  // Jobs closed out this week that were previously stuck (>21d when resolved)
  const resolvedStuck = completedThisWeek.filter(j => getTotalDays(j) >= 21);

  // Total jobs open this week vs last week (rough — jobs with poDate in last 7d)
  const newJobsThisWeek = jobs.filter(j => (j.poDate||'') >= weekStartStr).length;

  // Extra wins data
  const closeoutThisWeek = jobs.filter(j => {
    if (j.status !== 'Awaiting Closeout') return false;
    const last = j.history?.[j.history.length-1];
    return last && last.date >= weekStartStr;
  });
  const under7days = done.filter(j => getTotalDays(j) !== null && getTotalDays(j) <= 7);
  const under3days = done.filter(j => getTotalDays(j) !== null && getTotalDays(j) <= 3);
  const noCritical = critical.length === 0 && allOpen.length > 0;
  const noWaiting  = waiting.length === 0 && allOpen.length > 0;
  const noRevisiting = revisiting.length === 0 && allOpen.length > 0;
  const allSuppliersOnTrack = onTrackSuppliers.length === suppliersWithOpenJobs.length && suppliersWithOpenJobs.length > 0;
  const completedLast30 = done.filter(j => {
    const last = j.history?.[j.history.length-1];
    const cut30 = new Date(now); cut30.setDate(cut30.getDate()-30);
    return last && last.date >= cut30.toISOString().split('T')[0];
  });
  const bestSingleWeekInMonth = (() => {
    // Find the week in the last 30d with the most completions (to compare vs this week)
    let best = 0;
    for (let w = 1; w <= 4; w++) {
      const ws = new Date(weekStart); ws.setDate(ws.getDate() - w*7);
      const we = new Date(ws); we.setDate(we.getDate()+7);
      const wsStr = ws.toISOString().split('T')[0];
      const weStr = we.toISOString().split('T')[0];
      const cnt = done.filter(j => { const l=j.history?.[j.history.length-1]; return l && l.date>=wsStr && l.date<weStr; }).length;
      if (cnt > best) best = cnt;
    }
    return best;
  })();

  // Build wins array
  const wins = [];

  // Completions this week
  if (completedThisWeek.length > 0)
    wins.push(completedThisWeek.length + ' job' + (completedThisWeek.length!==1?'s':'') + ' completed this week');

  // Best week this month
  if (completedThisWeek.length > 0 && completedThisWeek.length > bestSingleWeekInMonth)
    wins.push('Best week of the month — ' + completedThisWeek.length + ' done');

  // Fastest turnaround this week
  if (fastestThisWeek && getTotalDays(fastestThisWeek) <= 7)
    wins.push('Fastest: ' + esc(fastestThisWeek.ref||fastestThisWeek.po) + ' closed in ' + getTotalDays(fastestThisWeek) + 'd');

  // Same-day or next-day close
  if (fastestThisWeek && getTotalDays(fastestThisWeek) <= 1)
    wins.push('Same-day close this week 🔥');

  // Monthly trend
  if (doneThisMonth > doneLastMonth && doneLastMonth > 0)
    wins.push(doneThisMonth + ' closed this month — up ' + (doneThisMonth-doneLastMonth) + ' vs last');

  // Long-running jobs resolved
  if (resolvedStuck.length > 0)
    wins.push(resolvedStuck.length + ' long-runner' + (resolvedStuck.length!==1?'s':'') + ' finally resolved');

  // All suppliers on track
  if (allSuppliersOnTrack && suppliersWithOpenJobs.length >= 2)
    wins.push('All ' + suppliersWithOpenJobs.length + ' service cos. on track');
  else if (onTrackSuppliers.length > 0)
    wins.push(onTrackSuppliers.length + ' service co' + (onTrackSuppliers.length!==1?'s':'') + ' fully on track');

  // Holding steady
  if (newJobsThisWeek > 0 && completedThisWeek.length >= newJobsThisWeek)
    wins.push('Closed as many as opened — holding steady');

  // No critical jobs
  if (noCritical)
    wins.push('No critical jobs (30d+) — clean sheet');

  // No parts delays
  if (noWaiting)
    wins.push('No parts delays this week');

  // No revisiting
  if (noRevisiting)
    wins.push('Zero revisits — first-time fix streak');

  // Awaiting closeout progress (paperwork moving)
  if (closeoutThisWeek.length > 0)
    wins.push(closeoutThisWeek.length + ' job' + (closeoutThisWeek.length!==1?'s':'') + ' moved to closeout this week');

  // Strong recent throughput
  if (completedLast30.length >= 10)
    wins.push(completedLast30.length + ' jobs closed in the last 30 days');

  // Under-7-day close rate (at least 3 quick jobs)
  if (under7days.length >= 3 && done.length > 0) {
    const pct = Math.round(under7days.length / done.length * 100);
    if (pct >= 30) wins.push(pct + '% of all jobs closed within 7 days');
  }

  // Fix rate trend — compare last 90d vs 90-180d
  const now180 = new Date(); now180.setDate(now180.getDate()-180);
  const cut180 = now180.toISOString().split('T')[0];
  const prev90 = done.filter(j=>(j.poDate||'')>=cut180 && (j.poDate||'')<cut90);
  const prevRevisited = prev90.filter(j=>j.history?.some(h=>h.status==='Revisiting')).length;
  const prevFixRate   = prev90.length ? Math.round((1-prevRevisited/prev90.length)*100) : null;
  const fixRateTrend  = fixRate !== null && prevFixRate !== null ? fixRate - prevFixRate : null;

  // Auto-generated headline — lead with positive, then concerns
  const headlines = [];
  // Positive first
  if (completedThisWeek.length > 0) headlines.push(completedThisWeek.length + ' job' + (completedThisWeek.length!==1?'s':'') + ' completed this week');
  if (doneThisMonth > doneLastMonth && doneLastMonth > 0) headlines.push('completions up vs last month');
  // Then concerns
  if (critical.length > 0) headlines.push(critical.length + ' critical job' + (critical.length>1?'s':'') + ' need attention');
  else if (urgent.length > 0) headlines.push(urgent.length + ' job' + (urgent.length>1?'s':'') + ' overdue 21d+');
  if (stageAvgs[0] && stageAvgs[0].avg > 21) headlines.push(stageAvgs[0].s.replace('Waiting for ','Wait ') + ' bottleneck at ' + stageAvgs[0].avg + 'd avg');
  const headline = headlines.length ? headlines.join(' · ') : 'All service jobs tracking normally — no critical issues';

  // Most overdue service co.
  const topSupplier = [...new Set(urgent.map(j=>j.supplier))]
    .map(s=>({ s, count: urgent.filter(j=>j.supplier===s).length }))
    .sort((a,b)=>b.count-a.count)[0] || null;

  // Monthly volume
  const mBuckets = [];
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(),now.getMonth()-i,1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mJobs = jobs.filter(j=>(j.poDate||'').startsWith(key) && isServiceJob(j));
    mBuckets.push({ label:d.toLocaleDateString('en-AU',{month:'short',year:'2-digit'}), count:mJobs.length });
  }

  // ── SERVICE CO. BREAKDOWN ──
  const supplierNames = [...new Set(allOpen.map(j=>j.supplier).filter(Boolean))];
  const supplierStats = supplierNames.map(s => {
    const sJobs = allOpen.filter(j=>j.supplier===s);
    const sUrgent = sJobs.filter(j=>daysBetween(j.poDate,null)>=21).length;
    const sCritical = sJobs.filter(j=>daysBetween(j.poDate,null)>=30).length;
    const sAvg = sJobs.length ? Math.round(sJobs.reduce((a,j)=>a+daysBetween(j.poDate,null),0)/sJobs.length) : 0;
    return { s, total:sJobs.length, urgent:sUrgent, critical:sCritical, avg:sAvg };
  }).filter(x=>x.total>0).sort((a,b)=>b.critical-a.critical||b.urgent-a.urgent||b.total-a.total);

  /* ── HELPERS ── */
  const th = (txt,align='left',width='') => `<th style="padding:4px 6px;text-align:${align};border-bottom:2px solid #e5e7eb;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;background:#fafafa;white-space:nowrap${width?';width:'+width:''}">${txt}</th>`;
  const td = (txt,style='') => `<td style="padding:3px 6px;${style}">${txt}</td>`;

  const sHead = (title,color='#1e2024',sub='') => `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 5px;padding-bottom:4px;border-bottom:2px solid ${color}">
      <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:${color}">${title}</span>
      ${sub?`<span style="font-size:9px;color:#9ba3af;font-weight:500">${sub}</span>`:''}
    </div>`;

  const kpi = (val, label, color='#1e2024', sub='', bg='#f8f9fa', border='#e5e7eb') => `
    <div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:8px 6px;text-align:center;position:relative;overflow:hidden">
      <div style="font-size:22px;font-weight:800;color:${color};line-height:1;letter-spacing:-0.5px">${val}</div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-top:3px;line-height:1.3">${label}</div>
      ${sub?`<div style="font-size:7.5px;color:#9ba3af;margin-top:1px">${sub}</div>`:''}
    </div>`;

  const pill = (txt, color, bg) => `<span style="display:inline-block;padding:2px 6px;border-radius:10px;font-size:8px;font-weight:700;background:${bg};color:${color}">${txt}</span>`;

  const statusDot = (days) => {
    if (days>=30) return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0;margin-top:1px"></span>`;
    if (days>=21) return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d97706;flex-shrink:0;margin-top:1px"></span>`;
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0;margin-top:1px"></span>`;
  };

  const jobRow = (j, withNotes=false) => {
    const d = daysBetween(j.poDate,null);
    const rowBg = d>=30?'#fff8f8':d>=21?'#fffcf0':'';
    const dayCol = d>=30?'#dc2626':d>=21?'#d97706':'#374151';
    const ref = esc(j.ref||'—');
    const sup = esc(j.supplier||'—');
    const mainRow = `<tr class="job-block" style="border-bottom:${withNotes?'none':'1px solid #e8e8e8'};background:${rowBg}">
      <td style="padding:4px 4px;width:14px;vertical-align:top">${statusDot(d)}</td>
      <td style="padding:4px 5px;white-space:nowrap;vertical-align:top"><span style="font-family:'DM Mono',monospace;font-size:8.5px;color:#6b7280">${esc(j.po)}</span></td>
      <td style="padding:4px 5px;vertical-align:top"><span style="font-weight:600;font-size:9.5px;color:#1e2024">${ref}</span></td>
      <td style="padding:4px 5px;vertical-align:top"><span style="color:#6b7280;font-size:9px">${sup}</span></td>
      <td style="padding:4px 5px;text-align:right;white-space:nowrap;vertical-align:top"><strong style="color:${dayCol};font-size:10px">${d}d</strong></td>
    </tr>`;
    if (!withNotes) return mainRow;
    const notesRow = `<tr style="border-bottom:1px solid #e8e8e8;background:${rowBg}">
      <td style="padding:0 4px 5px;"></td>
      <td colspan="4" style="padding:2px 5px 6px;">
        <span style="font-size:8px;font-weight:600;color:#9ba3af;text-transform:uppercase;letter-spacing:0.05em">Notes: </span>
        <span style="display:inline-block;border-bottom:1px solid #d1d5db;width:calc(100% - 42px);vertical-align:bottom;">&nbsp;</span>
      </td>
    </tr>`;
    return mainRow + notesRow;
  };

  // ── VOLUME SPARKLINE BARS ──
  const maxVol = Math.max(...mBuckets.map(b=>b.count),1);
  const volBars = mBuckets.map(b => {
    const pct = Math.round(b.count/maxVol*100);
    const isLatest = b === mBuckets[mBuckets.length-1];
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">
      <div style="font-size:8px;font-weight:${isLatest?'800':'600'};color:${isLatest?'#1e2024':'#6b7280'}">${b.count}</div>
      <div style="width:100%;background:#e5e7eb;border-radius:3px 3px 0 0;height:18px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${Math.max(pct,5)}%;background:${isLatest?'#3d4043':'#d1d5db'};border-radius:3px 3px 0 0;transition:height 0.2s"></div>
      </div>
      <div style="font-size:6.5px;color:#9ba3af;text-align:center">${b.label}</div>
    </div>`;
  }).join('');

  const html = `
  <div style="width:100%;font-family:'Plus Jakarta Sans',sans-serif;font-size:10px;color:#1e2024;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box">

    <!-- ══ HEADER ══ -->
    <div style="display:flex;justify-content:space-between;align-items:stretch;margin-bottom:10px;gap:0">

      <!-- Brand block -->
      <div style="display:flex;align-items:center;gap:14px;padding:12px 18px;background:#FFD100;border-radius:8px;flex-shrink:0">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px">
          <div style="width:9px;height:9px;border-radius:50%;background:#3d4043"></div>
          <div style="width:9px;height:9px;border-radius:50%;background:#3d4043"></div>
          <div style="width:9px;height:9px;border-radius:50%;background:#3d4043"></div>
          <div style="width:9px;height:9px;border-radius:50%;background:transparent;border:2px solid rgba(61,64,67,0.4);box-sizing:border-box"></div>
        </div>
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:1.5px;color:#3d4043;line-height:1">PHOENIKS</div>
          <div style="font-size:8px;font-weight:600;letter-spacing:0.18em;color:rgba(61,64,67,0.6);margin-top:2px">ELECTRIC KITCHEN SPECIALISTS</div>
        </div>
      </div>

      <!-- Centre headline -->
      <div style="flex:1;display:flex;align-items:center;padding:0 18px;background:#f8f9fa;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb">
        <div>
          <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#9ba3af">Monday Morning Report</div>
          <div style="font-size:15px;font-weight:700;color:#1e2024;margin-top:2px">${dayName}, ${dateStr}</div>
          <div style="font-size:9.5px;color:#6b7280;margin-top:3px">${headline}</div>
        </div>
      </div>

      <!-- Meta block -->
      <div style="text-align:right;padding:12px 16px;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;display:flex;flex-direction:column;justify-content:center;gap:3px;flex-shrink:0;min-width:140px">
        <div style="font-size:9px;color:#9ba3af;line-height:1.5">Sean Pickford<br>Technical Service Manager</div>
      </div>
    </div>

    <!-- ══ KPI STRIP ══ -->
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:10px">
      ${kpi(allOpen.length,'Open Jobs','#1e2024','all service jobs','#f8f9fa')}
      ${kpi(urgent.length,'Overdue 21d+',urgent.length>0?'#dc2626':'#16a34a',urgent.length>0?`${critical.length} critical`:'all on track',urgent.length>0?'#fff8f8':'#f0fdf4',urgent.length>0?'#fecaca':'#bbf7d0')}
      ${kpi(critical.length,'Critical 30d+',critical.length>0?'#dc2626':'#16a34a','needs action now',critical.length>0?'#fff8f8':'#f8f9fa',critical.length>0?'#fecaca':'#e5e7eb')}
      ${kpi(waiting.length,'Parts Waiting','#d97706',avgParts?`avg ${avgParts}d open`:'','#fffcf0','#fde68a')}
      ${kpi(revisiting.length,'Revisiting',revisiting.length>0?'#d97706':'#16a34a',avgRevisit?`avg ${avgRevisit}d`:'none','#fffcf0','#fde68a')}
      ${kpi(doneThisMonth,'Closed This Month',doneThisMonth>doneLastMonth?'#16a34a':doneThisMonth===doneLastMonth?'#374151':'#d97706',doneLastMonth>0?(doneThisMonth>doneLastMonth?'▲ up vs last month':doneThisMonth===doneLastMonth?'same as last month':'▼ down vs last month'):'month to date',doneThisMonth>0?'#f0fdf4':'#f8f9fa',doneThisMonth>0?'#bbf7d0':'#e5e7eb')}
      ${kpi(avgDur!==null?avgDur+'d':'—','Avg Duration','#1e2024','last 90 days','#f8f9fa')}
    </div>

    <!-- ══ WINS STRIP ══ -->
    ${wins.length ? `
    <div style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #86efac;border-radius:7px;padding:7px 14px;margin-bottom:10px;display:flex;align-items:center;gap:8px;overflow:hidden">
      <span style="font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#15803d;white-space:nowrap;flex-shrink:0">✅ Wins</span>
      <div style="display:flex;flex-wrap:nowrap;gap:5px;overflow:hidden;min-width:0">
        ${wins.map(w => `<span style="font-size:9px;color:#166534;padding:3px 10px;background:white;border:1px solid #86efac;border-radius:10px;font-weight:600;white-space:nowrap">${w}</span>`).join('')}
      </div>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:7px 12px;margin-bottom:10px">
      <span style="font-size:9px;font-weight:700;color:#16a34a">✅ All jobs tracking normally — no critical issues this week</span>
    </div>`}

    <!-- ══ ALL OPEN JOBS — full width ══ -->
    ${(() => {
      const STATUS_ORDER = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting','Awaiting Closeout'];
      const STATUS_COLOR = {'Revisiting':'#b8960a','Waiting for Parts':'#d97706','Incoming Job':'#2563eb','Job Booked':'#7c3aed','Awaiting Closeout':'#0d9488'};
      const STATUS_BG    = {'Revisiting':'#fffcf0','Waiting for Parts':'#fffcf0','Incoming Job':'#eff6ff','Job Booked':'#f5f3ff','Awaiting Closeout':'#f0fdfa'};
      const sorted = [...allOpen].sort((a,b) => {
        const oa = STATUS_ORDER.indexOf(a.status)===-1?99:STATUS_ORDER.indexOf(a.status);
        const ob = STATUS_ORDER.indexOf(b.status)===-1?99:STATUS_ORDER.indexOf(b.status);
        if (oa!==ob) return oa-ob;
        return daysBetween(b.poDate,null)-daysBetween(a.poDate,null);
      });
      const showNotes = sorted.length <= 40;
      const fz = sorted.length > 35 ? '8.5px' : '9px';
      const rp = sorted.length > 35 ? '2px 5px' : '3px 5px';
      let rows = '';
      let lastStatus = null;
      sorted.forEach(j => {
        const d = daysBetween(j.poDate,null);
        const rowBg = d>=30?'#fff8f8':d>=21?'#fffcf0':'';
        const dayCol = d>=30?'#dc2626':d>=21?'#d97706':'#374151';
        const sc = STATUS_COLOR[j.status]||'#6b7280';
        const sb = STATUS_BG[j.status]||'#f8f9fa';
        if (j.status !== lastStatus) {
          const grp = sorted.filter(x=>x.status===j.status);
          const ga  = grp.length ? Math.round(grp.reduce((a,x)=>a+daysBetween(x.poDate,null),0)/grp.length) : 0;
          rows += `<tr><td colspan="6" style="padding:5px 6px 2px;background:#f8f9fa;border-top:2px solid ${sc}30;border-bottom:1px solid #efefef">
            <span style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:${sc}">${j.status}</span>
            <span style="font-size:7.5px;color:#9ba3af;margin-left:8px">${grp.length} job${grp.length!==1?'s':''} · avg ${ga}d open</span>
          </td></tr>`;
          lastStatus = j.status;
        }
        rows += `<tr style="border-bottom:${showNotes?'none':'1px solid #f0f0f0'};background:${rowBg}">
          <td style="padding:${rp};width:12px;vertical-align:middle">${statusDot(d)}</td>
          <td style="padding:${rp};white-space:nowrap;vertical-align:middle"><span style="font-family:'DM Mono',monospace;font-size:7.5px;color:#6b7280">${esc(j.po)}</span></td>
          <td style="padding:${rp};vertical-align:middle"><span style="font-weight:600;font-size:${fz};color:#1e2024">${esc(j.ref||'—')}</span></td>
          <td style="padding:${rp};vertical-align:middle"><span style="font-size:8px;color:#6b7280">${esc(j.supplier||'—')}</span></td>
          <td style="padding:${rp};text-align:right;white-space:nowrap;vertical-align:middle"><strong style="color:${dayCol};font-size:9px">${d}d</strong></td>
        </tr>`;
        if (showNotes) {
          rows += `<tr style="border-bottom:1px solid #f0f0f0;background:${rowBg}">
            <td style="padding:0 3px 4px;"></td>
            <td colspan="4" style="padding:1px 5px 4px;">
              <span style="font-size:7px;font-weight:600;color:#c0c4cc;text-transform:uppercase;letter-spacing:0.05em">Notes: </span>
              <span style="display:inline-block;border-bottom:1px solid #e5e7eb;width:calc(100% - 36px);vertical-align:bottom;">&nbsp;</span>
            </td>
          </tr>`;
        }
      });
      return `${sHead('All Open Jobs','#1e2024', sorted.length + ' jobs · by status · oldest first within group')}
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:${fz}">
        <thead><tr>
          <th style="width:12px;border-bottom:2px solid #e5e7eb;background:#fafafa;padding:3px"></th>
          ${th('PO','left','54px')}${th('Reference')}${th('Service Co.','left','22%')}${th('Age','right','34px')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>${!showNotes?`<div style="font-size:8px;color:#9ba3af;font-style:italic;margin:-8px 0 10px">Notes suppressed — ${sorted.length} jobs over single-page limit.</div>`:''}`;
    })()}

    <!-- ══ TWO-COLUMN: SERVICE CO + STATS / CHART ══ -->
    <div style="display:grid;grid-template-columns:1.4fr 0.6fr;gap:12px;align-items:start">

      <!-- ── COL 1: SERVICE CO BREAKDOWN ── -->
      <div>
        ${sHead('Service Co. Breakdown','#1e2024', supplierStats.length + ' companies')}
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${th('Company')}${th('Open','center','36px')}${th('21d+','center','36px')}${th('30d+','center','36px')}${th('Avg Age','right','48px')}</tr></thead>
          <tbody>${supplierStats.map(x=>`<tr style="border-bottom:1px solid #f3f4f6">
            ${td(`<span style="font-size:9px;font-weight:600">${esc(x.s)}</span>`,'padding:3px 6px')}
            ${td(`<strong style="font-size:9.5px">${x.total}</strong>`,'text-align:center;padding:3px 6px')}
            ${td(x.urgent>0?`<span style="color:#d97706;font-weight:700;font-size:9.5px">${x.urgent}</span>`:`<span style="color:#d1d5db;font-size:9.5px">—</span>`,'text-align:center;padding:3px 6px')}
            ${td(x.critical>0?`<span style="color:#dc2626;font-weight:700;font-size:9.5px">${x.critical}</span>`:`<span style="color:#d1d5db;font-size:9.5px">—</span>`,'text-align:center;padding:3px 6px')}
            ${td(`<span style="font-size:9.5px;color:${x.avg>21?'#dc2626':x.avg>14?'#d97706':'#374151'};font-weight:600">${x.avg}d</span>`,'text-align:right;padding:3px 6px')}
          </tr>`).join('')}
          </tbody>
        </table>

        ${sHead('Key Stats','#1e2024')}
        <div style="font-size:9px">
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280">Open jobs</span><strong>${allOpen.length}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280">Closed this month</span><strong style="color:${doneThisMonth>=doneLastMonth?'#16a34a':'#d97706'}">${doneThisMonth} <span style="font-weight:400;color:#9ba3af">(${doneLastMonth} last mo)</span></strong></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280">Avg duration (90d)</span><strong>${fmtD(avgDur)}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280">Critical (30d+)</span><strong style="color:${critical.length>0?'#dc2626':'#16a34a'}">${critical.length}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280">Awaiting parts</span><strong style="color:${waiting.length>0?'#d97706':'#16a34a'}">${waiting.length}${avgParts?' · avg '+avgParts+'d':''}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#6b7280">Revisiting</span><strong style="color:${revisiting.length>0?'#d97706':'#16a34a'}">${revisiting.length}${avgRevisit?' · avg '+avgRevisit+'d':''}</strong></div>
          ${longestJob?`<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#6b7280">Longest open</span><strong style="color:#dc2626">${longestDays}d — ${esc((longestJob.ref||longestJob.po).substring(0,35))}</strong></div>`:''}
        </div>
      </div>

      <!-- ── COL 2: MONTHLY VOLUME CHART ── -->
      <div>
        ${sHead('Monthly Jobs','#1e2024','last 6 months')}
        <!-- Numbers sit above chart, then bars, then labels — no overlap -->
        <div style="display:flex;gap:3px;margin-bottom:0">
          ${mBuckets.map(b => {
            const isLatest = b === mBuckets[mBuckets.length-1];
            return `<div style="flex:1;text-align:center;font-size:8px;font-weight:${isLatest?'800':'500'};color:${isLatest?'#1e2024':'#9ba3af'};padding-bottom:2px">${b.count}</div>`;
          }).join('')}
        </div>
        <div style="display:flex;align-items:flex-end;gap:3px;height:38px">
          ${mBuckets.map(b => {
            const maxV = Math.max(...mBuckets.map(x=>x.count),1);
            const pct = Math.max(Math.round(b.count/maxV*100),4);
            const isLatest = b === mBuckets[mBuckets.length-1];
            const isPrev = b === mBuckets[mBuckets.length-2];
            return `<div style="flex:1;height:${pct}%;background:${isLatest?'#3d4043':isPrev?'#9ba3af':'#d1d5db'};border-radius:2px 2px 0 0"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:3px;margin-top:2px">
          ${mBuckets.map(b => `<div style="flex:1;text-align:center;font-size:6px;color:#9ba3af">${b.label}</div>`).join('')}
        </div>

        ${sHead('Avg Job Age by Status','#1e2024')}
        ${['Incoming Job','Job Booked','Waiting for Parts','Revisiting','Awaiting Closeout'].map(s => {
          const sJobs = allOpen.filter(j=>j.status===s);
          if (!sJobs.length) return '';
          const avg = Math.round(sJobs.reduce((a,j)=>a+daysBetween(j.poDate,null),0)/sJobs.length);
          const col = avg>21?'#dc2626':avg>14?'#d97706':'#374151';
          const statusColor2 = {'Incoming Job':'#2563eb','Job Booked':'#7c3aed','Waiting for Parts':'#d97706','Revisiting':'#b8960a','Awaiting Closeout':'#0d9488'}[s]||'#6b7280';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #f3f4f6;font-size:8.5px">
            <span style="color:${statusColor2};font-weight:600">${s.replace('Waiting for ','Parts ')}</span>
            <span style="color:${col};font-weight:700">${avg}d · ${sJobs.length}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- ══ OPS HEALTH SUMMARY ══ -->
    ${(() => {
      const _ohOpen = jobs.filter(isOpenService);
      const _ohTotals = {};
      ACTIVE_STAGES.forEach(s => { _ohTotals[s] = { sum:0, c:0 }; });
      _ohOpen.forEach(j => {
        const dw = getDwellTimes(j);
        if (Object.keys(dw).length > 1) {
          ACTIVE_STAGES.forEach(s => { if (dw[s]!==undefined) { _ohTotals[s].sum+=dw[s]; _ohTotals[s].c++; } });
        } else if (ACTIVE_STAGES.includes(j.status)) {
          _ohTotals[j.status].sum += daysBetween(j.poDate,null);
          _ohTotals[j.status].c++;
        }
      });
      const _ohAvgs = ACTIVE_STAGES.map(s => _ohTotals[s].c ? Math.round(_ohTotals[s].sum/_ohTotals[s].c) : 0);
      const ohIssues = [];
      if (_ohAvgs[0] > 7)  ohIssues.push({ label: `Incoming Job averaging ${_ohAvgs[0]}d`, color: _ohAvgs[0]>14?'#dc2626':'#d97706' });
      if (_ohAvgs[1] > 10) ohIssues.push({ label: `Job Booked averaging ${_ohAvgs[1]}d before work starts`, color: _ohAvgs[1]>21?'#dc2626':'#d97706' });
      if (_ohAvgs[2] > 14) ohIssues.push({ label: `${_ohTotals['Waiting for Parts']?.c||0} jobs stuck waiting on parts (avg ${_ohAvgs[2]}d)`, color: _ohAvgs[2]>21?'#dc2626':'#d97706' });
      if (_ohAvgs[3] > 7)  ohIssues.push({ label: `${_ohTotals['Revisiting']?.c||0} revisiting jobs (avg ${_ohAvgs[3]}d)`, color: _ohAvgs[3]>14?'#dc2626':'#d97706' });
      if (!ohIssues.length) return `
        <div style="margin-top:9px;padding:6px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;display:flex;align-items:center;gap:10px">
          <span style="font-size:13px">✅</span>
          <span style="font-size:9.5px;font-weight:700;color:#16a34a">Ops Health: All stages within normal thresholds — no bottlenecks detected</span>
        </div>`;
      return `
        <div style="margin-top:9px;padding:6px 12px;background:#fff8f8;border:1px solid #fecaca;border-radius:6px">
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#dc2626;margin-bottom:6px">⚠ Ops Health Check</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${ohIssues.map(i => `<span style="font-size:9.5px;padding:3px 9px;background:#fff;border:1px solid ${i.color}40;border-radius:10px;color:${i.color};font-weight:600">${i.label}</span>`).join('')}
          </div>
        </div>`;
    })()}

    <!-- ══ RECURRING SITES ALERT ══ -->
    ${(() => {
      const thisYear = new Date().getFullYear().toString();
      const siteMap = {};
      jobs.filter(isServiceJob).forEach(j => {
        const site = parseSiteName(j.ref);
        if (!site) return;
        const key = site.toLowerCase().replace(/\s+/g,' ');
        if (!siteMap[key]) siteMap[key] = { name:site, total:0, thisYear:0, open:0 };
        siteMap[key].total++;
        if ((j.poDate||'').startsWith(thisYear)) siteMap[key].thisYear++;
        if (j.status !== 'Job Done') siteMap[key].open++;
      });
      const hotSites = Object.values(siteMap).filter(s => s.thisYear >= 2).sort((a,b) => b.thisYear - a.thisYear);
      if (!hotSites.length) return '';
      return `<div style="margin-top:10px;padding:8px 14px;background:#fff8f0;border:1px solid #fed7aa;border-radius:6px">
        <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#c2410c;margin-bottom:4px">⚑ Recurring Sites — ${hotSites.length} site${hotSites.length!==1?'s':''} with repeat callouts this year</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${hotSites.slice(0,8).map(s => `<span style="font-size:9.5px;padding:3px 9px;background:#fff;border:1px solid #fed7aa;border-radius:10px;color:#9a3412">
            <strong>${esc(s.name)}</strong> — ${s.thisYear}x this year${s.open>0?' · <strong style="color:#c2410c">'+s.open+' open</strong>':''}
          </span>`).join('')}
          ${hotSites.length > 8 ? `<span style="font-size:9px;color:#9ba3af;align-self:center">+${hotSites.length-8} more</span>` : ''}
        </div>
      </div>`;
    })()}

    <!-- ══ FOOTER ══ -->
    <div style="margin-top:9px;padding-top:6px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px">
          <div style="width:6px;height:6px;border-radius:50%;background:#3d4043"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:#3d4043"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:#3d4043"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:transparent;border:1.5px solid #3d4043;box-sizing:border-box"></div>
        </div>
        <span style="font-size:8.5px;color:#9ba3af">Prepared by <strong style="color:#3d4043">Sean Pickford</strong> · Technical Service Manager · Phoeniks Electric Kitchen Specialists</span>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <div style="display:flex;align-items:center;gap:5px;font-size:8.5px;color:#9ba3af">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626"></span> Critical 30d+
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d97706;margin-left:5px"></span> Overdue 21d+
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;margin-left:5px"></span> Active
        </div>
        <span style="font-size:8.5px;color:#9ba3af">${dateStr}</span>
      </div>
    </div>
  </div>`;

  document.getElementById('print-report').innerHTML = html;
}


/* ── DASHBOARD HEALTH BANNER ── */
function renderDashHealthBanner(avgs, totals) {
  const el = document.getElementById('ops-health-banner');
  if (!el) return;

  const STAGE_NAMES = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting'];
  const issues = [];
  if (avgs[0] > 7)  issues.push({ label: `Incoming Job averaging ${avgs[0]}d`, color: avgs[0]>14?'var(--red)':'var(--amber)', page: 'bottleneck' });
  if (avgs[1] > 10) issues.push({ label: `Job Booked averaging ${avgs[1]}d before work starts`, color: avgs[1]>21?'var(--red)':'var(--amber)', page: 'bottleneck' });
  if (avgs[2] > 14) issues.push({ label: `${totals['Waiting for Parts']?.c||0} jobs stuck waiting on parts (avg ${avgs[2]}d)`, color: avgs[2]>21?'var(--red)':'var(--amber)', page: 'bottleneck' });
  if (avgs[3] > 7)  issues.push({ label: `${totals['Revisiting']?.c||0} revisiting jobs (avg ${avgs[3]}d)`, color: avgs[3]>14?'var(--red)':'var(--amber)', page: 'bottleneck' });

  // Recurring sites this year
  const thisYear = new Date().getFullYear().toString();
  const siteMap = {};
  jobs.filter(isServiceJob).forEach(j => {
    const site = parseSiteName(j.ref);
    if (!site) return;
    const key = site.toLowerCase().replace(/\s+/g,' ');
    if (!siteMap[key]) siteMap[key] = { name:site, count:0 };
    if ((j.poDate||'').startsWith(thisYear)) siteMap[key].count++;
  });
  const hotSites = Object.values(siteMap).filter(s => s.count >= 3).sort((a,b) => b.count - a.count);
  if (hotSites.length) {
    issues.push({ label: `${hotSites[0].name} has had ${hotSites[0].count} callouts this year`, color: 'var(--red)', page: 'sites' });
    if (hotSites.length > 1) issues.push({ label: `${hotSites.length} sites with 3+ callouts this year`, color: 'var(--amber)', page: 'sites' });
  }

  // Add data quality warning if significant gaps exist
  const _doneAll = jobs.filter(j => j.status === 'Job Done');
  const _withHist = _doneAll.filter(j => (j.history||[]).length > 1).length;
  const _histPct = _doneAll.length ? Math.round(_withHist / _doneAll.length * 100) : 100;
  if (_histPct < 60 && _doneAll.length > 5) {
    issues.push({ label: `Only ${_histPct}% of completed jobs have status history — duration & fix rate data incomplete`, color: 'var(--blue)', page: 'performance' });
  }

  if (!issues.length) {
    el.style.display = 'flex';
    el.innerHTML = `<span style="font-size:14px">✅</span><span style="font-size:12px;font-weight:600;color:var(--green)">Operations healthy — no bottlenecks or recurring issues detected</span>`;
    el.style.background = 'rgba(22,163,74,0.06)';
    el.style.borderColor = 'rgba(22,163,74,0.2)';
    el.style.color = 'var(--green)';
    return;
  }

  el.style.display = 'flex';
  el.style.background = 'rgba(220,38,38,0.05)';
  el.style.borderColor = 'rgba(220,38,38,0.15)';
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:5px;width:100%">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:2px">Ops Health Check</div>
      ${issues.map(i => `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="width:6px;height:6px;border-radius:50%;background:${i.color};flex-shrink:0;display:inline-block"></span>
        <span style="color:var(--text2);flex:1">${i.label}</span>
        <span onclick="showPage('${i.page}')" style="font-size:11px;color:var(--blue);cursor:pointer;flex-shrink:0">View →</span>
      </div>`).join('')}
    </div>`;
}

/* ══════════════════════════════════════════════════════
   SUPPLIER STATE TAGS — persisted in localStorage
   ══════════════════════════════════════════════════════ */
const SK_SUPPLIER_TAGS = 'phoeniks_supplier_tags_v1';

// Pre-loaded from Phoeniks spreadsheet — state → [supplier name fragments]
const SUPPLIER_STATE_MAP = {
  VIC: ['United Catering Repairs','Norfolk Food Services','United Equipment Services'],
  NSW: ['Gasforce','Coreserve','Mackie Electric','Recom','Bathurst Electrical'],
  QLD: ['Gold Coast Commercial Services','Bake Repair','Heatec','Chef Tech','MVO Services','Element FSR','Tech Express','Central Commercial Electrics'],
  WA:  ['CPB','KCI','Ord River Electrics'],
  SA:  ['Total Commercial Equipment','Bakequip'],
  ACT: ['Essential Services','Total Catering Equipment','Five Star Electrical','Ritesh','Preferred Services'],
  TAS: ['EC Fix','Tasmanian Catering Solutions','Warren Services Group'],
  NT:  ['Dishtec','Arafura Catering Equipment'],
  QLD_TOWNSVILLE: ['Nitelec Electrical','A1 Electrical','Voltec'],
  QLD_CAIRNS:     ['Justlec','Tinus Electrical','J & R Refrigeration'],
  QLD_ROCKHAMPTON:['Central Commercial Electrics'],
  VIC_WARRNAMBOOL:['Mr Sparkz'],
  WA_KUNUNURRA:   ['Ord River Electrics'],
  NATIONAL:       ['Bakergroup','Baker Group'],
};

function loadSupplierTags() {
  try {
    const raw = localStorage.getItem(SK_SUPPLIER_TAGS);
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

function saveSupplierTags(tags) {
  try { localStorage.setItem(SK_SUPPLIER_TAGS, JSON.stringify(tags)); } catch(e) {}
}

function getSupplierState(supplierName, tags) {
  // 1. Check user-set tags first
  if (tags && tags[supplierName]) return tags[supplierName];
  // 2. Check pre-loaded map
  for (const [state, names] of Object.entries(SUPPLIER_STATE_MAP)) {
    if (names.some(n => supplierName.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(supplierName.toLowerCase()))) {
      // Normalise region codes to base state
      const base = state.replace(/_.*/, '');
      return base === 'QLD_TOWNSVILLE' || base === 'QLD_CAIRNS' || base === 'QLD_ROCKHAMPTON' ? 'QLD'
           : base === 'VIC_WARRNAMBOOL' ? 'VIC'
           : base === 'WA_KUNUNURRA' ? 'WA'
           : base === 'NATIONAL' ? 'NAT'
           : base;
    }
  }
  return '';
}

function renderSupplierTags() {
  const el = document.getElementById('supplier-tag-manager');
  if (!el) return;
  const tags = loadSupplierTags();
  const supplierNames = [...new Set(jobs.map(j => j.supplier).filter(Boolean))].sort();
  const STATES = ['VIC','NSW','QLD','SA','WA','TAS','ACT','NT','NAT','?'];
  const STATE_COLORS = { VIC:'#3b82f6', NSW:'#16a34a', QLD:'#d97706', SA:'#dc2626', WA:'#7c3aed', TAS:'#0891b2', ACT:'#be185d', NT:'#c2410c', NAT:'#374151', '?':'#9ba3af' };

  const untagged = supplierNames.filter(s => !getSupplierState(s, tags));
  const tagged   = supplierNames.filter(s =>  getSupplierState(s, tags));

  const makeRow = (s) => {
    const autoState = getSupplierState(s, {});
    const userState = tags[s] || '';
    const effectiveState = userState || autoState;
    const isAuto = !userState && !!autoState;
    const isUserSet = !!userState;
    const sc = STATE_COLORS[effectiveState] || 'var(--text3)';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s)}</div>
        ${effectiveState ? `<div style="font-size:11px;color:var(--text3);margin-top:1px">${isAuto ? 'Auto-detected' : 'Manually tagged'}</div>` : '<div style="font-size:11px;color:var(--text3);margin-top:1px">Not tagged yet</div>'}
      </div>
      ${effectiveState ? `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;background:${sc}20;color:${sc};border:1px solid ${sc}40;flex-shrink:0">${effectiveState}</span>` : ''}
      <select onchange="setSupplierTag('${esc(s)}',this.value)"
        style="font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:var(--font);flex-shrink:0">
        <option value="">${effectiveState ? '✎ change' : '— tag state'}</option>
        ${STATES.map(st => `<option value="${st}" ${(userState||autoState)===st?'selected':''}>${st}</option>`).join('')}
      </select>
    </div>`;
  };

  el.innerHTML = `
    ${untagged.length ? `
    <div class="card" style="margin-bottom:16px;overflow:hidden">
      <div style="padding:14px 20px;background:rgba(220,38,38,0.04);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">Needs tagging <span style="font-size:12px;font-weight:400;color:var(--text3)">(${untagged.length} companies)</span></div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">These companies appear in your jobs but don't have a state assigned yet</div>
        </div>
      </div>
      ${untagged.map(makeRow).join('')}
    </div>` : ''}
    <div class="card" style="overflow:hidden">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:var(--text)">All tagged companies <span style="font-size:12px;font-weight:400;color:var(--text3)">(${tagged.length})</span></div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">Pre-loaded from your spreadsheet + any manual tags. Click ✎ change to override.</div>
      </div>
      ${tagged.length ? tagged.map(makeRow).join('') : '<div style="padding:20px;color:var(--text3);font-size:13px">No tagged companies yet.</div>'}
    </div>`;
}

function setSupplierTag(supplier, state) {
  const tags = loadSupplierTags();
  if (state) tags[supplier] = state;
  else delete tags[supplier];
  saveSupplierTags(tags);
  renderSuppliers();
}

/* ══════════════════════════════════════════════════════
   RECURRING SITES — group jobs by site name from ref field
   Site name = text before the first ' - ' or '-' in the ref
   ══════════════════════════════════════════════════════ */
function parseSiteName(ref) {
  if (!ref) return null;
  // Strip leading invoice/PO prefixes: "INV-48172 Shaw Estate - ..." → "Shaw Estate - ..."
  // Patterns: INV-12345, PO-123, P00123, PO 123 at start
  let cleaned = ref.replace(/^(INV|PO|P0+)[-\s]?\d+\s*/i, '').trim();
  if (!cleaned) return null;
  // "Shaw Estate - Temp up not turning on" → "Shaw Estate"
  const m = cleaned.match(/^([^\-–]+?)(?:\s*[-–]|$)/);
  if (!m) return cleaned.trim();
  const site = m[1].trim();
  return site.length >= 3 ? site : null;
}

function renderSites() {
  const el = document.getElementById('sites-content');
  if (!el) return;

  const serviceJobs = jobs.filter(isServiceJob);
  const siteMap = {};
  serviceJobs.forEach(j => {
    const site = parseSiteName(j.ref);
    if (!site) return;
    // Normalise: lowercase for grouping, preserve first-seen casing for display
    const key = site.toLowerCase().replace(/\s+/g, ' ');
    if (!siteMap[key]) siteMap[key] = { name: site, jobs: [] };
    siteMap[key].jobs.push(j);
  });

  // Only show sites with 2+ jobs
  const recurring = Object.values(siteMap)
    .filter(s => s.jobs.length >= 2)
    .sort((a, b) => b.jobs.length - a.jobs.length);

  if (!recurring.length) {
    el.innerHTML = `<div class="empty-state"><p>No recurring sites detected yet. Sites are identified from the reference field — e.g. "GYG Midland - temp up not turning on" groups under "GYG Midland".</p></div>`;
    return;
  }

  el.innerHTML = recurring.map(site => {
    const open    = site.jobs.filter(j => j.status !== 'Job Done');
    const done    = site.jobs.filter(j => j.status === 'Job Done');
    const urgent  = open.filter(j => daysBetween(j.poDate,null) >= 21);
    const revisits= site.jobs.filter(j => j.history?.some(h => h.status === 'Revisiting'));
    const thisYear = new Date().getFullYear().toString();
    const jobsThisYear = site.jobs.filter(j => (j.poDate||'').startsWith(thisYear)).length;
    const lastYear = (new Date().getFullYear() - 1).toString();
    const jobsLastYear = site.jobs.filter(j => (j.poDate||'').startsWith(lastYear)).length;
    const issues  = [...new Set(site.jobs.map(j => {
      // Extract issue part — text after the first dash
      const m = (j.ref||'').match(/^[^\-–]+[-–]\s*(.+)/);
      return m ? m[1].trim() : null;
    }).filter(Boolean))];

    // Equipment types mentioned
    const equipment = [...new Set(site.jobs.map(j => j.equipment).filter(Boolean))];

    const statusColor = urgent.length > 0 ? 'var(--red)' : open.length > 0 ? 'var(--amber)' : 'var(--green)';
    const statusLabel = urgent.length > 0 ? `${urgent.length} urgent` : open.length > 0 ? `${open.length} open` : 'all done';

    return `<div class="card" style="padding:0;margin-bottom:14px;overflow:hidden">
      <div style="padding:14px 18px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">${esc(site.name)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            <span style="font-size:12px;color:var(--text3)">${site.jobs.length} jobs total</span>
            <span style="color:var(--text3)">·</span>
            <span style="font-size:12px;font-weight:600;color:${statusColor}">${statusLabel}</span>
            ${jobsThisYear > 0 ? `<span style="color:var(--text3)">·</span><span style="font-size:12px;font-weight:700;color:${jobsThisYear>=3?'var(--red)':jobsThisYear>=2?'var(--amber)':'var(--text2)'}">⚑ ${jobsThisYear} visit${jobsThisYear!==1?'s':''} this year${jobsLastYear>0?' ('+jobsLastYear+' last year)':''}</span>` : ''}
            ${revisits.length > 0 ? `<span style="color:var(--text3)">·</span><span style="font-size:12px;color:var(--amber);font-weight:600">⟳ ${revisits.length} revisit${revisits.length>1?'s':''}</span>` : ''}
            ${equipment.length ? `<span style="color:var(--text3)">·</span><span style="font-size:11px;color:var(--text3)">${equipment.slice(0,3).map(e=>esc(e)).join(', ')}</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;color:var(--text3)">Service cos. used</div>
          <div style="font-size:12px;font-weight:600;color:var(--text2)">${[...new Set(site.jobs.map(j=>j.supplier))].slice(0,3).map(s=>esc(s)).join(', ')}</div>
        </div>
      </div>
      ${issues.length ? `
      <div style="padding:10px 18px;background:var(--surface2);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:6px">Issues reported</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${issues.slice(0,8).map(i => `<span style="font-size:11px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;color:var(--text2)">${esc(i)}</span>`).join('')}
          ${issues.length > 8 ? `<span style="font-size:11px;color:var(--text3);align-self:center">+${issues.length-8} more</span>` : ''}
        </div>
      </div>` : ''}
      <div style="padding:10px 18px">
        <table style="width:100%;font-size:12px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="padding:4px 6px;text-align:left;font-weight:700;color:var(--text3);font-size:11px">PO</th>
            <th style="padding:4px 6px;text-align:left;font-weight:700;color:var(--text3);font-size:11px">Reference</th>
            <th style="padding:4px 6px;text-align:left;font-weight:700;color:var(--text3);font-size:11px">Service Co.</th>
            <th style="padding:4px 6px;text-align:left;font-weight:700;color:var(--text3);font-size:11px">Status</th>
            <th style="padding:4px 6px;text-align:right;font-weight:700;color:var(--text3);font-size:11px">Age</th>
          </tr></thead>
          <tbody>
            ${site.jobs.sort((a,b)=>(b.poDate||'').localeCompare(a.poDate||'')).map(j => {
              const d = getTotalDays(j) ?? daysBetween(j.poDate,null);
              const isDone = j.status === 'Job Done';
              return `<tr style="border-bottom:1px solid var(--surface2);cursor:pointer" onclick="openJobModal('${j.id}')">
                <td style="padding:4px 6px"><span class="po-link">${esc(j.po)}</span></td>
                <td style="padding:4px 6px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.ref||'—')}</td>
                <td style="padding:4px 6px;color:var(--text3)">${esc(j.supplier)}</td>
                <td style="padding:4px 6px">${badge(j.status)}</td>
                <td style="padding:4px 6px;text-align:right">${dayChip(d,isDone)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}
