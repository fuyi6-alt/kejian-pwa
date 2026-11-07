(function (global) {
  'use strict';

  var KEY = 'anatomy.study.v1';
  var REAL_KEY = KEY;
  var TEST_KEY = 'anatomy.study.test.v1';
  var MODE_KEY = 'anatomy.study.testmode.v1';
  var CACHE_KEY = 'anatomy.ai.diagnostics.v1';
  var TEST_CACHE_KEY = 'anatomy.ai.diagnostics.test.v1';
  var testMode = false;
  var modeRaw = null;
  var inBatch = false;
  var INTERVALS = [1, 3, 7, 15, 30];
  var state = null;
  var lastRaw = null;
  var notices = [];
  var readonly = false;
  var initialized = false;
  var Store = { notices: notices, readOnly: false, lastSaveOk: true, onNotice: null };

  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function safeKey(key) { return typeof key === 'string' && key.length > 0 && key !== '__proto__' && key !== 'constructor' && key !== 'prototype'; }
  function number(value) { return typeof value === 'number' && isFinite(value) && value >= 0; }
  function integer(value) { return number(value) && Number.isSafeInteger(value); }
  function examDate(value) {
    if (value === '') { return true; }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
    var parsed = new Date(value + 'T12:00:00');
    return !isNaN(parsed.getTime()) && parsed.getFullYear() === Number(value.slice(0, 4)) && parsed.getMonth() + 1 === Number(value.slice(5, 7)) && parsed.getDate() === Number(value.slice(8, 10));
  }
  function now() { return new Date().toISOString(); }
  function dateString(date) { return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2); }
  function addDays(value, count) {
    if (!value || !examDate(value) || !Number.isSafeInteger(count)) { throw new Error('日期或天数无效'); }
    var date = new Date(value + 'T12:00:00');
    date.setDate(date.getDate() + count);
    return dateString(date);
  }
  function today() {
    var date = new Date();
    if (testMode && state) { date.setDate(date.getDate() + (state.debugDayOffset || 0)); }
    return dateString(date);
  }
  function empty() {
    return {
      schemaVersion: 1,
      revision: 0,
      settings: { examDate: '', dailyGoal: 20 },
      questions: {}, options: {}, wrong: {}, sessions: {}, daily: {}, issues: [],
      activeSessionId: null, lastResultSessionId: null, exams: {}, activeExamId: null,
      firstUsedAt: now(), lastBackupAt: null, debugDayOffset: 0
    };
  }
  function notice(code, message, blocking) {
    var found = notices.some(function (item) { return item.code === code; });
    if (!found) {
      var item = { code: code, message: message, blocking: !!blocking };
      notices.push(item);
      if (typeof Store.onNotice === 'function') {
        try { Store.onNotice(item); } catch (ignore) { /* 通知组件失败不影响保护原数据。 */ }
      }
    }
  }
  function lock(code, message) {
    readonly = true;
    Store.readOnly = true;
    Store.lastSaveOk = false;
    notice(code, message, true);
  }
  function validOptional(record, fields, test) {
    return fields.every(function (key) { return !own(record, key) || test(record[key]); });
  }
  function validMap(map, predicate) {
    return object(map) && Object.keys(map).every(function (key) { return safeKey(key) && predicate(map[key], key); });
  }
  function stringOrNull(value) { return value === null || typeof value === 'string'; }
  function bool(value) { return typeof value === 'boolean'; }
  function checkQuestion(q) {
    return object(q) && safeKey(q.id) &&
      ['attempts', 'correct', 'correctCount', 'wrongCount', 'correctStreak', 'uncertainCount', 'uncertainStreak'].every(function (key) { return integer(q[key]); }) &&
      ['everWrong', 'mastered', 'uncertain', 'pendingConsolidation'].every(function (key) { return bool(q[key]); }) &&
      ['draft', 'chapterId', 'type'].every(function (key) { return typeof q[key] === 'string'; }) &&
      q.correct + q.wrongCount === q.attempts && q.correctCount === q.correct && q.uncertain === q.pendingConsolidation &&
      validOptional(q, ['answer', 'lastAnswer', 'lastRating', 'selectedWrongOption', 'lastAnsweredAt', 'lastUncertainAt'], stringOrNull) &&
      validOptional(q, ['lastRatio'], function (x) { return x === null || (number(x) && x <= 1); }) &&
      validOptional(q, ['box'], function (x) { return integer(x) && x >= 1 && x <= 5; }) &&
      validOptional(q, ['dueAt'], function (x) { return x === null || (!!x && examDate(x)); }) &&
      (!own(q, 'attemptIds') || validMap(q.attemptIds, function (x) { return typeof x === 'string'; }));
  }
  function checkAnswer(a) {
    return object(a) && (a.correct === null || typeof a.correct === 'boolean') &&
      stringOrNull(a.value) && stringOrNull(a.rating) &&
      (a.ratio === null || (number(a.ratio) && a.ratio <= 1)) && typeof a.answeredAt === 'string' &&
      validOptional(a, ['uncertain', 'browsed'], bool) && validOptional(a, ['attemptId'], stringOrNull);
  }
  function checkPresentation(p) {
    return object(p) && ['read', 'write'].indexOf(p.mode) !== -1 && bool(p.revealed) &&
      Array.isArray(p.checks) && p.checks.every(integer) &&
      p.checks.every(function (value, index) { return p.checks.indexOf(value) === index; });
  }
  function checkSession(s) {
    return object(s) && safeKey(s.id) && Array.isArray(s.ids) && s.ids.length > 0 && s.ids.every(safeKey) &&
      s.ids.every(function (id, index) { return s.ids.indexOf(id) === index; }) &&
      integer(s.index) && (s.status === 'active' ? s.index < s.ids.length : s.index <= s.ids.length) &&
      validMap(s.answers, function (a, id) { return s.ids.indexOf(id) !== -1 && checkAnswer(a); }) && number(s.elapsedMs) &&
      ['active', 'complete'].indexOf(s.status) !== -1 && typeof s.startedAt === 'string' &&
      typeof s.label === 'string' && typeof s.mode === 'string' && stringOrNull(s.chapterId) &&
      (!own(s, 'presentation') || validMap(s.presentation, function (p, id) { return s.ids.indexOf(id) !== -1 && checkPresentation(p); }));
  }
  function timestamp(value) { return typeof value === 'string' && !isNaN(new Date(value).getTime()); }
  function nullableTimestamp(value) { return value === null || timestamp(value); }
  function checkExamResponse(response) {
    return object(response) && stringOrNull(response.value) && typeof response.draft === 'string' &&
      bool(response.uncertain) && bool(response.skipped) && [null, '会', '模糊', '不会'].indexOf(response.rating) !== -1 &&
      Array.isArray(response.checks) && response.checks.every(function (n, i) { return integer(n) && response.checks.indexOf(n) === i; });
  }
  function checkExamResult(result, ids) {
    if (!object(result) || !number(result.score) || !number(result.maxScore) || result.maxScore <= 0 || result.score > result.maxScore ||
        !integer(result.percentage) || result.percentage !== Math.round(result.score / result.maxScore * 100) ||
        !integer(result.correct) || !integer(result.attempts) || result.correct > result.attempts ||
        !Array.isArray(result.items) || result.items.length !== ids.length) return false;
    var seen = {}, score = 0, maximum = 0, correct = 0, attempts = 0;
    var valid = result.items.every(function (item) {
      if (!object(item) || !safeKey(item.qid) || ids.indexOf(item.qid) === -1 || seen[item.qid] ||
          ['mcq', 'short'].indexOf(item.type) === -1 || !number(item.score) ||
          item.maxScore !== (item.type === 'mcq' ? 1 : 2) || item.score > item.maxScore ||
          (item.correct !== null && !bool(item.correct)) || !stringOrNull(item.value) ||
          [null, '会', '模糊', '不会'].indexOf(item.rating) === -1 ||
          (item.ratio !== null && (!number(item.ratio) || item.ratio > 1)) || !bool(item.unanswered) || !bool(item.uncertain)) return false;
      if (item.unanswered ? item.correct !== null || item.score !== 0 : !bool(item.correct)) return false;
      if (!item.unanswered && item.type === 'mcq' && item.score !== (item.correct ? 1 : 0)) return false;
      if (!item.unanswered && item.type === 'short') {
        var shortScore = item.ratio === null ? {'会': 2, '模糊': 1, '不会': 0}[item.rating] : item.ratio * 2;
        if (item.rating === null || item.correct !== (item.rating === '会') || Math.abs(item.score - shortScore) > 1e-8) return false;
      }
      seen[item.qid] = true; score += item.score; maximum += item.maxScore;
      if (item.correct !== null) attempts += 1;
      if (item.correct === true) correct += 1;
      return true;
    });
    return valid && Math.abs(result.score - score) < 1e-8 && result.maxScore === maximum && result.correct === correct && result.attempts === attempts;
  }
  function checkExam(exam) {
    return object(exam) && safeKey(exam.id) && typeof exam.title === 'string' &&
      Array.isArray(exam.ids) && exam.ids.length > 0 && exam.ids.every(function (id, i) { return safeKey(id) && exam.ids.indexOf(id) === i; }) &&
      integer(exam.index) && exam.index < exam.ids.length && ['active', 'grading', 'complete'].indexOf(exam.status) !== -1 &&
      ['all', 'chapters', 'wrong'].indexOf(exam.scope) !== -1 && Array.isArray(exam.chapterIds) &&
      exam.chapterIds.every(function (id, i) { return safeKey(id) && exam.chapterIds.indexOf(id) === i; }) &&
      [0, 1, 30, 45, 60].indexOf(exam.durationMinutes) !== -1 && timestamp(exam.startedAt) &&
      nullableTimestamp(exam.deadlineAt) && (exam.durationMinutes === 0 ? exam.deadlineAt === null : exam.deadlineAt !== null) &&
      nullableTimestamp(exam.submittedAt) && nullableTimestamp(exam.completedAt) &&
      (!own(exam, 'statsCommitted') || (bool(exam.statsCommitted) && (!exam.statsCommitted || exam.status === 'complete'))) &&
      validMap(exam.responses, function (response, id) { return exam.ids.indexOf(id) !== -1 && checkExamResponse(response); }) &&
      (exam.status === 'active' ? exam.submittedAt === null && exam.completedAt === null && exam.result === null :
        timestamp(exam.submittedAt) && (exam.status === 'grading' ? exam.completedAt === null && exam.result === null :
          timestamp(exam.completedAt) && checkExamResult(exam.result, exam.ids)));
  }
  function upgrade(data) {
    // 只增加缺失字段；历史作答不会被重新判分或推算复习日期。
    data.featureVersion = 3;
    if (!data.generated) data.generated = {};
    if (!data.generatedGroups) data.generatedGroups = {};
    if (data.activeGeneratedGroupId===undefined) data.activeGeneratedGroupId=null;
    if (!data.generationKeys) data.generationKeys = {};
    if (!data.generatedStats) data.generatedStats = { attempts: 0, correct: 0, practicedIds: {} };
    if (!data.generatedStats.chapters) {
      data.generatedStats.chapters = {};
      Object.keys(data.generated).forEach(function (id) {
        var g = data.generated[id];
        if (!safeKey(g.chapterId) || !g.attempts) return;
        var chapter = data.generatedStats.chapters[g.chapterId];
        if (!chapter) chapter = data.generatedStats.chapters[g.chapterId] = { attempts: 0, correct: 0, practicedIds: {} };
        chapter.attempts += g.attempts;
        chapter.correct += g.right;
        chapter.practicedIds[id] = true;
      });
    }
    if (!data.aiStats) data.aiStats = { calls: 0, successes: 0, failures: 0, assemblyAttempts: 0, assemblyAccepted: 0 };
    if (!data.settings.ai) data.settings.ai = { enabled: false, mode: 'proxy', proxyUrl: '', model: 'deepseek-chat', privacyAccepted: false };
    if (!data.firstUsedAt) {
      var dates = Object.keys(data.daily).filter(function (d) { return d && examDate(d); }).sort();
      data.firstUsedAt = dates.length ? dates[0] + 'T12:00:00' : now();
    }
    if (data.lastBackupAt === undefined) data.lastBackupAt = null;
    if (data.debugDayOffset === undefined) data.debugDayOffset = 0;
    if (data.exams === undefined) data.exams = {};
    if (data.activeExamId === undefined) data.activeExamId = null;
    Object.keys(data.questions).forEach(function (id) {
      if (data.questions[id].box === undefined) data.questions[id].box = 1;
      if (data.questions[id].dueAt === undefined) data.questions[id].dueAt = null;
    });
    if (testMode) data.settings.ai.enabled = false;
    Object.keys(data.options).forEach(function (id) { syncOption(data.options[id]); });
  }
  function syncOption(o) {
    o.wrongCount = o.count;
    o.status = o.mastered ? 'mastered' : 'unknown';
    if (o.judgeRight === undefined) o.judgeRight = 0;
    if (o.judgeWrong === undefined) o.judgeWrong = 0;
    if (o.judgeStreak === undefined) o.judgeStreak = 0;
    o.lastAt = o.lastAt || o.lastMarkedAt || null;
  }
  function validStage2(data) {
    if (data.featureVersion === undefined) return true;
    var ai = data.settings.ai;
    return [2, 3].indexOf(data.featureVersion) !== -1 && object(ai) && bool(ai.enabled) && bool(ai.privacyAccepted) &&
      ['proxy', 'direct'].indexOf(ai.mode) !== -1 && typeof ai.proxyUrl === 'string' && typeof ai.model === 'string' &&
      object(data.aiStats) && ['calls','successes','failures','assemblyAttempts','assemblyAccepted'].every(function (k) { return integer(data.aiStats[k]); }) &&
      object(data.generatedStats) && integer(data.generatedStats.attempts) && integer(data.generatedStats.correct) &&
      data.generatedStats.correct <= data.generatedStats.attempts && validMap(data.generatedStats.practicedIds, bool) &&
      (!own(data.generatedStats, 'chapters') || validMap(data.generatedStats.chapters, function (c) {
        return object(c) && integer(c.attempts) && integer(c.correct) && c.correct <= c.attempts && validMap(c.practicedIds, bool);
      })) &&
      object(data.generated) && validMap(data.generationKeys, function (id, signature) { return typeof id === 'string' && own(data.generated, id) && data.generated[id].signature===signature; }) &&
      validMap(data.generated, function (g, id) {
        return object(g) && g.id === id && ['judge','assembled'].indexOf(g.type) !== -1 && typeof g.stem === 'string' &&
          typeof g.answer === 'string' && typeof g.explanation === 'string' && typeof g.chapterId === 'string' &&
          typeof g.createdAt === 'string' && safeKey(g.signature) && data.generationKeys[g.signature]===id && bool(g.aiUsed) && bool(g.mastered) &&
          ['right','wrong','streak','attempts'].every(function (k) { return integer(g[k]); }) && g.right + g.wrong === g.attempts &&
          Array.isArray(g.sources) && g.sources.length > 0 && g.sources.every(function (s) {return object(s) && safeKey(s.qid) && safeKey(s.key) && typeof s.text === 'string';}) &&
          (!g.activeAttempt || (object(g.activeAttempt) && safeKey(g.activeAttempt.id) &&
            (g.activeAttempt.value===null ? g.activeAttempt.correct===null :
              (g.type==='judge'?['对','错']:['A','B','C','D']).indexOf(g.activeAttempt.value)>=0 && g.activeAttempt.correct===(g.activeAttempt.value===g.answer)))) &&
          (g.type === 'judge' ? ['对','错'].indexOf(g.answer) !== -1 : Array.isArray(g.options) && g.options.length === 4 &&
            g.options.every(function (o, i) {return object(o) && o.key === 'ABCD'[i] && typeof o.text === 'string';}) &&
            g.sources.length===4 && /^[ABCD]$/.test(g.answer) && object(g.validation) && typeof g.validation.checkedAt === 'string' && typeof g.validation.model === 'string' && typeof g.validation.promptVersion === 'string');
      }) && (data.generatedGroups===undefined || (validMap(data.generatedGroups,function(group,id){
        return object(group)&&group.id===id&&typeof group.title==='string'&&typeof group.createdAt==='string'&&
          Array.isArray(group.ids)&&group.ids.length>0&&group.ids.every(function(gid,i){return safeKey(gid)&&group.ids.indexOf(gid)===i&&own(data.generated,gid)&&data.generated[gid].type==='judge';})&&
          integer(group.index)&&group.index<group.ids.length&&['active','complete'].indexOf(group.status)>=0&&
          validMap(group.answers,function(a,gid){return group.ids.indexOf(gid)>=0&&object(a)&&['对','错'].indexOf(a.value)>=0&&bool(a.correct)&&a.correct===(a.value===data.generated[gid].answer)&&typeof a.answeredAt==='string';});
      })&&(data.activeGeneratedGroupId===null||own(data.generatedGroups,data.activeGeneratedGroupId))));
  }
  function validate(data) {
    return object(data) && data.schemaVersion === 1 && object(data.settings) &&
      examDate(data.settings.examDate) && integer(data.settings.dailyGoal) && data.settings.dailyGoal >= 1 && data.settings.dailyGoal <= 10000 &&
      validMap(data.questions, function (q, id) { return checkQuestion(q) && q.id === id; }) &&
      validMap(data.options, function (o, id) {
        return object(o) && safeKey(o.qid) && safeKey(o.key) && id === o.qid + ':' + o.key &&
          ['autoRecorded', 'active', 'mastered', 'manualMarked'].every(function (key) { return bool(o[key]); }) &&
          ['count', 'autoCount', 'manualCount'].every(function (key) { return integer(o[key]); }) &&
          o.count === o.autoCount + o.manualCount && validOptional(o, ['lastMarkedAt'], stringOrNull) &&
          (data.featureVersion===undefined || (o.wrongCount===o.count && o.status===(o.mastered?'mastered':'unknown') && ['judgeRight','judgeWrong','judgeStreak'].every(function(k){return integer(o[k]);}) && stringOrNull(o.lastAt))) &&
          Array.isArray(o.sources) && o.sources.every(function (x) { return typeof x === 'string'; });
      }) &&
      validMap(data.wrong, function (w, id) {
        return object(w) && safeKey(w.qid) && w.qid === id && own(data.questions, id) && bool(w.active) && bool(w.mastered) &&
          validOptional(w, ['firstAddedAt', 'lastAddedAt', 'removedAt'], stringOrNull) &&
          validOptional(w, ['chapterId', 'type', 'source'], function (x) { return typeof x === 'string'; });
      }) &&
      validMap(data.sessions, function (s, id) { return checkSession(s) && s.id === id; }) &&
      validMap(data.daily, function (d) { return object(d) && integer(d.attempts) && integer(d.correct) && d.correct <= d.attempts && validOptional(d, ['correctCount', 'practice', 'review', 'exam'], integer); }) &&
      Array.isArray(data.issues) && data.issues.every(function (i) { return object(i) && typeof i.reason === 'string' && safeKey(i.qid); }) &&
      stringOrNull(data.activeSessionId) && stringOrNull(data.lastResultSessionId) &&
      (data.activeSessionId === null || (own(data.sessions, data.activeSessionId) && data.sessions[data.activeSessionId].status === 'active')) &&
      (data.lastResultSessionId === null || (own(data.sessions, data.lastResultSessionId) && data.sessions[data.lastResultSessionId].status === 'complete')) &&
      (!own(data, 'revision') || integer(data.revision)) &&
      validOptional(data, ['firstUsedAt'], function (x) { return typeof x === 'string' && !isNaN(new Date(x).getTime()); }) &&
      validOptional(data, ['lastBackupAt'], function (x) { return x === null || (typeof x === 'string' && !isNaN(new Date(x).getTime())); }) &&
      validOptional(data, ['debugDayOffset'], function (x) { return Number.isSafeInteger(x) && Math.abs(x) <= 36500; }) &&
      (!own(data, 'exams') || validMap(data.exams, function (exam, id) { return checkExam(exam) && exam.id === id; })) &&
      (!own(data, 'activeExamId') || (data.activeExamId === null || (safeKey(data.activeExamId) && object(data.exams) && own(data.exams, data.activeExamId) && data.exams[data.activeExamId].status !== 'complete'))) &&
      validStage2(data);
  }
  function init() {
    if (initialized) { return state; }
    initialized = true;
    state = empty();
    try {
      modeRaw = global.localStorage.getItem(MODE_KEY);
      testMode = modeRaw === 'test';
      KEY = testMode ? TEST_KEY : REAL_KEY;
      lastRaw = global.localStorage.getItem(KEY);
      if (lastRaw !== null) {
        var parsed = JSON.parse(lastRaw);
        if (!validate(parsed)) { throw new Error('invalid structure or version'); }
        state = parsed;
        state.revision = state.revision || 0;
      }
      upgrade(state);
    } catch (error) {
      lock('storage-invalid', '本机学习数据无法读取或格式损坏。原数据已保留，当前停止保存；请先备份原数据并处理后再继续，切勿清空浏览器数据。');
      upgrade(state);
    }
    return state;
  }
  function ready() {
    init();
    if (readonly) { return false; }
    try {
      if (global.localStorage.getItem(KEY) !== lastRaw || global.localStorage.getItem(MODE_KEY) !== modeRaw) {
        lock('storage-conflict', '另一个页面已更新学习数据。本页已暂停保存，请刷新后继续，避免覆盖新进度。');
      }
    } catch (error) {
      lock('storage-inaccessible', '浏览器暂时无法访问学习存储。当前停止保存，已存数据保持原状，请先处理浏览器存储权限。');
    }
    return !readonly;
  }
  function get() { return init(); }
  function clearNotice(code) {
    for (var i = notices.length - 1; i >= 0; i -= 1) {
      if (notices[i].code === code) { notices.splice(i, 1); }
    }
  }
  function save() {
    init();
    if (inBatch) { return true; }
    if (readonly) { Store.lastSaveOk = false; return false; }
    upgrade(state);
    var previousState;try{previousState=JSON.parse(lastRaw||'{}');}catch(ignore){previousState={};}
    ['questions','options'].forEach(function(kind){Object.keys(state[kind]).forEach(function(id){
      var old=(previousState[kind]||{})[id],record=state[kind][id];
      if((!old||JSON.stringify(old)!==JSON.stringify(record))&&(!record.lastAt||(old&&record.lastAt===old.lastAt)))record.lastAt=now();
    });});
    try {
      // 防止另一个标签页的较新记录被本页旧状态覆盖。
      if (global.localStorage.getItem(KEY) !== lastRaw || global.localStorage.getItem(MODE_KEY) !== modeRaw) {
        lock('storage-conflict', '另一个页面已更新学习数据。本页已暂停保存，请刷新后继续，避免覆盖新进度。');
        return false;
      }
      if (!validate(state)) {
        Store.lastSaveOk = false;
        notice('storage-state-invalid', '当前学习记录结构异常，已停止写入并保留上一次已保存的数据。请保持页面打开并联系维护者检查。', true);
        return false;
      }
      state.revision = (state.revision || 0) + 1;
      var encoded = JSON.stringify(state);
      try {
        global.localStorage.setItem(KEY, encoded);
      } catch (error) {
        if (error.name !== 'QuotaExceededError' && error.name !== 'NS_ERROR_DOM_QUOTA_REACHED' && error.code !== 22 && error.code !== 1014) { throw error; }
        // 只清理可重新获取的诊断缓存，绝不清题目、生成题或凭据。
        global.localStorage.removeItem(testMode ? TEST_CACHE_KEY : CACHE_KEY);
        if (object(state.aiDiagnostics)) { delete state.aiDiagnostics; }
        if (object(state.diagnosticCache)) { delete state.diagnosticCache; }
        encoded = JSON.stringify(state);
        global.localStorage.setItem(KEY, encoded);
        notice('quota-recovered', '存储空间不足，已清理诊断缓存并成功保存。建议尽快备份学习数据。', false);
      }
      lastRaw = encoded;
      Store.lastSaveOk = true;
      clearNotice('storage-save-failed');
      clearNotice('storage-state-invalid');
      return true;
    } catch (error) {
      Store.lastSaveOk = false;
      notice('storage-save-failed', '学习记录未能保存到本机（可能空间不足或浏览器禁止存储）。请勿关闭或刷新页面，可在“我的”导出已有学习数据。', true);
      return false;
    }
  }
  function question(id) {
    init();
    if (!safeKey(id)) { throw new Error('无效题目 ID'); }
    if (!own(state.questions, id)) {
      var record = {
        id: id, chapterId: '', type: '', attempts: 0, correct: 0, correctCount: 0,
        wrongCount: 0, everWrong: false, mastered: false, correctStreak: 0,
        uncertainCount: 0, uncertain: false, pendingConsolidation: false, uncertainStreak: 0,
        lastUncertainAt: null, selectedWrongOption: null, answer: null, lastAnswer: null,
        lastRating: null, lastRatio: null, lastAnsweredAt: null, draft: '', attemptIds: {}, box: 1, dueAt: null
      };
      if (readonly) { return record; }
      state.questions[id] = record;
    }
    return state.questions[id];
  }
  function option(qid, key) {
    if (!safeKey(qid) || !safeKey(key)) { throw new Error('无效选项'); }
    var id = qid + ':' + key;
    if (!own(state.options, id)) {
      state.options[id] = { qid: qid, key: key, autoRecorded: false, count: 0, autoCount: 0, manualCount: 0, manualMarked: false, sources: [], active: false, mastered: false, lastMarkedAt: null };
    }
    return state.options[id];
  }
  function addSource(mark, source) { if (mark.sources.indexOf(source) === -1) { mark.sources.push(source); } }
  function enroll(q, source) {
    var record = question(q.id);
    record.chapterId = q.chapterId || record.chapterId;
    record.type = q.type || record.type;
    record.mastered = false;
    var entry = state.wrong[q.id];
    if (!entry) {
      entry = { qid: q.id, chapterId: record.chapterId, type: record.type, firstAddedAt: now(), active: true, mastered: false, source: source, manual: source === 'manual', removedAt: null };
      state.wrong[q.id] = entry;
    }
    entry.active = true;
    entry.mastered = false;
    entry.lastAddedAt = now();
    if (source === 'manual') { entry.manual = true; }
    return entry;
  }
  function recordAnswer(q, payload) {
    if (!ready()) { return null; }
    if (!q || !safeKey(q.id) || !object(payload)) { throw new Error('答题记录参数无效'); }
    var record = question(q.id);
    record.chapterId = q.chapterId || record.chapterId;
    record.type = q.type || record.type;
    var sid = payload.sessionId;
    var attemptId = payload.attemptId || (sid ? sid + ':' + q.id : null);
    if (attemptId && !safeKey(attemptId)) { throw new Error('无效作答 ID'); }
    record.attemptIds = record.attemptIds || {};
    if (attemptId && own(record.attemptIds, attemptId)) {
      return Store.lastSaveOk || save() ? record : null;
    }
    var rating = ['会', '模糊', '不会'].indexOf(payload.rating) !== -1 ? payload.rating : null;
    var ratio = typeof payload.ratio === 'number' && isFinite(payload.ratio) ? Math.max(0, Math.min(1, payload.ratio)) : null;
    var correct = payload.correct === true ? true : payload.correct === false ? false : null;
    if (q.type === 'short' && rating) { correct = rating === '会'; }
    var stamp = now();
    var value = payload.value === null || payload.value === undefined ? null : String(payload.value);
    record.answer = value;
    record.lastAnswer = value;
    record.lastRating = rating;
    record.lastRatio = ratio;
    record.lastAnsweredAt = stamp;
    if (attemptId) { record.attemptIds[attemptId] = stamp; }
    // 判分、错题和自动错选项一并写入同一份记录，弹窗操作不参与此事务。
    if (correct !== null) {
      record.attempts += 1;
      if (correct) {
        record.correct += 1;
        var qualifies = q.type !== 'short' || ratio === null || ratio >= 0.8;
        record.correctStreak = qualifies ? record.correctStreak + 1 : 0;
        if (record.uncertain) {
          record.uncertainStreak += 1;
          if (record.uncertainStreak >= 2) {
            record.uncertain = false;
            record.pendingConsolidation = false;
          }
        }
        if (record.correctStreak >= 2) {
          record.mastered = true;
          if (state.wrong[q.id]) {
            state.wrong[q.id].active = false;
            state.wrong[q.id].mastered = true;
            state.wrong[q.id].removedAt = stamp;
          }
        }
      } else {
        record.wrongCount += 1;
        record.everWrong = true;
        record.correctStreak = 0;
        record.uncertainStreak = 0;
        record.mastered = false;
        enroll(q, q.type === 'short' ? 'self-rating' : 'wrong-answer');
        if (q.type === 'mcq' && value) {
          record.selectedWrongOption = value;
          var wrongOption = option(q.id, value);
          wrongOption.autoRecorded = true;
          wrongOption.autoCount += 1;
          wrongOption.count = wrongOption.autoCount + wrongOption.manualCount;
          wrongOption.active = true;
          wrongOption.mastered = false;
          wrongOption.judgeStreak = 0;
          wrongOption.lastMarkedAt = stamp;
          addSource(wrongOption, 'wrong-answer');
        }
      }
      record.correctCount = record.correct;
      if (payload.mode !== 'exam') {
        if (!record.dueAt) {
          record.box = 1;
          record.dueAt = addDays(today(), 1);
        } else if (q.type === 'short' && rating === '模糊') {
          record.dueAt = addDays(today(), 3);
        } else {
          record.box = correct ? Math.min(5, record.box + 1) : 1;
          record.dueAt = addDays(today(), INTERVALS[record.box - 1]);
        }
        if (record.pendingConsolidation) {
          var limit = addDays(today(), 3);
          if (record.dueAt > limit) record.dueAt = limit;
        }
      }
      var dateKey = today();
      if (!state.daily[dateKey]) { state.daily[dateKey] = { attempts: 0, correct: 0, correctCount: 0, practice: 0, review: 0, exam: 0 }; }
      var day = state.daily[dateKey];
      day.attempts += 1;
      day.correct += correct ? 1 : 0;
      day.correctCount = day.correct;
      var mode = payload.mode === 'exam' ? 'exam' : payload.mode === 'review' ? 'review' : 'practice';
      day[mode] = (day[mode] || 0) + 1;
      day.lastAnsweredAt = stamp;
    }
    if (sid && state.sessions[sid]) {
      state.sessions[sid].answers[q.id] = { value: value, correct: correct, rating: rating, ratio: ratio, answeredAt: stamp, attemptId: attemptId };
    }
    return save() ? record : null;
  }
  function markOptions(qid, keys) {
    if (!ready()) { return false; }
    if (!safeKey(qid) || !Array.isArray(keys)) { throw new Error('选项标记参数无效'); }
    var wanted = keys.filter(safeKey);
    Object.keys(state.options).forEach(function (id) {
      var item = state.options[id];
      if (item.qid !== qid) { return; }
      // 自动记录永远保留；取消仅取消追加标记的当前状态。
      if (!item.autoRecorded && wanted.indexOf(item.key) === -1) {
        item.manualMarked = false;
        item.active = false;
      }
    });
    wanted.forEach(function (key) {
      var item = option(qid, key);
      if (item.autoRecorded) { item.active = true; return; }
      if (!item.manualMarked) {
        item.manualCount += 1;
        item.count = item.manualCount + item.autoCount;
        item.lastMarkedAt = now();
      }
      item.manualMarked = true;
      item.active = true;
      item.mastered = false;
      item.judgeStreak = 0;
      addSource(item, question(qid).uncertain ? 'uncertain' : 'manual');
    });
    return save();
  }
  function markUncertain(q, sessionId) {
    if (!ready()) { return null; }
    if (!q || !safeKey(q.id)) { throw new Error('无效题目 ID'); }
    var record = question(q.id);
    var options = object(sessionId) ? sessionId : {};
    var session = state.sessions[(object(sessionId) ? options.sessionId : sessionId) || state.activeSessionId];
    var answer = session && session.answers[q.id];
    // 待巩固和本次答案标记同一次保存；刷新后不会把同一次点击重复累计。
    if (answer && answer.uncertain) { return Store.lastSaveOk || save() ? record : null; }
    if (answer && answer.correct !== true) { return null; }
    record.chapterId = q.chapterId || record.chapterId;
    record.type = q.type || record.type;
    record.uncertainCount += 1;
    record.lastUncertainAt = now();
    record.uncertain = true;
    record.pendingConsolidation = true;
    record.uncertainStreak = 0;
    record.mastered = false;
    record.correctStreak = 0;
    var dueLimit = addDays(today(), 3);
    if (options.mode !== 'exam' && (!session || session.mode !== 'exam') && (!record.dueAt || record.dueAt > dueLimit)) record.dueAt = dueLimit;
    if (answer) { answer.uncertain = true; }
    return save() ? record : null;
  }
  function setMastered(qid, mastered) {
    if (!ready()) { return false; }
    var record = question(qid);
    record.mastered = !!mastered;
    if (!mastered) { record.correctStreak = 0; }
    var item = state.wrong[qid];
    if (item) {
      item.mastered = !!mastered;
      item.active = !mastered;
      item.removedAt = mastered ? now() : null;
    } else if (!mastered) {
      enroll({ id: qid, chapterId: record.chapterId, type: record.type }, 'manual');
    }
    return save();
  }
  function setConsolidated(qid) {
    if (!ready()) { return false; }
    var record = question(qid);
    record.uncertain = false;
    record.pendingConsolidation = false;
    record.uncertainStreak = 0;
    record.lastConsolidatedAt = now();
    return save();
  }
  function addWrong(q) {
    if (!ready()) { return false; }
    var record = question(q.id);
    record.correctStreak = 0;
    enroll(q, 'manual');
    return save();
  }
  function setSettings(settings) {
    if (!ready()) { return false; }
    if (own(settings, 'examDate')) {
      if (!examDate(settings.examDate)) { throw new Error('考试日期无效'); }
      state.settings.examDate = settings.examDate;
    }
    if (own(settings, 'dailyGoal')) {
      var goal = Number(settings.dailyGoal);
      if (!isFinite(goal) || goal < 1 || goal > 10000 || Math.floor(goal) !== goal) { throw new Error('每日目标须为 1–10000 的整数'); }
      state.settings.dailyGoal = goal;
    }
    return save();
  }
  function startSession(config) {
    if (!ready()) { return null; }
    if (!object(config) || !Array.isArray(config.ids) || !config.ids.length || !config.ids.every(safeKey)) { throw new Error('没有可练习题目'); }
    var id = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var session = { id: id, ids: config.ids.slice(), mode: config.mode || 'practice', chapterId: config.chapterId || null, label: config.label || '专项练习', index: 0, answers: {}, startedAt: now(), elapsedMs: 0, status: 'active' };
    if (!checkSession(session)) { throw new Error('练习设置无效，题目不能重复'); }
    state.sessions[id] = session;
    state.activeSessionId = id;
    return save() ? session : null;
  }
  function setSession(session) {
    if (!ready()) { return false; }
    if (!checkSession(session)) { throw new Error('练习进度格式无效'); }
    // 更新只作用于现有队列，避免迟到的保存恢复已经删除的练习。
    if (!own(state.sessions, session.id)) { return false; }
    state.sessions[session.id] = session;
    if (session.status === 'active') { state.activeSessionId = session.id; }
    else if (state.activeSessionId === session.id) { state.activeSessionId = null; }
    return save();
  }
  function deleteSession(id) {
    if (!ready()) { return false; }
    if (!safeKey(id) || !own(state.sessions, id) || state.sessions[id].status !== 'active') { return false; }
    var previous = JSON.parse(JSON.stringify(state));
    delete state.sessions[id];
    if (state.activeSessionId === id) { state.activeSessionId = null; }
    if (save()) { return true; }
    state = previous;
    return false;
  }
  function activeSession() {
    init();
    return state.activeSessionId && state.sessions[state.activeSessionId] && state.sessions[state.activeSessionId].status === 'active' ? state.sessions[state.activeSessionId] : null;
  }
  function finishSession(session) {
    if (!ready()) { return false; }
    var completed = object(session) ? Object.assign({}, session, { status: 'complete' }) : null;
    if (!checkSession(completed) || !own(state.sessions, session.id)) { throw new Error('不能完成无效的练习记录'); }
    session.status = 'complete';
    session.finishedAt = now();
    state.sessions[session.id] = session;
    state.lastResultSessionId = session.id;
    if (state.activeSessionId === session.id) { state.activeSessionId = null; }
    return save();
  }
  function activeExam() {
    init();
    var exam = state.activeExamId && state.exams[state.activeExamId];
    return exam && exam.status !== 'complete' ? JSON.parse(JSON.stringify(exam)) : null;
  }
  function saveExam(exam) {
    if (!ready()) return false;
    if (!checkExam(exam)) throw new Error('模拟考试进度格式无效，未覆盖已保存记录。');
    var previous = state.exams[exam.id], active = activeExam();
    if (exam.status === 'complete') throw new Error('考试成绩须通过交卷评分保存。');
    if (previous && (previous.status === 'complete' || previous.ids.join('\n') !== exam.ids.join('\n') ||
        (previous.status === 'grading' && exam.status === 'active'))) throw new Error('不能重置已收卷考试或更换原试卷题目。');
    if (active && active.id !== exam.id) throw new Error('请先完成或继续当前模拟考试。');
    state.exams[exam.id] = JSON.parse(JSON.stringify(exam));
    state.activeExamId = exam.id;
    return save();
  }
  function commitExam(examId, entries, finalExam) {
    if (!ready()) return false;
    if (!safeKey(examId) || !own(state.exams, examId)) throw new Error('模拟考试不存在。');
    // 成绩、错题和每日计数属于同一次写入；重复交卷不重复记账。
    if (state.exams[examId].status === 'complete' && state.exams[examId].statsCommitted) return Store.lastSaveOk || save();
    var original = state.exams[examId];
    if (!checkExam(finalExam) || finalExam.id !== examId || finalExam.status !== 'complete' ||
        finalExam.ids.join('\n') !== original.ids.join('\n') || !Array.isArray(entries)) throw new Error('交卷评分数据不完整。');
    var resultItems = {}, submitted = {};
    finalExam.result.items.forEach(function (item) { resultItems[item.qid] = item; });
    if (entries.length !== finalExam.result.attempts || !entries.every(function (entry) {
      if (!object(entry) || !object(entry.question) || !safeKey(entry.question.id) || !object(entry.payload) || submitted[entry.question.id]) return false;
      var item = resultItems[entry.question.id], payload = entry.payload;
      if (!item || item.unanswered || entry.question.type !== item.type || payload.correct !== item.correct ||
          (payload.value == null ? null : String(payload.value)) !== item.value ||
          (payload.rating || null) !== item.rating || (payload.ratio == null ? null : payload.ratio) !== item.ratio ||
          !!payload.uncertain !== item.uncertain) return false;
      submitted[entry.question.id] = true;
      return true;
    })) throw new Error('模拟考试计分记录与逐题结果不一致。');
    var previous = JSON.parse(JSON.stringify(state));
    try {
      inBatch = true;
      entries.forEach(function (entry) {
        var payload = Object.assign({}, entry.payload, { mode: 'exam', attemptId: 'exam:' + examId + ':' + entry.question.id });
        delete payload.sessionId;
        if (!recordAnswer(entry.question, payload)) throw new Error('模拟考试作答未能入账。');
        if (payload.correct === true && payload.uncertain) {
          if (!markUncertain(entry.question, {mode:'exam', sessionId:'exam:' + examId})) throw new Error('模拟考待巩固标记未能保存。');
        }
      });
      state.exams[examId] = JSON.parse(JSON.stringify(finalExam));
      state.exams[examId].statsCommitted = true;
      if (state.activeExamId === examId) state.activeExamId = null;
      inBatch = false;
      if (save()) return true;
      state = previous;
      return false;
    } catch (error) {
      inBatch = false;
      state = previous;
      throw error;
    }
  }
  function issue(qid, reason) {
    if (!ready()) { return false; }
    if (!safeKey(qid) || typeof reason !== 'string' || !reason.trim()) { throw new Error('请填写报错内容'); }
    state.issues.push({ id: 'i-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), qid: qid, reason: reason.trim(), createdAt: now(), status: 'open' });
    return save();
  }
  function draft(qid, text) {
    if (!ready()) { return false; }
    question(qid).draft = String(text);
    return save();
  }
  function setAI(settings) {
    if (!ready()) return false;
    if (testMode && settings.enabled) { return false; }
    var current = state.settings.ai;
    ['enabled','mode','proxyUrl','model','privacyAccepted'].forEach(function(k){if(own(settings,k))current[k]=settings[k];});
    return save();
  }
  function aiCount(kind) {
    if (!ready()) return false;
    if (!own(state.aiStats, kind)) throw new Error('未知调用统计');
    state.aiStats[kind] += 1; return save();
  }
  function optionMastered(id, value) {
    if (!ready() || !state.options[id]) return false;
    var o=state.options[id];o.mastered=!!value;o.status=value?'mastered':'unknown';
    o.lastMarkedAt=now();if(!value)o.judgeStreak=0;return save();
  }
  function saveGenerated(g) {
    if (!ready()) return null;
    if(state.generationKeys[g.signature])return Store.lastSaveOk||save()?state.generated[state.generationKeys[g.signature]]:null;
    g.id='gen-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
    g.createdAt=now();g.mastered=false;g.right=0;g.wrong=0;g.streak=0;g.attempts=0;g.activeAttempt=null;
    var prospective=Object.assign({},state,{generated:Object.assign({},state.generated),generationKeys:Object.assign({},state.generationKeys)});
    prospective.generated[g.id]=g;prospective.generationKeys[g.signature]=g.id;
    if(!validStage2(prospective))throw new Error('生成题结构不完整，未入库。');
    state.generated[g.id]=g;state.generationKeys[g.signature]=g.id;return save()?g:null;
  }
  function updateGenerated(id, patch) {
    if(!ready()||!state.generated[id])return false;
    var g=state.generated[id];
    ['stem','explanation','aiUsed','polishNote'].forEach(function(k){if(own(patch,k))g[k]=patch[k];});
    return save();
  }
  function generatedAttempt(id, fresh) {
    if(!ready()||!state.generated[id])return null;
    var g=state.generated[id];
    if(!g.activeAttempt||fresh){g.activeAttempt={id:'ga-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),value:null,correct:null};if(!save())return null;}
    return g.activeAttempt;
  }
  function answerGenerated(id, value, groupId) {
    if(!ready()||!state.generated[id])return false;
    var g=state.generated[id],group=groupId?state.generatedGroups[groupId]:null;
    if(groupId&&(!group||group.status!=='active'||group.ids[group.index]!==id))return false;
    if(group&&group.answers[id])return group.answers[id].value===value&&(Store.lastSaveOk||save());
    if((g.type==='judge'?['对','错']:['A','B','C','D']).indexOf(value)===-1)return false;
    if(group)g.activeAttempt={id:group.id+':'+id,value:null,correct:null};
    var a=g.activeAttempt;
    if(!a)return false;
    if(a.value!==null)return a.value===value&&(Store.lastSaveOk||save());
    if((g.type==='judge'?['对','错']:['A','B','C','D']).indexOf(value)===-1)return false;
    a.value=value;a.correct=value===g.answer;a.answeredAt=now();g.attempts++;g.right+=a.correct?1:0;g.wrong+=a.correct?0:1;
    g.streak=a.correct?g.streak+1:0;g.mastered=g.streak>=2;
    var stats=state.generatedStats;stats.attempts++;stats.correct+=a.correct?1:0;stats.practicedIds[id]=true;
    if(safeKey(g.chapterId)){
      var chapterStats=stats.chapters[g.chapterId];
      if(!chapterStats)chapterStats=stats.chapters[g.chapterId]={attempts:0,correct:0,practicedIds:{}};
      chapterStats.attempts++;chapterStats.correct+=a.correct?1:0;chapterStats.practicedIds[id]=true;
    }
    var date=today();if(!state.daily[date])state.daily[date]={attempts:0,correct:0,correctCount:0,practice:0,review:0,exam:0};
    state.daily[date].attempts++;state.daily[date].correct+=a.correct?1:0;state.daily[date].correctCount=state.daily[date].correct;state.daily[date].review++;state.daily[date].lastAnsweredAt=now();
    if(g.type==='judge'){
      var s=g.sources[0],o=option(s.qid,s.key);syncOption(o);o.judgeRight+=a.correct?1:0;o.judgeWrong+=a.correct?0:1;o.judgeStreak=a.correct?o.judgeStreak+1:0;
      o.mastered=a.correct?(o.mastered||o.judgeStreak>=2):false;o.lastMarkedAt=now();
    }
    if(group)group.answers[id]={value:a.value,correct:a.correct,answeredAt:a.answeredAt};
    return save();
  }
  function startGeneratedGroup(ids,title) {
    if(!ready())return null;
    if(!Array.isArray(ids)||!ids.length||ids.some(function(id,i){return ids.indexOf(id)!==i||!state.generated[id]||state.generated[id].type!=='judge';}))throw new Error('错项判断组内容不完整。');
    var id='group-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),group={id:id,title:String(title||'错项集中练'),ids:ids.slice(),index:0,answers:{},status:'active',createdAt:now()};
    state.generatedGroups[id]=group;state.activeGeneratedGroupId=id;return save()?group:null;
  }
  function advanceGeneratedGroup(id) {
    if(!ready())return false;
    var group=state.generatedGroups[id];if(!group||!group.answers[group.ids[group.index]])return false;
    if(group.index<group.ids.length-1)group.index++;else{group.status='complete';group.completedAt=now();if(state.activeGeneratedGroupId===id)state.activeGeneratedGroupId=null;}
    return save();
  }
  function deleteGenerated(id) {
    if(!ready()||!state.generated[id])return false;
    delete state.generationKeys[state.generated[id].signature];delete state.generated[id];
    Object.keys(state.generatedGroups).forEach(function(groupId){var group=state.generatedGroups[groupId],current=group.ids[group.index];group.ids=group.ids.filter(function(gid){return gid!==id;});delete group.answers[id];if(!group.ids.length){delete state.generatedGroups[groupId];if(state.activeGeneratedGroupId===groupId)state.activeGeneratedGroupId=null;}else{group.index=current===id?Math.min(group.index,group.ids.length-1):Math.max(0,group.ids.indexOf(current));}});
    state.issues=state.issues.filter(function(i){return i.qid!==id;});return save();
  }
  function dueIds() {
    init();
    var date = today();
    return sortIds(Object.keys(state.questions).filter(function (id) {
      var q = state.questions[id];
      return !!q.dueAt && q.dueAt <= date;
    }));
  }
  function sortIds(ids) {
    init();
    if (!Array.isArray(ids)) throw new Error('练习队列无效');
    var date = today();
    return ids.map(function (id, index) { return { id: id, index: index, q: state.questions[id] || {} }; }).sort(function (a, b) {
      var dueA = !!a.q.dueAt && a.q.dueAt <= date, dueB = !!b.q.dueAt && b.q.dueAt <= date;
      if (dueA !== dueB) return dueA ? -1 : 1;
      if (dueA && a.q.dueAt !== b.q.dueAt) return a.q.dueAt.localeCompare(b.q.dueAt);
      var unseenA = !a.q.attempts, unseenB = !b.q.attempts;
      if (unseenA !== unseenB) return unseenA ? -1 : 1;
      return (b.q.wrongCount || 0) - (a.q.wrongCount || 0) || a.index - b.index;
    }).map(function (item) { return item.id; });
  }
  function streak() {
    init();
    var date = today(), count = 0;
    if (!state.daily[date] || !state.daily[date].attempts) date = addDays(date, -1);
    while (state.daily[date] && state.daily[date].attempts > 0) {
      count += 1;
      date = addDays(date, -1);
    }
    return count;
  }
  function markBackup() {
    if (!ready()) return false;
    state.lastBackupAt = now();
    return save();
  }
  function reloadMode() {
    initialized = false; readonly = false; state = null; lastRaw = null;
    Store.readOnly = false; Store.lastSaveOk = true;
    notices.splice(0, notices.length);
    init();
    return !readonly;
  }
  function enterTestMode() {
    init();
    if (testMode) return !readonly;
    if (!ready() || !Store.lastSaveOk) return false;
    try {
      var previous = global.localStorage.getItem(TEST_KEY);
      if (previous === null) {
        var copy = JSON.parse(JSON.stringify(state));
        copy.settings.ai.enabled = false;
        copy.debugDayOffset = 0;
        global.localStorage.setItem(TEST_KEY, JSON.stringify(copy));
      } else if (!validate(JSON.parse(previous))) {
        notice('test-data-invalid', '测试副本格式损坏，未进入测试模式；真实学习记录保持原状。', false);
        return false;
      }
      global.localStorage.setItem(MODE_KEY, 'test');
      return reloadMode();
    } catch (error) {
      notice('test-mode-failed', '无法保存测试副本，未切换模式。请检查本机存储空间。', false);
      return false;
    }
  }
  function exitTestMode() {
    init();
    if (!testMode) return !readonly;
    try {
      global.localStorage.removeItem(MODE_KEY);
      return reloadMode();
    } catch (error) {
      notice('test-exit-failed', '无法退出测试模式，请检查浏览器存储权限。', true);
      return false;
    }
  }
  function clearTestData() {
    if (!ready() || !testMode) return false;
    var settings = JSON.parse(JSON.stringify(state.settings));
    state = empty();
    state.settings = settings;
    upgrade(state);
    return save();
  }
  function setDebugDayOffset(offset) {
    if (!ready() || !testMode) return false;
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > 36500) throw new Error('测试日期偏移无效');
    state.debugDayOffset = offset;
    return save();
  }
  Store.validateBackup = function (data) { return validate(data); };
  Store.replaceBackup = function (data) {
    if(!ready()||!validate(data))return false;
    var previous=state;state=data;
    if(save())return true;
    state=previous;return false;
  };
  Store.clearLearning = function () {
    if(!ready())return false;
    var fresh=empty();upgrade(fresh);return Store.replaceBackup(fresh);
  };
  Store.init = init;
  Store.get = get;
  Store.save = save;
  Store.today = today;
  Store.addDays = addDays;
  Store.dueIds = dueIds;
  Store.sortIds = sortIds;
  Store.streak = streak;
  Store.markBackup = markBackup;
  Store.isTestMode = function () { init(); return testMode; };
  Store.enterTestMode = enterTestMode;
  Store.exitTestMode = exitTestMode;
  Store.clearTestData = clearTestData;
  Store.setDebugDayOffset = setDebugDayOffset;
  Store.question = question;
  Store.recordAnswer = recordAnswer;
  Store.markOptions = markOptions;
  Store.markUncertain = markUncertain;
  Store.setMastered = setMastered;
  Store.setConsolidated = setConsolidated;
  Store.addWrong = addWrong;
  Store.setSettings = setSettings;
  Store.startSession = startSession;
  Store.setSession = setSession;
  Store.deleteSession = deleteSession;
  Store.activeSession = activeSession;
  Store.finishSession = finishSession;
  Store.activeExam = activeExam;
  Store.saveExam = saveExam;
  Store.commitExam = commitExam;
  Store.issue = issue;
  Store.draft = draft;
  Store.setAI=setAI;Store.aiCount=aiCount;Store.optionMastered=optionMastered;
  Store.saveGenerated=saveGenerated;Store.updateGenerated=updateGenerated;Store.generatedAttempt=generatedAttempt;
  Store.answerGenerated=answerGenerated;Store.deleteGenerated=deleteGenerated;
  Store.startGeneratedGroup=startGeneratedGroup;Store.advanceGeneratedGroup=advanceGeneratedGroup;
  Store.getOptionMarks = function (qid) { init(); return Object.keys(state.options).map(function (id) { return state.options[id]; }).filter(function (o) { return o.qid === qid; }); };
  global.Store = Store;
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', function (event) {
      if (initialized && (((event.key === KEY || event.key === null) && event.newValue !== lastRaw) || (event.key === MODE_KEY && event.newValue !== modeRaw))) {
        lock('storage-conflict', '另一个页面已更新学习数据。本页已暂停保存，请刷新后继续，避免覆盖新进度。');
      }
    });
  }
}(window));
