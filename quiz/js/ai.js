(function () {
  'use strict';
  var SECRET='anatomy.ai.credentials.v1', CACHE='anatomy.ai.diagnostics.v1', VERSION='stage2-v1', activeRequests=0;
  var prompts={
    diagnosis:'你是一名严谨的医学教育助手，负责帮助医学生分析系统解剖学错题。必须只依据用户提供的题目信息（题干、选项、正确答案、用户答案、题库解析、章节）分析，不得编造题目以外的解剖学事实；不确定的内容宁可不写。只输出一个 JSON 对象，不要输出 Markdown 代码块或任何解释文字。JSON 字段：{"knowledge_point":"一句话考点（≤25字）","chapter":"所属章节","why_wrong":"用户可能的错因，40–120字","confusable":[{"item":"易混点名称","note":"区别要点≤40字"}],"related":["关联考点，最多5个"],"advice":"复习建议，30–80字","confidence":"high|medium|low"}',
    polish:'你是医学教育助手。程序已把一道选择题的某个选项转成判断题，并已确定答案（对/错）。你只负责在不改变答案、不改变事实、不引入题目外新知识的前提下，把句子润色成通顺完整的判断题陈述，并写 1–2 句解析。只输出 JSON：{"stem":"判断题陈述","answer":"必须与给定答案完全一致，只能是「对」或「错」","explanation":"解析"}。禁止修改答案或选项原意，禁止添加题库中没有的结构、数字、毗邻关系。',
    validate:'你是严谨的医学教育助手。程序从题库原题中抽取了 4 个选项，组成一道新单选题（选项文字不可修改）。请你：(1) 判断每个选项在当前题干语境下是否为正确的解剖学表述，输出 true / false / null（无法判断），并给理由；(2) 给出本题的简短逐项解析。只输出 JSON：{"topic":"≤15字的考查主题（可选，可为空字符串）","items":[{"key":"A","truth":true,"reason":"≤30字"},…],"explanation":"逐项解析"}。禁止编造题库外的解剖学事实；不确定就输出 null。'
  };
  function config(){return Store.get().settings.ai||{enabled:false,mode:'proxy',model:'deepseek-chat',proxyUrl:''};}
  function secrets(){if(Store.isTestMode&&Store.isTestMode())return {};try{var s=JSON.parse(localStorage.getItem(SECRET)||'{}');return s&&typeof s==='object'?s:{};}catch(e){return {};}}
  function secretStatus(){var s=secrets();return {key:!!s.apiKey,token:!!s.proxyToken};}
  function configure(c,key,token,deleteKey,deleteToken){
    if(Store.isTestMode&&Store.isTestMode())throw new Error('测试模式不修改真实 AI 凭据或配置。');
    if(Store.readOnly)throw new Error('学习数据处于保护状态，请先处理存储提示。');
    if(c.mode!=='direct'&&c.mode!=='proxy')throw new Error('请选择接入方式。');
    c.model=c.model.trim()||'deepseek-chat';c.proxyUrl=c.proxyUrl.trim().replace(/\/+$/,'');
    if(c.proxyUrl){var u;try{u=new URL(c.proxyUrl);}catch(e){throw new Error('请输入完整的 HTTPS 代理地址。');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('代理地址须使用 HTTPS，不能含账号、密码、查询参数或片段。');if(/\/chat\/completions$/.test(c.proxyUrl))c.proxyUrl=c.proxyUrl.replace(/\/chat\/completions$/,'');}
    var s=secrets();if(key)s.apiKey=key.trim();if(token)s.proxyToken=token.trim();
    if(deleteKey||c.mode==='proxy')delete s.apiKey;if(deleteToken)delete s.proxyToken;
    try{localStorage.setItem(SECRET,JSON.stringify(s));}catch(e){throw new Error('凭据未保存：本机存储不可用或空间不足。');}
    if(!Store.setAI(c))throw new Error('AI 设置未保存，请查看存储提示。');
  }
  function unavailable(){if(Store.isTestMode&&Store.isTestMode())return '测试模式不调用真实 AI';var c=config(),s=secrets();if(!c.enabled)return 'AI 已关闭';if(typeof navigator!=='undefined'&&navigator.onLine===false)return '当前离线';if(c.mode==='direct'&&!s.apiKey)return '尚未填写 API Key';if(c.mode==='proxy'&&!c.proxyUrl)return '尚未填写代理地址';if(typeof fetch!=='function')return '浏览器不支持网络请求';return '';}
  // 扫描字符串/转义符，避免嵌套 JSON 或文本中的花括号造成截断。
  function parseJSON(raw){
    var text=String(raw).replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''),start=-1,depth=0,quoted=false,escaped=false;
    for(var i=0;i<text.length;i++){var ch=text[i];if(start<0){if(ch==='{'){start=i;depth=1;}continue;}if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1));}catch(e){throw new Error('AI 返回的 JSON 无法解析。');}}}
    throw new Error('AI 未返回完整 JSON 对象。');
  }
  function errorFor(status){var msg=status===401?'认证失败，请检查 Key 或代理令牌。':status===402?'DeepSeek 余额不足，请检查账户余额。':status===429?'请求过于频繁，请稍后重试。':status>=500?'AI 服务暂时不可用，请稍后重试。':'AI 请求未成功（状态 '+status+'），请检查模型和代理设置。';var e=new Error(msg);e.retry=status===429||status>=500;return e;}
  function attempt(body,c,s,origin){
    function sameContext(){if(Store.get()!==origin){var e=new Error('记录环境已切换，本次 AI 响应已丢弃。');e.cancelled=true;throw e;}}
    sameContext();
    var controller=typeof AbortController==='function'?new AbortController():null,timer;
    var headers={'Content-Type':'application/json'};
    if(c.mode==='direct')headers.Authorization='Bearer '+s.apiKey;else if(s.proxyToken)headers['x-proxy-token']=s.proxyToken;
    var options={method:'POST',headers:headers,body:JSON.stringify(body)};if(controller)options.signal=controller.signal;
    Store.aiCount('calls');
    var timeout=new Promise(function(resolve,reject){timer=setTimeout(function(){var e=new Error('AI 请求超过 30 秒，已停止等待。');e.retry=true;e.timeout=true;reject(e);if(controller)controller.abort();},30000);});
    return Promise.race([Promise.resolve().then(function(){return fetch(c.mode==='direct'?'https://api.deepseek.com/chat/completions':c.proxyUrl+'/chat/completions',options);}).then(function(r){if(!r.ok)throw errorFor(r.status);return r.json();}).then(function(data){var raw=data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content;if(typeof raw!=='string')throw new Error('AI 返回内容为空或格式不受支持。');return parseJSON(raw);}),timeout]).then(function(result){clearTimeout(timer);sameContext();Store.aiCount('successes');return result;},function(e){clearTimeout(timer);sameContext();Store.aiCount('failures');if(e.name==='TypeError')e=new Error(c.mode==='direct'?'无法连接 DeepSeek，可能被跨域限制；请改用代理。':'无法连接代理，请检查网络和代理地址。');throw e;});
  }
  function request(kind,payload,control){
    function checkCancelled(){if(control&&typeof control.cancelled==='function'&&control.cancelled()){var e=new Error('本次操作已取消。');e.cancelled=true;throw e;}}
    try{checkCancelled();}catch(cancelled){return Promise.reject(cancelled);}
    var reason=unavailable(),c=Object.assign({},config()),s=secrets();if(reason)return Promise.reject(new Error(reason));
    if(Store.readOnly)return Promise.reject(new Error('学习数据处于保护状态，请先处理存储提示。'));
    if(!c.privacyAccepted)return Promise.reject(new Error('请先阅读并同意 AI 隐私说明。'));
    var body={model:c.model,messages:[{role:'system',content:prompts[kind]||'只输出 JSON：{"ok":true}'},{role:'user',content:JSON.stringify(payload)}],temperature:0.2,max_tokens:kind==='test'?32:kind==='polish'?700:1400,response_format:{type:'json_object'}};
    var origin=Store.get();activeRequests++;
    return attempt(body,c,s,origin).catch(function(e){checkCancelled();if(!e.retry||Store.get()!==origin)throw e;if(unavailable())throw e;return attempt(body,c,s,origin);}).then(function(result){activeRequests--;return result;},function(e){activeRequests--;throw e;});
  }
  function readCache(){if(Store.isTestMode&&Store.isTestMode())return [];try{var c=JSON.parse(localStorage.getItem(CACHE)||'[]');return Array.isArray(c)?c.filter(function(x){return x&&typeof x.key==='string'&&typeof x.at==='string'&&validDiagnosis(x.data);}):[];}catch(e){return [];}}
  function clearCache(){if(Store.isTestMode&&Store.isTestMode())return;localStorage.removeItem(CACHE);}
  function hash(value){var h=2166136261;for(var i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
  function context(q,snapshot){var r=Store.get().questions[q.id]||{};return {id:q.id,stem:q.stem,options:q.options,correct_answer:q.answer,answer_source:q.answerSource,user_answer:snapshot?snapshot.value||snapshot.rating||'':r.lastAnswer||r.lastRating||'',selected_wrong:snapshot?(snapshot.correct===false?snapshot.value||'':''):r.selectedWrongOption||'',explanation:q.explanation,chapter:(Bank.chapter(q.chapterId)||{}).name||q.chapterId,marked_options:Store.getOptionMarks(q.id).filter(function(o){return o.active||o.autoRecorded;}).map(function(o){return {key:o.key,autoRecorded:o.autoRecorded};})};}
  function validDiagnosis(d){return d&&['knowledge_point','chapter','why_wrong','advice'].every(function(k){return typeof d[k]==='string'&&d[k].trim();})&&Array.isArray(d.confusable)&&d.confusable.every(function(x){return x&&typeof x.item==='string'&&typeof x.note==='string';})&&Array.isArray(d.related)&&d.related.every(function(x){return typeof x==='string';})&&['high','medium','low'].indexOf(d.confidence)>=0;}
  function local(q,note,attempted){var c=context(q);return {local:true,attempted:!!attempted,note:note||'本次未调用 AI',data:{knowledge_point:c.chapter,chapter:c.chapter,why_wrong:'请对照你的答案与题库答案复核。'+(c.marked_options.length?'已标记选项：'+c.marked_options.map(function(o){return o.key+(o.autoRecorded?'（自动错选）':'（追加）');}).join('、'):'尚未标记具体选项。'),confusable:[{item:'题库解析',note:q.explanation||'原题库未提供解析，不补充推测内容。'}],related:[],advice:'重新阅读题干和选项，核对题库解析，再重做原题；参考答案请自行核对。',confidence:'low'}};}
  function diagnose(q,force,snapshot){
    var reason=unavailable();if(reason)return Promise.resolve(local(q,reason+'；本次未调用 AI',false));
    var origin=Store.get(),c=context(q,snapshot),key=q.id+'|'+config().model+'|'+VERSION+'|'+c.selected_wrong+'|'+hash(JSON.stringify(c)),cache=readCache(),hit=cache.filter(function(x){return x.key===key;})[0],before=(Store.get().aiStats||{}).calls||0;
    if(hit&&!force)return Promise.resolve({data:hit.data,cached:true,local:false});
    return request('diagnosis',c).then(function(d){if(Store.get()!==origin)throw new Error('记录环境已切换，未保存本次诊断。');if(!validDiagnosis(d))throw new Error('诊断字段不完整。');cache=readCache().filter(function(x){return x.key!==key;});cache.push({key:key,at:new Date().toISOString(),data:d});cache.sort(function(a,b){return a.at.localeCompare(b.at);});try{localStorage.setItem(CACHE,JSON.stringify(cache.slice(-300)));}catch(e){/* 缓存失败不阻塞学习。 */}return {data:d,cached:false,local:false};}).catch(function(e){var attempted=((Store.get().aiStats||{}).calls||0)>before;return local(q,(attempted?'AI 请求未成功：':'本次未调用 AI：')+e.message+' 以下为本地简化诊断。',attempted);});
  }
  function backup(){
    // 凭据使用独立存储；额外递归剔除同名字段及意外混入文本的凭据。
    var s=secrets(),tokens=[s.apiKey,s.proxyToken].filter(function(x){return typeof x==='string'&&x.length;});
    return JSON.stringify(Store.get(),function(k,v){if(/^(apiKey|proxyToken|authorization|x-proxy-token)$/i.test(k))return undefined;if(typeof v==='string')tokens.forEach(function(t){v=v.split(t).join('[凭据已排除]');});return v;},2);
  }
  window.AI={validDiagnosis:validDiagnosis,busy:function(){return activeRequests>0;},config:config,configure:configure,secretStatus:secretStatus,unavailable:unavailable,request:request,parseJSON:parseJSON,prompts:prompts,version:VERSION,context:context,diagnose:diagnose,local:local,cacheEntries:readCache,cacheCount:function(){return readCache().length;},clearCache:clearCache,backup:backup};
}());
