(function () {
  'use strict';
  var KEY = 'anatomy.theme.v1', mode = 'light', initialized = false;
  function valid(value) { return value === 'light' || value === 'dark'; }
  function syncControls() {
    var button = document.getElementById('theme-toggle'), dark = mode === 'dark';
    if (button) {
      button.textContent = dark ? '浅色模式' : '深色模式';
      button.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
      button.setAttribute('title', dark ? '当前深色，切换到浅色模式' : '当前浅色，切换到深色模式');
      button.setAttribute('aria-pressed', String(dark));
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-choice]'), function (control) {
      var selected = control.getAttribute('data-theme-choice') === mode;
      control.classList.toggle('selected', selected);
      control.setAttribute('aria-pressed', String(selected));
    });
  }
  function apply() {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.colorScheme = mode;
    var color = document.querySelector('meta[name="theme-color"]'), scheme = document.querySelector('meta[name="color-scheme"]');
    if (color) color.setAttribute('content', mode === 'dark' ? '#111c19' : '#147d75');
    if (scheme) scheme.setAttribute('content', mode);
    syncControls();
  }
  function set(value) {
    if (!valid(value)) return false;
    mode = value;
    apply();
    try { window.localStorage.setItem(KEY, mode); }
    catch (error) {
      if (window.UI && window.UI.toast) window.UI.toast('已切换外观，但浏览器未能保存设置。');
      return false;
    }
    return true;
  }
  function toggle() { return set(mode === 'dark' ? 'light' : 'dark'); }
  function init() {
    if (initialized) { syncControls(); return; }
    initialized = true;
    try { var saved = window.localStorage.getItem(KEY); if (valid(saved)) mode = saved; } catch (error) { mode = 'light'; }
    apply();
    document.addEventListener('click', function (event) {
      var control = event.target.closest('#theme-toggle,[data-theme-choice]');
      if (!control || control.disabled) return;
      if (control.id === 'theme-toggle') toggle();
      else set(control.getAttribute('data-theme-choice'));
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncControls);
  }
  window.Theme = {init:init, toggle:toggle, set:set, current:function () { return mode; }, syncControls:syncControls};
  init();
}());
