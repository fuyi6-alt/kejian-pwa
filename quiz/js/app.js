(function () {
  'use strict';
  var routeToken=0,searchPage=1,searchTimer,versionTimer;
  var searchState={query:'',chapter:'all',type:'all'},searchReady=false;
  var main=document.getElementById('main');
  function go(path) {var hash='#'+path;if(location.hash===hash)render();else location.hash=hash;}
  function notices() {document.getElementById('test-notice').innerHTML=Store.isTestMode()?'<div class="test-banner"><div><strong>正在使用测试副本</strong><p>模拟日期 '+Store.today()+' · 真实学习记录未改动</p></div>'+UI.button('退出测试','debug-exit','outline')+'</div>':'';document.getElementById('storage-notices').innerHTML=Store.notices.map(function(n){return '<p class="notice '+(n.blocking?'danger':'amber')+'">'+UI.esc(n.message)+'</p>';}).join('');}
  function totals() { return Stats.summary(); }
  function home() { return Dashboard.render(); }
  function settings() {
    var s=Store.get(),i=Bank.index();
    return UI.header('MY STUDY SPACE','我的','设置学习节奏，管理本机记录。')+'<section class="card appearance-settings"><h2>显示外观</h2><div class="actions"><button type="button" class="btn outline" data-theme-choice="light">浅色模式</button><button type="button" class="btn outline" data-theme-choice="dark">深色模式</button></div><p class="caption">刷题时也可使用页面右上角的按钮切换。</p></section><div class="settings-grid"><section class="card"><h2>学习计划</h2><label class="field-label" for="exam-date">考试日期</label><input type="date" id="exam-date" value="'+UI.esc(s.settings.examDate)+'"><label class="field-label" for="daily-goal">每日目标（作答次数）</label><input type="number" min="1" max="9999" step="1" id="daily-goal" value="'+s.settings.dailyGoal+'"><p class="caption" style="margin-top:10px">每次计分作答均计入目标，同一道题重做也会计数。</p>'+UI.button('保存学习设置','save-settings','primary full')+'</section>'+Backup.panel()+PWA.panel()+'<section class="card"><h2>题库统计</h2><div class="setting-row"><span>源题库全部记录</span><strong>'+i.totalAll+'</strong></div><div class="setting-row"><span>选择题（单选 / 多选）</span><span>'+i.totalChoice+'（'+i.totalMcq+' / '+i.totalMultiple+'）</span></div><div class="setting-row"><span>简答 / 填空</span><span>'+i.totalShort+' / '+i.totalFill+'</span></div><div class="setting-row"><span>原章节 / 作业标签</span><span>'+i.chapters.length+'</span></div><p class="caption">参考答案显著标注“待核对”；无答案选择题只浏览、不计分。原题文本、答案与解析保持不变。</p></section><section class="card"><h2>题目报错 <span class="count">'+s.issues.length+'</span></h2><p class="caption">仅记录到本机，不会向外发送。</p>'+(s.issues.length?'<ul class="issue-list">'+s.issues.slice().reverse().slice(0,20).map(function(x){return '<li><a href="#/'+(s.generated&&s.generated[x.qid]?'wrong/generated/':'question/')+encodeURIComponent(x.qid)+'">'+UI.esc(x.qid)+'</a><p>'+UI.esc(x.reason)+'</p></li>';}).join('')+'</ul>'+(s.issues.length>20?'<p class="caption">仅显示最近 20 条，全部记录仍保存在本机。</p>':''):'<p class="subtle">暂未记录问题。发现题干或答案疑问时，可在题目页点击“报错”。</p>')+'</section>'+AIUI.settings()+'</div><button class="version" id="version-button" aria-label="版本 0.4.0，长按三秒打开调试页">解剖自习室 v0.4.0 · 阶段 4</button>';
  }
  function search() {
    searchReady=false;
    return UI.header('QUESTION LIBRARY','在题库里，找到那道题','搜索题干、选项或解析，也可按章节与题型筛选。')+'<div class="searchbox">'+UI.icon('search')+'<input id="search-input" type="search" placeholder="输入关键词，如：膈、肾、脑神经" value="'+UI.esc(searchState.query)+'" aria-label="搜索题库"></div><div class="filter-row"><select id="search-chapter" aria-label="筛选章节"><option value="all">全部章节</option>'+Bank.index().chapters.map(function(c){return '<option value="'+c.id+'" '+(searchState.chapter===c.id?'selected':'')+'>'+UI.esc(c.name)+'</option>';}).join('')+'</select><select id="search-type" aria-label="筛选题型">'+[['all','全部题型'],['mcq','单选题'],['short','简答题'],['multiple','多选题（浏览）'],['fill','填空题（浏览）']].map(function(x){return '<option value="'+x[0]+'" '+(searchState.type===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></div><p id="search-progress" class="caption" role="status">准备加载全库…</p><div id="search-results">'+UI.loading('正在加载全库…')+'</div>';
  }
  function loadSearch(token) {
    Bank.loadAll(function(n,total){if(token!==routeToken)return;var p=document.getElementById('search-progress');if(p)p.textContent='已加载 '+n+' / '+total+' 章（'+UI.pct(n,total)+'%）';}).then(function(){if(token!==routeToken)return;searchReady=true;renderSearch();}).catch(function(e){if(token!==routeToken)return;document.getElementById('search-results').innerHTML=UI.error(e);});
  }
  function highlight(text,needle) {if(!needle)return UI.esc(text);var lower=String(text).toLowerCase(),n=needle.toLowerCase(),out='',offset=0,index;while((index=lower.indexOf(n,offset))!==-1){out+=UI.esc(String(text).slice(offset,index))+'<mark>'+UI.esc(String(text).slice(index,index+n.length))+'</mark>';offset=index+n.length;}return out+UI.esc(String(text).slice(offset));}
  function renderSearch() {
    if(!searchReady||!document.getElementById('search-results'))return;
    var needle=searchState.query.trim(),lower=needle.toLowerCase(),filtered=Bank.all().filter(function(q){return (searchState.chapter==='all'||q.chapterId===searchState.chapter)&&(searchState.type==='all'||q.type===searchState.type)&&(!lower||[q.stem,q.explanation,q.sourceExplanation].concat(q.options.map(function(o){return o.text;})).join('\n').toLowerCase().indexOf(lower)>=0);}),pages=Math.max(1,Math.ceil(filtered.length/20));searchPage=Math.min(searchPage,pages);
    document.getElementById('search-progress').textContent='已加载 '+Bank.index().chapters.length+' / '+Bank.index().chapters.length+' 章 · 找到 '+filtered.length+' 题 · 每页 20 题';
    document.getElementById('search-results').innerHTML=filtered.slice((searchPage-1)*20,searchPage*20).map(function(q){var secondary='';if(lower&&q.stem.toLowerCase().indexOf(lower)<0){secondary=q.options.map(function(o){return o.key+'. '+o.text;}).concat([q.explanation||'',q.sourceExplanation||'']).filter(function(t){return t.toLowerCase().indexOf(lower)>=0;})[0]||'';}return '<a class="question-row" href="#/question/'+encodeURIComponent(q.id)+'"><div>'+UI.badge(q)+'<h3>'+highlight(q.stem,needle)+'</h3>'+(secondary?'<p class="caption preserve">'+highlight(secondary.slice(Math.max(0,secondary.toLowerCase().indexOf(lower)-60),Math.max(0,secondary.toLowerCase().indexOf(lower)-60)+240),needle)+'</p>':'')+'<p class="caption">'+UI.esc(Bank.chapter(q.chapterId).name)+'</p></div>'+UI.icon('arrow')+'</a>';}).join('')+(filtered.length?'<div class="pager">'+UI.button('上一页','search-page','outline','data-page="'+(searchPage-1)+'"'+(searchPage===1?' disabled':''))+'<span>'+searchPage+' / '+pages+'</span>'+UI.button('下一页','search-page','outline','data-page="'+(searchPage+1)+'"'+(searchPage===pages?' disabled':''))+'</div>':UI.empty('没有找到匹配题目','试着缩短关键词，或切换章节和题型。'));
  }
  function placeholder(title,description) {return UI.header('COMING LATER',title,'阶段 1 · 入口已保留')+UI.empty('将在后续阶段开放',description,'<a class="btn primary" href="#/chapters">先做章节练习</a>');}
  function tabs(path) {var active=path==='/home'?'home':path==='/chapters'||path==='/quiz'||path==='/review'?'chapters':path.indexOf('/wrong')===0?'wrong':path==='/stats'?'stats':path==='/settings'||path==='/debug'?'settings':'';document.getElementById('tabs').innerHTML=[['home','home','首页'],['chapters','book','专项'],['wrong','wrong','错题'],['stats','chart','统计'],['settings','settings','我的']].map(function(x){return '<a href="#/'+x[0]+'" class="'+(active===x[0]?'active':'')+'" '+(active===x[0]?'aria-current="page"':'')+'>'+UI.icon(x[1])+'<span>'+x[2]+'</span></a>';}).join('');}
  function render() {
    // 路由切换可能早于章节加载完成，用序号避免旧请求覆盖新页面。
    Practice.pause();var token=++routeToken;UI.closeModal();notices();var raw=(location.hash||'#/home').slice(1),path=raw.split('?')[0];tabs(path);main.innerHTML=UI.loading();
    var content;
    try {
      if(path==='/home')content=home();else if(path==='/chapters')content=Practice.chapters();else if(path==='/quiz')content=Practice.quiz();else if(path==='/wrong')content=Review.render();else if(path.indexOf('/wrong/group/')===0)content=ReviewLab.groupPage(decodeURIComponent(path.slice(13)));else if(path==='/wrong/options')content=ReviewLab.optionsPage();else if(path==='/wrong/generated')content=ReviewLab.generatedPage();else if(path.indexOf('/wrong/generated/')===0)content=ReviewLab.generatedDetail(decodeURIComponent(path.slice(17)));else if(path==='/wrong/exam')content=ReviewLab.tabs('exam')+Exam.render('wrong');else if(path==='/stats')content=Stats.render();else if(path==='/settings')content=settings();else if(path==='/result')content=Practice.result();else if(path==='/search')content=search();else if(path==='/exam')content=Exam.render('all');else if(path==='/exam/quiz')content=Exam.quiz();else if(path==='/exam/grade')content=Exam.grade();else if(path==='/exam/history')content=Exam.history();else if(path.indexOf('/exam/result/')===0)content=Exam.result(decodeURIComponent(path.slice(13)));else if(path==='/review')content=Practice.reviewPage();else if(path==='/debug')content=Debug.render();else if(path.indexOf('/question/')===0)content=Review.detail(decodeURIComponent(path.slice(10)));else content=UI.empty('没有找到这个页面','请通过底部导航继续。','<a class="btn primary" href="#/home">返回首页</a>');
    } catch(e){content=UI.error(e);}
    return Promise.resolve(content).then(function(html){if(token!==routeToken)return;main.innerHTML=html;Theme.syncControls();notices();Exam.onRoute(path);if(path==='/search')loadSearch(token);}).catch(function(e){if(token===routeToken)main.innerHTML=UI.error(e);});
  }
  function report(id) {UI.modal('记录题目问题','<p class="caption">原题不会被修改；问题只保存在本机报错清单。</p><label class="field-label" for="issue-reason">你发现的问题</label><textarea id="issue-reason" rows="4" maxlength="1000" placeholder="例如：答案疑似有误、原图不清楚…"></textarea>'+UI.button('保存报错','save-issue','primary full','data-id="'+UI.esc(id)+'"'));}
  function action(el) {
    var a=el.getAttribute('data-action'),id=el.getAttribute('data-id');
    if(a.indexOf('backup-')===0)return Backup.handle(a,el);
    if(a.indexOf('pwa-')===0)return PWA.handle(a,el);
    if(a.indexOf('resume-')===0)return Dashboard.handle(a,el);
    if(a.indexOf('ai-')===0)return AIUI.handle(a,el);
    if(a.indexOf('lab-')===0)return ReviewLab.handle(a,el);
    if(a.indexOf('debug-')===0)return Debug.handle(a,el);
    if(a.indexOf('exam-')===0)return Exam.handle(a,el);
    if(a==='start-review')return Practice.startReview();
    if(a==='queue-question')return Practice.addToQueue(id);
    if(a==='close-modal')return UI.closeModal();
    if(a==='retry')return render();
    if(a==='setup-chapter')return Practice.setup(id);
    if(a==='setup-random')return Practice.setup(null);
    if(a==='start-quiz')return Practice.start(id||null);
    if(a==='chapter-filter'){Practice.setFilter(el.getAttribute('data-filter'));return render();}
    if(a==='chapter-page'){Practice.setPage(Number(el.getAttribute('data-page')));return render();}
    if(a==='choose')return Practice.choose(el.getAttribute('data-key'));
    if(a==='next')return Practice.next();
    if(a==='exit-quiz'){Practice.pause();go('/home');UI.toast(Store.lastSaveOk?'练习进度已保存，可在首页继续。':'进度未保存，请查看存储提示。');return;}
    if(a==='short-mode')return Practice.changeMode(el.getAttribute('data-mode'));
    if(a==='reveal')return Practice.reveal();
    if(a==='rate')return Practice.rate(el.getAttribute('data-rating'));
    if(a==='uncertain')return Practice.uncertain();
    if(a==='option-panel')return Practice.optionPanel(id);
    if(a==='skip-options')return Practice.saveOptions(id,true);
    if(a==='save-options')return Practice.saveOptions(id);
    if(a==='report')return report(id);
    if(a==='save-issue'){var reason=document.getElementById('issue-reason').value.trim();if(!reason){UI.toast('请简要填写问题。');return;}Store.issue(id,reason);UI.closeModal();notices();UI.toast(Store.lastSaveOk?'问题已记录在本机。':'未能保存，请查看存储提示。');return;}
    if(a==='add-wrong')return Bank.get(id).then(function(q){Store.addWrong(q);UI.toast(Store.lastSaveOk?'已加入错题本。':'未能保存，请查看存储提示。');if(location.hash.indexOf('#/question/')===0)render();else notices();});
    if(a==='manual-master'){Store.setMastered(id,true);UI.toast(Store.lastSaveOk?'已标记掌握，历史记录仍可找回。':'未能保存。');return render();}
    if(a==='restore-wrong'){Store.setMastered(id,false);return render();}
    if(a==='consolidate'){Store.setConsolidated(id);return render();}
    if(a==='redo-question')return Practice.startIds([id],'单题重练');
    if(a==='retry-wrong')return Practice.startIds(Review.retryIds(),'错题复练');
    if(a==='wrong-page'){Review.setPage(Number(el.getAttribute('data-page')));return render();}
    if(a==='retry-result'){var s=Store.get().sessions[Store.get().lastResultSessionId];if(s)return Practice.startIds(Object.keys(s.answers).filter(function(qid){return s.answers[qid].correct===false;}),'本次错题重练');return;}
    if(a==='resume'){var session=Store.get().sessions[id];if(session&&session.status==='active'){Store.setSession(session);go('/quiz');}return;}
    if(a==='save-settings'){var goal=Number(document.getElementById('daily-goal').value),date=document.getElementById('exam-date').value;if(!Number.isInteger(goal)||goal<1||goal>9999){UI.toast('每日目标请输入 1–9999 的整数。');return;}Store.setSettings({examDate:date,dailyGoal:goal});UI.toast(Store.lastSaveOk?'学习设置已保存。':'未能保存，请查看存储提示。');notices();return;}
    if(a==='future-backup'){UI.toast('导入与导出将在阶段 4 完善。');return;}
    if(a==='search-page'){searchPage=Number(el.getAttribute('data-page'));renderSearch();window.scrollTo(0,0);return;}
  }
  document.addEventListener('click',function(e){var el=e.target.closest('[data-action]');if(!el||el.disabled)return;try{Promise.resolve(action(el)).catch(function(error){UI.toast(error.message||'操作未完成，请重试。');notices();});}catch(error){UI.toast(error.message||'操作未完成，请重试。');notices();}});
  function guardedEvent(handler) { return function(e) { try { Promise.resolve(handler(e)).catch(function(error) { UI.toast(error.message || '操作未完成，请重试。'); notices(); }); } catch(error) { UI.toast(error.message || '操作未完成，请重试。'); notices(); } }; }
  document.addEventListener('input',guardedEvent(function(e){if(Exam.input(e.target))return;if(e.target.id==='short-draft'){Practice.draft(e.target.value);notices();}if(e.target.id==='search-input'){searchState.query=e.target.value;searchPage=1;clearTimeout(searchTimer);searchTimer=setTimeout(renderSearch,300);}}));
  document.addEventListener('change',guardedEvent(function(e){if(Practice.countChange(e.target)||Exam.change(e.target)||Debug.change(e.target)||AIUI.change(e.target)||ReviewLab.change(e.target))return;if(e.target.hasAttribute('data-point'))Practice.checkpoint(Number(e.target.getAttribute('data-point')),e.target.checked);if(e.target.id.indexOf('wrong-')===0){Review.setFilter(e.target.id.slice(6),e.target.value);render();}if(e.target.id==='search-chapter'||e.target.id==='search-type'){searchState[e.target.id.slice(7)]=e.target.value;searchPage=1;renderSearch();}}));
  document.addEventListener('keydown',guardedEvent(function(e){if(Exam.keydown(e))return;if(document.querySelector('.modal')||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||location.hash!=='#/quiz')return;var c=Practice.current();if(!c||!c.q)return;if(/^[1-5]$/.test(e.key)&&c.q.type==='mcq'){e.preventDefault();var opt=c.q.options[Number(e.key)-1];if(opt)Practice.choose(opt.key);}if(e.key==='Enter'&&e.target.tagName!=='BUTTON'&&e.target.tagName!=='A'){e.preventDefault();Practice.next();}}));
  document.addEventListener('pointerdown',function(e){if(e.target.id==='version-button')versionTimer=setTimeout(function(){go('/debug');},3000);});
  ['pointerup','pointercancel','pointerout'].forEach(function(event){document.addEventListener(event,function(){clearTimeout(versionTimer);});});
  function route(){if(location.hash.indexOf('#/wrong?state=uncertain')===0)Review.setFilter('state','uncertain');render();window.scrollTo(0,0);}
  window.addEventListener('hashchange',route);
  ['online','offline'].forEach(function(event){window.addEventListener(event,function(){if(location.hash.indexOf('#/wrong')===0||location.hash.indexOf('#/question/')===0)render();});});
  window.App={render:render,go:go,totals:totals};
  Store.onNotice=notices;Store.init();if(!location.hash)location.hash='#/home';else route();
}());
