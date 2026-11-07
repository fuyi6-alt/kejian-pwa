(function () {
  'use strict';
  var toastTimer;
  var focusBeforeModal;
  var paths = {
    home:'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    book:'M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3z M12 6v16',
    wrong:'M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h3',
    chart:'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
    settings:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3',
    arrow:'M5 12h14 M13 6l6 6-6 6',
    back:'M19 12H5 M11 6l-6 6 6 6',
    shuffle:'M3 6h3l12 12h3 M17 14l4 4-4 4 M3 18h3l4-4 M14 10l4-4h3 M17 2l4 4-4 4',
    search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M15 15l6 6',
    check:'M5 12l4 4L19 6', close:'M6 6l12 12 M18 6L6 18',
    flag:'M5 22V3h14l-3 5 3 5H5', calendar:'M4 5h16v16H4z M7 2v6 M17 2v6 M4 10h16',
    clock:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 3',
    target:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 11v2',
    exam:'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4'
  };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function icon(name) { return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (paths[name] || paths.book) + '"/></svg>'; }
  function toast(text) { var el=document.getElementById('toast'); clearTimeout(toastTimer); el.textContent=text; el.hidden=false; toastTimer=setTimeout(function(){el.hidden=true;},4000); }
  function button(text,action,cls,attrs) { return '<button type="button" class="btn '+(cls||'')+'" data-action="'+action+'" '+(attrs||'')+'>'+text+'</button>'; }
  function empty(title,text,action) { return '<div class="empty"><div class="empty-symbol">'+icon('book')+'</div><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p>'+(action||'')+'</div>'; }
  function loading(text) { return '<div class="loading" role="status"><span class="spinner"></span><p>'+esc(text||'正在读取本地题库…')+'</p></div>'; }
  function header(kicker,title,description,action) { return '<div class="page-heading"><div><p class="eyebrow">'+esc(kicker)+'</p><h1>'+esc(title)+'</h1>'+(description?'<p class="subtle">'+esc(description)+'</p>':'')+'</div>'+(action||'')+'</div>'; }
  function closeModal() { var callback=window.UI&&window.UI.onModalClose;if(window.UI)window.UI.onModalClose=null;if(callback)callback();var root=document.getElementById('modal-root'); root.innerHTML=''; document.body.classList.remove('modal-open'); if(focusBeforeModal && document.contains(focusBeforeModal)) focusBeforeModal.focus(); }
  function modal(title,content) {
    if(document.querySelector('.modal'))closeModal();
    focusBeforeModal=document.activeElement;
    document.getElementById('modal-root').innerHTML='<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><h2 id="modal-title">'+esc(title)+'</h2>'+button(icon('close'),'close-modal','icon-btn','aria-label="关闭弹窗"')+'</div>'+content+'</section></div>';
    document.body.classList.add('modal-open'); var el=document.querySelector('.modal button, .modal input'); if(el) el.focus();
  }
  function pct(correct,total) {return total?Math.round(100*correct/total):0;}
  function duration(ms) { var seconds=Math.max(0,Math.floor((ms||0)/1000)); return Math.floor(seconds/60)+'分'+(seconds%60)+'秒'; }
  function type(q) {return {mcq:'单选题',short:'简答题',multiple:'多选题',fill:'填空题'}[q.type]||q.type;}
  function answer(q) {
    if (!q.answer || (Array.isArray(q.answer) && !q.answer.length)) return '原题库未提供答案';
    if(q.type==='mcq'||q.type==='multiple') {
      var keys=Array.isArray(q.answer)?q.answer:[q.answer];
      return keys.map(function(k){var opt=q.options.filter(function(o){return o.key===k;})[0]; return k+(opt?'．'+opt.text:'');}).join('\n');
    }
    return typeof q.answer==='string'?q.answer:JSON.stringify(q.answer);
  }
  function badge(q) {return '<span class="pill">'+type(q)+'</span>'+(q.answerSource==='reference'?'<span class="pill amber">参考答案 · 待核对</span>':q.answerSource==='missing'?'<span class="pill neutral">暂无答案</span>':'<span class="pill pale">原材料答案</span>');}
  function assets(q) {return (q.assets||[]).map(function(a){var path=typeof a==='string'?a:a.path; if(!/^data\/assets\/[a-zA-Z0-9._-]+$/.test(path||''))return ''; return '<figure><img class="question-image" src="'+esc(path)+'" alt="'+esc(a.caption||'原题配图')+'"><figcaption>'+esc(a.caption||'原题配图')+'</figcaption></figure>';}).join('');}
  function explanation(q) {
    var text=q.explanation||'';
    var html='<h3>解析</h3><p class="preserve">'+esc(text||'原题库未提供解析。')+'</p>';
    if(q.sourceExplanation && q.sourceExplanation!==text)html+='<h3>原材料附注</h3><p class="preserve">'+esc(q.sourceExplanation)+'</p>';
    if(q.referenceAnswer && q.referenceAnswer.ambiguity_note)html+='<p class="notice amber">'+esc(q.referenceAnswer.ambiguity_note)+'</p>';
    if(q.answerSource==='reference')html+='<p class="caption">此答案及推导来自既有题库参考记录，尚待核对；本网站未调用 AI。</p>';
    return html;
  }
  function error(error) {return empty('暂时未能打开',error.message||String(error),button('重试','retry','primary'));}
  document.addEventListener('keydown',function(e){
    var modalEl=document.querySelector('.modal'); if(!modalEl)return;
    if(e.key==='Escape'){closeModal();return;}
    if(e.key==='Tab'){var list=modalEl.querySelectorAll('button:not([disabled]),input,select,textarea,a[href]');if(!list.length)return;var first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}
  });
  window.UI={esc:esc,icon:icon,toast:toast,button:button,empty:empty,loading:loading,header:header,modal:modal,closeModal:closeModal,pct:pct,duration:duration,type:type,answer:answer,badge:badge,assets:assets,explanation:explanation,error:error};
}());
