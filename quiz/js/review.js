(function () {
  'use strict';

  var filters = { chapter: 'all', type: 'all', state: 'active', sort: 'newest' };
  var page = 1;
  var pageSize = 20;

  function option(value, label, selected) {
    return '<option value="' + UI.esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + UI.esc(label) + '</option>';
  }
  function dateText(value) {
    if (!value) return '尚无作答';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '日期未知';
    return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
  }
  function entries() {
    var state = Store.get();
    var ids = Object.keys(state.wrong);
    Object.keys(state.questions).forEach(function (id) {
      if (state.questions[id].pendingConsolidation && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids.map(function (id) {
      return { id: id, record: state.questions[id] || {}, wrong: state.wrong[id] || {} };
    }).filter(function (item) {
      var q = item.record, w = item.wrong;
      var cid = q.chapterId || w.chapterId;
      var type = q.type || w.type;
      var stateMatches = filters.state === 'all' ||
        (filters.state === 'active' && w.active) ||
        (filters.state === 'mastered' && w.mastered) ||
        (filters.state === 'uncertain' && q.pendingConsolidation);
      return stateMatches && (filters.chapter === 'all' || cid === filters.chapter) && (filters.type === 'all' || type === filters.type);
    }).sort(function (a, b) {
      if (filters.sort === 'wrongCount') {
        var delta = (b.record.wrongCount || 0) - (a.record.wrongCount || 0);
        if (delta) return delta;
      }
      var aTime = a.record.lastAnsweredAt || a.wrong.lastAddedAt || a.record.lastUncertainAt || '';
      var bTime = b.record.lastAnsweredAt || b.wrong.lastAddedAt || b.record.lastUncertainAt || '';
      return bTime.localeCompare(aTime) || a.id.localeCompare(b.id);
    });
  }
  function flags(qid) {
    var state = Store.get(), q = state.questions[qid] || {}, w = state.wrong[qid] || {};
    return (w.active ? '<span class="pill amber">未掌握</span>' : w.mastered ? '<span class="pill pale">已掌握 · 历史保留</span>' : '') +
      (q.pendingConsolidation ? '<span class="pill amber">待巩固</span>' : '');
  }
  function latestAnswer(q, record) {
    if (q.type === 'short') return record.lastRating ? '自评“' + record.lastRating + '”' : '尚未自评';
    if (!record.lastAnswer) return '尚未作答';
    var selected = q.options.filter(function (item) { return item.key === record.lastAnswer; })[0];
    return record.lastAnswer + (selected ? '．' + selected.text : '');
  }
  function render() {
    var all = entries(), totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    page = Math.min(Math.max(1, page), totalPages);
    var visible = all.slice((page - 1) * pageSize, page * pageSize);
    var title = filters.state === 'uncertain' ? '把不确定，变成把握' : '把易错点，再学一次';
    var html = ReviewLab.tabs('wrong') + UI.header('MY REVIEW', title, '错选记录会一直保留。已掌握的题目也能随时找回。', UI.button('一键复练 ' + UI.icon('arrow'), 'retry-wrong', 'primary', retryIds().length ? '' : 'disabled'));
    html += '<div class="filter-row"><label>章节<select id="wrong-chapter">' + option('all', '全部章节', filters.chapter) + Bank.index().chapters.map(function (c) { return option(c.id, c.name, filters.chapter); }).join('') + '</select></label>';
    html += '<label>题型<select id="wrong-type">' + [['all', '全部题型'], ['mcq', '单选题'], ['short', '简答题'], ['multiple', '多选（仅浏览）'], ['fill', '填空（仅浏览）']].map(function (x) { return option(x[0], x[1], filters.type); }).join('') + '</select></label>';
    html += '<label>状态<select id="wrong-state">' + [['active', '未掌握'], ['mastered', '已掌握'], ['uncertain', '待巩固'], ['all', '全部记录']].map(function (x) { return option(x[0], x[1], filters.state); }).join('') + '</select></label>';
    html += '<label>排序<select id="wrong-sort">' + [['newest', '最近记录优先'], ['wrongCount', '错误次数优先']].map(function (x) { return option(x[0], x[1], filters.sort); }).join('') + '</select></label></div>';
    html += '<p class="caption">当前筛选 ' + all.length + ' 题（去重）。待巩固单独统计，单纯“不确定”不会加入错题数；已掌握移出当前错题，历史保留。</p>';
    return Promise.all(visible.map(function (item) { return Bank.get(item.id).then(function (q) { return { q: q, entry: item }; }); })).then(function (rows) {
      html += rows.map(function (row) {
        var q = row.q, r = row.entry.record, chapter = Bank.chapter(q.chapterId);
        return '<a class="question-row" href="#/question/' + encodeURIComponent(q.id) + '"><div><div class="question-meta">' + UI.badge(q) + flags(q.id) + '</div><h3>' + UI.esc(q.stem) + '</h3>' +
          '<p class="caption">' + UI.esc(chapter ? chapter.name : q.chapterId) + ' · 错误 ' + (r.wrongCount || 0) + ' 次 · ' + UI.esc(dateText(r.lastAnsweredAt || row.entry.wrong.lastAddedAt)) + '</p>' +
          '<p class="caption">最近答案：' + UI.esc(latestAnswer(q, r)) + '</p>' +
          (r.selectedWrongOption ? '<p class="caption">系统已保留错选项：' + UI.esc(r.selectedWrongOption) + '</p>' : '') + '</div>' + UI.icon('arrow') + '</a>';
      }).join('');
      if (!rows.length) html += UI.empty('这里暂时没有题目', '换一个筛选条件，或从章节专项开始练习。', '<a class="btn outline" href="#/chapters">去练习</a>');
      if (all.length > pageSize) html += '<div class="actions">' + UI.button('上一页', 'wrong-page', 'outline', 'data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '')) + '<span class="caption">第 ' + page + ' / ' + totalPages + ' 页</span>' + UI.button('下一页', 'wrong-page', 'outline', 'data-page="' + (page + 1) + '"' + (page === totalPages ? ' disabled' : '')) + '</div>';
      return html;
    });
  }
  function detail(id) {
    return Bank.get(id).then(function (q) {
      var state = Store.get(), r = state.questions[id] || {}, w = state.wrong[id] || {};
      var chapter = Bank.chapter(q.chapterId), supported = q.type === 'mcq' || q.type === 'short';
      var attrs = 'data-id="' + UI.esc(q.id) + '"';
      var html = UI.header('QUESTION DETAIL', '题目回顾', chapter ? chapter.name : q.chapterId, '<a class="btn outline" href="#/wrong">返回错题本</a>');
      html += '<article class="question-card"><div class="question-meta">' + UI.badge(q) + flags(id) + '</div><h2 class="question-stem preserve">' + UI.esc(q.stem) + '</h2>' + UI.assets(q);
      if (q.options.length) html += '<div class="choice-list">' + q.options.map(function (o) { return '<p class="preserve"><strong>' + UI.esc(o.key) + '．</strong>' + UI.esc(o.text) + '</p>'; }).join('') + '</div>';
      if (!supported) html += '<p class="notice amber">此题为源题库保留的' + UI.esc(UI.type(q)) + '，支持详情浏览，不进入单选训练。</p>';
      html += '<details class="card"><summary>展开答案与解析</summary><h3>' + (q.answerSource === 'reference' ? '参考答案 · 待核对' : '原材料答案') + '</h3><p class="preserve">' + UI.esc(UI.answer(q)) + '</p>' + UI.explanation(q) + '</details>';
      html += '<section class="card"><h3>我的记录</h3><p class="preserve">最近答案：' + UI.esc(latestAnswer(q, r)) + '</p>';
      if (r.selectedWrongOption) html += '<p>历史错选项：<strong>' + UI.esc(r.selectedWrongOption) + '</strong>（系统自动记录）</p>';
      html += '<p class="caption">作答 ' + (r.attempts || 0) + ' 次 · 错误 ' + (r.wrongCount || 0) + ' 次 · 连续达标答对 ' + (r.correctStreak || 0) + ' 次 · 不确定标记 ' + (r.uncertainCount || 0) + ' 次</p>';
      if (q.type === 'short') html += '<p class="caption">简答掌握：连续 2 次“会”，且每次有采分点时勾选比例 ≥80%。无答案时按自评记录。</p>';
      else html += '<p class="caption">错题连续 2 次答对或手动标记掌握后移出；已掌握记录可找回。</p>';
      html += '<p class="review-plan caption">复习档位 ' + (r.box || 1) + ' / 5 · 到期日期 ' + UI.esc(r.dueAt || '尚未安排') + '</p></section>';
      if (q.type === 'mcq') {
        var marks = Store.getOptionMarks(q.id).filter(function (m) { return m.active || m.autoRecorded; });
        html += '<section class="card"><div class="section-head"><h3>选项标记</h3>' + UI.button('补充 / 修改标记', 'option-panel', 'outline', attrs) + '</div>';
        html += marks.length ? marks.map(function (m) {
          var sourceOption = q.options.filter(function (o) { return o.key === m.key; })[0];
          return '<div class="question-row"><div><p class="preserve"><strong>' + UI.esc(m.key) + '．</strong>' + UI.esc(sourceOption ? sourceOption.text : '') + '</p><p class="caption">被标 ' + m.count + ' 次 · ' + (m.autoRecorded ? '系统自动记录：已保留，不能取消' : '追加标记：可取消') + '</p></div></div>';
        }).join('') : '<p class="subtle">暂无选项标记。</p>';
        html += '</section>';
      }
      html += AIUI.detail(q) + ReviewLab.detailActions(q);
      html += '<div class="actions">';
      if (supported) html += UI.button('单题练习 ' + UI.icon('arrow'), 'redo-question', 'primary', attrs) + UI.button('加入练习队列', 'queue-question', 'outline', attrs);
      if (!w.active) html += UI.button(w.mastered ? '找回到错题本' : '加入错题本', w.mastered ? 'restore-wrong' : 'add-wrong', 'outline', attrs);
      if (w.active) html += UI.button('标记已掌握并移出', 'manual-master', 'outline', attrs);
      if (r.pendingConsolidation) html += UI.button('已巩固', 'consolidate', 'outline', attrs);
      html += UI.button(UI.icon('flag') + '题目报错', 'report', 'quiet', attrs) + '</div>';
      html += '<p class="caption source-details">源题号：' + UI.esc(q.sourceId || q.id) + ' · ' + UI.esc((q.sourceMetadata || {}).locator || '') + '</p></article>';
      return html;
    });
  }
  function retryIds() {
    return entries().filter(function (item) {
      var type = item.record.type || item.wrong.type;
      return (item.wrong.active || item.record.pendingConsolidation) && (type === 'mcq' || type === 'short');
    }).sort(function(a,b){return (b.record.wrongCount||0)-(a.record.wrongCount||0);}).map(function (item) { return item.id; });
  }
  function setFilter(name, value) {
    if (Object.prototype.hasOwnProperty.call(filters, name)) { filters[name] = value; page = 1; }
  }
  function setPage(value) { page = Math.max(1, Number(value) || 1); }

  window.Review = { render: render, detail: detail, retryIds: retryIds, setFilter: setFilter, setPage: setPage };
}());
