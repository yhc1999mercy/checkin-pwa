const CONFIG = {
  timezone: 'Asia/Shanghai',
  recordsSheetName: '打卡记录',
  summarySheetName: '每日汇总',
  chartsSheetName: '图表',
  allowedActions: [
    '上班',
    '午休开始',
    '午休结束',
    '晚饭开始',
    '晚饭结束',
    '下班',
  ],
};

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = String(params.callback || '').trim();

  try {
    setupSheets();

    if (params.mode === 'checkin') {
      return apiOutput_(recordCheckin_({
        action: params.action,
        timestamp: params.timestamp,
        note: params.note,
        source: params.source || 'PWA',
      }), callback);
    }

    if (params.mode === 'summary') {
      rebuildSummary();
      return apiOutput_(getSummaryData_(), callback);
    }

    if (params.mode === 'records') {
      return apiOutput_(getRecordsData_(), callback);
    }

    return apiOutput_({
      ok: true,
      message: '打卡服务已部署。POST 用于快捷指令，GET JSONP 用于 PWA。',
      actions: CONFIG.allowedActions,
    }, callback);
  } catch (err) {
    return apiOutput_({
      ok: false,
      error: err && err.message ? err.message : String(err),
    }, callback);
  }
}

function doPost(e) {
  try {
    setupSheets();
    return jsonOutput(recordCheckin_(parsePayload(e)));
  } catch (err) {
    return jsonOutput({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}

function recordCheckin_(payload) {
  const action = String(payload.action || '').trim();
  if (!CONFIG.allowedActions.includes(action)) {
    return {
      ok: false,
      error: '未知打卡类型',
      allowedActions: CONFIG.allowedActions,
    };
  }

  const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    return { ok: false, error: 'timestamp 不是有效时间' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.recordsSheetName);
  const dateText = Utilities.formatDate(timestamp, CONFIG.timezone, 'yyyy-MM-dd');
  const timeText = Utilities.formatDate(timestamp, CONFIG.timezone, 'HH:mm:ss');
  const note = String(payload.note || '').trim();
  const source = String(payload.source || 'iPhone Shortcut').trim();

  sheet.appendRow([dateText, timeText, action, timestamp, note, source]);
  rebuildSummary();

  return {
    ok: true,
    action,
    date: dateText,
    time: timeText,
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    recordsSheetName: CONFIG.recordsSheetName,
    message: `${action} 已记录：${dateText} ${timeText}`,
  };
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const records = getOrCreateSheet_(ss, CONFIG.recordsSheetName);
  const summary = getOrCreateSheet_(ss, CONFIG.summarySheetName);
  getOrCreateSheet_(ss, CONFIG.chartsSheetName);

  if (records.getLastRow() === 0) {
    records.appendRow(['日期', '时间', '类型', '时间戳', '备注', '来源']);
    records.setFrozenRows(1);
  }

  if (summary.getLastRow() === 0) {
    summary.appendRow([
      '日期',
      '上班',
      '午休开始',
      '午休结束',
      '晚饭开始',
      '晚饭结束',
      '下班',
      '午休时长',
      '晚饭时长',
      '工作时长',
      '记录数',
      '异常',
    ]);
    summary.setFrozenRows(1);
  }
}

function rebuildSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const records = ss.getSheetByName(CONFIG.recordsSheetName);
  const summary = ss.getSheetByName(CONFIG.summarySheetName);
  const charts = ss.getSheetByName(CONFIG.chartsSheetName);
  const values = records.getDataRange().getValues().slice(1);
  const byDate = new Map();

  values.forEach((row) => {
    const action = String(row[2] || '').trim();
    const timestamp = normalizeTimestamp_(row[3]);
    const dateText = timestamp
      ? Utilities.formatDate(timestamp, CONFIG.timezone, 'yyyy-MM-dd')
      : normalizeDateText_(row[0]);

    if (!dateText || !CONFIG.allowedActions.includes(action) || !timestamp) {
      return;
    }

    if (!byDate.has(dateText)) {
      byDate.set(dateText, {
        date: dateText,
        actions: {},
        count: 0,
      });
    }

    const day = byDate.get(dateText);
    day.count += 1;
    if (!day.actions[action]) {
      day.actions[action] = [];
    }
    day.actions[action].push(timestamp);
  });

  const rows = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => buildSummaryRow_(day));

  summary.clearContents();
  summary.appendRow([
    '日期',
    '上班',
    '午休开始',
    '午休结束',
    '晚饭开始',
    '晚饭结束',
    '下班',
    '午休时长',
    '晚饭时长',
    '工作时长',
    '记录数',
    '异常',
  ]);

  if (rows.length > 0) {
    summary.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    summary.getRange(2, 2, rows.length, 9).setNumberFormat('[h]:mm');
  }

  summary.autoResizeColumns(1, 12);
  refreshCharts_(ss, summary, charts);
}

function buildSummaryRow_(day) {
  const workStart = first_(day.actions['上班']);
  const lunchBreaks = pairedBreaks_(day.actions['午休开始'], day.actions['午休结束']);
  const dinnerBreaks = pairedBreaks_(day.actions['晚饭开始'], day.actions['晚饭结束']);
  const lunchStart = first_(lunchBreaks.starts);
  const lunchEnd = last_(lunchBreaks.ends);
  const dinnerStart = first_(dinnerBreaks.starts);
  const dinnerEnd = last_(dinnerBreaks.ends);
  const workEnd = last_(day.actions['下班']);

  const lunchDuration = lunchBreaks.duration;
  const dinnerDuration = dinnerBreaks.duration;
  const totalSpan = durationDays_(workStart, workEnd);
  const workDuration = totalSpan === '' ? '' : Math.max(0, totalSpan - valueOrZero_(lunchDuration) - valueOrZero_(dinnerDuration));
  const warnings = [];

  if (!workStart) warnings.push('缺上班');
  if (!workEnd) warnings.push('缺下班');
  if (lunchBreaks.unmatchedStarts || lunchBreaks.unmatchedEnds) warnings.push('午休不完整');
  if (dinnerBreaks.unmatchedStarts || dinnerBreaks.unmatchedEnds) warnings.push('晚饭不完整');

  return [
    day.date,
    timeOfDay_(workStart),
    timeOfDay_(lunchStart),
    timeOfDay_(lunchEnd),
    timeOfDay_(dinnerStart),
    timeOfDay_(dinnerEnd),
    timeOfDay_(workEnd),
    lunchDuration,
    dinnerDuration,
    workDuration,
    day.count,
    warnings.join('、'),
  ];
}

function pairedBreaks_(starts, ends) {
  const sortedStarts = sortedDates_(starts);
  const sortedEnds = sortedDates_(ends);
  const pairedStarts = [];
  const pairedEnds = [];
  let endIndex = 0;
  let unmatchedStarts = 0;
  let duration = 0;

  sortedStarts.forEach((start) => {
    while (endIndex < sortedEnds.length && sortedEnds[endIndex] <= start) {
      endIndex += 1;
    }

    if (endIndex >= sortedEnds.length) {
      unmatchedStarts += 1;
      return;
    }

    const end = sortedEnds[endIndex];
    pairedStarts.push(start);
    pairedEnds.push(end);
    duration += durationDays_(start, end);
    endIndex += 1;
  });

  return {
    starts: pairedStarts,
    ends: pairedEnds,
    duration: pairedStarts.length ? duration : '',
    unmatchedStarts,
    unmatchedEnds: Math.max(0, sortedEnds.length - endIndex),
  };
}

function refreshCharts_(ss, summary, charts) {
  charts.clear();
  charts.getCharts().forEach((chart) => charts.removeChart(chart));
  charts.getRange('A1').setValue('图表会在有至少 2 天汇总数据后自动生成。');

  const lastRow = summary.getLastRow();
  if (lastRow < 3) {
    return;
  }

  const workDurationChart = charts.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(summary.getRange(1, 1, lastRow, 1))
    .addRange(summary.getRange(1, 10, lastRow, 1))
    .setPosition(2, 1, 0, 0)
    .setOption('title', '每日工作时长')
    .setOption('legend', { position: 'bottom' })
    .setOption('vAxis', { format: '[h]:mm' })
    .build();

  const checkTimeChart = charts.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(summary.getRange(1, 1, lastRow, 1))
    .addRange(summary.getRange(1, 2, lastRow, 1))
    .addRange(summary.getRange(1, 7, lastRow, 1))
    .setPosition(20, 1, 0, 0)
    .setOption('title', '上下班时间变化')
    .setOption('legend', { position: 'bottom' })
    .setOption('vAxis', { format: 'HH:mm' })
    .build();

  charts.insertChart(workDurationChart);
  charts.insertChart(checkTimeChart);
}

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  return JSON.parse(e.postData.contents);
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiOutput_(data, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(data)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return jsonOutput(data);
}

function getSummaryData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = ss.getSheetByName(CONFIG.summarySheetName);
  const rows = sheetToObjects_(summary).map((row) => ({
    date: normalizeDateText_(row['日期']),
    workStart: serialTimeToText_(row['上班']),
    lunchStart: serialTimeToText_(row['午休开始']),
    lunchEnd: serialTimeToText_(row['午休结束']),
    dinnerStart: serialTimeToText_(row['晚饭开始']),
    dinnerEnd: serialTimeToText_(row['晚饭结束']),
    workEnd: serialTimeToText_(row['下班']),
    lunchDuration: serialDurationToText_(row['午休时长']),
    dinnerDuration: serialDurationToText_(row['晚饭时长']),
    workDuration: serialDurationToText_(row['工作时长']),
    workDurationHours: serialDurationToHours_(row['工作时长']),
    recordCount: row['记录数'] || 0,
    warning: row['异常'] || '',
  }));

  return {
    ok: true,
    rows,
    actions: CONFIG.allowedActions,
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
  };
}

