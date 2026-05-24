/* ============================================================
   meeting.js — Monday morning meeting mode
   4 slides: Overview KPIs | Needs Attention | Jobs by Stage | Bottleneck
   Navigate with Prev/Next buttons or ← → arrow keys
   ============================================================ */

let meetingSlide  = 0;
const MEETING_TOTAL = 4;

function openMeeting() {
  document.getElementById('meeting-date-display').textContent =
    new Date().toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  buildMeetingSlides();
  meetingSlide = 0;
  updateMeetingSlide();
  document.getElementById('meeting-overlay').classList.add('active');
}

function closeMeeting() {
  document.getElementById('meeting-overlay').classList.remove('active');
}

function buildMeetingSlides() {
  const open       = jobs.filter(j => j.status !== 'Job Done');
  const done       = jobs.filter(j => j.status === 'Job Done');
  const stuck      = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14);
  const avgTotal   = done.length ? Math.round(done.reduce((a,j) => a + (getTotalDays(j)||0), 0) / done.length) : null;
  const totalValue = open.reduce((a,j) => a + (parseFloat(j.value) || 0), 0);

  /* ── SLIDE 1: KPIs ── */
  const kpiData = [
    { val: open.length,                                         label: 'Open Jobs',      color: '#3b82f6' },
    { val: stuck.length,                                        label: 'Needs Attention', color: stuck.length > 0 ? '#f59e0b' : '#22c55e' },
    { val: avgTotal !== null ? avgTotal + 'd' : '—',            label: 'Avg Duration',   color: '#a855f7' },
    { val: totalValue > 0 ? '$' + Math.round(totalValue).toLocaleString() : '—', label: 'Open Value', color: '#ff5f1f' },
    { val: done.length,                                         label: 'Completed',      color: '#22c55e' },
  ];
  document.getElementById('meeting-kpis').innerHTML = kpiData.map(k => `
    <div class="meeting-kpi" style="--accent-color:${k.color}">
      <div class="meeting-kpi-val" style="color:${k.color}">${k.val}</div>
      <div class="meeting-kpi-label">${k.label}</div>
    </div>
  `).join('');

  // Status breakdown bars
  document.getElementById('meeting-stage-bars').innerHTML = ACTIVE_STAGES.map((s, i) => {
    const n   = jobs.filter(j => j.status === s).length;
    const pct = open.length ? Math.round(n / open.length * 100) : 0;
    return `<div class="stage-bar-row">
      <div class="stage-bar-meta">
        <span style="font-size:13px;color:var(--text)">${s}</span>
        <span style="font-family:'DM Mono',monospace;font-size:12px;color:${STAGE_COLORS[i]};font-weight:600">${n} jobs</span>
      </div>
      <div class="stage-bar-bg" style="height:8px">
        <div class="stage-bar-fill" style="width:${pct}%;background:${STAGE_COLORS[i]}"></div>
      </div>
    </div>`;
  }).join('');

  // Supplier workload list
  const suppliers = [...new Set(jobs.map(j => j.supplier))].sort();
  document.getElementById('meeting-supplier-list').innerHTML = suppliers.map(s => {
    const sj      = jobs.filter(j => j.supplier === s && j.status !== 'Job Done');
    const overdue = sj.filter(j => daysBetween(j.poDate, null) > 14).length;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(s)}</div>
      <div style="display:flex;gap:10px;align-items:center">
        <span style="font-size:12px;color:var(--text3)">${sj.length} open</span>
        ${overdue > 0 ? `<span class="badge b-waiting">${overdue} overdue</span>` : '<span class="badge b-done">OK</span>'}
      </div>
    </div>`;
  }).join('');

  /* ── SLIDE 2: Needs Attention ── */
  const attn = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14)
                   .sort((a,b) => daysBetween(b.poDate, null) - daysBetween(a.poDate, null));
  document.getElementById('meeting-attention-content').innerHTML = !attn.length
    ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:40px;text-align:center">
         <div style="font-size:48px;margin-bottom:16px">✓</div>
         <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;color:var(--green)">All jobs on track!</div>
         <div style="color:var(--text3);margin-top:8px">No open jobs overdue this week.</div>
       </div>`
    : `<table class="meeting-table">
        <thead><tr>
          <th style="width:100px">PO</th><th>Site / Reference</th>
          <th style="width:160px">Supplier</th><th style="width:140px">Status</th>
          <th style="width:80px">Open</th><th style="width:100px">Value</th>
        </tr></thead>
        <tbody>${attn.map(j => `<tr>
          <td class="po-link">${esc(j.po)}</td>
          <td class="ref-cell">${esc(j.ref || '—')}</td>
          <td style="color:var(--text2)">${esc(j.supplier)}</td>
          <td>${badge(j.status)}</td>
          <td>${dayChip(daysBetween(j.poDate, null), false)}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3)">${fmtValue(j.value)}</td>
        </tr>`).join('')}</tbody>
      </table>`;

  /* ── SLIDE 3: Active Jobs by Stage ── */
  const stageCols = ['Incoming Job', 'Job Booked', 'Waiting for Parts'];
  document.getElementById('meeting-stage-columns').innerHTML = stageCols.map((s, i) => {
    const sj = jobs.filter(j => j.status === s);
    return `<div class="status-col">
      <div class="status-col-header" style="border-top:3px solid ${STAGE_COLORS[i]}">
        <div class="status-col-title" style="color:${STAGE_COLORS[i]}">${s}</div>
        <div class="status-col-count">${sj.length} job${sj.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="status-col-body">
        ${sj.length
          ? sj.map(j => `<div class="status-col-item">
              <div class="item-ref">${esc(j.ref || j.po)}</div>
              <div class="item-meta">
                <span class="item-po">${esc(j.po)}</span>
                ${dayChip(daysBetween(j.poDate, null), false)}
              </div>
            </div>`).join('')
          : '<div style="padding:16px;color:var(--text3);font-size:13px;text-align:center">No jobs</div>'
        }
      </div>
    </div>`;
  }).join('');

  /* ── SLIDE 4: Bottleneck ── */
  const totals = {};
  ACTIVE_STAGES.forEach(s => { totals[s] = { sum:0, c:0 }; });
  jobs.forEach(j => {
    const dw = getDwellTimes(j);
    ACTIVE_STAGES.forEach(s => { if (dw[s] !== undefined) { totals[s].sum += dw[s]; totals[s].c++; } });
  });
  const avgs   = ACTIVE_STAGES.map(s => totals[s].c ? Math.round(totals[s].sum / totals[s].c) : 0);
  const maxAvg = Math.max(...avgs, 1);
  document.getElementById('meeting-bottleneck-content').innerHTML = ACTIVE_STAGES.map((s, i) => {
    const pct   = Math.round(avgs[i] / maxAvg * 100);
    const isBad = avgs[i] > 14;
    return `<div class="meeting-stage-item" style="border-top:3px solid ${STAGE_COLORS[i]}">
      <div class="meeting-stage-name">${s}</div>
      <div class="meeting-stage-val" style="color:${isBad ? 'var(--amber)' : STAGE_COLORS[i]}">${avgs[i]}d</div>
      <div class="meeting-stage-sub">${totals[s].c} jobs · avg days in stage</div>
      <div class="meeting-bar-bg">
        <div class="meeting-bar-fill" style="width:${pct}%;background:${STAGE_COLORS[i]}"></div>
      </div>
    </div>`;
  }).join('');

  // Build nav dots
  document.getElementById('meeting-dots').innerHTML = Array.from({ length: MEETING_TOTAL }, (_,i) =>
    `<div class="meeting-dot ${i === meetingSlide ? 'active' : ''}" onclick="goMeetingSlide(${i})"></div>`
  ).join('');
}

function updateMeetingSlide() {
  document.querySelectorAll('.meeting-slide').forEach((s, i) => s.classList.toggle('active', i === meetingSlide));
  document.querySelectorAll('.meeting-dot').forEach((d, i) => d.classList.toggle('active', i === meetingSlide));
}

function meetingNext() { if (meetingSlide < MEETING_TOTAL - 1) { meetingSlide++; updateMeetingSlide(); } }
function meetingPrev() { if (meetingSlide > 0)                 { meetingSlide--; updateMeetingSlide(); } }
function goMeetingSlide(i) { meetingSlide = i; updateMeetingSlide(); }
