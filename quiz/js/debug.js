(function () {
  'use strict';
  var chapterId = '', questionId = '', pending = null;
  function btn(text, op, disabled) { return UI.button(text, 'debug-' + op, 'outline', disabled ? 'disabled' : ''); }
  function render() {
    var testing = Store.isTestMode(), s = Store.get();
    var html = UI.header('LOCAL TEST TOOLS', '调试与验收', '测试工具，不影响真实学习记录（除清空测试数据）');
    html += '<p class="notice amber">所有工具只作用于独立测试副本。“清空测试数据”也只删除测试副本中的学习记录。退出测试后恢复真实学习记录；题库原文与答案始终不改动。测试模式禁止真实 AI 请求。</p>';
    if (!testing) return html + '<section class="card"><h2>先进入测试副本</h2><p>首次进入会复制当前学习记录用于验收；已有测试副本可继续使用。首页、专项、错题本与模拟考将使用测试记录，页面顶部持续显示提示。</p>' + btn('进入测试模式', 'enter') + '</section>';
    html += '<div class="debug-heading-actions">' + btn('退出测试，返回真实记录', 'exit') + btn('清空测试数据', 'clear') + '</div><p class="caption">当前模拟日期：<strong id="debug-today">' + UI.esc(Store.today()) + '</strong> · 相对本机日期偏移 ' + (s.debugDayOffset || 0) + ' 天</p>';
    var chapters = Bank.index().chapters.filter(function (c) { return c.mcqCount + c.shortCount > 0; });
    if (!chapterId || !Bank.chapter(chapterId)) chapterId = chapters[0].id;
    return Bank.load(chapterId).then(function (chapter) {
      var qs = (chapter.mcq || []).concat(chapter.short || []).filter(function (q) { return q.type === 'short' || Bank.gradable(q); });
      if (!qs.some(function (q) { return q.id === questionId; })) questionId = qs.length ? qs[0].id : '';
      var q = qs.filter(function (item) { return item.id === questionId; })[0], r = s.questions[questionId] || {};
      html += '<div class="debug-grid"><section class="card"><h2>指定题目</h2><label class="field-label" for="debug-chapter">章节</label><select id="debug-chapter">' + chapters.map(function (c) { return '<option value="' + c.id + '"' + (c.id === chapterId ? ' selected' : '') + '>' + UI.esc(c.name) + '</option>'; }).join('') + '</select>';
      html += '<label class="field-label" for="debug-question">题目（可复习原题，按源 ID）</label><select id="debug-question"' + (!q ? ' disabled' : '') + '>' + (qs.length ? qs.map(function (item) { return '<option value="' + UI.esc(item.id) + '"' + (item.id === questionId ? ' selected' : '') + '>' + UI.esc(item.id + ' · ' + item.stem.slice(0, 36)) + '</option>'; }).join('') : '<option value="">本章暂无可复习题目</option>') + '</select>';
      if (!q) html += '<p class="notice">本章暂无可判分单选或简答题，请切换章节。缺答案单选仍可在搜索中浏览。</p>';
      if (q) html += '<p class="preserve debug-question">' + UI.esc(q.stem) + '</p><dl class="debug-facts"><div><dt>复习档位（1–5）</dt><dd id="debug-box">' + (r.box || 1) + '</dd></div><div><dt>到期日期</dt><dd id="debug-due">' + UI.esc(r.dueAt || '尚未安排') + '</dd></div><div><dt>累计计分作答</dt><dd>' + (r.attempts || 0) + ' 次</dd></div><div><dt>待巩固 / 当前错题</dt><dd>' + (r.pendingConsolidation ? '是' : '否') + ' / ' + ((s.wrong[q.id] || {}).active ? '是' : '否') + '</dd></div></dl>';
      html += '<div class="actions">' + btn('设为昨天到期', 'yesterday', !q) + btn('设为今天到期', 'today', !q) + btn('判为待巩固', 'uncertain', !q) + btn('加入错题本', 'wrong', !q) + '</div><div class="actions">' + UI.button('练习这道题', 'redo-question', 'primary', 'data-id="' + UI.esc(questionId) + '"' + (!q ? ' disabled' : '')) + '<a class="btn quiet" href="#/home">查看首页到期数</a></div><p class="caption">只列可进入复习队列的题目。设定到期不伪造作答次数。已有到期计划的题再次答对会升档；全新作答从第 1 档开始。</p></section>';
      html += '<section class="card"><h2>时间与打卡</h2><div class="actions">' + btn('模拟 +1 天', 'next-day') + btn('造 7 天打卡数据', 'seven-days') + '</div><p class="caption">7 天工具先清空测试学习记录，再用一条已有答案的原题写入连续 7 天作答；累计次数、每日记录与打卡均来自同一记录路径。</p><h2>模拟考试</h2>' + btn('1 分钟模拟考', 'minute-exam') + '<p class="caption">进入组卷，使用真实 60 秒倒计时；到时自动收卷，可继续简答自评并保存成绩。</p><h2>复习计划</h2>' + btn('重置复习计划', 'reset-plan') + '<p class="caption">仅重置测试副本：已作答题回第 1 档并于明天到期，未作答题恢复未安排；答题次数保留。</p><h2>强制问法</h2><p class="notice">不适用：阶段 2 已改为实际错项集中练，不再生成“正确的是 / 错误的是”拼装单选题。</p><a class="btn outline" href="#/wrong/options">验收错项集中练</a></section></div>';
      return html;
    });
  }
  function check(ok) { if (!ok) throw new Error('测试记录未能保存，请查看存储提示。'); }
  function run(op) {
    if (op === 'enter') { if (AI.busy && AI.busy()) throw new Error('当前 AI 请求尚未完成，请完成后再进入测试模式，以保持记录隔离。'); check(Store.enterTestMode()); return App.render(); }
    if (!Store.isTestMode()) throw new Error('请先进入测试模式。');
    var origin = Store.get();
    if (op === 'exit') { Practice.pause(); check(Store.exitTestMode()); return App.go('/home'); }
    if (op === 'clear') { Practice.pause(); check(Store.clearTestData()); return App.render(); }
    if (op === 'next-day') { check(Store.setDebugDayOffset((Store.get().debugDayOffset || 0) + 1)); return App.render(); }
    if (op === 'minute-exam') return App.go('/exam?minute=1');
    if (op === 'reset-plan') {
      var s = Store.get(); Object.keys(s.questions).forEach(function (id) { var r = s.questions[id]; r.box = 1; r.dueAt = r.attempts ? Store.addDays(Store.today(), 1) : null; });
      check(Store.save()); return App.render();
    }
    if (op === 'seven-days') { document.getElementById('main').innerHTML=UI.loading('正在准备 7 天测试记录…');return Bank.loadAll().then(function () {
      if (Store.get() !== origin || !Store.isTestMode()) return;
      var q = Bank.all().filter(function (item) { return Bank.gradable(item); })[0];
      if (!q) throw new Error('没有可用于测试作答的有答案单选题。');
      Practice.pause(); check(Store.clearTestData());
      for (var day = -6; day <= 0; day++) {
        check(Store.setDebugDayOffset(day));
        check(Store.recordAnswer(q, {value:q.answer, correct:true, mode:'practice', attemptId:'debug-seven:' + Store.today() + ':' + q.id}));
      }
      check(Store.setDebugDayOffset(0)); chapterId = q.chapterId; questionId = q.id;
      UI.toast('已在测试副本写入 7 天、共 7 次作答。'); return App.render();
    }).catch(function(error){App.render();throw error;}); }
    if (!questionId) { UI.toast('请先选择有可复习题目的章节。'); return; }
    return Bank.get(questionId).then(function (q) {
      if (Store.get() !== origin || !Store.isTestMode()) return;
      if (q.type !== 'short' && !Bank.gradable(q)) throw new Error('此题不进入复习队列，请选择可判分单选或简答题。');
      if (op === 'today' || op === 'yesterday') { var r = Store.question(q.id); r.chapterId = q.chapterId; r.type = q.type; r.dueAt = Store.addDays(Store.today(), op === 'today' ? 0 : -1); check(Store.save()); }
      if (op === 'uncertain') check(Store.markUncertain(q, {sessionId:'debug-manual'}));
      if (op === 'wrong') check(Store.addWrong(q));
      return App.render();
    });
  }
  var messages = {
    enter:['进入测试模式','使用独立测试副本完成验收。首次进入复制现有学习记录；已有副本则继续该副本。'],
    exit:['退出测试模式','切回真实学习记录，保留测试副本。'],
    clear:['清空测试数据','删除测试副本中的练习、错题、考试和打卡，保留学习设置。此操作不可撤销，仅影响测试副本。'],
    yesterday:['设为昨天到期','将当前测试题到期日设为模拟日期的前一天。'],
    today:['设为今天到期','将当前测试题到期日设为模拟日期。'],
    uncertain:['判为待巩固','标记当前测试题待巩固，到期取现有日期与 3 天后的较早者。'],
    wrong:['加入错题本','加入测试错题本，不伪造答题次数。'],
    'next-day':['模拟 +1 天','测试日期前进一天，实际系统时间不变。'],
    'seven-days':['造 7 天打卡数据','先清空全部测试学习记录，再生成连续 7 天、共 7 次作答；仅使用题库现有答案做程序测试。'],
    'minute-exam':['启用 1 分钟模拟考','打开组卷并启用 60 秒考试，题量与范围仍可选择。'],
    'reset-plan':['重置复习计划','已作答测试题重置为第 1 档、明天到期；未作答题不安排到期。答题历史保留。']
  };
  function handle(action) {
    var op = action.slice(6);
    if (op === 'confirm') { var callback = pending; pending = null; UI.closeModal(); return callback ? callback() : null; }
    if (!messages[op]) return false;
    if (op !== 'enter' && !Store.isTestMode()) throw new Error('请先进入测试模式。');
    pending = function () { return run(op); };
    UI.modal(messages[op][0], '<p>' + UI.esc(messages[op][1]) + '</p><p class="caption">仅当前浏览器生效，真实学习记录与题库原文保持原状。</p><div class="modal-actions">' + UI.button('取消', 'close-modal', 'quiet') + UI.button('确认' + messages[op][0], 'debug-confirm', 'primary') + '</div>');
    UI.onModalClose = function () { pending = null; };
    return true;
  }
  function change(el) {
    if (el.id === 'debug-chapter') { chapterId = el.value; questionId = ''; App.render(); return true; }
    if (el.id === 'debug-question') { questionId = el.value; App.render(); return true; }
    return false;
  }
  window.Debug = { render:render, handle:handle, change:change };
}());