function getRecordsData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const records = ss.getSheetByName(CONFIG.recordsSheetName);
  const rows = sheetToObjects_(records).map((row) => ({
    date: normalizeRecordDate_(row),
    time: normalizeRecordTime_(row),
    action: row['类型'],
    timestamp: normalizeTimestamp_(row['时间戳']) ? normalizeTimestamp_(row['时间戳']).toISOString() : '',
    note: row['备注'] || '',
    source: row['来源'] || '',
  }));

  return {
    ok: true,
    rows,
    actions: CONFIG.allowedActions,
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
  };
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index];
    });
    return item;
  });
}

function serialTimeToText_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.timezone, 'HH:mm');
  }

  if (typeof value === 'string') {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    return match ? `${pad2_(Number(match[1]))}:${match[2]}` : '';
  }

  if (typeof value !== 'number') return '';
  const seconds = Math.round(value * 86400) % 86400;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${pad2_(hours)}:${pad2_(minutes)}`;
}

function serialDurationToText_(value) {
  const totalMinutes = durationToMinutes_(value);
  if (totalMinutes === null) return '';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${pad2_(minutes)}`;
}

function serialDurationToHours_(value) {
  const totalMinutes = durationToMinutes_(value);
  return totalMinutes === null ? null : Math.round((totalMinutes / 60) * 100) / 100;
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

function normalizeTimestamp_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateText_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.timezone, 'yyyy-MM-dd');
  }

  const text = String(value || '').trim();
  if (!text) return '';

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? text
    : Utilities.formatDate(parsed, CONFIG.timezone, 'yyyy-MM-dd');
}

