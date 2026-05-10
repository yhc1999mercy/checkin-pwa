const ACTIONS = [
  ['上班', '开始今天的工作时间'],
  ['午休开始', '暂停工作时长统计'],
  ['午休结束', '恢复工作时长统计'],
  ['晚饭开始', '暂停工作时长统计'],
  ['晚饭结束', '恢复工作时长统计'],
  ['下班', '结束今天的工作时间'],
];

const state = {
  apiUrl: localStorage.getItem('checkinApiUrl') || '',
  records: [],
  summary: [],
};

const el = {
  apiUrl: document.querySelector('#apiUrl'),
  saveUrlButton: document.querySelector('#saveUrlButton'),
  setupNotice: document.querySelector('#setupNotice'),
  checkinButtons: document.querySelector('#checkinButtons'),
  noteInput: document.querySelector('#noteInput'),
  statusLine: document.querySelector('#statusLine'),
  todayLabel: document.querySelector('#todayLabel'),
  todaySummary: document.querySelector('#todaySummary'),
  todayList: document.querySelector('#todayList'),
  summaryBody: document.querySelector('#summaryBody'),
  refreshButton: document.querySelector('#refreshButton'),
  workDurationChart: document.querySelector('#workDurationChart'),
  checkTimeChart: document.querySelector('#checkTimeChart'),
};

function init() {
  el.apiUrl.value = state.apiUrl;
  el.todayLabel.textContent = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  renderButtons();
  bindEvents();
  updateSetupNotice();
  loadData();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
}

function bindEvents() {
  el.saveUrlButton.addEventListener('click', () => {
    state.apiUrl = el.apiUrl.value.trim();
    localStorage.setItem('checkinApiUrl', state.apiUrl);
    setStatus('已保存 URL');
    updateSetupNotice();
    loadData();
  });

  el.refreshButton.addEventListener('click', loadData);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('is-active'));
      document.querySelectorAll('.view').forEach((item) => item.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.querySelector(`#view-${tab.dataset.view}`).classList.add('is-active');
      renderCharts();
    });
  });
}

function renderButtons() {
  el.checkinButtons.innerHTML = '';
  ACTIONS.forEach(([action, hint]) => {
    const button = document.createElement('button');
    button.className = 'checkin-button';
    button.type = 'button';
    button.innerHTML = `<strong>${action}</strong><span>${hint}</span>`;
    button.addEventListener('click', () => checkin(action));
    el.checkinButtons.appendChild(button);
  });
}

async function checkin(action) {
  if (!state.apiUrl) {
    setStatus('请先保存 Apps Script URL');
    updateSetupNotice();
    return;
  }

  setStatus(`${action} 提交中...`);
  try {
    const data = await jsonp(state.apiUrl, {
      mode: 'checkin',
      action,
      note: el.noteInput.value.trim(),
      source: 'PWA',
    });

    if (!data.ok) throw new Error(data.error || '打卡失败');
    el.noteInput.value = '';
    setStatus(data.message || `${action} 已记录`);
    await loadData();
  } catch (err) {
    setStatus(err.message || String(err));
  }
}

async function loadData() {
  if (!state.apiUrl) {
    renderAll();
    return;
  }

  setStatus('同步数据中...');
  try {
    const [records, summary] = await Promise.all([
      jsonp(state.apiUrl, { mode: 'records' }),
      jsonp(state.apiUrl, { mode: 'summary' }),
    ]);

    if (!records.ok) throw new Error(records.error || '读取记录失败');
    if (!summary.ok) throw new Error(summary.error || '读取汇总失败');

    state.records = records.rows || [];
    state.summary = summary.rows || [];
    renderAll();
    setStatus('数据已同步');
  } catch (err) {
    renderAll();
    setStatus(err.message || String(err));
  }
}

function renderAll() {
  updateSetupNotice();
  renderToday();
  renderSummary();
  renderCharts();
}

function renderToday() {
  const today = localDateKey(new Date());
  const records = state.records.filter((row) => row.date === today);
  const summary = state.summary.find((row) => row.date === today);

  el.todaySummary.innerHTML = '';
  [
    ['上班', summary?.workStart || '-'],
    ['下班', summary?.workEnd || '-'],
    ['午休', summary?.lunchDuration || '-'],
    ['工作', summary?.workDuration || '-'],
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'metric';
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    el.todaySummary.appendChild(item);
  });

  el.todayList.innerHTML = '';
  if (!records.length) {
    el.todayList.innerHTML = '<div class="list-item"><span>今天还没有打卡记录</span></div>';
    return;
  }

  records.slice().reverse().forEach((row) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `<strong>${row.action}</strong><span>${row.time || ''}</span>`;
    el.todayList.appendChild(item);
  });
}

