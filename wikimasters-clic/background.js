// WikiMasters Clic : fait un vrai clic (comme une souris) sur un bouton de wiki-masters.com, à la demande du bot.
// Un clic fait par un script de la page est marqué isTrusted = false ; un clic envoyé par le protocole de débogage de
// Chrome (Input.dispatchMouseEvent) est un vrai clic pour la page. Pendant le clic et l'attente de la réponse, Chrome
// affiche un bandeau « WikiMasters Clic a commencé à déboguer ce navigateur ».
//
// Déroulé : si l'onglet du bot affiche déjà la page demandée, le clic se fait dedans ; sinon la page s'ouvre dans un
// nouvel onglet (avec #wmclick, pour que le bot ne s'y lance pas). Après le clic, l'extension lit la réponse du site à
// la mise (v1.1 ; la 1.0 ne regardait que la page pendant 5 s et croyait réussis des clics que le site refusait) :
//  - mise acceptée → { ok: true, accepted: true } ; l'onglet se ferme et tu retrouves celui où tu étais ;
//  - « human_verification_required » → la page ouvre sa fenêtre de vérification humaine, qui replace la mise une fois
//    faite. Elle passe souvent d'elle-même en 30 s à 1 min : l'extension attend la mise acceptée jusqu'au bout de son
//    budget (280 s). Toujours rien → { ok: true, human: true } : l'onglet reste ouvert et affiché, la vérification se
//    fait à la main (l'extension n'y touche pas) ;
//  - autre refus → { ok: false, error: message du site } ; aucune mise envoyée → { ok: false, error }.
//
// Captcha Cloudflare : page « Un instant… », case Turnstile, ou réponse à la mise marquée cf-mitigated. La v1.3
// rechargeait la page au bout de 15 s, ce qui relançait le captcha à zéro alors qu'il passe de lui-même en 30 s à 1 min.
// La v1.4 ne recharge plus : elle attend (jusqu'au bout du budget) que le captcha passe et que la mise soit acceptée.
// Toujours là → { ok: true, human: true, cloudflare: true } : l'onglet reste ouvert, la vérification se fait à la main.
//
// Chrome réduit (un seul écran, un jeu par-dessus…) : la page fait 0 × 0 pixel et rien n'est cliquable. Le temps du
// clic, l'extension lui donne une taille virtuelle (Emulation, v1.2) : la fenêtre reste réduite, rien ne passe au premier
// plan, aucun Alt+Tab.

const SITE = 'https://www.wiki-masters.com/';
const WAIT_MS = 45000;        // délai pour que le clic envoie une mise (sans vérification ni captcha en route)
const BUDGET_MS = 280000;     // le bot attend la réponse 300 s : captcha et vérification ont jusque-là pour passer
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
// Le bouton dont le texte est exactement `text` (comme normalize-space() en XPath), amené au centre de l'écran.
function findButton(text) {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.textContent) === text);
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center', inline: 'center' });
  const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  let top = document.elementFromPoint(x, y);
  // le panneau du bot (en bas à droite) peut recouvrir le bouton : il est masqué le temps du clic
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
// Captcha Cloudflare affiché : page de vérification entière, ou case Turnstile visible dans la page.
function cloudflare() {
  if (window._cf_chl_opt || document.querySelector('#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running')) return true;
  if (/^(just a moment|un instant|checking your browser)/i.test(document.title.trim())) return true;
  return [...document.querySelectorAll('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]')].some(e => e.getClientRects().length > 0);
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
    if (method === 'Network.responseReceived' && /\/bid(\?|$)/.test(new URL(p.response.url).pathname + '?') && p.type !== 'Preflight') {
      const cf = Object.keys(p.response.headers || {}).some(h => h.toLowerCase() === 'cf-mitigated');   // mise arrêtée par Cloudflare
      pending.set(p.requestId, { status: p.response.status, cf });
    }
    if ((method === 'Network.loadingFinished' || method === 'Network.loadingFailed') && pending.has(p.requestId)) {
      const { status, cf } = pending.get(p.requestId);
      pending.delete(p.requestId);
      let body = null;
      if (method === 'Network.loadingFinished') {
        try { const r = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: p.requestId }); body = JSON.parse(r.body); } catch {}
      }
      results.push({ status, body, cf });
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
  const [before] = await chrome.tabs.query({ active: true, windowId: from.windowId });   // l'onglet où tu étais
  let tabId = from.id, opened = false, keep = false;
  if (same) await chrome.tabs.update(tabId, { active: true });
  else {
    target.hash = 'wmclick';
    // onglet resté ouvert par l'essai précédent (vérification pas passée) : refermé, la page repart d'un onglet neuf
    for (const t of await chrome.tabs.query({ url: SITE + '*' })) if (t.url === target.href) await chrome.tabs.remove(t.id).catch(() => {});
    const t = await chrome.tabs.create({ url: target.href, active: true, openerTabId: from.id, windowId: from.windowId, index: from.index + 1 });
    tabId = t.id; opened = true;
  }
  try {
    const r = await clickOnce(tabId, text, url, Date.now() + BUDGET_MS);
    if (r.human) keep = true;
    return r;
  } finally {
    if (opened && !keep) await chrome.tabs.remove(tabId).catch(() => {});
    if (!keep && before && before.id !== tabId) await chrome.tabs.update(before.id, { active: true }).catch(() => {});
  }
}

