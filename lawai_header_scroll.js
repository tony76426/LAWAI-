/* LawAI header auto-hide: downward scroll hides; upward scroll restores.
   Designed for the shared premium navigation on desktop and mobile. */
(function () {
  'use strict';

  function init() {
    var header = document.querySelector('header.lawai-premium-header');
    if (!header || header.dataset.scrollHideBound === '1') return;
    header.dataset.scrollHideBound = '1';

    var SHOW_NEAR_TOP_PX = 105;
    var HIDE_AFTER_PX = 8;
    var SHOW_AFTER_PX = 6;
    var decisionY = Math.max(0, window.scrollY || window.pageYOffset || 0);
    var framePending = false;

    function isNavigationInUse() {
      var details = header.querySelector('.lawai-premium-mobile[open]');
      var root = document.documentElement;
      var menu = root.classList.contains('lw-open') ||
                 document.body.classList.contains('lw-open');
      var focused = document.activeElement;
      var keyboardFocus = focused && header.contains(focused) &&
                          focused.matches(':focus-visible');
      return Boolean(details || menu || keyboardFocus);
    }

    function showHeader() {
      header.classList.remove('lawai-nav-hidden');
    }

    function updateDirection() {
      framePending = false;
      var y = Math.max(0, window.scrollY || window.pageYOffset || 0);
      if (y < SHOW_NEAR_TOP_PX || isNavigationInUse()) {
        showHeader();
        decisionY = y;
        return;
      }

      var delta = y - decisionY;
      if (delta > HIDE_AFTER_PX) {
        header.classList.add('lawai-nav-hidden');
        decisionY = y;
      } else if (delta < -SHOW_AFTER_PX) {
        showHeader();
        decisionY = y;
      }
    }

    function onScroll() {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateDirection);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      decisionY = Math.max(0, window.scrollY || window.pageYOffset || 0);
      showHeader();
    }, { passive: true });
    header.addEventListener('focusin', showHeader);

    var mobileMenu = header.querySelector('.lawai-premium-mobile');
    if (mobileMenu) {
      mobileMenu.addEventListener('toggle', function () {
        if (mobileMenu.open) showHeader();
      });
    }
    var homeMenu = document.getElementById('lawai-mh-btn');
    if (homeMenu) homeMenu.addEventListener('click', showHeader);
    updateDirection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
