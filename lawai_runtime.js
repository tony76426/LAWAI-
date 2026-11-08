/* LawAI shared request and opt-in analytics helpers. No dependencies. */
(function () {
  'use strict';
  if (window.LawAIRuntime) return;
  const script = document.currentScript;
  const pageId = script ? script.getAttribute('data-page') : '';
  const events = new Set(['cta_click', 'contact_click', 'ai_start', 'ai_complete',
    'task_success', 'appointment_success', 'lawyer_send_success', 'pdf_download', 'pdf_error']);
  const flows = new Set(['navigation', 'telephone', 'line', 'email', 'chat', 'report', 'task', 'appointment']);
  function track(eventName, flow) {
    if (!window.LAWAI_ANALYTICS || window.LAWAI_ANALYTICS.enabled !== true) return;
    if (!events.has(eventName) || !flows.has(flow)) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({event: 'lawai_' + eventName, lawai_flow: flow, lawai_page: pageId});
  }
  async function request(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 120000);
    try {
      const response = await fetch(url, Object.assign({}, options, {signal: controller.signal}));
      const body = await response.arrayBuffer();
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('連線逾時，請稍後確認處理結果；請勿連續重複送出。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  window.LawAIRuntime = Object.freeze({request, track});
  document.addEventListener('click', function (event) {
    const a = event.target.closest && event.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href)) track('contact_click', 'telephone');
    else if (/^mailto:/i.test(href)) track('contact_click', 'email');
    else if (/^https:\/\/(?:line\.me|page\.line\.me)\//i.test(href)) track('contact_click', 'line');
    else if (a.matches('.main-ai-btn,.feature-link,.cta-button,.nav-card')) track('cta_click', 'navigation');
  });
  document.addEventListener('keydown', function (event) {
    const node = event.target;
    if ((event.key === 'Enter' || event.key === ' ') && node.matches && node.matches('#interactive-flowchart .node')) {
      event.preventDefault();node.click();
    }
  });
}());
