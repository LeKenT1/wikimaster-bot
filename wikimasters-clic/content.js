// Relais entre le bot (script Tampermonkey de la page) et l'extension : window.postMessage ⇄ chrome.runtime.sendMessage.
// Le bot envoie { wmclick: { id, url, text } } et reçoit { wmclickReply: { id, ok, human, disabled, error } }.
const VERSION = chrome.runtime.getManifest().version;
const hello = () => window.postMessage({ wmclickHello: VERSION }, '*');

window.addEventListener('message', e => {
  if (e.source !== window || !e.data) return;
  if (e.data.wmclickPing) hello();
  const req = e.data.wmclick;
  if (!req) return;
  chrome.runtime.sendMessage({ type: 'click', url: req.url, text: req.text }, r => {
    const reply = chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r;
    window.postMessage({ wmclickReply: { ...reply, id: req.id } }, '*');
  });
});
hello();   // le bot est peut-être déjà là ; sinon il enverra wmclickPing en démarrant
