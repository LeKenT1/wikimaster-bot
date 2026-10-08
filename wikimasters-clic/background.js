// WikiMasters Clic : fait un vrai clic (comme une souris) sur un bouton de wiki-masters.com, à la demande du bot.
// Un clic fait par un script de la page est marqué isTrusted = false ; un clic envoyé par le protocole de débogage de
// Chrome (Input.dispatchMouseEvent) est un vrai clic pour la page. Pendant le clic et l'attente de la réponse, Chrome
// affiche un bandeau « WikiMasters Clic a commencé à déboguer ce navigateur ».
//
// Déroulé : si l'onglet du bot affiche déjà la page demandée, le clic se fait dedans ; sinon la page s'ouvre dans un
// nouvel onglet (avec #wmclick, pour que le bot ne s'y lance pas). Après le clic, l'extension lit la réponse du site à
// la mise (v1.1) :
//  - mise acceptée → { ok: true, accepted: true } ; l'onglet se ferme et tu retrouves celui où tu étais ;
//  - « human_verification_required » ou captcha Cloudflare → recharge la page et remise (jusqu'à 3 fois) ;
//  - autre refus → { ok: false, error: message du site } ; aucune mise envoyée → { ok: false, error }.
//
// Chrome réduit : taille virtuelle le temps du clic (Emulation, v1.2).

const SITE = 'https://www.wiki-masters.com/';
const WAIT_MS = 45000;
const MAX_CAPTCHA_RETRIES = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let busy = false;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'click' || !sender.tab) return;
  if (busy) { reply({ ok: false, error: 'un clic est déjà en cours' }); return; }
  busy = true;
  clickButton(msg, sender.tab)
    .then(reply, e => reply({ ok: false, error: String((e && e.message) || e) }))
    .finally(() => { busy = false; });
  return true;   // réponse asynchrone
});

// ── Fonctions exécutées dans la page ──
function findButton(text) {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.textContent) === text);
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center', inline: 'center' });
  const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  let top = document.elementFromPoint(x, y);
  if (top && top.id === 'wikimasters-bot') {
    top.style.setProperty('visibility', 'hidden', 'important');
    top.dataset.wmclickHidden = '1';
    top = document.elementFromPoint(x, y);
  }
  return { x, y, vw: innerWidth, disabled: btn.disabled, clear: !!top && (top === btn || btn.contains(top)) };
}

function restorePage() {
  document.querySelectorAll('[data-wmclick-hidden]').forEach(e => { e.style.removeProperty('visibility'); delete e.dataset.wmclickHidden; });
}

function hasCloudflareCaptcha() {
  return !!document.querySelector('#challenge-running, iframe[src*="cloudflare"], .cf-turnstile, #cf-chl-widget-container, div[class*="cf-challenge"]');
}

async function inPage(tabId, func, ...args) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return res ? res.result : null;
  } catch { return null; }   // page en cours de chargement
}

// Réponses du site aux mises (POST …/bid) dans cet onglet, lues par le protocole de débogage (domaine Network).
function watchBids(tabId) {
  const pending = new Map(), results = [];
  let wake = null;
  const onEvent = async (src, method, p) => {
    if (src.tabId !== tabId) return;
    if (method === 'Network.responseReceived' && /\/bid(\?|$)/.test(new URL(p.response.url).pathname + '?') && p.type !== 'Preflight') pending.set(p.requestId, p.response.status);
    if ((method === 'Network.loadingFinished' || method === 'Network.loadingFailed') && pending.has(p.requestId)) {
      const status = pending.get(p.requestId);
      pending.delete(p.requestId);
      let body = null;
      if (method === 'Network.loadingFinished') {
        try { const r = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: p.requestId }); body = JSON.parse(r.body); } catch {}
      }
      results.push({ status, body });
      if (wake) wake();
    }
  };
  chrome.debugger.onEvent.addListener(onEvent);
  return {
    results,
    next: ms => new Promise(r => { wake = r; setTimeout(r, ms); }),
    stop: () => chrome.debugger.onEvent.removeListener(onEvent),
  };
}

