(function () {
  'use strict';
  function metric(value, label, note, id) {
    return '<div class="metric"><p>' + label + '</p><strong' + (id ? ' id="' + id + '"' : '') + '>' + value + '</strong><small>' + note + '</small></div>';
  }
  function render() {
    var s = Store.get(), t = Stats.summary(), day = Store.today(), goal = s.settings.dailyGoal;
    var progress = Math.min(1, t.today / goal), date = s.settings.examDate;
    var days = date ? Math.round((new Date(date + 'T12:00:00') - new Date(day + 'T12:00:00')) / 86400000) : null;
    var due = Store.dueIds().length;
    var ring = '<div class="goal-ring" role="img" aria-label="今日已答 ' + t.today + ' 次，目标 ' + goal + ' 次"><svg viewBox="0 0 120 120"><circle class="ring-track" cx="60" cy="60" r="51"/><circle class="ring-value" cx="60" cy="60" r="51" stroke-dasharray="320.44" stroke-dashoffset="' + (320.44 * (1 - progress)) + '"/></svg><div class="ring-label"><strong id="home-today">' + t.today + '</strong><small>/ ' + goal + ' 次</small></div></div>';
    var html = UI.header('YOUR DAILY STUDY', '今天，也向掌握迈一步', '系统解剖学 · 从理解一道题开始');
    html += '<div class="hero-grid"><section class="welcome-card"><p class="eyebrow">EXAM COUNTDOWN</p>';
    html += days === null ? '<h2>给复习一个明确的终点</h2><p>设置考试日期，让每一天的进步都看得见。</p><a class="btn" href="#/settings">设置考试日期 ' + UI.icon('arrow') + '</a>' : '<p>距系统解剖学考试</p><div class="countdown"><strong>' + Math.abs(days) + '</strong><span>' + (days < 0 ? '天 · 已过去' : '天') + '</span></div><p>' + UI.esc(date) + (days === 0 ? ' · 今天考试，祝你从容发挥。' : '') + '</p><small>按本机日历日期计算</small>';
    html += '</section><section class="goal-card">' + ring + '<div class="goal-copy"><h3>今日目标</h3><p>' + (t.today >= goal ? '今日目标已完成。' : '慢慢来，也在向前。') + '</p><p class="caption">计分练习、复习与模拟考<br>同题重做也计数</p></div></section></div>';
    html += '<div class="review-summary"><a class="due-card" href="#/review"><div class="shortcut-icon">' + UI.icon('calendar') + '</div><div><h2>今日到期复习</h2><strong id="home-due">' + due + '</strong><span> 道</span><p class="caption">到期日 ≤ ' + UI.esc(day) + ' 的原题 · 按题目去重</p></div>' + UI.icon('arrow') + '</a><div class="card streak-card"><h3>连续打卡</h3><strong id="home-streak">' + t.streak + '</strong><span> 天</span><p class="caption">连续有计分作答的日期；今天未答时从昨天接续</p></div></div>';
    var activeExam = (s.exams || {})[s.activeExamId];
    if (activeExam && activeExam.status !== 'complete') html += '<a class="continue-card" href="#' + (activeExam.status === 'grading' ? '/exam/grade' : '/exam/quiz') + '"><div><h3>' + (activeExam.status === 'grading' ? '完成模拟考评分' : '继续模拟考试') + '</h3><p class="caption">已保存答题进度；限时考试离开页面后仍继续计时</p></div>' + UI.icon('arrow') + '</a>';
    var sessions = Object.keys(s.sessions).map(function (id) { return s.sessions[id]; }).filter(function (x) { return x.status === 'active'; }).sort(function (a, b) { return b.startedAt.localeCompare(a.startedAt); });
    if (s.activeSessionId) sessions.sort(function (a, b) { return a.id === s.activeSessionId ? -1 : b.id === s.activeSessionId ? 1 : 0; });
    function sessionCard(x, latest) {
      var id=UI.esc(x.id);
      return '<div class="resume-swipe" data-session="'+id+'">'+
        UI.button('删除','resume-delete','resume-delete','data-id="'+id+'" disabled tabindex="-1" aria-hidden="true" aria-label="删除这次练习"')+
        '<div class="continue-card resume-front">'+UI.icon('book')+'<div class="resume-copy"><h3>'+(latest?'继续上次练习 · ':'继续 · ')+UI.esc(x.label)+'</h3><p class="caption">已浏览 / 作答 '+Object.keys(x.answers).length+' / '+x.ids.length+' 题 · 当前第 '+(x.index+1)+' 题</p>'+(latest?'<small class="caption swipe-hint">右滑可删除</small>':'')+'</div><div class="resume-controls">'+UI.button('继续 '+UI.icon('arrow'),'resume','outline','data-id="'+id+'"')+UI.button('⋯','resume-actions','quiet resume-menu','data-id="'+id+'" aria-label="展开练习删除按钮" aria-expanded="false" title="练习操作"')+'</div></div></div>';
    }
    if (sessions.length) {
      html += sessionCard(sessions[0], true);
      if (sessions.length > 1) html += '<details class="more-sessions"><summary>其他未完成练习（' + (sessions.length - 1) + '）</summary>' + sessions.slice(1).map(function (x) { return sessionCard(x, false); }).join('') + '</details>';
    }
    var group = (s.generatedGroups || {})[s.activeGeneratedGroupId];
    if (group && group.status === 'active') html += '<a class="continue-card" href="#/wrong/group/' + encodeURIComponent(group.id) + '"><div><h3>继续错项集中练</h3><p class="caption">' + UI.esc(group.title) + ' · 已答 ' + Object.keys(group.answers).length + ' / ' + group.ids.length + ' 项</p></div>' + UI.icon('arrow') + '</a>';
    if (t.uncertain) html += '<a class="continue-card" href="#/wrong?state=uncertain"><div><h3>' + t.uncertain + ' 道题等待巩固</h3><p class="caption">按待巩固标记去重；单纯不确定不计入错题数</p></div>' + UI.icon('arrow') + '</a>';
    var backup = s.lastBackupAt || s.firstUsedAt;
    if(backup){var bd=new Date(backup);backup=bd.getFullYear()+'-'+('0'+(bd.getMonth()+1)).slice(-2)+'-'+('0'+bd.getDate()).slice(-2);}
    var age = backup ? Math.floor((new Date(day + 'T12:00:00') - new Date(String(backup).slice(0, 10) + 'T12:00:00')) / 86400000) : 0;
    if (age > 30) html += '<section class="notice amber backup-reminder"><strong>' + (s.lastBackupAt ? '超过 30 天未导出学习备份' : '使用已超过 30 天，还没有导出学习备份') + '</strong><p>记录只在当前浏览器。建议将备份文件保存在你能找到的位置。</p>' + UI.button('导出学习备份', 'ai-export', 'outline') + '</section>';
    html += '<div class="section-head"><h2>从这里开始</h2><span class="caption">把知识点，变成把握</span></div><div class="shortcut-grid">';
    html += [['book','章节专项','到期题优先','/chapters'],['shuffle','随机刷题','换个角度练','random'],['wrong','错题复练','补齐薄弱点','/wrong'],['exam','模拟考试','限时检验与回顾','/exam'],['search','题库搜索','题干 · 选项 · 解析','/search']].map(function (x) { return (x[3] === 'random' ? '<button data-action="setup-random"' : '<a href="#' + x[3] + '"') + ' class="shortcut"><span class="shortcut-icon">' + UI.icon(x[0]) + '</span><strong>' + x[1] + '</strong><small>' + x[2] + '</small>' + (x[3] === 'random' ? '</button>' : '</a>'); }).join('') + '</div>';
    html += '<div class="section-head"><h2>我的学习概览</h2><a class="caption" href="#/stats">查看统计 ' + UI.icon('arrow') + '</a></div><div class="stat-grid">';
    html += metric(t.practiced, '已练题数', '至少计分作答一次 · 去重') + metric(t.rate === null ? '—' : t.rate + '%', '累计正确率', '答对次数 ÷ 计分作答次数') + metric(t.wrong, '待掌握错题', '当前错题 · 不含仅待巩固') + metric(t.mastered, '已掌握', '当前已标记掌握的题目 · 去重') + '</div>';
    html += '<p class="caption" style="margin-top:18px">全库 ' + Bank.index().totalAll + ' 题；单选 ' + Bank.index().totalMcq + '、简答 ' + Bank.index().totalShort + '，另有多选 ' + Bank.index().totalMultiple + '、填空 ' + Bank.index().totalFill + ' 供搜索浏览。无答案单选只浏览不计分，简答“会”计为答对；AI 参考答案仍待核对。</p>';
    return html;
  }
  var drag=null, ignoreClick=null, pendingDelete=null, revealWidth=84;
  function setOpen(row, open, focus) {
    if(open) document.querySelectorAll('.resume-swipe.is-open').forEach(function(other){if(other!==row)setOpen(other,false);});
    row.classList.toggle('is-open',open);row.classList.remove('is-dragging');
    row.querySelector('.resume-front').style.transform='';
    var remove=row.querySelector('.resume-delete'), menu=row.querySelector('.resume-menu');
    remove.disabled=!open;remove.tabIndex=open?0:-1;remove.setAttribute('aria-hidden',String(!open));
    menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'收起练习删除按钮':'展开练习删除按钮');
    if(focus)(open?remove:menu).focus();
  }
  function closeRows() { document.querySelectorAll('.resume-swipe.is-open').forEach(function(row){setOpen(row,false);}); }
  function handle(action, el) {
    var id=el.getAttribute('data-id'), row=el.closest('.resume-swipe');
    if(action==='resume-actions'&&row){setOpen(row,!row.classList.contains('is-open'),true);return;}
    if(action==='resume-delete') {
      var session=Store.get().sessions[id];if(!session||session.status!=='active')return;
      UI.modal('删除这次练习？','<p>删除“'+UI.esc(session.label)+'”后，这个未完成的练习队列将无法继续。</p><p class="caption">已记录的答题次数、错题和复习计划会保留。</p><div class="modal-actions">'+UI.button('取消','close-modal','outline')+UI.button('确定删除','resume-confirm-delete','danger')+'</div>');
      pendingDelete={id:id,origin:Store.get()};UI.onModalClose=function(){pendingDelete=null;};return;
    }
    if(action==='resume-confirm-delete') {
      var task=pendingDelete;if(!task||Store.get()!==task.origin){UI.closeModal();return;}
      if(!Store.deleteSession(task.id)){UI.toast('未能删除，请查看存储提示后重试。');return;}
      UI.closeModal();return App.render().then(function(){document.getElementById('main').focus({preventScroll:true});UI.toast('练习队列已删除。');});
    }
  }
  document.addEventListener('pointerdown',function(e){
    ignoreClick=null;
    if(e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;
    var front=e.target.closest('.resume-front');if(!front)return;
    var row=front.closest('.resume-swipe');
    drag={row:row,front:front,id:e.pointerId,x:e.clientX,y:e.clientY,open:row.classList.contains('is-open'),axis:null,offset:row.classList.contains('is-open')?revealWidth:0};
  });
  document.addEventListener('pointermove',function(e){
    if(!drag||drag.id!==e.pointerId)return;
    var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.axis){
      if(Math.max(Math.abs(dx),Math.abs(dy))<10)return;
      if(Math.abs(dy)>=Math.abs(dx)){drag=null;return;}
      drag.axis='x';drag.row.classList.add('is-dragging');drag.front.setPointerCapture(e.pointerId);
    }
    drag.offset=Math.max(0,Math.min(revealWidth,(drag.open?revealWidth:0)+dx));
    drag.front.style.transform='translateX('+drag.offset+'px)';
    if(e.cancelable)e.preventDefault();
  },{passive:false});
  function endDrag(e,cancelled){
    if(!drag||drag.id!==e.pointerId)return;
    var previous=drag;drag=null;
    if(previous.axis){ignoreClick=previous.row;setOpen(previous.row,cancelled?previous.open:previous.offset>=revealWidth/2);}
    if(previous.front.hasPointerCapture(e.pointerId))previous.front.releasePointerCapture(e.pointerId);
  }
  document.addEventListener('pointerup',function(e){endDrag(e,false);});
  document.addEventListener('pointercancel',function(e){endDrag(e,true);});

  document.addEventListener('click',function(e){
    if(ignoreClick&&ignoreClick.contains(e.target)&&e.detail>0){ignoreClick=null;e.preventDefault();e.stopPropagation();return;}
    if(!e.target.closest('.resume-swipe')&&!e.target.closest('.modal'))closeRows();
  },true);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!document.querySelector('.modal')){var row=e.target.closest('.resume-swipe');if(row&&row.classList.contains('is-open'))setOpen(row,false,true);else closeRows();}});
  window.Dashboard = { render: render, handle:handle };
}());
