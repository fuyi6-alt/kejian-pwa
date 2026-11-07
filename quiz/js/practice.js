(function () {
  'use strict';
  var clockStart=0, clockSession=null, selecting=false;
  var chapterFilter='all', chapterPage=1;
  function summary(cid) {
    var state=Store.get(), ids=Object.keys(state.questions).filter(function(id){return state.questions[id].chapterId===cid;});
    var practiced=0,attempts=0,correct=0;
    ids.forEach(function(id){var q=state.questions[id];if(q.attempts>0)practiced++;attempts+=q.attempts||0;correct+=q.correctCount||0;});
    return {practiced:practiced,attempts:attempts,correct:correct,rate:UI.pct(correct,attempts)};
  }
  function chapters() {
    var chapters=Bank.index().chapters;
    var filtered=chapters.filter(function(c){var s=summary(c.id),total=c.mcqCount+c.shortCount;return chapterFilter==='all'||(chapterFilter==='unfinished'&&s.practiced<total)||(chapterFilter==='weak'&&s.attempts>=5&&s.correct/s.attempts<0.6);});
    var pages=Math.max(1,Math.ceil(filtered.length/12));chapterPage=Math.min(chapterPage,pages);var list=filtered.slice((chapterPage-1)*12,chapterPage*12);
    return UI.header('CHAPTER PRACTICE','按章节，逐个掌握','先复习到期题，再练未做题，最后巩固易错题。每一次作答都会立即保存。')+
      '<button class="random-banner" data-action="setup-random"><span class="banner-icon">'+UI.icon('shuffle')+'</span><span><strong>随机混合刷题</strong><small>从全库抽取 · 自选题型与题量</small></span>'+UI.icon('arrow')+'</button>'+
      '<div class="section-head"><h2>章节目录 <span class="count">'+chapters.length+'</span></h2><span class="caption">沿用源题库章节 / 作业名称</span></div>'+
      '<div class="segmented" aria-label="章节筛选">'+[['all','全部'],['unfinished','未练完'],['weak','薄弱章节']].map(function(x){return UI.button(x[1],'chapter-filter',chapterFilter===x[0]?'selected':'','data-filter="'+x[0]+'" aria-pressed="'+(chapterFilter===x[0])+'"');}).join('')+'</div>'+
      (chapterFilter==='weak'?'<p class="caption">薄弱：该章作答 ≥5 次，正确率 &lt;60%。</p>':'')+
      '<div class="chapter-grid">'+list.map(function(c){var s=summary(c.id),total=c.mcqCount+c.shortCount;return '<article class="chapter-card"><div class="chapter-number">'+UI.esc(c.id.replace('ch',''))+'</div><div class="chapter-body"><h3>'+UI.esc(c.name)+'</h3><p class="caption">单选 '+c.mcqCount+' · 简答 '+c.shortCount+((c.multipleCount||c.fillCount)?' · 另有保留题 '+((c.multipleCount||0)+(c.fillCount||0)):'')+'</p><div class="progress-track"><span style="width:'+Math.min(100,UI.pct(s.practiced,total))+'%"></span></div><div class="chapter-meta"><span>已练 '+s.practiced+'/'+total+' <small>去重</small></span><span>正确率 '+(s.attempts?s.rate+'%':'—')+'</span></div>'+UI.button('开始练习 '+UI.icon('arrow'),'setup-chapter','subtle-btn','data-id="'+c.id+'"'+(!total?' disabled':''))+'</div></article>';}).join('')+'</div>'+(list.length?'':UI.empty('暂时没有符合条件的章节','继续练习后，这里的进度会自动更新。'))+(pages>1?'<div class="pager">'+UI.button('上一页','chapter-page','outline','data-page="'+(chapterPage-1)+'"'+(chapterPage===1?' disabled':''))+'<span>'+chapterPage+' / '+pages+'</span>'+UI.button('下一页','chapter-page','outline','data-page="'+(chapterPage+1)+'"'+(chapterPage===pages?' disabled':''))+'</div>':'')+'<p class="caption">正确率＝答对次数 ÷ 已计分作答次数；未计分浏览不计入已练。缺答案、多选、填空可在搜索中查看。</p>';
  }
  function setup(cid) {
    var chapter=cid?Bank.chapter(cid):null;
    UI.modal(chapter?chapter.name:'随机混合刷题','<p class="subtle">'+(chapter?'到期题优先，然后未做题，再按错误次数排序；同级随机。':'从全库混合抽题，到期题优先，然后未做题，再按错误次数排序；同级随机。')+'</p><label class="field-label" for="quiz-type">题型</label><select id="quiz-type"><option value="mcq">选择题（单选）</option><option value="short">简答题</option><option value="mixed">混合</option></select><label class="field-label" for="quiz-count">题量</label><select id="quiz-count"><option value="all">全部</option><option value="custom">自定义输入</option></select><div id="quiz-custom-wrap" hidden><label class="field-label" for="quiz-custom-count">输入题量</label><input id="quiz-custom-count" type="number" min="1" step="1" value="20" inputmode="numeric"></div><p class="caption">缺答案选择题只浏览、不计分；简答题按自评记录。题量不足会按实际题量出题。</p>'+(Store.activeSession()?'<p class="notice">开始新练习后，原练习仍保存在本机历史中，可在首页继续。</p>':'')+'<div id="setup-status" role="status"></div>'+UI.button('开始练习','start-quiz','primary full','data-id="'+(cid||'')+'"'));
  }
  function countChange(target) {
    if(target.id!=='quiz-count'&&target.id!=='review-count')return false;
    document.getElementById(target.id.replace('-count','-custom-wrap')).hidden=target.value!=='custom';return true;
  }
  function selectedCount(prefix) {
    if(document.getElementById(prefix+'-count').value==='all')return 'all';
    var input=document.getElementById(prefix+'-custom-count'),n=Number(input.value);
    if(!Number.isSafeInteger(n)||n<1){UI.toast('请输入大于 0 的整数题量。');input.focus();return null;}
    return n;
  }
  function shuffled(items) {var a=items.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),x=a[i];a[i]=a[j];a[j]=x;}return a;}
  function start(cid) {
    if(selecting)return;
    var origin=Store.get(),startHash=location.hash;
    var type=document.getElementById('quiz-type').value,count=selectedCount('quiz');if(count===null)return;
    var status=document.getElementById('setup-status'),button=document.querySelector('[data-action="start-quiz"]');selecting=true;button.disabled=true;status.innerHTML=UI.loading('正在准备题目…');
    var promise=cid?Bank.load(cid).then(function(c){return [c];}):Bank.loadAll(function(n,total){status.textContent='正在加载章节 '+n+' / '+total;});
    return promise.then(function(chapters){
      if(Store.get()!==origin||location.hash!==startHash||!document.contains(status))return;
      var pool=[];chapters.forEach(function(c){if(type!=='short')pool=pool.concat(c.mcq);if(type!=='mcq')pool=pool.concat(c.short);});
      pool=shuffled(pool);
      var byId={};pool.forEach(function(q){byId[q.id]=q;});pool=Store.sortIds(pool.map(function(q){return q.id;})).map(function(id){return byId[id];});
      if(!pool.length){status.innerHTML='<p class="notice">本范围没有所选题型，请换一个选项。</p>';return;}
      var requested=count==='all'?pool.length:Number(count),ids=pool.slice(0,requested).map(function(q){return q.id;});
      var s=Store.startSession({ids:ids,mode:cid?'chapter':'random',chapterId:cid||null,label:cid?Bank.chapter(cid).name:'随机混合刷题'});
      if(!s){UI.toast('未能保存练习，请先查看存储提示。');return;}
      UI.closeModal();App.go('/quiz');if(ids.length<requested)UI.toast('本范围仅有 '+ids.length+' 题，已按实际题量开始。');
    }).catch(function(e){if(Store.get()===origin&&document.contains(status))status.innerHTML='<p class="notice danger">'+UI.esc(e.message)+'</p>';}).then(function(){selecting=false;if(document.contains(button))button.disabled=false;});
  }
  function reviewPage() {
    var due = Store.dueIds();
    return UI.header('SPACED REVIEW','今日复习','按到期日、未做题、错误次数安排复习。') +
      '<section class="card review-start-card"><h2>今日到期 <span id="review-due-count">' + due.length + '</span> 道</h2><p class="caption">到期日 ≤ ' + UI.esc(Store.today()) + ' 的原题，按题目 ID 去重。' + (due.length ? '最早到期的题先出现。' : '今天没有到期题，可以继续练新题和易错题。') + '</p><label class="field-label" for="review-count">本次题量</label><select id="review-count"><option value="all">全部</option><option value="custom">自定义输入</option></select><div id="review-custom-wrap" hidden><label class="field-label" for="review-custom-count">输入题量</label><input id="review-custom-count" type="number" min="1" step="1" value="20" inputmode="numeric"></div><p class="caption">队列先放到期题，再放未做题，最后按错误次数降序；只纳入可判分单选与简答自评题。简答原答案保持空缺。</p><div id="review-status" role="status"></div>' + UI.button('开始复习','start-review','primary full') + '</section>';
  }
  function startReview() {
    if(selecting)return;
    var count=selectedCount('review');if(count===null)return;var status=document.getElementById('review-status'),button=document.querySelector('[data-action="start-review"]');
    selecting=true;button.disabled=true;status.innerHTML=UI.loading('正在准备复习队列…');
    var startHash=location.hash,origin=Store.get();
    return Bank.loadAll(function(n,total){if(document.contains(status))status.textContent='已加载 '+n+' / '+total+' 章';}).then(function(){
      if(Store.get()!==origin||location.hash!==startHash||!document.contains(status))return;
      var pool=Bank.all().filter(function(q){return q.type==='short'||Bank.gradable(q);});
      var ids=Store.sortIds(shuffled(pool).map(function(q){return q.id;}));
      if(count!=='all')ids=ids.slice(0,Number(count));
      if(!ids.length){status.textContent='暂无可进入复习队列的题目。';return;}
      return startIds(ids,'间隔复习');
    }).catch(function(e){if(document.contains(status))status.innerHTML='<p class="notice danger">'+UI.esc(e.message)+'</p>';}).then(function(){selecting=false;if(document.contains(button))button.disabled=false;});
  }
  function addToQueue(id) {
    var origin=Store.get();
    return Bank.get(id).then(function(q){
      if(Store.get()!==origin)return;
      if(q.type!=='mcq'&&q.type!=='short')throw new Error('此题型保留详情浏览，不加入单选或简答练习队列。');
      var s=Store.activeSession();
      if(!s)return startIds([id],'从题目详情开始');
      if(s.ids.indexOf(id)!==-1){UI.toast('此题已在当前练习队列中，可从首页继续。');return;}
      s.ids.push(id);if(!Store.setSession(s))throw new Error('队列未保存，请查看存储提示。');
      UI.toast('已加入当前练习队列，可从首页继续。');
    });
  }
  function startIds(ids,label) {
    if(!ids.length){UI.toast('没有可重练的题目。');return;}
    var s=Store.startSession({ids:ids,mode:'review',chapterId:null,label:label||'错题重练'});if(s)App.go('/quiz');
  }
  function pause() {
    if(!clockStart||!clockSession)return;
    var s=Store.get().sessions[clockSession];
    if(s&&s.status==='active'){s.elapsedMs=(s.elapsedMs||0)+Math.max(0,Date.now()-clockStart);Store.setSession(s);}
    clockStart=0;clockSession=null;
  }
  function tick(s) {if(clockSession===s.id&&clockStart)return;clockSession=s.id;clockStart=Date.now();}
  function presentation(s,q) {s.presentation=s.presentation||{};s.presentation[q.id]=s.presentation[q.id]||{mode:'read',revealed:false,checks:[]};return s.presentation[q.id];}
  function points(q) {
    if(!q.answer||typeof q.answer!=='string')return [];
    // 完整匹配序号后再分点，防止把“12.”拆成两点、把“1.5 cm”当序号。
    var numbered= /(?:[（(][0-9一二三四五六七八九十百]+[）)]|[0-9一二三四五六七八九十百]+[、．.](?![0-9])|[①②③④⑤⑥⑦⑧⑨⑩])/g;
    var parts=q.answer.replace(/\r\n/g,'\n').replace(numbered,'\n$&').split(/\n+/).map(function(p){return p.trim();}).filter(Boolean);
    return parts.length?parts:[q.answer];
  }
  function quiz() {
    var origin=Store.get(),s=Store.activeSession();if(!s)return Promise.resolve(UI.header('PRACTICE','开始一次练习','')+UI.empty('暂无进行中的练习','先选择一个章节，或从全库随机抽题。','<a class="btn primary" href="#/chapters">选择章节</a>'));
    var qid=s.ids[s.index];return Bank.get(qid).then(function(q){
      if(Store.get()!==origin)return UI.loading('学习记录已切换…');
      if(q.type!=='mcq'&&q.type!=='short')throw new Error('此题型仅支持详情浏览，不进入单选或简答训练。');
      if(location.hash==='#/quiz')tick(s);var a=s.answers[q.id],p=presentation(s,q),chapter=Bank.chapter(q.chapterId);
      var html='<div class="quiz-top"><div><span class="eyebrow">'+UI.esc(s.label)+'</span><h1>第 '+(s.index+1)+' <span class="subtle">/ '+s.ids.length+' 题</span></h1></div>'+UI.button(UI.icon('close')+'退出并保存','exit-quiz','quiet')+'</div><div class="progress-track quiz-progress"><span style="width:'+((s.index+(a?1:0))/s.ids.length*100)+'%"></span></div>'+
        '<article class="question-card"><div class="question-meta">'+UI.badge(q)+'<span class="caption">'+UI.esc(chapter.name)+'</span></div><h2 class="question-stem preserve">'+UI.esc(q.stem)+'</h2>'+UI.assets(q);
      if(q.type==='mcq') {
        html+='<div class="choices">'+q.options.map(function(o){var cls='',note='';if(a&&Bank.gradable(q)){if(o.key===q.answer){cls=' is-correct';note='<span class="choice-note">'+UI.icon('check')+'正确答案</span>';}else if(o.key===a.value){cls=' is-wrong';note='<span class="choice-note">'+UI.icon('close')+'你的选择</span>';}}return '<button type="button" class="choice'+cls+'" data-action="choose" data-key="'+UI.esc(o.key)+'" '+(a||!Bank.gradable(q)?'disabled':'')+'><span class="choice-key">'+UI.esc(o.key)+'</span><span class="choice-text preserve">'+UI.esc(o.text)+'</span>'+note+'</button>';}).join('')+'</div>';
        if(!Bank.gradable(q))html+='<div class="notice amber"><strong>这道题暂不判分</strong><p>原题库未提供可用答案。保留题目供浏览，不计入答题次数与正确率。</p></div>';
        if(a&&Bank.gradable(q))html+='<section class="feedback '+(a.correct?'success':'incorrect')+'" aria-live="polite"><h3>'+UI.icon(a.correct?'check':'close')+(a.correct?'回答正确':'这道题再记一下')+'</h3><p class="preserve">'+UI.esc(UI.answer(q))+'</p>'+UI.explanation(q)+'</section>';
        if(a&&a.correct)html+='<div class="answer-actions">'+UI.button(a.uncertain?'已标记待巩固':'不确定（蒙的）','uncertain','outline','data-id="'+q.id+'"'+(a.uncertain?' disabled':''))+UI.button('标记具体选项','option-panel','quiet','data-id="'+q.id+'"')+'</div>';
        if(a&&!a.correct)html+=UI.button('查看 / 补充选项标记','option-panel','outline','data-id="'+q.id+'"');
      } else {
        html+='<div class="segmented short-mode">'+[['read','背题模式'],['write','默写模式']].map(function(x){return UI.button(x[1],'short-mode',p.mode===x[0]?'selected':'','data-mode="'+x[0]+'" aria-pressed="'+(p.mode===x[0])+'"');}).join('')+'</div>';
        if(p.mode==='write')html+='<label class="field-label" for="short-draft">我的默写草稿 <span class="caption">输入后自动暂存本机</span></label><textarea id="short-draft" rows="7" placeholder="先写下你记得的内容，不需要提交。">'+UI.esc((Store.get().questions[q.id]||{}).draft||'')+'</textarea><p id="draft-status" class="caption" aria-live="polite">草稿只保存在当前浏览器。</p>';
        html+=UI.button(p.revealed?'收起参考答案':'查看参考答案','reveal','outline full');
        if(p.revealed){var list=points(q);html+='<div class="short-answer"><h3>参考答案</h3><p class="preserve">'+UI.esc(UI.answer(q))+'</p>'+UI.explanation(q);
          if(list.length)html+='<h3>对照采分点</h3><p class="caption">按原答案换行 / 序号切分；参考得分仅反映勾选比例。</p><div class="checkpoints">'+list.map(function(pt,i){return '<label class="checkpoint"><input type="checkbox" data-point="'+i+'" '+(p.checks.indexOf(i)>=0?'checked':'')+' '+(a?'disabled':'')+'><span class="preserve">'+UI.esc(pt)+'</span></label>';}).join('')+'</div><p class="score-label">参考得分：'+UI.pct(p.checks.length,list.length)+'%（'+p.checks.length+'/'+list.length+'）</p>';
          else html+='<p class="notice amber">暂无参考答案和采分点；本题只记录自评，不提供参考得分。</p>';
          html+='</div><div class="rating-row">'+[['会','已掌握这次内容'],['模糊','还不够确定'],['不会','需要再学一次']].map(function(x){return UI.button('<strong>'+x[0]+'</strong><small>'+x[1]+'</small>','rate',a&&a.rating===x[0]?'selected':'','data-rating="'+x[0]+'"'+(a?' disabled':''));}).join('')+'</div>';
        }
        if(a)html+='<p class="notice '+(a.correct?'success':'amber')+'">本次自评：'+UI.esc(a.rating)+(a.correct?'。':'，已加入错题本。')+'</p>';
      }
      if(a){var plan=Store.get().questions[q.id]||{};html+='<p class="review-plan caption">复习档位 '+(plan.box||1)+' / 5 · 下次到期 '+UI.esc(plan.dueAt||'尚未安排')+'（按本机日历日期）</p>';}
      html+='<div class="question-tools">'+UI.button(UI.icon('wrong')+'加入错题','add-wrong','quiet','data-id="'+q.id+'"')+UI.button(UI.icon('flag')+'题目报错','report','quiet','data-id="'+q.id+'"')+'<span class="caption">'+UI.esc(q.sourceId||q.id)+'</span></div></article>';
      html+='<div class="quiz-footer"><span class="caption">'+(q.type==='mcq'?'键盘 1–5 选择 · Enter 下一题':'完成自评后可进入下一题')+'</span>'+UI.button(s.index===s.ids.length-1?'完成练习 '+UI.icon('check'):'下一题 '+UI.icon('arrow'),'next','primary',(!a&&!(q.type==='mcq'&&!Bank.gradable(q))?'disabled':''))+'</div>';return html;
    });
  }
  function current() {var s=Store.activeSession();if(!s)return null;return {s:s,q:Bank.peek(s.ids[s.index])};}
  function choose(key) {
    var c=current();if(!c||!c.q||c.q.type!=='mcq'||c.s.answers[c.q.id]||!Bank.gradable(c.q))return;
    var origin=Store.get();
    if(!c.q.options.some(function(o){return o.key===key;}))return;
    var correct=key===c.q.answer;
    // 错选项和会话答案先一并落盘；弹窗只负责追加标记。
    var saved=Store.recordAnswer(c.q,{value:key,correct:correct,sessionId:c.s.id,attemptId:c.s.id+':'+c.q.id,mode:c.s.mode});
    if(!saved)return;
    App.render().then(function(){if(!correct&&Store.get()===origin&&Store.activeSession()===c.s&&location.hash==='#/quiz')optionPanel(c.q.id);});
  }
  function optionPanel(qid) {
    var origin=Store.get(),startHash=location.hash;
    return Bank.get(qid).then(function(q){if(Store.get()!==origin||location.hash!==startHash)return;var marks=Store.get().options;
      UI.modal('标记不熟悉的选项','<h3 class="option-panel-stem preserve">'+UI.esc(q.stem)+'</h3>'+UI.assets(q)+'<p class="notice">跳过将清除本题手动追加的标记，保留系统记录的错选项。</p><div class="option-mark-list">'+q.options.map(function(o){var m=marks[q.id+':'+o.key],auto=m&&m.autoRecorded,checked=m&&(m.active||auto);return '<label class="checkpoint '+(auto?'auto-mark':'')+'"><input type="checkbox" name="option-mark" value="'+UI.esc(o.key)+'" '+(checked?'checked':'')+' '+(auto?'disabled':'')+'><span><strong>'+UI.esc(o.key)+'.</strong> '+UI.esc(o.text)+(auto?'<small>选错项 · 系统自动记录，不能取消</small>':'')+'</span></label>';}).join('')+'</div><div class="modal-actions">'+UI.button('跳过，不补充','skip-options','quiet','data-id="'+q.id+'"')+UI.button('保存追加标记','save-options','primary','data-id="'+q.id+'"')+'</div>');
    });
  }
  function saveOptions(qid,skip) {
    var keys=skip?[]:Array.prototype.slice.call(document.querySelectorAll('input[name="option-mark"]:checked')).map(function(el){return el.value;});
    if(!Store.markOptions(qid,keys)){UI.toast('保存失败，请查看存储提示。');return;}
    UI.closeModal();App.render();UI.toast(skip?'已清除追加标记，保留错选项':'选项记录已保存');
  }
  function uncertain() {var c=current();if(!c||!c.q||!c.s.answers[c.q.id]||!c.s.answers[c.q.id].correct||c.s.answers[c.q.id].uncertain)return;var origin=Store.get(),r=Store.markUncertain(c.q);if(!r)return;c.s.answers[c.q.id].uncertain=true;Store.setSession(c.s);App.render().then(function(){if(Store.get()===origin&&Store.activeSession()===c.s&&location.hash==='#/quiz')optionPanel(c.q.id);});}
  function next() {
    var c=current();if(!c||!c.q)return;
    if(!c.s.answers[c.q.id]){if(c.q.type!=='mcq'||Bank.gradable(c.q))return;c.s.answers[c.q.id]={correct:null,value:null,rating:null,ratio:null,browsed:true,answeredAt:new Date().toISOString()};}
    pause();if(c.s.index>=c.s.ids.length-1){if(Store.finishSession(c.s))App.go('/result');else UI.toast('结果未能保存，请查看存储提示。');}else{c.s.index++;if(Store.setSession(c.s)){App.render();window.scrollTo(0,0);}else UI.toast('进度未能保存，请查看存储提示。');}
  }
  function rate(rating) {var c=current();if(!c||c.q.type!=='short'||c.s.answers[c.q.id])return;var p=presentation(c.s,c.q);if(!p.revealed)return;var list=points(c.q),ratio=list.length?p.checks.length/list.length:null;var r=Store.recordAnswer(c.q,{value:rating,correct:rating==='会',rating:rating,ratio:ratio,mode:c.s.mode,sessionId:c.s.id,attemptId:c.s.id+':'+c.q.id});if(r)App.render();}
  function changeMode(mode) {var c=current();if(!c)return;presentation(c.s,c.q).mode=mode;Store.setSession(c.s);App.render();}
  function reveal() {var c=current();if(!c)return;var p=presentation(c.s,c.q);p.revealed=!p.revealed;Store.setSession(c.s);App.render();}
  function checkpoint(i,checked) {var c=current();if(!c||c.s.answers[c.q.id])return;var p=presentation(c.s,c.q);p.checks=p.checks.filter(function(x){return x!==i;});if(checked)p.checks.push(i);Store.setSession(c.s);var label=document.querySelector('.score-label'),list=points(c.q);if(label)label.textContent='参考得分：'+UI.pct(p.checks.length,list.length)+'%（'+p.checks.length+'/'+list.length+'）';}
  function draft(text) {var c=current();if(!c)return;Store.draft(c.q.id,text);var label=document.getElementById('draft-status');if(label)label.textContent=Store.lastSaveOk?'草稿已自动保存到本机':'草稿保存失败，请复制草稿并查看顶部存储提示。';}
  function result() {
    var s=Store.get().sessions[Store.get().lastResultSessionId];if(!s)return Promise.resolve(UI.empty('还没有练习结果','完成一组练习后，就能看到本次回顾。','<a class="btn primary" href="#/chapters">开始练习</a>'));
    var entries=Object.keys(s.answers).map(function(id){return s.answers[id];}),graded=entries.filter(function(a){return typeof a.correct==='boolean';}),right=graded.filter(function(a){return a.correct;}).length,wrongIds=Object.keys(s.answers).filter(function(id){return s.answers[id].correct===false;});
    return Promise.all(wrongIds.map(Bank.get)).then(function(wrong){return UI.header('SESSION COMPLETE','这一次，离掌握更近了','练习记录已保存在当前浏览器。')+'<section class="result-hero"><div class="result-circle"><strong>'+(graded.length?UI.pct(right,graded.length)+'%':'—')+'</strong><span>本次正确率</span></div><div><h2>'+UI.esc(s.label)+'</h2><p>每一道回顾，都是下一次的把握。</p><div class="result-metrics"><div><strong>'+entries.length+'</strong><small>浏览 / 作答题数</small></div><div><strong>'+right+' / '+graded.length+'</strong><small>答对 / 已计分</small></div><div><strong>'+UI.duration(s.elapsedMs)+'</strong><small>练习用时</small></div></div></div></section><p class="caption">正确率＝答对次数 ÷ 本次已计分作答次数；无答案浏览不计分，简答“会”按答对统计。参考答案判分仍待核对。</p><div class="section-head"><h2>本次错题 <span class="count">'+wrong.length+'</span></h2>'+UI.button('重练本次错题','retry-result','outline',wrong.length?'':'disabled')+'</div>'+wrong.map(function(q){return '<a class="question-row" href="#/question/'+encodeURIComponent(q.id)+'"><div>'+UI.badge(q)+'<h3>'+UI.esc(q.stem)+'</h3><p class="caption">你的答案：'+UI.esc(s.answers[q.id].value)+' · '+UI.esc(Bank.chapter(q.chapterId).name)+'</p></div>'+UI.icon('arrow')+'</a>';}).join('')+(wrong.length?'':UI.empty('本次没有记录错题','可以换一章继续练习，也可以休息一下。'))+AIUI.result(s)+'<div class="actions"><a class="btn primary" href="#/home">返回首页</a><a class="btn outline" href="#/chapters">再练一组</a></div>';});
  }
  setInterval(function(){if(clockStart){var s=Store.get().sessions[clockSession];pause();if(s&&s.status==='active'&&location.hash==='#/quiz')tick(s);}},15000);
  window.addEventListener('pagehide',pause);
  document.addEventListener('visibilitychange',function(){if(document.hidden)pause();else if(location.hash==='#/quiz'){var s=Store.activeSession();if(s)tick(s);}});
  window.Practice={countChange:countChange,reviewPage:reviewPage,startReview:startReview,addToQueue:addToQueue,chapters:chapters,summary:summary,setup:setup,start:start,startIds:startIds,quiz:quiz,choose:choose,next:next,rate:rate,changeMode:changeMode,reveal:reveal,checkpoint:checkpoint,draft:draft,pause:pause,result:result,optionPanel:optionPanel,saveOptions:saveOptions,uncertain:uncertain,current:current,points:points,setFilter:function(f){chapterFilter=f;chapterPage=1;},setPage:function(p){chapterPage=Math.max(1,p);}};
}());