function normalizeRecordDate_(row) {
  const timestamp = normalizeTimestamp_(row['时间戳']);
  return timestamp
    ? Utilities.formatDate(timestamp, CONFIG.timezone, 'yyyy-MM-dd')
    : normalizeDateText_(row['日期']);
}

function normalizeRecordTime_(row) {
  const timestamp = normalizeTimestamp_(row['时间戳']);
  if (timestamp) {
    return Utilities.formatDate(timestamp, CONFIG.timezone, 'HH:mm:ss');
  }

  return serialTimeToText_(row['时间']);
}

function durationToMinutes_(value) {
  if (typeof value === 'number') {
    return Math.round(value * 1440);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hours = Number(Utilities.formatDate(value, CONFIG.timezone, 'H'));
    const minutes = Number(Utilities.formatDate(value, CONFIG.timezone, 'm'));
    return hours * 60 + minutes;
  }

  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function first_(items) {
  return items && items.length ? items.slice().sort((a, b) => a - b)[0] : null;
}

function last_(items) {
  return items && items.length ? items.slice().sort((a, b) => a - b)[items.length - 1] : null;
}

function sortedDates_(items) {
  return items && items.length ? items.slice().sort((a, b) => a - b) : [];
}

function timeOfDay_(date) {
  if (!date) return '';
  const hours = Number(Utilities.formatDate(date, CONFIG.timezone, 'H'));
  const minutes = Number(Utilities.formatDate(date, CONFIG.timezone, 'm'));
  const seconds = Number(Utilities.formatDate(date, CONFIG.timezone, 's'));
  return (hours * 3600 + minutes * 60 + seconds) / 86400;
}

function durationDays_(start, end) {
  if (!start || !end) return '';
  return Math.max(0, (end.getTime() - start.getTime()) / 86400000);
}

function valueOrZero_(value) {
  return typeof value === 'number' ? value : 0;
}
