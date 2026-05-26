/* ============================================================
   meeting.js — Monday morning meeting mode — Bold Yellow theme
   4 slides: Overview KPIs | Needs Attention | Jobs by Stage | Bottleneck

   CHANGED FROM ORIGINAL:
   - phoeniks_meeting_open pref still uses localStorage (UI state,
     not data — no need to migrate to Supabase)
   ============================================================ */

let meetingSlide  = 0;
const MEETING_TOTAL = 4;

function openMeeting() {
  const _mn = new Date();
  const _mo = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  const _mday = _mn.toLocaleDateString('en-AU', { weekday:'long' });
  const _mmonth = _mn.toLocaleDateString('en-AU', { month:'long', year:'numeric' });
  document.getElementById('meeting-date-display').textContent = `${_mday}, ${_mo(_mn.getDate())} ${_mmonth}`;
  buildMeetingSlides();
  meetingSlide = 0;
  updateMeetingSlide();
  document.getElementById('meeting-overlay').classList.add('active');
  try { localStorage.setItem('phoeniks_meeting_open','1'); } catch(e) {}
}

function closeMeeting() {
  document.getElementById('meeting-overlay').classList.remove('active');
  try { localStorage.removeItem('phoeniks_meeting_open'); } catch(e) {}
}

function buildMeetingSlides() {
  const open       = jobs.filter(isOpenService);
  const done       = jobs.filter(j => j.status === 'Job Done');
  const stuck      = jobs.filter(j => isOpenService(j) && daysBetween(j.poDate, null) > 14);
  const now90 = new Date(); now90.setDate(now90.getDate() - 90);
  const cutoff90 = now90.toISOString().split('T')[0];
  const recentDone = done.filter(j => (j.poDate||'') >= cutoff90);
  const avgTotal = recentDone.length
    ? Math.round(recentDone.reduce((a,j) => a + (getTotalDays(j)||0), 0) / recentDone.length)
    : (done.length ? Math.round(done.reduce((a,j) => a + (getTotalDays(j)||0), 0) / done.length) : null);
  const totalValue = open.reduce((a,j) => a + (parseFloat(j.value)||0), 0);

  /* ── SLIDE 1: KPIs ── */
  const waitingParts = jobs.filter(j => j.status === 'Waiting for Parts').length;
  const kpiData = [
    { val: open.length,                                  label: 'Open Jobs' },
    { val: stuck.length,                                 label: 'Needs Attention' },
    { val: avgTotal !== null ? avgTotal + 'd' : '—',     label: 'Avg Duration (90d)' },
    { val: waitingParts,                                 label: 'Waiting on Parts' },
    { val: done.length,                                  label: 'Completed' },
  ];
  document.getElementById('meeting-kpis').innerHTML = kpiData.map(k => `
    <div class="meeting-kpi">
      <div class="meeting-kpi-val">${k.val}</div>
      <div class="meeting-kpi-label">${k.label}</div>
    </div>
  `).join('');

  document.getElementById('meeting-stage-bars').innerHTML = ACTIVE_STAGES.map((s, i) => {
    const n   = jobs.filter(j => j.status === s).length;
    const pct = open.length ? Math.round(n / open.length * 100) : 0;
    return `<div class="meeting-stage-bar-row">
      <div class="meeting-stage-bar-meta">
        <span style="font-size:13px;color:#1f2937;font-weight:600">${s}</span>
        <span style="font-family:'DM Mono',monospace;font-size:12px;color:#6b7280;font-weight:600">${n} jobs</span>
      </div>
      <div class="meeting-stage-bar-bg">
        <div class="meeting-stage-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');

  const supWorkload = [...new Set(open.map(j => j.supplier))]
    .map(s => ({
      s,
      openCount: open.filter(j => j.supplier === s).length,
      overdue:   open.filter(j => j.supplier === s && daysBetween(j.poDate, null) > 14).length,
    }))
    .filter(d => d.openCount > 0)
    .sort((a, b) => b.openCount - a.openCount);

  document.getElementById('meeting-supplier-list').innerHTML = supWorkload.length
    ? supWorkload.map(d => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e5e7eb">
        <div style="font-size:13px;font-weight:600;color:#1f2937">${esc(d.s)}</div>
        <div style="display:flex;gap:10px;align-items:center">
          <span style="font-size:12px;color:#6b7280">${d.openCount} open</span>
          ${d.overdue > 0
            ? `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${d.overdue} overdue</span>`
            : `<span style="background:#f0fdf4;color:#166534;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">On track</span>`}
        </div>
      </div>`).join('')
    : '<div style="padding:16px;color:#6b7280;font-size:13px">No open jobs.</div>';

  /* ── SLIDE 2: Needs Attention ── */
  const attn = jobs.filter(j => j.status !== 'Job Done' && daysBetween(j.poDate, null) > 14)
                   .sort((a,b) => daysBetween(b.poDate,null) - daysBetween(a.poDate,null));
  document.getElementById('meeting-attention-content').innerHTML = !attn.length
    ? `<div class="meeting-attn-empty">
         <div class="meeting-attn-empty-icon">✓</div>
         <div class="meeting-attn-empty-title">All jobs on track!</div>
         <div class="meeting-attn-empty-sub">No open jobs overdue this week.</div>
       </div>`
    : `<table class="meeting-table">
        <thead><tr>
          <th style="width:100px">PO</th>
          <th>Site / Reference</th>
          <th style="width:150px">Service Co.</th>
          <th style="width:140px">Status</th>
          <th style="width:70px">Open</th>
          <th style="width:100px">Value</th>
        </tr></thead>
        <tbody>${attn.map(j => `<tr>
          <td class="po-link">${esc(j.po)}</td>
          <td class="ref-cell">${esc(j.ref||'—')}</td>
          <td style="color:rgba(61,64,67,0.7)">${esc(j.supplier)}</td>
          <td>${meetingBadge(j.status)}</td>
          <td>${meetingDayChip(daysBetween(j.poDate,null))}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px;color:rgba(61,64,67,0.5)">${fmtValue(j.value)}</td>
        </tr>`).join('')}</tbody>
      </table>`;

  /* ── SLIDE 3: Jobs by Stage ── */
  const STAGE_COLORS_MEETING = {
    'Incoming Job':      '#2563eb',
    'Job Booked':        '#7c3aed',
    'Waiting for Parts': '#d97706',
    'Revisiting':        '#b8960a',
  };
  const stageCols = ['Incoming Job','Job Booked','Waiting for Parts','Revisiting'];
  document.getElementById('meeting-stage-columns').innerHTML = stageCols.map(s => {
    const sj = jobs.filter(j => j.status === s)
                   .sort((a,b) => daysBetween(b.poDate,null) - daysBetween(a.poDate,null));
    const col = STAGE_COLORS_MEETING[s] || '#6b7280';
    return `<div class="status-col">
      <div class="status-col-header" style="border-top:3px solid ${col}">
        <div class="status-col-title" style="color:${col}">${s}</div>
        <div class="status-col-count">${sj.length} job${sj.length!==1?'s':''}</div>
      </div>
      <div class="status-col-body">
        ${sj.length
          ? sj.map(j => `<div class="status-col-item">
              <div class="item-ref">${esc(j.ref||j.po)}</div>
              <div class="item-meta">
                <span class="item-po">${esc(j.po)}</span>
                ${meetingDayChip(daysBetween(j.poDate,null))}
              </div>
            </div>`).join('')
          : `<div style="padding:16px;color:rgba(61,64,67,0.4);font-size:13px;text-align:center">No jobs</div>`
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
    return `<div class="meeting-stage-item">
      <div class="meeting-stage-name">${s}</div>
      <div class="meeting-stage-val" style="color:${isBad?'rgba(61,64,67,0.9)':'rgba(61,64,67,0.7)'}">${avgs[i]}d</div>
      <div class="meeting-stage-sub">${totals[s].c} jobs · avg days in status</div>
      <div class="meeting-bar-bg">
        <div class="meeting-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');

  /* Nav dots */
  document.getElementById('meeting-dots').innerHTML = Array.from({ length: MEETING_TOTAL }, (_,i) =>
    `<div class="meeting-dot ${i===meetingSlide?'active':''}" onclick="goMeetingSlide(${i})"></div>`
  ).join('');
}

function meetingBadge(status) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(61,64,67,0.12);color:#3d4043">
    <span style="width:5px;height:5px;border-radius:50%;background:#3d4043;flex-shrink:0"></span>${status}
  </span>`;
}

function meetingDayChip(d) {
  if (d === null || d === undefined) return '<span style="color:rgba(61,64,67,0.4);font-size:12px">—</span>';
  const bg  = d > 21 ? 'rgba(220,38,38,0.15)' : d > 14 ? 'rgba(217,119,6,0.15)' : 'rgba(61,64,67,0.1)';
  const col = d > 21 ? '#b91c1c' : d > 14 ? '#92400e' : '#3d4043';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;font-family:'DM Mono',monospace;background:${bg};color:${col}">${d}d</span>`;
}

function updateMeetingSlide() {
  document.querySelectorAll('.meeting-slide').forEach((s,i) => s.classList.toggle('active', i===meetingSlide));
  document.querySelectorAll('.meeting-dot').forEach((d,i) => d.classList.toggle('active', i===meetingSlide));
}

function meetingNext() { if (meetingSlide < MEETING_TOTAL-1) { meetingSlide++; updateMeetingSlide(); } }
function meetingPrev() { if (meetingSlide > 0)               { meetingSlide--; updateMeetingSlide(); } }
function goMeetingSlide(i) { meetingSlide = i; updateMeetingSlide(); }