function renderSummary() {
  el.summaryBody.innerHTML = '';
  if (!state.summary.length) {
    el.summaryBody.innerHTML = '<tr><td colspan="9">暂无汇总数据</td></tr>';
    return;
  }

  state.summary.slice().reverse().forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.date || ''}</td>
      <td>${row.workStart || '-'}</td>
      <td>${row.workEnd || '-'}</td>
      <td>${timeRange(row.lunchStart, row.lunchEnd)}</td>
      <td>${row.lunchDuration || '-'}</td>
      <td>${timeRange(row.dinnerStart, row.dinnerEnd)}</td>
      <td>${row.dinnerDuration || '-'}</td>
      <td>${row.workDuration || '-'}</td>
      <td>${row.warning || ''}</td>
    `;
    el.summaryBody.appendChild(tr);
  });
}

function renderCharts() {
  const rows = state.summary.slice(-21);
  drawLineChart(el.workDurationChart, {
    rows: rows.filter((row) => typeof row.workDurationHours === 'number'),
    getX: (row) => row.date.slice(5),
    series: [
      {
        label: '工作时长',
        color: '#176b55',
        getY: (row) => row.workDurationHours,
        format: (value) => `${value.toFixed(1)}h`,
      },
    ],
  });

  drawLineChart(el.checkTimeChart, {
    rows: rows.filter((row) => row.workStart || row.workEnd),
    getX: (row) => row.date.slice(5),
    series: [
      {
        label: '上班',
        color: '#176b55',
        getY: (row) => timeToHour(row.workStart),
        format: hourToTime,
      },
      {
        label: '下班',
        color: '#b86f2d',
        getY: (row) => timeToHour(row.workEnd),
        format: hourToTime,
      },
    ],
  });
}

function drawLineChart(canvas, config) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 52, right: 18, top: 20, bottom: 52 };
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const points = [];
  config.rows.forEach((row, index) => {
    config.series.forEach((serie, serieIndex) => {
      const y = serie.getY(row);
      if (typeof y === 'number' && Number.isFinite(y)) {
        points.push({ row, index, serieIndex, y });
      }
    });
  });

  if (!points.length) {
    ctx.fillStyle = '#65736c';
    ctx.font = '24px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.fillText('暂无足够数据', pad.left, height / 2);
    return;
  }

  const minY = Math.floor(Math.min(...points.map((p) => p.y)));
  const maxY = Math.ceil(Math.max(...points.map((p) => p.y)));
  const ySpan = Math.max(1, maxY - minY);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xDenom = Math.max(1, config.rows.length - 1);

  ctx.strokeStyle = '#dce4de';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#65736c';
  ctx.font = '18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const y = pad.top + plotHeight * ratio;
    const value = maxY - ySpan * ratio;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(config.series[0].format(value), 8, y + 6);
  }

  config.rows.forEach((row, index) => {
    if (index % Math.ceil(config.rows.length / 6) !== 0 && index !== config.rows.length - 1) return;
    const x = pad.left + (plotWidth * index) / xDenom;
    ctx.fillText(config.getX(row), x - 18, height - 18);
  });

  config.series.forEach((serie) => {
    ctx.strokeStyle = serie.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    let started = false;

    config.rows.forEach((row, index) => {
      const value = serie.getY(row);
      if (typeof value !== 'number' || !Number.isFinite(value)) return;

      const x = pad.left + (plotWidth * index) / xDenom;
      const y = pad.top + plotHeight - ((value - minY) / ySpan) * plotHeight;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  });
}

function jsonp(baseUrl, params) {
  return new Promise((resolve, reject) => {
    const callback = `checkinPwa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    url.searchParams.set('callback', callback);

    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('请求超时'));
    }, 20000);

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('请求失败，请检查 URL、网络或 Shadowrocket'));
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

function updateSetupNotice() {
  el.setupNotice.classList.toggle('is-visible', !state.apiUrl);
}

function setStatus(message) {
  el.statusLine.textContent = message;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeToHour(text) {
  if (!text) return null;
  const [hour, minute] = text.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour + minute / 60;
}

function timeRange(start, end) {
  if (!start && !end) return '-';
  return `${start || '?'} - ${end || '?'}`;
}

function hourToTime(value) {
  const safeValue = Math.max(0, value);
  const hour = Math.floor(safeValue);
  const minute = Math.round((safeValue - hour) * 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

init();
