(function () {
  'use strict';
  var timer = null, working = false, currentPath = '', resultPage = 1, resultId = '';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function state() { return Store.get(); }
  function active() { return (state().exams || {})[state().activeExamId] || null; }
  function stamp() { return new Date().toISOString(); }
  function attrs(id) { return 'data-id="' + UI.esc(id) + '"'; }
  function button(text, action, cls, extra) { return UI.button(text, 'exam-' + action, cls || 'outline', extra || ''); }
  function chapterName(id) { return (Bank.chapter(id) || {}).name || id; }
  function loaded(exam) { return Promise.all(exam.ids.map(function (id) { return Bank.get(id); })); }
  function response() { return {value:null, draft:'', uncertain:false, rating:null, checks:[], skipped:false}; }
  function persist(exam) { if (!Store.saveExam(exam)) throw new Error('考试进度未能保存，请保留当前页面并查看存储提示。'); }
  function shuffled(list) { var a = list.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // 本地组卷子类：原 Word 统一称问答/简答。明确人物、年龄与病情的 16 题列为病例，
  // 其余 70 道作业问答列入论述池；不改源题类型、题干或答案。详见模拟考题型分类说明.md。
  var caseNumbers = [16,17,18,35,36,37,38,39,40,41,42,63,83,84,85,86];
  function shortKind(q) {
    if (!q || q.type !== 'short') return null;
    var match = /^anatomy-assignment-q(\d{3})$/.exec(q.sourceId || q.id), n = match ? Number(match[1]) : 0;
    return n >= 1 && n <= 86 ? (caseNumbers.indexOf(n) >= 0 ? 'case' : 'essay') : null;
  }
  function shortLabel(q) { var kind=shortKind(q);return kind==='case'?'病例分析题':kind==='essay'?'论述题':'简答题'; }
  function points(q) { return Practice.points(q); }
  function remaining(exam, time) { return exam.deadlineAt ? Math.max(0, Math.ceil((Date.parse(exam.deadlineAt) - (time === undefined ? Date.now() : time)) / 1000)) : null; }
  function clockText(seconds) { return seconds === null ? '不限时' : Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2); }
  function answered(q, r) { return q.type === 'mcq' ? !!r.value : !!r.draft.trim(); }
  function hasGrading(exam, questions) { return questions.some(function (q) { var r = exam.responses[q.id] || response(); return q.type === 'short' && !r.rating && !r.skipped; }); }
  // 分数与“作答次数”分开：漏答为 0 分，但没有实际作答就不伪造统计或错选项。
  function scoreItem(q, r) {
    r = r || response();
    if (q.type === 'mcq') {
      var valid = q.options.some(function (o) { return o.key === r.value; }), correct = valid ? r.value === q.answer : null;
      return {qid:q.id, type:'mcq', score:correct ? 1 : 0, maxScore:1, correct:correct, value:valid ? r.value : null, rating:null, ratio:null, unanswered:!valid, uncertain:!!r.uncertain};
    }
    var list = points(q), skipped = r.skipped || !r.rating;
    var checks = (r.checks || []).filter(function (i, n, a) { return Number.isInteger(i) && i >= 0 && i < list.length && a.indexOf(i) === n; });
    var ratio = list.length ? checks.length / list.length : null;
    var score = skipped ? 0 : ratio === null ? {'会':2, '模糊':1, '不会':0}[r.rating] : 2 * ratio;
    return {qid:q.id, type:'short', score:score, maxScore:2, correct:skipped ? null : r.rating === '会', value:skipped ? null : r.rating, rating:skipped ? null : r.rating, ratio:skipped ? null : ratio, unanswered:!!skipped, uncertain:!!r.uncertain};
  }
  function scoreExam(exam, questions) {
    var items = questions.map(function (q) { return scoreItem(q, exam.responses[q.id]); });
    var total = items.reduce(function (sum, item) { return sum + item.score; }, 0), maximum = items.reduce(function (sum, item) { return sum + item.maxScore; }, 0);
    return {score:total, maxScore:maximum, percentage:maximum ? Math.round(100 * total / maximum) : 0, correct:items.filter(function (x) { return x.correct === true; }).length, attempts:items.filter(function (x) { return x.correct !== null; }).length, items:items};
  }
  function valueText(value) { return Math.round(value * 100) / 100; }
  function selectOptions(rows, selected) { return rows.map(function (row) { return '<option value="' + row[0] + '"' + (String(row[0]) === String(selected) ? ' selected' : '') + '>' + row[1] + '</option>'; }).join(''); }
  function historyRows(limit) {
    var list = Object.keys(state().exams || {}).map(function (id) { return state().exams[id]; }).filter(function (e) { return e.status === 'complete'; }).sort(function (a, b) { return (b.completedAt || '').localeCompare(a.completedAt || ''); });
    if (!list.length) return '<p class="subtle">还没有模拟考成绩。交卷并完成简答评分后，会保存在这里。</p>';
    return list.slice(0, limit || list.length).map(function (e) {
      return '<a class="exam-history-row" href="#/exam/result/' + encodeURIComponent(e.id) + '"><div><h3>' + UI.esc(e.title) + '</h3><p class="caption">' + UI.esc(new Date(e.completedAt).toLocaleString()) + ' · ' + e.ids.length + ' 题 · ' + (e.durationMinutes ? e.durationMinutes + ' 分钟' : '不限时') + '</p></div><div><strong>' + e.result.percentage + '%</strong><small>' + valueText(e.result.score) + ' / ' + e.result.maxScore + ' 分</small></div>' + UI.icon('arrow') + '</a>';
    }).join('');
  }
  function render(scope) {
    var e = active(), minute = Store.isTestMode() && /(?:\?|&)minute=1(?:&|$)/.test(location.hash), wrong = scope === 'wrong';
    var wrongCount = Object.keys(state().wrong).filter(function (id) { return state().wrong[id].active; }).length;
    var html = UI.header('MOCK EXAM', wrong ? '把错题，组成一张试卷' : '给复习一次完整检验', '考试过程不显示答案与对错。每次操作保存在本机，交卷后统一回顾。', '<a class="btn outline" href="#/exam/history">历史成绩</a>');
    if (e) html += '<section class="continue-card"><div><h3>' + (e.status === 'grading' ? '有一张试卷等待简答评分' : '有一场模拟考尚未交卷') + '</h3><p class="caption">' + UI.esc(e.title) + ' · 当前第 ' + (e.index + 1) + ' / ' + e.ids.length + ' 题。完成后可组新卷。</p></div><a class="btn primary" href="#/exam/' + (e.status === 'grading' ? 'grade' : 'quiz') + '">继续' + UI.icon('arrow') + '</a></section>';
    if (wrong && !wrongCount) html += UI.empty('当前没有错题', '完成练习后，答错的题会自动进入错题本。也可手动加入原题，再来组卷。', '<a class="btn primary" href="#/chapters">开始章节练习</a>');
    else {
      html += '<section class="card exam-setup"><h2>组卷设置</h2><div class="exam-setup-grid"><label class="field-label">范围<select id="exam-scope">' + selectOptions([['all','全库'],['chapters','指定章节（可多选）'],['wrong','当前错题本']], wrong ? 'wrong' : 'all') + '</select></label><label class="field-label">单选题量<select id="exam-count">' + selectOptions([['50','50 题'],['100','100 题'],['custom','自定义']], '50') + '</select></label></div>';
      html += '<div id="exam-custom-wrap" hidden><label class="field-label" for="exam-custom-count">自定义单选题量（1–3500）</label><input type="number" id="exam-custom-count" min="1" max="3500" step="1" value="20"></div>';
      html += '<div id="exam-chapters-wrap" hidden><p class="field-label">选择章节</p><div class="exam-chapter-options">' + Bank.index().chapters.map(function (c) { return '<label class="checkpoint"><input type="checkbox" name="exam-chapter" value="' + c.id + '"><span>' + UI.esc(c.name) + '</span></label>'; }).join('') + '</div></div>';
      html += '<label class="field-label" for="exam-duration">时长</label><select id="exam-duration">' + selectOptions((minute ? [['1','1 分钟（测试模式）']] : []).concat([['30','30 分钟'],['45','45 分钟'],['60','60 分钟'],['0','不限时']]), minute ? '1' : '30') + '</select>';
      html += '<label class="checkpoint exam-add-short"><input type="checkbox" id="exam-short" checked><span>加入 3 道简答题：1 道论述题 + 2 道病例分析题 <small>默认试卷为 50 道选择 + 3 道简答；按同一范围分别抽取，交卷后自评</small></span></label>';
      html += '<p class="caption">仅使用有可用答案的单选题；多选、填空与无答案单选可在搜索浏览。题量不足按实际出题并提示。已有 AI 参考答案仍待核对。考试不会改变复习档位与到期日。</p><div id="exam-setup-status" role="status"></div>' + button('生成试卷并开始', 'start', 'primary full', e ? 'disabled' : '') + '</section>';
    }
    return html + '<section class="card"><div class="section-head"><h2>最近成绩</h2><a href="#/exam/history">全部历史</a></div>' + historyRows(5) + '</section>';
  }
  function build(scope, count, minutes, includeShort, chapters) {
    if (!Number.isInteger(count) || count < 1 || count > 3500) return Promise.reject(new Error('单选题量请输入 1–3500 的整数。'));
    if ([0,1,30,45,60].indexOf(minutes) < 0 || (minutes === 1 && !Store.isTestMode())) return Promise.reject(new Error('请选择有效时长；1 分钟仅用于测试模式。'));
    if (scope === 'chapters' && !chapters.length) return Promise.reject(new Error('请至少选择一个章节。'));
    var promise, origin = Store.get();
    if (scope === 'wrong') {
      var ids = Object.keys(state().wrong).filter(function (id) { return state().wrong[id].active; });
      if (!ids.length) return Promise.reject(new Error('当前没有错题，暂时无法组错题卷。'));
      promise = Promise.all(ids.map(function (id) { return Bank.get(id); }));
    } else {
      var selected = scope === 'chapters' ? chapters : Bank.index().chapters.map(function (c) { return c.id; });
      promise = Promise.all(selected.map(function (id) { return Bank.load(id); })).then(function (list) { return list.reduce(function (all, c) { return all.concat(c.mcq || [], c.short || []); }, []); });
    }
    return promise.then(function (pool) {
      if (origin !== Store.get()) throw new Error('学习模式已切换，请重新组卷。');
      var mcqs = shuffled(pool.filter(Bank.gradable));
      var essays = shuffled(pool.filter(function(q){return shortKind(q)==='essay';}));
      var cases = shuffled(pool.filter(function(q){return shortKind(q)==='case';}));
      var chosen = mcqs.slice(0, count).concat(includeShort ? essays.slice(0,1).concat(cases.slice(0,2)) : []), notes = [];
      if (!chosen.length) throw new Error('所选范围没有可组卷的题目。请更换章节，或勾选简答题。');
      if (mcqs.length < count) notes.push('单选题仅有 ' + Math.min(count, mcqs.length) + ' 道');
      if (includeShort && essays.length < 1) notes.push('所选范围论述题 0 / 1 道');
      if (includeShort && cases.length < 2) notes.push('所选范围病例分析题 ' + cases.length + ' / 2 道，不用论述题替代');
      return {questions:chosen, notes:notes};
    });
  }
  function start() {
    if (working) return Promise.resolve();
    if (active()) throw new Error('请先完成已有模拟考，再生成新试卷。');
    var scope = document.getElementById('exam-scope').value, countValue = document.getElementById('exam-count').value;
    var count = Number(countValue === 'custom' ? document.getElementById('exam-custom-count').value : countValue), minutes = Number(document.getElementById('exam-duration').value);
    var short = document.getElementById('exam-short').checked, chapters = Array.prototype.slice.call(document.querySelectorAll('input[name="exam-chapter"]:checked')).map(function (el) { return el.value; });
    var host = document.getElementById('exam-setup-status'), startButton = document.querySelector('[data-action="exam-start"]'), originalHash = location.hash;
    working = true; startButton.disabled = true; host.innerHTML = UI.loading('正在按范围准备试卷…');
    return build(scope, count, minutes, short, chapters).then(function (built) {
      if (location.hash !== originalHash) return;
      var now = Date.now(), id = 'exam-' + now.toString(36) + '-' + Math.random().toString(36).slice(2,8), answers = {};
      built.questions.forEach(function (q) { answers[q.id] = response(); });
      var exam = {id:id, title:(scope === 'wrong' ? '错题模拟考' : scope === 'chapters' ? '章节模拟考' : '全库模拟考') + ' · ' + built.questions.length + ' 题', ids:built.questions.map(function (q) { return q.id; }), index:0, status:'active', scope:scope, chapterIds:chapters, durationMinutes:minutes, startedAt:new Date(now).toISOString(), deadlineAt:minutes ? new Date(now + minutes * 60000).toISOString() : null, submittedAt:null, completedAt:null, responses:answers, result:null};
      persist(exam); App.go('/exam/quiz');
      if (built.notes.length) UI.toast(built.notes.join('；') + '，已按实际题量开始。');
    }).catch(function (error) { if (host && document.contains(host)) host.innerHTML = '<p class="notice danger">' + UI.esc(error.message) + '</p>'; else UI.toast(error.message); }).then(function () { working = false; if (document.contains(startButton)) startButton.disabled = !!active(); });
  }
  function noExam() { return UI.empty('没有进行中的模拟考', '选择范围、题量与时长，开始一次模拟考试。', '<a class="btn primary" href="#/exam">去组卷</a>'); }
  function quiz() {
    var e = active(); if (!e) return Promise.resolve(noExam());
    if (e.status === 'grading') { App.go('/exam/grade'); return Promise.resolve(UI.loading('正在打开交卷评分…')); }
    return loaded(e).then(function (qs) {
      var q = qs[e.index], r = e.responses[q.id], done = qs.filter(function (item) { return answered(item, e.responses[item.id]); }).length;
      var html = '<div class="quiz-top"><div><p class="eyebrow">' + UI.esc(e.title) + '</p><h1>第 ' + (e.index + 1) + ' <span class="subtle">/ ' + e.ids.length + ' 题</span></h1></div><div class="exam-timer" role="timer" aria-label="剩余考试时间"><span>剩余时间</span><strong id="exam-clock">' + clockText(remaining(e)) + '</strong></div></div>';
      html += '<p class="caption">已填写 <span id="exam-answered">' + done + '</span> / ' + e.ids.length + ' 题（单选已选或简答有草稿） · 答案与对错在交卷后显示</p><div class="progress-track"><span style="width:' + UI.pct(done,e.ids.length) + '%"></span></div>';
      html += '<article class="question-card"><div class="question-meta">' + UI.badge(q) + '<span class="caption">' + UI.esc(chapterName(q.chapterId)) + ' · ' + (q.type === 'short' ? shortLabel(q) + ' · 2' : '1') + ' 分</span></div><h2 class="question-stem preserve">' + UI.esc(q.stem) + '</h2>' + UI.assets(q);
      if (q.type === 'mcq') html += '<div class="choices">' + q.options.map(function (o) { return '<button type="button" class="choice' + (r.value === o.key ? ' exam-selected' : '') + '" data-action="exam-choose" data-key="' + UI.esc(o.key) + '" aria-pressed="' + (r.value === o.key) + '"><span class="choice-key">' + UI.esc(o.key) + '</span><span class="choice-text preserve">' + UI.esc(o.text) + '</span>' + (r.value === o.key ? '<span class="choice-note">已选择</span>' : '') + '</button>'; }).join('') + '</div>';
      else html += '<label class="field-label" for="exam-draft">简答草稿（自动保存在本机）</label><textarea id="exam-draft" rows="8" placeholder="先写下你的答案；交卷后对照采分点或完成自评。">' + UI.esc(r.draft) + '</textarea><p class="caption">考试期间不展示参考答案或采分点。没有答案的题只在交卷后自评。</p>';
      html += '<label class="checkpoint"><input type="checkbox" id="exam-uncertain"' + (r.uncertain ? ' checked' : '') + '><span>标记不确定，交卷后重点回顾</span></label>';
      html += '<p class="caption" id="exam-save-status" role="status">本机进度已保存。限时考试离开页面后仍继续计时。</p><p class="caption">源题号：' + UI.esc(q.sourceId || q.id) + '</p></article>';
      html += '<div class="exam-navigation">' + button('上一题','previous','outline',e.index === 0 ? 'disabled' : '') + button('保存并退出','exit','quiet') + button(e.index === e.ids.length - 1 ? '查看交卷提示' : '下一题','next','primary') + '</div><p class="caption">键盘 1–5 选项 · 左右方向键换题 · Enter 下一题；填写草稿时按正常文本输入。</p>';
      html += '<details class="card exam-answer-sheet"><summary>答题卡 · ' + e.ids.length + ' 题</summary><div class="exam-numbers">' + qs.map(function (item,i) { var rr = e.responses[item.id]; return button((i+1) + (rr.uncertain ? ' ?' : ''),'jump',e.index === i ? 'primary' : answered(item,rr) ? 'exam-filled' : 'outline','data-index="' + i + '" aria-label="第 ' + (i+1) + ' 题' + (rr.uncertain ? '，标记不确定' : '') + '"'); }).join('') + '</div><p class="caption">着色表示已填写；问号表示不确定，不代表答对或答错。</p></details><div class="actions">' + button('提前交卷','submit','outline') + '</div>';
      return html;
    });
  }
  function editable() {
    var e = active(); if (!e || e.status !== 'active') return null;
    if (remaining(e) === 0) { submit(true).catch(function (error) { UI.toast(error.message); }); return null; }
    return copy(e);
  }
  function setChoice(key) {
    var e = editable(); if (!e) return;
    var q = Bank.peek(e.ids[e.index]); if (!q || q.type !== 'mcq' || !q.options.some(function (o) { return o.key === key; })) return;
    e.responses[q.id].value = key; persist(e); return App.render();
  }
  function navigate(index) { var e = editable(); if (!e) return; if (!Number.isInteger(index) || index < 0 || index >= e.ids.length) return; e.index = index; persist(e); return App.render().then(function () { window.scrollTo(0,0); }); }
  function confirmSubmit() {
    var e = active(); if (!e || e.status !== 'active') return;
    UI.modal('确认提前交卷', '<p>交卷后将锁定所有选择与草稿，不能再返回修改。漏答按 0 分计算；简答题在交卷后完成对照评分。</p><p class="caption">只对实际选择与明确简答自评计入答题次数。考试不会改变复习档位与到期日。</p><div class="modal-actions">' + UI.button('继续考试','close-modal','quiet') + button('确认交卷','confirm-submit','primary') + '</div>');
  }
  function finalize(e) {
    var exam = copy(e), origin = Store.get();
    return loaded(exam).then(function (qs) {
      if (origin !== Store.get()) throw new Error('学习模式已切换，请在当前模式继续考试。');
      if (hasGrading(exam,qs)) throw new Error('请先为每道简答题选择自评，或明确标记未作答。');
      var result = scoreExam(exam,qs);
      exam.result = result; exam.status = 'complete'; exam.completedAt = stamp();
      var entries = result.items.filter(function (item) { return item.correct !== null; }).map(function (item) {
        var q = qs.filter(function (question) { return question.id === item.qid; })[0];
        return {question:q, payload:{value:item.value, correct:item.correct, rating:item.rating, ratio:item.ratio, uncertain:item.uncertain}};
      });
      if (!Store.commitExam(exam.id,entries,exam)) throw new Error('成绩未能保存，原试卷仍可恢复；请处理存储提示后再次保存评分。');
      App.go('/exam/result/' + encodeURIComponent(exam.id));
      return exam;
    });
  }
  function submit(timeout) {
    if (working) return Promise.resolve();
    var original = active(); if (!original || original.status !== 'active') return Promise.resolve();
    working = true; UI.closeModal();
    var e = copy(original); e.status = 'grading'; e.submittedAt = stamp();
    try { persist(e); } catch (error) { working = false; return Promise.reject(error); }
    if (timeout) UI.toast('考试时间已到，试卷已锁定。');
    return loaded(e).then(function (qs) {
      if (qs.some(function (q) { return q.type === 'short'; })) { App.go('/exam/grade'); return; }
      return finalize(e);
    }).catch(function (error) { App.go('/exam/grade'); throw error; }).then(function (v) { working = false; return v; }, function (error) { working = false; throw error; });
  }
  function grade() {
    var e = active(); if (!e) return Promise.resolve(noExam());
    if (e.status === 'active') { App.go('/exam/quiz'); return Promise.resolve(UI.loading('正在恢复考试…')); }
    return loaded(e).then(function (qs) {
      var shorts = qs.filter(function (q) { return q.type === 'short'; });
      var html = UI.header('EXAM SUBMITTED','试卷已锁定，完成简答评分','所有选择与草稿均已保存。简答评分完成后，整张试卷一次计入统计。');
      if (!shorts.length) return html + '<section class="card"><p>本卷没有简答题。点击保存成绩完成计分；重复操作不会重复计入。</p>' + button('保存成绩并查看回顾','finish','primary') + '</section>';
      html += '<p class="notice">简答每题 2 分。有采分点按勾选比例计分；没有采分点按自评“会”2 分、“模糊”1 分、“不会”0 分。统计正确率仍按“会”算答对。</p>';
      html += shorts.map(function (q,i) {
        var r = e.responses[q.id], list = points(q), item = scoreItem(q,r);
        var row = '<section class="question-card exam-grade-card"><div class="question-meta">' + UI.badge(q) + '<span>' + shortLabel(q) + ' · 简答 ' + (i+1) + ' / ' + shorts.length + '</span></div><h2 class="question-stem preserve">' + UI.esc(q.stem) + '</h2>' + UI.assets(q) + '<h3>你的草稿（已锁定）</h3><p class="preserve exam-saved-draft">' + UI.esc(r.draft || '未填写草稿') + '</p>';
        if (list.length) row += '<details class="card" open><summary>原有参考答案与采分点</summary><p class="preserve">' + UI.esc(UI.answer(q)) + '</p>' + UI.explanation(q) + '</details><div class="checkpoints">' + list.map(function (point,n) { return '<label class="checkpoint"><input type="checkbox" data-exam-point="' + n + '" data-qid="' + UI.esc(q.id) + '"' + (r.checks.indexOf(n) >= 0 ? ' checked' : '') + '><span class="preserve">' + UI.esc(point) + '</span></label>'; }).join('') + '</div><p class="caption">采分点来自原答案换行或序号切分，不调用 AI；勾选 ' + r.checks.length + ' / ' + list.length + '。</p>';
        else row += '<p class="notice amber">原题库没有答案与采分点，仅记录你的自评，不补写答案。</p>';
        row += '<div class="rating-row">' + ['会','模糊','不会'].map(function (rating) { return button(rating,'rate',r.rating === rating && !r.skipped ? 'selected' : '',attrs(q.id) + ' data-value="' + rating + '" aria-pressed="' + (r.rating === rating && !r.skipped) + '"'); }).join('') + '</div><div class="actions">' + button('未作答 · 0 分，不计作答次数','skip-short',r.skipped ? 'selected' : 'quiet',attrs(q.id)) + '</div><p class="caption">当前评分：' + (!r.rating && !r.skipped ? '尚未自评' : valueText(item.score) + ' / 2 分' + (r.skipped ? '（未作答）' : ' · 自评“' + r.rating + '”')) + '</p></section>';
        return row;
      }).join('');
      return html + '<div class="actions">' + button('保存成绩并逐题回顾','finish','primary',hasGrading(e,qs) ? 'disabled' : '') + '<a class="btn quiet" href="#/home">稍后继续评分</a></div>';
    });
  }
  function gradeResponse(id, change) {
    var e = active(); if (!e || e.status !== 'grading' || e.ids.indexOf(id) < 0) return;
    e = copy(e); change(e.responses[id]); persist(e); return App.render();
  }
  function result(id) {
    var e = (state().exams || {})[id];
    if (!e || e.status !== 'complete' || !e.result) return Promise.resolve(UI.empty('没有找到已完成的考试','请先交卷并完成评分，或从历史成绩中选择。','<a class="btn primary" href="#/exam/history">历史成绩</a>'));
    if (resultId !== id) { resultId = id; resultPage = 1; }
    var pages = Math.max(1,Math.ceil(e.ids.length/10)); resultPage = Math.max(1,Math.min(resultPage,pages));
    return Promise.all(e.ids.slice((resultPage-1)*10,resultPage*10).map(function (qid) { return Bank.get(qid); })).then(function (qs) {
      var r = e.result, skipped = r.items.filter(function (i) { return i.unanswered; }).length;
      var html = UI.header('EXAM RESULTS','这次考试，留下了新的方向',e.title,'<a class="btn outline" href="#/exam/history">历史成绩</a>');
      html += '<section class="result-hero"><div class="result-circle"><strong id="exam-percentage">' + r.percentage + '%</strong><span>得分率</span></div><div><h2><span id="exam-score">' + valueText(r.score) + '</span> / ' + r.maxScore + ' 分</h2><p class="caption">得分率＝总得分 ÷ 满分 ×100，四舍五入到整数；简答比例分参与总分，不提前取整。</p><div class="result-metrics"><div><strong>' + e.ids.length + '</strong><small>试卷总题数</small></div><div><strong>' + r.attempts + '</strong><small>计分作答次数</small></div><div><strong>' + skipped + '</strong><small>未作答 · 0 分</small></div></div></div></section>';
      html += '<p class="caption">已作答的错题已进入错题本；答对但标不确定的题进入待巩固。模拟考计入每日目标与统计，不改变复习档位、到期日。未作答不计答题次数，不伪造错选项。已有 AI 参考答案未经过独立学科审核。</p><div class="section-head"><h2>逐题回顾</h2><span class="caption">每页 10 题</span></div>';
      html += qs.map(function (q,i) {
        var item = r.items.filter(function (x) { return x.qid === q.id; })[0], saved = e.responses[q.id];
        return '<details class="exam-review-item"><summary><span>' + ((resultPage-1)*10+i+1) + '. ' + UI.esc(q.stem) + '</span><strong>' + valueText(item.score) + '/' + item.maxScore + ' 分</strong></summary><div class="exam-review-body"><div class="question-meta">' + UI.badge(q) + '<span>' + (item.unanswered ? '未作答' : q.type === 'short' ? '自评“' + UI.esc(item.rating) + '”' : item.correct ? '答对' : '答错') + (item.uncertain ? ' · 标记不确定' : '') + '</span></div>' + UI.assets(q) + (q.type === 'mcq' ? '<div class="choice-list">' + q.options.map(function (o) { return '<p class="preserve"><strong>' + UI.esc(o.key) + '．</strong>' + UI.esc(o.text) + (o.key === item.value ? ' 【你的选择】' : '') + (o.key === q.answer ? ' 【题库答案】' : '') + '</p>'; }).join('') + '</div>' : '<h3>你的草稿</h3><p class="preserve">' + UI.esc(saved.draft || '未填写') + '</p>') + '<h3>' + (q.answerSource === 'reference' ? 'AI 参考答案 · 待核对' : '原有答案') + '</h3><p class="preserve">' + UI.esc(UI.answer(q)) + '</p>' + UI.explanation(q) + '<p class="caption">源题号：' + UI.esc(q.sourceId || q.id) + ' · ' + UI.esc(chapterName(q.chapterId)) + '</p><a class="btn outline" href="#/question/' + encodeURIComponent(q.id) + '">查看题目详情 / 加入练习</a></div></details>';
      }).join('');
      if (pages > 1) html += '<div class="pager">' + button('上一页','result-page','outline','data-page="' + (resultPage-1) + '"' + (resultPage===1 ? ' disabled' : '')) + '<span>' + resultPage + ' / ' + pages + '</span>' + button('下一页','result-page','outline','data-page="' + (resultPage+1) + '"' + (resultPage===pages ? ' disabled' : '')) + '</div>';
      return html + '<div class="actions"><a class="btn primary" href="#/exam">再组一卷</a><a class="btn outline" href="#/wrong">查看错题本</a><a class="btn quiet" href="#/home">返回首页</a></div>';
    });
  }
  function history() { return UI.header('EXAM HISTORY','模拟考历史','只列已交卷并完成简答评分的试卷；成绩保存在当前浏览器。','<a class="btn primary" href="#/exam">组新试卷</a>') + '<section class="card">' + historyRows() + '</section>'; }
  function handle(action, el) {
    var op = action.slice(5), e = active();
    if (op === 'start') return start();
    if (op === 'choose') return setChoice(el.getAttribute('data-key'));
    if (op === 'next' && e) return e.index < e.ids.length - 1 ? navigate(e.index+1) : confirmSubmit();
    if (op === 'previous' && e) return navigate(e.index-1);
    if (op === 'jump') return navigate(Number(el.getAttribute('data-index')));
    if (op === 'exit') { App.go('/home'); UI.toast('进度已保存；限时考试仍继续计时。'); return; }
    if (op === 'submit') return confirmSubmit();
    if (op === 'confirm-submit') return submit(false);
    if (op === 'rate') return gradeResponse(el.getAttribute('data-id'),function (r) { r.rating=el.getAttribute('data-value'); r.skipped=false; });
    if (op === 'skip-short') return gradeResponse(el.getAttribute('data-id'),function (r) { r.rating=null; r.skipped=true; r.checks=[]; });
    if (op === 'finish') {
      if (working || !e || e.status !== 'grading') return;
      working=true; if (el) el.disabled=true;
      return finalize(e).then(function (v) { working=false; return v; },function (error) { working=false;if(el&&document.contains(el))el.disabled=false;throw error; });
    }
    if (op === 'result-page') { resultPage=Number(el.getAttribute('data-page'))||1; return App.render().then(function(){window.scrollTo(0,0);}); }
    return false;
  }
  function input(el) {
    if (el.id !== 'exam-draft') return false;
    var e = editable(); if (!e) return true;
    var id=e.ids[e.index]; e.responses[id].draft=el.value;
    var status=document.getElementById('exam-save-status');
    try { persist(e); if(status)status.textContent='草稿已自动保存到本机。'; }
    catch(error) { if(status)status.textContent='草稿未能保存，请复制草稿并查看存储提示。'; UI.toast(error.message); }
    return true;
  }
  function watch(promise) { Promise.resolve(promise).catch(function(error){UI.toast(error.message || '操作未完成，请重试。');}); }
  function change(el) {
    if (el.id === 'exam-scope') { document.getElementById('exam-chapters-wrap').hidden=el.value!=='chapters'; return true; }
    if (el.id === 'exam-count') { document.getElementById('exam-custom-wrap').hidden=el.value!=='custom'; return true; }
    if (el.id === 'exam-uncertain') { var e=editable();if(e){e.responses[e.ids[e.index]].uncertain=el.checked;persist(e);}return true; }
    if (el.hasAttribute('data-exam-point')) {
      var n=Number(el.getAttribute('data-exam-point'));
      watch(gradeResponse(el.getAttribute('data-qid'),function(r){r.checks=r.checks.filter(function(x){return x!==n;});if(el.checked)r.checks.push(n);r.skipped=false;})); return true;
    }
    return false;
  }
  function keydown(event) {
    if (location.hash.split('?')[0] !== '#/exam/quiz' || document.querySelector('.modal') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return false;
    var e=active(); if(!e||e.status!=='active')return false;
    var q=Bank.peek(e.ids[e.index]);
    if (/^[1-5]$/.test(event.key) && q && q.type==='mcq') { event.preventDefault();var option=q.options[Number(event.key)-1];if(option)watch(setChoice(option.key));return true; }
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();watch(navigate(e.index+(event.key==='ArrowLeft'?-1:1)));return true;}
    if(event.key==='Enter'&&event.target.tagName!=='BUTTON'&&event.target.tagName!=='A'){event.preventDefault();if(e.index<e.ids.length-1)watch(navigate(e.index+1));else confirmSubmit();return true;}
    return false;
  }
  function tick() {
    var e=active();if(!e||e.status!=='active')return;
    var seconds=remaining(e), el=document.getElementById('exam-clock');
    if(el){el.textContent=clockText(seconds);el.classList.toggle('exam-time-low',seconds!==null&&seconds<=60);}
    if(seconds===0&&!working)submit(true).catch(function(error){UI.toast(error.message);});
  }
  function onRoute(path) { currentPath=path;if(timer)clearInterval(timer);timer=null;var e=active();if(e&&e.status==='active'){timer=setInterval(tick,1000);tick();} }
  if (typeof window.addEventListener==='function') window.addEventListener('pageshow',function(){if(active())tick();});
  if (typeof document.addEventListener==='function') document.addEventListener('visibilitychange',function(){if(!document.hidden)tick();});
  window.Exam={render:render,quiz:quiz,grade:grade,result:result,history:history,handle:handle,input:input,change:change,keydown:keydown,onRoute:onRoute,scoreItem:scoreItem,scoreExam:scoreExam,remaining:remaining,build:build,shortKind:shortKind,debugStart:function(){App.go('/exam?minute=1');}};
}());
