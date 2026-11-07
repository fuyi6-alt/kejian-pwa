(function () {
  'use strict';
  var pending = {};
  var questions = {};
  function index() {
    if (!window.ANATOMY_BANK_INDEX) throw new Error('题库索引未找到，请检查 data/bank-index.js。');
    return window.ANATOMY_BANK_INDEX;
  }
  function chapter(id) { return index().chapters.filter(function (c) { return c.id === id; })[0]; }
  function absorb(data) {
    [].concat(data.mcq || [], data.short || [], data.extra || []).forEach(function (q) { questions[q.id] = q; });
    return data;
  }
  function load(id) {
    if (!chapter(id)) return Promise.reject(new Error('找不到这个章节。'));
    if (window.ANATOMY_CHAPTERS && window.ANATOMY_CHAPTERS[id]) return Promise.resolve(absorb(window.ANATOMY_CHAPTERS[id]));
    if (pending[id]) return pending[id];
    pending[id] = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () { fail(); }, 15000);
      function fail() {
        if (done) return;
        done = true; clearTimeout(timer); delete pending[id]; script.remove();
        reject(new Error('章节加载失败，请检查本地服务是否运行，再重试。'));
      }
      script.src = './data/chapters/' + id + '.js';
      script.onload = function () {
        if (done) return;
        if (!window.ANATOMY_CHAPTERS || !window.ANATOMY_CHAPTERS[id]) { fail(); return; }
        done = true; clearTimeout(timer); resolve(absorb(window.ANATOMY_CHAPTERS[id]));
      };
      script.onerror = fail; document.head.appendChild(script);
    });
    return pending[id];
  }
  function loadAll(progress) {
    var chapters = index().chapters;
    var result = [];
    return chapters.reduce(function (promise, c, i) {
      return promise.then(function () { return load(c.id); }).then(function (data) {
        result.push(data); if (progress) progress(i + 1, chapters.length);
      });
    }, Promise.resolve()).then(function () { return result; });
  }
  function get(id) {
    if (questions[id]) return Promise.resolve(questions[id]);
    var cid = (index().questionChapters || {})[id];
    if (cid) return load(cid).then(function () { if (!questions[id]) throw new Error('题目不存在。'); return questions[id]; });
    return Promise.reject(new Error('题目不存在，请从题库搜索重新选择。'));
  }
  function all() { return Object.keys(questions).map(function (id) { return questions[id]; }); }
  function valid(q) { return q.type === 'mcq' && typeof q.answer === 'string' && q.options.some(function (o) { return o.key === q.answer; }); }
  window.Bank = {index:index, chapter:chapter, load:load, loadAll:loadAll, get:get, all:all, peek:function(id){return questions[id];}, gradable:valid};
}());
