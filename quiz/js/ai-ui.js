(function () {
  'use strict';
  var consentResolve=null, diagnosisBusy={}, batchBusy=false;
  function attr(id){return 'data-id="'+UI.esc(id)+'"';}
  function stats(){return Store.get().aiStats||{calls:0,successes:0,failures:0,assemblyAttempts:0,assemblyAccepted:0};}
  function settings(){
    if(Store.isTestMode&&Store.isTestMode())return '<section class="card"><h2>AI 设置</h2><p>测试模式禁止真实 AI 请求，不读取或更改真实凭据与诊断缓存。退出测试后恢复。</p></section>';
    var c=AI.config(),saved=AI.secretStatus(),s=stats();
    return '<section class="card ai-settings" id="ai-settings"><h2>AI 学习助手</h2><p class="caption">只有点击诊断、润色或测试连接才会发送请求。基础刷题不依赖 AI。</p>'+
      '<label class="checkpoint"><input type="checkbox" id="ai-enabled" '+(c.enabled?'checked':'')+'><span>启用 AI</span></label>'+
      '<label class="field-label" for="ai-mode">接入方式</label><select id="ai-mode"><option value="proxy" '+(c.mode==='proxy'?'selected':'')+'>代理（推荐）</option><option value="direct" '+(c.mode==='direct'?'selected':'')+'>直连（备选）</option></select>'+
      '<div id="ai-direct-fields" '+(c.mode==='proxy'?'hidden':'')+'><label class="field-label" for="ai-key">API Key</label><input type="password" id="ai-key" autocomplete="off" spellcheck="false" placeholder="'+(saved.key?'已保存；留空保留现有 Key':'仅保存在当前浏览器')+'"><p class="caption">'+(saved.key?'已有 Key，内容不回显。':'尚未保存 Key。')+' 直连失败可能受跨域限制，可切换代理。</p>'+UI.button('删除已存 Key','ai-delete-key','quiet',saved.key?'':'disabled')+'</div>'+
      '<div id="ai-proxy-fields" '+(c.mode==='direct'?'hidden':'')+'><label class="field-label" for="ai-proxy-url">代理地址</label><input type="url" id="ai-proxy-url" autocomplete="off" placeholder="https://你的名称.workers.dev" value="'+UI.esc(c.proxyUrl||'')+'"><label class="field-label" for="ai-token">代理令牌（可选）</label><input type="password" id="ai-token" autocomplete="off" spellcheck="false" placeholder="'+(saved.token?'已保存；留空保留现有令牌':'与 Worker 的 PROXY_TOKEN 一致')+'"><p class="caption">代理模式下，Key 只放在 Worker 环境变量。保存代理模式会删除浏览器中原有 Key。</p>'+UI.button('删除已存令牌','ai-delete-token','quiet',saved.token?'':'disabled')+'</div>'+
      '<label class="field-label" for="ai-model">模型名</label><input type="text" id="ai-model" value="'+UI.esc(c.model||'deepseek-chat')+'" maxlength="100" autocomplete="off"><div class="actions">'+UI.button('保存 AI 设置','ai-save','primary')+UI.button('测试连接','ai-test','outline')+'</div><p id="ai-settings-status" class="caption" role="status">先保存设置，再测试连接。未填写 Key 或代理时，诊断使用本地简化内容；错项集中练与模板判断题可用。</p>'+
      '<div class="setting-row"><span>累计调用次数 <small>实际请求，含重试</small></span><strong id="ai-call-count">'+s.calls+'</strong></div><div class="setting-row"><span>诊断缓存条数 <small>上限 300</small></span><strong id="ai-cache-count">'+AI.cacheCount()+'</strong></div><div class="setting-row"><span>历史拼装校验（已停用） <small>历史通过组合 ÷ 尝试组合</small></span><strong>'+s.assemblyAccepted+' / '+s.assemblyAttempts+(s.assemblyAttempts?'（'+UI.pct(s.assemblyAccepted,s.assemblyAttempts)+'%）':'')+'</strong></div>'+UI.button('清空诊断缓存','ai-clear-cache','outline')+'<p class="caption">清缓存只删除诊断结果；已生成题及掌握记录不受影响。Key 和代理令牌不会包含在导出备份中。</p></section>';
  }
  function updateCounters(){var calls=document.getElementById('ai-call-count'),cache=document.getElementById('ai-cache-count');if(calls)calls.textContent=stats().calls;if(cache)cache.textContent=AI.cacheCount();}
  function status(text,bad){var el=document.getElementById('ai-settings-status');if(el){el.textContent=text;el.className='notice '+(bad?'amber':'success');}else UI.toast(text);updateCounters();}
  function currentFields(){return {enabled:document.getElementById('ai-enabled').checked,mode:document.getElementById('ai-mode').value,proxyUrl:document.getElementById('ai-proxy-url').value,model:document.getElementById('ai-model').value};}
  function unsavedSettings(){var el=document.getElementById('ai-enabled');if(!el)return false;var fields=currentFields(),c=AI.config();return fields.enabled!==c.enabled||fields.mode!==c.mode||fields.proxyUrl.trim().replace(/\/+$/,'')!==(c.proxyUrl||'')||fields.model.trim()!==(c.model||'deepseek-chat')||!!document.getElementById('ai-key').value||!!document.getElementById('ai-token').value;}
  function saveSettings(){AI.configure(currentFields(),document.getElementById('ai-key').value,document.getElementById('ai-token').value,false,false);document.getElementById('ai-key').value='';document.getElementById('ai-token').value='';return App.render().then(function(){status('AI 设置已保存。保存设置不会调用 AI。',false);});}
  function ensureConsent(){
    if(AI.config().privacyAccepted)return Promise.resolve(true);
    if(consentResolve)return Promise.resolve(false);
    return new Promise(function(resolve){
      UI.modal('首次使用 AI，请了解这些信息','<p>仅在你主动点击时，会将当前题目的题干、选项、题库答案与解析、你的答案和选项标记发送给 DeepSeek，用于本次分析或生成校验。</p><p>使用代理时，请求也会经过你填写的 Worker。该 Worker 只转发请求，不存学习数据、不记录请求内容。</p><p>其余学习记录只保存在当前浏览器。直连 Key 或代理令牌只用于请求认证，不写入备份；AI 内容可能出错，请以题库原文为准。</p><div class="modal-actions">'+UI.button('取消，本次不调用','close-modal','quiet')+UI.button('了解并继续本次操作','ai-consent','primary')+'</div>');
      consentResolve=resolve;
      UI.onModalClose=function(){var done=consentResolve;consentResolve=null;if(done)done(false);};
    });
  }
  function acceptConsent(){
    if(!Store.setAI({privacyAccepted:true})){UI.toast('未能保存隐私选择，请先处理存储提示。');UI.closeModal();return true;}
    var done=consentResolve;consentResolve=null;UI.onModalClose=null;UI.closeModal();if(done)done(true);return true;
  }
  function busy(el,run){
    if(el&&el.getAttribute('data-busy')==='true')return Promise.resolve(false);
    var old=el?el.textContent:'';if(el){el.setAttribute('data-busy','true');el.disabled=true;el.textContent='正在处理…';}
    return Promise.resolve().then(run).then(function(value){restore();return value;},function(e){restore();throw e;});
    function restore(){if(el){el.removeAttribute('data-busy');el.disabled=false;el.textContent=old;}}
  }
  function connection(el){return busy(el,function(){
    if(unsavedSettings()){status('设置尚未保存，请先点击“保存 AI 设置”，再测试连接。',true);return;}
    var reason=AI.unavailable();if(reason){status(reason+'；本次未调用 AI。请先保存有效配置。',true);return;}
    return ensureConsent().then(function(yes){if(!yes){status('已取消；本次未调用 AI。',true);return;}status('正在测试连接，最长等待 30 秒；临时错误最多重试一次。',false);return AI.request('test',{message:'请返回 {"ok":true}'}).then(function(result){if(result.ok!==true)throw new Error('已收到响应，但测试内容不符合预期。');status('连接成功，可以使用 AI 诊断和润色。',false);}).catch(function(e){status(e.message+' 基础刷题仍可正常使用。',true);});});
  });}
  function detail(q){var enabled=AI.config().enabled,reason=AI.unavailable();return '<section class="card ai-diagnosis"><h3>错题知识点诊断</h3><p class="caption">根据本题、你的作答和已标选项分析。来源题号：'+UI.esc(q.sourceId||q.id)+'</p><div class="actions">'+(enabled?UI.button('AI 诊断','ai-diagnose','primary',attr(q.id))+UI.button('重新分析','ai-reanalyze','outline',attr(q.id)):'')+UI.button('本地简化诊断','ai-local','outline',attr(q.id))+'</div>'+(reason?'<p class="notice amber">'+UI.esc(reason)+'；可以查看本地简化诊断。'+(enabled?'点击 AI 诊断也会安全降级。':'')+'</p>':'<p class="caption">再次诊断会优先读取缓存；“重新分析”会主动重新请求。</p>')+'<div id="ai-diagnosis-result" role="status"></div></section>';}
  function card(q,result){var d=result.data,ai=!result.local;return '<article class="diagnosis-card"><div class="question-meta"><span class="pill '+(ai?'':'pale')+'">'+(ai?'AI 生成':'本地简化诊断')+'</span><span class="caption">'+(ai?(result.cached?'读取缓存 · 本次未发请求':'本次已调用 AI'):'本地规则整理')+'</span></div><h3>'+UI.esc(d.knowledge_point)+'</h3><p class="caption">章节：'+UI.esc(d.chapter)+' · 来源题号：'+UI.esc(q.sourceId||q.id)+'</p>'+(result.note?'<p class="notice amber">'+UI.esc(result.note)+'</p>':'')+'<dl class="diagnosis-fields"><dt>考点</dt><dd>'+UI.esc(d.knowledge_point)+'</dd><dt>错因</dt><dd class="preserve">'+UI.esc(d.why_wrong)+'</dd><dt>易混点</dt><dd>'+ (d.confusable.length?d.confusable.map(function(x){return '<p class="preserve"><strong>'+UI.esc(x.item)+'</strong>：'+UI.esc(x.note)+'</p>';}).join(''):'未提供可确认的易混点。')+'</dd><dt>关联考点</dt><dd>'+UI.esc(d.related.length?d.related.slice(0,5).join('、'):'未提供可确认的关联考点。')+'</dd><dt>复习建议</dt><dd class="preserve">'+UI.esc(d.advice)+'</dd></dl><p class="caption">以题库原文为准'+(q.answerSource==='reference'?'；本题参考答案仍待核对。':'。')+(ai?' 分析置信度：'+UI.esc({high:'高',medium:'中',low:'低'}[d.confidence]||'低'):'')+'</p>'+UI.button('诊断内容报错','report','quiet',attr(q.id))+'</article>';}
  function diagnose(id,force,localOnly,el){
    if(diagnosisBusy[id]){UI.toast('这道题正在分析，请稍候。');return Promise.resolve();}
    diagnosisBusy[id]=true;var host=document.getElementById('ai-diagnosis-result');
    return busy(el,function(){if(host)host.innerHTML=UI.loading(localOnly?'正在整理本地记录…':'正在准备诊断…');
      return Bank.get(id).then(function(q){if(!host||!document.contains(host))return null;if(localOnly)return {q:q,result:AI.local(q)};var reason=AI.unavailable();return (reason?Promise.resolve(true):ensureConsent()).then(function(yes){if(!host||!document.contains(host))return null;if(!yes)return {q:q,result:AI.local(q,'已取消；本次未调用 AI',false)};host.innerHTML=UI.loading('正在分析；临时错误最多重试一次…');return AI.diagnose(q,force).then(function(result){return {q:q,result:result};});});}).then(function(pair){if(pair&&host&&document.contains(host))host.innerHTML=card(pair.q,pair.result);updateCounters();});
    }).then(function(v){delete diagnosisBusy[id];return v;},function(e){delete diagnosisBusy[id];if(host&&document.contains(host))host.innerHTML=UI.error(e);throw e;});
  }
  function wrongIds(session){return Object.keys(session.answers||{}).filter(function(id){return session.answers[id].correct===false;});}
  function result(session){
    var ids=wrongIds(session),enabled=AI.config().enabled;
    if(!ids.length)return '';
    return '<section class="card"><h2>本次错题诊断</h2><p class="caption">每次最多 5 道，按顺序逐题分析；相同内容优先使用缓存。</p>'+ (enabled?UI.button('AI 批量诊断（'+ids.length+' 道）','ai-batch','outline',attr(session.id)+(ids.length>5?' disabled':'')):'')+UI.button('本地批量简化诊断','ai-batch-local','quiet',attr(session.id)+(ids.length>5?' disabled':''))+(ids.length>5?'<p class="notice amber">本次错题超过 5 道，请进入题目详情逐题诊断。</p>':'')+'<div id="ai-batch-result" role="status"></div></section>';
  }
  function batch(id,localOnly,el){
    if(batchBusy){UI.toast('批量诊断进行中，请稍候。');return Promise.resolve();}
    var session=Store.get().sessions[id],ids=session?wrongIds(session):[];
    if(!ids.length||ids.length>5){UI.toast('批量诊断只支持 1–5 道错题。');return Promise.resolve();}
    batchBusy=true;var host=document.getElementById('ai-batch-result');
    return busy(el,function(){var startHash=location.hash,html='',consent=localOnly||AI.unavailable()?Promise.resolve(true):ensureConsent();
      return consent.then(function(yes){if(!yes){if(host&&document.contains(host))host.innerHTML='<p class="notice">已取消；本次未调用 AI。</p>';return;}
        var chain=Promise.resolve();ids.forEach(function(qid,index){chain=chain.then(function(){if(location.hash!==startHash||!host||!document.contains(host))return;host.innerHTML=html+UI.loading('正在分析第 '+(index+1)+' / '+ids.length+' 道…');return Bank.get(qid).then(function(q){if(location.hash!==startHash||!document.contains(host))return;return (localOnly?Promise.resolve(AI.local(q)):AI.diagnose(q,false,session.answers[qid])).then(function(r){html+=card(q,r);if(document.contains(host))host.innerHTML=html;});});});});return chain;
      }).then(updateCounters);
    }).then(function(v){batchBusy=false;return v;},function(e){batchBusy=false;if(host&&document.contains(host))host.innerHTML=UI.error(e);throw e;});
  }
  function exportBackup(){
    var blob=new Blob([AI.backup()],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(Store.isTestMode()?'测试副本-':'')+'解剖学习备份-'+Store.today()+'.json';document.body.appendChild(link);link.click();document.body.removeChild(link);setTimeout(function(){URL.revokeObjectURL(url);},1000);var ok=Store.markBackup();UI.toast(ok?'已发起备份下载，请保存文件；不含 API Key 和代理令牌。':'备份下载已发起，但导出时间未保存。');App.render();
  }
  function handle(action,el){
    var id=el&&el.getAttribute('data-id');
    if(action==='ai-save')return saveSettings();
    if(action==='ai-consent')return acceptConsent();
    if(action==='ai-test')return connection(el);
    if(action==='ai-delete-key'||action==='ai-delete-token'){AI.configure(Object.assign({},AI.config()),'', '',action==='ai-delete-key',action==='ai-delete-token');return App.render().then(function(){status(action==='ai-delete-key'?'已删除浏览器中的 Key。':'已删除浏览器中的代理令牌。',false);});}
    if(action==='ai-clear-cache'){AI.clearCache();updateCounters();status('诊断缓存已清空；已生成题保持不变。',false);return true;}
    if(action==='ai-export')return Backup.handle('backup-download',el);
    if(action==='ai-diagnose'||action==='ai-reanalyze'||action==='ai-local')return diagnose(id,action==='ai-reanalyze',action==='ai-local',el);
    if(action==='ai-batch'||action==='ai-batch-local')return batch(id,action==='ai-batch-local',el);
    return false;
  }
  function change(el){if(el.id==='ai-mode'){document.getElementById('ai-direct-fields').hidden=el.value!=='direct';document.getElementById('ai-proxy-fields').hidden=el.value!=='proxy';return true;}return false;}
  window.AIUI={settings:settings,ensureConsent:ensureConsent,handle:handle,change:change,detail:detail,result:result,card:card,busy:busy};
}());