// Attend le bouton, clique, lit la réponse du site. Captcha ou vérification humaine en route : attente jusqu'à
// `deadline`, sans recharger (la page replace la mise d'elle-même une fois passés).
async function clickOnce(tabId, text, url, deadline) {
  let spot = null, cf = false;
  for (const end = Date.now() + 25000; !spot && Date.now() < (cf ? deadline : end);) {
    if (await inPage(tabId, cloudflare)) cf = true;   // page « Un instant… » : on la laisse passer
    else spot = await inPage(tabId, findButton, text);
    if (!spot) await sleep(500);
  }
  if (!spot && cf) return { ok: true, human: true, cloudflare: true };
  if (!spot) throw new Error(`bouton « ${text} » introuvable sur ${url}`);
  await chrome.debugger.attach({ tabId }, '1.3');
  const bids = watchBids(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    if (!spot.vw) {                                       // fenêtre réduite : taille virtuelle le temps du clic
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    await sleep(400);                                   // le bandeau de débogage décale la page : position relue
    spot = await inPage(tabId, findButton, text);
    if (!spot) throw new Error(`bouton « ${text} » disparu`);
    if (!spot.clear) throw new Error(`bouton « ${text} » recouvert par un autre élément`);
    if (spot.disabled) throw new Error(`bouton « ${text} » grisé`);
    const mouse = (type, extra = {}) => chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, ...extra });
    await mouse('mouseMoved');
    await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
    await inPage(tabId, restorePage);
    // attente de la réponse du site : 45 s pour une mise envoyée ; dès qu'une vérification humaine ou un captcha
    // Cloudflare apparaît, attente jusqu'à `deadline` que la page replace la mise une fois la vérification passée.
    let human = false, cf = false;
    const wait = Date.now() + WAIT_MS;
    while (Date.now() < (human || cf ? deadline : wait)) {
      for (const r of bids.results.splice(0)) {
        if (r.status >= 200 && r.status < 300) return { ok: true, accepted: true };
        if (r.cf) cf = true;
        else if (isHuman(r.body)) human = true;
        else return { ok: false, error: `mise refusée par le site : ${(r.body && (r.body.error || r.body.message)) || 'erreur ' + r.status}` };
      }
      if (!cf && await inPage(tabId, cloudflare)) cf = true;
      await bids.next(Math.min(1000, Math.max(0, (human || cf ? deadline : wait) - Date.now())));
    }
    if (human || cf) return { ok: true, human: true, cloudflare: cf && !human };
    throw new Error('le clic n’a envoyé aucune mise au site en 45 s');
  } finally {
    bids.stop();
    await chrome.debugger.detach({ tabId }).catch(() => {});
    await inPage(tabId, restorePage);
  }
}
