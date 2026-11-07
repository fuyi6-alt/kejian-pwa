(function () {
  'use strict';
  function number(value) { return typeof value === 'number' && isFinite(value) && value >= 0 ? value : 0; }
  function pct(right, total) { return total ? Math.round(right / total * 100) : null; }
  function records(state) { return Object.keys(state.questions || {}).map(function (id) { return state.questions[id]; }); }
  function summary() {
    var s = Store.get(), generated = s.generatedStats || {}, library = s.generated || {};
    var t = { attempts:number(generated.attempts), correct:number(generated.correct), practiced:Object.keys(generated.practicedIds || {}).length, mastered:0, wrong:0, uncertain:0, streak:Store.streak(), today:number((s.daily[Store.today()] || {}).attempts), rate:null };
    records(s).forEach(function (q) { t.attempts += number(q.attempts); t.correct += number(q.correctCount); if (q.attempts > 0) t.practiced++; if (q.mastered) t.mastered++; if (q.pendingConsolidation) t.uncertain++; });
    t.mastered += Object.keys(library).filter(function (id) { return library[id].mastered; }).length;
    t.wrong = Object.keys(s.wrong || {}).filter(function (id) { return s.wrong[id].active; }).length;
    t.rate = pct(t.correct, t.attempts);
    return t;
  }
  function chapterStats() {
    var s = Store.get(), original = records(s), generated = (s.generatedStats || {}).chapters || {};
    return Bank.index().chapters.map(function (chapter, position) {
      var g = generated[chapter.id] || {}, row = {id:chapter.id, name:chapter.name, position:position, attempts:number(g.attempts), correct:number(g.correct), practiced:Object.keys(g.practicedIds || {}).length, originalPracticed:0, generatedPracticed:Object.keys(g.practicedIds || {}).length, originalTotal:number(chapter.mcqCount) + number(chapter.shortCount)};
      original.forEach(function (q) { if (q.chapterId !== chapter.id) return; row.attempts += number(q.attempts); row.correct += number(q.correctCount); if (q.attempts > 0) { row.practiced++; row.originalPracticed++; } });
      row.rate = pct(row.correct, row.attempts);
      // 用真实比例判定，不让百分比四舍五入改变 60% 门槛。
      row.weak = row.attempts >= 5 && row.correct / row.attempts < 0.6;
      return row;
    }).sort(function (a, b) { return Number(b.weak) - Number(a.weak) || (a.weak && b.weak ? a.correct / a.attempts - b.correct / b.attempts : 0) || a.position - b.position; });
  }
  function trend() {
    var s = Store.get(), days = [];
    for (var i = -6; i <= 0; i++) { var date = Store.addDays(Store.today(), i), d = s.daily[date] || {}; days.push({date:date, attempts:number(d.attempts), correct:number(d.correct), practice:number(d.practice), review:number(d.review), exam:number(d.exam)}); }
    return days;
  }
  function wrongChapters() {
    var s = Store.get(), counts = Object.create(null), index = Bank.index();
    Object.keys(s.wrong || {}).forEach(function (id) { var w = s.wrong[id]; if (!w.active) return; var q = s.questions[id] || {}, cid = q.chapterId || w.chapterId || (index.questionChapters || {})[id] || 'unknown'; counts[cid] = (counts[cid] || 0) + 1; });
    return Object.keys(counts).map(function (id) { var chapter = Bank.chapter(id); return {id:id, name:chapter ? chapter.name : '未识别章节', count:counts[id]}; }).sort(function (a, b) { return b.count - a.count || a.id.localeCompare(b.id); });
  }
  function diagnosticPoints() {
    // 测试模式不读取真实缓存；只做本地聚合，不触发 AI 请求。
    if (Store.isTestMode && Store.isTestMode()) return [];
    var cache = typeof AI !== 'undefined' && AI.cacheEntries ? AI.cacheEntries() : [], latest = Object.create(null), groups = Object.create(null);
    cache.forEach(function (item) {
      if (!item || typeof item.key !== 'string' || typeof item.at !== 'string' || !item.data || typeof item.data.knowledge_point !== 'string') return;
      var qid = item.key.split('|')[0], point = item.data.knowledge_point.trim();
      if (!qid || !point) return;
      if (!latest[qid] || item.at >= latest[qid].at) latest[qid] = {qid:qid, at:item.at, point:point};
    });
    Object.keys(latest).forEach(function (id) { var point = latest[id].point, key = '$' + point; if (!groups[key]) groups[key] = {point:point, count:0, ids:[]}; groups[key].count++; groups[key].ids.push(id); });
    return Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) { return b.count - a.count || a.point.localeCompare(b.point); });
  }
  function optionRanking() {
    var s = Store.get();
    return Object.keys(s.options || {}).map(function (id) { var o = s.options[id]; return {id:id, qid:o.qid, key:o.key, count:number(o.count), autoRecorded:!!o.autoRecorded, active:!!o.active, mastered:!!o.mastered}; }).filter(function (o) { return o.count > 0; }).sort(function (a, b) { return b.count - a.count || a.id.localeCompare(b.id); });
  }
  function metric(value, label, note, id) { return '<div class="metric"><p>' + UI.esc(label) + '</p><strong' + (id ? ' id="stats-' + id + '"' : '') + '>' + UI.esc(value) + '</strong><small>' + UI.esc(note) + '</small></div>'; }
  function empty(text) { return '<p class="stats-empty">' + UI.esc(text) + '</p>'; }
  function rankRows(rows, label) {
    var max = rows.length ? rows[0].count : 1;
    return rows.slice(0, 10).map(function (row) { return '<li><div class="stats-rank-title"><span>' + UI.esc(row.name || row.point) + '</span><strong title="' + UI.esc(label) + '">' + row.count + '</strong></div><div class="stats-rank-track" aria-hidden="true"><span style="width:' + (row.count / max * 100) + '%"></span></div></li>'; }).join('');
  }
  function render() {
    var s = Store.get(), t = summary(), chapters = chapterStats(), weak = chapters.filter(function (c) { return c.weak; }), days = trend(), mistakes = wrongChapters(), points = diagnosticPoints(), options = optionRanking();
    var html = UI.header('LEARNING OVERVIEW', '每一步，都有记录', '从答题记录到薄弱章节，沿用同一套统计口径。');
    html += '<section class="stat-grid" aria-label="学习数据总览">' +
      metric(t.attempts,'答题次数','练习 / 复习 / 模拟考的计分作答，重复作答计入','attempts') +
      metric(t.practiced,'已练题数','至少计分作答一次的题目 ID，去重','practiced') +
      metric(t.rate === null ? '—' : t.rate + '%','正确率','答对 ' + t.correct + ' 次 ÷ 作答 ' + t.attempts + ' 次，四舍五入','rate') +
      metric(t.mastered,'已掌握数','当前已标记掌握的原题与生成题，去重','mastered') +
      metric(t.wrong,'错题数','仍在错题本中的题目；不含仅待巩固','wrong') +
      metric(t.uncertain,'待巩固数','当前标记待巩固的原题，去重','uncertain') +
      metric(t.streak,'连续打卡','连续有计分作答的日期；今天未答从昨天接续','streak') +
      metric(t.today,'今日已答','本机今日计分作答次数，含已交卷完成评分的模拟考','today') + '</section>';
    html += '<p class="caption stats-definition">原题与已保存生成题均计入；删除生成题不删历史作答及去重已练记录。无答案单选只浏览，不计分。简答“会”记答对，“模糊 / 不会”记未答对，模拟考得分另按采分点或自评计算。曾答错且仍在错题本的待巩固题会同时出现在两项中。AI 参考答案未经独立学科审核。</p>';
    html += '<section class="card stats-section"><div class="section-head"><h2>最近 7 天</h2><span class="caption">每天计分作答次数，含重复作答</span></div>';
    var max = Math.max.apply(null, days.map(function (d) { return d.attempts; }).concat([1]));
    html += '<div class="stats-trend" role="img" aria-label="最近七天作答趋势：' + UI.esc(days.map(function (d) { return d.date + '，作答 ' + d.attempts + ' 次，答对 ' + d.correct + ' 次'; }).join('；')) + '">';
    html += days.map(function (d) { return '<div class="stats-day" title="' + UI.esc(d.date + '：作答 ' + d.attempts + ' 次，答对 ' + d.correct + ' 次') + '"><strong>' + d.attempts + '</strong><div class="stats-day-track"><span style="height:' + (d.attempts / max * 100) + '%"></span></div><span>' + UI.esc(d.date.slice(5)) + '</span></div>'; }).join('') + '</div>';
    if (!days.some(function (d) { return d.attempts; })) html += empty('最近 7 天还没有作答。开始一次练习后，这里会记录每天的积累。');
    html += '</section><section class="card stats-section"><div class="section-head"><h2>各章正确率</h2><span class="pill amber" title="作答至少5次且未四舍五入正确率低于60%的章节">薄弱 ' + weak.length + ' 章</span></div><p class="caption">答对次数 ÷ 本章计分作答次数；包含原题与生成题。薄弱章须作答 ≥5 次且正确率 &lt;60%，排在最前。</p>';
    if (!weak.length) html += empty('目前没有达到薄弱判定条件的章节；不足 5 次不会提前判为薄弱。');
    html += '<div class="stats-chapters">' + chapters.map(function (c) { return '<div class="stats-chapter' + (c.weak ? ' is-weak' : '') + '" data-chapter="' + UI.esc(c.id) + '"><div class="stats-chapter-title"><a href="#/chapters">' + UI.esc(c.name) + '</a>' + (c.weak ? '<span class="pill amber">薄弱</span>' : '') + '<strong title="答对次数除以作答次数，百分比四舍五入">' + (c.rate === null ? '—' : c.rate + '%') + '</strong></div><div class="progress-track" role="img" aria-label="' + UI.esc(c.name + '：' + (c.rate === null ? '暂无作答' : '正确率 ' + c.rate + '%')) + '"><span style="width:' + (c.rate === null ? 0 : c.rate) + '%"></span></div><p class="caption">答对 ' + c.correct + ' / 作答 ' + c.attempts + ' 次 · 原题已练 ' + c.originalPracticed + ' / ' + c.originalTotal + ' 题（去重）' + (c.generatedPracticed ? ' · 生成题已练 ' + c.generatedPracticed + ' 题（去重）' : '') + '</p></div>'; }).join('') + '</div>';
    var assigned = chapters.reduce(function (sum, c) { return sum + c.attempts; }, 0);
    if (assigned < t.attempts) html += '<p class="notice amber">另有 ' + (t.attempts - assigned) + ' 次历史作答无法定位章节，保留在总览中，不猜测分配到章节。可能来自升级前已删除的生成题。</p>';
    html += '</section><div class="stats-rank-grid"><section class="card stats-section"><h2>错题章节排行</h2><p class="caption">仍在错题本中的去重题数；按数量降序，显示前 10 章。</p>' + (mistakes.length ? '<ol class="stats-ranks">' + rankRows(mistakes,'本章当前错题去重题数') + '</ol><a class="btn outline" href="#/wrong">查看错题本</a>' : empty('当前没有待掌握错题。答错的原题会自动记录到这里。')) + '</section>';
    html += '<section class="card stats-section"><h2>AI 诊断考点排行</h2><p class="caption">每题只取最新有效诊断缓存，按相同诊断考点覆盖的去重题数排序；显示前 10 项，不代表学科结论已经审核。</p>' + (points.length ? '<ol class="stats-ranks">' + rankRows(points,'该考点最新诊断覆盖的去重题数') + '</ol>' : empty(Store.isTestMode && Store.isTestMode() ? '测试模式不读取真实诊断缓存，也不调用 AI。' : '暂无有效诊断缓存。你主动诊断错题后，这里才会汇总考点。')) + '</section></div>';
    html += '<section class="card stats-section"><h2>选项弱点排行</h2><p class="caption">按“题目 ID + 选项键”的累计被标次数排序，含自动错选与手动追加；取消追加或已掌握不删历史次数。显示前 10 项。</p>';
    var ai = s.aiStats || {}, cacheCount = typeof AI !== 'undefined' && AI.cacheCount ? AI.cacheCount() : 0;
    var footer = '</section><section class="card stats-section"><h2>AI 使用</h2><div class="stat-grid stats-ai">' + metric(number(ai.calls),'调用次数','实际请求次数，含重试与测试连接','ai-calls') + metric(cacheCount,'诊断缓存条数','当前有效缓存条目；同题不同模型可多条，不含生成题','ai-cache') + '</div><p class="caption">数字仅来自本机记录；本页不发起 AI 调用。</p></section>';
    if (!options.length) return html + empty('还没有选项弱点记录。选择题答错会自动记录错选项，也可手动追加标记。') + footer;
    return Promise.all(options.slice(0,10).map(function (o) { return Bank.get(o.qid).then(function (q) { var option = q.options.filter(function (x) { return x.key === o.key; })[0]; return {entry:o, question:q, text:option ? option.text : '原选项暂不可读取'}; }).catch(function () { return {entry:o, question:null, text:'原题暂未加载，可稍后从选项弱点页查看'}; }); })).then(function (rows) {
      html += '<ol class="stats-options">' + rows.map(function (row) { var o = row.entry; return '<li><a href="#/question/' + encodeURIComponent(o.qid) + '"><span class="stats-option-key">' + UI.esc(o.key) + '</span><span class="preserve">' + UI.esc(row.text) + '</span><strong title="累计被标次数（自动错选 + 手动追加）">' + o.count + ' 次</strong></a><p class="caption">' + UI.esc(o.qid) + ' · ' + (o.autoRecorded ? '包含自动错选' : '手动追加标记') + ' · ' + (o.mastered ? '已掌握，历史保留' : o.active ? '当前标记中' : '追加已取消，历史保留') + '</p></li>'; }).join('') + '</ol><a class="btn outline" href="#/wrong/options">查看选项弱点</a>';
      return html + footer;
    });
  }
  window.Stats = {summary:summary, chapterStats:chapterStats, trend:trend, wrongChapters:wrongChapters, diagnosticPoints:diagnosticPoints, optionRanking:optionRanking, render:render};
}());