const isHuman = b => !!b && (b.code === 'human_verification_required' || b.human_verification_required === true || /v[ée]rification/i.test(String(b.error || b.message || '')));

async function clickButton({ url, text }, from) {
  if (typeof url !== 'string' || !url.startsWith(SITE)) throw new Error('adresse refusée (seulement wiki-masters.com) : ' + url);
  if (!text) throw new Error('texte du bouton manquant');
  const target = new URL(url);
  const same = !!from.url && new URL(from.url).pathname === target.pathname;
  const [before] = await chrome.tabs.query({ active: true, windowId: from.windowId });
  let tabId = from.id, opened = false, keep = false;
  if (same) await chrome.tabs.update(tabId, { active: true });
  else {
    target.hash = 'wmclick';
    const t = await chrome.tabs.create({ url: target.href, active: true, openerTabId: from.id, windowId: from.windowId, index: from.index + 1 });
    tabId = t.id; opened = true;
  }
  
  let attempts = 0;
  
  try {
    while (attempts <= MAX_CAPTCHA_RETRIES) {
      // Attachement propre du débogueur à chaque tentative
      await chrome.debugger.attach({ tabId }, '1.3').catch(() => {});
      const bids = watchBids(tabId);
      
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

        // Vérification initiale de présence de captcha au chargement
        if (await inPage(tabId, hasCloudflareCaptcha)) {
          bids.stop();
          await chrome.debugger.detach({ tabId }).catch(() => {});
          
          if (attempts >= MAX_CAPTCHA_RETRIES) {
            keep = true;
            return { ok: true, human: true, error: 'trop de captchas successifs, intervention humaine requise' };
          }
          attempts++;
          await chrome.tabs.reload(tabId);
          await sleep(8000); // Laisse le temps à Cloudflare de valider le challenge
          continue;
        }

        let spot = null;
        for (const end = Date.now() + 25000; !spot && Date.now() < end;) {
          spot = await inPage(tabId, findButton, text);
          if (!spot) await sleep(500);
        }
        if (!spot) throw new Error(`bouton « ${text} » introuvable sur ${url}`);

        if (!spot.vw) {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
        }
        await sleep(400);
        spot = await inPage(tabId, findButton, text);
        if (!spot) throw new Error(`bouton « ${text} » disparu`);
        if (!spot.clear) throw new Error(`bouton « ${text} » recouvert par un autre élément`);
        if (spot.disabled) throw new Error(`bouton « ${text} » grisé`);

        const mouse = (type, extra = {}) => chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, ...extra });
        await mouse('mouseMoved');
        await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
        await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
        await inPage(tabId, restorePage);

        let captchaDetected = false;
        for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
          if (await inPage(tabId, hasCloudflareCaptcha)) {
            captchaDetected = true;
            break;
          }
          for (const r of bids.results.splice(0)) {
            if (r.status >= 200 && r.status < 300) return { ok: true, accepted: true };
            if (isHuman(r.body) || r.status === 403 || r.status === 429) {
              captchaDetected = true;
            } else {
              return { ok: false, error: `mise refusée par le site : ${(r.body && (r.body.error || r.body.message)) || 'erreur ' + r.status}` };
            }
          }
          if (captchaDetected) break;
          await bids.next(Math.max(0, end - Date.now()));
        }

        bids.stop();
        await chrome.debugger.detach({ tabId }).catch(() => {});

        if (captchaDetected) {
          attempts++;
          if (attempts > MAX_CAPTCHA_RETRIES) {
            keep = true;
            return { ok: true, human: true, error: 'trop de captchas, intervention humaine requise' };
          }
          await chrome.tabs.reload(tabId);
          await sleep(8000);
          continue;
        }

        throw new Error('le clic n’a envoyé aucune mise au site en 45 s');
        
      } finally {
        bids.stop();
        await chrome.debugger.detach({ tabId }).catch(() => {});
      }
    }
  } finally {
    await inPage(tabId, restorePage);
    if (opened && !keep) await chrome.tabs.remove(tabId).catch(() => {});
    if (!keep && before && before.id !== tabId) await chrome.tabs.update(before.id, { active: true }).catch(() => {});
  }
}