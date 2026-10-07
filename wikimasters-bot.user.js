// ==UserScript==
// @name         WikiMasters Bot
// @namespace    wikimasters-bot
// @version      2.10
// @description  Assistant WikiMasters : ouvre les paquets, achète les cartes que tu veux (titre exact), repère les bonnes affaires en fin d'enchère, vend et trie ta collection.
// @match        https://www.wiki-masters.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if (window.__wmbot || location.hash === '#wmclick') return;   // onglet ouvert par l'extension WikiMasters Clic : le bot n'y tourne pas

  // ═════════════════════════ Constantes ═════════════════════════
  const RARITIES = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
  const RARITY_NAME = { L: 'Légendaire', UR: 'Ultra rare', SR: 'Super rare', R: 'Rare', PC: 'Peu commune', C: 'Commune' };
  const RANK = { L: 6, UR: 5, SR: 4, R: 3, PC: 2, C: 1 };
  const DISCARDABLE = ['R', 'PC', 'C'];            // défausse automatique historique : jamais SR/UR/L
  const PURGE_RARITIES = ['SR', 'R', 'PC', 'C'];   // grand ménage et défausse des paquets : jamais UR ni L
  const INTEREST_FACTOR = 2;                       // carte « intéressante » : vaut au moins 2× le prix médian de sa rareté
  const DURATIONS = [10, 30, 60, 180, 360, 720];   // durées d'enchère acceptées par le site (minutes)
  const REF_MIN_SAMPLES = 8;                        // observations nécessaires avant de faire confiance au prix de référence d'une rareté
  const UNDERCUT_FLOOR = 0.5;                       // à la revente, un concurrent ne fait jamais descendre le prix sous 50 % de la valeur
  const SELL_PAUSE_MS = 24 * 3600000;               // vente automatique : pause d'une carte restée invendue trop de fois
  const SELL_FRESH_MS = 30000;                      // avant une mise en vente, la collection relue a au plus 30 s (favori ★ ou étiquette tout juste posés)
  const K = {
    config: 'wmbot1.config', journal: 'wmbot1.journal', tracked: 'wmbot1.tracked', listings: 'wmbot1.listings',
    resell: 'wmbot1.resell', pnl: 'wmbot1.pnl', market: 'wmbot1.market', deals: 'wmbot1.deals', owned: 'wmbot1.owned', packs: 'wmbot1.packs', tradeAuto: 'wmbot1.tradeauto', watch: 'wmbot1.watch', packLimit: 'wmbot1.packlimit', fromPacks: 'wmbot1.frompacks', wishInfo: 'wmbot1.wishinfo', running: 'wmbot1.running', lock: 'wmbot1.lock', ui: 'wmbot1.ui',
    rateEpoch: 'wmbot1.rateepoch', sellTries: 'wmbot1.selltries',
    packLog: 'wmbot1.packlog', human: 'wmbot1.human', wishAlerts: 'wmbot1.wishalerts', tagTodo: 'wmbot1.tagtodo', sbKey: 'wmbot1.sbkey', keepIds: 'wmbot1.keepids', analysis: 'wmbot1.analysis', hidden: 'wmbot1.hidden', stats: 'wmbot1.stats',
  };

  const DEFAULTS = {
    dryRun: true,
    mode: 'normal',        // vitesse du bot : 'normal', 'turbo' (devant l'écran) ou 'slow' (absent)
    slowUntil: 0,          // mode lent : heure de retour prévue (ms) ; les ventes finissent au plus tard 10 min après
    reserve: 100,
    pollEveryS: 45,
    calmDisplay: false,    // affichage au repos : sans souris ni clavier depuis 1 min, plus d'animations (économise le processeur, utile sur le NAS)
    maxActiveBids: 10,     // enchères où l'on mise en même temps (limite choisie par l'utilisateur)
    packs: { enabled: true },
    notify: { off: false, blocks: true, packs: false, sales: false, shiny: true, phone: '' },  // notifications du navigateur : tout couper, blocages, paquets ouverts, mises en vente, nouvelles shiny ; phone = sujet ntfy (aussi sur le téléphone)
    unblock: { on: true, url: 'https://www.wiki-masters.com/marketplace/8352790b-eff8-470e-ae82-d8fe54c2cf87', button: 'Miser' },  // déblocage par l'extension WikiMasters Clic : page à ouvrir, texte du bouton à cliquer
    wishlist: {
      enabled: true,
      items: [],                                            // { title, max, notifyOver, tag }  (max vide = ancien prix max par rareté)
      categories: [],                                       // { name, max, mult, enabled } : toutes les cartes d'une catégorie (ex. « race de chien »)
      defaultMax: { L: 500, UR: 150, SR: 60, R: 15, PC: 5, C: 3 },
      allowDuplicates: false,
      scanEveryMin: 10,
    },
    trading: {
      enabled: false,
      autoOptimize: true,    // true = les réglages optimisés n'ont pas encore été écrits dans les règles (fait une fois au démarrage)
      rarities: ['UR', 'SR'],
      windowMin: 3,          // ne regarde que les enchères qui finissent dans moins de N minutes
      threshold: 50,         // bonne affaire si prix ≤ threshold % de la valeur estimée
      minValue: 20,          // ignore les cartes estimées à moins que ça
      shinyFocusAt: 80,      // stock de trading ≥ N % du stock max : le bot ne cherche plus que des shiny (✦) ; en dessous, tout (shiny comprises). 0 = toujours shiny, 100 = jamais
      shinyMax: 0,           // prix max pour une shiny, à la place du prix max par carte (0 = le même que les autres)
      shinyFindMin: 60,      // onglet Shiny : enchères qui finissent dans moins de N min…
      shinyFindMax: 3000,    // …et dont la prochaine mise est ≤ ce prix
      shinyAutoMin: 0,       // onglet Shiny : relancer la recherche toutes les N min (0 = seulement quand je clique)
      shinyAutoBuy: false,   // miser à la fin de l'enchère sur toute shiny trouvée dont la prochaine mise est ≤ shinyFindMax (sans règle de bonne affaire)
      shinyFindRarities: ['L'],   // raretés lues (le 03/10/2026, les shiny vues en vente étaient toutes des L ; ~600 enchères finissent par minute toutes raretés confondues)
      maxPerCard: 100,
      budget: 300,           // total engagé en même temps sur le trading
      maxBids: 2,            // enchères réservées au trading (sur maxActiveBids)
      scanEveryS: 30,
      manualRef: {},         // prix de référence imposés par rareté (sinon appris)
      autoResell: false,
      resellPercent: 100,
      resellDuration: 30,
      maxStock: 10,          // cartes de trading pas encore revendues (+ enchères de trading en cours) au-delà desquelles le bot arrête d'acheter
      resellDrop: 15,        // baisse du prix de revente à chaque invendu (%)
      allowLoss: false,      // autoriser la revente sous le prix d'achat…
      lossAfter: 3,          // …après N invendus
      snipeS: 40,            // mise seulement quand il reste moins de N secondes (0 = tout de suite)
      minProfit: 15,         // bénéfice minimum espéré (valeur estimée − prix)
      stockDiscount: 30,     // quand le stock à revendre déborde des 5 emplacements, prix de départ baissé jusqu'à −N %
      dormantAfter: 3,       // après N invendus d'affilée, une carte devient « dormante » : elle passe après les autres…
      maxDormant: 10,        // …et ne compte plus dans le stock maximum, jusqu'à N cartes dormantes
      dormantSlots: 2,       // emplacements de vente (sur 5) que les cartes dormantes peuvent occuper en même temps
      liquidateAfter: 5,     // après N invendus : liquidation, la carte peut être vendue à perte…
      liquidateFloor: 50,    // …mais jamais sous N % de son prix d'achat
      abandonAfter: 8,       // après N invendus : le bot abandonne, la carte sort du stock et reste dans ta collection
      liqAdd: 1,             // liquidation manuelle : mise en vente au prix payé + ce montant (peut être négatif, jamais sous 1)
      stockMax: 0,           // stock maximum imposé (0 = celui des réglages optimisés / du curseur d'exigence)
      demand: 50,            // curseur d'exigence : 0 = petites marges, 100 = seulement les très bonnes affaires
    },
    sell: {
      enabled: false,
      rarities: [],
      allowTop: false,       // autoriser la vente des UR et L
      pricing: 'market',     // 'market' = prix moyen × percent, 'fixed' = prix fixe
      percent: 100,
      fixed: { L: 500, UR: 150, SR: 60, R: 15, PC: 5, C: 2 },
      floor: { L: 200, UR: 60, SR: 20, R: 3, PC: 1, C: 1 },
      duration: 60,
      keepFreeSlots: 0,
      dropPct: 10,           // baisse du prix à chaque invendu (%)
      pauseAfter: 3,         // après N invendus d'affilée, la carte n'est plus remise en vente pendant 24 h
    },
    discard: { enabled: false, rarities: [], onlyPackCards: true },   // onlyPackCards : ne défausser que les cartes sorties des paquets ouverts par le bot
    purge: { rarities: ['C'], keepInteresting: true },               // grand ménage : défausse ces raretés, sauf (option) les cartes intéressantes
    packDiscard: { enabled: false, rarities: ['C', 'PC', 'R'], below: 0 },   // défausse auto des cartes de paquets pas intéressantes ; below > 0 : défausse sous cette valeur moyenne, garde au-dessus
    stockSell: { rarities: [] },                                     // raretés de ta collection confiées à la revente du trading
    packSort: {
      enabled: true,         // regarde le prix moyen de chaque carte sortie d'un paquet
      keepValue: 30,         // « carte de valeur » si elle se vend au moins ça en moyenne
      sellValuable: false,   // mettre en vente les cartes de valeur (sauf favoris)
      discardCheap: false,   // défausser les C/PC/R qui valent moins que keepValue
    },
    keepTitles: [],
  };

  // ═════════════════════════ Stockage partagé ═════════════════════════
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const merge = (d, v) => {
    if (Array.isArray(d) || typeof d !== 'object' || d === null) return v === undefined ? d : v;
    const o = { ...d };
    for (const k of Object.keys(v || {})) o[k] = k in d ? merge(d[k], v[k]) : v[k];
    return o;
  };
  function sanitize(c) {
    c.trading.rarities = (c.trading.rarities || []).filter(r => RARITIES.includes(r));
    c.sell.rarities = (c.sell.rarities || []).filter(r => RARITIES.includes(r) && (c.sell.allowTop || !['UR', 'L'].includes(r)));
    c.discard.rarities = (c.discard.rarities || []).filter(r => DISCARDABLE.includes(r) && !c.sell.rarities.includes(r));
    if (!DURATIONS.includes(c.sell.duration)) c.sell.duration = 60;
    c.sell.dropPct = Math.min(50, Math.max(0, c.sell.dropPct | 0));
    c.sell.pauseAfter = Math.max(1, c.sell.pauseAfter | 0);
    if (!DURATIONS.includes(c.trading.resellDuration)) c.trading.resellDuration = 360;
    c.wishlist.items = (c.wishlist.items || []).filter(i => i && i.title && String(i.title).trim()).map(({ dealOnly, ...i }) => i);   // option « Affaire » retirée en 1.8.5
    c.wishlist.categories = (c.wishlist.categories || []).filter(x => x && String(x.name || '').trim())
      .map(x => ({ name: String(x.name).trim(), tag: String(x.tag || '').trim() || null, exact: x.exact === true, max: Math.max(1, (x.max | 0) || 1000), mult: Math.min(10, Math.max(0.5, Number(x.mult) || 2)), enabled: x.enabled !== false }));
    c.keepTitles = c.keepTitles || [];
    c.trading.manualRef = c.trading.manualRef || {};
    c.trading.maxBids = Math.max(1, c.trading.maxBids | 0);
    c.trading.maxStock = Math.max(1, c.trading.maxStock | 0);
    c.trading.shinyMax = Math.max(0, c.trading.shinyMax | 0);
    if (c.trading.shinyOnly === true) c.trading.shinyFocusAt = 0;   // ancienne case « seulement les shiny » cochée = toujours shiny
    delete c.trading.shinyOnly;
    c.trading.shinyFocusAt = Math.min(100, Math.max(0, Number(c.trading.shinyFocusAt ?? 80) | 0));
    c.trading.shinyFindMin = Math.min(720, Math.max(1, c.trading.shinyFindMin | 0));
    c.trading.shinyFindMax = Math.max(1, c.trading.shinyFindMax | 0);
    c.trading.shinyAutoMin = Math.min(1440, Math.max(0, c.trading.shinyAutoMin | 0));
    c.trading.shinyFindRarities = (c.trading.shinyFindRarities || []).filter(r => RARITIES.includes(r));
    c.trading.resellDrop = Math.min(90, Math.max(0, c.trading.resellDrop | 0));
    c.trading.lossAfter = Math.max(1, c.trading.lossAfter | 0);
    c.trading.snipeS = Math.min(170, Math.max(0, c.trading.snipeS | 0));
    c.trading.minProfit = Math.max(0, c.trading.minProfit | 0);
    c.trading.stockDiscount = Math.min(80, Math.max(0, c.trading.stockDiscount | 0));
    c.trading.dormantAfter = Math.max(1, c.trading.dormantAfter | 0);
    c.trading.maxDormant = Math.max(0, c.trading.maxDormant | 0);
    c.trading.autoOptimize = c.trading.autoOptimize !== false;
    c.trading.dormantSlots = Math.min(5, Math.max(0, c.trading.dormantSlots | 0));
    c.trading.liquidateAfter = Math.max(1, c.trading.liquidateAfter | 0);
    c.trading.liquidateFloor = Math.min(100, Math.max(0, c.trading.liquidateFloor | 0));
    c.trading.abandonAfter = Math.max(c.trading.liquidateAfter + 1, c.trading.abandonAfter | 0);
    c.trading.liqAdd = Number.isFinite(Number(c.trading.liqAdd)) ? Math.round(Number(c.trading.liqAdd)) : 1;
    c.unblock.url = String(c.unblock.url || '').trim();
    if (!c.unblock.url.startsWith('https://www.wiki-masters.com/')) c.unblock.url = '';   // l'extension ne clique que sur wiki-masters.com
    c.unblock.button = String(c.unblock.button || '').trim() || 'Miser';
    if (!['normal', 'turbo', 'slow'].includes(c.mode)) c.mode = 'normal';
    c.slowUntil = c.mode === 'slow' ? Math.max(0, Number(c.slowUntil) || 0) : 0;
    c.trading.stockMax = Math.max(0, c.trading.stockMax | 0);
    c.trading.demand = Math.min(100, Math.max(0, Math.round(Number(c.trading.demand) || 0)));
    c.notify = { off: !!c.notify.off, blocks: c.notify.blocks !== false, packs: !!c.notify.packs, sales: !!c.notify.sales, shiny: c.notify.shiny !== false,
      phone: String(c.notify.phone || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) };   // sujet ntfy : lettres, chiffres, - et _
    c.purge.rarities = (c.purge.rarities || []).filter(r => PURGE_RARITIES.includes(r));
    c.purge.keepInteresting = c.purge.keepInteresting !== false;
    c.packDiscard.rarities = (c.packDiscard.rarities || []).filter(r => PURGE_RARITIES.includes(r));
    c.packDiscard.below = Math.max(0, c.packDiscard.below | 0);
    c.stockSell.rarities = (c.stockSell.rarities || []).filter(r => RARITIES.includes(r));
    // 1.8.5 : anciennes sections de « Vente & tri » retirées (vente auto par rareté, défausse auto par rareté, tri des paquets)
    c.sell.enabled = false; c.discard.enabled = false; c.packSort.sellValuable = false; c.packSort.discardCheap = false;
    c.packSort.keepValue = Math.max(1, c.packSort.keepValue | 0);
    c.pollEveryS = Math.max(15, c.pollEveryS | 0);
    c.trading.scanEveryS = Math.max(15, c.trading.scanEveryS | 0);
    c.wishlist.scanEveryMin = Math.max(3, c.wishlist.scanEveryMin | 0);
    return c;
  }
  const loadConfig = () => sanitize(merge(DEFAULTS, load(K.config, {})));

  // ── Partage des réglages ──
  // Tout est partagé sauf ce qui est personnel : la liste des cartes voulues et le mode simulation.
  const SHARE_PREFIX = 'WMBOT1:';
  const BOT_VERSION = '2.10';
  function stripPersonal(c) {
    const o = JSON.parse(JSON.stringify(c || {}));
    delete o.dryRun;
    if (o.wishlist) delete o.wishlist.items;
    return o;
  }
  function makeShareCode() {
    const json = JSON.stringify({ app: 'wikimasters-bot', v: 1, bot: BOT_VERSION, settings: stripPersonal(loadConfig()) });
    return SHARE_PREFIX + btoa(unescape(encodeURIComponent(json)));
  }
  function readShareCode(text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('colle d’abord le code de ton ami');
    let obj;
    try {
      if (t.startsWith(SHARE_PREFIX)) obj = JSON.parse(decodeURIComponent(escape(atob(t.slice(SHARE_PREFIX.length).replace(/\s+/g, '')))));
      else obj = JSON.parse(t);                                  // ancien format (JSON brut)
    } catch { throw new Error('code illisible, recopie-le en entier (il commence par WMBOT1:)'); }
    const settings = obj && obj.settings ? obj.settings : obj;
    if (!settings || typeof settings !== 'object' || !(settings.trading || settings.sell || settings.wishlist || settings.packs))
      throw new Error('ce ne sont pas des réglages du bot');
    return { settings: stripPersonal(settings), bot: (obj && obj.bot) || null };
  }
  function flatten(o, pre = '', out = {}) {
    for (const [k, v] of Object.entries(o || {})) {
      const key = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = JSON.stringify(v);
    }
    return out;
  }
  // réglages importés + ce qui est personnel à celui qui importe
  function importSettings(settings, mine = loadConfig()) {
    const next = sanitize(merge(DEFAULTS, JSON.parse(JSON.stringify(settings))));
    next.wishlist.items = JSON.parse(JSON.stringify(mine.wishlist.items));
    next.dryRun = mine.dryRun;
    const a = flatten(stripPersonal(mine)), b = flatten(stripPersonal(next));
    const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).length;
    // contrôle : chaque réglage reçu doit se retrouver à l'identique
    const sent = flatten(settings), got = flatten(stripPersonal(next));
    const mismatch = Object.keys(sent).filter(k => sent[k] !== got[k]);
    return { next, changed, mismatch };
  }

  // Reprise des enchères et ventes en cours d'une ancienne version du bot (réglages non repris)
  if (!localStorage.getItem(K.tracked) && localStorage.getItem('wmbot.tracked')) {
    const old = load('wmbot.tracked', {});
    save(K.tracked, Object.fromEntries(Object.entries(old).map(([id, t]) => [id, { title: t.title, rarity: t.rarity, cap: t.cap, source: 'wish', lastBid: t.lastBid, leading: true, end: t.end }])));
    save(K.listings, load('wmbot.listings', {}));
    ['wmbot.running', 'wmbot.lock'].forEach(k => localStorage.removeItem(k));
  }

  let config = loadConfig();
  let tracked = load(K.tracked, {});     // enchères placées par le bot : id -> { title, rarity, cap, source, card_id, value, lastBid, leading, end }
  let listings = load(K.listings, {});   // ventes lancées par le bot : id -> { title, rarity, base }
  const saveConfig = () => save(K.config, config);

  // ═════════════════════════ Utilitaires ═════════════════════════
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = ms => ms + Math.floor(Math.random() * ms * 0.25);
  const minNext = a => a.current_bid == null ? a.base_amount : Math.max(a.current_bid + 1, Math.ceil(a.current_bid * 1.1));
  const titleOf = c => (c && (c.wikipedia_title || c.title)) || '?';
  const rarityOf = a => a.snapshot_rarity || (a.card && a.card.rarity);
  const median = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
  const fmtLeft = ms => { if (ms <= 0) return 'maintenant'; const s = Math.round(ms / 1000); if (s < 60) return s + ' s'; const m = Math.floor(s / 60); if (m < 60) return m + ' min ' + String(s % 60).padStart(2, '0'); const h = Math.floor(m / 60); return h + ' h ' + String(m % 60).padStart(2, '0'); };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Heure du serveur (l'horloge du PC peut être décalée de plusieurs dizaines de secondes)
  let clockOffset = 0, clockKnown = false;
  let siteLatency = 1500;                                  // temps de réponse moyen du site (ms) — lent la journée, rapide la nuit
  // Site lent : la recherche de trading s'adapte. 1 = normal (≤ 2,5 s par réponse), jusqu'à 2 = très lent (≥ 5 s)
  const slowFactor = () => Math.min(2, Math.max(1, siteLatency / 2500));
  const srvNow = () => Date.now() + clockOffset;
  function syncClock(r) {
    const d = Date.parse(r.headers.get('date') || '');
    if (isNaN(d)) return;
    const off = d + 500 - Date.now();                       // l'en-tête est à la seconde près
    clockOffset = clockKnown ? Math.round(clockOffset * 0.8 + off * 0.2) : off;
    clockKnown = true;
  }
  const leftMs = end => new Date(end).getTime() - srvNow();   // temps restant réel d'une enchère

  let ui = null;
  function log(type, msg, data) {
    if (/<!doctype|<html/i.test(msg)) msg = msg.replace(/<!doctype[\s\S]*|<html[\s\S]*/i, m => cleanErr(m));   // filet : jamais de page HTML dans le journal
    const e = { t: new Date().toISOString(), type, msg, ...(data ? { data } : {}) };
    const shared = load(K.journal, []);
    shared.push(e);
    if (shared.length > 2000) shared.splice(0, shared.length - 2000);
    save(K.journal, shared);
    statNote(e);
    ui && ui.onLog(e);
    console.log('[WikiMasters Bot]', msg);
  }
  // Historique du rapport 24 h : le journal ne garde que 2000 lignes (une douzaine d'heures quand le bot tourne) ; les
  // événements utiles au rapport (mises, achats, ventes, blocages, clics, recherches…) sont aussi gardés à part, 26 h.
  function statNote(e) {
    const info = /^Trading : \d+ enchère|l’extension clique|^Déblocage par clic|: reprise après|^Bot (démarré|arrêté)/;
    if (!['bid', 'won', 'lost', 'sell', 'sold', 'unsold', 'pack', 'discard', 'alert', 'warn', 'error'].includes(e.type) && !(e.type === 'info' && info.test(e.msg))) return;
    const s = load(K.stats, []), cut = new Date(Date.now() - 26 * 3600000).toISOString();
    let i = 0;
    while (i < s.length && s[i].t < cut) i++;
    if (i) s.splice(0, i);
    s.push(e);
    save(K.stats, s);
  }

  // ═════════════════════════ API du site ═════════════════════════
  // ── Santé du site ──
  // Quand le site rame ou tombe (délais dépassés, erreurs 5xx, « serveur surchargé », page Cloudflare 525…), insister
  // l'enfonce et allonge les tours (5 tours de plus de 10 min le 07/10 au soir). Après 3 échecs d'affilée, pause des
  // tâches de fond (recherches, ventes, paquets) : 1 min, puis 2, 4, 8 et 15 min au plus tant que ça dure. Le suivi des
  // enchères et les mises de dernière seconde continuent, et pendant la pause une requête qui échoue n'est pas réessayée.
  let siteFails = 0, siteDownUntil = 0, siteDownLevel = 0;
  const siteDown = () => Date.now() < siteDownUntil;
  function siteResult(ok) {
    if (ok) {
      siteFails = 0;
      if (siteDownLevel && !siteDown()) { siteDownLevel = 0; log('info', 'Le site répond de nouveau : le bot reprend son rythme normal'); }
      return;
    }
    if (++siteFails < 3 || siteDown()) return;
    const min = Math.min(15, 2 ** siteDownLevel);
    siteDownLevel++; siteFails = 0; siteDownUntil = Date.now() + min * 60000;
    log('warn', `Le site répond mal (3 échecs d’affilée) : pause de ${min} min des recherches, ventes et paquets pour ne pas l’enfoncer. Le suivi de tes enchères continue.`);
  }

  async function api(path, opts = {}, retries = 3) {
    let last = null;
    if (siteDown()) retries = 1;                                  // site en difficulté : pas d'insistance
    for (let i = 0; i < retries; i++) {
      let r;
      // délai maximal : une requête sans réponse au bout de 20 s est abandonnée (le site se fige parfois)
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
      const t0 = Date.now();
      try { r = await fetch(path, { ...opts, signal: ctrl.signal }); } catch { clearTimeout(to); siteLatency = Math.round(siteLatency * 0.8 + (Date.now() - t0) * 0.2); siteResult(false); if (i + 1 < retries) await sleep(jitter(2500 * (i + 1))); continue; }
      clearTimeout(to);
      siteLatency = Math.round(siteLatency * 0.8 + (Date.now() - t0) * 0.2);
      syncClock(r);
      let body = null;
      try { body = await r.json(); } catch {}
      if (r.ok) { siteResult(true); return { ok: true, status: r.status, body }; }
      last = { ok: false, status: r.status, body };
      siteResult(!(r.status >= 500 || /surcharg/i.test(String((body && (body.error || body.message)) || ''))));
      if (r.status === 429 && body && body.error) return last;      // refus explicite (limite atteinte…) : inutile d'insister
      if (r.status === 429 || r.status >= 500) { if (i + 1 < retries) await sleep(jitter(2500 * (i + 1))); continue; }
      return last;
    }
    return last || { ok: false, status: 0, body: { error: 'le site ne répond pas' } };
  }
  const post = (path, json) => api(path, { method: 'POST', headers: json ? { 'Content-Type': 'application/json' } : {}, body: json ? JSON.stringify(json) : undefined }, 1);
  // Un message d'erreur peut être une page HTML entière (panne du serveur de données, page Cloudflare « 525 ») : on n'en
  // garde que le titre, et au plus 200 caractères
  const cleanErr = s => {
    s = String(s ?? '');
    if (/<!doctype|<html/i.test(s)) { const t = /<title>([^<]*)<\/title>/i.exec(s); s = 'page d’erreur : ' + (t ? t[1] : s.replace(/<[^>]*>/g, ' ')); }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > 200 ? s.slice(0, 199) + '…' : s;
  };
  const errOf = r => cleanErr((r.body && r.body.error) || ('erreur ' + r.status));

  async function getBalance() { const r = await api('/api/wikibidous'); return r.ok ? r.body.balance : null; }
  async function getAuction(id) { const r = await api('/api/marketplace/' + id); return r.ok ? (r.body.auction || r.body) : null; }
  async function getMine() { const r = await api('/api/marketplace?page=1&limit=1&mine=1'); return r.ok ? r.body : null; }
  async function searchMarket({ q, sort = 'recent', page = 1, rarities = [], retries = 3 }) {
    const p = new URLSearchParams({ page: String(page), limit: '50', sort });
    if (q) p.set('q', q);
    rarities.forEach(r => p.append('rarity', r));
    const r = await api('/api/marketplace?' + p.toString(), {}, retries);
    return r.ok ? r.body : null;
  }
  // Depuis le 07/10/2026, le site cherche aussi dans la description des cartes : pour un mot courant (« sein »), les
  // cartes qui portent ce titre peuvent être au-delà des 10 premières pages triées par prix. On lit donc les pages en
  // alternant trois tris (moins chères, plus chères, récentes) : elles ressortent vite dans l'un ou l'autre.
  // i = 0, 1, 2… → page Math.floor(i / 3) + 1 du tri TITLE_SORTS[i % 3] ; done : tris épuisés (à passer).
  const TITLE_SORTS = ['price_asc', 'price_desc', 'recent'];
  async function searchTitlePage(q, i, done) {
    const sort = TITLE_SORTS[i % 3];
    if (done.has(sort)) return { skip: true };
    const res = await searchMarket({ q, sort, page: Math.floor(i / 3) + 1 });
    if (res && !res.hasMore) done.add(sort);
    return res;
  }
  // Le site trie la collection de façon instable : d'un appel à l'autre une carte peut changer de page (pages qui se
  // chevauchent). On lit donc toutes les pages jusqu'à une page vide, sans s'arrêter sur un doublon, on dédoublonne,
  // et si le total annoncé par le site n'est pas atteint, on relit une seconde fois pour rattraper les cartes manquées.
  async function getCollection() {
    const byId = new Map();
    let expected = null;
    for (let pass = 0; pass < 2; pass++) {
      for (let p = 0; p < 100; p++) {
        const r = await api(`/api/my-collection?page=${p}&stats=${p === 0 && pass === 0 ? 1 : 0}`);
        if (!r.ok) throw new Error(`collection illisible (page ${p + 1} : ${r.status === 429 ? 'le site limite les requêtes, réessaie dans une minute' : errOf(r)})`);
        if (p === 0 && pass === 0 && typeof r.body.total === 'number') expected = r.body.total;
        if (p === 0 && pass === 0 && Array.isArray(r.body.pendingTradeCardIds)) collPendingTrade = new Set(r.body.pendingTradeCardIds);
        const page = r.body.collection || [];
        if (!page.length) break;
        page.forEach(e => byId.set(e.id, e));
      }
      if (expected == null || byId.size >= expected) break;
    }
    return [...byId.values()];
  }
  const collCache = { at: 0, data: null };
  let collPendingTrade = new Set();                        // cartes engagées dans un échange en attente (donnée de la collection)
  async function getCollectionCached(maxAge = 5 * 60000) {
    if (collCache.data && Date.now() - collCache.at < maxAge) return collCache.data;
    collCache.data = await getCollection();
    collCache.at = Date.now();
    return collCache.data;
  }
  const collInvalidate = () => { collCache.at = 0; };
  const collRemove = id => { if (collCache.data) collCache.data = collCache.data.filter(x => x.id !== id); };

  // Concurrence : les autres exemplaires de la même carte, dans la même rareté, actuellement en vente (cache court).
  // Même rareté : une copie C d'une carte bradée à 46 ne concurrence pas sa version L qui se vend 327.
  const compCache = new Map();   // titre normalisé|rareté -> { at, list: [{ id, price, bid }] }
  // shiny : true/false = ne compter que les exemplaires shiny / normaux ; absent = tous
  async function competition(title, rarity, excludeId, maxAge = 10 * 60000, shiny) {
    const key = norm(title) + '|' + (rarity || '') + (shiny == null ? '' : '|' + (shiny ? 's' : 'n'));
    let hit = compCache.get(key);
    if (!hit || Date.now() - hit.at > maxAge) {
      const me = await whoAmI();
      const res = await searchMarket({ q: title, sort: 'price_asc', page: 1, rarities: rarity ? [rarity] : [], retries: 1 });
      if (!res) return null;
      const list = (res.auctions || []).filter(a => a.status === 'active' && norm(titleOf(a.card)) === norm(title) && (!rarity || rarityOf(a) === rarity) && (shiny == null || !!a.is_shiny === shiny) && leftMs(a.end_at) > 60000 && a.seller_id !== me)
        .map(a => ({ id: a.id, price: minNext(a), bid: a.current_bid != null }));
      hit = { at: Date.now(), list };
      compCache.set(key, hit);
    }
    const others = hit.list.filter(x => x.id !== excludeId);
    return { count: others.length, cheapest: others.length ? Math.min(...others.map(x => x.price)) : null, withBids: others.filter(x => x.bid).length };
  }
  // Part de la valeur estimée réellement obtenue quand tes cartes se revendent (tes ventes des 7 derniers jours).
  // Seules comptent les ventes faites depuis la v1.7. Avant, le prix de mise en vente était calculé à partir de ce taux :
  // le bot bradait, prenait ses propres soldes pour le prix du marché, et le taux descendait tout seul jusqu'au plancher.
  const RATE_DEFAULT = 0.7, RATE_MIN_SALES = 8;
  if (!load(K.rateEpoch, 0)) save(K.rateEpoch, Date.now());
  function rateSales() {
    const since = Math.max(load(K.rateEpoch, 0), Date.now() - 7 * 864e5);
    return load(K.pnl, []).filter(e => e.status === 'sold' && e.value && e.sale && (e.soldAt || 0) >= since);
  }
  function resaleRate() {
    const sold = rateSales();
    if (sold.length < RATE_MIN_SALES) return RATE_DEFAULT;
    const r = sold.map(e => e.sale / e.value).sort((a, b) => a - b);
    return Math.min(1.1, Math.max(0.35, r[r.length >> 1]));
  }
  const rateText = () => {
    const n = rateSales().length;
    return n < RATE_MIN_SALES ? `${Math.round(RATE_DEFAULT * 100)} % par défaut (${n}/${RATE_MIN_SALES} ventes depuis la v1.7)` : `${Math.round(resaleRate() * 100)} % (${n} ventes)`;
  };

  let myId = null;
  async function whoAmI() {
    if (myId) return myId;
    const r = await api('/api/my-collection?page=0&stats=0');
    myId = r.ok && r.body.collection && r.body.collection[0] ? r.body.collection[0].user_id : null;
    return myId;
  }

  // ═════════════════════════ Estimation de valeur ═════════════════════════
  // Valeur = prix moyen des ventes passées de la carte (donnée du site). Jusqu'à 3× le prix habituel de sa rareté elle est
  // prise telle quelle ; entre 3× et 5× on n'en compte que 60 % (une moyenne très haute peut être gonflée) ; au-delà, plafonnée.
  // Le prix habituel de chaque rareté est appris en observant le marché (médiane des moyennes vues).
  const summaryCache = new Map();
  let market = load(K.market, { samples: {} });
  async function cardSummary(cardId, fast = false) {
    const hit = summaryCache.get(cardId);
    if (hit && Date.now() - hit.at < 30 * 60000) return hit.s;
    const r = await api(`/api/marketplace/cards/${cardId}/sales?scope=summary`, fast ? { timeoutMs: 12000 } : {}, fast ? 1 : 2);
    const s = r.ok ? (r.body.summary || {}) : null;
    if (s) summaryCache.set(cardId, { at: Date.now(), s });   // lecture ratée : pas gardée, la prochaine relit le site
    return s;
  }
  // Prix habituel d'une rareté = médiane d'UNE valeur par carte, notée seulement quand le trading estime cette carte dans
  // cette rareté. Avant (jusqu'au 04/10/2026) : chaque lecture de prix ajoutait toutes les raretés de la carte, recomptait
  // la même carte toutes les 30 min et comptait les cartes obscures des paquets → le prix baissait tout seul
  // (UR 50 → 26 en deux jours) et le trading n'achetait presque plus rien.
  function learnRef(cardId, r, avg) {
    market = load(K.market, { samples: {} });
    const m = market.cards = market.cards || {};
    const k = cardId + '|' + r;
    delete m[k]; m[k] = { r, v: avg };                     // ré-inséré à la fin : les plus anciennes partent en premier
    const keys = Object.keys(m);
    if (keys.length > 1500) for (const x of keys.slice(0, keys.length - 1500)) delete m[x];
    save(K.market, market);
  }
  function rarityRef(r) {
    const manual = Number(config.trading.manualRef[r]);
    if (manual > 0) return { value: manual, samples: null, manual: true };
    const vals = Object.values(market.cards || {}).filter(x => x.r === r).map(x => x.v);
    const arr = vals.length >= REF_MIN_SAMPLES ? vals : (market.samples[r] || []);   // anciennes observations en attendant
    return { value: arr.length >= REF_MIN_SAMPLES ? median(arr) : null, samples: arr.length, manual: false };
  }
  async function estimateValue(a, fast = false) {
    const r = rarityOf(a);
    const s = await cardSummary(a.card_id, fast);
    const ref = rarityRef(r).value;
    const cardAvg = s && s[r] && s[r].average > 0 ? Math.round(s[r].average) : null;
    if (cardAvg) learnRef(a.card_id, r, cardAvg);
    if (!ref) return { value: null, cardAvg, ref, why: 'prix habituel de la rareté pas encore appris' };
    if (cardAvg) {
      const hard = ref * 3, soft = ref * 5;
      const value = cardAvg <= hard ? cardAvg : Math.round(hard + (Math.min(cardAvg, soft) - hard) * 0.6);
      return { value, cardAvg, ref, why: cardAvg > hard ? `carte recherchée : moyenne ${cardAvg}, comptée avec prudence` : 'moyenne des ventes de la carte' };
    }
    return { value: ref, cardAvg, ref, why: 'jamais vendue : prix habituel de la rareté' };
  }

  // ═════════════════════════ Enchères ═════════════════════════
  const wishFor = title => config.wishlist.items.find(i => norm(i.title) === norm(title)) || null;   // titre EXACT (casse/accents ignorés)
  // Cartes de la liste déjà possédées : on relit la collection toutes les 10 min (et après chaque victoire).
  async function refreshOwned() {
    try {
      const coll = await getCollection();
      const map = {};
      for (const e of coll) {
        if (!e.card) continue;
        const k = norm(titleOf(e.card));
        (map[k] = map[k] || []).push(e.card.rarity);
      }
      save(K.owned, { at: Date.now(), map });
      checkTagTodos(coll);
      ui && ui.onOwned();
    } catch { /* collection illisible : on réessaiera */ }
  }
  function wishStatusText(item) {
    const x = load(K.wishInfo, {})[norm(item.title)];
    if (!x) return '<span class="muted">pas encore cherchée</span>';
    const ago = Math.round((Date.now() - x.at) / 60000);
    const when = ` <span class="muted">· ${ago < 1 ? 'à l’instant' : ago + ' min'}</span>`;
    const from = x.min != null ? `${x.min} <b class="r-${x.minRarity}">${x.minRarity}</b>` : '';
    const t = {
      none: '<span class="muted">Pas en vente</span>',
      too_expensive: `<span class="warn">Dès ${from} · trop cher</span>`,
      owned: '<span class="muted">Déjà possédée</span>',
      no_slot: `<span class="warn">Dès ${from} · plus de place pour miser</span>`,
      bid: `<span class="good">💰 Misé ${x.detail}</span>`,
      leading: `<span class="good">💰 En tête${x.detail ? ' · ' + x.detail : ''}</span>`,
      bidding: `<span class="warn">Dépassé${x.detail ? ' · ' + x.detail : ''}</span>`,
      sim: `<span class="muted">🧪 Miserait ${x.detail}</span>`,
      refused: '<span class="bad">Mise refusée</span>',
      error: '<span class="bad">Site muet</span>',
    }[x.status] || '';
    return t + when;
  }
  const ownedRarities = title => (load(K.owned, { map: {} }).map[norm(title)] || []);
  const wishCap = (item, rarity) => item.max != null && item.max !== '' ? Number(item.max) : Number(config.wishlist.defaultMax[rarity] ?? 0);
  const engaged = source => Object.values(tracked).filter(t => !source || t.source === source).reduce((s, t) => s + (t.leading ? t.lastBid : 0), 0);

  // ── Carte voulue au-dessus du seuil : c'est à l'utilisateur de décider (monter le seuil ou laisser tomber) ──
  // Une alerte par carte : { title, price, rarity, cap, auctionId, end, at, active, dismissed: [auctionId…] }.
  // « Laisser tomber » ignore cette enchère-là ; une autre enchère au-dessus du seuil relance l'alerte.
  const wishAlerts = () => load(K.wishAlerts, {});
  const activeWishAlerts = () => Object.values(wishAlerts()).filter(x => x.active && wishFor(x.title));
  function raiseWishAlert(item, d) {
    if (!item || item.notifyOver === false) return;
    const all = wishAlerts(), key = norm(item.title), cur = all[key] || { dismissed: [] };
    if ((cur.dismissed || []).includes(d.auctionId)) return;
    const fresh = !cur.active || cur.auctionId !== d.auctionId || cur.price !== d.price;
    all[key] = { ...cur, title: item.title, ...d, at: Date.now(), active: true };
    save(K.wishAlerts, all);
    if (fresh) {
      log('alert', `${item.title} dépasse ton seuil : ${d.price} (${d.rarity}), ton seuil est ${d.cap}. À toi de décider dans « Cartes voulues ».`);
      if (!hiddenState().wish.includes(d.auctionId)) notifyUser(`${item.title} : ${d.price} > seuil ${d.cap}`, 'wish');   // case « m'avertir » de la carte (sauf alerte masquée)
      ui && ui.onHuman();
    }
  }
  function clearWishAlert(title, dismiss = false) {
    const all = wishAlerts(), key = norm(title), cur = all[key];
    if (!cur || !cur.active) return;
    cur.active = false;
    if (dismiss && cur.auctionId) cur.dismissed = [...(cur.dismissed || []), cur.auctionId].slice(-30);
    save(K.wishAlerts, all);
    ui && ui.onHuman();
  }

  // ── Étiquette à mettre sur une carte voulue obtenue ──
  // La page Collection du site n'utilise pas /api/ pour les étiquettes : elle écrit directement dans sa base (Supabase),
  // tables « tags » (id, user_id, name, color) et « user_card_tags » (user_card_id, tag_id), avec la session du site.
  // Le bot fait pareil : il relit à chaque fois le cookie de session du site (il ne le garde ni ne l'envoie ailleurs que
  // vers la base du site) et la clé publique « anon » présente dans le code de la page.
  // Si ça échoue (session illisible, base changée…), la carte passe en action à faire (bleu) et tu la ranges toi-même.
  const tagNames = e => (Array.isArray(e && e.tags) ? e.tags : []).map(t => norm(typeof t === 'string' ? t : (t && (t.name || t.label || t.title)) || ''));
  function sbSession() {
    const parts = document.cookie.split(';').map(c => c.trim()).map(c => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)])
      .filter(([n]) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(n))
      .sort((a, b) => Number(a[0].split('.')[1] || 0) - Number(b[0].split('.')[1] || 0));
    if (!parts.length) return null;
    const ref = /^sb-([a-z0-9]+)-auth-token/.exec(parts[0][0])[1];
    try {
      let raw = decodeURIComponent(parts.map(p => p[1]).join(''));
      if (raw.startsWith('base64-')) {
        const bin = atob(raw.slice(7).replace(/-/g, '+').replace(/_/g, '/'));
        raw = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))) : decodeURIComponent(escape(bin));
      }
      const s = JSON.parse(raw);
      const token = Array.isArray(s) ? s[0] : s.access_token;
      return token ? { ref, token, userId: (s.user && s.user.id) || null } : null;
    } catch { return null; }
  }
  // clé publique de la base : cherchée une fois dans les scripts du site (jeton de rôle « anon » du même projet), puis gardée
  async function sbKey(ref) {
    const cached = load(K.sbKey, null);
    if (cached && cached.ref === ref) return cached.key;
    for (const src of [...document.scripts].map(s => s.src).filter(u => u && u.startsWith(location.origin))) {
      let t;
      try { t = await (await fetch(src, { cache: 'force-cache' })).text(); } catch { continue; }
      for (const m of t.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)) {
        try {
          const p = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (p.role === 'anon' && p.ref === ref) { save(K.sbKey, { ref, key: m[0] }); return m[0]; }
        } catch { /* pas un jeton lisible */ }
      }
    }
    return null;
  }
  async function sbFetch(path, { method = 'GET', body, prefer } = {}) {
    const s = sbSession();
    if (!s) throw new Error('session du site illisible (reconnecte-toi sur le site)');
    const key = await sbKey(s.ref);
    if (!key) throw new Error('clé publique de la base introuvable dans le code du site');
    const r = await fetch(`https://${s.ref}.supabase.co/rest/v1/${path}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { apikey: key, Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* réponse vide */ }
    if (r.status === 401) save(K.sbKey, null);              // clé ou session refusée : la clé sera recherchée de nouveau
    if (!r.ok) throw new Error((data && (data.message || data.error)) || ('erreur ' + r.status));
    return { data, userId: s.userId };
  }
  const TAG_COLORS = ['#093d8b', '#8b0950', '#0b6b3a', '#7a4b00', '#4b1d8b', '#00687a'];
  // range une carte de la collection (user_card_id) dans l'étiquette nommée ; crée l'étiquette si elle n'existe pas
  async function applyTag(userCardId, tagName) {
    const uid = (sbSession() || {}).userId || await whoAmI();
    if (!uid) throw new Error('compte introuvable');
    const { data: tags } = await sbFetch(`tags?select=id,name&user_id=eq.${encodeURIComponent(uid)}`);
    let tag = (tags || []).find(t => norm(t.name) === norm(tagName)), created = false;
    if (!tag) {
      const r = await sbFetch('tags?select=id,name', { method: 'POST', prefer: 'return=representation',
        body: { user_id: uid, name: tagName, color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] } });
      tag = Array.isArray(r.data) ? r.data[0] : r.data;
      created = true;
      if (!tag || !tag.id) throw new Error('étiquette non créée');
    }
    await sbFetch('user_card_tags?on_conflict=user_card_id,tag_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { user_card_id: userCardId, tag_id: tag.id } });
    return { tag, created };
  }
  function addTagTodo(item, rarity, how) {
    if (!item || !item.tag) return;
    const todo = load(K.tagTodo, []);
    if (todo.some(x => norm(x.title) === norm(item.title) && norm(x.tag) === norm(item.tag))) return;
    todo.push({ title: item.title, rarity, tag: item.tag, at: Date.now(), how });
    save(K.tagTodo, todo);
    log('info', `${item.title} (${rarity}) ${how} : le bot va la ranger dans l’étiquette « ${item.tag} » dès qu’elle sera dans ta collection`);
    next.tags = 0;
  }
  // Pose les étiquettes en attente : la carte doit d'abord apparaître dans la collection (on attend jusqu'à 30 min).
  // En cas d'échec, la carte passe en action à faire (bleu) : tu la ranges toi-même, le rappel s'efface tout seul ensuite.
  async function tagTick() {
    const todo = load(K.tagTodo, []).filter(x => !x.manual);
    if (!todo.length) return;
    collInvalidate();
    let coll;
    try { coll = await getCollectionCached(); } catch { return; }
    for (const x of todo) {
      const toManual = why => {
        const all = load(K.tagTodo, []), t = all.find(y => y.title === x.title && y.tag === x.tag);
        if (t) { t.manual = true; t.why = why; save(K.tagTodo, all); }
        log('alert', `${x.title} : étiquette « ${x.tag} » pas posée automatiquement (${why}). Range-la toi-même dans ta collection.`);
        notifyUser(`🏷 Range ${x.title} dans « ${x.tag} »`);
        ui && ui.onHuman();
      };
      const e = coll.filter(c => c.card && norm(titleOf(c.card)) === norm(x.title) && (!x.rarity || c.card.rarity === x.rarity))
        .sort((a, b) => new Date(b.obtained_at || 0) - new Date(a.obtained_at || 0))[0];
      if (!e) { if (Date.now() - x.at > 30 * 60000) toManual('carte toujours absente de ta collection après 30 min'); continue; }
      const done = () => { save(K.tagTodo, load(K.tagTodo, []).filter(y => !(y.title === x.title && y.tag === x.tag))); ui && ui.onHuman(); };
      if (tagNames(e).includes(norm(x.tag))) { done(); continue; }
      if (config.dryRun) { log('dry', `Simulation — rangerait ${x.title} (${e.card.rarity}) dans l’étiquette « ${x.tag} »`); done(); continue; }
      try {
        const r = await applyTag(e.id, x.tag);
        done(); collInvalidate();
        log('info', `🏷️ ${x.title} (${e.card.rarity}) rangée dans l’étiquette « ${r.tag.name} »${r.created ? ' (étiquette créée)' : ''}`);
      } catch (err) { toManual(err.message); }
      await sleep(jitter(800));
    }
  }
  function checkTagTodos(coll) {
    const todo = load(K.tagTodo, []);
    if (!todo.length) return;
    const left = todo.filter(x => !coll.some(e => e.card && norm(titleOf(e.card)) === norm(x.title) && tagNames(e).includes(norm(x.tag))));
    if (left.length !== todo.length) { save(K.tagTodo, left); log('info', `Étiquette posée : ${todo.length - left.length} rappel(s) effacé(s)`); ui && ui.onHuman(); }
  }

  // En cas d'échec, la raison est notée dans meta.refusal (pour le bilan du trading)
  async function placeBid(a, amount, meta, why, retried = false) {
    const refuse = reason => { meta.refusal = reason; return false; };
    if (humanFor('bids') && !takeProbe('bids')) return refuse('vérification humaine en attente');
    // solde connu de moins de 45 s : on évite une requête (précieux quand le site est lent)
    const bal = balance != null && Date.now() - balanceAt < 45000 ? balance : await getBalance();
    if (bal == null) { log('warn', `Solde illisible, mise annulée sur ${meta.title}`); return refuse('solde illisible'); }
    if (amount > meta.cap) return refuse('au-dessus du max');
    if (bal - amount < config.reserve) { log('skip', `${meta.title} : miser ${amount} ferait passer ton solde (${bal}) sous ta réserve (${config.reserve})`); return refuse('réserve atteinte'); }
    // cartes voulues et catégories prioritaires : le trading ne prend pas l'argent dont elles ont besoin pour monter jusqu'à leur max
    const keep = meta.source === 'trade' ? wishNeed() : 0;
    if (keep && bal - amount < config.reserve + keep) { log('skip', `${meta.title} : mise de trading ${amount} évitée, ${keep} gardés pour tes cartes voulues et catégories en cours`); return refuse('argent gardé pour les cartes voulues'); }
    if (config.dryRun) { log('dry', `Simulation — miserait ${amount} sur ${meta.title} (${meta.rarity}), max ${meta.cap} · ${why}`); return refuse('simulation'); }
    const r = await post(`/api/marketplace/${a.id}/bid`, { amount });
    if (!r.ok) {
      const msg = errOf(r);
      if (needsHuman(r)) { setHuman('bids', 'mise une fois à la main', r); return refuse('vérification humaine demandée'); }
      const min = /minimum\s+(\d+)/i.exec(msg);
      if (min && !retried && Number(min[1]) <= meta.cap) return placeBid(a, Number(min[1]), meta, why + ' · relancée au nouveau minimum', true);
      if (/termin/i.test(msg)) { log('skip', `Trop tard pour ${meta.title} : l’enchère était déjà terminée`); return refuse('terminée avant la mise'); }
      if (min) { log('skip', `${meta.title} : quelqu’un a surenchéri (minimum ${min[1]}, ton max ${meta.cap})`); return refuse('surenchérie juste avant'); }
      log('error', `Mise refusée sur ${meta.title} (${amount}) : ${msg}`);
      return refuse('refusée par le site');
    }
    if (r.body && typeof r.body.bidder_balance === 'number') { balance = r.body.bidder_balance; balanceAt = Date.now(); }
    clearHuman('bids');              // la mise est passée : la vérification a été faite
    tracked = load(K.tracked, {});
    tracked[a.id] = { ...meta, refusal: undefined, card_id: a.card_id, lastBid: amount, leading: true, end: a.end_at };
    save(K.tracked, tracked);
    log('bid', `Mise ${amount} sur ${meta.title} (${meta.rarity}), max ${meta.cap} · ${why}`, { auctionId: a.id });
    return true;
  }

  // ce qu'il faut encore pouvoir miser sur les cartes voulues et les catégories en cours (jusqu'à leur max)
  const wishNeed = () => Object.values(load(K.tracked, {})).filter(t => t.source === 'wish' || t.source === 'cat')
    .reduce((s, t) => s + Math.max(0, (t.cap || 0) - (t.leading ? t.lastBid || 0 : 0)), 0);
  // Pas de maximum : le site ne limite pas les mises (maxConcurrentAuctions = limite des ventes), le bot non plus.
  // Seul le trading garde sa propre limite (« Enchères de trading »). Le solde et la réserve restent les garde-fous.
  async function activeBidCount() {
    const mine = await getMine();
    const max = Infinity;
    const active = ((mine && mine.bidding) || []).filter(b => b.status === 'active');
    return { max, used: active.length, active };
  }

  // Cartes voulues : on cherche chaque titre exact et on prend l'enchère la moins chère sous le prix max.
  // Recherche des cartes voulues, 3 par tour pour ne pas bloquer le suivi des enchères (une recherche prend ~5 s).
  // Pour chaque carte, on garde un état lisible : pas en vente, trop chère, déjà possédée, misé…
  let wishCursor = 0;
  async function scanWishlist(only = null) {
    const tour = loopGen;                                   // tour abandonné par le garde-fou : la recherche s'arrête à la page suivante
    const items = only ? [only] : config.wishlist.items;
    if (!items.length) return true;
    if (only || wishCursor >= items.length) wishCursor = 0;
    setActivity(`Recherche des cartes voulues (${wishCursor + 1}/${items.length})…`);
    const me = await whoAmI();
    const slots = await activeBidCount();
    let free = slots.max - slots.used;
    const info = load(K.wishInfo, {});
    for (const item of items.slice(wishCursor, wishCursor + 3)) {
      const key = norm(item.title);
      const st = { at: Date.now(), count: 0, min: null, minRarity: null, minId: null, minEnd: null, status: 'none' };
      const mine = Object.values(tracked).find(t => norm(t.title) === key);
      if (mine && !item.all) { info[key] = { ...(info[key] || {}), at: Date.now(), status: mine.leading ? 'leading' : 'bidding', detail: mine.lastBid }; continue; }
      let leadingAlready = false, errors = 0, ownedSeen = 0, leadingN = 0;
      const dup = config.wishlist.allowDuplicates || !!item.all;   // « tous les exemplaires » : les doublons comptent aussi
      const viable = [];
      const doneSorts = new Set(), seenIds = new Set();
      for (let i = 0; i < 12 && doneSorts.size < 3 && !leadingAlready && tour === loopGen; i++) {
        const res = await searchTitlePage(item.title, i, doneSorts);
        if (res && res.skip) continue;
        if (!res) { errors++; continue; }                      // page en erreur : on passe à la suivante
        for (const a of res.auctions || []) {
          if (seenIds.has(a.id)) continue;                     // déjà vue avec un autre tri
          seenIds.add(a.id);
          if (a.status !== 'active' || norm(titleOf(a.card)) !== key || leftMs(a.end_at) <= 0) continue;
          const rarity = rarityOf(a), amount = minNext(a);
          st.count++;
          if (a.owned && !dup) { /* doublon : ne compte pas pour l'alerte de seuil */ }
          else if (st.min == null || amount < st.min) { st.min = amount; st.minRarity = rarity; st.minId = a.id; st.minEnd = a.end_at; }
          if (a.current_bidder_id === me) {
            if (!item.all) { leadingAlready = true; st.detail = a.current_bid; break; }
            leadingN++; continue;                                 // tous les exemplaires : on passe aux autres
          }
          if (item.all && tracked[a.id]) continue;               // déjà misée, dépassée : la surenchère s'en occupe
          let cap = wishCap(item, rarity);
          if (a.owned && !dup) { ownedSeen++; cap = 0; }
          if (cap > 0 && amount <= cap) viable.push({ a, rarity, cap, amount });
        }
        await sleep(jitter(400));
      }
      // meilleure rareté d'abord, puis le moins cher
      viable.sort((x, y) => (RANK[y.rarity] - RANK[x.rarity]) || (x.amount - y.amount));
      const why = item.all ? 'carte voulue · tous les exemplaires' : 'carte voulue';
      const best = leadingAlready ? null : viable[0] || null;

      if (leadingAlready) st.status = 'leading';
      else if (best) {
        // « Acheter tous les exemplaires possibles » : une mise sur chaque exemplaire sous le max, tant qu'il reste des places
        let placed = 0;
        for (const v of item.all ? viable : [best]) {
          if (free <= 0) break;
          if (await placeBid(v.a, v.amount, { title: titleOf(v.a.card), rarity: v.rarity, cap: v.cap, source: 'wish' }, why)) { if (!placed) st.detail = v.amount; placed++; free--; }
        }
        if (placed) st.status = 'bid';
        else if (free <= 0) st.status = 'no_slot';
        else { st.status = config.dryRun ? 'sim' : 'refused'; st.detail = best.amount; }
      }
      else if (leadingN) st.status = 'leading';
      else if (!st.count) st.status = errors ? 'error' : 'none';
      else if (ownedSeen === st.count) st.status = 'owned';
      else st.status = 'too_expensive';
      // au-dessus du seuil : alerte (pastille bleue) pour que l'utilisateur décide ; sinon l'alerte n'a plus lieu d'être
      if (st.status === 'too_expensive' && st.minId) raiseWishAlert(item, { price: st.min, rarity: st.minRarity, cap: wishCap(item, st.minRarity), auctionId: st.minId, end: st.minEnd });
      else if (['bid', 'leading', 'owned', 'none'].includes(st.status)) clearWishAlert(item.title);
      info[key] = st;
      await snipeTick();
    }
    save(K.wishInfo, info);
    ui && ui.onOwned();
    if (only) return true;                                       // recherche d'une seule carte (bouton ↻)
    wishCursor += 3;
    if (wishCursor < items.length) return false;              // il reste des cartes : on continue au prochain tour
    wishCursor = 0;
    const count = {};
    items.forEach(i => { const x = info[norm(i.title)]; if (x) count[x.status] = (count[x.status] || 0) + 1; });
    const label = { bid: 'misée(s)', leading: 'en tête', bidding: 'dépassée(s)', too_expensive: 'trop chère(s)', none: 'pas en vente', owned: 'déjà possédée(s)', no_deal: 'pas une bonne affaire', no_slot: 'sans emplacement libre', error: 'recherche en échec', sim: 'simulée(s)', refused: 'refusée(s)' };
    log('info', 'Cartes voulues : ' + (Object.entries(count).map(([k, n]) => `${n} ${label[k] || k}`).join(', ') || 'rien à signaler'));
    return true;
  }

  // ── Catégories voulues ──
  // Pour une catégorie (ex. « race de chien ») : les cartes en vente dont la catégorie contient ce texte, pas encore
  // possédées. Le bot mise si la prochaine mise est ≤ au max par carte ET ≤ N× le prix moyen de vente de cette carte dans
  // cette rareté (donnée du site) : un chihuahua qui se vend 30 en moyenne n'est pas acheté à 100 avec 2×, même sous le max.
  // Une carte jamais vendue (pas de prix moyen) est ignorée : rien pour juger du prix. Une catégorie par tour.
  // Texte exact : la carte doit contenir l'expression entière (mots complets, majuscules et accents ignorés) dans son
  // titre ou sa catégorie ; une seule copie par carte, toutes raretés confondues (jamais de doublon, quelle que soit
  // l'option « Accepter une carte que j'ai déjà ») ; une carte jamais vendue est prise quand même, sous le max par carte.
  // Étiquette : chaque carte gagnée y est rangée dès qu'elle arrive dans la collection (voir addTagTodo).
  let catCursor = 0, catQueue = null;
  const phraseRe = s => new RegExp('(^|[^a-z0-9])' + norm(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
  // carte voulue (titre exact) ou carte d'une catégorie voulue (active ou en pause) : jamais vendue ni défaussée
  const catOf = card => card ? config.wishlist.categories.find(cat => catMatch(cat, { card })) || null : null;
  const isWanted = card => !!(card && (wishFor(titleOf(card)) || catOf(card)));
  const catMatch = (cat, a) => {
    const c = a.card || {};
    if (!cat.exact) return norm(c.category || '').includes(norm(cat.name));
    const re = phraseRe(cat.name);
    return re.test(norm(titleOf(c))) || re.test(norm(c.category || ''));
  };
  async function scanCategories() {
    const tour = loopGen;                                   // tour abandonné par le garde-fou : la recherche s'arrête à la page suivante
    let cats = config.wishlist.categories.filter(c => c.enabled), only = false;
    if (catQueue) { const q = config.wishlist.categories.find(c => norm(c.name) === norm(catQueue)); catQueue = null; if (q) { cats = [q]; only = true; } }
    if (!cats.length) return true;
    if (only || catCursor >= cats.length) catCursor = 0;
    const cat = cats[catCursor], key = norm(cat.name);
    setActivity(`Catégorie « ${cat.name} »…`);
    const me = await whoAmI();
    const slots = await activeBidCount();
    let free = slots.max - slots.used;
    const st = { at: Date.now(), match: 0, bids: [], why: {} };
    const why = r => { st.why[r] = (st.why[r] || 0) + 1; };
    const busy = new Set(Object.values(load(K.tracked, {})).map(t => norm(t.title)));   // une seule mise à la fois par carte
    // texte exact : les cartes déjà dans ta collection (toutes raretés) ne sont jamais rachetées
    let have = new Set();
    if (cat.exact) { try { have = new Set((await getCollectionCached()).filter(e => e.card).map(e => norm(titleOf(e.card)))); } catch { /* collection illisible : on se fie à « déjà possédée » du site */ } }
    const best = new Map();                                    // carte|rareté → l'enchère la moins chère
    for (let page = 1; page <= 10 && tour === loopGen; page++) {
      const res = await searchMarket({ q: cat.name, sort: 'price_asc', page });
      if (!res) continue;
      const list = res.auctions || [];
      for (const a of list) {
        if (a.status !== 'active' || leftMs(a.end_at) <= 8000 || !catMatch(cat, a)) continue;
        st.match++;
        const amount = minNext(a);
        if (amount > cat.max) { why('au-dessus du max par carte'); continue; }
        if (a.seller_id === me) { why('ta propre vente'); continue; }
        if (a.current_bidder_id === me || busy.has(norm(titleOf(a.card)))) { why('déjà misée'); continue; }
        if ((a.owned && (cat.exact || !config.wishlist.allowDuplicates)) || have.has(norm(titleOf(a.card)))) { why('déjà possédée'); continue; }
        const k = norm(titleOf(a.card)) + '|' + rarityOf(a);
        if (!best.has(k) || amount < best.get(k).amount) best.set(k, { a, amount });
      }
      // trié par prix croissant : une fois le max dépassé, les pages suivantes sont toutes plus chères
      if (!res.hasMore || (list.length && minNext(list[list.length - 1]) > cat.max)) break;
      await sleep(jitter(400));
      await snipeTick();
    }
    // prix moyen de chaque carte (une lecture par carte, gardée 30 min) : les moins chères d'abord, 30 nouvelles lectures
    // au plus par tour (une catégorie peut compter des centaines de cartes) ; les prix déjà connus ne comptent pas, donc
    // chaque tour avance plus loin dans la catégorie
    const cands = [];
    let reads = 0;
    for (const { a, amount } of [...best.values()].sort((x, y) => x.amount - y.amount)) {
      const hit = summaryCache.get(a.card_id), known = hit && Date.now() - hit.at < 30 * 60000;
      if (!known && reads >= 30) { why('pas encore évaluée (tour suivant)'); continue; }
      if (!known) reads++;
      const rarity = rarityOf(a);
      const s = await cardSummary(a.card_id, true);
      const avg = s && s[rarity] && s[rarity].average > 0 ? Math.round(s[rarity].average) : null;
      if (!avg && !cat.exact) { why('jamais vendue : pas de prix moyen'); continue; }
      const cap = avg ? Math.min(cat.max, Math.floor(avg * cat.mult)) : cat.max;
      if (amount > cap) { why(`plus de ${cat.mult}× son prix moyen`); continue; }
      cands.push({ a, amount, rarity, avg, cap });
      await snipeTick();
    }
    cands.sort((x, y) => (x.avg ? x.amount / x.avg : 1e6 + x.amount) - (y.avg ? y.amount / y.avg : 1e6 + y.amount));   // les meilleures affaires d'abord, les jamais vendues ensuite
    for (const c of cands) {
      const title = titleOf(c.a.card);
      if (busy.has(norm(title))) continue;                     // la même carte dans une autre rareté : déjà misée ce tour-ci
      if (free <= 0) { why('plus d’emplacement de mise libre'); continue; }
      const meta = { title, rarity: c.rarity, cap: c.cap, source: 'cat', cat: cat.name, ...(cat.tag ? { tag: cat.tag } : {}) };
      const ok = await placeBid(c.a, c.amount, meta, c.avg ? `catégorie « ${cat.name} » : prix moyen ${c.avg}, max ${c.cap} (${cat.mult}× la moyenne, plafond ${cat.max})` : `catégorie « ${cat.name} » : jamais vendue, max ${c.cap}`);
      if (ok || config.dryRun) { busy.add(norm(title)); st.bids.push({ title, rarity: c.rarity, amount: c.amount, avg: c.avg, cap: c.cap, sim: !ok }); if (ok) free--; }
      else why(meta.refusal || 'mise refusée');
    }
    const info = load('wmbot1.catInfo', {});
    info[key] = st;
    save('wmbot1.catInfo', info);
    log('info', `Catégorie « ${cat.name} » : ${st.match} en vente, ${st.bids.length} ${config.dryRun ? 'mise(s) simulée(s)' : 'mise(s)'}${Object.keys(st.why).length ? ' · écartées : ' + Object.entries(st.why).map(([r, n]) => `${n} ${r}`).join(', ') : ''}`);
    ui && ui.onCat();
    if (only) return true;
    catCursor++;
    if (catCursor < cats.length) return false;                 // il reste des catégories : on continue au prochain tour
    catCursor = 0;
    return true;
  }

  // Bouton ↻ d'une carte voulue : relit ses enchères en cours, ou lance sa recherche s'il n'y a pas encore de mise.
  async function refreshWish(item) {
    const mine = Object.entries(load(K.tracked, {})).filter(([, t]) => t.source === 'wish' && norm(t.title) === norm(item.title));
    if (!mine.length) { await scanWishlist(item); return 'search'; }
    const me = await whoAmI();
    for (const [id, meta] of mine) {
      const a = await getAuction(id);
      if (!a) continue;
      if (a.status !== 'active') { next.follow = 0; continue; }        // terminée : le suivi normal fait le bilan
      const lead = a.current_bidder_id === me;
      setTracked(id, { ...meta, leading: lead, current: a.current_bid, need: minNext(a), end: a.end_at, ...(lead && a.current_bid != null ? { lastBid: a.current_bid } : {}) });
    }
    return 'bid';
  }
  // Surenchère manuelle : mise du montant choisi ; si c'est au-dessus du max, le max de la carte monte à ce montant.
  async function manualBid(item, auctionId, amount) {
    const a = await getAuction(auctionId);
    if (!a || a.status !== 'active' || leftMs(a.end_at) <= 0) return { ok: false, why: 'enchère terminée' };
    if (amount < minNext(a)) return { ok: false, why: `il faut au moins ${minNext(a)}` };
    const cfg = loadConfig(), it = cfg.wishlist.items.find(i => norm(i.title) === norm(item.title));
    if (it && !(Number(it.max) >= amount)) { it.max = amount; config = sanitize(cfg); saveConfig(); }
    const prev = load(K.tracked, {})[auctionId] || {};
    const meta = { ...prev, title: titleOf(a.card) || item.title, rarity: rarityOf(a), cap: Math.max(amount, Number(prev.cap) || 0, Number(it && it.max) || 0), source: 'wish' };
    const ok = await placeBid(a, amount, meta, 'surenchère manuelle');
    if (ok) clearWishAlert(item.title);
    return { ok, why: meta.refusal };
  }

  // ═════════════════════════ Bilan du trading ═════════════════════════
  // Sans bilan, un bot qui n'achète plus a l'air de ne rien faire : on note pourquoi chaque enchère regardée a été écartée
  // (une seule raison par enchère, la dernière), le bot en écrit le bilan toutes les heures et alerte après 2 h sans mise.
  const tstats = { since: Date.now(), scans: 0, skips: {}, why: new Map(), whySinceBid: new Map(), lastBidAt: Date.now(), alertedAt: 0 };
  function tally(id, reason) {
    tstats.why.set(id, reason);
    tstats.whySinceBid.set(id, reason);
    if (tstats.whySinceBid.size > 20000) tstats.whySinceBid.delete(tstats.whySinceBid.keys().next().value);
  }
  const skipScan = reason => { tstats.skips[reason] = (tstats.skips[reason] || 0) + 1; };
  function countReasons(m) {
    const c = {};
    for (const r of m.values()) c[r] = (c[r] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(', ');
  }
  function resetTradeStats() { Object.assign(tstats, { since: Date.now(), scans: 0, skips: {} }); tstats.why.clear(); }
  function tradeSummary() {
    const mins = Math.max(1, Math.round((Date.now() - tstats.since) / 60000));
    const skips = Object.entries(tstats.skips).map(([r, n]) => `${n} sautée(s) : ${r}`).join(', ');
    return `Bilan trading (${mins} min) : ${tstats.scans} recherche(s)${skips ? ` dont ${skips}` : ''} · ${tstats.why.size} enchère(s) regardée(s)${tstats.why.size ? ` : ${countReasons(tstats.why)}` : ''} · stock ${stockText()} · taux de revente ${rateText()} · site ${(siteLatency / 1000).toFixed(1)} s par réponse${slowFactor() > 1 ? ' (lent : recherche allongée)' : ''}`;
  }
  function tradeWatchdog(now) {
    if (now >= next.summary) { if (next.summary) log('summary', tradeSummary()); resetTradeStats(); next.summary = now + 3600000; }
    const quiet = now - tstats.lastBidAt;
    if (quiet > 2 * 3600000 && now - tstats.alertedAt > 2 * 3600000) {
      tstats.alertedAt = now;
      notifyUser(`Trading : aucune mise depuis ${Math.floor(quiet / 3600000)} h`);
      log('warn', `Aucune mise de trading depuis ${Math.floor(quiet / 3600000)} h. Enchères regardées depuis : ${tstats.whySinceBid.size}${tstats.whySinceBid.size ? ` (${countReasons(tstats.whySinceBid)})` : ''}. Stock ${stockText()}, taux de revente ${rateText()}. Vérifie les règles du trading (bénéfice minimum, raretés, budget, réserve).`);
    }
  }

  // Trading : enchères qui se terminent bientôt et dont le prix est bien sous la valeur estimée.
  function recordDeal(d) {
    const deals = load(K.deals, []);
    deals.unshift({ t: Date.now(), ...d });
    if (deals.length > 60) deals.length = 60;
    save(K.deals, deals);
    ui && ui.onDeals();
  }
  // Affaires repérées, en attente du bon moment pour miser (mise « au dernier moment » : moins de surenchères en face).
  const watch = new Map(Object.entries(load(K.watch, {})).filter(([, w]) => new Date(w.end) > Date.now()));   // id -> { title, rarity, cap, value, end } (sauvegardée : survit à un rechargement)
  const saveWatch = () => save(K.watch, Object.fromEntries(watch));
  const tradeBidsCount = () => Object.values(tracked).filter(t => t.source === 'trade').length;
  let snipeBusy = false;
  // Onglet en arrière-plan sans minuteur fiable : Chrome peut ne réveiller le bot qu'une fois par minute → on mise plus tôt
  const snipeWindowMs = () => {
    const base = Math.max(tcfg().snipeS * 1000, siteLatency * 3 + 8000);   // site lent → on mise plus tôt
    return document.hidden && !workerTicks ? Math.max(base, 75000) : base;
  };
  // prix max d'une enchère : celui des shiny pour une shiny (s'il est réglé), sinon le prix max par carte
  const maxFor = (a, tc) => a.is_shiny && tc.shinyMax > 0 ? tc.shinyMax : tc.maxPerCard;
  // mode shiny : le stock de trading a atteint shinyFocusAt % du stock max (0 % = toujours)
  const shinyFocusLimit = tc => Math.ceil(tc.maxStock * tc.shinyFocusAt / 100);
  const shinyFocus = tc => tc.shinyFocusAt < 100 && tradeStock() >= shinyFocusLimit(tc);
  // ── Achat automatique des shiny ──
  // Toute shiny trouvée (recherche Shiny ✦ ou recherche de trading) dont la prochaine mise est ≤ au prix de l'onglet Shiny
  // est mise en file : le bot mise le minimum à la fin de l'enchère et resurenchérit jusqu'à ce prix. Pas de règle de
  // bonne affaire, de budget ni de stock du trading : seulement le prix max et les emplacements de mise.
  const SHINY_LOG = 'wmbot1.shinyLog';
  function shinyLog(kind, x, extra = {}) {
    const l = load(SHINY_LOG, []);
    l.unshift({ t: Date.now(), kind, id: x.id, title: x.title, rarity: x.rarity, ...extra });
    if (l.length > 40) l.length = 40;
    save(SHINY_LOG, l);
  }
  function addShinyWatch(x) {                              // x = { id, title, rarity, price, end, mine }
    const t = config.trading, cap = t.shinyFindMax;
    if (!t.shinyAutoBuy || x.mine || tracked[x.id] || watch.has(x.id) || x.price > cap || leftMs(x.end) < 8000) return false;
    watch.set(x.id, { title: x.title, rarity: x.rarity, cap, value: null, end: x.end, shiny: true, autoShiny: true });
    saveWatch();
    shinyLog('watch', x, { price: x.price, cap });
    log('info', `✦ Shiny repérée : ${x.title} (${x.rarity}) à ${x.price}, mise prévue à la fin (max ${cap})`, { auctionId: x.id });
    return true;
  }
  async function snipeTick() {
    if (snipeBusy || !watch.size) return;
    snipeBusy = true;
    try {
      const tc = tcfg();
      const me = await whoAmI();
      for (const [id, w] of [...watch]) {
        const left = leftMs(w.end);
        if (left < 3000 || tracked[id]) { watch.delete(id); saveWatch(); if (!tracked[id]) tally(id, 'moment de miser raté'); continue; }
        if (tc.snipeS > 0 && left > snipeWindowMs()) continue;
        watch.delete(id); saveWatch();
        const a = await getAuction(id);
        if (!a || a.status !== 'active') { tally(id, 'terminée avant la mise'); continue; }
        if (a.current_bidder_id === me) continue;
        const price = minNext(a);
        if (w.autoShiny) {                                      // shiny en achat automatique : seulement son prix max
          const x = { id, title: w.title, rarity: w.rarity };
          const why = leftMs(a.end_at) < 2000 ? 'terminée avant la mise' : price > w.cap ? `montée à ${price} (max ${w.cap})`
            : null;
          if (why) { shinyLog('skip', x, { price, why }); log('skip', `✦ ${w.title} (${w.rarity}) : pas de mise, ${why}`, { auctionId: id }); continue; }
          const meta = { title: w.title, rarity: w.rarity, cap: w.cap, source: 'shiny' };
          const ok = await placeBid(a, price, meta, `shiny en achat automatique (max ${w.cap}), fin dans ${Math.round(left / 1000)} s`);
          shinyLog(ok ? 'bid' : 'skip', x, { price, why: ok ? null : meta.refusal || 'non misée' });
          continue;
        }
        let decision = 'misé', reason = 'misée';
        // « active » ne veut pas dire ouverte : le site garde actives des enchères déjà finies tant qu'il ne les a pas clôturées
        if (leftMs(a.end_at) < 2000) { decision = 'terminée avant la mise (trop tard)'; reason = 'terminée avant la mise'; }
        else if (price > w.cap) { decision = `monté à ${a.current_bid} avant la fin (ton max ${w.cap})`; reason = 'montée au-dessus du max avant la fin'; }
        else if (tradeStock() >= tc.maxStock) { decision = `stock plein (${tc.maxStock})`; reason = 'stock plein'; }
        // une shiny a son propre plafond : le budget trading ne doit pas l'empêcher de miser jusqu'à ce plafond
        else if (engaged('trade') + price > (w.shiny ? Math.max(tc.budget, maxFor({ is_shiny: true }, tc)) : tc.budget)) { decision = 'budget trading atteint'; reason = decision; }
        else if (tradeBidsCount() >= tc.maxBids) { decision = `déjà ${tc.maxBids} enchère(s) de trading`; reason = 'enchères de trading toutes prises'; }
        if (decision === 'misé') {
          const meta = { title: w.title, rarity: w.rarity, cap: w.cap, source: 'trade', value: w.value, shiny: !!w.shiny };
          const ok = await placeBid(a, price, meta, `bonne affaire : ${price} pour une valeur estimée à ${w.value}, fin dans ${Math.round(left / 1000)} s`);
          if (!ok) { reason = meta.refusal || 'non misée'; decision = config.dryRun ? 'simulation' : `non misé : ${reason}`; }
        }
        if (reason === 'misée' || reason === 'simulation') { tstats.lastBidAt = Date.now(); tstats.whySinceBid.clear(); }
        noteScanBid(id, reason === 'misée' ? `misé ${price} (max ${w.cap}) à ${Math.round(left / 1000)} s de la fin` : reason === 'simulation' ? `🧪 aurait misé ${price} (max ${w.cap})` : `pas misé : ${decision}`);
        tally(id, reason);
        recordDeal({ title: w.title, rarity: w.rarity, price, value: w.value, pct: Math.round(price / w.value * 100), decision });
      }
    } finally { snipeBusy = false; }
  }

  // ── Détail des recherches de trading (onglet Trading → Recherches) ──
  // Chaque recherche est enregistrée : critères appliqués, pages sondées et lues, enchères écartées d'office (par raison),
  // chaque carte estimée (valeur, %, bénéfice espéré, concurrents, décision, mise max) puis la mise réellement placée.
  const SCANS = 'wmbot1.scans';
  function saveScan(rec) {
    const s = load(SCANS, []);
    s.unshift(rec);
    if (s.length > 12) s.length = 12;
    save(SCANS, s);
    ui && ui.onScans();
  }
  // mise placée (ou non) sur une enchère repérée par une recherche : notée sur sa ligne
  function noteScanBid(id, text, field = 'bid') {         // field : 'bid' (mise placée) ou 'result' (gagnée, perdue…)
    const s = load(SCANS, []);
    for (const rec of s) { const row = (rec.rows || []).find(x => x.id === id); if (row) { row[field] = text; save(SCANS, s); ui && ui.onScans(); return; } }
  }
  async function scanTrading() {
    const tour = loopGen;                                   // tour abandonné par le garde-fou : la recherche s'arrête à la page suivante
    const tc = tcfg();
    tstats.scans++;
    if (!tc.rarities.length) { skipScan('aucune rareté de trading'); saveScan({ at: Date.now(), skipped: 'aucune rareté de trading cochée' }); return; }
    if (tradeStock() >= tc.maxStock) { skipScan('stock plein'); saveScan({ at: Date.now(), skipped: `stock plein (${tradeStock()}/${tc.maxStock}) : le bot revend avant de racheter` }); setActivity(`Stock plein (${tradeStock()}/${tc.maxStock}) : le bot revend avant de racheter`); return; }
    // stock presque plein : on garde la place pour les shiny (lues dans leurs raretés à elles, voir l'onglet Shiny)
    const focus = shinyFocus(tc);
    const shinyRar = tc.shinyFindRarities.length ? tc.shinyFindRarities : ['L'];
    setActivity(focus ? `Stock ${tradeStock()}/${tc.maxStock} : recherche de shiny seulement…` : 'Recherche de bonnes affaires…');
    const scanStart = Date.now();
    const me = await whoAmI();
    // site lent (≥ 3,75 s par réponse) : on regarde 2 min plus loin, pour repérer les enchères avant qu'il soit trop tard
    const windowMs = (tc.windowMin + (slowFactor() >= 1.5 ? 2 : 0)) * 60000;
    // Le tri « fin imminente » commence par des enchères déjà terminées que le site n'a pas encore clôturées
    // (parfois plus de 1 000, soit 25+ pages). On cherche d'abord la première page qui contient une enchère encore
    // ouverte (sauts de plus en plus grands puis dichotomie, en partant de la page trouvée au tour précédent),
    // puis on lit les pages suivantes jusqu'à dépasser la fenêtre de temps.
    const candidates = new Map();
    // raretés demandées au site : celles des shiny en mode shiny, sinon celles du trading + celles des shiny (pour toujours les voir)
    const want = focus ? shinyRar : RARITIES.filter(r => tc.rarities.includes(r) || shinyRar.includes(r));
    const rar = want.length === RARITIES.length ? [] : want;   // toutes les raretés = pas de filtre (requête plus légère)
    const lpKey = 'wmbot1.livepage' + (rar.length ? '.' + rar.join('') : '');   // la première page ouverte dépend des raretés lues
    const rate0 = resaleRate();
    const rec = { at: scanStart, focus, probes: [], read: [], pre: {}, rows: [], late: 0, notEst: 0,
      crit: { windowMin: Math.round(windowMs / 60000), threshold: tc.threshold, minValue: tc.minValue, minProfit: tc.minProfit, rarities: want,
        rate: rate0, refs: Object.fromEntries(want.map(r => [r, rarityRef(r).value])), maxPerCard: tc.maxPerCard, latency: siteLatency } };
    const row = (a, o) => rec.rows.push({ id: a.id, title: titleOf(a.card), rarity: rarityOf(a), shiny: !!a.is_shiny, price: minNext(a), left: Math.round(leftMs(a.end_at) / 1000), ...o });
    const pages = new Map();
    const getPage = async (page, fresh = false) => {
      if (!fresh && pages.has(page)) return pages.get(page);
      setActivity(`Recherche de bonnes affaires… (page ${page})`);
      const res = await searchMarket({ sort: 'ending_soon', page, rarities: rar, retries: 1 });   // une page en erreur : on passe à une autre
      pages.set(page, res);
      await snipeTick();
      return res;
    };
    // état d'une page : 'dead' (tout est terminé), 'live' (au moins une enchère ouverte), 'empty' (au-delà de la fin), 'error'
    // « ouverte » seulement à partir de 5 enchères ouvertes (ou toute la page) : une page de 49 enchères finies contient
    // parfois UNE enchère ouverte égarée (vu le 04/10/2026) ; la prendre pour la première page ouverte faisait tout rater
    const state = res => {
      if (!res) return 'error';
      const list = res.auctions || [];
      if (!list.length) return 'empty';
      const live = list.filter(a => leftMs(a.end_at) > 0).length;
      return live >= Math.min(5, list.length) ? 'live' : 'dead';
    };
    // Lecture depuis la page 1, 4 pages à la fois. Le tri « fin imminente » du site n'est qu'à peu près chronologique :
    // des pages d'enchères finies sont glissées au milieu des enchères en cours, des pages reviennent en double, et tout
    // se décale pendant que le site clôture les enchères finies (relevé du 05/10/2026 : les enchères des 4 prochaines
    // minutes étaient en pages 3 à 24, entrecoupées de pages finies, alors que la recherche par sauts partait de la page 30).
    // Les pages finies sont sautées, les doublons écartés (une enchère n'est comptée qu'une fois) ; arrêt après 3 pages
    // d'affilée entièrement après la fenêtre, une fois la fenêtre trouvée (ou 6 sans rien trouver).
    const sf = slowFactor();                                  // temps alloués allongés quand le site est lent
    let foundIn = 0, pastPages = 0, firstLive = null, stop = false;
    for (let page = 1; page <= 40 && !stop && tour === loopGen && Date.now() - scanStart < 70000 * sf; page += 4) {   // 40 pages au plus : ~800 enchères, sans trop solliciter le site
      const nums = [page, page + 1, page + 2, page + 3];
      const got = await Promise.all(nums.map(n => getPage(n, true)));
      for (let k = 0; k < nums.length && !stop; k++) {
        const res = got[k];
        if (!res) continue;
        const list = res.auctions || [];
        let live = 0, past = 0, inWin = 0;
        for (const a of list) {
          const left = leftMs(a.end_at);
          if (left > 0) live++;
          if (left > windowMs) { past++; continue; }
          if (left > 0) inWin++;
          if (a.status !== 'active' || left < 8000 || tracked[a.id] || watch.has(a.id) || a.current_bidder_id === me || a.seller_id === me) continue;
          // le site n'a pas de filtre shiny : on trie ici. Mode shiny : que des shiny ; sinon les raretés du trading + toutes les shiny
          if (focus ? !a.is_shiny : !a.is_shiny && !tc.rarities.includes(rarityOf(a))) continue;
          // shiny sous le prix de l'onglet Shiny avec l'achat automatique : mise en file directement, sans règle de bonne affaire
          if (a.is_shiny && addShinyWatch({ id: a.id, title: titleOf(a.card), rarity: rarityOf(a), price: minNext(a), end: a.end_at })) continue;
          candidates.set(a.id, a);
        }
        const lastA = list.slice(-1)[0];
        rec.read.push({ p: nums[k], n: list.length, w: inWin, upTo: lastA ? Math.round(leftMs(lastA.end_at) / 60000) : null, st: state(res) });
        if (inWin && firstLive == null) firstLive = nums[k];
        foundIn += inWin;
        // page « après la fenêtre » : une vraie page d'enchères (≥ 5 ouvertes) dont la plupart finissent après la fenêtre ;
        // une page d'enchères finies glissée au milieu ne compte pas (elle ne coupe pas la série)
        if (live >= 5) pastPages = past * 2 > live ? pastPages + 1 : 0;
        if ((pastPages >= 3 && foundIn > 0) || pastPages >= 6 || !list.length || !res.hasMore) stop = true;
      }
    }
    if (firstLive) save(lpKey, firstLive);
    rec.firstLive = firstLive; rec.seen = candidates.size;

    // pré-filtre sans requête : la valeur d'une carte ne dépasse jamais ~4,2× le prix habituel de sa rareté (3× + 60 % de 3×→5×),
    // donc on écarte d'office ce qui ne peut pas passer les règles (valeur minimum, seuil, bénéfice minimum)
    const list = [];
    for (const a of candidates.values()) {
      const ref = rarityRef(rarityOf(a)).value;
      if (ref) {
        const maxVal = Math.round(ref * 4.2), price = minNext(a);
        const why = maxVal < tc.minValue ? 'valeur trop basse' : price > maxVal * tc.threshold / 100 ? 'trop chère' : maxVal - price < tc.minProfit ? 'bénéfice insuffisant' : null;
        if (why) { tally(a.id, why); rec.pre[why] = (rec.pre[why] || 0) + 1; continue; }
      }
      list.push(a);
    }
    list.sort((x, y) => leftMs(x.end_at) - leftMs(y.end_at));   // celles qui finissent le plus tôt d'abord
    // estimations 8 par 8 en parallèle (le site met plusieurs secondes par réponse), 45 s au plus : le reste au tour suivant
    const deals = [];
    const estStart = Date.now();
    let i = 0;
    for (; i < list.length && tour === loopGen && Date.now() - estStart < 45000 * sf; i += 8) {
      setActivity(`Estimation des prix… (${Math.min(i + 8, list.length)}/${list.length})`);
      const slice = list.slice(i, i + 8);
      const batch = slice.filter(a => leftMs(a.end_at) > snipeWindowMs() / 2);   // déjà trop tard pour celles-ci
      slice.forEach(a => { if (!batch.includes(a)) { tally(a.id, 'vue trop tard'); rec.late++; } });
      const ests = await Promise.all(batch.map(a => estimateValue(a, true).catch(() => ({ value: null }))));
      const pre = [];
      const rate = resaleRate();
      batch.forEach((a, k) => {
        const est = ests[k], price = minNext(a);
        if (!est.value) { tally(a.id, 'valeur inconnue'); row(a, { decision: 'valeur inconnue (prix non lu)' }); return; }
        const pct = Math.round(price / est.value * 100);
        const why = pct > tc.threshold ? 'trop chère' : est.value < tc.minValue ? 'valeur trop basse' : est.value * rate - price < tc.minProfit ? 'bénéfice insuffisant' : price > maxFor(a, tc) ? (a.is_shiny && tc.shinyMax > 0 ? 'au-dessus du prix max shiny' : 'au-dessus du prix max par carte') : null;
        if (why) { tally(a.id, why); row(a, { value: est.value, valWhy: est.why, pct, profit: Math.round(est.value * rate - price), decision: why }); return; }
        pre.push({ a, est, price, pct });
      });
      // concurrence : combien d'autres exemplaires de même rareté sont en vente, et à quel prix ? (on revend au mieux juste sous le moins cher)
      // une shiny n'est en concurrence qu'avec les autres shiny de la même carte
      const comps = await Promise.all(pre.map(d => competition(titleOf(d.a.card), rarityOf(d.a), d.a.id, undefined, d.a.is_shiny ? true : undefined).catch(() => null)));
      const found = [];
      pre.forEach((d, k) => {
        const c = comps[k];
        let resale = Math.round(d.est.value * rate);
        if (c && c.cheapest != null) resale = Math.min(resale, c.cheapest - 1);
        const profit = resale - d.price;
        const title = titleOf(d.a.card);
        const base = { value: d.est.value, valWhy: d.est.why, pct: d.pct, resale, profit, comp: c ? `${c.count} en vente${c.cheapest != null ? `, dès ${c.cheapest}` : ''}` : null };
        if (c && c.count >= 6) row(d.a, { ...base, decision: 'trop de concurrents' });
        else if (profit < tc.minProfit) row(d.a, { ...base, decision: `bénéfice insuffisant (revente réaliste ≈ ${resale})` });
        else row(d.a, { ...base, decision: 'surveillée', cap: Math.min(maxFor(d.a, tc), Math.floor(d.est.value * tc.threshold / 100), resale - tc.minProfit) });
        if (c && c.count >= 6) { tally(d.a.id, 'trop de concurrents'); recordDeal({ title, rarity: rarityOf(d.a), price: d.price, value: d.est.value, pct: d.pct, decision: `écartée : ${c.count} autres en vente (dès ${c.cheapest})` }); return; }
        if (profit < tc.minProfit) { tally(d.a.id, 'bénéfice insuffisant (concurrent moins cher)'); recordDeal({ title, rarity: rarityOf(d.a), price: d.price, value: d.est.value, pct: d.pct, decision: `écartée : revente réaliste ≈ ${resale}${c && c.cheapest != null ? ` (concurrent à ${c.cheapest})` : ''}` }); return; }
        found.push({ ...d, profit, resale, comp: c });
      });
      // mise sous surveillance tout de suite (sans attendre la fin des estimations), les plus rentables d'abord
      found.sort((x, y) => y.profit - x.profit);
      for (const d of found) {
        const cap = Math.min(maxFor(d.a, tc), Math.floor(d.est.value * tc.threshold / 100), d.resale - tc.minProfit);
        watch.set(d.a.id, { title: titleOf(d.a.card), rarity: rarityOf(d.a), cap, value: d.est.value, end: d.a.end_at, shiny: !!d.a.is_shiny });
        tally(d.a.id, 'surveillée');
        recordDeal({ title: titleOf(d.a.card), rarity: rarityOf(d.a), price: d.price, value: d.est.value, pct: d.pct, why: d.est.why,
          decision: tc.snipeS > 0 ? `surveillée : revente ≈ ${d.resale}, bénéfice espéré +${d.profit}${d.comp ? ` · ${d.comp.count} concurrent(s)` : ''}` : 'mise immédiate' });
      }
      if (found.length) saveWatch();
      deals.push(...found);
      await snipeTick();
    }
    list.slice(i).forEach(a => tally(a.id, 'pas estimée à temps'));
    rec.notEst = list.length - i; rec.estimated = list.length; rec.durS = Math.round((Date.now() - scanStart) / 1000);
    saveScan(rec);
    log('info', `Trading : ${candidates.size} enchère(s) finissant bientôt regardée(s), ${deals.length} bonne(s) affaire(s) mise(s) sous surveillance (${Math.round((Date.now() - scanStart) / 1000)} s)`);
    await snipeTick();
  }

  // ── Historique des achats ──
  // Chaque enchère gagnée (trading, carte voulue, catégorie, shiny). Au premier affichage, rempli depuis le Journal
  // (lignes « Gagnée : … pour … ») pour retrouver les achats faits avant cette version.
  const BUYS = 'wmbot1.buys';
  function recordBuy(x) {
    const b = loadBuys();
    if (b.some(y => y.id === x.id)) return;
    b.unshift({ t: Date.now(), ...x });
    if (b.length > 500) b.length = 500;
    save(BUYS, b);
  }
  function loadBuys() {
    const b = load(BUYS, null);
    if (b) return b;
    const pnlIds = new Set(load(K.pnl, []).map(e => e.id));
    const out = [];
    for (const e of load(K.journal, [])) {
      const m = e.type === 'won' && /^Gagnée : (.+) \((L|UR|SR|R|PC|C)\) pour (\d+)/.exec(e.msg || '');
      if (!m) continue;
      const id = e.data && e.data.auctionId;
      out.unshift({ t: Date.parse(e.t), id, title: m[1], rarity: m[2], price: Number(m[3]), source: id && pnlIds.has(id) ? 'trade' : null });
    }
    save(BUYS, out);
    return out;
  }
  function setTracked(id, meta) {                       // relit avant d'écrire : une autre tâche a pu ajouter une mise
    const t = load(K.tracked, {});
    if (meta) t[id] = meta; else delete t[id];
    save(K.tracked, t);
    tracked = t;
  }
  // Suivi de nos enchères : surenchère au minimum tant qu'on reste sous le max, puis bilan.
  async function followBids() {
    const me = await whoAmI();
    tracked = load(K.tracked, {});
    let soonest = Infinity;
    for (const [id, meta] of Object.entries(tracked)) {
      await snipeTick();
      const a = await getAuction(id);
      if (!a) continue;
      const endMs = new Date(a.end_at).getTime();
      if (a.status !== 'active') {
        const won = a.winner_id ? a.winner_id === me : a.current_bidder_id === me;
        const price = a.final_price ?? a.current_bid;
        if (won) {
          log('won', `Gagnée : ${meta.title} (${meta.rarity}) pour ${price}`, { auctionId: id });
          noteScanBid(id, `🎉 gagnée pour ${price}`, 'result');
          recordBuy({ id, title: meta.title, rarity: meta.rarity, price, source: meta.source, cat: meta.cat, shiny: meta.source === 'shiny' || !!meta.shiny });
          if (meta.source === 'wish') {
            ui && ui.flash(`🎉 Tu as gagné ${meta.title} !`); next.owned = 0;
            clearWishAlert(meta.title);
            addTagTodo(wishFor(meta.title), meta.rarity, `gagnée pour ${price}`);
          }
          if (meta.source === 'cat') {
            ui && ui.flash(`🎉 ${meta.title} gagnée (catégorie « ${meta.cat} »)`); next.owned = 0;
            const cc = config.wishlist.categories.find(c => norm(c.name) === norm(meta.cat || ''));
            const tag = (cc && cc.tag) || meta.tag;
            if (tag) addTagTodo({ title: meta.title, tag }, meta.rarity, `gagnée pour ${price} (catégorie « ${meta.cat} »)`);
          }
          if (meta.source === 'shiny') {
            ui && ui.flash(`🎉 ✦ Shiny gagnée : ${meta.title} pour ${price} !`);
            shinyLog('won', { id, title: meta.title, rarity: meta.rarity }, { price });
            notifyUser(`🎉 ✦ Shiny gagnée : ${meta.title} (${meta.rarity}) pour ${price}`, 'shiny');
          }
          collInvalidate();
          if (meta.source === 'trade' && meta.shiny) {
            // shiny achetée en trading : gardée (sa « valeur » est celle de la carte normale, la revendre la brader)
            const pnl = load(K.pnl, []);
            pnl.unshift({ id, card_id: a.card_id, title: meta.title, rarity: meta.rarity, cost: price, value: meta.value || null, boughtAt: Date.now(), status: 'kept', keptWhy: 'shiny ✦' });
            save(K.pnl, pnl);
            shinyLog('won', { id, title: meta.title, rarity: meta.rarity }, { price });
            ui && ui.flash(`🎉 ✦ Shiny gagnée : ${meta.title} pour ${price} (gardée)`);
            notifyUser(`🎉 ✦ Shiny gagnée : ${meta.title} (${meta.rarity}) pour ${price}`, 'shiny');
            ui && ui.onPnl();
          } else if (meta.source === 'trade') {
            const pnl = load(K.pnl, []);
            pnl.unshift({ id, card_id: a.card_id, title: meta.title, rarity: meta.rarity, cost: price, value: meta.value || null, boughtAt: Date.now(), status: 'held' });
            save(K.pnl, pnl);
            ui && ui.onPnl();
            if (config.trading.autoResell && meta.value) queueResell(id);
          }
        } else {
          log('lost', `Perdue : ${meta.title} (${meta.rarity}), partie à ${price}`, { auctionId: id });
          noteScanBid(id, `✗ perdue, partie à ${price}`, 'result');
          if (meta.source === 'shiny') shinyLog('lost', { id, title: meta.title, rarity: meta.rarity }, { price, cap: meta.cap });
        }
        setTracked(id, null);
        continue;
      }
      if (endMs < srvNow() - 30000) continue;
      soonest = Math.min(soonest, endMs);
      const leading = a.current_bidder_id === me;
      if (leading !== meta.leading || a.current_bid !== meta.current || a.end_at !== meta.end) { Object.assign(meta, { leading, current: a.current_bid, need: minNext(a), end: a.end_at }, leading && a.current_bid != null ? { lastBid: a.current_bid } : {}); setTracked(id, meta); }
      if (leading) continue;
      const amount = minNext(a);
      if (amount > meta.cap) {
        log('lost', `Dépassé sur ${meta.title} : ${a.current_bid} (il faudrait ${amount}, ton max est ${meta.cap}) — abandon`, { auctionId: id });
        noteScanBid(id, `✗ dépassée à ${a.current_bid} (il fallait ${amount}, max ${meta.cap})`, 'result');
        if (meta.source === 'shiny') shinyLog('outbid', { id, title: meta.title, rarity: meta.rarity }, { price: a.current_bid, cap: meta.cap });
        if (meta.source === 'wish') raiseWishAlert(wishFor(meta.title), { price: amount, rarity: meta.rarity, cap: meta.cap, auctionId: id, end: a.end_at });
        setTracked(id, null);
        continue;
      }
      // fin proche : la surveillance de fin d'enchère (minuteur d'1 s) s'en charge ; miser ici aussi pourrait doubler la mise
      if (!config.dryRun && leftMs(a.end_at) < guardWindow()) continue;
      await placeBid(a, amount, meta, `surenchère (prix actuel ${a.current_bid})`);
      await sleep(jitter(600));
    }
    return soonest;
  }

  // Fin d'enchère : TOUTES nos mises (cartes voulues, catégories, trading) sont relues de près à l'approche de la fin et
  // resurenchéries aussitôt si quelqu'un passe devant (toujours dans la limite du max). Minuteur à part (1 s), qui tourne
  // même quand la boucle principale est occupée par une longue recherche. Une mise dans les 10 dernières secondes prolonge
  // l'enchère de 60 s (règle du site) : la fin est relue à chaque fois et la fenêtre suit la prolongation.
  // Normal : 45 dernières secondes, une lecture toutes les 2,5 s. Turbo : 90 dernières secondes, une lecture par seconde.
  // Enchères relues en parallèle (une lecture prend 2 à 8 s quand le site est chargé).
  const guardWindow = () => config.mode === 'turbo' ? 90000 : 45000;
  const guardBusy = new Set();
  const guardAt = new Map();
  async function endGuardTick() {
    if (config.dryRun) return;
    const every = config.mode === 'turbo' ? 1000 : 2500, win = guardWindow();
    const late = Object.entries(load(K.tracked, {})).filter(([id, t]) => t.end && leftMs(t.end) < win && leftMs(t.end) > -5000
      && !guardBusy.has(id) && Date.now() - (guardAt.get(id) || 0) >= every);
    if (!late.length) return;
    const me = await whoAmI();
    await Promise.all(late.map(async ([id]) => {
      guardBusy.add(id); guardAt.set(id, Date.now());
      try {
        const a = await getAuction(id);
        if (!a || a.status !== 'active') return;                   // terminée : le suivi normal fait le bilan
        const cur = load(K.tracked, {})[id];
        if (!cur) return;                                           // plus suivie entre-temps
        const lead = a.current_bidder_id === me;
        // fin prolongée, prix monté… : on note tout de suite, la fenêtre de surveillance suit la nouvelle fin
        setTracked(id, { ...cur, end: a.end_at, leading: lead, current: a.current_bid, need: minNext(a), ...(lead && a.current_bid != null ? { lastBid: a.current_bid } : {}) });
        if (lead) return;
        const amount = minNext(a);
        if (amount > cur.cap) {
          if (cur.source === 'wish') raiseWishAlert(wishFor(cur.title), { price: amount, rarity: cur.rarity, cap: cur.cap, auctionId: id, end: a.end_at });
          return;                                                   // le suivi normal note l'abandon
        }
        await placeBid(a, amount, load(K.tracked, {})[id] || cur, `fin d’enchère : resurenchère (prix actuel ${a.current_bid}, fin dans ${Math.max(0, Math.round(leftMs(a.end_at) / 1000))} s)`);
      } finally { guardBusy.delete(id); }
    }));
    const t = load(K.tracked, {});
    for (const id of guardAt.keys()) if (!t[id]) guardAt.delete(id);
  }

  // ═════════════════════════ Registre des bénéfices du trading ═════════════════════════
  // Chaque carte gagnée en trading y est notée avec son prix d'achat ; sa revente par le bot y ajoute le prix de vente.
  function updatePnl(id, patch) {
    const pnl = load(K.pnl, []);
    const e = pnl.find(x => x.id === id);
    if (e) { Object.assign(e, patch); save(K.pnl, pnl); ui && ui.onPnl(); }
    return e;
  }
  // Prix de revente : valeur estimée × % de départ, baissé de resellDrop % à chaque invendu.
  // Jamais sous le prix d'achat, sauf si la vente à perte est autorisée et que la carte est restée invendue lossAfter fois.
  // Si beaucoup de cartes attendent (plus que les 5 emplacements de vente), on brade davantage pour faire tourner le stock.
  // Le % de départ est fixe : il ne dépend plus du taux de revente appris (sinon le taux s'entraîne lui-même vers le bas).
  function stockPressure() {
    const stock = stockCounts().counted;
    return Math.min(1, Math.max(0, (stock - 5) / Math.max(5, tcfg().maxStock)));
  }
  // Liquidation : une carte restée invendue liquidateAfter fois peut partir à perte, jusqu'à liquidateFloor % de son prix d'achat.
  const isLiquidating = e => (e.attempts || 0) >= tcfg().liquidateAfter;
  // carte de ta collection ou d'un paquet (prix d'achat 0) : le plancher se calcule sur sa valeur, sinon il tombait à 1
  const liquidationFloor = e => Math.max(1, Math.round((e.cost || e.value || 0) * tcfg().liquidateFloor / 100));
  function resellPrice(e) {
    if (e.liq) return Math.max(1, e.cost + (e.liq.add != null ? e.liq.add : e.liq.keepProfit ? 1 : -e.cost));   // liquidation : prix payé + montant choisi
    const tc = tcfg(), tries = e.attempts || 0;
    const disc = 1 - (tc.stockDiscount || 0) / 100 * stockPressure();
    const base = (e.value || e.cost) * tc.resellPercent / 100 * Math.pow(1 - tc.resellDrop / 100, tries) * disc;
    const floor = !e.cost ? liquidationFloor(e) : isLiquidating(e) ? liquidationFloor(e) : tc.allowLoss && tries >= tc.lossAfter ? 1 : e.cost + 1;
    return Math.max(Math.round(base), floor);
  }
  // Ordre de revente : ta priorité d'abord (▲ ▼ dans Stock du bot), puis les liquidations, les cartes achetées, celles
  // de ta collection, et les dormantes en dernier ; à égalité, les plus rentables. Même ordre pour la revente et l'affichage.
  const prioOf = e => (e && e.prio) | 0;
  const dormantForSale = e => isDormant(e) && !e.liq && !(prioOf(e) > 0);   // une dormante mise en priorité passe comme une normale
  const resaleCmp = (a, b) => (prioOf(b) - prioOf(a)) || (!!b.liq - !!a.liq) || (dormantForSale(a) - dormantForSale(b))
    || ((a.source === 'collection') - (b.source === 'collection')) || (((b.value || 0) - (b.cost || 0)) - ((a.value || 0) - (a.cost || 0)));
  function queueResell(pnlId) {
    const e = load(K.pnl, []).find(x => x.id === pnlId);
    if (!e) return;
    const q = load(K.resell, []);
    if (q.some(x => x.pnlId === pnlId)) return;
    q.push({ pnlId, card_id: e.card_id, title: e.title, rarity: e.rarity, price: resellPrice(e) });
    save(K.resell, q);
  }
  const inStock = e => e.status === 'held' || e.status === 'listed';
  // Cartes dormantes : restées invendues dormantAfter fois d'affilée. Mesuré le 01/10/2026 sur 24 h : dès leur 4e mise
  // en vente elles rapportent 3× moins par heure d'emplacement, et elles gardaient le stock plein (donc plus d'achats)
  // 42 % du temps. Elles passent donc après les autres à la revente et ne comptent plus dans le stock maximum,
  // dans la limite de maxDormant (au-delà, le surplus compte de nouveau : le capital immobilisé reste borné).
  const isDormant = e => (e.attempts || 0) >= tcfg().dormantAfter;
  function stockCounts() {
    const held = load(K.pnl, []).filter(e => inStock(e) && e.source !== 'collection');   // les cartes confiées depuis ta collection ne bloquent pas les achats
    const dormant = held.filter(isDormant).length;
    return { held: held.length, dormant, counted: held.length - Math.min(dormant, tcfg().maxDormant) };
  }
  const tradeStock = () => stockCounts().counted + Object.values(tracked).filter(t => t.source === 'trade').length;
  const stockText = () => { const s = stockCounts(); return `${tradeStock()}/${tcfg().maxStock}${s.dormant ? ` (+ ${s.dormant} dormante(s))` : ''}`; };
  function pnlStats() {
    const pnl = load(K.pnl, []);
    const sold = pnl.filter(e => e.status === 'sold');
    const held = pnl.filter(inStock);
    const kept = pnl.filter(e => e.status === 'kept');
    const sum = (arr, f) => arr.reduce((t, e) => t + (f(e) || 0), 0);
    return {
      pnl, sold, held, kept,
      spent: sum(pnl, e => e.cost),
      revenue: sum(sold, e => e.sale),
      realized: sum(sold, e => e.sale - e.cost),
      latent: sum(held.filter(e => e.value), e => e.value - e.cost),
    };
  }

  // Boutons « dormantes » : liquider tout de suite (passent en liquidation au prochain emplacement libre),
  // ou les rendre à la collection (elles sortent du stock du trading : le bot peut racheter, à toi de les vendre ou défausser).
  function liquidateDormantNow() {
    const tc = tcfg(), pnl = load(K.pnl, []);
    const list = pnl.filter(e => inStock(e) && isDormant(e) && (e.attempts || 0) < tc.liquidateAfter);
    list.forEach(e => { e.attempts = tc.liquidateAfter; });
    save(K.pnl, pnl);
    pnl.filter(e => e.status === 'held' && isDormant(e)).forEach(e => queueResell(e.id));
    log('info', `${list.length} carte(s) dormante(s) passée(s) en liquidation : elles peuvent partir à perte, jamais sous ${tc.liquidateFloor} % de leur prix d’achat`);
    ui && ui.onPnl();
    return list.length;
  }
  function releaseDormant() {
    const pnl = load(K.pnl, []);
    const list = pnl.filter(e => e.status === 'held' && isDormant(e));      // celles en vente finissent leur vente d'abord
    list.forEach(e => { e.status = 'kept'; e.keptWhy = 'rendue à ta collection (dormante)'; });
    save(K.pnl, pnl);
    save(K.resell, load(K.resell, []).filter(q => !list.some(e => e.id === q.pnlId)));
    log('info', `${list.length} carte(s) dormante(s) rendue(s) à ta collection : elles ne comptent plus dans le stock du trading`);
    ui && ui.onPnl();
    return list.length;
  }

  // ── Stock du trading : actions sur des cartes choisies ──
  // Liquider : la carte passe en tête de la revente, mise à prix d'achat + 1 (bénéfice) ou à 1 (enchère qui part de très bas).
  // Une carte déjà en vente est liquidée à la fin de sa vente actuelle si elle ne part pas.
  function liquidateEntries(ids, add) {
    const pnl = load(K.pnl, []);
    const list = pnl.filter(e => ids.includes(e.id) && inStock(e));
    list.forEach(e => { e.liq = { add: Math.round(Number(add) || 0), at: Date.now() }; });
    save(K.pnl, pnl);
    list.filter(e => e.status === 'held').forEach(e => queueResell(e.id));
    log('info', `${list.length} carte(s) en liquidation au prix payé ${add >= 0 ? '+' : '−'} ${Math.abs(add)} : ${list.map(e => `${e.title} (${resellPrice(e)})`).join(', ')}`);
    next.sort = 0; ui && ui.onPnl();
    return list.length;
  }
  // Défausser : la carte du stock est détruite (+1 WikiBidou). Seulement celles qui ne sont pas en vente en ce moment.
  async function discardEntries(ids) {
    return withSellLock(async () => {
      collInvalidate();
      const coll = await getCollectionCached();
      const pnl = load(K.pnl, []);
      const list = pnl.filter(e => ids.includes(e.id) && e.status === 'held');
      const found = list.map(e => ({ e, c: coll.find(x => x.id === e.entryId) || coll.find(x => x.card && x.card.id === e.card_id && x.card.rarity === e.rarity) }))
        .filter(x => x.c && !isProtected(x.c));
      if (!found.length) return { done: 0, skipped: list.length };
      const desc = found.map(x => `${x.e.title} (${x.e.rarity})`).join(', ');
      if (config.dryRun) { log('dry', `Simulation — défausserait du stock : ${desc}`); return { done: 0, skipped: 0, sim: found.length }; }
      const r = await post('/api/user-cards/bulk-discard', { card_ids: found.map(x => x.c.id) });
      if (!r.ok) throw new Error(errOf(r));
      found.forEach(x => { x.e.status = 'discarded'; delete x.e.liq; });
      save(K.pnl, pnl);
      save(K.resell, load(K.resell, []).filter(q => !found.some(x => x.e.id === q.pnlId)));
      found.forEach(x => collRemove(x.c.id));
      log('discard', `Défaussé du stock : ${desc}`);
      ui && ui.onPnl();
      return { done: found.length, skipped: list.length - found.length };
    });
  }
  // Retirer : la carte sort du stock et reste dans ta collection (le bot ne la revendra plus, même si sa rareté est confiée)
  function releaseEntries(ids) {
    const pnl = load(K.pnl, []);
    const list = pnl.filter(e => ids.includes(e.id) && e.status === 'held');
    list.forEach(e => { e.status = 'kept'; e.keptWhy = 'retirée du stock'; delete e.liq; });
    save(K.pnl, pnl);
    keepCards(list.map(e => e.entryId).filter(Boolean));
    save(K.resell, load(K.resell, []).filter(q => !list.some(e => e.id === q.pnlId)));
    log('info', `${list.length} carte(s) retirée(s) du stock, gardée(s) dans ta collection : ${list.map(e => e.title).join(', ')}`);
    ui && ui.onPnl();
    return list.length;
  }

  // ── Analyse de la collection ──
  // Toute la collection, regroupée par carte + rareté (+ shiny à part) : le prix de vente moyen donné par le site, le
  // bénéfice possible = ce prix × ton taux de revente réel, et ce qui protège ou occupe chaque carte (favori, étiquette,
  // voulue, gardée, stock du bot, en vente, échange). Seules les copies « libres » peuvent partir au stock ou être gardées.
  // Une lecture par carte (une à la fois, résultat gardé 30 min) : sur une grosse collection, ça prend quelques minutes.
  let analysisStop = false;
  // ce qui protège ou occupe un exemplaire de la collection (vide = libre)
  function entryFlags(e, stockState) {
    const f = [], title = titleOf(e.card);
    if (e.starred) f.push('fav');
    if (Array.isArray(e.tags) && e.tags.length) f.push('tag');
    if (wishFor(title)) f.push('wish');
    if (keepIds[e.id] || config.keepTitles.some(k => norm(k) === norm(title))) f.push('kept');
    const s = stockState.get(e.id);
    if (s) f.push(s === 'listed' ? 'listed' : 'stock');
    if (collPendingTrade.has(e.id) || collPendingTrade.has(e.card_id)) f.push('trade');
    if (e.is_shiny) f.push('shiny');                        // jamais vendue : pas d'envoi au stock (icône ✦ affichée à part)
    return f;
  }
  async function analyzeCollection(onProgress) {
    analysisStop = false;
    collInvalidate();
    const coll = await getCollectionCached();
    const stockState = new Map(load(K.pnl, []).filter(e => inStock(e) && e.entryId).map(e => [e.entryId, e.status]));
    const groups = new Map();
    for (const e of coll) {
      if (!e.card) continue;
      const k = e.card.id + '|' + e.card.rarity + (e.is_shiny ? '|s' : '');
      const g = groups.get(k) || { key: k, card_id: e.card.id, title: titleOf(e.card), rarity: e.card.rarity, shiny: !!e.is_shiny, ids: [], free: [], n: 0, flags: {}, tags: [] };
      const f = entryFlags(e, stockState), copies = e.count || 1;
      g.ids.push(e.id); g.n += copies;
      f.forEach(x => { g.flags[x] = (g.flags[x] || 0) + copies; });
      (e.tags || []).forEach(t => { if (t && t.name && !g.tags.includes(t.name)) g.tags.push(t.name); });
      if (!f.length) g.free.push(e.id);
      groups.set(k, g);
    }
    const list = [...groups.values()], rate = resaleRate();
    let n = 0;
    for (const g of list) {
      if (analysisStop) break;
      onProgress && onProgress(++n, list.length);
      const cached = summaryCache.has(g.card_id);
      g.value = await avgOf(g.card_id, g.rarity);
      g.profit = g.value != null ? Math.round(g.value * rate) : null;
      g.interesting = isInteresting(g.value, g.rarity) === true;
      if (!cached) await sleep(jitter(400));
    }
    // toutes les cartes : les plus rentables d'abord, celles sans prix moyen (jamais vendues) à la fin
    const rows = list.sort((a, b) => (b.profit ?? -1) - (a.profit ?? -1) || a.title.localeCompare(b.title));
    const res = { at: Date.now(), done: !analysisStop, scanned: n, total: list.length, rate, rows, v: 2 };
    save(K.analysis, res);
    return res;
  }
  // ── Shiny en vente ──
  // Le site n'a pas de filtre shiny : on lit les enchères triées par fin imminente à partir de la première page encore
  // ouverte (même recherche que le trading : sauts puis dichotomie), et on garde les shiny qui finissent dans la fenêtre
  // sous le prix max. Le tri étant par fin, on s'arrête à la première enchère qui finit après la fenêtre.
  let shinyStop = false, shinyBusy = false;
  async function findShiny(maxMin, maxPrice, rarities, onProgress) {
    if (shinyBusy) throw new Error('une recherche de shiny est déjà en cours');
    shinyBusy = true;
    try { return await findShinyRun(maxMin, maxPrice, rarities, onProgress); }
    finally { shinyBusy = false; }
  }
  // Shiny jamais vues (ni par une recherche auto ni par une recherche à la main) ; les marque comme vues
  function shinyFresh(rows) {
    const seen = load('wmbot1.shinySeen', {});
    for (const [id, end] of Object.entries(seen)) if (leftMs(end) < -3600000) delete seen[id];   // oubli 1 h après la fin
    const fresh = rows.filter(x => !seen[x.id]);
    fresh.forEach(x => { seen[x.id] = x.end; });
    save('wmbot1.shinySeen', seen);
    return fresh;
  }
  // Recherche automatique (toutes les shinyAutoMin min) : notifie les shiny pas encore signalées
  async function autoShiny() {
    const t = config.trading;
    if (shinyBusy || !t.shinyFindRarities.length) return;
    setActivity('Recherche des shiny…');
    const res = await findShiny(t.shinyFindMin, t.shinyFindMax, t.shinyFindRarities, () => ui && ui.onShiny());
    ui && ui.onShiny();
    res.rows.forEach(addShinyWatch);                          // achat automatique (si coché)
    const fresh = shinyFresh(res.rows);
    if (!fresh.length) return;
    log('info', `✦ ${fresh.length} nouvelle(s) shiny : ${fresh.map(x => `${x.title} (${x.rarity}) ${x.price}, fin dans ${fmtLeft(leftMs(x.end))}`).join(' · ')}`);
    if (fresh.length === 1) notifyUser(`✦ Shiny : ${fresh[0].title} (${fresh[0].rarity}) à ${fresh[0].price}, fin dans ${fmtLeft(leftMs(fresh[0].end))}`, 'shiny', location.origin + '/marketplace/' + fresh[0].id);
    else notifyUser(`✦ ${fresh.length} nouvelles shiny : ${fresh.slice(0, 4).map(x => `${x.title} ${x.price}`).join(', ')}${fresh.length > 4 ? '…' : ''}`, 'shiny', location.origin + '/marketplace/' + fresh[0].id);
  }
  async function findShinyRun(maxMin, maxPrice, rarities, onProgress) {
    shinyStop = false;
    const rar = rarities.length === RARITIES.length ? [] : rarities;   // toutes = pas de filtre
    const me = await whoAmI();
    const windowMs = maxMin * 60000;
    const pages = new Map();
    let read = 0;
    const get = async page => {
      if (!pages.has(page)) {
        pages.set(page, await searchMarket({ sort: 'ending_soon', page, rarities: rar, retries: 2 }));
        onProgress && onProgress(++read, null);
        await snipeTick();   // une recherche longue ne doit pas faire rater les mises de fin d'enchère
        await sleep(jitter(300));
      }
      return pages.get(page);
    };
    const state = r => !r ? 'error' : !(r.auctions || []).length ? 'empty' : r.auctions.some(a => leftMs(a.end_at) > 0) ? 'live' : 'dead';
    // même mémoire que le trading : première page ouverte pour ces raretés-là
    let lo = 0, hi = null, p = Math.max(1, load('wmbot1.livepage' + (rar.length ? '.' + rar.join('') : ''), 1));
    for (let probes = 0; probes < 16 && !shinyStop; probes++) {
      const s = state(await get(p));
      if (s === 'error') { p++; continue; }
      if (s === 'dead') lo = Math.max(lo, p); else hi = hi == null ? p : Math.min(hi, p);
      if (hi != null && hi - lo <= 1) break;
      p = hi == null ? p * 2 : Math.floor((lo + hi) / 2);
      if (p <= lo) p = lo + 1;
      if (hi != null && p >= hi) break;
    }
    const rows = [];
    // résultat partiel enregistré à chaque page : le site met plusieurs secondes par page, la liste se remplit en direct
    const publish = done => { rows.sort((x, y) => leftMs(x.end) - leftMs(y.end)); const out = { at: Date.now(), maxMin, maxPrice, rarities, done, rows }; save('wmbot1.shiny', out); return out; };
    // mesuré le 03/10/2026 : 30 min de L = 28 pages en 67 s ; 150 pages ≈ 2 h 30 de L ; toutes raretés, à peine 15 min
    // site lent (≥ 4 s par réponse) : 40 pages au plus, pour ne pas charger le site pendant que le trading cherche
    const maxPages = siteLatency >= 4000 ? 40 : 150;
    for (let page = hi != null ? hi : lo + 1, n = 0; n < maxPages && !shinyStop; page++, n++) {
      const res = await get(page);
      if (!res) continue;
      let beyond = false;
      for (const a of res.auctions || []) {
        const left = leftMs(a.end_at);
        if (left > windowMs) { beyond = true; continue; }
        if (a.status !== 'active' || left <= 0 || !a.is_shiny || a.seller_id === me) continue;
        const price = minNext(a);
        if (price > maxPrice) continue;
        rows.push({ id: a.id, title: titleOf(a.card), rarity: rarityOf(a), price, bid: a.current_bid, mine: a.current_bidder_id === me, end: a.end_at });
      }
      const last = (res.auctions || []).slice(-1)[0];
      publish(false);
      onProgress && onProgress(read, rows.length, last ? Math.round(leftMs(last.end_at) / 60000) : null);
      if (beyond || !res.hasMore) break;
    }
    return publish(!shinyStop);
  }

  // Cartes choisies dans l'analyse → stock de revente du trading (toutes les copies, comme des achats à 0)
  async function stockAddGroup(g) {
    const value = (await avgOf(g.card_id, g.rarity)) || g.avg || rarityRef(g.rarity).value || null;
    // lu après l'attente du prix : une autre tâche (revente, autre ajout) a pu modifier le stock entre-temps
    const pnl = load(K.pnl, []), have = new Set(pnl.filter(inStock).map(e => e.entryId));
    let added = 0;
    for (const id of g.ids) {
      if (have.has(id) || keepIds[id]) continue;
      pnl.push({ id: 'col-' + id, entryId: id, card_id: g.card_id, title: g.title, rarity: g.rarity, cost: 0, value, boughtAt: Date.now(), status: 'held', source: 'collection', manual: true });
      added++;
    }
    save(K.pnl, pnl);
    pnl.filter(e => e.source === 'collection' && e.status === 'held').forEach(e => queueResell(e.id));
    if (added) log('info', `${added} × ${g.title} (${g.rarity}) ajoutée(s) au stock de revente`);
    next.sort = 0; ui && ui.onPnl();
    return added;
  }
  function analysisToStock(keys) {
    const a = load(K.analysis, null);
    if (!a) return 0;
    const pnl = load(K.pnl, []), have = new Set(pnl.filter(inStock).map(e => e.entryId));
    let added = 0;
    for (const g of a.rows.filter(r => keys.includes(r.key))) {
      let n = 0;
      for (const id of g.free || g.ids) {                      // seulement les copies libres (pas favori, étiquette, voulue…)
        if (have.has(id) || keepIds[id]) continue;
        pnl.push({ id: 'col-' + id, entryId: id, card_id: g.card_id, title: g.title, rarity: g.rarity, cost: 0, value: g.value, boughtAt: Date.now(), status: 'held', source: 'collection', manual: true });
        n++;
      }
      added += n;
      // la ligne reste (toute la collection est affichée) : elle passe en « stock du bot »
      if (g.flags) { g.flags.stock = (g.flags.stock || 0) + n; g.free = []; }
    }
    save(K.pnl, pnl);
    pnl.filter(e => e.source === 'collection' && e.status === 'held').forEach(e => queueResell(e.id));
    if (a.v !== 2) a.rows = a.rows.filter(r => !keys.includes(r.key));   // ancienne analyse (meilleures seulement)
    save(K.analysis, a);
    log('info', `Analyse : ${added} carte(s) ajoutée(s) au stock de revente`);
    next.sort = 0; ui && ui.onPnl();
    return added;
  }
  // Cartes choisies dans l'analyse → gardées dans ta collection (plus proposées, jamais vendues ni défaussées par le bot)
  function analysisKeep(keys) {
    const a = load(K.analysis, null);
    if (!a) return 0;
    const rows = a.rows.filter(r => keys.includes(r.key));
    keepCards(rows.flatMap(r => r.free || r.ids));
    rows.forEach(g => { if (g.flags) { g.flags.kept = (g.flags.kept || 0) + g.free.length; g.free = []; } });
    if (a.v !== 2) a.rows = a.rows.filter(r => !keys.includes(r.key));
    save(K.analysis, a);
    log('info', `Analyse : ${rows.length} carte(s) gardée(s) dans ta collection : ${rows.map(r => r.title).join(', ')}`);
    return rows.length;
  }

  // ═════════════════════════ Réglages optimisés ═════════════════════════
  // Le bouton « Mettre les réglages optimisés » écrit ces valeurs dans les règles, qui restent ensuite modifiables.
  // Tirés de la meilleure journée (03/10/2026, journal) : 138 mises UR, 72 gagnées, 48 revendues (105 en moyenne),
  // +3 965 en UR et +4 489 en L ; aucune SR ne passait. Ce jour-là le prix habituel UR était d'au moins ~50 (des UR
  // estimées jusqu'à 223 = 4,2× le prix habituel) et L ≈ 450 : ils sont imposés, car appris ils avaient dérivé vers le bas.
  const PRESET = {
    date: '03/10/2026',
    basis: 'ta meilleure journée : 138 mises UR, 72 gagnées, 48 revendues, +3 965 en UR et +4 489 en L',
    values: {
      rarities: ['L', 'UR'], windowMin: 4, threshold: 33, minValue: 90, minProfit: 45, snipeS: 40,
      maxStock: 20, resellPercent: 90, resellDrop: 10, resellDuration: 10, stockDiscount: 25, lossAfter: 4, dormantAfter: 3, maxDormant: 10,
    },
    refs: { L: 450, UR: 50 },
    why: {
      rarities: 'L, UR, SR, R : les cartes chères rapportent le plus par emplacement de vente. C trop peu chères',
      windowMin: 'le temps d’un tour de recherche + la mise de dernière seconde',
      threshold: 'les achats à plus de 40 % de la valeur sont ceux qui rapportent le moins',
      minValue: 'les emplacements de vente sont la limite : une carte à 70+ rapporte ≈ 10× plus par mise en vente qu’une carte à moins de 30',
      minProfit: 'on réserve les 5 emplacements de vente aux cartes qui rapportent le plus',
      snipeS: 'avancé automatiquement quand le site est lent',
      maxStock: '≈ 2 h de revente sur 5 emplacements',
      dormantAfter: 'dès la 4e mise en vente, une carte rapporte 3× moins par heure d’emplacement',
      maxDormant: 'au-delà, les cartes dormantes comptent de nouveau dans le stock',
      resellPercent: 'seulement ~25 % des mises en vente partent au prix plein',
      resellDrop: 'baisser fort ne fait pas vendre beaucoup plus vite',
      resellDuration: 'ventes courtes : elles repassent en tête du tri « fin imminente »',
      stockDiscount: 'brade un peu quand le stock déborde',
      lossAfter: 'les ventes à perte sont rares : on patiente',
      maxPerCard: 'ton plafond',
      maxBids: 'ton plafond',
    },
  };
  const autoState = () => PRESET;

  // ── Curseur d'exigence ──
  // 50 = les réglages optimisés ci-dessus. Vers la droite : seulement les très bonnes affaires (prix bas, gros bénéfice,
  // cartes chères), moins de stock pour se concentrer dessus. Vers la gauche : petites marges, plus d'achats, plus de stock.
  // Déplacer le curseur ÉCRIT ces 4 valeurs dans les règles (elles restent modifiables à la main ensuite).
  const DEMAND = {           // valeurs à 0, 50 et 100 ; interpolation linéaire entre les deux
    threshold: [55, 33, 22],
    minProfit: [15, 45, 75],
    minValue: [40, 90, 150],
    maxStock: [30, 20, 10],
  };
  // applique les réglages optimisés (au niveau d'exigence demandé) dans les règles de trading ; tes plafonds sont gardés
  function applyPreset(t, demand = 50) {
    Object.assign(t, PRESET.values, demandValues(demand), { demand, autoOptimize: false, stockMax: 0 });
    t.manualRef = { ...(t.manualRef || {}), ...PRESET.refs };
  }
  function demandValues(d) {
    const out = {};
    for (const [k, [lo, mid, hi]] of Object.entries(DEMAND))
      out[k] = Math.round(d <= 50 ? lo + (mid - lo) * d / 50 : mid + (hi - mid) * (d - 50) / 50);
    return out;
  }
  const demandText = v => `Achète si prix ≤ <b>${v.threshold} %</b> de la valeur · bénéfice ≥ <b>${v.minProfit}</b> · valeur ≥ <b>${v.minValue}</b> · stock max <b>${v.maxStock}</b>`;
  const demandLabel = d => d < 20 ? 'petites marges' : d < 40 ? 'peu exigeant' : d <= 60 ? 'équilibré' : d <= 80 ? 'exigeant' : 'très exigeant';
  // Recommandation : calculée par le bot à partir de ce qu'il a vécu (stock dormant, taux de revente, bénéfice, achats).
  function recommendDemand() {
    let v = 50;
    const why = [];
    const s = stockCounts(), st = pnlStats();
    if (s.held >= 4 && s.dormant / s.held > 0.3) {
      const add = Math.round(40 * (s.dormant / s.held - 0.3));
      v += add; why.push(`${s.dormant} carte(s) sur ${s.held} en stock sont dormantes : le bot achète des cartes qui ne se revendent pas (+${add})`);
    }
    if (rateSales().length >= RATE_MIN_SALES) {
      const r = resaleRate();
      if (r < 0.75) { const add = Math.round((0.75 - r) * 100); v += add; why.push(`tes cartes ne se revendent qu’à ${Math.round(r * 100)} % de leur valeur estimée : il faut acheter moins cher (+${add})`); }
      else if (r > 0.9) { const sub = Math.round((r - 0.9) * 100); v -= sub; why.push(`tes cartes se revendent à ${Math.round(r * 100)} % de leur valeur : de plus petites marges restent rentables (−${sub})`); }
    }
    if (st.sold.length >= 5 && st.realized < 0) { v += 10; why.push(`bénéfice réalisé négatif (${st.realized}) (+10)`); }
    if (config.trading.enabled && running && Date.now() - tstats.lastBidAt > 3 * 3600000 && s.held < 3) { v -= 15; why.push('aucune mise depuis plus de 3 h avec un stock presque vide : les règles écartent tout (−15)'); }
    v = Math.min(90, Math.max(10, Math.round(v / 5) * 5));
    if (!why.length) why.push('rien d’anormal dans ton stock ni tes ventes : les réglages optimisés conviennent');
    return { value: v, why };
  }

  // ── Modes de vitesse ──
  // ⚡ Turbo : devant l'écran, le bot cherche et suit tout très souvent et revend en ventes courtes (10 min).
  // ❄️ Lent : loin de l'écran, très peu de requêtes et des ventes longues que le bot choisit selon la valeur de la carte.
  // Le mode normal garde tes réglages.
  const MODES = {
    turbo: { label: '⚡ Turbo', scanEveryS: 15, pollEveryS: 15, wishEveryMin: 8, sortEveryMin: 1, balanceS: 15, resellDuration: 10 },
    slow: { label: '❄️ Lent', scanEveryS: 600, pollEveryS: 180, wishEveryMin: 45, sortEveryMin: 20, balanceS: 300, sellEveryS: 120 },
  };
  const modeVal = (k, d) => { const m = MODES[config.mode]; return m && m[k] != null ? m[k] : d; };
  // mode lent : 3 h, 6 h à partir de 40, 12 h à partir de 100 (moins d'emplacements remis en jeu, moins de requêtes),
  // mais jamais au-delà de ton retour : la vente se termine au plus tard 10 min après l'heure de retour prévue
  const SLOW_GRACE_MIN = 10;
  // plus longue durée de vente qui finit avant le retour (+ 10 min) ; sans heure de retour : pas de limite
  const slowCap = () => {
    if (config.mode !== 'slow' || !config.slowUntil) return Infinity;
    const left = (config.slowUntil - Date.now()) / 60000 + SLOW_GRACE_MIN;
    const fit = DURATIONS.filter(d => d <= left);
    return fit.length ? Math.max(...fit) : DURATIONS[0];
  };
  const slowDuration = entry => {
    const v = (entry && entry.value) || 0;
    return Math.min(v >= 100 ? 720 : v >= 40 ? 360 : 180, slowCap());
  };
  // « 45 », « 45 min », « 2h », « 1h30 », « 1 h 30 » → minutes (null si illisible)
  function parseAway(s) {
    const t = String(s || '').toLowerCase().replace(/\s+/g, '');
    const h = t.match(/^(\d+(?:[.,]\d+)?)h(\d+)?(?:min|m)?$/);
    if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60 + (Number(h[2]) || 0)) || null;
    const m = t.match(/^(\d+)(?:min|m|mn)?$/);
    return m ? Number(m[1]) || null : null;
  }
  // heure de retour atteinte : le bot repasse en mode normal tout seul
  function slowCheck() {
    if (config.mode !== 'slow' || !config.slowUntil || Date.now() < config.slowUntil) return;
    config = loadConfig();
    config.mode = 'normal'; config.slowUntil = 0;
    saveConfig();
    log('info', 'Heure de retour atteinte : mode normal');
    Object.assign(next, { trade: 0, wish: 0, follow: 0, sort: 0 });
    ui && ui.onStatus();
  }

  // Réglages de trading en vigueur : ce qui est écrit dans les règles (le bouton « réglages optimisés » et le curseur
  // d'exigence ne font que les remplir), plus le mode Turbo et le stock max imposé dans « Stock du bot »
  function tcfg() {
    const t = config.trading;
    return { ...t,
      ...(config.mode === 'turbo' ? { resellDuration: 10 } : {}),
      ...(t.stockMax > 0 ? { maxStock: t.stockMax } : {}) };
  }
  // Ancienne case « Réglages optimisés » cochée : une seule fois, les nouveaux réglages optimisés sont écrits dans les
  // règles (le bot ne les recalcule plus en douce : ce que tu vois est ce qui s'applique)
  if (config.trading.autoOptimize !== false) {
    const c0 = loadConfig();
    applyPreset(c0.trading);
    config = sanitize(c0); saveConfig();
  }

  // ═════════════════════════ Vente & tri ═════════════════════════
  // Jamais vendue ni défaussée : favorite ★ ou rangée dans au moins une étiquette de la collection
  const isProtected = e => !!(e && (e.starred || (Array.isArray(e.tags) && e.tags.length)));
  let keepIds = load(K.keepIds, {});                      // cartes de la collection que tu as choisi de garder (analyse, stock)
  const keepCards = ids => { keepIds = load(K.keepIds, {}); ids.forEach(id => { keepIds[id] = Date.now(); }); save(K.keepIds, keepIds); };
  const isKept = e => {
    const title = titleOf(e.card);
    return isProtected(e) || !!keepIds[e.id] || isWanted(e.card) || config.keepTitles.some(k => norm(k) === norm(title));
  };
  // Vente automatique : chaque invendu d'une carte (même carte, même rareté) baisse son prix de dropPct %,
  // et après pauseAfter invendus d'affilée elle n'est plus remise en vente pendant 24 h (elle bloquait un emplacement en boucle)
  const sellKey = e => e.card.id + ':' + e.card.rarity;
  function sellTries() {
    const t = load(K.sellTries, {});
    for (const [k, x] of Object.entries(t)) if (Date.now() - x.at >= SELL_PAUSE_MS) delete t[k];   // pause finie : prix plein à nouveau
    return t;
  }
  const sellPaused = (t, e) => { const x = t[sellKey(e)]; return !!x && x.n >= config.sell.pauseAfter; };
  function noteAutoSale(key, sold) {
    const t = sellTries();
    let note = '';
    if (sold) delete t[key];
    else {
      const n = ((t[key] && t[key].n) || 0) + 1;
      t[key] = { n, at: Date.now() };
      note = n >= config.sell.pauseAfter ? ` · ${n} invendus d’affilée : plus remise en vente pendant 24 h`
        : config.sell.dropPct ? ` · prochain prix −${Math.round((1 - Math.pow(1 - config.sell.dropPct / 100, n)) * 100)} %` : '';
    }
    save(K.sellTries, t);
    return note;
  }
  async function sellPrice(e, tries = sellTries()) {
    const s = config.sell, r = e.card.rarity;
    let price = Number(s.fixed[r]) || 1;
    if (s.pricing === 'market') {
      const sum = await cardSummary(e.card.id);
      const avg = sum && sum[r] && sum[r].average;
      if (avg) price = Math.round(avg * s.percent / 100);
    }
    const n = (tries[sellKey(e)] || {}).n || 0;
    price = Math.round(price * Math.pow(1 - s.dropPct / 100, n));
    return Math.max(price, Number(s.floor[r]) || 1, 1);
  }
  // Le bot ne met jamais une shiny en vente : le site ne donne qu'un prix moyen par carte et par rareté, versions normale
  // et shiny mélangées, donc tout prix calculé par le bot la braderait. Point de passage de toutes les mises en vente.
  async function listCard(e, price, duration, why, extra) {
    if (e.is_shiny) { log('skip', `${titleOf(e.card)} (${e.card.rarity}) est une shiny ✦ : le bot ne la vend pas`); return false; }
    // v2.9 : la carte a été choisie sur la collection en cache (jusqu'à 5 min) ; un favori ★ ou une étiquette posés sur le site
    // depuis n'y apparaissent pas. Dernière vérification sur une collection lue il y a moins de SELL_FRESH_MS.
    let now;
    try { now = (await getCollectionCached(SELL_FRESH_MS)).find(x => x.id === e.id); }
    catch { log('warn', `${titleOf(e.card)} (${e.card.rarity}) : collection illisible, mise en vente reportée`); return 'later'; }
    if (!now) return 'gone';                                                                     // déjà en vente, partie, ou revenue sous un autre identifiant
    if (isProtected(now)) { log('skip', `${titleOf(e.card)} (${e.card.rarity}) ${now.starred ? 'vient d’être mise en favori ★' : 'vient d’être rangée dans une étiquette'} : le bot ne la vend pas`); return false; }
    duration = Math.min(duration, slowCap());   // absent : toute vente finit à ton retour (+ 10 min au plus)
    const desc = `${titleOf(e.card)} (${e.card.rarity}) à ${price}, ${duration < 60 ? duration + ' min' : duration / 60 + ' h'}`;
    if (config.dryRun) { log('dry', `Simulation — mettrait en vente ${desc} · ${why}`); return 'simulation'; }
    if (humanFor('sell') && !takeProbe('sell')) return 'human';
    const r = await post('/api/marketplace', { card_id: e.id, base_amount: price, duration_minutes: duration });
    if (!r.ok) {
      const msg = errOf(r);
      if (needsHuman(r)) { setHuman('sell', 'mets une carte en vente à la main', r); return 'human'; }
      if (/limite/i.test(msg)) { slotsFullUntil = Date.now() + 15000; return 'full'; }          // les 5 emplacements sont pris
      if (/poss[ée]dez pas/i.test(msg)) { collInvalidate(); return 'gone'; }                     // carte déjà en vente ou partie
      if (/impossible de cr[ée]er/i.test(msg)) { collInvalidate(); return 'gone'; }               // carte pas encore revenue (fin de vente en cours) : on réessaiera
      log('error', `Mise en vente refusée (${titleOf(e.card)}) : ${msg}`);
      return false;
    }
    collRemove(e.id);
    listings = load(K.listings, {});
    const auctionId = (r.body && r.body.auction_id) || null;
    if (auctionId) { listings[auctionId] = { title: titleOf(e.card), rarity: e.card.rarity, base: price, endAt: srvNow() + duration * 60000, ...(extra || {}) }; save(K.listings, listings); }
    clearHuman('sell');              // la mise en vente est passée : la vérification a été faite
    log('sell', `Mise en vente : ${desc} · ${why}`);
    notifyUser(`Mise en vente : ${desc}`, 'sales');
    return auctionId || 'ok';
  }
  let sellBusy = false, slotsFullUntil = 0;
  // la revente et le tri ne doivent jamais tourner en même temps. opts.onWait(secondes) : affiche l'attente ;
  // opts.maxWaitMs : abandonne au lieu d'attendre sans fin (une revente sur un site lent peut durer plusieurs minutes)
  async function withSellLock(fn, opts = {}) {
    const t0 = Date.now();
    while (sellBusy) {
      if (opts.maxWaitMs && Date.now() - t0 > opts.maxWaitMs) throw new Error('la revente en cours ne se termine pas (site lent ?), réessaie dans quelques minutes');
      opts.onWait && opts.onWait(Math.round((Date.now() - t0) / 1000));
      await sleep(300);
    }
    sellBusy = true;
    try { return await fn(); } finally { sellBusy = false; }
  }

  // Emplacements de vente libres (le site en autorise 5)
  async function freeSellSlots() {
    if (Date.now() < slotsFullUntil) return 0;
    const mine = await api('/api/marketplace/mine', {}, 1);
    if (!mine.ok) return 0;
    return (mine.body.maxConcurrentAuctions || 5) - (mine.body.sellingCount || 0) - (config.sell.keepFreeSlots | 0);
  }

  // Revente des cartes du trading (et des cartes de valeur sorties des paquets) : remplit les emplacements libres
  async function resellFromQueue() {
    let resellQ = load(K.resell, []);
    if (!resellQ.length || (humanFor('sell') && !probeReady('sell'))) return;
    let free = await freeSellSlots();
    if (free <= 0) return;
    let coll;
    try { coll = await getCollectionCached(); } catch { return; }
    const pnlNow = load(K.pnl, []);
    // une carte de la file sans fiche de stock (ancienne carte de valeur d'un paquet) : prix demandé, rien payé
    const entryOf = q => (q.pnlId && pnlNow.find(x => x.id === q.pnlId)) || { cost: 0, value: q.price || 0 };
    const dormantQ = q => { const e = q.pnlId && pnlNow.find(x => x.id === q.pnlId); return e ? dormantForSale(e) : false; };
    // ordre : ta priorité, liquidations, cartes achetées, cartes de ta collection, dormantes (voir resaleCmp)
    resellQ.sort((a, b) => resaleCmp(entryOf(a), entryOf(b)));
    let activeWaiting = false;     // une carte non dormante attend de revenir dans la collection : on lui garde la place
    const drop = new Set(), used = new Set();
    let refreshed = false;
    // les dormantes n'occupent jamais plus de dormantSlots emplacements en même temps : elles ne bloquent plus la revente…
    // …sauf s'il n'y a aucune carte normale à vendre : un emplacement vide ne rapporte rien (journal du 03/10/2026 :
    // 24 dormantes, 2 emplacements pour elles, le reste vide)
    let dormantListed = pnlNow.filter(e => e.status === 'listed' && dormantForSale(e)).length;
    const normalLeft = () => load(K.pnl, []).some(e => e.status === 'held' && !dormantForSale(e) && !e.liq);
    for (const q of resellQ) {
      if (free <= 0) break;
      const dormant = dormantQ(q);
      if (dormant && activeWaiting) break;                  // la file est triée : il ne reste que des dormantes
      if (dormant && dormantListed >= tcfg().dormantSlots && normalLeft()) break;
      let e;
      if (q.pnlId) {
        // carte achetée en trading : on vise l'exemplaire exact acheté, pas une autre copie de la même carte
        const pe = load(K.pnl, []).find(x => x.id === q.pnlId);
        if (!pe || pe.status === 'kept' || pe.status === 'sold' || pe.status === 'listed') { drop.add(q); continue; }
        let entryId = pe.entryId;
        // jamais un exemplaire shiny : il partirait au prix d'une carte normale
        const findEntry = () => coll.filter(x => x.card && x.card.id === q.card_id && !x.is_shiny && !used.has(x.id))
          .sort((a, b) => new Date(b.obtained_at || 0) - new Date(a.obtained_at || 0))[0];   // le plus récent = celui acheté
        if (!entryId) {
          let cand = findEntry();
          if (!cand && !refreshed) { collInvalidate(); coll = await getCollectionCached(); refreshed = true; cand = findEntry(); }
          if (cand) { entryId = cand.id; updatePnl(q.pnlId, { entryId }); }
        }
        e = entryId && coll.find(x => x.id === entryId);
        if (!e && entryId && !refreshed) { collInvalidate(); coll = await getCollectionCached(); refreshed = true; e = coll.find(x => x.id === entryId); }
        if (!e && entryId) {
          // une carte invendue revient dans la collection avec un nouvel identifiant : on la retrouve par son type
          const again = findEntry();
          if (again) { e = again; entryId = again.id; updatePnl(q.pnlId, { entryId }); }
        }
        if (!e) {
          // une carte invendue met un moment à revenir dans la collection : on réessaie, et on n'abandonne qu'après 30 min d'absence
          const since = pe.missingSince || Date.now();
          if (!pe.missingSince) updatePnl(q.pnlId, { missingSince: since });
          if (Date.now() - since > 30 * 60000) { updatePnl(q.pnlId, { status: 'kept', keptWhy: 'plus dans ta collection' }); log('info', `${q.title} n’est plus dans ta collection depuis 30 min : retirée de la revente`); drop.add(q); }
          else if (!dormant) activeWaiting = true;
          continue;
        }
        if (pe.missingSince) updatePnl(q.pnlId, { missingSince: null });
        if (isProtected(e)) {
          updatePnl(q.pnlId, { status: 'kept', keptWhy: e.starred ? 'mise en favori' : 'rangée dans une étiquette' });
          log('info', `${q.title} (${q.rarity}) ${e.starred ? 'mise en favori' : 'rangée dans une étiquette'} : le bot la garde et ne la revendra pas`);
          drop.add(q);
          continue;
        }
        if (pe.source === 'collection' && isWanted(e.card)) {
          updatePnl(q.pnlId, { status: 'kept', keptWhy: 'carte voulue' });
          log('info', `${q.title} (${q.rarity}) est une carte voulue ou d’une catégorie voulue : le bot la garde et ne la revendra pas`);
          drop.add(q);
          continue;
        }
        if (e.is_shiny) {                                     // exemplaire visé shiny : gardé, pas vendu au prix d'une normale
          updatePnl(q.pnlId, { status: 'kept', keptWhy: 'shiny ✦' });
          log('info', `${q.title} (${q.rarity}) est une shiny ✦ : le bot la garde (son prix moyen est celui de la carte normale)`);
          drop.add(q);
          continue;
        }
      } else e = coll.find(x => x.card && x.card.id === q.card_id && !x.is_shiny && !isProtected(x) && !isWanted(x.card) && !used.has(x.id));
      if (!e || used.has(e.id)) continue;
      const entry = q.pnlId && load(K.pnl, []).find(x => x.id === q.pnlId);
      let price = entry ? resellPrice(entry) : q.price;   // le prix plancher de « Vente & tri » ne s'applique pas aux reventes
      // juste sous le concurrent le moins cher de même rareté, mais un concurrent qui brade ne fait jamais descendre
      // sous la moitié de la valeur (ni sous le prix d'achat, sauf vente à perte autorisée). Une baisse déjà prévue
      // par les invendus (prix déjà sous ce plancher) est gardée telle quelle.
      const comp = entry && entry.liq ? null : await competition(q.title, q.rarity, null, 2 * 60000).catch(() => null);
      if (comp && comp.cheapest != null && comp.cheapest - 1 < price) {
        const tc2 = tcfg(), tries = (entry && entry.attempts) || 0;
        const lossOk = entry && tc2.allowLoss && tries >= tc2.lossAfter;
        const worth = entry ? (entry.value || entry.cost) : q.price;
        // en liquidation, on suit le concurrent jusqu'au plancher de liquidation (et plus jusqu'à 50 % de la valeur)
        const floor = entry && isLiquidating(entry) ? liquidationFloor(entry) : Math.max(entry && !lossOk ? entry.cost + 1 : 1, Math.round(worth * UNDERCUT_FLOOR));
        price = Math.max(Math.min(price, floor), comp.cheapest - 1);
      }
      const pressure = stockPressure();
      // la durée réglée dans « Durée des ventes » s'applique à toutes les cartes (seul le mode lent a ses propres durées)
      const duration = config.mode === 'slow' ? slowDuration(entry) : tcfg().resellDuration;
      const listed = await listCard(e, price, duration, (q.pnlId ? 'revente trading' : 'carte de valeur sortie d’un paquet') + (entry && entry.liq ? ` · liquidation demandée (prix payé ${entry.liq.add != null ? (entry.liq.add >= 0 ? '+ ' : '− ') + Math.abs(entry.liq.add) : ''})` : entry && isLiquidating(entry) ? ` · liquidation (plancher ${liquidationFloor(entry)})` : dormant ? ' · dormante' : '') + (pressure > 0 ? ` · stock chargé, −${Math.round(tcfg().stockDiscount * pressure)} %` : ''), { pnlId: q.pnlId });
      if (listed === 'full' || listed === 'human' || listed === 'later') break;   // later : collection illisible, au tour suivant
      if (listed === 'gone') { if (q.pnlId) updatePnl(q.pnlId, { entryId: null }); continue; }
      if (listed) {
        used.add(e.id); free--;
        if (dormant) dormantListed++;
        if (listed !== 'simulation') { drop.add(q); if (q.pnlId) updatePnl(q.pnlId, { status: 'listed', listPrice: price }); }
      }
      await snipeTick();
    }
    if (!config.dryRun) save(K.resell, load(K.resell, []).filter(q => ![...drop].some(d => d.pnlId ? d.pnlId === q.pnlId : d.card_id === q.card_id)));
  }

  // Tâche de vente indépendante (toutes les 12 s) : détecte la fin des ventes et remplit aussitôt les emplacements libérés
  let lastListingCheck = 0;
  async function sellTick() {
    slowCheck();
    if (config.mode === 'slow' && Date.now() - (sellTick.last || 0) < modeVal('sellEveryS', 0) * 1000) return;   // mode lent : une vérification des ventes toutes les 2 min
    sellTick.last = Date.now();
    if (sellBusy) return;
    await withSellLock(async () => {
      const L = load(K.listings, {});
      const due = Object.values(L).some(x => !x.endAt || x.endAt <= srvNow() + 5000);
      if (due || Date.now() - lastListingCheck > 60000) { lastListingCheck = Date.now(); await followListings(); }
      await resellFromQueue();
    });
  }

  // Vente automatique par rareté et défausse (dans la boucle principale, toutes les 5 min ou après un paquet)
  async function sellAndSort() {
    const doSell = config.sell.enabled && config.sell.rarities.length;
    const doDiscard = config.discard.enabled && config.discard.rarities.length;
    if (!doSell && !doDiscard) return;
    return withSellLock(async () => {
    setActivity('Tri de la collection…');
    let coll;
    try { coll = await getCollectionCached(2 * 60000); } catch { log('warn', 'Collection illisible, tri reporté'); return; }
    const used = new Set();
    if (doSell && !humanFor('sell')) {
      let free = await freeSellSlots();
      const inQueue = new Set(load(K.resell, []).map(q => q.card_id));
      // aucune copie d'une carte du stock de trading : elle concurrencerait sa propre revente
      const inTrade = new Set(load(K.pnl, []).filter(inStock).map(x => x.card_id));
      // une seule copie d'une même carte en vente à la fois
      const onSale = new Set(Object.values(load(K.listings, {})).map(x => x.auto).filter(Boolean));
      const tries = sellTries();
      const wanted = new Set(config.sell.rarities);
      const eligible = coll.filter(e => e.card && !e.is_shiny && wanted.has(e.card.rarity) && !isKept(e) && !inQueue.has(e.card.id) && !inTrade.has(e.card.id) && !sellPaused(tries, e))
        .sort((a, b) => RANK[b.card.rarity] - RANK[a.card.rarity]);
      for (const e of eligible) {
        if (free <= 0) break;
        if (isProtected(e) || onSale.has(sellKey(e))) continue;               // double sécurité
        const listed = await listCard(e, await sellPrice(e, tries), config.sell.duration, 'vente automatique', { auto: sellKey(e) });
        if (listed === 'full' || listed === 'human' || listed === 'later') break;   // later : collection illisible, au tour suivant
        if (listed && listed !== 'gone') { used.add(e.id); onSale.add(sellKey(e)); free--; }
        await sleep(jitter(1000));
      }
    }

    // 3) défausse (jamais SR/UR/L, jamais les favoris ni les cartes voulues)
    if (doDiscard) {
      const wanted = new Set(config.discard.rarities.filter(r => DISCARDABLE.includes(r)));
      const pendingResell = new Set(load(K.resell, []).map(q => q.card_id));
      let list = coll.filter(e => e.card && wanted.has(e.card.rarity) && DISCARDABLE.includes(e.card.rarity) && !isKept(e) && !used.has(e.id) && !pendingResell.has(e.card.id));
      const fromPacks = load(K.fromPacks, {});
      if (config.discard.onlyPackCards) list = list.filter(e => fromPacks[e.id]);   // le reste de la collection n'est pas touché
      if (config.packSort.enabled) {
        const keep = [];
        for (const e of list) { const avg = await avgOf(e.card.id, e.card.rarity); if (avg != null && avg >= config.packSort.keepValue) keep.push(e.id); }
        if (keep.length) log('info', `${keep.length} carte(s) épargnée(s) par la défausse car elles valent au moins ${config.packSort.keepValue}`);
        list = list.filter(e => !keep.includes(e.id));
      }
      for (let i = 0; i < list.length; i += 10) {
        const batch = list.slice(i, i + 10);
        if (batch.some(e => !DISCARDABLE.includes(e.card.rarity) || isProtected(e))) { log('error', 'Défausse bloquée : carte protégée dans le lot'); break; }
        const desc = batch.map(e => `${titleOf(e.card)} (${e.card.rarity})`).join(', ');
        if (config.dryRun) { log('dry', 'Simulation — défausserait : ' + desc); continue; }
        const r = await post('/api/user-cards/bulk-discard', { card_ids: batch.map(e => e.id) });
        if (!r.ok) { log('error', 'Défausse refusée : ' + errOf(r)); break; }
        log('discard', `Défaussé ${r.body.discarded_count ?? batch.length} carte(s)${config.discard.onlyPackCards ? ' sortie(s) de paquets' : ''} : ${desc}`);
        const fp = load(K.fromPacks, {}); batch.forEach(e => delete fp[e.id]); save(K.fromPacks, fp);
        batch.forEach(e => collRemove(e.id));
        await sleep(jitter(1500));
      }
    }
    });
  }
  // ── Grand ménage : défausse d'un coup les raretés cochées, sauf (option) les cartes intéressantes ──
  // Jamais UR ni L ; jamais les favoris, les cartes étiquetées, les cartes voulues, la liste « À garder », ni le stock
  // du trading. Une rareté dont le prix médian n'est pas encore appris est gardée entière quand l'option est cochée.
  let purgePlan = null;
  const purgeUi = { busy: false, html: '', stop: false };   // état affiché du grand ménage : survit aux changements d'onglet
  async function analyzePurge(onProgress) {
    const p = config.purge, want = new Set(p.rarities.filter(r => PURGE_RARITIES.includes(r)));
    const coll = await getCollectionCached(60000);
    const inTrade = new Set(load(K.pnl, []).filter(inStock).map(x => x.entryId).filter(Boolean));
    const tradeCards = new Set(load(K.pnl, []).filter(e => inStock(e) && !e.entryId).map(x => x.card_id));
    const pending = new Set(load(K.resell, []).filter(q => !q.pnlId).map(q => q.card_id));
    const all = coll.filter(e => e.card && want.has(e.card.rarity));
    const cand = all.filter(e => !isKept(e) && !inTrade.has(e.id) && !tradeCards.has(e.card.id) && !pending.has(e.card.id));
    const toDiscard = [], kept = [], unknown = new Set();
    if (!p.keepInteresting) cand.forEach(e => toDiscard.push({ e, v: null }));
    else {
      const ids = [...new Set(cand.filter(e => discardLine(e.card.rarity)).map(e => e.card.id + '|' + e.card.rarity))];
      const avg = new Map(), failed = new Set();
      // valeurs déjà connues par l'Analyse de la collection (moins de 6 h) : rien à relire pour ces cartes
      const ana = load(K.analysis, null);
      // (seulement les valeurs connues : là-bas, une lecture ratée ressemble à « jamais vendue », elle est donc relue ici)
      if (ana && ana.v === 2 && Date.now() - ana.at < 6 * 3600000) for (const g of ana.rows) if (g.value != null) avg.set(g.card_id + '|' + g.rarity, g.value);
      const todo = ids.filter(k => !avg.has(k));
      // le reste 5 à la fois (une lecture prend 2 à 8 s quand le site est chargé ; une à la fois prenait des dizaines de minutes)
      for (let i = 0; i < todo.length; i += 5) {
        if (purgeUi.stop) throw new Error('arrêté');
        onProgress && onProgress(Math.min(i + 5, todo.length), todo.length);
        await Promise.all(todo.slice(i, i + 5).map(async k => {
          const [id, r] = k.split('|');
          const s = await cardSummary(id).catch(() => null);
          if (s == null) { failed.add(k); return; }             // lecture ratée : on ne sait pas, la carte est gardée
          avg.set(k, s[r] && s[r].average > 0 ? Math.round(s[r].average) : null);   // null = vraiment jamais vendue
        }));
        await sleep(jitter(300));
      }
      for (const e of cand) {
        const r = e.card.rarity, line = discardLine(r), k = e.card.id + '|' + r;
        if (!line) { kept.push({ e, v: null }); unknown.add(r); continue; }
        if (failed.has(k)) { kept.push({ e, v: null, failed: true }); continue; }   // jamais défaussée sur une lecture ratée
        const v = avg.get(k);
        (v != null && v >= line ? kept : toDiscard).push({ e, v });
      }
      purgeUi.failed = failed.size;
    }
    purgePlan = { rarities: [...want], keepInteresting: p.keepInteresting, at: Date.now(), toDiscard, kept, unknown: [...unknown], protectedCount: all.length - cand.length, found: all.length, collSize: coll.length };
    return purgePlan;
  }
  async function runPurge(onProgress) {
    const plan = purgePlan;
    // 2 h : chaque carte est de toute façon revérifiée sur la collection à jour juste avant d'être défaussée
    // (10 min suffisaient à rendre l'analyse « périmée » sur un site lent, le temps de lire les prix et de confirmer)
    if (!plan || Date.now() - plan.at > 2 * 3600000) throw new Error('analyse de plus de 2 h, relance le grand ménage');
    return withSellLock(async () => {
      collInvalidate();
      const coll = await getCollectionCached();
      const now = new Map(coll.map(e => [e.id, e]));
      const inTrade = new Set(load(K.pnl, []).filter(inStock).map(x => x.entryId).filter(Boolean));
      // nouvelle vérification de chaque carte juste avant de défausser (elle a pu être mise en favori ou vendue entre-temps)
      const list = plan.toDiscard.map(x => now.get(x.e.id)).filter(e => e && e.card && plan.rarities.includes(e.card.rarity) && PURGE_RARITIES.includes(e.card.rarity) && !isKept(e) && !inTrade.has(e.id));
      let done = 0;
      for (let i = 0; i < list.length; i += 10) {
        if (purgeUi.stop) { log('info', `Grand ménage arrêté après ${done} carte(s)`); break; }
        onProgress && onProgress(Math.min(i + 10, list.length), list.length);
        const batch = list.slice(i, i + 10);
        const desc = batch.map(e => `${titleOf(e.card)} (${e.card.rarity})`).join(', ');
        if (config.dryRun) { log('dry', `Simulation — grand ménage, défausserait : ${desc}`); continue; }
        const r = await post('/api/user-cards/bulk-discard', { card_ids: batch.map(e => e.id) });
        if (!r.ok) { log('error', `Grand ménage interrompu après ${done} carte(s) : ${errOf(r)}`); break; }
        const got = r.body.discarded_count ?? batch.length, failed = Array.isArray(r.body.failed) ? r.body.failed : [];
        if (failed.length) log('error', `Grand ménage : ${failed.length} carte(s) refusée(s) par le site : ${JSON.stringify(failed).slice(0, 300)}`);
        if (!got) { log('error', `Grand ménage : le site n’a défaussé aucune carte de ce lot (réponse : ${JSON.stringify(r.body).slice(0, 300)})`); break; }
        done += got;
        batch.forEach(e => collRemove(e.id));
        log('discard', `Grand ménage : ${batch.length} carte(s) défaussée(s) : ${desc}`);
        await sleep(jitter(1500));
      }
      purgePlan = null;
      next.owned = 0;
      return { done, total: list.length, missing: plan.toDiscard.length - list.length };
    }, { maxWaitMs: 3 * 60000, onWait: s => onProgress && onProgress(null, null, s) });
  }

  // ── Raretés confiées à la revente du trading ──
  // Toutes les cartes de ces raretés (sauf protégées et voulues) entrent dans le stock de revente du trading, comme des
  // achats à 0 : elles suivent ses prix, ses baisses, la liquidation… Elles passent après les cartes achetées et ne
  // comptent pas dans le stock maximum (elles ne bloquent pas les achats). Décocher une rareté retire celles pas encore en vente.
  async function syncStockSell() {
    const want = new Set(config.stockSell.rarities);
    let pnl = load(K.pnl, []);
    // seulement celles ajoutées par cette synchro : une carte mise au stock à la main (Analyse, « + Stock », Ajouter au stock) y reste
    const gone = pnl.filter(e => e.source === 'collection' && !e.manual && e.status === 'held' && !want.has(e.rarity));
    if (gone.length) {
      pnl = pnl.filter(e => !gone.includes(e));
      save(K.pnl, pnl);
      save(K.resell, load(K.resell, []).filter(q => !gone.some(g => g.id === q.pnlId)));
      log('info', `${gone.length} carte(s) retirée(s) du stock de revente (rareté décochée)`);
    }
    if (!want.size) return;
    let coll;
    try { coll = await getCollectionCached(2 * 60000); } catch { return; }
    const ids = new Set(coll.map(e => e.id));
    const stock = pnl.filter(inStock);
    const known = new Set(stock.map(e => e.entryId).filter(id => id && ids.has(id)));
    // une carte du stock revenue invendue change d'identifiant : on la compte par carte pour ne pas l'ajouter deux fois
    const orphans = {};
    stock.filter(e => !e.entryId || !ids.has(e.entryId)).forEach(e => { orphans[e.card_id] = (orphans[e.card_id] || 0) + 1; });
    let added = 0;
    for (const e of coll) {
      if (!e.card || e.is_shiny || !want.has(e.card.rarity) || isKept(e) || known.has(e.id)) continue;   // shiny : jamais vendue
      if (orphans[e.card.id] > 0) { orphans[e.card.id]--; continue; }
      const avg = await avgOf(e.card.id, e.card.rarity);
      // sous le seuil de défausse des paquets (même rareté cochée) : pas mise en vente, elle occuperait un emplacement pour presque rien
      const pdx = config.packDiscard, line = pdx.enabled && pdx.rarities.includes(e.card.rarity) ? (pdx.below > 0 ? pdx.below : interestLine(e.card.rarity)) : null;
      if (line && (avg == null || avg < line)) continue;
      const value = avg || rarityRef(e.card.rarity).value;
      if (!value) continue;                                   // valeur inconnue : pas de prix de vente possible
      pnl.push({ id: 'col-' + e.id, entryId: e.id, card_id: e.card.id, title: titleOf(e.card), rarity: e.card.rarity, cost: 0, value, boughtAt: Date.now(), status: 'held', source: 'collection' });
      if (++added >= 50) break;                               // 50 au plus par tour : le reste au tour suivant
    }
    if (added) { save(K.pnl, pnl); log('info', `${added} carte(s) de ta collection ajoutée(s) au stock de revente (${[...want].join(', ')})`); ui && ui.onPnl(); }
    pnl.filter(e => e.source === 'collection' && e.status === 'held').forEach(e => queueResell(e.id));
  }


  async function followListings() {
    listings = load(K.listings, {});
    for (const [id, meta] of Object.entries(listings)) {
      const a = await getAuction(id);
      if (!a || a.status === 'active') continue;
      const price = a.final_price ?? a.current_bid;
      if (meta.pnlId) {
        if (price) {
          const e = updatePnl(meta.pnlId, { status: 'sold', sale: price, soldAt: Date.now() });
          const profit = e ? price - e.cost : null;
          log('sold', `Revendue : ${meta.title} (${meta.rarity}) pour ${price}` + (profit != null ? ` · bénéfice ${profit >= 0 ? '+' : ''}${profit}` : ''));
        } else {
          const prev = load(K.pnl, []).find(x => x.id === meta.pnlId);
          const attempts = ((prev && prev.attempts) || 0) + 1;
          const tc = tcfg();
          if (attempts >= tc.abandonAfter) {
            // invendable : le bot abandonne, la carte sort du stock du trading et reste dans ta collection
            updatePnl(meta.pnlId, { status: 'kept', keptWhy: `invendable après ${attempts} essais`, attempts });
            log('unsold', `Invendue : ${meta.title} (${meta.rarity}) · ${attempts} invendus : le bot abandonne, elle reste dans ta collection et ne compte plus dans le stock`);
          } else {
            updatePnl(meta.pnlId, { status: 'held', attempts });
            const note = attempts === tc.liquidateAfter ? ` · ${attempts} invendus : liquidation, elle peut maintenant partir à perte (jamais sous ${tc.liquidateFloor} % de son prix d’achat)`
              : attempts === tc.dormantAfter ? ` · ${attempts} invendus : carte dormante, elle passe après les autres et ne bloque plus les achats` : '';
            log('unsold', `Invendue : ${meta.title} (${meta.rarity}), elle sera remise en vente` + note);
            if (config.trading.autoResell) queueResell(meta.pnlId);
          }
        }
      } else {
        const note = meta.auto ? noteAutoSale(meta.auto, !!price) : '';
        log(price ? 'sold' : 'unsold', price ? `Vendue : ${meta.title} (${meta.rarity}) pour ${price}` : `Invendue : ${meta.title} (${meta.rarity}), elle revient dans ta collection${note}`);
      }
      delete listings[id]; save(K.listings, listings);
      next.sort = 0;                                       // un emplacement de vente vient de se libérer
    }
  }

  // ═════════════════════════ Valeur des cartes : « intéressante » ═════════════════════════
  // Une carte est intéressante si son prix de vente moyen (donnée du site) vaut au moins INTEREST_FACTOR × le prix médian
  // de sa rareté (appris par le bot, voir Trading → Prix habituel). Une carte jamais vendue n'est pas intéressante.
  // Si le prix médian de la rareté n'est pas encore appris, on ne sait pas : la carte est gardée.
  const avgOf = async (cardId, rarity) => { const s = await cardSummary(cardId); return s && s[rarity] && s[rarity].average > 0 ? Math.round(s[rarity].average) : null; };
  const interestLine = r => { const ref = rarityRef(r).value; return ref ? Math.round(ref * INTEREST_FACTOR) : null; };
  const isInteresting = (avg, r) => { const line = interestLine(r); return line == null ? null : avg != null && avg >= line; };
  // seuil de défausse d'une rareté : « Défausser sous N » s'il est réglé pour elle, sinon la règle auto (2× le prix médian)
  const discardLine = r => { const pd = config.packDiscard; return pd.enabled && pd.below > 0 && pd.rarities.includes(r) && PURGE_RARITIES.includes(r) ? pd.below : interestLine(r); };

  // Cartes sorties des paquets : les intéressantes vont dans « Dernières cartes intéressantes » ; les autres, si l'option
  // est active et leur rareté cochée, sont défaussées aussitôt (sauf protégées, voulues, ou rareté confiée à la revente).
  const PACK_RETRY = 'wmbot1.packretry';
  let packRetryAt = 0;
  function savePackRetry(missed) {
    const keep = [], drop = [];
    for (const x of load(PACK_RETRY, []).concat(missed)) (Date.now() - x.at < 2 * 3600000 && x.n <= 8 ? keep : drop).push(x);
    if (drop.length) log('warn', `Cartes de paquet jamais évaluées après 2 h, laissées dans ta collection : ${drop.map(x => `${titleOf(x.c)} (${x.c.rarity}, ${x.why})`).join(', ')}`);
    save(PACK_RETRY, keep);
  }
  async function retryPackCards() {
    const q = load(PACK_RETRY, []);
    if (!q.length || Date.now() < packRetryAt) return;
    packRetryAt = Date.now() + 3 * 60000;
    save(PACK_RETRY, []);
    await evaluatePackCards(q.map(x => x.c), q);
  }
  async function evaluatePackCards(cards, meta = []) {
    const pd = config.packDiscard;
    if (!cards.length) return;
    setActivity('Estimation des cartes des paquets…');
    const fromPacks = load(K.fromPacks, {});
    // carte pas évaluée : remise en file (seulement si la défausse auto est active, sinon il n'y a rien à décider)
    const missed = [];
    const miss = (i, why) => { if (pd.enabled) missed.push({ c: cards[i], at: (meta[i] && meta[i].at) || Date.now(), n: ((meta[i] && meta[i].n) || 0) + 1, why }); };
    let coll;
    try { coll = await getCollection(); } catch { cards.forEach((c, i) => miss(i, 'collection illisible')); savePackRetry(missed); return; }
    const used = new Set(), cheap = [];
    const fresh = [];                                         // ajoutées à l'historique à la fin (relu juste avant d'écrire)
    for (const [i, c] of cards.entries()) {
      const r = c.rarity, title = titleOf(c);
      const e = coll.filter(x => x.card && x.card.rarity === r && norm(titleOf(x.card)) === norm(title) && !used.has(x.id))
        .sort((a, b) => new Date(b.obtained_at || 0) - new Date(a.obtained_at || 0))[0];
      if (!e) { miss(i, 'pas encore dans ta collection'); continue; }
      used.add(e.id);
      fromPacks[e.id] = Date.now();
      // lecture du prix : une lecture ratée (site lent) n'est PAS « jamais vendue » → la carte est gardée
      const s = await cardSummary(e.card.id).catch(() => null);
      const failed = s == null;
      const avg = !failed && s[r] && s[r].average > 0 ? Math.round(s[r].average) : null;
      // seuil fixe (« défausser sous N ») pour les raretés cochées, sinon la règle auto (2× le prix médian de la rareté)
      const fixed = pd.enabled && pd.below > 0 && pd.rarities.includes(r) && PURGE_RARITIES.includes(r);
      const line = fixed ? pd.below : interestLine(r);
      const keep = fixed ? avg != null && avg >= pd.below : isInteresting(avg, r) === true;
      const cheapCard = !failed && (fixed ? !keep : isInteresting(avg, r) === false);
      if (keep) {
        fresh.push({ t: Date.now(), title, rarity: r, avg, card_id: e.card.id, decision: `gardée (≥ ${line})` });
        log('pack', `💎 Carte intéressante dans un paquet : ${title} (${r}), se vend ${avg} en moyenne (≥ ${line}${fixed ? ', ton seuil' : ''})`);
      // sous le seuil : défaussée, même si sa rareté est confiée à la revente (au-dessus, elle part en vente comme prévu)
      } else if (cheapCard && pd.enabled && pd.rarities.includes(r) && PURGE_RARITIES.includes(r) && !isKept(e)) cheap.push({ e, avg });
      else if (failed && pd.enabled && pd.rarities.includes(r)) { log('info', `${title} (${r}) : son prix n’a pas pu être lu (site lent), nouvel essai dans quelques minutes`); miss(i, 'prix illisible'); }
    }
    savePackRetry(missed);
    for (const [id, t] of Object.entries(fromPacks)) if (Date.now() - t > 7 * 24 * 3600000) delete fromPacks[id];   // on oublie au bout de 7 jours
    save(K.fromPacks, fromPacks);
    // relu ici et pas avant la boucle : un « + Stock » cliqué pendant l'estimation ne doit pas être effacé
    const hist = load(K.packs, []);
    for (const h of fresh) hist.unshift(h);
    if (hist.length > 40) hist.length = 40;
    save(K.packs, hist);
    ui && ui.onPacks();
    if (cheap.length) {
      const desc = cheap.map(x => `${titleOf(x.e.card)} (${x.e.card.rarity}, ${x.avg ?? 'jamais vendue'})`).join(', ');
      if (config.dryRun) log('dry', `Simulation — défausserait (cartes de paquet sans intérêt) : ${desc}`);
      else {
        const r = await post('/api/user-cards/bulk-discard', { card_ids: cheap.map(x => x.e.id) });
        if (r.ok && (r.body.discarded_count ?? cheap.length) > 0) { log('discard', `Défaussé ${r.body.discarded_count ?? cheap.length} carte(s) de paquet sans intérêt : ${desc}`); cheap.forEach(x => collRemove(x.e.id)); }
        else if (r.ok) log('error', `Défausse des paquets : le site n’a rien défaussé (réponse : ${JSON.stringify(r.body).slice(0, 300)})`);
        else log('error', 'Défausse refusée : ' + errOf(r));
      }
    }
  }

  // ═════════════════════════ Paquets ═════════════════════════
  let packsLimitUntil = 0, packsBlocked = false;
  // Historique de toutes les cartes sorties des paquets (pour le résumé par rareté de l'Accueil)
  function recordPackLog(cards) {
    const hist = load(K.packLog, []);
    hist.unshift({ t: Date.now(), cards: cards.map(c => ({ title: titleOf(c), rarity: c.rarity, card_id: c.card_id || c.id || null })) });
    if (hist.length > 600) hist.length = 600;
    save(K.packLog, hist);
  }
  const rarityCount = cards => RARITIES.map(r => [r, cards.filter(c => c.rarity === r).length]).filter(([, n]) => n).map(([r, n]) => `${n} ${r}`).join(', ');
  async function openPacks() {
    packsLimitUntil = Math.max(packsLimitUntil, load(K.packLimit, 0));
    if (packsLimitUntil > Date.now()) { next.packs = packsLimitUntil; return 0; }
    setActivity('Ouverture des paquets…');
    let opened = 0;
    const packCards = [];
    for (let n = 0; n < 10; n++) {
      if (config.dryRun) { log('dry', 'Simulation — ouvrirait les paquets disponibles'); next.packs = Date.now() + 10 * 60000; return 0; }
      const r = await post('/api/packs/open');
      const b = r.body || {};
      if (!r.ok) {
        if (needsHuman(r)) {
          setHuman('packs', 'ouvre un paquet à la main', r);
        } else if (b.activity_blocked_until || b.packs_blocked_until) {
          packsBlocked = true;
          alertUser('Le site a bloqué l’activité de ton compte jusqu’à ' + new Date(b.activity_blocked_until || b.packs_blocked_until).toLocaleString() + '. Le bot s’arrête.');
          stop();
        } else if (r.status === 429 || /limite/i.test(b.error || '')) {
          if (!packsLimitUntil || packsLimitUntil < Date.now()) log('warn', `Paquets : ${b.error || 'limite atteinte'} Le bot réessaiera dans 1 h.`);
          packsLimitUntil = Date.now() + 60 * 60000;
          save(K.packLimit, packsLimitUntil);
          next.packs = packsLimitUntil;
        } else {
          log('warn', `Ouverture de paquet refusée : ${errOf(r)}. Nouvel essai dans 5 min.`);
          next.packs = Date.now() + jitter(5 * 60000);
        }
        return opened;
      }
      opened++;
      clearHuman('packs');            // le paquet s'est ouvert : la vérification a été faite
      const cards = b.cards || [];
      packCards.push(...cards);
      log('pack', 'Paquet ouvert : ' + cards.map(c => `${titleOf(c)} (${c.rarity})`).join(', '));
      recordPackLog(cards);
      const top = cards.filter(c => RANK[c.rarity] >= RANK.SR);
      notifyUser(`Paquet ouvert : ${rarityCount(cards) || 'aucune carte'}${top.length ? ' · ' + top.map(c => `${titleOf(c)} (${c.rarity})`).join(', ') : ''}`, 'packs');
      const hits = cards.filter(c => wishFor(titleOf(c)));
      if (hits.length) {
        ui.flash('🎉 Carte voulue trouvée dans un paquet : ' + hits.map(titleOf).join(', '));
        hits.forEach(c => { clearWishAlert(titleOf(c)); addTagTodo(wishFor(titleOf(c)), c.rarity, 'trouvée dans un paquet'); });
      }
      const catHits = cards.filter(c => !wishFor(titleOf(c)) && catOf(c));
      if (catHits.length) {
        ui.flash('🎉 Carte de catégorie voulue dans un paquet : ' + catHits.map(titleOf).join(', '));
        catHits.forEach(c => { const cat = catOf(c); if (cat.tag) addTagTodo({ title: titleOf(c), tag: cat.tag }, c.rarity, `trouvée dans un paquet (catégorie « ${cat.name} »)`); });
      }
      if (!(b.packs_remaining > 0)) {
        const last = b.packs_last_regen_at ? new Date(b.packs_last_regen_at).getTime() : Date.now();
        next.packs = Math.max(last + 10 * 60000, Date.now() + 60000) + jitter(15000);
        break;
      }
      await sleep(jitter(3500));
    }
    if (opened) collInvalidate();
    await evaluatePackCards(packCards);
    return opened;
  }

  // ═════════════════════════ Planificateur ═════════════════════════
  const TOUR_MAX_MS = 10 * 60000;   // garde-fou : durée au-delà de laquelle un tour est abandonné
  let running = false, busy = false, busySince = 0, loopGen = 0, activity = '', balance = null, balanceAt = 0, loopTimer = null, heartTimer = null, snipeTimer = null, sellTimer = null, guardTimer = null;
  const next = { follow: 0, packs: 0, wish: 0, trade: 0, sort: 0, listings: 0, balance: 0, owned: 0, optimize: 0, summary: 0, tags: 0, shiny: 0, cat: 0 };
  const TAB = Math.random().toString(36).slice(2);
  function haveLock() {
    const l = load(K.lock, null);
    if (l && l.tab !== TAB && Date.now() - l.ts < 30000) return false;
    save(K.lock, { tab: TAB, ts: Date.now() });
    return true;
  }
  function setActivity(s) { activity = s; ui && ui.onStatus(); }

  async function loop() {
    if (!running) return;
    if (busy) {
      // garde-fou : un tour qui dure plus de 10 min est abandonné pour que le bot reparte. Un tour normal dépasse souvent
      // 3 min (recherche de trading ~2 min, catégories, ventes…) et chaque requête a son propre délai maximal : avec l'ancien
      // seuil de 3 min, des tours sains étaient relancés et l'ancien continuait en parallèle (recherches en double, site
      // encore plus lent). L'ancien tour s'arrête maintenant à sa prochaine étape (alive) ou page de recherche (tour).
      if (Date.now() - busySince < TOUR_MAX_MS) return;
      log('warn', `Un tour du bot durait depuis plus de ${TOUR_MAX_MS / 60000} min : il repart.`);
      notifyUser(`Bot relancé (tour de plus de ${TOUR_MAX_MS / 60000} min)`);
    }
    busy = true; busySince = Date.now();
    const gen = ++loopGen;
    const alive = () => gen === loopGen;                  // false : tour abandonné par le garde-fou, il s'arrête à l'étape suivante
    try {
      config = loadConfig(); tracked = load(K.tracked, {}); listings = load(K.listings, {}); market = load(K.market, { samples: {} });
      if (!haveLock()) { activity = 'En attente : le bot tourne déjà dans un autre onglet'; return; }
      if (siteDown()) {                                         // site en difficulté : seulement le suivi des enchères
        activity = `Site en difficulté : pause des recherches, ventes et paquets jusqu’à ${new Date(siteDownUntil).toTimeString().slice(0, 5)}`;
        if (Date.now() >= next.follow) { await followBids(); next.follow = Date.now() + 15000; }
        return;
      }
      // pause du site : l'extension WikiMasters Clic tente de débloquer (au plus toutes les 2 min), sans attendre une carte à miser
      const paused = Object.keys(humanState());
      if (paused.length) unblockByClick(paused[0]);
      await snipeTick();
      if (!alive()) return;
      const now = Date.now();
      if (now >= next.balance) { balance = await getBalance(); balanceAt = Date.now(); next.balance = Date.now() + modeVal('balanceS', 30) * 1000; }
      if (!alive()) return;
      if (now >= next.follow) {
        setActivity('Suivi de tes enchères…');
        const soonest = await followBids();
        if (!alive()) return;
        next.follow = Date.now() + (soonest - srvNow() < 150000 ? 5000 : modeVal('pollEveryS', config.pollEveryS) * 1000);
      }
      await snipeTick();
      if (!alive()) return;

      if (config.packs.enabled && !packsBlocked && !humanFor('packs') && now >= next.packs) {
        if (await openPacks()) next.sort = 0;
        if (!alive()) return;
        if (next.packs <= now) next.packs = Date.now() + 10 * 60000;
      } else if (config.packs.enabled && !packsBlocked && humanFor('packs') && takeProbe('packs')) {
        if (await openPacks()) next.sort = 0;                  // un essai toutes les 10 min pendant la pause
        if (!alive()) return;
      }
      // la revente passe avant le trading : libérer le stock est prioritaire
      await retryPackCards();
      if (!alive()) return;
      if (now >= next.sort) { await syncStockSell(); await sellAndSort(); next.sort = Date.now() + modeVal('sortEveryMin', 5) * 60000; }
      if (!alive()) return;
      await snipeTick();
      if (!alive()) return;
      // cartes voulues et catégories avant le trading : elles sont prioritaires
      if (config.wishlist.items.length && now >= next.owned) { await refreshOwned(); next.owned = Date.now() + 10 * 60000; }
      if (!alive()) return;
      if (config.wishlist.enabled && config.wishlist.items.length && now >= next.wish) { const done = await scanWishlist(); next.wish = done ? Date.now() + modeVal('wishEveryMin', config.wishlist.scanEveryMin) * 60000 : Date.now() + 2000; }
      if (!alive()) return;
      if (config.wishlist.enabled && (catQueue || config.wishlist.categories.some(c => c.enabled)) && now >= next.cat) { const done = await scanCategories(); next.cat = done ? Date.now() + modeVal('wishEveryMin', config.wishlist.scanEveryMin) * 60000 : Date.now() + 2000; }
      if (!alive()) return;
      await snipeTick();
      if (!alive()) return;
      if (config.trading.enabled && now >= next.trade) { await scanTrading(); next.trade = Date.now() + modeVal('scanEveryS', config.trading.scanEveryS) * 1000; }
      if (!alive()) return;
      if (config.trading.enabled) tradeWatchdog(Date.now());
      if (config.trading.shinyAutoMin > 0 && now >= next.shiny) {
        next.shiny = Date.now() + Math.max(config.trading.shinyAutoMin, config.mode === 'slow' ? 10 : 0) * 60000;   // mode lent : 10 min au moins
        // en parallèle, sans attendre : une recherche de shiny lit jusqu'à 60 pages (5 à 10 min sur un site lent) et
        // bloquait le trading pendant ce temps (bilan du 04/10 : 6 recherches de trading en une heure au lieu de ~60)
        autoShiny().catch(err => log('warn', 'Recherche des shiny : ' + err.message));
      }
      if (now >= next.tags && load(K.tagTodo, []).some(x => !x.manual)) { await tagTick(); next.tags = Date.now() + 60000; }
      if (!alive()) return;
      activity = 'En veille · prochaine action ' + nextActionText();
    } catch (err) {
      log('error', 'Erreur inattendue : ' + err.message);
    } finally {
      if (gen === loopGen) busy = false;   // un ancien tour abandonné ne débloque pas le tour en cours
      ui && ui.onStatus();
    }
  }
  function upcoming() {
    const list = [{ at: next.follow, label: 'Suivi de tes enchères' }];
    if (config.packs.enabled && !packsBlocked && !humanFor('packs')) list.push({ at: next.packs, label: packsLimitUntil > Date.now() ? 'Paquets (limite quotidienne atteinte, nouvel essai)' : 'Ouverture des paquets' });
    if (config.trading.enabled) list.push({ at: next.trade, label: 'Recherche de bonnes affaires' });
    if (config.trading.shinyAutoMin > 0) list.push({ at: next.shiny, label: 'Recherche des shiny' });
    if (config.wishlist.enabled && config.wishlist.categories.some(c => c.enabled)) list.push({ at: next.cat, label: 'Recherche des catégories voulues' });
    for (const w of watch.values()) list.push({ at: new Date(w.end).getTime() - clockOffset - snipeWindowMs(), label: `Mise sur ${w.title} (affaire surveillée)` });
    if (config.wishlist.enabled && config.wishlist.items.length) list.push({ at: next.wish, label: 'Recherche des cartes voulues' });
    if (config.sell.enabled || config.discard.enabled) list.push({ at: next.sort, label: 'Vente et tri' });
    return list.sort((a, b) => a.at - b.at);
  }
  function nextActionText() {
    const u = upcoming()[0];
    return u ? `dans ${fmtLeft(u.at - Date.now())} (${u.label.toLowerCase()})` : '';
  }

  // Un Worker n'est pas ralenti par Chrome quand l'onglet est caché : on s'en sert pour cadencer le bot
  let workerTicks = false;
  function makeTicker(ms, fn) {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' })));
      const t = { stop: () => w.terminate() };
      w.onmessage = () => { workerTicks = true; fn(); };
      w.onerror = () => { w.terminate(); workerTicks = false; const i = setInterval(fn, ms); t.stop = () => clearInterval(i); };
      return t;
    } catch {
      const i = setInterval(fn, ms);
      return { stop: () => clearInterval(i) };
    }
  }

  function start() {
    if (running) return;
    running = true; save(K.running, true);
    Object.keys(next).forEach(k => next[k] = 0);
    resetTradeStats(); tstats.whySinceBid.clear(); tstats.lastBidAt = Date.now(); tstats.alertedAt = 0;
    log('info', config.dryRun ? 'Bot démarré en simulation (aucune action réelle)' : 'Bot démarré');
    loopTimer = makeTicker(3000, loop);
    // tant que cet onglet a la main, on rafraîchit le verrou (les tâches longues ne doivent pas le laisser expirer)
    heartTimer = makeTicker(5000, () => { const l = load(K.lock, null); if (running && l && l.tab === TAB) save(K.lock, { tab: TAB, ts: Date.now() }); });
    // mises « au dernier moment » vérifiées toutes les 2 s, même quand le bot est occupé ailleurs
    snipeTimer = makeTicker(2000, () => {
      const l = load(K.lock, null);
      if (!(running && l && l.tab === TAB)) return;
      const fail = err => { if (Date.now() - (snipeTick.lastErr || 0) > 60000) { snipeTick.lastErr = Date.now(); log('error', 'Mise au dernier moment : ' + err.message); } };
      snipeTick().catch(fail);
    });
    // fin de nos enchères surveillée de près (toutes les sources), cadence réglée par endGuardTick selon le mode
    guardTimer = makeTicker(1000, () => {
      const l = load(K.lock, null);
      if (!(running && l && l.tab === TAB)) return;
      endGuardTick().catch(err => { if (Date.now() - (endGuardTick.lastErr || 0) > 60000) { endGuardTick.lastErr = Date.now(); log('error', 'Fin d’enchère : ' + err.message); } });
    });
    // ventes : fin détectée à l'heure prévue et emplacements libérés remplis aussitôt
    sellTimer = makeTicker(12000, () => { const l = load(K.lock, null); if (running && l && l.tab === TAB) sellTick().catch(err => log('error', 'Vente : ' + err.message)); });
    loop();
    ui && ui.onStatus();
  }
  function stop() {
    running = false; save(K.running, false);
    [loopTimer, heartTimer, snipeTimer, sellTimer, guardTimer].forEach(t => t && t.stop());
    activity = '';
    log('info', 'Bot arrêté');
    ui && ui.onStatus();
  }
  function alertUser(msg) {
    log('alert', msg);
    ui && ui.banner(msg);
    notifyUser(msg);
  }
  // Notification du navigateur, selon les réglages : 'blocks' (blocages, actions à faire), 'packs', 'sales'
  // url : un clic sur la notification ouvre cette page dans un nouvel onglet
  // Notification sur le téléphone : appli gratuite ntfy (ntfy.sh), abonnée au même sujet que celui des Réglages.
  // Le message ne contient que le texte de la notification (aucune donnée de compte).
  function phoneNotify(msg, kind = 'blocks', url = null) {
    const topic = config.notify.phone;
    if (!topic) return Promise.resolve(false);
    const headers = { Title: 'WikiMasters Bot', Tags: kind === 'blocks' ? 'warning' : kind === 'shiny' ? 'sparkles' : 'robot', Priority: kind === 'blocks' ? 'high' : 'default' };
    if (url) headers.Click = url;
    return fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: msg, headers })
      .then(r => r.ok).catch(() => false);
  }
  function notifyUser(msg, kind = 'blocks', url = null) {
    if (config.notify.off) return;                          // « Couper toutes les notifications »
    if (kind !== 'wish' && !config.notify[kind]) return;   // 'wish' : déjà choisi carte par carte
    phoneNotify(msg, kind, url);                            // aussi sur le téléphone si un sujet ntfy est réglé
    try {
      if (Notification.permission !== 'granted') return;
      const n = new Notification('🤖 WikiMasters Bot', { body: msg, tag: 'wmbot-' + kind + '-' + Date.now() });
      if (url) n.onclick = () => { window.open(url, '_blank', 'noopener'); n.close(); };
    } catch {}
  }

  // ── Actions à faire par un humain ──
  // Quand le site demande une vérification (paquets, mises en vente, enchères), le bot met cette activité en pause,
  // entoure le panneau de bleu et affiche l'action à faire. L'état est mémorisé : il survit à un rechargement de page.
  const HUMAN_NAMES = { packs: 'Paquets', sell: 'Ventes', bids: 'Enchères' };
  const humanState = () => load(K.human, {});
  const humanFor = key => !!humanState()[key];
  // Vérification humaine : le drapeau explicite du site, ou une phrase sans ambiguïté. Un message qui contient seulement
  // le mot « vérification » (solde, enchère…) ne met plus les enchères en pause.
  const HUMAN_RE = /v[ée]rification\s+(humaine|anti-?bot)|prouve[rz]?\s+que\s+(tu\s+es|vous\s+[êe]tes)\s+humain|captcha|turnstile|are\s+you\s+human/i;
  const needsHuman = r => { const b = (r && r.body) || {}; return b.human_verification_required === true || HUMAN_RE.test(String(b.error || b.message || '')); };
  function setHuman(key, msg, r) {
    unblockByClick(key);                                   // vrai clic par l'extension WikiMasters Clic, si elle est là
    const all = humanState();
    if (all[key]) return;
    const site = r ? String((r.body && (r.body.error || r.body.message)) || ('erreur ' + r.status)).slice(0, 160) : '';
    all[key] = { msg, at: Date.now(), site };
    save(K.human, all);
    log('alert', `${HUMAN_NAMES[key] || key} en pause : ${msg}${site ? ` (réponse du site : « ${site} »)` : ''}`);
    notifyUser(`${HUMAN_NAMES[key] || key} en pause : vérification à faire`);
    ui && ui.onHuman();
  }
  function clearHuman(key, byClick = false) {
    if (!byClick) { clickStreak = 0; clickHuman = false; }   // action acceptée (ou « Fait ») : l'extension peut de nouveau cliquer
    const all = humanState();
    if (!all[key]) return;
    delete all[key];
    save(K.human, all);
    log('info', `${HUMAN_NAMES[key] || key} : reprise après ${byClick ? 'le clic de l’extension' : 'ta vérification'}`);
    if (key === 'packs') next.packs = 0;
    if (key === 'sell') next.sort = 0;
    ui && ui.onHuman();
  }
  // Toutes les actions en attente : vérifications, cartes voulues au-dessus du seuil, étiquettes à poser
  const humanTodos = () => ({ checks: Object.entries(humanState()), wish: activeWishAlerts(), tags: load(K.tagTodo, []).filter(x => x.manual) });   // étiquettes : seulement celles que le bot n'a pas pu poser

  // ── Notifications masquées (✕) ──
  // Une notification masquée ne revient pas tant que sa cause n'est pas résolue : chaque masquage garde une signature
  // (vérification : son heure de début ; cartes > seuil : les enchères concernées ; étiquette : carte + étiquette).
  // Une nouvelle vérification, une nouvelle enchère au-dessus du seuil ou une nouvelle étiquette réapparaissent.
  const tagSig = x => norm(x.title) + '|' + norm(x.tag);
  const hiddenState = () => { const h = load(K.hidden, {}); return { checks: h.checks || {}, wish: h.wish || [], tags: h.tags || [] }; };
  function visibleTodos() {
    const h = humanTodos(), hid = hiddenState();
    // signatures obsolètes : cause résolue (ou remplacée) → oubliées
    const clean = {
      checks: Object.fromEntries(Object.entries(hid.checks).filter(([k, at]) => h.checks.some(([k2, x]) => k2 === k && x.at === at))),
      wish: hid.wish.filter(id => h.wish.some(x => x.auctionId === id)),
      tags: hid.tags.filter(sig => h.tags.some(x => tagSig(x) === sig)),
    };
    if (JSON.stringify(clean) !== JSON.stringify(hid)) save(K.hidden, clean);
    return {
      checks: h.checks.filter(([k, x]) => clean.checks[k] !== x.at),
      wish: h.wish.filter(x => !clean.wish.includes(x.auctionId)),
      tags: h.tags.filter(x => !clean.tags.includes(tagSig(x))),
    };
  }
  function hideHuman(kind, id) {
    const hid = hiddenState(), h = humanTodos();
    if (kind === 'check') { const x = humanState()[id]; if (x) hid.checks[id] = x.at; }
    if (kind === 'wish') hid.wish = [...new Set([...hid.wish, ...h.wish.map(x => x.auctionId).filter(Boolean)])];
    if (kind === 'tag') hid.tags = [...new Set([...hid.tags, id])];
    save(K.hidden, hid);
    ui && ui.onHuman();
  }
  const humanCount = () => { const h = visibleTodos(); return h.checks.length + h.wish.length + h.tags.length; };

  // ── Déblocage par l'extension « WikiMasters Clic » (v2.10 / v3.2) ──
  // Pour le site, un clic fait par un script de la page n'est pas un vrai clic (isTrusted = false). L'extension, elle, clique
  // comme une souris. Sur un blocage, le bot lui demande d'ouvrir la page réglée et d'y cliquer le bouton (« Miser ») : c'est
  // ce que faisait la macro UI Vision en surveillant l'encadré. La case « Vérifiez que vous êtes humain » reste à cocher à la main.
  // Bot ⇄ extension : window.postMessage, relayé par le script de contenu de l'extension (dossier wikimasters-clic).
  const CLICK_EVERY_MS = 2 * 60000, CLICK_SLOW_MS = 15 * 60000, CLICK_MAX = 3, CLICK_HUMAN_MS = 30 * 60000;
  // clickStreak : essais depuis la dernière action acceptée par le site ; après CLICK_MAX essais sans effet, un essai
  // toutes les 15 min seulement (« Miser » place une vraie mise). clickHuman : le site demande une vérification humaine,
  // l'onglet de l'enchère est resté ouvert pour toi ; pas de nouveau clic avant 30 min ou avant une action acceptée.
  let clickExt = null, clickBusy = false, clickNext = 0, clickLastAt = 0, clickStreak = 0, clickHuman = false;
  const clickReady = () => !!clickExt && config.unblock.on && !!config.unblock.url && !config.dryRun;   // jamais en simulation : le clic est réel
  const clickHandles = () => clickReady() && !clickHuman;                                             // l'extension s'occupe des blocages
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.wmclickHello) return;
    const first = !clickExt;
    clickExt = String(e.data.wmclickHello);
    if (first) ui && ui.onClickExt();
  });
  window.postMessage({ wmclickPing: 1 }, '*');
  function askClick(req) {
    const id = Math.random().toString(36).slice(2);
    return new Promise(resolve => {
      const done = r => { clearTimeout(to); window.removeEventListener('message', on); resolve(r || { ok: false, error: 'réponse vide' }); };
      const on = e => { if (e.source === window && e.data && e.data.wmclickReply && e.data.wmclickReply.id === id) done(e.data.wmclickReply); };
      const to = setTimeout(() => done({ ok: false, error: 'pas de réponse de l’extension en 90 s' }), 90000);
      window.addEventListener('message', on);
      window.postMessage({ wmclick: { id, url: req.url, text: req.text } }, '*');
    });
  }
  // key : l'activité bloquée ; test = true : clic demandé depuis les Réglages, sans blocage ni attente
  async function unblockByClick(key, test = false) {
    const u = config.unblock;
    if (!clickExt) return { ok: false, error: 'extension WikiMasters Clic absente de ce navigateur' };
    if (!test) {
      if (!clickReady() || Date.now() < clickNext) return null;
      clickHuman = false;                                      // 30 min après une demande de vérification : nouvel essai
      if (Date.now() - clickLastAt > 30 * 60000) clickStreak = 0;   // blocage d'une autre fois : compteur remis à zéro
    }
    if (clickBusy) return { ok: false, error: 'un clic est déjà en cours' };
    clickBusy = true;
    if (!test) {
      clickStreak++; clickLastAt = Date.now();
      clickNext = Date.now() + (clickStreak >= CLICK_MAX ? CLICK_SLOW_MS : CLICK_EVERY_MS);
      log('info', `${HUMAN_NAMES[key] || key} bloquées : l’extension clique « ${u.button} » sur ${u.url} (essai ${clickStreak})`);
    }
    try {
      const r = await askClick({ url: u.url, text: u.button });
      if (!r.ok) {
        log('warn', `Déblocage par clic : ${r.error}`);
        if (!test && clickStreak === CLICK_MAX) {
          log('alert', `Déblocage par clic : ${CLICK_MAX} clics d’affilée sans effet, l’extension ne réessaiera plus que toutes les 15 min. Une mise à la main débloque tout de suite.`);
          notifyUser('Le clic de l’extension ne débloque pas : une mise à la main débloque tout de suite', 'blocks');
        }
      } else if (r.human) {
        clickHuman = true; clickNext = Date.now() + CLICK_HUMAN_MS;
        log('alert', 'Déblocage par clic : le site demande une vérification humaine. L’onglet de l’enchère est resté ouvert : fais la vérification, la mise se place toute seule ensuite.');
        notifyUser('Vérification humaine à faire : l’onglet de l’enchère est ouvert', 'blocks');
      } else {
        if (r.accepted) {
          log('info', `Déblocage par clic : mise acceptée par le site, blocage levé`);
          if (key) clearHuman(key);                            // mise acceptée par le site : la pause se lève, le bot reprend
        } else {                                                 // extension 1.0 : résultat inconnu
          log('info', `Déblocage par clic : « ${u.button} » cliqué (extension 1.0 : le résultat n’est pas vérifié, mets-la à jour)`);
          if (key) clearHuman(key, true);
        }
      }
      return r;
    } finally { clickBusy = false; ui && ui.onHuman(); }
  }

  // ── Relance automatique après une vérification ──
  // Une activité en pause (paquets, ventes, enchères) retente UNE action au plus toutes les 10 min : si tu as fait la
  // vérification sur le site entre-temps, elle passe et la pause se lève toute seule. Sinon la pause reste, sans nouvelle
  // notification. Le bouton « Fait » relance tout de suite.
  const HUMAN_RETRY_MS = 10 * 60000;
  const humanTriedAt = {};
  const probeReady = key => { const x = humanState()[key]; return !!x && Date.now() - Math.max(x.at, humanTriedAt[key] || 0) >= HUMAN_RETRY_MS; };
  function takeProbe(key) {
    if (!probeReady(key)) return false;
    humanTriedAt[key] = Date.now();
    log('info', `${HUMAN_NAMES[key] || key} : nouvel essai pour voir si la vérification a été faite`);
    return true;
  }

  // ═════════════════════════ Interface ═════════════════════════
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .panel { position: fixed; right: 14px; bottom: 14px; z-index: 2147483000; width: 440px; max-width: calc(100vw - 28px); height: 620px; max-height: calc(100vh - 28px);
    display: flex; flex-direction: column; background: #0f1311; color: #e6e9e7; border: 1px solid #25382d; border-radius: 14px; box-shadow: 0 12px 40px #000c; font-size: 13px; overflow: hidden; }
  .panel.min { height: auto; width: 320px; }
  .panel.min .tabs, .panel.min .body, .panel.min .banner, .panel.min .ask, .panel.min .flash, .panel.min .modal { display: none !important; }
  header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #131a16; border-bottom: 1px solid #22302a; }
  .status { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .ring { width: 28px; height: 28px; flex: none; border-radius: 50%; position: relative; display: grid; place-items: center; }
  .ring::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 3px solid #2a342f; }
  .ring .dot { width: 10px; height: 10px; border-radius: 50%; background: #5b6660; }
  .on .ring::before { border-color: #3ecf8e2e; border-top-color: #3ecf8e; animation: spin .9s linear infinite; }
  .on .ring .dot { background: #3ecf8e; color: #3ecf8e; animation: pulse 1.6s ease-out infinite; }
  .on.sim .ring::before { border-color: #f5c2422e; border-top-color: #f5c242; }
  .on.sim .ring .dot { background: #f5c242; color: #f5c242; }
  .on.idle .ring::before { animation-duration: 2.8s; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 8px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
  .stxt { min-width: 0; } .stxt b { display: block; font-size: 13px; } .stxt small { display: block; color: #8fa197; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button { font: inherit; background: #1b2620; color: #e6e9e7; border: 1px solid #2f4a3b; border-radius: 8px; padding: 6px 11px; cursor: pointer; }
  button:hover { background: #22352b; } button:disabled { opacity: .5; cursor: default; }
  .go { background: #2e9e67; border-color: #2e9e67; color: #fff; font-weight: 600; } .go:hover { background: #33b173; }
  .stop { background: #3a1d1d; border-color: #7a3030; color: #ffb4b4; font-weight: 600; } .stop:hover { background: #4a2222; }
  .ghost { background: none; border-color: transparent; color: #8fa197; padding: 4px 8px; }
  .danger { border-color: #7a3030; color: #ffb4b4; }
  .tabs { display: flex; background: #111814; border-bottom: 1px solid #22302a; overflow-x: auto; }
  .tabs button { flex: 1; border: 0; border-radius: 0; background: none; color: #8fa197; padding: 9px 6px; white-space: nowrap; font-size: 12px; }
  .tabs button.on { color: #3ecf8e; box-shadow: inset 0 -2px #3ecf8e; }
  .body { flex: 1; overflow: auto; padding: 12px; }
  section { display: none; } section.on { display: block; }
  .banner, .ask, .flash { display: none; padding: 9px 12px; font-size: 12px; line-height: 1.4; }
  .banner { background: #4a2412; color: #ffd9c7; } .flash { background: #173d2a; color: #b8f5d4; }
  .ask { background: #3a2e0a; color: #ffe7a3; } .ask .row2 { display: flex; gap: 6px; justify-content: flex-end; margin-top: 7px; }
  .banner.on, .ask.on, .flash.on { display: block; }
  .card { background: #151c18; border: 1px solid #22302a; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
  .card h3 { margin: 0 0 6px; font-size: 13px; color: #cfe9db; }
  .help { color: #8fa197; font-size: 12px; line-height: 1.45; margin: 4px 0 8px; } .help b { color: #cfe9db; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .tile { background: #151c18; border: 1px solid #22302a; border-radius: 10px; padding: 8px 10px; } .tile span { color: #8fa197; font-size: 11px; } .tile b { display: block; font-size: 18px; margin-top: 2px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; }
  .row > label:first-child { flex: 1; } .row small { display: block; color: #7c8d84; font-size: 11px; }
  input[type=number], input[type=text], select, textarea { font: inherit; background: #0b0e0c; color: #e6e9e7; border: 1px solid #2c3a33; border-radius: 7px; padding: 5px 8px; }
  input[type=number] { width: 86px; text-align: right; } textarea { width: 100%; min-height: 70px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 2px solid #3ecf8e55; border-color: #3ecf8e; }
  .switch { position: relative; display: inline-block; vertical-align: middle; width: 38px; height: 22px; flex: none; }
  .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .switch span { position: absolute; inset: 0; background: #2c3a33; border-radius: 99px; cursor: pointer; transition: .2s; }
  .switch span::after { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #cfd8d3; border-radius: 50%; transition: .2s; }
  .switch input:checked + span { background: #2e9e67; } .switch input:checked + span::after { transform: translateX(16px); background: #fff; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #2c3a33; border-radius: 99px; padding: 4px 10px; cursor: pointer; user-select: none; font-size: 12px; }
  .chip input { display: none; } .chip.on { background: #1f3d2e; border-color: #3ecf8e; color: #b8f5d4; } .chip.locked { opacity: .35; cursor: not-allowed; }
  .r-L { color: #ffcf5c; } .r-UR { color: #ff9f43; } .r-SR { color: #ff6fae; } .r-R { color: #b18cff; } .r-PC { color: #7fb6ff; } .r-C { color: #a9c4b5; }
  .grid6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; } .grid6 label { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; } .grid6 input { width: 100%; text-align: center; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; } th { text-align: left; color: #7c8d84; font-weight: 500; padding: 4px; } td { padding: 5px 4px; border-top: 1px solid #1e2823; vertical-align: middle; }
  td input[type=number] { width: 70px; }
  .list { max-height: 230px; overflow: auto; }
  tr.owned td { background: #12291d; } tr.owned td:first-child { box-shadow: inset 3px 0 #3ecf8e; }
  .got { display: inline-block; font-size: 10px; font-weight: 700; color: #0f1311; background: #3ecf8e; border-radius: 99px; padding: 1px 7px; margin-bottom: 2px; }
  .todo { display: inline-block; font-size: 10px; font-weight: 700; color: #f5c242; border: 1px solid #6b5b1a; border-radius: 99px; padding: 0 6px; margin-bottom: 2px; }
  .auto { color: #6fc3ff; white-space: nowrap; cursor: help; } .auto input, .auto select { cursor: help; } input:disabled, select:disabled { opacity: .45; cursor: not-allowed; }
  .muted { color: #7c8d84; } .good { color: #3ecf8e; } .bad { color: #ff7b7b; } .warn { color: #f5c242; }
  .cbs { margin: 2px 0 6px; } .cb { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto auto auto auto; gap: 8px; align-items: center; padding: 3px 0; border-top: 1px solid #1e2823; font-size: 12px; } .cb:first-child { border-top: 0; }
  .cbt { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e6e9e7; }
  .cbs-on, .cbs-off { font-size: 11px; padding: 1px 7px; border-radius: 99px; } .cbs-on { background: #12382a; color: #3ecf8e; } .cbs-off { background: #3a3215; color: #f5c242; }
  .feed div { padding: 4px 0; border-bottom: 1px solid #1a231e; font-size: 12px; line-height: 1.35; } .feed time { color: #6c7d74; margin-right: 6px; font-variant-numeric: tabular-nums; }
  .search { display: flex; gap: 6px; } .search input { flex: 1; }
  .result { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid #1a231e; }
  .pill { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px; background: #1f3d2e; border: 1px solid #3ecf8e; color: #b8f5d4; }
  .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: #2e9e67; color: #fff; padding: 6px 12px; border-radius: 99px; font-size: 12px; opacity: 0; transition: opacity .25s; pointer-events: none; }
  .toast.on { opacity: 1; }
  details summary { cursor: pointer; color: #8fa197; margin: 4px 0; }
  /* action à faire par un humain : contour bleu du panneau + encadré bleu */
  .panel.human { border: 2px solid #3b82f6; box-shadow: 0 0 0 3px #3b82f633, 0 12px 40px #000c; animation: humanGlow 2.4s ease-in-out infinite; }
  @keyframes humanGlow { 50% { box-shadow: 0 0 0 6px #3b82f622, 0 12px 40px #000c; } }
  .todobox { display: none; padding: 9px 12px; background: #0f1d33; border-bottom: 1px solid #2c4f86; color: #cfe0ff; font-size: 12px; line-height: 1.45; }
  .todobox.on { display: block; } .todobox b.t { color: #8fbaff; display: block; margin-bottom: 4px; }
  .todobox .it { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; border-top: 1px solid #1d3354; }
  .todobox .it:first-of-type { border-top: 0; } .todobox button { border-color: #3b82f6; background: #13284a; color: #dbe8ff; padding: 4px 9px; white-space: nowrap; }
  .bdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; margin-left: 5px; vertical-align: middle; box-shadow: 0 0 0 2px #3b82f633; }
  tr.decide td { background: #0f1d33; } tr.decide td:first-child { box-shadow: inset 3px 0 #3b82f6; }
  /* liste des cartes voulues */
  .wi { padding: 8px 2px; border-top: 1px solid #1e2823; } .wi:first-child { border-top: 0; }
  .wi.decide { background: #0f1d33; border: 1px solid #2c4f86; border-radius: 9px; padding: 8px; margin: 4px 0; }
  .wtop { display: flex; align-items: center; gap: 8px; }
  .wname { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wi.owned .wname { color: #9fdcbf; }
  .wown { font-size: 11px; color: #3ecf8e; white-space: nowrap; }
  .wcap { display: flex; align-items: center; gap: 3px; color: #7c8d84; font-size: 12px; } .wcap input { width: 62px; padding: 3px 6px; }
  .wsub { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; font-size: 11px; }
  .wtag { width: 104px; font-size: 11px !important; padding: 2px 6px !important; background: transparent !important; border-color: #22302a !important; }
  .wtag:not(:placeholder-shown) { border-color: #2c4f86 !important; color: #8fbaff; }
  .wdec { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; color: #cfe0ff; }
  .wdec input { width: 60px; padding: 3px 6px; } .wdec button { padding: 3px 9px; }
  .decision { margin-top: 5px; padding: 6px 8px; border: 1px solid #2c4f86; border-radius: 8px; background: #0b1628; color: #cfe0ff; }
  .decision .acts { display: flex; gap: 6px; align-items: center; margin-top: 5px; flex-wrap: wrap; } .decision input { width: 76px; }
  .tagin { width: 100%; margin-top: 4px; font-size: 11px; padding: 3px 6px; }
  /* trading : barre d'actions du stock et de l'analyse */
  .stkbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .stkbar button { padding: 4px 10px; }
  .chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #cfe9db; cursor: pointer; margin-right: 4px; }
  td input[type=checkbox], th input[type=checkbox], .chk input { accent-color: #3ecf8e; cursor: pointer; }
  /* sections repliables : clic sur le titre */
  .card > h3[data-fold] { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .card > h3[data-fold]::after { content: '▾'; margin-left: auto; color: #5d6d64; font-size: 11px; }
  .card.closed > h3[data-fold]::after { content: '▸'; }
  .card.closed > h3[data-fold] { margin: 0; }
  .card.closed > :not(h3) { display: none !important; }
  /* barres de défilement discrètes, sans fond blanc */
  * { scrollbar-width: thin; scrollbar-color: #2a3a31 transparent; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2a3a31; border-radius: 6px; }
  ::-webkit-scrollbar-thumb:hover { background: #36503f; }
  ::-webkit-scrollbar-corner { background: transparent; }
  /* encadré bleu : boutons et croix de masquage */
  .todobox .acts { display: flex; gap: 4px; flex: none; }
  .todobox button.x { background: none; border-color: transparent; color: #8fbaff; opacity: .7; padding: 4px 6px; }
  .todobox button.x:hover { opacity: 1; background: #13284a; }
  /* modes de vitesse */
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .modebtn { border: 0; border-radius: 12px; padding: 11px 12px; text-align: left; font-size: 15px; font-weight: 800; letter-spacing: .3px; background-size: 220% 220%; transition: filter .2s, transform .1s; }
  .modebtn small { display: block; margin-top: 3px; font-size: 10.5px; font-weight: 600; letter-spacing: 0; opacity: .9; }
  .modebtn:active { transform: scale(.97); }
  .modebtn:not(.on) { filter: saturate(.7) brightness(.8); } .modebtn:hover { filter: none; }
  .modebtn.on { outline: 2px solid #ffffffcc; outline-offset: 2px; }
  .modebtn.turbo { color: #fff; text-shadow: 0 1px 6px #0006; background-image: linear-gradient(115deg, #4c1d95, #7c3aed 25%, #c026d3 50%, #ec4899 72%, #f97316); box-shadow: 0 4px 18px #a21caf66; animation: modeBg 2.2s ease infinite; }
  .modebtn.slow { color: #062a43; background-image: linear-gradient(140deg, #f0fbff, #bdeafe 30%, #7dd3fc 55%, #38bdf8 78%, #1e40af); box-shadow: 0 4px 18px #38bdf844; animation: modeBg 9s ease infinite; }
  .modebtn.slow:hover { background-color: #bdeafe; }
  @keyframes modeBg { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
  .panel.flash-turbo { border: 2px solid #c026d3 !important; animation: flashTurbo .45s linear infinite !important; }
  @keyframes flashTurbo { 0% { border-color: #7c3aed; box-shadow: 0 0 0 3px #7c3aed55, 0 0 26px #7c3aed99, 0 12px 40px #000c; } 33% { border-color: #ec4899; box-shadow: 0 0 0 3px #ec489955, 0 0 30px #ec4899aa, 0 12px 40px #000c; } 66% { border-color: #f97316; box-shadow: 0 0 0 3px #f9731655, 0 0 26px #f9731699, 0 12px 40px #000c; } 100% { border-color: #7c3aed; box-shadow: 0 0 0 3px #7c3aed55, 0 0 26px #7c3aed99, 0 12px 40px #000c; } }
  .panel.flash-slow { border: 2px solid #7dd3fc !important; animation: flashSlow 2.5s ease-in-out infinite !important; }
  @keyframes flashSlow { 0%, 100% { border-color: #bdeafe; box-shadow: 0 0 0 3px #bdeafe33, 0 0 22px #7dd3fc66, 0 12px 40px #000c; } 50% { border-color: #38bdf8; box-shadow: 0 0 0 5px #38bdf833, 0 0 34px #38bdf899, 0 12px 40px #000c; } }
  /* anneau en haut à gauche : couleur et vitesse du mode */
  .status.m-turbo .ring::before { border-color: #c026d333; border-top-color: #e879f9; border-right-color: #f97316; }
  .status.m-turbo .ring .dot { background: #e879f9; color: #e879f9; }
  .status.on.m-turbo .ring::before { animation: spin .35s linear infinite; }
  .status.m-slow .ring::before { border-color: #7dd3fc2e; border-top-color: #bdeafe; }
  .status.m-slow .ring .dot { background: #7dd3fc; color: #7dd3fc; }
  .status.on.m-slow .ring::before { animation: spin 3.2s linear infinite; }
  /* liste des cartes voulues, v2.8 */
  .wbidl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 5px; font-size: 12px; }
  .wbidl .wsp { flex: 1; } .wleft { color: #8fa197; font-variant-numeric: tabular-nums; }
  .wbid { width: 64px; padding: 3px 6px !important; } .wbtn { padding: 3px 9px; font-size: 12px; }
  .wopt { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 5px; font-size: 11px; color: #8fa197; }
  .wchk { display: flex; align-items: center; gap: 5px; cursor: pointer; } .wchk input { accent-color: #3b82f6; margin: 0; }
  .wtagl { display: flex; align-items: center; gap: 5px; }
  .mvals > div { display: grid; grid-template-columns: 34px 1fr 1fr; gap: 6px; align-items: center; padding: 5px 0; border-bottom: 1px solid #1e2823; font-size: 12px; }
  .mvals span { color: #8fa197; } .mvals span b { color: #e6e9e7; }
  .liqadd { width: 58px; padding: 3px 6px !important; margin-left: 4px; }
  [data-v="stkAdd"] .result button { padding: 2px 10px; font-weight: 700; }
  /* fenêtre d'ajout d'une carte voulue */
  .modal { display: none; position: absolute; inset: 0; background: #000b; z-index: 5; align-items: center; justify-content: center; padding: 16px; }
  .modal.on { display: flex; }
  .mbox { width: 100%; max-height: 100%; overflow: auto; background: #151c18; border: 1px solid #2f4a3b; border-radius: 12px; padding: 14px; }
  .mbox h3 { margin: 0 0 8px; font-size: 14px; color: #cfe9db; } .mbox .acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
  .mbox input[type=text] { width: 100%; }
  /* curseur d'exigence */
  .demand { position: relative; padding: 18px 0 4px; }
  .demand input[type=range] { width: 100%; accent-color: #3ecf8e; }
  .demand .rec { position: absolute; top: 0; transform: translateX(-50%); color: #6fc3ff; font-size: 11px; white-space: nowrap; pointer-events: none; }
  .demand .ends { display: flex; justify-content: space-between; color: #7c8d84; font-size: 11px; }
  /* résumé des paquets */
  .rtiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 6px 0; }
  .rtiles button { display: flex; flex-direction: column; align-items: center; padding: 6px 2px; } .rtiles button b { font-size: 16px; } .rtiles button small { font-size: 10px; color: #8fa197; }
  .rtiles button.on { background: #1f3d2e; border-color: #3ecf8e; }
  .seg { display: inline-flex; gap: 4px; } .seg button { padding: 3px 8px; font-size: 11px; } .seg button.on { background: #1f3d2e; border-color: #3ecf8e; color: #b8f5d4; }
  /* affichage au repos (ni souris ni clavier depuis 1 min) : plus aucune animation, donc plus rien à redessiner */
  .panel.calm, .panel.calm *, .panel.calm *::before, .panel.calm *::after { animation: none !important; }
  `;

  const sw = (path, checked) => `<label class="switch"><input type="checkbox" data-k="${path}" ${checked ? 'checked' : ''}><span></span></label>`;
  const num = (path, v, attrs = '') => `<input type="number" data-k="${path}" value="${esc(v)}" ${attrs}>`;
  const row = (label, hint, control) => `<div class="row"><label>${label}${hint ? `<small>${hint}</small>` : ''}</label>${control}</div>`;
  const chips = (path, selected, list, locked = []) => `<div class="chips">${list.map(r => `<label class="chip ${selected.includes(r) ? 'on' : ''} ${locked.includes(r) ? 'locked' : ''}" title="${RARITY_NAME[r]}"><input type="checkbox" data-arr="${path}" value="${r}" ${selected.includes(r) ? 'checked' : ''} ${locked.includes(r) ? 'disabled' : ''}><b class="r-${r}">${r}</b> ${RARITY_NAME[r]}</label>`).join('')}</div>`;
  const grid6 = (path, obj, list = RARITIES) => `<div class="grid6">${list.map(r => `<label><b class="r-${r}">${r}</b><input type="number" min="0" data-k="${path}.${r}" value="${esc(obj[r] ?? '')}"></label>`).join('')}</div>`;
  const durSelect = (path, v) => `<select data-k="${path}">${DURATIONS.map(d => `<option value="${d}" ${v === d ? 'selected' : ''}>${d < 60 ? d + ' min' : d / 60 + ' h'}</option>`).join('')}</select>`;

  // Accueil · suivi des shiny : en attente de mise, enchères en cours, historique (lien = l'enchère dans un nouvel onglet)
  function shinyHomeHtml() {
    const link = (id, txt) => `<a href="/marketplace/${esc(id)}" target="_blank" rel="noopener" style="color:inherit">${txt}</a>`;
    const name = x => `<b class="r-${x.rarity}">${x.rarity}✦</b> ${esc(x.title)}`;
    const waiting = [...watch].filter(([, w]) => w.autoShiny).sort((a, b) => leftMs(a[1].end) - leftMs(b[1].end));
    const live = Object.entries(load(K.tracked, {})).filter(([, t]) => t.source === 'shiny');
    const hist = load(SHINY_LOG, []).filter(x => x.kind !== 'watch' && x.kind !== 'bid').slice(0, 6);
    const K2 = { won: ['🎉', 'good', x => `gagnée pour ${x.price}`], lost: ['✗', 'bad', x => `perdue, partie à ${x.price}`], outbid: ['✗', 'warn', x => `dépassée à ${x.price} (max ${x.cap})`], skip: ['·', 'muted', x => `pas misée : ${esc(x.why || '')}`] };
    const rows = [
      ...live.map(([id, t]) => `<div><time>${fmtLeft(leftMs(t.end))}</time>${link(id, name(t))} · ${t.leading ? `<span class="good">tu mènes à ${t.lastBid}</span>` : `<span class="warn">dépassé (${t.current ?? '?'})</span>`} · max ${t.cap}</div>`),
      ...waiting.map(([id, w]) => `<div><time>${fmtLeft(Math.max(0, leftMs(w.end) - snipeWindowMs()))}</time>${link(id, name(w))} · mise à la fin · max ${w.cap} <span class="muted">(fin ${fmtLeft(leftMs(w.end))})</span></div>`),
      ...hist.map(x => { const [ic, cls, txt] = K2[x.kind] || ['·', 'muted', () => x.kind]; return `<div><time>${new Date(x.t).toTimeString().slice(0, 5)}</time>${ic} ${link(x.id, name(x))} · <span class="${cls}">${txt(x)}</span></div>`; }),
    ];
    return rows.join('') || `<div class="muted">${config.trading.shinyAutoBuy ? 'Aucune shiny en vue pour l’instant.' : 'Achat automatique coupé (Trading → Shiny ✦).'}</div>`;
  }
  function tplHome() {
    const c = config;
    const firstRun = !load(K.journal, []).length;
    return `
      ${firstRun ? `<div class="card"><h3>👋 Bienvenue</h3><p class="help">1. Onglet <b>Cartes voulues</b> : ajoute les cartes que tu veux acheter.<br>2. Onglet <b>Réglages</b> : choisis ta réserve, le solde que le bot ne touchera jamais.<br>3. Clique <b>Démarrer</b>. Le bot commence en <b>simulation</b> : il montre ce qu'il ferait sans rien dépenser. Quand ça te convient, désactive la simulation dans Réglages.</p></div>` : ''}
      <div class="modes">
        <button class="modebtn turbo ${c.mode === 'turbo' ? 'on' : ''}" data-a="mode" data-mode="turbo">⚡ Turbo<small>${c.mode === 'turbo' ? 'actif · clique pour revenir au normal' : 'devant l’écran : rapide'}</small></button>
        <button class="modebtn slow ${c.mode === 'slow' ? 'on' : ''}" data-a="mode" data-mode="slow">❄️ Lent<small>${c.mode === 'slow' ? `actif${c.slowUntil ? ' · retour prévu à ' + new Date(c.slowUntil).toTimeString().slice(0, 5) : ''} · clique pour revenir au normal` : 'absent : ventes finies à ton retour'}</small></button>
      </div>
      <div data-v="paused"></div>
      <div class="tiles">
        <div class="tile"><span>Solde</span><b data-v="balance">–</b></div>
        <div class="tile"><span>Réserve protégée</span><b>${c.reserve}</b></div>
        <div class="tile"><span>Enchères du bot</span><b data-v="bids">–</b></div>
        <div class="tile"><span>Ventes du bot</span><b data-v="sales">–</b></div>
      </div>
      <div class="card"><h3>Prochaines actions</h3><div data-v="upcoming" class="feed"></div></div>
      ${c.trading.shinyAutoBuy || load(SHINY_LOG, []).length ? `<div class="card"><h3>✦ Shiny${c.trading.shinyAutoBuy ? ` <span class="muted">· achat auto ≤ ${c.trading.shinyFindMax}</span>` : ' <span class="muted">· achat auto coupé</span>'}</h3><div data-v="shiny" class="feed"></div></div>` : ''}
      <div class="card"><h3>Mes enchères en cours</h3><div data-v="tracked" class="feed"></div></div>
      <div class="card"><h3>Dernières actions</h3><div data-v="recent" class="feed"></div></div>`;
  }

  // Ligne d'enchère d'une carte voulue : ta mise, en tête ou dépassé, temps restant, surenchère, actualiser
  function wishBidLine(i, n, al) {
    const key = norm(i.title), x = load(K.wishInfo, {})[key];
    const mine = Object.entries(load(K.tracked, {})).filter(([, t]) => t.source === 'wish' && norm(t.title) === key)
      .sort((p, q) => new Date(p[1].end) - new Date(q[1].end));   // plusieurs avec « tous les exemplaires » : une ligne chacune
    const left = end => end ? `<span class="wleft">⏱ ${fmtLeft(leftMs(end))}</span>` : '';
    const refresh = `<button class="wbtn ghost" data-a="wishRefresh" data-n="${n}" title="${mine.length ? 'Actualiser la mise' : 'Lancer la recherche'}">↻</button>`, refreshBtn = refresh;
    const bid = (id, def, label) => `<input type="number" class="wbid" min="1" data-bidn="${n}" data-auction="${id}" value="${def}"><button class="wbtn" data-a="wishBid" data-n="${n}">${label}</button>`;
    if (mine.length) {
      const line = ([id, t], k) => {
        const refresh = k ? '' : refreshBtn;                 // ↻ une seule fois, sur la première ligne
        if (t.leading) return `<div class="wbidl"><span>Ta mise <b>${t.current != null ? t.current : t.lastBid}</b> <b class="r-${t.rarity}">${t.rarity}</b></span><span class="good">✓ en tête</span>${left(t.end)}<span class="wsp"></span>${refresh}</div>`;
        const need = t.need || (t.current != null ? Math.max(t.current + 1, Math.ceil(t.current * 1.1)) : t.lastBid + 1);
        return `<div class="wbidl"><span>Ta mise <b>${t.lastBid}</b> <b class="r-${t.rarity}">${t.rarity}</b></span><span class="bad">✗ dépassé${t.current != null ? ' (' + t.current + ')' : ''}</span>${left(t.end)}<span class="wsp"></span>${bid(id, need, 'Surenchérir')}${refresh}</div>`;
      };
      return (mine.length > 1 ? `<div class="wbidl muted">${mine.length} mises en cours sur cette carte</div>` : '') + mine.map(line).join('');
    }
    if (al) return `<div class="wbidl"><span class="bad">✗ dépassé : il faut <b>${al.price}</b> <b class="r-${al.rarity}">${al.rarity}</b></span>${left(al.end)}<span class="wsp"></span>${bid(al.auctionId, al.price, 'Surenchérir')}<button class="wbtn ghost" data-a="dropAlert" data-n="${n}" title="Laisser tomber cette enchère">Ignorer</button>${refresh}</div>`;
    if (x && x.minId && ['too_expensive', 'no_slot', 'sim', 'refused'].includes(x.status))
      return `<div class="wbidl"><span class="muted">Pas de mise · en vente dès <b>${x.min}</b> <b class="r-${x.minRarity}">${x.minRarity}</b></span>${left(x.minEnd)}<span class="wsp"></span>${bid(x.minId, x.min, 'Miser')}${refresh}</div>`;
    return `<div class="wbidl"><span class="muted">${x ? (x.status === 'owned' ? 'Déjà possédée' : x.status === 'error' ? 'Site muet' : 'Pas en vente') : 'Pas encore cherchée'}${x ? ` · ${Math.max(0, Math.round((Date.now() - x.at) / 60000))} min` : ''}</span><span class="wsp"></span>${refresh}</div>`;
  }
  // État d'une catégorie : dernière recherche, mises en cours, raisons des cartes écartées
  function catStatus(c) {
    const x = load('wmbot1.catInfo', {})[norm(c.name)];
    const live = Object.values(load(K.tracked, {})).filter(t => t.source === 'cat' && norm(t.cat || '') === norm(c.name));
    const cur = live.length ? `<div class="cbs">${live.sort((a, b) => new Date(a.end) - new Date(b.end)).map(t => `<div class="cb">
        <b class="r-${t.rarity}">${t.rarity}</b><span class="cbt" title="${esc(t.title)}">${esc(t.title)}</span>
        ${t.leading ? '<span class="cbs-on">en tête</span>' : '<span class="cbs-off">dépassé</span>'}
        <b>${t.lastBid}</b><span class="muted">max ${t.cap}</span><span class="muted">⏱ ${fmtLeft(leftMs(t.end))}</span></div>`).join('')}</div>` : '';
    if (!x) return cur + '<span class="muted">Pas encore cherchée.</span>';
    const ago = Math.round((Date.now() - x.at) / 60000);
    const bids = x.bids.length ? x.bids.map(b => `<b class="r-${b.rarity}">${b.rarity}</b> ${esc(b.title)} ${b.amount} <span class="muted">(${b.avg ? 'moy. ' + b.avg : 'jamais vendue'})</span>`).join(' · ') : 'aucune';
    const why = Object.entries(x.why).map(([r, n]) => `${n} ${esc(r)}`).join(', ');
    return `${cur}<span class="muted">${ago < 1 ? 'à l’instant' : 'il y a ' + ago + ' min'} · ${x.match} en vente dans la catégorie</span>${x.bids.length ? `<br>${x.bids.some(b => b.sim) ? '🧪 Miserait' : 'Nouvelles mises'} : ${bids}` : ''}${why ? `<br><span class="muted">Écartées : ${why}</span>` : ''}`;
  }
  function tplCat() {
    const w = config.wishlist;
    return `
      <div class="card"><h3>Ajouter une catégorie</h3>
        ${row('Acheter les cartes voulues', 'cartes et catégories', sw('wishlist.enabled', w.enabled))}
        <p class="help">Le bot mise sur les cartes que tu n’as pas, sous ton <b>max par carte</b> et sous <b>N× leur prix moyen</b>. <b>Texte exact</b> : l’expression entière dans le titre ou la catégorie, un seul exemplaire par carte. L’<b>étiquette</b> est posée sur chaque carte gagnée.</p>
        <div class="search"><input type="text" data-v="catName" placeholder="Texte à rechercher, ex. département français numéro"></div>
        <div class="search"><input type="text" data-v="catTag" placeholder="Étiquette à poser (facultatif), ex. département fr"></div>
        ${row('Texte exact', 'expression entière, une seule copie par carte', '<label class="switch"><input type="checkbox" data-v="catExact" checked><span></span></label>')}
        ${row('Max par carte', 'wikibidous', '<input type="number" data-v="catMax" min="1" value="1000">')}
        ${row('Pas plus de', '× le prix moyen de la carte', '<input type="number" data-v="catMult" min="0.5" max="10" step="0.5" value="2">')}
        <div class="stkbar"><button data-a="catAdd">Ajouter</button></div>
      </div>
      <div class="card"><h3>Mes catégories</h3>
        ${w.categories.length ? `<div class="wl">${w.categories.map((c, n) => `<div class="wi">
            <div class="wtop">
              <span class="wname" title="${esc(c.name)}">${c.exact ? '« ' + esc(c.name) + ' »' : esc(c.name)}</span>
              <label class="wcap" title="Prix maximum par carte">max <input type="number" min="1" data-cat="${n}" data-f="max" value="${c.max}"></label>
              <label class="wcap" title="Pas plus de N× le prix moyen de la carte">× <input type="number" min="0.5" max="10" step="0.5" data-cat="${n}" data-f="mult" value="${c.mult}"></label>
              <label class="switch" title="${c.enabled ? 'Active' : 'En pause'}"><input type="checkbox" data-cat="${n}" data-f="enabled" ${c.enabled ? 'checked' : ''}><span></span></label>
              <button class="ghost" data-a="catDel" data-n="${n}" title="Retirer de la liste">✕</button>
            </div>
            <div class="wopt">
              <label class="wchk" title="Expression entière dans le titre ou la catégorie, une seule copie par carte"><input type="checkbox" data-cat="${n}" data-f="exact" ${c.exact ? 'checked' : ''}> Texte exact</label>
              <label class="wtagl" title="Étiquette posée sur chaque carte gagnée">Étiquette <input type="text" class="wtag" data-cat="${n}" data-f="tag" value="${esc(c.tag || '')}" placeholder="aucune"></label>
              <button data-a="catRun" data-n="${n}" title="Lancer la recherche de cette catégorie maintenant" style="padding:3px 10px;font-size:11px">Rechercher</button>
            </div>
            <div class="help" style="margin:4px 0 0" data-catst="${n}">${catStatus(c)}</div>
          </div>`).join('')}</div>` : '<p class="help">Aucune catégorie : ajoute-en une ci-dessus.</p>'}
      </div>
      <div class="card"><h3>Options</h3>
        ${row('Accepter une carte que j’ai déjà', 'Sinon le bot ignore les doublons', sw('wishlist.allowDuplicates', w.allowDuplicates))}
        ${row('Chercher toutes les', 'minutes (cartes et catégories)', num('wishlist.scanEveryMin', w.scanEveryMin, 'min="3"'))}
      </div>`;
  }
  function tplWish() {
    const w = config.wishlist;
    const sub = load(K.ui, {}).wishSub === 'cat' ? 'cat' : 'cards';
    const subs = `<div class="seg" style="margin-bottom:10px">${[['cards', 'Cartes'], ['cat', 'Catégories']].map(([k, l]) => `<button data-wsub="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (sub === 'cat') return subs + tplCat();
    const alerts = new Map(activeWishAlerts().map(x => [norm(x.title), x]));
    return `${subs}
      <div class="card"><h3>🔎 Ajouter une carte</h3>
        ${row('Acheter les cartes voulues', '', sw('wishlist.enabled', w.enabled))}
        <div class="search"><input type="text" data-v="q" placeholder="Titre exact, ex. Tour Eiffel" title="Seul le titre exact est acheté : « Zeus » ≠ « Zeus Ammon » (majuscules et accents ignorés)"><button data-a="search">Chercher</button></div>
        <div data-v="results" class="list"></div>
      </div>
      <div class="card"><h3>Ma liste <span class="muted">· ${w.items.filter(i => ownedRarities(i.title).length).length}/${w.items.length} obtenues</span>${alerts.size ? ` <span class="bdot"></span>` : ''}</h3>
        ${w.items.length ? `<div class="wl">${w.items.map((i, n) => ({ i, n, own: [...new Set(ownedRarities(i.title))].sort((a, b) => RANK[b] - RANK[a]), al: alerts.get(norm(i.title)) }))
          .sort((x, y) => (y.al ? 1 : 0) - (x.al ? 1 : 0) || (x.own.length ? 1 : 0) - (y.own.length ? 1 : 0))
          .map(({ i, n, own, al }) => `<div class="wi ${al ? 'decide' : own.length ? 'owned' : ''}">
              <div class="wtop">
                <span class="wname" title="${esc(i.title)}">${al ? '<span class="bdot"></span> ' : ''}${esc(i.title)}</span>
                ${own.length ? `<span class="wown">✓ ${own.map(r => `<b class="r-${r}">${r}</b>`).join(' ')}</span>` : ''}
                <label class="wcap" title="Prix maximum que le bot paiera">max <input type="number" min="0" placeholder="${i.max == null || i.max === '' ? 'auto' : ''}" data-item="${n}" value="${esc(i.max ?? '')}"></label>
                <button class="ghost" data-a="delItem" data-n="${n}" title="Retirer de la liste">✕</button>
              </div>
              ${wishBidLine(i, n, al)}
              <div class="wopt">
                <label class="wchk"><input type="checkbox" data-notif="${n}" ${i.notifyOver !== false ? 'checked' : ''}> M’avertir si dépassé</label>
                <label class="wchk" title="Le bot mise sur chaque exemplaire en vente sous ton max, même si tu as déjà la carte, dans la limite des places d’enchères libres"><input type="checkbox" data-all="${n}" ${i.all ? 'checked' : ''}> Acheter tous les exemplaires possibles</label>
                <label class="wtagl">Étiquette <input type="text" class="wtag" data-tag="${n}" value="${esc(i.tag || '')}" placeholder="aucune"></label>
              </div>
            </div>`).join('')}</div>` : '<p class="help">Liste vide : cherche une carte ci-dessus.</p>'}
      </div>
      <div class="card"><h3>Options</h3>
        ${row('Accepter une carte que j’ai déjà', 'Sinon le bot ignore les doublons', sw('wishlist.allowDuplicates', w.allowDuplicates))}
        ${row('Chercher toutes les', 'minutes', num('wishlist.scanEveryMin', w.scanEveryMin, 'min="3"'))}
      </div>`;
  }

  // Cases cochées dans le stock et dans l'analyse : gardées tant que la page est ouverte, même si l'onglet se redessine
  const stockSel = new Set(), anaSel = new Set();
  // « + Stock » des cartes de paquets : clé stable (l'historique se décale quand un paquet ajoute une carte en tête)
  const packKey = h => `${h.t}|${h.card_id || norm(h.title)}|${h.rarity}`;
  const packPending = new Set();                           // en cours ou en file d'attente
  // Redessine une zone sans remettre ses listes en haut : cocher une case ne doit pas faire perdre sa place dans la liste
  function setHtml(el, html) {
    const tops = [...el.querySelectorAll('.list')].map(x => x.scrollTop);
    const open = [...el.querySelectorAll('details')].map(x => x.open);
    el.innerHTML = html;
    el.querySelectorAll('details').forEach((x, i) => { if (open[i]) x.open = true; });
    el.querySelectorAll('.list').forEach((x, i) => { if (tops[i]) x.scrollTop = tops[i]; });
  }
  let stkFound = new Map();                                // résultats de « Ajouter au stock »
  // ── Onglet Trading → Recherches ──
  let scanIdx = 0;                                         // recherche affichée (0 = la plus récente)
  function scansHtml() {
    const all = load(SCANS, []);
    if (!all.length) return '<p class="help">Pas encore de recherche enregistrée : démarre le bot ou clique « Chercher maintenant ».</p>';
    const i = Math.min(scanIdx, all.length - 1), r = all[i];
    const nWatch = x => (x.rows || []).filter(y => y.decision === 'surveillée').length;
    const seg = `<div class="seg" style="margin-bottom:6px;flex-wrap:wrap">${all.map((x, k) => `<button data-scanidx="${k}" class="${k === i ? 'on' : ''}" title="${x.skipped ? esc(x.skipped) : `${x.seen ?? 0} regardée(s), ${nWatch(x)} surveillée(s)`}">${new Date(x.at).toTimeString().slice(0, 5)}${x.skipped ? ' ⏭' : nWatch(x) ? ` · ${nWatch(x)} ✓` : ''}</button>`).join('')}</div>`;
    if (r.skipped) return seg + `<p class="help">⏭ Recherche sautée : ${esc(r.skipped)}.</p>`;
    const c = r.crit, ST = { dead: 'finie', live: 'ouverte', empty: 'vide', error: 'erreur' };
    const preN = Object.values(r.pre).reduce((t, n) => t + n, 0), preTxt = Object.entries(r.pre).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
    const rows = [...r.rows].sort((a, b) => (b.decision === 'surveillée') - (a.decision === 'surveillée') || (b.profit ?? -1e9) - (a.profit ?? -1e9));
    const left = s => s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0');
    return seg
      + `<p class="help"><b>Requête</b> · enchères <b>${c.rarities.join(', ')}</b>${r.focus ? ' (shiny seulement : stock presque plein)' : ''} qui finissent dans moins de <b>${c.windowMin} min</b> · bonne affaire si prix ≤ <b>${c.threshold} %</b> de la valeur · valeur ≥ <b>${c.minValue}</b> · bénéfice ≥ <b>${c.minProfit}</b> (revente comptée à ${Math.round(c.rate * 100)} % de la valeur) · max ${c.maxPerCard} par carte · prix habituels ${Object.entries(c.refs).map(([k, v]) => `${k} ${v ?? '?'}`).join(', ')} · site ${(c.latency / 1000).toFixed(1)} s par réponse · recherche de ${r.durS} s</p>`
      + `<p class="help"><b>Résultat</b> · ${r.seen} enchère(s) dans la fenêtre → ${preN} écartée(s) d’office sans lire leur prix${preTxt ? ` (${preTxt})` : ''} → ${r.estimated} à estimer${r.late ? ` (${r.late} vue(s) trop tard)` : ''}${r.notEst ? ` (${r.notEst} pas estimée(s) à temps)` : ''} → <b>${nWatch(r)} surveillée(s)</b></p>`
      + (rows.length ? `<div class="list"><table><tr><th>Carte</th><th>Prix</th><th title="Valeur estimée (survol : comment)">Valeur</th><th>%</th><th title="Revente réaliste − prix">Bénéf.</th><th>Décision</th><th>Mise · résultat</th></tr>${rows.map(x => `<tr>
          <td><b class="r-${x.rarity}">${x.rarity}${x.shiny ? '✦' : ''}</b> <a href="/marketplace/${esc(x.id)}" target="_blank" rel="noopener" style="color:inherit">${esc(x.title)}</a><br><small class="muted">fin dans ${left(x.left)}${x.comp ? ` · ${esc(x.comp)}` : ''}</small></td>
          <td>${x.price}</td><td title="${esc(x.valWhy || '')}">${x.value ?? '?'}</td><td>${x.pct != null ? x.pct + ' %' : ''}</td>
          <td class="${x.profit > 0 ? 'good' : 'muted'}">${x.profit != null ? (x.profit > 0 ? '+' : '') + x.profit : ''}</td>
          <td class="${x.decision === 'surveillée' ? 'good' : 'muted'}">${esc(x.decision)}${x.cap != null ? `<br><small>max <b>${x.cap}</b></small>` : ''}</td>
          <td>${x.bid ? esc(x.bid) : x.decision === 'surveillée' ? '<span class="muted">mise à la fin</span>' : ''}${x.result ? `<br><small>${esc(x.result)}</small>` : ''}</td></tr>`).join('')}</table></div>`
        : '<p class="help">Aucune carte n’est arrivée jusqu’à l’estimation : toutes ont été écartées d’office (voir les raisons ci-dessus).</p>');
  }
  // enchères de trading en cours : ta mise, en tête ou dépassé, le max, la fin
  function tradeBidsHtml() {
    const t = Object.entries(load(K.tracked, {})).filter(([, x]) => x.source === 'trade');
    return t.length ? `<table><tr><th>Carte</th><th>Ma mise</th><th>Max</th><th>Fin</th></tr>${t.map(([id, x]) => `<tr><td><b class="r-${x.rarity}">${x.rarity}</b> <a href="/marketplace/${esc(id)}" target="_blank" rel="noopener" style="color:inherit">${esc(x.title)}</a></td><td>${x.lastBid} ${x.leading ? '<span class="good">tu mènes</span>' : `<span class="warn">dépassé (${x.current ?? '?'})</span>`}</td><td>${x.cap}</td><td class="muted">${fmtLeft(leftMs(x.end))}</td></tr>`).join('')}</table>`
      : '<p class="help">Aucune enchère de trading en cours.</p>';
  }
  function shinyHtml() {
    const r = load('wmbot1.shiny', null);
    if (!r) return '<p class="help">Pas encore de recherche.</p>';
    const rows = r.rows.filter(x => leftMs(x.end) > 0);
    const head = `<p class="help">${new Date(r.at).toLocaleTimeString().slice(0, 5)} · ${(r.rarities || []).join(', ')} · fin &lt; ${r.maxMin} min · ≤ ${r.maxPrice}${r.done ? '' : ' (incomplète)'} · ${rows.length} shiny</p>`;
    return head + (rows.length
      ? `<div class="list"><table><tr><th>Carte</th><th title="Prochaine mise possible">Mise</th><th>Fin</th></tr>${rows.map(x => `<tr><td><a href="/marketplace/${esc(x.id)}" target="_blank" rel="noopener" style="color:inherit"><b class="r-${x.rarity}">${x.rarity}✦</b> ${esc(x.title)}</a>${x.mine ? ' <small class="good">tu mènes</small>' : ''}</td><td>${x.price}${x.bid == null ? ' <small class="muted">départ</small>' : ''}</td><td class="muted">${fmtLeft(leftMs(x.end))} <small>(${new Date(x.end).toTimeString().slice(0, 5)})</small></td></tr>`).join('')}</table></div>`
      : '<p class="help">Aucune shiny ne correspond. Allonge la durée ou monte le prix.</p>');
  }
  // Icônes de l'analyse : ce qui protège ou occupe une carte (le nombre de copies concernées si ce n'est pas toutes)
  const ANA_FLAGS = [
    ['fav', '★', 'favori'], ['tag', '🏷️', 'étiquette'], ['wish', '🎯', 'carte voulue'], ['kept', '🔒', 'gardée'],
    ['stock', '📦', 'stock du bot'], ['listed', '🏪', 'en vente'], ['trade', '🤝', 'échange en attente'],
  ];
  const anaFree = r => r.free || r.ids;                     // ancienne analyse : toutes ses cartes étaient libres
  const anaView = () => { const f = load(K.ui, {}).anaFilter; return ['free', 'busy', 'noval'].includes(f) ? f : 'all'; };
  const anaShown = (a, f) => a.rows.filter(r => f === 'free' ? anaFree(r).length : f === 'busy' ? anaFree(r).length < (r.n || r.ids.length) : f === 'noval' ? r.value == null : true);
  function anaIcons(r) {
    const n = r.n || r.ids.length, fl = r.flags || {};
    const out = ANA_FLAGS.filter(([k]) => fl[k]).map(([k, ic, label]) => {
      const c = fl[k], tip = k === 'tag' && r.tags && r.tags.length ? `${label} : ${r.tags.join(', ')}` : label;
      return `<span title="${esc(tip)}${n > 1 && c < n ? ` (${c} sur ${n})` : ''}" style="cursor:help">${ic}${n > 1 && c < n ? `<small>${c}</small>` : ''}</span>`;
    });
    if (r.shiny) out.unshift('<span title="shiny · protégée, jamais vendue par le bot" style="cursor:help">✦</span>');
    if (r.interesting) out.push('<span title="intéressante" style="cursor:help">💎</span>');
    if (r.value == null) out.push('<span title="jamais vendue" style="cursor:help">❓</span>');
    return out.join(' ');
  }
  function anaHtml() {
    const a = load(K.analysis, null);
    if (!a) return '<p class="help">Pas encore d’analyse.</p>';
    for (const k of [...anaSel]) if (!a.rows.some(r => r.key === k && anaFree(r).length)) anaSel.delete(k);
    const n = anaSel.size, f = anaView(), shown = anaShown(a, f);
    const freeShown = shown.filter(r => anaFree(r).length);
    const cnt = k => anaShown(a, k).length;
    const seg = `<div class="seg" style="margin:6px 0">${[['all', 'Toutes'], ['free', 'Libres'], ['busy', 'Protégées / occupées'], ['noval', 'Sans prix']].map(([k, l]) => `<button data-anaf="${k}" class="${f === k ? 'on' : ''}">${l} (${cnt(k)})</button>`).join('')}</div>`;
    return `<p class="help">${new Date(a.at).toLocaleString().slice(0, 16)} · ${a.scanned}/${a.total} cartes${a.done ? '' : ' (arrêtée)'}</p>${seg}`
      + (shown.length ? `<div class="list"><table><tr><th><input type="checkbox" data-anaall title="Cocher les cartes libres affichées" ${n && freeShown.length && freeShown.every(r => anaSel.has(r.key)) ? 'checked' : ''}></th><th>Carte</th><th title="Prix de vente moyen de la carte (donnée du site)">Valeur moyenne</th></tr>${shown.map(r => {
          const total = r.n || r.ids.length, free = anaFree(r).length;
          return `<tr><td>${free ? `<input type="checkbox" data-ana="${esc(r.key)}" ${anaSel.has(r.key) ? 'checked' : ''}>` : ''}</td><td><b class="r-${r.rarity}">${r.rarity}</b> ${esc(r.title)}${total > 1 ? ` <b>×${total}</b>` : ''}${free && free < total ? ` <small class="muted">(${free} libre${free > 1 ? 's' : ''})</small>` : ''} ${anaIcons(r)}</td><td>${r.value ?? '<span class="muted">?</span>'}</td></tr>`;
        }).join('')}</table></div>
        <div class="stkbar"><button data-a="anaStock" ${n ? '' : 'disabled'}>→ Stock à vendre (${n})</button><button data-a="anaKeep" ${n ? '' : 'disabled'}>Garder (${n})</button></div>
        <p class="help">Survole une icône pour savoir ce qu’elle veut dire. Seules les copies libres peuvent être cochées.</p>`
        : '<p class="help">Aucune carte dans cette vue.</p>');
  }
  function tplTrade() {
    const t = config.trading;
    const e = tcfg(), A = null;                              // plus de valeurs « réglées par le bot » : tout est modifiable
    const tip = k => A ? esc(k in DEMAND ? `réglé par le curseur d’exigence (${t.demand}/100, ${demandLabel(t.demand)}) · à 50 : ${A.why[k] || ''}` : (A.why[k] || '')) : '';
    const rec = recommendDemand(), dv = demandValues(t.demand);
    const demandCard = `
      <div class="card"><h3>🎚️ Exigence du trading</h3>
        ${true ? `<div class="demand">
            <span class="rec" style="left:${rec.value}%" title="${esc(rec.why.join(' · '))}">▼ conseil ${rec.value}</span>
            <input type="range" min="0" max="100" step="5" data-k="trading.demand" value="${t.demand}">
            <div class="ends"><span>← petites marges</span><b data-v="demandLbl">${t.demand} · ${demandLabel(t.demand)}</b><span>très exigeant →</span></div>
          </div>
          <p class="help" data-v="demandTxt">${demandText(dv)}</p>
          <p class="help muted">Déplacer le curseur remplace ces 4 valeurs dans les règles ci-dessous (tu peux ensuite les retoucher). 50 = les réglages optimisés.</p>
          <p class="help">🤖 <b>Conseil : ${rec.value} (${demandLabel(rec.value)})</b>${rec.value !== t.demand ? ` <button data-a="applyDemand" data-n="${rec.value}">Appliquer</button>` : ' <span class="good">✓ appliqué</span>'}<br>${rec.why.map(esc).join('<br>')}<br>
          <small class="muted">Calculé par le bot à partir de ton stock, de tes reventes et de tes achats ; le milieu (50) correspond à l’analyse du marché du ${PRESET.date}. Recalculé à chaque ouverture de l’onglet.</small></p>`
        : '<p class="help">Le curseur règle les réglages optimisés : coche « 🤖 Réglages optimisés » plus bas pour l’utiliser. En réglages manuels, ce sont tes valeurs qui s’appliquent.</p>'}
      </div>`;
    // champ réglé par le bot : on affiche sa valeur (grisée) précédée de 🤖, l'explication au survol
    const fld = (k, attrs = '') => A
      ? `<span class="auto" title="${tip(k)}">🤖 <input type="number" value="${esc(e[k])}" disabled></span>`
      : num('trading.' + k, t[k], attrs);
    const durFld = k => A
      ? `<span class="auto" title="${tip(k)}">🤖 <select disabled><option>${e[k] < 60 ? e[k] + ' min' : e[k] / 60 + ' h'}</option></select></span>`
      : durSelect('trading.' + k, t[k]);
    const refs = RARITIES.map(r => { const x = rarityRef(r); return `<tr><td><b class="r-${r}">${r}</b> ${RARITY_NAME[r]}</td><td>${x.value ?? '<span class="muted">apprentissage…</span>'}</td><td class="muted">${x.manual ? 'imposé' : x.value ? `${x.samples} obs.` : `${x.samples || 0}/${REF_MIN_SAMPLES} obs.`}</td><td><input type="number" min="0" placeholder="auto" data-ref="${r}" value="${esc(t.manualRef[r] ?? '')}"></td></tr>`; }).join('');
    const sub = ['analyse', 'stock', 'shiny', 'scans'].includes(load(K.ui, {}).tradeSub) ? load(K.ui, {}).tradeSub : 'main';
    const subs = `<div class="seg" style="margin-bottom:10px">${[['main', 'Trading'], ['scans', '🔍 Recherches'], ['analyse', 'Analyse de la collection'], ['stock', 'Stock du bot'], ['shiny', 'Shiny ✦']].map(([k, l]) => `<button data-sub="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (sub === 'stock') return `${subs}
      <div class="card"><h3>📦 Stock du bot</h3>
        ${row('Stock max', `achats : ${tradeStock()}/${tcfg().maxStock} · vide = celui des règles (${config.trading.maxStock})`, `<input type="number" min="0" data-k="trading.stockMax" value="${config.trading.stockMax || ''}" placeholder="auto">`)}
        <div data-v="stock"></div></div>
      <div class="card"><h3>🧾 Historique des ventes</h3><div data-v="saleHist"></div></div>
      <div class="card"><h3>🛒 Historique des achats</h3><div data-v="buyHist"></div></div>
`;
    if (sub === 'scans') return `${subs}
      <div class="card"><h3>🔍 Recherches de trading</h3>
        <p class="help" style="margin-top:0">Ce que le bot cherche, les pages qu’il lit, les cartes qu’il estime, pourquoi il les écarte, et la mise qu’il place. Une ligne par recherche (les 12 dernières).</p>
        <div class="stkbar"><button data-a="stkScan">🔎 Chercher maintenant</button><span class="muted" data-v="scanProg"></span></div>
        <div data-v="scans" style="margin-top:6px">${scansHtml()}</div>
      </div>
      <div class="card"><h3>🎯 Mises prévues</h3><div data-v="watch"></div></div>
      <div class="card"><h3>💰 Mes enchères de trading</h3><div data-v="tradeBids">${tradeBidsHtml()}</div></div>`;
    if (sub === 'shiny') { const tcs = tcfg(), lim = shinyFocusLimit(tcs), on = shinyFocus(tcs); return `${subs}
      <div class="card"><h3>🎯 Trading des shiny</h3>
        <p class="help">Le trading regarde <b>toujours</b> les shiny en plus de ses raretés. Quand le stock se remplit, il garde la place pour elles : à partir du seuil, il ne cherche <b>plus que des shiny</b>.<br>
        Stock ${tradeStock()}/${tcs.maxStock} · seuil ${tcs.shinyFocusAt >= 100 ? 'désactivé' : `${lim}/${tcs.maxStock}`} · <b class="${on ? 'good' : ''}">${on ? '✦ shiny seulement en ce moment' : 'tout le marché en ce moment'}</b></p>
        ${row('Que des shiny à partir de', '% du stock max (0 = toujours, 100 = jamais)', num('trading.shinyFocusAt', config.trading.shinyFocusAt, 'min="0" max="100" step="5"'))}
        ${row('Prix max par shiny', 'remplace le prix max par carte (0 = le même) ; le budget trading ne la bloque pas', num('trading.shinyMax', config.trading.shinyMax, 'min="0" step="100"'))}
        <p class="help">Les raretés lues pour les shiny sont celles cochées ci-dessous.</p>
      </div>
      <div class="card"><h3>✦ Shiny en vente</h3>
        <p class="help">Les cartes shiny dont l’enchère finit bientôt, sous ton prix. Clique sur une carte : son enchère s’ouvre dans un nouvel onglet.<br>Le site n’a pas de filtre shiny : le bot lit le marché page par page (2 à 8 s chacune) et la liste se remplit pendant la recherche. Environ 50 Légendaires finissent chaque minute (600 toutes raretés) : en L seules, 30 min de fenêtre ≈ 1 min de recherche, 1 h ≈ 2 à 3 min ; chaque rareté en plus rallonge beaucoup.</p>
        <p class="help">Raretés lues</p>${chips('trading.shinyFindRarities', config.trading.shinyFindRarities, RARITIES)}
        ${row('Fin dans moins de', 'min', num('trading.shinyFindMin', config.trading.shinyFindMin, 'min="1" max="720"'))}
        ${row('Prochaine mise ≤', 'wikibidous', num('trading.shinyFindMax', config.trading.shinyFindMax, 'min="1" step="100"'))}
        ${row('Rechercher toutes les', `min (0 = seulement quand je clique)${config.trading.shinyAutoMin > 0 ? ` · ${running ? 'prochaine ' + (next.shiny > Date.now() ? 'dans ' + fmtLeft(next.shiny - Date.now()) : 'bientôt') : 'quand le bot est démarré'}` : ''}`, num('trading.shinyAutoMin', config.trading.shinyAutoMin, 'min="0" max="1440" step="5"'))}
        ${row('✦ Acheter automatiquement', `toute shiny trouvée avec une prochaine mise ≤ <b>${config.trading.shinyFindMax}</b> : le bot mise à la fin de l’enchère et resurenchérit jusqu’à ${config.trading.shinyFindMax}, sans règle de bonne affaire ni budget trading · suivi dans Accueil${config.trading.shinyAutoBuy && !config.trading.shinyAutoMin ? ' · <b class="warn">mets une recherche toutes les X min ci-dessus pour qu’il en trouve tout seul</b>' : ''}${config.dryRun ? ' · <span class="muted">simulation : aucune vraie mise</span>' : ''}`, sw('trading.shinyAutoBuy', config.trading.shinyAutoBuy))}
        ${row('Me notifier des nouvelles shiny', `recherche automatique : une notification par shiny jamais vue, clic = ouvre l’enchère${config.notify.off ? ' · <b class="bad">toutes les notifications sont coupées</b> (Réglages)' : ''}`, sw('notify.shiny', config.notify.shiny))}
        <div class="stkbar"><button data-a="shinyGo">🔎 Chercher</button><button class="ghost" data-a="shinyStop">Stop</button><span class="muted" data-v="shinyProg"></span></div>
        <div data-v="shiny" style="margin-top:6px">${shinyHtml()}</div>
      </div>`; }
    if (sub === 'analyse') return `${subs}
      <div class="card"><h3>🔎 Analyse de la collection</h3>
        <p class="help">Toute ta collection, les plus chères d’abord, avec une icône pour ce qui protège ou occupe chaque carte (favori, étiquette, voulue, gardée, stock du bot, en vente, échange). Les cartes sans icône sont <b>libres</b> : ni protégées, ni prises par le bot.</p>
        <div class="stkbar"><button data-a="anaGo">Analyser ma collection</button><button class="ghost" data-a="anaStop">Stop</button><span class="muted" data-v="anaProg"></span></div>
        <div data-v="analysis" style="margin-top:6px">${anaHtml()}</div>
      </div>`;
    return `${subs}
      <div class="card"><h3>💹 Mon bénéfice</h3><div data-v="pnl"></div></div>
      <div class="card"><h3>🎯 Chasse aux affaires</h3>
        ${row('Chasser les bonnes affaires', 'Achète les cartes bradées juste avant la fin de leur enchère', sw('trading.enabled', t.enabled))}
        <details><summary>Comment le bot sait que c'est une bonne affaire ?</summary>
        <p class="help">Toutes les ${t.scanEveryS} s, il regarde les enchères triées par <b>fin imminente</b> qui se terminent dans moins de <b>${e.windowMin} min</b>.<br><br>
        Pour chacune, il estime la <b>valeur</b> de la carte : la <b>moyenne de ses ventes passées</b> (la donnée que le site affiche quand tu mets une carte en vente), comptée avec prudence au-delà de <b>3× le prix habituel de sa rareté</b> et plafonnée vers 4× pour ignorer les prix gonflés. Si la carte n'a jamais été vendue, il prend le prix habituel de sa rareté.<br><br>
        Le prix habituel de chaque rareté est <b>appris tout seul</b> en observant le marché (tableau en bas).<br><br>
        Si le prix actuel est à moins de <b>${e.threshold} %</b> de la valeur et rapporte au moins <b>${e.minProfit}</b>, l’enchère est <b>surveillée</b>. Le bot mise le minimum quand il reste moins de <b>${e.snipeS} s</b>, en commençant par les plus rentables. S’il est dépassé, il resurenchérit jusqu’à ${e.threshold} % de la valeur au maximum.<br><br>
        À la revente, les cartes qui rapportent le plus passent en premier.</p></details>
      </div>
      ${demandCard}
      <div class="card"><h3>Règles</h3>
        <div class="stkbar"><button data-a="applyBest">🤖 Mettre les réglages optimisés</button><span class="muted">ta meilleure journée (${PRESET.date}) : ${PRESET.values.rarities.join(', ')} · ${PRESET.values.threshold} % · valeur ≥ ${PRESET.values.minValue} · bénéfice ≥ ${PRESET.values.minProfit} · prix habituels ${Object.entries(PRESET.refs).map(([r, v]) => `${r} ${v}`).join(', ')}. Tout reste modifiable.</span></div>
        <p class="help">Raretés${A ? ` <span class="auto" title="${tip('rarities')}">🤖 ${e.rarities.join(', ') || 'aucune'}</span>` : ''}</p>${chips('trading.rarities', t.rarities, RARITIES)}
        ${row('Fin dans moins de', 'min', fld('windowMin', 'min="1" max="30"'))}
        ${row('Bonne affaire si prix ≤', `% de la valeur · 100 = désactivée : seul le bénéfice minimum compte${t.threshold >= 100 ? ' <b class="good">(désactivée)</b>' : ''}`, fld('threshold', 'min="5" max="100"'))}
        ${row('Valeur minimum', '', fld('minValue', 'min="0"'))}
        ${row('Bénéfice minimum', '', fld('minProfit', 'min="0"'))}
        ${row('Miser à', 's de la fin', fld('snipeS', 'min="0" max="170"'))}
        ${row('Prix max par carte', '', num('trading.maxPerCard', t.maxPerCard, 'min="1"'))}
        ${row('Budget trading', '', num('trading.budget', t.budget, 'min="1"'))}
        ${row('Enchères de trading', 'en même temps (cartes voulues et catégories : sans limite)', num('trading.maxBids', t.maxBids, 'min="1"'))}
        ${row('Vérifier toutes les', 's', num('trading.scanEveryS', t.scanEveryS, 'min="15"'))}
      </div>
      <div class="card"><h3>Revente</h3>
        ${row('Revendre automatiquement', 'sauf favoris et étiquettes', sw('trading.autoResell', t.autoResell))}
        ${row('Emplacements de vente à me laisser', 'sur 5, pour tes ventes à la main', num('sell.keepFreeSlots', config.sell.keepFreeSlots, 'min="0" max="5"'))}
        ${row('Stock maximum', `actuellement ${stockText()}`, fld('maxStock', 'min="1"'))}
        ${row('Carte dormante après', 'invendus d’affilée : elle passe après les autres à la revente', fld('dormantAfter', 'min="1"'))}
        ${row('Cartes dormantes hors stock', 'jusqu’à N, elles ne bloquent pas les achats', fld('maxDormant', 'min="0"'))}
        ${row('Prix de départ', '% de la valeur', fld('resellPercent', 'min="10" max="300"'))}
        ${row('Baisse par invendu', '%', fld('resellDrop', 'min="0" max="90"'))}
        ${row('Braderie si trop de stock', '% max', fld('stockDiscount', 'min="0" max="80"'))}
        ${row('Durée des ventes', '', durFld('resellDuration'))}
        ${row('Revendre à perte', '', sw('trading.allowLoss', t.allowLoss))}
        ${row('…après', 'invendus', fld('lossAfter', 'min="1"'))}
      </div>
      <div class="card"><h3>💤 Cartes dormantes</h3>
        <p class="help">Une carte devient <b>dormante</b> après ${e.dormantAfter} invendus. Pour qu’elles ne bloquent plus le bot : elles n’occupent jamais plus de quelques emplacements de vente, passent en <b>liquidation</b> (vente à perte autorisée, avec un plancher), puis le bot <b>abandonne</b> et te les rend.</p>
        ${row('Emplacements pour les dormantes', 'sur 5, en même temps : le reste sert aux cartes qui se vendent', num('trading.dormantSlots', t.dormantSlots, 'min="0" max="5"'))}
        ${row('Liquider après', 'invendus : vente à perte autorisée', num('trading.liquidateAfter', t.liquidateAfter, 'min="1"'))}
        ${row('Plancher de liquidation', '% du prix d’achat, jamais en dessous', num('trading.liquidateFloor', t.liquidateFloor, 'min="0" max="100"'))}
        ${row('Abandonner après', 'invendus : la carte sort du stock et reste dans ta collection', num('trading.abandonAfter', t.abandonAfter, `min="${t.liquidateAfter + 1}"`))}
        <p class="help">En ce moment : <b>${stockCounts().dormant}</b> dormante(s) sur ${stockCounts().held} en stock.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button data-a="liquidateNow">Liquider les dormantes maintenant</button><button class="danger" data-a="releaseDormant">Les rendre à ma collection</button></div>
      </div>
      <div class="card"><h3>Prix habituel par rareté</h3><p class="help">Médiane des prix moyens observés sur le marché. Le trading d'une rareté démarre après ${REF_MIN_SAMPLES} observations. Tu peux aussi imposer ta propre valeur.</p>
        <table><tr><th>Rareté</th><th>Prix habituel</th><th></th><th>Imposer</th></tr>${refs}</table></div>`;
  }

  function tplSell() {
    const p = config.purge, pd = config.packDiscard, ss = config.stockSell;
    const lines = list => list.map(r => `<b class="r-${r}">${r}</b> ${discardLine(r) ? '≥ ' + discardLine(r) : '<span class="muted">?</span>'}`).join(' · ');
    const inStockCol = load(K.pnl, []).filter(e => e.source === 'collection' && inStock(e)).length;
    return `
      <div class="card"><h3>🔒 Cartes protégées</h3><p class="help">Jamais vendues ni défaussées : <b>favoris ★</b>, cartes <b>étiquetées</b>, cartes <b>voulues</b>.<br>
        Intéressante = vaut au moins ${pd.enabled && pd.below > 0 ? `ton seuil « Défausser sous » pour ${pd.rarities.join(', ')}, sinon ` : ''}${INTEREST_FACTOR}× le prix médian de sa rareté : ${lines(PURGE_RARITIES)}${PURGE_RARITIES.some(r => !discardLine(r)) ? ' <span class="muted">(? = pas encore appris : rareté gardée)</span>' : ''}</p></div>
      <div class="card"><h3>🏷️ À vendre par le trading</h3>
        ${chips('stockSell.rarities', ss.rarities, RARITIES)}
        <p class="help">Toutes tes cartes de ces raretés passent dans le stock de revente (prix et baisses du Trading).${inStockCol ? ` <b>${inStockCol}</b> en stock.` : ''}</p>
      </div>
      <div class="card"><h3>🎁 Paquets</h3>
        ${row('Défausser les cartes de paquets sans intérêt', 'aussitôt le paquet ouvert', sw('packDiscard.enabled', pd.enabled))}
        ${chips('packDiscard.rarities', pd.rarities, PURGE_RARITIES)}
        ${row('Défausser sous', `de valeur moyenne, garder au-dessus · 0 = auto (sous 2× le prix habituel de la rareté : ${pd.rarities.map(r => `${r} ${interestLine(r) ?? '?'}`).join(', ') || '–'}) · une carte jamais vendue est défaussée`, num('packDiscard.below', pd.below || '', 'min="0" step="10" placeholder="auto"'))}
        ${(() => { const both = pd.rarities.filter(r => ss.rarities.includes(r)); return pd.enabled && both.length ? `<p class="help">ℹ️ ${both.join(', ')} sont aussi confiées à la revente : sous ${pd.below > 0 ? pd.below : 'le seuil auto'}, défaussées ; au-dessus, vendues par le trading.</p>` : ''; })()}
        <h3 style="margin-top:8px">Dernières cartes intéressantes sorties des paquets</h3><div data-v="packs" class="list"></div>
      </div>
      <div class="card"><h3>🗑️ Grand ménage</h3>
        ${chips('purge.rarities', p.rarities, PURGE_RARITIES)}
        ${row('Garder les cartes intéressantes', `≥ ${INTEREST_FACTOR}× le prix médian`, sw('purge.keepInteresting', p.keepInteresting))}
        ${p.keepInteresting ? '' : '<p class="help warn">Option décochée : tout part, même les cartes chères.</p>'}
        <button class="stop" data-a="purgeGo" ${p.rarities.length && !purgeUi.busy ? '' : 'disabled'}>${purgeUi.busy ? '⏳ Grand ménage en cours…' : '🗑️ Lancer le grand ménage'}</button>
        <button class="ghost" data-a="purgeStop" ${purgeUi.busy ? '' : 'disabled'}>Stop</button>
        <div data-v="purge" style="margin-top:8px">${purgeUi.html}</div>
      </div>`;
  }

  const notifPerm = () => { try { return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission; } catch { return 'unsupported'; } };
  function tplSettings() {
    const c = config;
    const offSw = sw;                                        // cocher une notification décoche « Couper toutes les notifications »
    return `
      <div class="card"><h3>⚙️ Général</h3>
        ${row('Mode simulation', 'Le bot montre ce qu’il ferait, sans rien dépenser, vendre ni défausser', sw('dryRun', c.dryRun))}
        ${row('Réserve protégée', 'Le bot ne fera jamais descendre ton solde en dessous', num('reserve', c.reserve, 'min="0"'))}
        ${row('Ouvrir les paquets', 'Dès qu’ils sont disponibles', sw('packs.enabled', c.packs.enabled))}
        ${row('Affichage au repos', 'sans souris ni clavier depuis 1 min, le panneau arrête ses animations et l’accueil ne se met à jour que toutes les 10 s · le bot, lui, continue · utile sur un navigateur sans carte graphique (NAS)', sw('calmDisplay', c.calmDisplay))}
        ${row('Suivre mes enchères toutes les', 'secondes · fin d’enchère : chaque seconde sur les 90 dernières en Turbo, toutes les 2,5 s sur les 45 dernières sinon', num('pollEveryS', c.pollEveryS, 'min="15"'))}
      </div>
      <div class="card"><h3>🔔 Notifications</h3>
        ${notifPerm() === 'granted' ? '<p class="help good">Notifications autorisées dans ce navigateur.</p>'
          : notifPerm() === 'denied' ? '<p class="help bad">Notifications bloquées par le navigateur : autorise-les dans les paramètres du site (icône à gauche de l’adresse), puis recharge la page.</p>'
          : notifPerm() === 'unsupported' ? '<p class="help warn">Ce navigateur ne gère pas les notifications.</p>'
          : '<p class="help">Le navigateur doit d’abord les autoriser : <button data-a="notifAsk">Autoriser les notifications</button></p>'}
        ${row('Couper toutes les notifications', 'aucune notification du bot, quelles qu’elles soient', sw('notify.off', c.notify.off))}
        ${row('Blocages du bot', 'vérification demandée par le site, compte bloqué, bot coincé, trading à l’arrêt, étiquette impossible à poser', offSw('notify.blocks', c.notify.blocks))}
        ${row('Ouverture de paquets', 'les raretés obtenues à chaque paquet, et les SR, UR et L par leur nom', offSw('notify.packs', c.notify.packs))}
        ${row('Mises en vente', 'chaque carte mise en vente par le bot, avec son prix', offSw('notify.sales', c.notify.sales))}
        ${row('Nouvelles shiny ✦', 'trouvées par la recherche automatique (Trading → Shiny ✦), clic = ouvre l’enchère', offSw('notify.shiny', c.notify.shiny))}
        ${row('📱 Aussi sur mon téléphone', 'nom de ton sujet ntfy (lettres, chiffres, - et _) · vide = seulement sur ce PC', `<input type="text" data-k="notify.phone" value="${esc(c.notify.phone)}" placeholder="ex. wmbot-x7k2q9" style="width:140px">`)}
        <div class="stkbar"><button class="ghost" data-a="phoneGen">Générer un nom secret</button><button data-a="phoneTest" ${c.notify.phone ? '' : 'disabled'}>Envoyer un test</button></div>
        <p class="help">1. Installe l’appli gratuite <b>ntfy</b> sur ton téléphone (Play Store / App Store).<br>2. Clique « Générer un nom secret » (ou écris le tien), puis dans l’appli : <b>+</b> → s’abonner à ce même nom.<br>3. « Envoyer un test ». Ensuite, chaque notification cochée ci-dessus arrive aussi sur le téléphone ; les blocages (vérification anti-bot, pause) en priorité haute.<br><span class="muted">Le nom fait office de mot de passe : quiconque le connaît peut lire ces notifications. Garde-le pour toi.</span></p>
        <p class="help">Les cartes voulues qui dépassent leur seuil te préviennent selon la case cochée à leur ajout.</p>
      </div>
      <div class="card"><h3>🖱 Déblocage automatique</h3>
        <p class="help">${clickExt ? `Extension <b>WikiMasters Clic</b> ${esc(clickExt)} détectée.` : 'Extension <b>WikiMasters Clic</b> absente de ce navigateur : sans elle, rien ne se passe.'}
        Quand le site bloque, elle ouvre la page ci-dessous et y clique le bouton comme une vraie souris (plus besoin d’UI Vision). L’extension lit la réponse du site : si le site demande une vérification humaine, l’onglet de l’enchère reste ouvert pour toi, et la mise se place toute seule une fois la vérification faite.</p>
        ${row('Débloquer tout seul', 'un clic toutes les 2 min tant que ça bloque, toutes les 15 min après 3 essais sans effet · si le site demande une vérification humaine, l’onglet reste ouvert pour toi · jamais en simulation', sw('unblock.on', c.unblock.on))}
        ${row('Page', 'une page de wiki-masters.com qui affiche le bouton', `<input type="text" data-k="unblock.url" value="${esc(c.unblock.url)}" style="width:200px">`)}
        ${row('Bouton', 'son texte exact', `<input type="text" data-k="unblock.button" value="${esc(c.unblock.button)}" style="width:90px">`)}
        <div class="stkbar"><button data-a="clickTest" ${clickExt ? '' : 'disabled'}>Tester maintenant</button></div>
      </div>
      <div class="card"><h3>Partager mes réglages</h3>
        <p class="help"><b>Copier mes réglages</b> crée un code à envoyer à un ami. Pour importer ceux d’un ami, colle son code ci-dessous puis clique « Importer ».</p>
        <p class="help">Tout est partagé : trading, vente et tri, paquets, prix max par rareté, réserve, rythme, liste « À garder »…<br>
        Sauf ce qui est personnel : <b>ta liste de cartes voulues</b> (chacun garde la sienne, même en important) et <b>le mode simulation</b>.</p>
        <textarea data-v="cfgio" placeholder="Colle ici le code WMBOT1:… d’un ami"></textarea>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button data-a="exportCfg">Copier mes réglages</button><button data-a="importCfg">Importer</button><button class="danger" data-a="resetCfg">Tout réinitialiser</button></div>
      </div>
      <div class="card"><h3>⚠️ Avertissement</h3><p class="help">L’automatisation n’est sans doute pas autorisée par les règles de WikiMasters : ton compte peut être bloqué. Si le site demande une vérification humaine, le bot se met en pause et te laisse la faire.</p></div>`;
  }

  function tplJournal() {
    return `<div style="display:flex;gap:6px;margin-bottom:8px"><button data-a="exportReport" title="Fichier à ouvrir dans le navigateur : bénéfice, achats, reventes, blocages… avec graphiques">📊 Rapport 24 h</button><button data-a="exportLog">Télécharger (.md)</button><button class="danger" data-a="clearLog">Vider</button></div><div class="feed" data-v="log"></div>`;
  }

  const TYPE_ICON = { bid: '💰', won: '🏆', lost: '❌', sell: '🏷️', sold: '✅', unsold: '↩️', discard: '🗑️', pack: '🎁', error: '⚠️', warn: '⚠️', alert: '🔔', dry: '🧪', skip: '⏭️', info: 'ℹ️', summary: '📊' };
  const logLine = e => `<div><time>${new Date(e.t).toLocaleTimeString().slice(0, 5)}</time>${TYPE_ICON[e.type] || '•'} ${esc(e.msg)}</div>`;

  ui = (() => {
    const host = document.createElement('div');
    host.id = 'wikimasters-bot';
    const root = host.attachShadow({ mode: 'open' });
    const st = load(K.ui, { tab: 'home', min: false });
    const TABS = [['home', 'Accueil'], ['wish', 'Cartes voulues'], ['trade', 'Trading'], ['sell', 'Collection'], ['settings', 'Réglages'], ['journal', 'Journal']];
    root.innerHTML = `<style>${CSS}</style>
      <div class="panel ${st.min ? 'min' : ''}">
        <header>
          <div class="status" data-v="status"><div class="ring"><div class="dot"></div></div><div class="stxt"><b data-v="stitle">Arrêté</b><small data-v="ssub">Clique sur Démarrer</small></div></div>
          <button data-a="toggle" class="go">Démarrer</button><button class="ghost" data-a="min" title="Réduire / agrandir">▁</button>
        </header>
        <div class="todobox" data-v="todobox"></div>
        <div class="banner" data-v="banner"></div>
        <div class="flash" data-v="flash"></div>
        <div class="ask" data-v="ask"><span data-v="askMsg"></span><div class="row2"><input type="text" data-v="askIn" style="display:none;width:90px"><button data-a="askNo">Annuler</button><button class="stop" data-a="askYes" data-v="askYesBtn">Oui, continuer</button></div></div>
        <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="body">${TABS.map(([k]) => `<section data-s="${k}"></section>`).join('')}</div>
        <div class="toast" data-v="toast">Enregistré ✓</div>
        <div class="modal" data-v="modal"><div class="mbox" data-v="mbox"></div></div>
      </div>`;
    const $ = s => root.querySelector(`[data-v="${s}"]`);
    const panel = root.querySelector('.panel');
    // n'écrit dans la page que ce qui a changé : chaque écriture la fait redessiner (coûteux sans carte graphique, comme sur le NAS)
    const put = (el, html) => { html = String(html); if (el && el._html !== html) { el._html = html; el.innerHTML = html; } };
    const TPL = { home: tplHome, wish: tplWish, trade: tplTrade, sell: tplSell, settings: tplSettings, journal: tplJournal };

    // clé stable d'une section : onglet + titre sans chiffres ni ce qui suit « · »
    const foldKey = (t, h) => t + ':' + h.textContent.split('·')[0].replace(/[0-9()/%+−-]/g, '').replace(/\s+/g, ' ').trim();
    function applyFolds(t) {
      const sec = root.querySelector(`section[data-s="${t}"]`);
      st.folds = st.folds || {};
      sec.querySelectorAll('.card > h3:first-child').forEach(h => {
        const key = foldKey(t, h);
        h.dataset.fold = key;
        h.parentElement.classList.toggle('closed', !!st.folds[key]);
      });
    }
    function renderTab(t = st.tab) {
      root.querySelector(`section[data-s="${t}"]`).innerHTML = TPL[t]();
      applyFolds(t);
      if (t === 'journal') $('log').innerHTML = load(K.journal, []).slice(-300).reverse().map(logLine).join('') || '<p class="help">Rien pour l’instant.</p>';
      if (t === 'trade') { self.onDeals(); self.onPnl(); self.onWatch(); }
      if (t === 'sell') self.onPacks();
      if (t === 'wish' && config.wishlist.items.length && Date.now() - load(K.owned, { at: 0 }).at > 2 * 60000) refreshOwned();
      self.onStatus();
    }
    function showTab(t) {
      st.tab = t; save(K.ui, st);
      root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      root.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.dataset.s === t));
      renderTab(t);
    }
    let toastT;
    function toast(msg = 'Enregistré ✓', ms = 1600) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
    // « + Stock » d'une carte intéressante sortie d'un paquet : toutes ses copies (même carte, même rareté) passent dans
    // le stock de revente. Collection : la copie gardée 5 min d'abord, relue seulement si la carte n'y est pas encore.
    let packQueue = Promise.resolve();
    async function packToStock(k) {
      const x = load(K.packs, []).find(h => packKey(h) === k);
      const name = x ? `${x.title} (${x.rarity})` : 'Carte';
      try {
        if (!x) throw new Error('elle n’est plus dans l’historique des paquets');
        const match = e => e.card && e.card.rarity === x.rarity && (x.card_id ? e.card.id === x.card_id : norm(titleOf(e.card)) === norm(x.title));
        const inS = new Set(load(K.pnl, []).filter(inStock).map(e => e.entryId));
        const pick = coll => coll.filter(e => match(e) && !e.is_shiny && !isKept(e) && !inS.has(e.id));   // shiny : jamais vendue
        let coll = await getCollectionCached();
        let found = pick(coll);
        if (!found.length) { collInvalidate(); coll = await getCollectionCached(); found = pick(coll); }   // carte toute récente
        if (!found.length) {
          const all = coll.filter(match);
          const inStockAll = all.length && all.every(e => inS.has(e.id));
          const why = !all.length ? 'elle n’est plus dans ta collection (vendue, défaussée ou échangée)'
            : inStockAll ? 'elle est déjà dans le stock'
            : 'elle est protégée : favori ★, étiquette, carte voulue ou « gardée » (Analyse)';
          if (inStockAll) markPackStocked(k);
          toast(`${name} : ${why}`, 5000);
          log('info', `+ Stock ${name} : ${why}`);
          return;
        }
        const n = await stockAddGroup({ card_id: found[0].card.id, title: x.title, rarity: x.rarity, ids: found.map(e => e.id), avg: x.avg });
        markPackStocked(k);
        toast(`${name} : ${n} copie(s) ajoutée(s) au stock ✓`, 3000);
      } catch (err) {
        toast(`${name} : échec — ${err.message}`, 7000);
        log('warn', `+ Stock ${name} : échec — ${err.message}`);
      } finally {
        packPending.delete(k);
        self.onPacks();
      }
    }
    function markPackStocked(k) {
      const h = load(K.packs, []);                            // relu : un paquet a pu ajouter des cartes entre-temps
      h.forEach(y => { if (packKey(y) === k) y.stocked = true; });
      save(K.packs, h);
    }

    let askResolve = null;
    // opt.input : affiche un champ prérempli et renvoie son texte (false si annulé) ; opt.yes : texte du bouton
    function ask(msg, opt = {}) {
      if (askResolve) askResolve(false);
      $('askMsg').textContent = msg; $('ask').classList.add('on');
      const inp = $('askIn');
      inp.style.display = opt.input != null ? '' : 'none';
      if (opt.input != null) { inp.value = opt.input; setTimeout(() => { inp.focus(); inp.select(); }, 0); }
      $('askYesBtn').textContent = opt.yes || 'Oui, continuer';
      if (st.min) { st.min = false; save(K.ui, st); panel.classList.remove('min'); }
      return new Promise(r => { askResolve = r; });
    }

    const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => o = o[k]); o[ks[ks.length - 1]] = v; };
    const getPath = (obj, path) => path.split('.').reduce((o, k) => o && o[k], obj);
    function commit(msg) { config = sanitize(config); saveConfig(); toast(msg); self.onStatus(); }
    // nouveau seuil d'une carte voulue : les enchères en cours suivent, l'alerte tombe si le seuil couvre le prix, recherche relancée
    function afterCapChange(it) {
      const cap = it.max == null || it.max === '' ? null : Number(it.max);
      const t = load(K.tracked, {});
      let n = 0;
      for (const m of Object.values(t)) if (m.source === 'wish' && norm(m.title) === norm(it.title) && cap != null) { m.cap = cap; n++; }
      if (n) { save(K.tracked, t); tracked = t; }
      const al = wishAlerts()[norm(it.title)];
      if (al && al.active && cap != null && cap >= al.price) clearWishAlert(it.title);
      next.wish = 0; wishCursor = 0;
    }
    // ajout d'une carte voulue : fenêtre avec sa valeur moyenne, le seuil, l'alerte et l'étiquette
    let lastResults = new Map();
    async function openAddModal(title) {
      const x = lastResults.get(norm(title)) || { title, byRar: {}, cardId: null };
      const box = $('mbox');
      $('modal').classList.add('on');
      if (st.min) { st.min = false; save(K.ui, st); panel.classList.remove('min'); }
      const draw = (sum, loading) => {
        const rars = RARITIES.filter(r => (sum && sum[r] && sum[r].average > 0) || x.byRar[r] != null);
        const cheapest = Object.entries(x.byRar).sort((a, b) => a[1] - b[1])[0];
        const avgOfR = r => sum && sum[r] && sum[r].average > 0 ? Math.round(sum[r].average) : null;
        // seuil proposé : la valeur moyenne de la rareté la moins chère en vente, sinon la meilleure moyenne connue, sinon le prix actuel
        const suggest = (cheapest && avgOfR(cheapest[0])) || (rars.map(avgOfR).filter(Boolean).sort((a, b) => b - a)[0]) || (cheapest && cheapest[1]) || '';
        const cur = box.querySelector('[data-m="max"]'), curN = box.querySelector('[data-m="notify"]'), curT = box.querySelector('[data-m="tag"]');
        const keepN = curN ? curN.checked : true, keepT = curT ? curT.value : '';
        box.innerHTML =`<h3>＋ ${esc(x.title)}</h3>
          ${loading ? '<p class="help">Lecture de la valeur moyenne de la carte…</p>' : rars.length ? `<div class="mvals">${rars.map(r => `<div><b class="r-${r}">${r}</b><span>Valeur moyenne <b>${avgOfR(r) ?? '–'}</b>${avgOfR(r) == null ? ' <small class="muted">(jamais vendue)</small>' : ''}</span><span>En vente dès <b>${x.byRar[r] ?? '–'}</b></span></div>`).join('')}</div><p class="help" style="margin:4px 0 0">Valeur moyenne = prix de vente moyen de <b>cette carte</b>, par rareté.</p>` : '<p class="help">Aucune vente connue pour cette carte : choisis ton max toi-même.</p>'}
          ${row('Mon max', 'le prix maximum que le bot paiera', `<input type="number" min="1" data-m="max" value="${esc(cur && cur.dataset.touched ? cur.value : suggest)}" ${cur && cur.dataset.touched ? 'data-touched="1"' : ''}>`)}
          ${row('M’avertir si dépassé', 'pastille bleue + notification : je décide de surenchérir ou de laisser tomber', `<label class="switch"><input type="checkbox" data-m="notify" checked><span></span></label>`)}
          <p class="help" style="margin-bottom:3px">Étiquette à mettre une fois la carte obtenue (facultatif)</p><input type="text" data-m="tag" placeholder="ex. Mythologie">
          <p class="help bad" data-m="err"></p>
          <div class="acts"><button data-a="modalCancel">Annuler</button><button class="go" data-a="modalAdd" data-title="${esc(x.title)}">Ajouter</button></div>`;
        box.querySelector('[data-m="notify"]').checked = keepN;
        box.querySelector('[data-m="tag"]').value = keepT;
        const inp = box.querySelector('[data-m="max"]');
        inp.addEventListener('input', () => { inp.dataset.touched = '1'; });   // saisie de l'utilisateur : gardée au rechargement de la fenêtre
      };
      draw(null, !!x.cardId);
      if (x.cardId) { const sum = await cardSummary(x.cardId).catch(() => null); if ($('modal').classList.contains('on')) draw(sum, false); }
    }
    const closeModal = () => { $('modal').classList.remove('on'); $('mbox').innerHTML = ''; };

    // Chaque modification est enregistrée tout de suite (pas de bouton « Enregistrer »).
    root.addEventListener('change', async ev => {
      const el = ev.target;
      config = loadConfig();
      if (el.dataset.k) {
        const k = el.dataset.k;
        let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
        if (k === 'sell.duration' || k === 'trading.resellDuration' || el.type === 'range') v = Number(v);
        if (k === 'dryRun' && v === false && !(await ask('Tu désactives la simulation : le bot va dépenser, vendre et défausser pour de vrai. Continuer ?'))) { el.checked = true; return; }
        if (k === 'sell.allowTop' && v === true && !(await ask('Autoriser la vente des cartes UR et L ? Elles ne seront vendues que si tu coches aussi leur rareté.'))) { el.checked = false; return; }
        config = loadConfig();
        setPath(config, k, v);
        if (k === 'trading.demand') Object.assign(config.trading, demandValues(v));   // le curseur écrit ses valeurs dans les règles
        // « Couper toutes les notifications » décoche les trois autres ; en cocher une décoche « Couper tout »
        if (k === 'notify.off' && v) Object.assign(config.notify, { blocks: false, packs: false, sales: false, shiny: false });
        if (['notify.blocks', 'notify.packs', 'notify.sales', 'notify.shiny'].includes(k) && v) {
          config.notify.off = false;
          try { if (Notification.permission === 'default') Notification.requestPermission(); } catch {}
        }
        if (k === 'trading.shinyAutoMin') next.shiny = v > 0 ? Date.now() + 5000 : 0;   // nouveau rythme : première recherche tout de suite
        if (k === 'trading.shinyAutoBuy') {
          if (v) {                                               // les shiny de la dernière recherche entrent tout de suite en file
            const n = ((load('wmbot1.shiny', null) || {}).rows || []).filter(addShinyWatch).length;
            if (n) toast(`✦ ${n} shiny en achat automatique (suivi dans Accueil)`, 4000);
          } else {                                               // coupé : celles en attente de mise sortent de la file
            for (const [id, w] of [...watch]) if (w.autoShiny) watch.delete(id);
            saveWatch();
          }
          renderTab();
        }
        commit();
        if (k.startsWith('notify.')) renderTab();
        if (k.startsWith('purge.')) purgePlan = null;           // l'aperçu ne vaut plus pour ces nouveaux critères
        if (['sell.allowTop', 'discard.onlyPackCards', 'trading.autoOptimize', 'trading.maxPerCard', 'trading.maxBids', 'trading.threshold', 'trading.windowMin', 'trading.scanEveryS', 'dryRun', 'reserve',
          'trading.demand', 'trading.liquidateAfter', 'trading.abandonAfter', 'trading.dormantAfter', 'purge.keepInteresting', 'packDiscard.enabled', 'trading.stockMax', 'notify.off'].includes(k)) renderTab();
      } else if (el.dataset.stk) {
        el.checked ? stockSel.add(el.dataset.stk) : stockSel.delete(el.dataset.stk); self.onPnl();
      } else if (el.dataset.stkall !== undefined) {
        if (el.checked) load(K.pnl, []).filter(inStock).forEach(e => stockSel.add(e.id)); else stockSel.clear();
        self.onPnl();
      } else if (el.dataset.ana) {
        el.checked ? anaSel.add(el.dataset.ana) : anaSel.delete(el.dataset.ana); self.onAnalysis();
      } else if (el.dataset.anaall !== undefined) {
        const a = load(K.analysis, null);
        if (el.checked && a) anaShown(a, anaView()).filter(r => anaFree(r).length).forEach(r => anaSel.add(r.key)); else anaSel.clear();   // libres de la vue affichée
        self.onAnalysis();
      } else if (el.dataset.all) {
        const it = config.wishlist.items[Number(el.dataset.all)];
        if (it) { it.all = el.checked; commit(el.checked ? `${it.title} : tous les exemplaires seront achetés` : `${it.title} : un seul exemplaire`); next.wish = 0; }
      } else if (el.dataset.notif) {
        const it = config.wishlist.items[Number(el.dataset.notif)];
        if (it) { it.notifyOver = el.checked; commit(el.checked ? 'Alerte de dépassement activée' : 'Alerte de dépassement coupée'); if (!el.checked) clearWishAlert(it.title); }
      } else if (el.dataset.tag) {
        const it = config.wishlist.items[Number(el.dataset.tag)];
        if (it) { it.tag = el.value.trim() || null; commit(it.tag ? `Étiquette « ${it.tag} » ✓` : 'Étiquette retirée'); }
      } else if (el.dataset.arr) {
        if (el.dataset.arr === 'stockSell.rarities' && el.checked && ['UR', 'L'].includes(el.value) && !(await ask(`Confier toutes tes ${el.value} à la revente du trading ? (sauf favoris, étiquetées et voulues)`))) { el.checked = false; return; }
        config = loadConfig();
        const arr = new Set(getPath(config, el.dataset.arr));
        el.checked ? arr.add(el.value) : arr.delete(el.value);
        if (el.dataset.arr === 'purge.rarities') purgePlan = null;
        if (el.dataset.arr === 'stockSell.rarities') next.sort = 0;
        setPath(config, el.dataset.arr, RARITIES.filter(r => arr.has(r)));
        commit(); renderTab();
      } else if (el.dataset.cat) {
        config = loadConfig();
        const c = config.wishlist.categories[Number(el.dataset.cat)], f = el.dataset.f;
        if (c) {
          c[f] = f === 'enabled' || f === 'exact' ? el.checked : f === 'tag' ? (el.value.trim() || null) : Number(el.value);
          commit(f === 'enabled' ? (el.checked ? `« ${c.name} » activée` : `« ${c.name} » en pause`)
            : f === 'exact' ? `« ${c.name} » : ${c.exact ? 'texte exact, une copie par carte' : 'catégorie qui contient le texte'}`
            : f === 'tag' ? `« ${c.name} » : ${c.tag ? `étiquette « ${c.tag} »` : 'sans étiquette'}`
            : `« ${c.name} » : ${f === 'max' ? 'max ' + c.max : c.mult + '× la moyenne'}`);
          next.cat = 0;
        }
      } else if (el.dataset.item) {
        const it = config.wishlist.items[Number(el.dataset.item)];
        if (it) { it.max = el.value === '' ? null : Number(el.value); commit(); afterCapChange(it); }
      } else if (el.dataset.ref) {
        if (el.value === '') delete config.trading.manualRef[el.dataset.ref]; else config.trading.manualRef[el.dataset.ref] = Number(el.value);
        commit(); renderTab();
      } else if (el.dataset.lines) {
        setPath(config, el.dataset.lines, el.value.split('\n').map(s => s.trim()).filter(Boolean));
        commit();
      }
    });
    // curseur d'exigence : les valeurs suivent pendant qu'on le fait glisser (enregistré au relâchement)
    root.addEventListener('input', ev => {
      const el = ev.target;
      if (el.type !== 'range' || el.dataset.k !== 'trading.demand') return;
      const d = Number(el.value), lbl = root.querySelector('[data-v="demandLbl"]'), txt = root.querySelector('[data-v="demandTxt"]');
      if (lbl) lbl.textContent = `${d} · ${demandLabel(d)}`;
      if (txt) txt.innerHTML = demandText(demandValues(d));
    });
    // empêche le site d'intercepter les touches tapées dans le panneau
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, ev => {
      ev.stopPropagation();
      if (t === 'keydown' && ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.v === 'q') root.querySelector('[data-a="search"]').click();
      if (t === 'keydown' && ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.v === 'stkq') root.querySelector('[data-a="stkFind"]').click();
    }));

    async function doSearch(btn) {
      const q = $('q').value.trim();
      if (!q) return;
      btn.disabled = true; $('results').innerHTML = '<p class="help">Recherche…</p>';
      const titles = new Map();
      let failed = 0, pages = 0;
      const doneSorts = new Set(), seenIds = new Set();
      for (let i = 0; i < 6 && doneSorts.size < 3; i++) {
        const res = await searchTitlePage(q, i, doneSorts);
        if (res && res.skip) continue;
        if (!res) { failed++; continue; }
        pages++;
        for (const a of res.auctions || []) {
          if (seenIds.has(a.id)) continue;                     // déjà vue avec un autre tri
          seenIds.add(a.id);
          const t = titleOf(a.card), r = rarityOf(a), price = minNext(a);
          const cur = titles.get(t) || { title: t, rarities: new Set(), min: Infinity, n: 0, exact: norm(t) === norm(q), byRar: {}, cardId: null };
          cur.rarities.add(r); cur.min = Math.min(cur.min, price); cur.n++;
          cur.byRar[r] = Math.min(cur.byRar[r] ?? Infinity, price);
          cur.cardId = cur.cardId || a.card_id || (a.card && a.card.id) || null;
          titles.set(t, cur);
        }
      }
      btn.disabled = false;
      lastResults = new Map([...titles.values()].map(x => [norm(x.title), x]));
      const inList = new Set(loadConfig().wishlist.items.map(i => norm(i.title)));
      // depuis le 07/10/2026, le site cherche aussi dans la description des cartes (« Zeus » ramène Grisou, Ginger ale…) :
      // seules les cartes dont le TITRE contient la recherche restent, titre exact d'abord, puis ceux qui commencent par elle
      const nq = norm(q), all = [...titles.values()];
      const list = all.filter(x => norm(x.title).includes(nq))
        .sort((a, b) => (b.exact - a.exact) || (norm(b.title).startsWith(nq) - norm(a.title).startsWith(nq)) || a.title.localeCompare(b.title));
      const onlyDesc = all.length - list.length;
      const hasExact = list.some(x => x.exact);
      $('results').innerHTML = (onlyDesc ? `<p class="help">${onlyDesc} autre${onlyDesc > 1 ? 's cartes ne parlent' : ' carte ne parle'} de « ${esc(q)} » que dans leur description : masquée${onlyDesc > 1 ? 's' : ''}.</p>` : '')
        + (list.length ? list.map(x => `<div class="result"><div><b>${esc(x.title)}</b>${x.exact ? ' <span class="pill">titre exact</span>' : ''}<br><small class="muted">${x.n} en vente · ${[...x.rarities].map(r => `<b class="r-${r}">${r}</b>`).join(' ')} · dès ${x.min}</small></div>${inList.has(norm(x.title)) ? '<span class="muted">dans ta liste</span>' : `<button data-a="addItem" data-title="${esc(x.title)}">＋ Ajouter</button>`}</div>`).join('') : (failed && !pages ? '<p class="help bad">Le site n’a pas répondu. Réessaie dans quelques secondes.</p>' : '<p class="help">Aucune carte en vente avec ce nom en ce moment.</p>'))
        + (failed && pages ? '<p class="help warn">Le site a mal répondu sur une partie des résultats : relance la recherche pour tout voir.</p>' : '')
        + (hasExact || inList.has(norm(q)) ? '' : `<div class="result"><div class="muted">Ajouter quand même « ${esc(q)} » (titre exact, pas en vente pour l’instant)</div><button data-a="addItem" data-title="${esc(q)}">＋ Ajouter</button></div>`);
    }

    root.addEventListener('click', async ev => {
      const fold = ev.target.closest('h3[data-fold]');
      if (fold && !ev.target.closest('button, input, label, select, a')) {
        const card = fold.parentElement, closed = !card.classList.contains('closed');
        card.classList.toggle('closed', closed);
        st.folds = st.folds || {};
        if (closed) st.folds[fold.dataset.fold] = 1; else delete st.folds[fold.dataset.fold];
        save(K.ui, st);
        return;
      }
      const chip = ev.target.closest('.chip');
      if (chip && chip.classList.contains('locked')) { ev.preventDefault(); return; }
      const btn = ev.target.closest('button'); if (!btn) return;
      if (btn.dataset.tab) return showTab(btn.dataset.tab);
      const a = btn.dataset.a;
      if (a === 'askYes' || a === 'askNo') {
        $('ask').classList.remove('on'); const r = askResolve; askResolve = null;
        const withInput = $('askIn').style.display !== 'none';
        r && r(a === 'askYes' ? (withInput ? $('askIn').value : true) : false); return;
      }
      if (a === 'toggle') {
        if (running) return stop();
        if (!config.dryRun && !(await ask('Le bot va agir pour de vrai (mises, ventes, défausses). Démarrer ?'))) return;
        try { if (Notification.permission === 'default') Notification.requestPermission(); } catch {}
        return start();
      }
      if (a === 'min') { st.min = !st.min; save(K.ui, st); panel.classList.toggle('min', st.min); return; }
      if (a === 'search') return doSearch(btn);
      if (a === 'addItem') return openAddModal(btn.dataset.title);
      if (a === 'modalCancel') return closeModal();
      if (a === 'modalAdd') {
        const box = $('mbox'), max = Number(box.querySelector('[data-m="max"]').value);
        if (!(max > 0)) { box.querySelector('[data-m="err"]').textContent = 'Indique un max (le prix maximum que le bot paiera).'; return; }
        config = loadConfig();
        if (config.wishlist.items.some(i => norm(i.title) === norm(btn.dataset.title))) { closeModal(); toast('Déjà dans ta liste'); return; }
        const tag = box.querySelector('[data-m="tag"]').value.trim();
        config.wishlist.items.push({ title: btn.dataset.title, max, notifyOver: box.querySelector('[data-m="notify"]').checked, tag: tag || null });
        commit('Carte ajoutée ✓'); next.wish = 0; closeModal();
        const q = $('q').value; renderTab(); $('q').value = q; return;
      }
      if (a === 'delItem') {
        config = loadConfig();
        const [gone] = config.wishlist.items.splice(Number(btn.dataset.n), 1);
        commit('Carte retirée'); if (gone) clearWishAlert(gone.title); renderTab(); return;
      }
      if (a === 'raiseCap') {
        config = loadConfig();
        const it = config.wishlist.items[Number(btn.dataset.n)], inp = root.querySelector(`[data-raise="${btn.dataset.n}"]`);
        const v = Number(inp && inp.value);
        if (!it || !(v > 0)) return;
        it.max = v; commit(`Seuil de ${it.title} : ${v} ✓`); afterCapChange(it); log('info', `${it.title} : seuil monté à ${v}`); renderTab(); return;
      }
      if (a === 'dropAlert') {
        const it = loadConfig().wishlist.items[Number(btn.dataset.n)];
        if (it) { clearWishAlert(it.title, true); log('info', `${it.title} : tu laisses tomber cette enchère (seuil inchangé)`); renderTab(); }
        return;
      }
      if (btn.dataset.sub) { st.tradeSub = btn.dataset.sub; save(K.ui, st); renderTab('trade'); return; }
      if (btn.dataset.scanidx) { scanIdx = Number(btn.dataset.scanidx); self.onScans(); return; }
      if (btn.dataset.stksort) { st.stockSort = btn.dataset.stksort; save(K.ui, st); self.onStock(); return; }
      if (btn.dataset.anaf) { st.anaFilter = btn.dataset.anaf; save(K.ui, st); self.onAnalysis(); return; }
      if (btn.dataset.wsub) { st.wishSub = btn.dataset.wsub; save(K.ui, st); renderTab('wish'); return; }
      if (a === 'stkLiq' || a === 'stkRel' || a === 'stkDis') {
        const ids = [...stockSel];
        if (!ids.length) return;
        if (a === 'stkLiq') {
          const add = loadConfig().trading.liqAdd;
          if (!(await ask(`Liquider ${ids.length} carte(s) au prix payé ${add >= 0 ? '+' : '−'} ${Math.abs(add)} ?`))) return;
          toast(`${liquidateEntries(ids, add)} carte(s) en liquidation`);
        } else if (a === 'stkDis') {
          if (!(await ask(`Défausser ${ids.length} carte(s) du stock ? Irréversible (+1 WikiBidou chacune). Celles en vente ne sont pas touchées.`))) return;
          try { const r = await discardEntries(ids); toast(r.sim ? 'Simulation : rien défaussé' : `${r.done} défaussée(s)${r.skipped ? ` · ${r.skipped} ignorée(s)` : ''}`); }
          catch (err) { toast('Défausse refusée : ' + err.message); }
        } else {
          if (!(await ask(`Retirer ${ids.length} carte(s) du stock ? Elles restent dans ta collection.`))) return;
          toast(`${releaseEntries(ids)} carte(s) retirée(s)`);
        }
        stockSel.clear(); self.onPnl(); return;
      }
      if (a === 'anaGo') {
        btn.disabled = true;
        try { await analyzeCollection((i, n) => { const pr = root.querySelector('[data-v="anaProg"]'); if (pr) pr.textContent = `${i}/${n}…`; }); anaSel.clear(); }
        catch (err) { toast('Analyse impossible : ' + err.message); }
        btn.disabled = false;
        const pr = root.querySelector('[data-v="anaProg"]'); if (pr) pr.textContent = '';
        self.onAnalysis(); return;
      }
      if (a === 'anaStop') { analysisStop = true; toast('Arrêt de l’analyse…'); return; }
      if (a === 'shinyGo') {
        const t = loadConfig().trading, prog = () => root.querySelector('[data-v="shinyProg"]');
        btn.disabled = true;
        const list = () => { const el = root.querySelector('[data-v="shiny"]'); if (el) setHtml(el, shinyHtml()); };
        try {
          if (!t.shinyFindRarities.length) { toast('Choisis au moins une rareté'); btn.disabled = false; return; }
          const res = await findShiny(t.shinyFindMin, t.shinyFindMax, t.shinyFindRarities, (pg, n, upTo) => {
            const pr = prog();
            if (pr) pr.textContent = n == null ? `recherche des enchères ouvertes… (page ${pg})` : `page ${pg} · ${n} shiny · vu jusqu’à ${Math.max(0, upTo ?? 0)}/${t.shinyFindMin} min…`;
            if (n != null) list();
          });
          shinyFresh(res.rows);   // vues à l'écran : la recherche automatique ne les notifiera pas
          const queued = res.rows.filter(addShinyWatch).length;   // achat automatique (si coché)
          if (queued) toast(`✦ ${queued} shiny en achat automatique (suivi dans Accueil)`, 4000);
        }
        catch (err) { toast('Recherche impossible : ' + err.message); }
        btn.disabled = false;
        if (prog()) prog().textContent = '';
        list();
        return;
      }
      if (a === 'shinyStop') { shinyStop = true; toast('Arrêt de la recherche…'); return; }
      if (a === 'anaStock' || a === 'anaKeep') {
        const keys = [...anaSel];
        if (!keys.length) return;
        if (a === 'anaKeep' && !(await ask(`Garder ${keys.length} carte(s) dans ta collection ? Le bot ne les vendra ni ne les défaussera.`))) return;
        const n = a === 'anaStock' ? analysisToStock(keys) : analysisKeep(keys);
        toast(a === 'anaStock' ? `${n} carte(s) ajoutée(s) au stock` : `${n} carte(s) gardée(s)`);
        anaSel.clear(); self.onAnalysis(); return;
      }
      if (a === 'humanDone') { clearHuman(btn.dataset.key); return; }
      if (a === 'tagDone') { const n = Number(btn.dataset.n), mine = load(K.tagTodo, []).filter(x => x.manual)[n]; save(K.tagTodo, load(K.tagTodo, []).filter(x => x !== mine && !(x.title === (mine || {}).title && x.tag === (mine || {}).tag))); self.onHuman(); return; }
      if (a === 'humanHide') { hideHuman(btn.dataset.kind, btn.dataset.id); return; }
      if (a === 'mode') {
        config = loadConfig();
        const m = config.mode === btn.dataset.mode ? 'normal' : btn.dataset.mode;
        let until = 0;
        if (m === 'slow') {
          const v = await ask('Temps d’absence ? (ex. 20, 45 min, 2h, 1h30) Les ventes seront finies à ton retour, ou au plus 10 min après.', { input: st.away || '1h', yes: 'Activer le mode lent' });
          if (v === false) return;
          const mins = parseAway(v);
          if (!mins) { toast('Durée non comprise : écris par exemple 45 ou 2h'); return; }
          st.away = String(v).trim(); save(K.ui, st);
          until = Date.now() + mins * 60000;
          config = loadConfig();
        }
        config.mode = m; config.slowUntil = until; commit(m === 'normal' ? 'Mode normal' : MODES[m].label + ' activé');
        log('info', `Mode ${m === 'normal' ? 'normal' : MODES[m].label}`);
        Object.assign(next, { trade: 0, wish: 0, follow: 0, sort: 0 });
        panel.classList.remove('flash-turbo', 'flash-slow');
        if (m !== 'normal') { void panel.offsetWidth; panel.classList.add('flash-' + m); clearTimeout(self.flashT); self.flashT = setTimeout(() => panel.classList.remove('flash-' + m), 5000); }
        renderTab('home'); return;
      }
      if (a === 'wishRefresh') {
        const it = loadConfig().wishlist.items[Number(btn.dataset.n)];
        if (!it) return;
        btn.disabled = true; btn.textContent = '…';
        try { toast((await refreshWish(it)) === 'search' ? 'Recherche faite' : 'Mise actualisée'); } catch (err) { toast('Échec : ' + err.message); }
        renderTab('wish'); return;
      }
      if (a === 'wishBid') {
        const it = loadConfig().wishlist.items[Number(btn.dataset.n)], inp = btn.previousElementSibling && btn.previousElementSibling.matches('input.wbid') ? btn.previousElementSibling : root.querySelector(`[data-bidn="${btn.dataset.n}"]`);   // le champ juste à côté : la bonne enchère quand il y en a plusieurs
        const v = Number(inp && inp.value);
        if (!it || !(v > 0)) return;
        if (!(await ask(`Miser ${v} sur ${it.title} ?${Number(it.max) < v ? ` Ton max passera de ${it.max ?? 'auto'} à ${v}.` : ''}`))) return;
        btn.disabled = true;
        const r = await manualBid(it, inp.dataset.auction, v).catch(err => ({ ok: false, why: err.message }));
        toast(r.ok ? `Misé ${v} ✓` : config.dryRun ? 'Simulation : rien misé' : 'Mise refusée : ' + (r.why || 'voir Journal'));
        renderTab('wish'); return;
      }
      if (a === 'prioUp' || a === 'prioDown') {
        const e = load(K.pnl, []).find(x => x.id === btn.dataset.id);
        if (!e) return;
        updatePnl(e.id, { prio: prioOf(e) + (a === 'prioUp' ? 1 : -1) });   // redessine le stock
        next.sort = 0; return;
      }
      if (a === 'stkOne') { toast(releaseEntries([btn.dataset.id]) ? 'Retirée du stock' : 'Carte en vente : attends la fin'); stockSel.delete(btn.dataset.id); self.onStock(); return; }
      if (a === 'stkFind') {
        const out = root.querySelector('[data-v="stkAdd"]'), qv = norm((root.querySelector('[data-v="stkq"]') || {}).value || '');
        out.innerHTML = '<p class="help">Lecture de ta collection…</p>';
        try {
          const coll = await getCollectionCached(2 * 60000);
          const have = new Set(load(K.pnl, []).filter(inStock).map(e => e.entryId));
          const groups = new Map();
          for (const e of coll) {
            if (!e.card || isKept(e) || have.has(e.id) || (qv && !norm(titleOf(e.card)).includes(qv))) continue;
            const k = e.card.id + '|' + e.card.rarity;
            const g = groups.get(k) || { key: k, card_id: e.card.id, title: titleOf(e.card), rarity: e.card.rarity, ids: [] };
            g.ids.push(e.id); groups.set(k, g);
          }
          stkFound = new Map([...groups.values()].sort((x, y) => RANK[y.rarity] - RANK[x.rarity] || x.title.localeCompare(y.title)).slice(0, 60).map(g => [g.key, g]));
          out.innerHTML = stkFound.size ? [...stkFound.values()].map(g => `<div class="result"><span><b class="r-${g.rarity}">${g.rarity}</b> ${esc(g.title)}${g.ids.length > 1 ? ` <b>×${g.ids.length}</b>` : ''}</span><button data-a="stkAddOne" data-key="${esc(g.key)}" title="Ajouter au stock">+</button></div>`).join('') + (groups.size > 60 ? `<p class="help">${groups.size - 60} autre(s) : précise ta recherche.</p>` : '')
            : '<p class="help">Aucune carte (hors favoris, étiquetées, voulues, gardées et déjà en stock).</p>';
        } catch (err) { out.innerHTML = `<p class="help bad">Collection illisible : ${esc(err.message)}</p>`; }
        return;
      }
      if (a === 'stkAddOne') {
        const g = stkFound.get(btn.dataset.key);
        if (!g) return;
        btn.disabled = true;
        const n = await stockAddGroup(g);
        toast(n ? `${n} carte(s) ajoutée(s) au stock` : 'Déjà en stock');
        stkFound.delete(g.key); btn.closest('.result').remove(); self.onStock(); return;
      }
      if (a === 'stkScan') {
        const prog = root.querySelector('[data-v="scanProg"]');
        if (!loadConfig().trading.enabled) { toast('Active le trading d’abord'); if (prog) prog.textContent = 'Active le trading d’abord'; return; }
        if (running) { next.trade = 0; toast('Recherche lancée'); if (prog) prog.textContent = 'Recherche lancée par le bot…'; return; }
        btn.disabled = true; if (prog) prog.textContent = 'Recherche en cours…';
        try { await scanTrading(); if (prog) prog.textContent = `Fini · ${watch.size} affaire(s) surveillée(s)`; }
        catch (err) { if (prog) prog.textContent = 'Échec : ' + err.message; }
        btn.disabled = false; self.onWatch(); return;
      }
      if (a === 'packStock') {
        // file d'attente : un clic à la fois (plusieurs clics d'affilée lisaient la collection en parallèle et le site refusait)
        const k = btn.dataset.k;
        if (!k || packPending.has(k)) return;
        packPending.add(k);
        self.onPacks();
        packQueue = packQueue.then(() => packToStock(k));
        return;
      }
      if (a === 'goWish') return showTab('wish');
      if (a === 'notifAsk') { try { await Notification.requestPermission(); } catch {} renderTab(); return; }
      if (a === 'applyDemand') { config = loadConfig(); config.trading.demand = Number(btn.dataset.n); Object.assign(config.trading, demandValues(config.trading.demand)); commit(`Exigence : ${config.trading.demand} ✓`); renderTab(); return; }
      if (a === 'phoneGen') {
        const rnd = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
        config = loadConfig(); config.notify.phone = 'wmbot-' + rnd;
        commit('Nom généré : abonne-toi à ' + config.notify.phone + ' dans l’appli ntfy'); renderTab(); return;
      }
      if (a === 'clickTest') {
        if (!(await ask(`L’extension va ouvrir ${config.unblock.url || '(aucune page réglée)'} et cliquer vraiment sur « ${config.unblock.button} ». Continuer ?`))) return;
        btn.disabled = true;
        const r = await unblockByClick(null, true);
        toast(r.ok ? (r.human ? 'Clic fait : une case « Vérifiez que vous êtes humain » est à cocher' : 'Clic fait ✓') : 'Échec : ' + r.error, 6000);
        btn.disabled = false; return;
      }
      if (a === 'phoneTest') {
        btn.disabled = true;
        const ok = await phoneNotify('✅ Test : les notifications du bot arrivent bien sur ton téléphone.', 'blocks');
        toast(ok ? `Test envoyé sur « ${config.notify.phone} » : regarde ton téléphone` : 'Envoi impossible (pas de réseau, ou ntfy.sh inaccessible)', 5000);
        btn.disabled = false; return;
      }
      if (a === 'applyBest') {
        if (!(await ask(`Remplacer tes règles de trading par les réglages optimisés (${PRESET.date}) ? Raretés ${PRESET.values.rarities.join(', ')}, ${PRESET.values.threshold} %, valeur ≥ ${PRESET.values.minValue}, bénéfice ≥ ${PRESET.values.minProfit}, prix habituels ${Object.entries(PRESET.refs).map(([r, v]) => `${r} ${v}`).join(', ')}. Tes plafonds (prix max, budget, enchères) sont gardés.`, { yes: 'Mettre les réglages optimisés' }))) return;
        config = loadConfig(); applyPreset(config.trading);
        commit('Réglages optimisés appliqués ✓'); next.trade = 0; renderTab(); return;
      }
      if (a === 'liquidateNow') {
        if (!(await ask(`Passer les cartes dormantes en liquidation ? Elles pourront être vendues à perte, jamais sous ${tcfg().liquidateFloor} % de leur prix d’achat.`))) return;
        toast(`${liquidateDormantNow()} carte(s) en liquidation`); renderTab(); return;
      }
      if (a === 'releaseDormant') {
        if (!(await ask('Rendre les cartes dormantes à ta collection ? Le bot ne les revendra plus (celles en vente finissent leur vente). Tu pourras les vendre ou les défausser toi-même.'))) return;
        toast(`${releaseDormant()} carte(s) rendue(s)`); renderTab(); return;
      }
      if (a === 'purgeGo') {
        if (purgeUi.busy) return;
        // écrit dans l'onglet s'il est affiché, et garde le texte pour le retour sur l'onglet
        const out = { set innerHTML(h) { purgeUi.html = h; const el = root.querySelector('section[data-s="sell"] [data-v="purge"]'); if (el) el.innerHTML = h; } };
        const setBusy = b => {
          purgeUi.busy = b; if (!b) purgeUi.stop = false;
          const el = root.querySelector('section[data-s="sell"] [data-a="purgeGo"]'); if (el) { el.disabled = b; el.textContent = b ? '⏳ Grand ménage en cours…' : '🗑️ Lancer le grand ménage'; }
          const sb = root.querySelector('section[data-s="sell"] [data-a="purgeStop"]'); if (sb) sb.disabled = !b;
        };
        purgeUi.stop = false;
        setBusy(true); out.innerHTML = '<p class="help">Lecture de ta collection…</p>';
        try {
          const t0 = Date.now();
          const plan = await analyzePurge((i, n) => {
            // temps restant estimé d'après les cartes déjà lues
            const per = i > 1 ? (Date.now() - t0) / (i - 1) : 0, left = per ? Math.round(per * (n - i + 1) / 60000) : null;
            out.innerHTML = `<p class="help">Valeur des cartes : ${i}/${n}…${left != null ? ` · encore ≈ ${left < 1 ? 'moins d’1' : left} min` : ''} <span class="muted">(une lecture par carte · Stop pour arrêter)</span></p>`;
          });
          if (plan.toDiscard.length) out.innerHTML = `<p class="help"><b>↑ Confirme en haut du panneau</b> (barre jaune) : ${plan.toDiscard.length} carte(s) à défausser.</p>`;
          const by = r => plan.toDiscard.filter(x => x.e.card.rarity === r).length;
          const detail = plan.rarities.filter(by).map(r => `${by(r)} ${r}`).join(', ');
          const nFail = plan.kept.filter(x => x.failed).length;
          const keptTxt = plan.keepInteresting ? ` · ${plan.kept.length - nFail} intéressante(s) gardée(s)${nFail ? ` · ${nFail} gardée(s) car leur prix n’a pas pu être lu (site lent) : relance plus tard` : ''}` : '';
          if (!plan.toDiscard.length) { out.innerHTML = `<p class="help">0 à défausser : ${plan.found} carte(s) ${plan.rarities.join(', ')} trouvée(s) sur ${plan.collSize}${keptTxt}${plan.unknown.length ? ` · ${plan.unknown.join(', ')} gardées entières : prix médian pas encore appris (Trading → Prix habituel)` : ''}${plan.protectedCount ? ` · ${plan.protectedCount} protégée(s)` : ''}.</p>`; setBusy(false); return; }
          if (!(await ask(`Défausser ${plan.toDiscard.length} carte(s) (${detail})${keptTxt} ? Irréversible.${config.dryRun ? ' (simulation : rien ne sera détruit)' : ''}`))) { out.innerHTML = '<p class="help">Annulé.</p>'; setBusy(false); return; }
          out.innerHTML = '<p class="help">Défausse en cours…</p>';
          const r = await runPurge((i, n, waitS) => {
            out.innerHTML = waitS != null
              ? `<p class="help">En attente de la fin de la vente en cours… ${waitS} s <span class="muted">(3 min au plus)</span></p>`
              : `<p class="help">Défausse : ${i}/${n}…</p>`;
          });
          out.innerHTML = `<p class="help ${config.dryRun ? '' : 'good'}">${config.dryRun ? `Simulation : ${r.total} carte(s) auraient été défaussées (voir Journal).` : (r.done ? `✓ ${r.done} carte(s) défaussée(s) (+${r.done} WikiBidous)` : `<span class="bad">0 défaussée : ${r.missing ? `${r.missing} carte(s) introuvable(s) à la relecture de ta collection` : 'le site a refusé (voir Journal)'}</span>`)}${keptTxt}${plan.unknown.length ? ` · ${plan.unknown.join(', ')} gardées (prix médian pas encore appris)` : ''}</p>`;
        } catch (err) { out.innerHTML = err.message === 'arrêté' ? '<p class="help">Grand ménage arrêté.</p>' : `<p class="help bad">Impossible : ${esc(err.message)}</p>`; }
        setBusy(false); return;
      }
      if (a === 'purgeStop') {
        if (!purgeUi.busy) return;
        purgeUi.stop = true;
        if (askResolve) { $('ask').classList.remove('on'); const r = askResolve; askResolve = null; r(false); }   // confirmation en attente : annulée
        toast('Arrêt du grand ménage…'); return;
      }
      if (a === 'catAdd') {
        const name = ($('catName').value || '').trim(), max = Number($('catMax').value), mult = Number($('catMult').value);
        const tag = ($('catTag').value || '').trim() || null, exact = $('catExact').checked;
        if (name.length < 3) { toast('Écris une catégorie, ex. race de chien'); return; }
        config = loadConfig();
        if (config.wishlist.categories.some(c => norm(c.name) === norm(name))) { toast('Cette catégorie est déjà dans la liste'); return; }
        config.wishlist.categories.push({ name, tag, exact, max: max > 0 ? max : 1000, mult: mult > 0 ? mult : 2, enabled: true });
        commit(`Catégorie « ${name} » ajoutée`); catQueue = name; next.cat = 0; renderTab('wish'); return;
      }
      if (a === 'catDel') { config = loadConfig(); const c = config.wishlist.categories.splice(Number(btn.dataset.n), 1)[0]; if (c) commit(`Catégorie « ${c.name} » retirée`); renderTab('wish'); return; }
      if (a === 'catRun') {
        const c = config.wishlist.categories[Number(btn.dataset.n)];
        if (!c) return;
        if (!running || !config.wishlist.enabled) { toast(running ? 'Active « Acheter les cartes voulues » d’abord' : 'Démarre le bot d’abord'); return; }
        catQueue = c.name; next.cat = 0; toast(`Recherche « ${c.name} » lancée`); return;
      }
      if (a === 'runWish') { next.wish = 0; wishCursor = 0; toast(running ? 'Recherche lancée' : 'Démarre le bot d’abord'); return; }
      if (a === 'runTrade') { next.trade = 0; toast(!running ? 'Démarre le bot d’abord' : config.trading.enabled ? 'Recherche lancée' : 'Active le trading d’abord'); return; }
      if (a === 'runSort') { next.sort = 0; toast(running ? 'Tri lancé' : 'Démarre le bot d’abord'); return; }
      if (a === 'resetPnl') { if (await ask('Remettre à zéro l’historique des bénéfices du trading ?')) { save(K.pnl, []); self.onPnl(); } return; }
      if (a === 'exportReport') return exportReport();
      if (a === 'exportLog') return exportJournal();
      if (a === 'clearLog') { if (await ask('Vider le journal ?')) { save(K.journal, []); renderTab(); } return; }
      if (a === 'exportCfg') {
        const code = makeShareCode();
        $('cfgio').value = code; $('cfgio').select();
        try { await navigator.clipboard.writeText(code); toast('Code copié ✓ (sans tes cartes voulues)'); } catch { toast('Copie le code affiché'); }
        return;
      }
      if (a === 'importCfg') {
        let settings, fromBot;
        try { ({ settings, bot: fromBot } = readShareCode($('cfgio').value)); } catch (err) { toast('Code invalide : ' + (err.message || 'illisible')); return; }
        const { next: imported, changed, mismatch } = importSettings(settings);
        if (fromBot !== BOT_VERSION) log('warn', `Import : le code vient de la version ${fromBot || 'ancienne'} du bot, tu as la ${BOT_VERSION}. Les réglages absents de son côté gardent leur valeur par défaut.`);
        if (!changed) { toast('Ces réglages sont déjà les tiens'); return; }
        if (!(await ask(`Importer ces réglages ? ${changed} réglage(s) vont changer. Tes ${imported.wishlist.items.length} carte(s) voulue(s) et ton mode ${imported.dryRun ? 'simulation' : 'réel'} sont conservés.`))) return;
        config = imported; commit('Réglages importés ✓'); $('cfgio').value = ''; renderTab();
        // vérification après enregistrement
        const saved = flatten(stripPersonal(loadConfig())), sent = flatten(settings);
        const diff = Object.keys(sent).filter(k => sent[k] !== saved[k]);
        if (mismatch.length || diff.length) log('warn', `Import : ${[...new Set([...mismatch, ...diff])].length} réglage(s) n’ont pas pu être repris à l’identique (valeur hors limites corrigée) : ${[...new Set([...mismatch, ...diff])].join(', ')}`);
        else log('info', `Réglages importés à l’identique (${changed} modifié(s)), cartes voulues et mode conservés`);
        return;
      }
      if (a === 'resetCfg') { if (await ask('Remettre tous les réglages par défaut ? Ta liste de cartes voulues sera vidée.')) { config = sanitize(merge(DEFAULTS, {})); applyPreset(config.trading); commit('Réglages réinitialisés (réglages optimisés)'); renderTab(); } return; }
    });

    const self = {
      onClickExt() { if (st.tab === 'settings') renderTab('settings'); },   // l'extension s'est signalée : la carte Déblocage se met à jour
      onStatus() {
        const idle = running && !busy;
        $('status').className = 'status' + (running ? ' on' : '') + (running && config.dryRun ? ' sim' : '') + (idle ? ' idle' : '') + (MODES[config.mode] ? ' m-' + config.mode : '');
        $('stitle').textContent = (!running ? 'Arrêté' : config.dryRun ? 'En ligne · simulation' : 'En ligne') + (MODES[config.mode] ? ' · ' + MODES[config.mode].label : '');
        $('ssub').textContent = !running ? 'Clique sur Démarrer' : (activity || 'Démarrage…') + (siteLatency > 3000 ? ` · site lent (${(siteLatency / 1000).toFixed(1)} s/requête)` : '');
        const t = root.querySelector('[data-a="toggle"]');
        t.textContent = running ? 'Arrêter' : 'Démarrer'; t.className = running ? 'stop' : 'go';
        if (st.tab === 'home') self.refreshHome();
      },
      refreshHome() {
        const v = n => root.querySelector(`section[data-s="home"] [data-v="${n}"]`);
        if (!v('balance')) return;
        put(v('balance'), balance ?? '–');
        const tr = Object.values(load(K.tracked, {}));
        put(v('bids'), tr.length); put(v('sales'), Object.keys(load(K.listings, {})).length);
        put(v('upcoming'), running ? upcoming().map(u => `<div><time>${fmtLeft(u.at - Date.now())}</time>${u.label}</div>`).join('') : '<div class="muted">Le bot est arrêté.</div>');
        put(v('tracked'), tr.length ? tr.map(t => `<div><b class="r-${t.rarity}">${t.rarity}</b> ${esc(t.title)} · ${t.leading ? '<span class="good">tu mènes</span>' : '<span class="warn">dépassé</span>'} à ${t.lastBid} · max ${t.cap} · fin ${fmtLeft(leftMs(t.end))} <span class="muted">${t.source === 'trade' ? '· trading' : t.source === 'cat' ? `· catégorie « ${esc(t.cat)} »` : ''}</span></div>`).join('') : '<div class="muted">Aucune.</div>');
        put(v('recent'), load(K.journal, []).slice(-6).reverse().map(logLine).join('') || '<div class="muted">Rien pour l’instant.</div>');
        if (v('shiny')) put(v('shiny'), shinyHomeHtml());
        // Pauses du site : toujours affichées ici avec leur bouton, même si la notification « À toi de jouer » a été masquée (✕).
        // Redessiné seulement quand ça change : un redessin chaque seconde avalerait le clic sur le bouton.
        const pz = v('paused'), hs = Object.entries(humanState()), sig = hs.map(([k, x]) => k + x.at).join('|') + `|${clickHandles()}|${clickStreak}|${clickHuman}|${clickLastAt}`;
        if (pz && pz.dataset.sig !== sig) {
          pz.dataset.sig = sig;
          const auto = clickHandles();                         // l'extension WikiMasters Clic s'en occupe : rien à faire à la main
          pz.innerHTML = hs.length ? `<div class="card" style="border:2px solid #3b82f6"><h3>${auto ? '🖱 Bloqué par le site : l’extension s’en occupe' : '⏸ En pause : le site demande une vérification'}</h3>
            <p class="help">${auto
              ? `L’extension WikiMasters Clic clique « ${esc(config.unblock.button)} » sur ta page de déblocage, puis le bot reprend aussitôt : rien à faire. Si le site bloque encore, elle réessaie toutes les 2 min, puis toutes les 15 min après ${CLICK_MAX} essais sans effet.${clickLastAt ? ` Dernier clic à ${new Date(clickLastAt).toTimeString().slice(0, 5)}.` : ''}`
              : `${clickHuman ? 'Le site demande une vérification humaine : l’onglet de l’enchère est resté ouvert, fais la vérification (la mise se place toute seule ensuite), puis clique le bouton. ' : ''}Fais l’action une fois à la main sur le site (miser, mettre une carte en vente ou ouvrir un paquet), puis clique le bouton. Le bot réessaie aussi tout seul toutes les 10 min, mais pour les enchères seulement s’il trouve une carte à miser.`}</p>
            ${hs.map(([k, x]) => `<div class="stkbar"><span><b>${HUMAN_NAMES[k] || k}</b> <span class="muted">· depuis ${new Date(x.at).toTimeString().slice(0, 5)}</span></span><button data-a="humanDone" data-key="${esc(k)}">C’est fait, reprendre</button></div>`).join('')}</div>` : '';
        }
      },
      // Actions à faire par un humain : contour bleu du panneau, encadré bleu sous l'en-tête, pastilles sur les onglets
      onHuman() {
        // blocage du site pris en charge par l'extension WikiMasters Clic : pas « À toi de jouer », une simple ligne d'état
        const h = visibleTodos(), auto = clickHandles() && h.checks.length > 0, checks = auto ? [] : h.checks;
        const n = checks.length + h.wish.length + h.tags.length;
        const x = (kind, id) => `<button class="x" data-a="humanHide" data-kind="${kind}" data-id="${esc(id)}" title="Masquer jusqu’à ce que ce soit réglé">✕</button>`;
        panel.classList.toggle('human', n > 0);
        const box = $('todobox');
        box.classList.toggle('on', n > 0 || auto);
        box.innerHTML = n ? `<b class="t">🧑 À toi de jouer</b>`
          + checks.map(([k, c]) => `<div class="it" title="Le site demande une vérification : ${esc(c.msg)}, puis clique Fait"><span><b>${HUMAN_NAMES[k] || k}</b> · ${esc(c.msg)}</span><span class="acts"><button data-a="humanDone" data-key="${k}">Fait</button>${x('check', k)}</span></div>`).join('')
          + (h.wish.length ? `<div class="it"><span><b>${h.wish.length}</b> carte${h.wish.length > 1 ? 's' : ''} &gt; seuil</span><span class="acts"><button data-a="goWish">Voir</button>${x('wish', '')}</span></div>` : '')
          + h.tags.map((t, i) => `<div class="it" title="${esc(t.why || '')}"><span>🏷 <b>${esc(t.title)}</b> → ${esc(t.tag)}</span><span class="acts"><button data-a="tagDone" data-n="${load(K.tagTodo, []).filter(y => y.manual).indexOf(load(K.tagTodo, []).filter(y => y.manual).find(y => tagSig(y) === tagSig(t)))}">Fait</button>${x('tag', tagSig(t))}</span></div>`).join('')
          : '';
        if (auto) box.innerHTML += `<div class="it"><span>🖱 <b>${h.checks.map(([k]) => HUMAN_NAMES[k] || k).join(', ')}</b> · bloqué par le site, l’extension WikiMasters Clic débloque</span></div>`;
        const dot = (tab, on) => { const b = root.querySelector(`[data-tab="${tab}"]`); if (b) b.innerHTML = TABS.find(t => t[0] === tab)[1] + (on ? '<span class="bdot"></span>' : ''); };
        dot('wish', h.wish.length > 0);
        dot('home', checks.length + h.tags.length > 0);
        if (st.tab === 'wish' && !root.querySelector('section[data-s="wish"] :focus')) renderTab('wish');
      },
      onLog(e) {
        const l = root.querySelector('section[data-s="journal"] [data-v="log"]');
        if (l && st.tab === 'journal') l.insertAdjacentHTML('afterbegin', logLine(e));
        if (st.tab === 'home') self.refreshHome();
      },
      onDeals() {
        const el = root.querySelector('section[data-s="trade"] [data-v="deals"]');
        if (!el) return;
        const d = load(K.deals, []);
        el.innerHTML = d.length ? `<table><tr><th>Carte</th><th>Prix</th><th>Valeur</th><th>Décision</th></tr>${d.map(x => `<tr title="${esc(x.why || '')}"><td><b class="r-${x.rarity}">${x.rarity}</b> ${esc(x.title)}<br><small class="muted">${new Date(x.t).toLocaleTimeString().slice(0, 5)}</small></td><td>${x.price}</td><td>${x.value ?? '?'}${x.pct ? ` <small class="good">${x.pct} %</small>` : ''}</td><td class="${x.decision === 'misé' ? 'good' : 'muted'}">${esc(x.decision)}</td></tr>`).join('')}</table>` : '<p class="help">Aucune affaire repérée pour l’instant. Active le trading et démarre le bot.</p>';
      },
      onPnl() {
        self.onStock();
        const s = pnlStats();
        const sign = n => (n > 0 ? '+' : '') + n;
        const cls = n => n > 0 ? 'good' : n < 0 ? 'bad' : '';
        // Stock du bot · historique des ventes (et des cartes gardées), les plus récentes d'abord
        const hEl = root.querySelector('section[data-s="trade"] [data-v="saleHist"]');
        if (hEl) {
          const done = s.pnl.filter(e => !inStock(e)).sort((a, b) => (b.soldAt || b.boughtAt || 0) - (a.soldAt || a.boughtAt || 0));
          const realized = done.filter(e => e.status === 'sold').reduce((t, e) => t + e.sale - (e.source === 'collection' ? 0 : e.cost), 0);
          setHtml(hEl, done.length
            ? `<p class="help" style="margin-top:0">${s.sold.length} vente(s) · bénéfice réalisé <b class="${cls(realized)}">${sign(realized)}</b>${s.kept.length ? ` · ${s.kept.length} gardée(s)` : ''}</p>
              <div class="list"><table><tr><th>Carte</th><th title="Prix payé par le bot (– : carte de ta collection)">Payé</th><th>Vendue</th><th>Bénéfice</th></tr>${done.map(e => {
                const p = e.status === 'sold' ? e.sale - (e.source === 'collection' ? 0 : e.cost) : null, when = e.soldAt || e.boughtAt;
                return `<tr><td><b class="r-${e.rarity}">${e.rarity}</b> ${esc(e.title)}${when ? `<br><small class="muted">${new Date(when).toLocaleString().slice(0, 16)}</small>` : ''}</td><td>${e.source === 'collection' ? '–' : e.cost}</td><td class="muted">${e.status === 'sold' ? e.sale : e.status === 'discarded' ? 'défaussée' : `gardée${e.keptWhy ? ' · ' + esc(e.keptWhy) : ''}`}</td><td class="${cls(p)}">${p == null ? '–' : sign(p)}</td></tr>`;
              }).join('')}</table></div>`
            : '<p class="help">Aucune vente pour l’instant.</p>');
        }
        // Stock du bot · historique des achats (toutes les enchères gagnées), les plus récents d'abord
        const bEl = root.querySelector('section[data-s="trade"] [data-v="buyHist"]');
        if (bEl) {
          const buys = loadBuys(), byId = new Map(s.pnl.map(e => [e.id, e]));
          const SRC = { trade: 'trading', wish: 'carte voulue', shiny: 'shiny ✦ auto' };
          const src = b => b.source === 'cat' ? `catégorie « ${esc(b.cat || '')} »` : SRC[b.source] || '–';
          // ce qu'est devenue une carte du trading ; les autres restent dans ta collection
          const fate = b => {
            const e = byId.get(b.id);
            if (!e) return b.source && b.source !== 'trade' ? '<span class="muted">dans ta collection</span>' : '<span class="muted">–</span>';
            if (e.status === 'sold') { const p = e.sale - e.cost; return `vendue ${e.sale} <span class="${cls(p)}">(${sign(p)})</span>`; }
            return e.status === 'listed' ? `en vente ${e.listPrice}` : e.status === 'held' ? 'en stock' : e.status === 'discarded' ? 'défaussée' : `gardée${e.keptWhy ? ' · ' + esc(e.keptWhy) : ''}`;
          };
          const spent = buys.reduce((t, b) => t + (b.price || 0), 0);
          setHtml(bEl, buys.length
            ? `<p class="help" style="margin-top:0">${buys.length} achat(s) · dépensé <b>${spent}</b></p>
              <div class="list"><table><tr><th>Carte</th><th>Prix</th><th>Source</th><th>Devenue</th></tr>${buys.map(b => `<tr><td><b class="r-${b.rarity}">${b.rarity}${b.shiny ? '✦' : ''}</b> ${esc(b.title)}${b.t ? `<br><small class="muted">${new Date(b.t).toLocaleString().slice(0, 16)}</small>` : ''}</td><td>${b.price}</td><td class="muted">${src(b)}</td><td>${fate(b)}</td></tr>`).join('')}</table></div>`
            : '<p class="help">Aucun achat pour l’instant.</p>');
        }
        const el = root.querySelector('section[data-s="trade"] [data-v="pnl"]');
        if (!el) return;
        setHtml(el, !s.pnl.length
          ? `<p class="help">Aucun achat de trading pour l’instant.${config.dryRun ? ' En simulation le bot n’achète rien : les chiffres apparaîtront quand il tournera pour de vrai.' : ''}</p>`
          : `<div class="tiles">
              <div class="tile"><span>Bénéfice réalisé</span><b class="${cls(s.realized)}">${sign(s.realized)}</b></div>
              <div class="tile"><span>Bénéfice potentiel (en stock)</span><b class="${cls(s.latent)}">${sign(s.latent)}</b></div>
              <div class="tile"><span>Dépensé · ${s.pnl.length} achat(s)</span><b>${s.spent}</b></div>
              <div class="tile"><span>Revendu · ${s.sold.length} vente(s)</span><b>${s.revenue}</b></div>
            </div>
            <p class="help">Stock et historique des ventes : onglet <b>Stock du bot</b> (${s.held.length} en stock).</p>
            <div style="margin-top:8px"><button class="danger" data-a="resetPnl">Remettre à zéro</button></div>`);
      },
      // Sous-onglet « Stock du bot » : la liste à cocher, avec ✕ pour retirer une carte d'un clic
      onStock() {
        const el = root.querySelector('section[data-s="trade"] [data-v="stock"]');
        if (!el) return;
        // affichée dans l'ordre où le bot les vendra : celles déjà en vente, puis la file (ta priorité d'abord)
        const byOrder = load(K.pnl, []).filter(inStock).sort((a, b) => ((b.status === 'listed') - (a.status === 'listed')) || resaleCmp(a, b));
        let rank = 0;
        const order = new Map(byOrder.filter(e => e.status === 'held').map(e => [e.id, ++rank]));   // #n = ordre de mise en vente, quel que soit le tri affiché
        const sortBy = ['gain', 'value', 'old'].includes(st.stockSort) ? st.stockSort : 'order';
        const gainOf = e => (e.status === 'listed' && e.listPrice != null ? e.listPrice : resellPrice(e)) - (e.source === 'collection' ? 0 : e.cost || 0);
        const stock = sortBy === 'gain' ? [...byOrder].sort((a, b) => gainOf(b) - gainOf(a))
          : sortBy === 'value' ? [...byOrder].sort((a, b) => (b.value || 0) - (a.value || 0))
          : sortBy === 'old' ? [...byOrder].sort((a, b) => (a.boughtAt || 0) - (b.boughtAt || 0))
          : byOrder;
        const sortSeg = `<div class="seg" style="margin:0 0 6px;flex-wrap:wrap">${[['order', 'Ordre de vente'], ['gain', 'Plus gros bénéfice'], ['value', 'Plus chères'], ['old', 'Plus anciennes']].map(([k, l]) => `<button data-stksort="${k}" class="${sortBy === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
        const prioCell = e => `<span style="white-space:nowrap">${e.status === 'held' ? `<small class="muted" title="Ordre de mise en vente">#${order.get(e.id)}</small> ` : ''}<button class="ghost" data-a="prioUp" data-id="${esc(e.id)}" title="Vendre plus tôt">▲</button><button class="ghost" data-a="prioDown" data-id="${esc(e.id)}" title="Vendre plus tard">▼</button>${prioOf(e) ? ` <b class="${prioOf(e) > 0 ? 'good' : 'muted'}" title="Ta priorité">${prioOf(e) > 0 ? '+' : ''}${prioOf(e)}</b>` : ''}</span>`;
        for (const id of [...stockSel]) if (!stock.some(e => e.id === id)) stockSel.delete(id);
        const n = stockSel.size;
        const state = e => (e.liq ? `🔻 liquidation à ${resellPrice(e)}${e.status === 'listed' ? ` · en vente ${e.listPrice}` : ''}` : e.status === 'listed' ? `en vente ${e.listPrice}` : `→ ${resellPrice(e)}`) + (isDormant(e) && !e.liq ? ' 💤' : '');
        // bénéfice possible = prix de la vente en cours (ou de la prochaine) − prix payé (0 pour une carte de ta collection)
        const gain = e => (e.status === 'listed' && e.listPrice != null ? e.listPrice : resellPrice(e)) - (e.source === 'collection' ? 0 : e.cost || 0);
        const fmtGain = g => `<span class="${g > 0 ? 'good' : g < 0 ? 'bad' : 'muted'}">${g > 0 ? '+' : ''}${g}</span>`;
        const total = stock.reduce((s, e) => s + gain(e), 0);
        setHtml(el, stock.length
          ? `<p class="help" style="margin-top:0">${stock.length} carte(s) · bénéfice possible <b>${fmtGain(total)}</b></p>${sortSeg}<div class="list"><table><tr><th><input type="checkbox" data-stkall ${n && n === stock.length ? 'checked' : ''}></th><th>Carte</th><th>État</th><th title="Prix payé par le bot (– : carte de ta collection)">Payé</th><th title="Prix de vente moyen de la carte">Vaut</th><th title="Prix de la vente en cours ou de la prochaine − prix payé">Bénéfice</th><th title="Ordre de mise en vente : ▲ plus tôt, ▼ plus tard">Priorité</th><th></th></tr>${stock.map(e => `<tr><td><input type="checkbox" data-stk="${esc(e.id)}" ${stockSel.has(e.id) ? 'checked' : ''}></td><td><b class="r-${e.rarity}">${e.rarity}</b> ${esc(e.title)}</td><td class="muted">${state(e)}</td><td>${e.source === 'collection' ? '–' : e.cost}</td><td>${e.value ?? '?'}</td><td>${fmtGain(gain(e))}</td><td>${prioCell(e)}</td><td>${e.status === 'held' ? `<button class="ghost" data-a="stkOne" data-id="${esc(e.id)}" title="Retirer du stock (reste dans ta collection)">✕</button>` : '<span class="muted" title="En vente : attends la fin de la vente">·</span>'}</td></tr>`).join('')}</table></div>
            <div class="stkbar"><label class="chk" title="Prix de liquidation = prix payé + ce montant (négatif possible, jamais sous 1)">Payé + <input type="number" class="liqadd" data-k="trading.liqAdd" value="${config.trading.liqAdd}"></label><button data-a="stkLiq" ${n ? '' : 'disabled'}>Liquider (${n})</button><button class="danger" data-a="stkDis" ${n ? '' : 'disabled'}>Défausser (${n})</button><button data-a="stkRel" ${n ? '' : 'disabled'}>Retirer (${n})</button></div>
            <p class="help">La liste est dans l’ordre de mise en vente (#1 = la prochaine). Priorité : ▲ pour la vendre plus tôt, ▼ plus tard ; une dormante mise en priorité passe comme une carte normale.<br>Payé = prix payé par le bot.<br>Vaut = prix de vente moyen de la carte.<br>Bénéfice = prix de la vente en cours (ou de la prochaine) − prix payé ; il baisse si la carte reste invendue.<br>Liquider = vendue en priorité, au prix payé + le montant choisi.<br>Défausser = détruite (+1 WikiBidou).<br>Retirer ou ✕ = reste dans ta collection.</p>`
          : '<p class="help">Stock vide. Ajoute des cartes depuis l’Analyse de la collection ou le « + Stock » des cartes de paquets (Vente &amp; tri).</p>');
      },
      // Affaires repérées par la recherche de trading, en attente du bon moment pour miser
      onWatch() {
        const el = root.querySelector('section[data-s="trade"] [data-v="watch"]');
        if (!el) return;
        const list = [...watch].sort(([, x], [, y]) => new Date(x.end) - new Date(y.end));
        el.innerHTML = list.length
          ? `<p class="help" style="margin:0 0 4px">${list.length} affaire(s) en attente : le bot mise le minimum à ${tcfg().snipeS} s de la fin, puis resurenchérit jusqu’au max${running ? '' : ' (s’il est démarré)'}.</p><table><tr><th>Carte</th><th title="Mise maximale sur cette enchère">Max</th><th>Vaut</th><th>Mise dans</th><th>Fin</th></tr>${list.map(([id, w]) => `<tr><td><b class="r-${w.rarity}">${w.rarity}${w.shiny ? '✦' : ''}</b> <a href="/marketplace/${esc(id)}" target="_blank" rel="noopener" style="color:inherit">${esc(w.title)}</a>${w.autoShiny ? ' <small class="muted">shiny auto</small>' : ''}</td><td><b>${w.cap}</b></td><td>${w.value ?? '–'}</td><td>${fmtLeft(Math.max(0, leftMs(w.end) - snipeWindowMs()))}</td><td class="muted">${fmtLeft(leftMs(w.end))}</td></tr>`).join('')}</table>`
          : '<p class="help">Aucune affaire en attente de mise.</p>';
        const tb = root.querySelector('section[data-s="trade"] [data-v="tradeBids"]');
        if (tb) tb.innerHTML = tradeBidsHtml();
      },
      onScans() {
        const el = root.querySelector('section[data-s="trade"] [data-v="scans"]');
        if (el) setHtml(el, scansHtml());
      },
      onCat() {
        config.wishlist.categories.forEach((c, n) => { const el = root.querySelector(`section[data-s="wish"] [data-catst="${n}"]`); if (el) el.innerHTML = catStatus(c); });
      },
      onShiny() {
        const el = root.querySelector('section[data-s="trade"] [data-v="shiny"]');
        if (el) setHtml(el, shinyHtml());
      },
      onAnalysis() {
        const el = root.querySelector('section[data-s="trade"] [data-v="analysis"]');
        if (el) setHtml(el, anaHtml());
      },
      onPacks() {
        const el = root.querySelector('section[data-s="sell"] [data-v="packs"]');
        if (!el) return;
        const h = load(K.packs, []);
        el.innerHTML = h.length ? `<table><tr><th>Carte</th><th>Prix moyen</th><th></th></tr>${h.map((x, i) => `<tr><td><b class="r-${x.rarity}">${x.rarity}</b> ${esc(x.title)}<br><small class="muted">${new Date(x.t).toLocaleString().slice(0, 16)}</small></td><td class="good">${x.avg}</td><td>${x.stocked ? '<span class="muted">en stock</span>' : packPending.has(packKey(x)) ? '<span class="muted" title="Ajout en cours ou en file d’attente">⏳</span>' : `<button class="wbtn" data-a="packStock" data-k="${esc(packKey(x))}" title="Mettre dans le stock de revente du trading">+ Stock</button>`}</td></tr>`).join('')}</table>` : '<p class="help">Aucune pour l’instant. Elles apparaîtront ici dès qu’un paquet en contiendra une.</p>';
      },
      onOwned() { if (st.tab === 'wish') renderTab('wish'); },
      banner(msg) { $('banner').textContent = msg; $('banner').classList.add('on'); },
      flash(msg) { $('flash').textContent = msg; $('flash').classList.add('on'); setTimeout(() => $('flash').classList.remove('on'), 12000); },
    };

    document.body.appendChild(host);
    showTab(st.tab);
    self.onHuman();
    // Affichage au repos : sans souris ni clavier depuis 1 min, les animations s'arrêtent et l'horloge ne redessine plus que toutes les 10 s.
    // Sans carte graphique (navigateur du NAS), chaque image d'animation est dessinée par le processeur, 60 fois par seconde, même sans personne devant.
    // Le bot ne ralentit pas, et l'encadré « À toi de jouer » est toujours mis à jour aussitôt.
    let seenAt = Date.now(), calmTicks = 0;
    const wake = () => { seenAt = Date.now(); if (panel.classList.contains('calm')) { panel.classList.remove('calm'); calmTicks = 0; } };
    ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(e => window.addEventListener(e, wake, { capture: true, passive: true }));
    // horloge : comptes à rebours et texte de veille à jour chaque seconde (toutes les 10 s au repos)
    setInterval(() => {
      const calm = !!config.calmDisplay && Date.now() - seenAt > 60000;   // réglage « Affichage au repos », désactivé par défaut
      if (calm !== panel.classList.contains('calm')) panel.classList.toggle('calm', calm);
      if (calm && ++calmTicks % 10) return;
      if (running && !busy && activity.startsWith('En veille')) { activity = 'En veille · prochaine action ' + nextActionText(); $('ssub').textContent = activity; }
      if (st.tab === 'home') self.refreshHome();
      if (st.tab === 'trade' && st.tradeSub === 'scans') self.onWatch();   // comptes à rebours des mises prévues et en cours
      if (st.tab === 'wish') self.onCat();                              // temps restant des mises des catégories
    }, 1000);
    return self;
  })();

  function exportJournal() {
    const j = load(K.journal, []);
    const sec = (types, title) => `\n## ${title}\n` + (j.filter(e => types.includes(e.type)).map(e => `- ${e.t.replace('T', ' ').slice(0, 19)} UTC — ${e.msg}`).join('\n') || '_rien_');
    // état du bot au moment de l'export : les réglages réellement appliqués, pour comprendre un journal sans avoir le navigateur sous la main
    const t = config.trading, tc = tcfg(), s = config.sell;
    const state = [
      `Version ${BOT_VERSION} · ${config.dryRun ? 'simulation' : 'réel'} · ${running ? 'en marche' : 'arrêté'} · solde ${balance ?? '?'} · réserve ${config.reserve}`,
      `Trading ${t.enabled ? 'activé' : 'désactivé'} · règles : ${['threshold', 'minValue', 'minProfit', 'maxStock'].every(k => t[k] === { ...PRESET.values, ...demandValues(t.demand) }[k]) && t.rarities.join() === PRESET.values.rarities.join() ? `optimisées (${PRESET.date}, exigence ${t.demand})` : 'retouchées à la main'} · raretés ${tc.rarities.join(', ') || 'aucune'} · shiny (${tc.shinyFindRarities.join(', ') || 'L'}) toujours vues, seules à partir de ${tc.shinyFocusAt} % du stock (${shinyFocusLimit(tc)}/${tc.maxStock})${shinyFocus(tc) ? ' [actif]' : ''}${tc.shinyMax > 0 ? ` · max ${tc.shinyMax} par shiny` : ''}`,
      `Achat : fin < ${tc.windowMin} min · prix ≤ ${tc.threshold} % de la valeur · valeur ≥ ${tc.minValue} · bénéfice ≥ ${tc.minProfit} · mise à ${tc.snipeS} s · max ${tc.maxPerCard} par carte · budget ${tc.budget} · ${tc.maxBids} enchère(s)`,
      `Revente : ${t.autoResell ? 'automatique' : 'manuelle'} · départ ${tc.resellPercent} % · −${tc.resellDrop} % par invendu · braderie ≤ ${tc.stockDiscount} % · ventes de ${tc.resellDuration} min · à perte ${tc.allowLoss ? `après ${tc.lossAfter} invendus` : 'non'}`,
      `Stock ${stockText()} · taux de revente ${rateText()} · dormante après ${tc.dormantAfter} invendus, ${tc.maxDormant} max hors stock, ${tc.dormantSlots} emplacement(s) max · liquidation après ${tc.liquidateAfter} (plancher ${tc.liquidateFloor} % du prix d’achat) · abandon après ${tc.abandonAfter}`,
      `Exigence ${t.demand}/100 (${demandLabel(t.demand)}) · conseil ${recommendDemand().value} · prix habituels imposés : ${Object.entries(t.manualRef || {}).filter(([, v]) => Number(v) > 0).map(([r, v]) => `${r} ${v}`).join(', ') || 'aucun'}`,
      `Actions à faire : ${humanCount() ? `${Object.keys(humanState()).join(', ') || 'aucune vérification'} · ${activeWishAlerts().length} carte(s) voulue(s) au-dessus du seuil · ${load(K.tagTodo, []).length} étiquette(s) à poser` : 'aucune'}`,
      `Prix habituels : ${RARITIES.map(r => `${r} ${rarityRef(r).value ?? '?'}`).join(' · ')}`,
      `Vente & tri : revente du trading pour ${config.stockSell.rarities.join(', ') || 'aucune rareté'} · défausse des paquets ${config.packDiscard.enabled ? config.packDiscard.rarities.join(', ') : 'désactivée'} · intéressante ≥ ${INTEREST_FACTOR}× le prix médian (${PURGE_RARITIES.map(r => `${r} ${interestLine(r) ?? '?'}`).join(' · ')})`,
    ].map(x => '- ' + x).join('\n');
    const md = `# Journal WikiMasters Bot\n\nExporté le ${new Date().toLocaleString()}\n\n## État du bot\n${state}\n` +
      sec(['summary'], 'Bilan du trading (toutes les heures)') +
      sec(['won', 'lost'], 'Cartes gagnées et perdues') + sec(['bid'], 'Mises') + sec(['pack'], 'Paquets ouverts') +
      sec(['sell', 'sold', 'unsold'], 'Ventes') + sec(['discard'], 'Défausses') + sec(['alert', 'error', 'warn'], 'Alertes') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = 'wikimasters-journal.md';
    a.click();
  }

  // ═════════════════════════ Rapport 24 h ═════════════════════════
  // Fichier HTML autonome à télécharger (onglet Journal) : bénéfice, achats, reventes, mises, bonnes affaires, blocages
  // et clics de l'extension sur les dernières 24 h, avec graphiques. Sources : l'historique du rapport (K.stats, 26 h) et
  // le journal, sans doublons, plus les reventes du trading (K.pnl, qui garde le prix d'achat de chaque carte).
  const REPORT_ORIGINS = [['carte voulue', 'Cartes voulues'], ['catégorie', 'Catégories'], ['shiny', 'Shiny ✦'], ['bonne affaire', 'Trading'], ['surenchère manuelle', 'À la main']];
  function reportData() {
    const now = Date.now(), since = now - 24 * 3600000, sinceIso = new Date(since).toISOString();
    const t0 = Math.floor(since / 3600000) * 3600000;          // heures pleines : 25 tranches, la 1re et la dernière incomplètes
    const seen = new Set(), ev = [];
    for (const e of [...load(K.stats, []), ...load(K.journal, [])]) {
      if (!e || !e.t || e.t < sinceIso || seen.has(e.t + e.msg)) continue;
      seen.add(e.t + e.msg);
      ev.push(e);
    }
    ev.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const at = e => Date.parse(e.t);
    const hours = Array.from({ length: 25 }, (_, i) => ({ start: t0 + i * 3600000, bought: 0, spent: 0, sold: 0, profit: 0, bids: 0, blocks: 0, deals: 0 }));
    const slot = ms => hours[Math.max(0, Math.min(24, Math.floor((ms - t0) / 3600000)))];
    const pnl = load(K.pnl, []), pnlIds = new Set(pnl.map(p => p.id));

    // mises : la raison de la première mise vue sur une enchère donne l'origine de l'achat
    const origin = {};
    let bids = 0, bidSum = 0;
    for (const e of ev) {
      if (e.type !== 'bid') continue;
      const m = /^Mise (\d+) sur .* · (.*)$/.exec(e.msg);
      if (!m) continue;
      bids++; bidSum += +m[1]; slot(at(e)).bids++;
      const id = e.data && e.data.auctionId;
      if (id && !origin[id]) { const o = REPORT_ORIGINS.find(([k]) => m[2].includes(k)); if (o) origin[id] = o[1]; }
    }
    const buys = [];
    for (const e of ev) {
      const m = e.type === 'won' && /^Gagnée : (.+) \((\w+)\) pour (\d+)/.exec(e.msg);
      if (!m) continue;
      const id = e.data && e.data.auctionId, price = +m[3];
      buys.push({ t: at(e), title: m[1], rarity: m[2], price, origin: (id && origin[id]) || (id && pnlIds.has(id) ? 'Trading' : 'Autre') });
      const h = slot(at(e)); h.bought++; h.spent += price;
    }
    const sales = pnl.filter(p => p.status === 'sold' && p.sale && (p.soldAt || 0) >= since)
      .map(p => ({ t: p.soldAt, title: p.title, rarity: p.rarity, cost: p.cost || 0, sale: p.sale, profit: p.sale - (p.cost || 0) }))
      .sort((a, b) => a.t - b.t);
    for (const s of sales) { const h = slot(s.t); h.sold++; h.profit += s.profit; }

    let scans = 0, deals = 0, scanSecs = 0;
    for (const e of ev) {
      const m = e.type === 'info' && /^Trading : \d+ enchère.*?, (\d+) bonne\(s\) affaire.*\((\d+) s\)/.exec(e.msg);
      if (!m) continue;
      scans++; deals += +m[1]; scanSecs += +m[2]; slot(at(e)).deals += +m[1];
    }

    // blocages : du « … en pause » au « … : reprise après … » de la même activité
    const blocks = [], open = {}, clicks = [];
    for (const e of ev) {
      let m;
      if (e.type === 'alert' && (m = /^(\S+) (?:en pause|bloquées par le site)/.exec(e.msg))) {
        if (!open[m[1]]) { open[m[1]] = { what: m[1], start: at(e), end: null, how: null }; blocks.push(open[m[1]]); slot(at(e)).blocks++; }
      } else if (e.type === 'info' && (m = /^(\S+) : (?:reprise après (le clic de l’extension|ta vérification)|de nouveau acceptées)/.exec(e.msg))) {
        if (open[m[1]]) { open[m[1]].end = at(e); open[m[1]].how = m[2] === 'le clic de l’extension' ? 'le clic de l’extension' : 'une action acceptée'; delete open[m[1]]; }
      } else if (/^Déblocage par clic : /.test(e.msg) && !/clics d’affilée/.test(e.msg)) {
        const ok = e.type !== 'warn';
        clicks.push({ t: at(e), ok, human: /cocher|vérification humaine/.test(e.msg), msg: ok ? '' : e.msg.replace(/^Déblocage par clic : /, '') });
      }
    }
    const count = (type, re) => ev.filter(e => e.type === type && (!re || re.test(e.msg))).length;
    const held = pnl.filter(inStock);
    return {
      now, since, t0, version: BOT_VERSION, dryRun: config.dryRun, firstAt: ev.length ? at(ev[0]) : now,
      hours, buys, sales, bids, bidSum, lost: count('lost'), listed: count('sell'), unsold: count('unsold'),
      packs: count('pack', /^Paquet ouvert/), discards: count('discard'), errors: count('error'),
      scans, deals, scanSecs,
      blocks: blocks.map(b => ({ ...b, end: b.end || now, open: !b.end })),
      clicks, gaveUp: count('alert', /clics d’affilée/),
      watchdog: count('warn', /^(Le bot était bloqué depuis plus de|Un tour du bot durait depuis plus de)/),
      stock: { n: held.length, cost: held.reduce((s, p) => s + (p.cost || 0), 0) },
    };
  }

  const REPORT_CSS = `
:root { color-scheme: light; --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781; --grid: #e1e0d9;
  --axis: #c3c2b7; --border: rgba(11,11,11,.10); --s1: #2a78d6; --s2: #eb6834; --neg: #e34948; --critical: #d03b3b; --good: #006300; }
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781; --grid: #2c2c2a;
    --axis: #383835; --border: rgba(255,255,255,.10); --s1: #3987e5; --s2: #d95926; --neg: #e66767; --critical: #d03b3b; --good: #0ca30c; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 28px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; font-weight: 650; }
.sub { color: var(--ink2); margin: 0 0 18px; }
.warnline { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--muted); border-radius: 8px; padding: 8px 12px; color: var(--ink2); font-size: 13px; margin: 0 0 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 16px 12px; margin: 0 0 16px; min-width: 0; }
.card h2 { font-size: 15px; font-weight: 650; margin: 0 0 2px; }
.note { color: var(--ink2); font-size: 12.5px; margin: 0 0 10px; }
.hero { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 18px; }
.hero .l { color: var(--ink2); width: 100%; font-size: 13px; }
.hero .v { font-size: 56px; font-weight: 650; letter-spacing: -1px; line-height: 1.05; }
.hero .s { color: var(--ink2); }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; margin: 0 0 16px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; min-width: 0; }
.tile .l { color: var(--ink2); font-size: 12.5px; }
.tile .v { font-size: 26px; font-weight: 600; margin: 2px 0 1px; }
.tile .s { color: var(--muted); font-size: 12px; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; margin: 0 0 16px; }
.two .card { margin: 0; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--ink2); margin: 0 0 6px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.legend i.dot { border-radius: 50%; }
.legend i.ring { border-radius: 50%; background: transparent !important; border: 2px solid var(--s1); width: 10px; height: 10px; }
.chart { width: 100%; }
svg { display: block; overflow: visible; }
svg text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
svg text.lbl { fill: var(--ink2); font-size: 12px; font-weight: 600; }
svg text.row { fill: var(--ink2); font-size: 12px; font-variant-numeric: normal; }
.hit { fill: var(--grid); fill-opacity: 0; outline: none; }
.hit:hover, .hit:focus { fill-opacity: .55; }
.mark { pointer-events: none; }
.empty { color: var(--ink2); padding: 14px 0 10px; }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--ink2); font-size: 12.5px; width: fit-content; }
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 6px; }
th { color: var(--ink2); font-weight: 600; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
td.t { white-space: normal; min-width: 140px; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
.tip { position: fixed; display: none; pointer-events: none; background: var(--surface); color: var(--ink); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18); font-size: 12.5px; z-index: 10; max-width: 300px; }
.tip .tt { color: var(--ink2); margin-bottom: 3px; }
.tip .tr { display: flex; align-items: center; gap: 8px; }
.tip b { font-weight: 650; }
.tip span { color: var(--ink2); }
.tip .key { width: 12px; height: 2px; border-radius: 1px; flex: none; }
footer { color: var(--muted); font-size: 12px; margin-top: 20px; }
`;

  // Page du rapport : cette fonction est recopiée telle quelle dans le fichier téléchargé et s'y exécute (pas dans le bot).
  // Elle ne dépend que de ses données d. Les noms de cartes passent par textContent.
  function reportPage(d) {
    const app = document.getElementById('app');
    const fr = n => Math.round(n).toLocaleString('fr-FR');
    const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fr(Math.abs(n));
    const hm = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const dm = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const dur = ms => { const s = Math.max(1, Math.round(ms / 1000)), m = Math.round(s / 60); return s < 60 ? s + ' s' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
    const nb = (n, one, many) => fr(n) + ' ' + (n > 1 ? many : one);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
    const H = d.hours, T1 = d.t0 + 25 * 3600000;
    const hourName = t => new Date(t).getHours() + ' h';
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

    // ── info-bulle : une seule, valeur en tête, libellé ensuite ; même contenu au clavier (Tab) qu'à la souris ──
    const tip = el('div', 'tip');
    document.body.append(tip);
    function showTip(ev, title, rows) {
      tip.replaceChildren(el('div', 'tt', title), ...rows.map(([v, label, color]) => {
        const r = el('div', 'tr');
        if (color) { const k = el('i', 'key'); k.style.background = color; r.append(k); }
        r.append(el('b', null, v), el('span', null, label));
        return r;
      }));
      tip.style.display = 'block';
      let x = ev.clientX, y = ev.clientY;
      if (x == null || ev.type === 'focus') { const b = ev.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 14)) + 'px';
      tip.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + 'px';
    }
    const hideTip = () => { tip.style.display = 'none'; };
    function hover(node, fn, leave) {
      node.setAttribute('tabindex', '0');
      node.addEventListener('pointermove', fn);
      node.addEventListener('focus', fn);
      node.addEventListener('pointerleave', () => { hideTip(); if (leave) leave(); });
      node.addEventListener('blur', () => { hideTip(); if (leave) leave(); });
    }

    // ── SVG ──
    const NS = 'http://www.w3.org/2000/svg';
    const svg = (w, h) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', w); s.setAttribute('height', h); s.setAttribute('viewBox', `0 0 ${w} ${h}`); return s; };
    const add = (p, tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = String(text); p.append(n); return n; };
    function nice(lo, hi, minStep) {
      if (hi - lo < 1e-9) hi = lo + Math.max(1, minStep);
      const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
      const step = Math.max(minStep, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag);
      return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
    }
    // colonne : 4 px arrondis au bout, carrée sur la ligne de base
    const colPath = (x, w, yTop, yBase) => { const r = Math.min(4, w / 2, yBase - yTop); return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`; };
    // barre horizontale : arrondie au bout, du côté de la valeur
    const barPath = (x0, x1, y, h) => {
      const r = Math.min(4, h / 2, Math.abs(x1 - x0)), s = x1 >= x0 ? 1 : -1;
      return `M${x0},${y}H${x1 - s * r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - s * r},${y + h}H${x0}Z`;
    };
    // axe du temps commun aux trois graphiques horaires (même marge gauche : ils se lisent l'un sous l'autre)
    const ML = 64, MR = 16;
    function timeAxis(s, W, yBase, h) {
      const X = t => ML + (t - d.t0) / (T1 - d.t0) * (W - ML - MR);
      const every = W < 560 ? 6 : 3;
      for (let i = 0; i <= 25; i++) {
        const t = d.t0 + i * 3600000, hr = new Date(t).getHours();
        if (hr % every || i === 25) continue;
        add(s, 'text', { x: X(t), y: h - 6, 'text-anchor': 'middle' }, hr === 0 ? dm(t) : hourName(t));
      }
      add(s, 'line', { x1: ML, x2: W - MR, y1: yBase, y2: yBase, stroke: 'var(--axis)', 'shape-rendering': 'crispEdges' });
      return X;
    }
    function yGrid(s, W, sc, Y, fmt) {
      for (let v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
        if (Math.abs(v) > 1e-9) add(s, 'line', { x1: ML, x2: W - MR, y1: Y(v), y2: Y(v), stroke: 'var(--grid)', 'shape-rendering': 'crispEdges' });
        add(s, 'text', { x: ML - 8, y: Y(v) + 4, 'text-anchor': 'end' }, fmt(v));
      }
    }
    function table(head, rows, numeric) {
      const w = el('div', 'tablewrap'), t = el('table'), tr = el('tr');
      head.forEach((h, i) => tr.append(el('th', numeric.includes(i) ? 'n' : null, h)));
      t.append(tr);
      rows.forEach(r => { const row = el('tr'); r.forEach((c, i) => row.append(el('td', numeric.includes(i) ? 'n' : i === 1 ? 't' : null, c))); t.append(row); });
      w.append(t);
      return w;
    }
    function dataView(head, rows, numeric = [], label = 'Voir les données') {
      const det = el('details'); det.append(el('summary', null, label), table(head, rows, numeric));
      return det;
    }
    function card(title, note) {
      const c = el('section', 'card'); c.append(el('h2', null, title));
      if (note) c.append(el('p', 'note', note));
      return c;
    }
    function legend(items) {
      const l = el('div', 'legend');
      items.forEach(([label, color, shape]) => { const s = el('span'); const i = el('i', shape || null); i.style.background = color; s.append(i, document.createTextNode(label)); l.append(s); });
      return l;
    }
    const charts = [];   // [boîte, fonction de dessin] : redessinés à la largeur de la boîte
    function chartBox(parent, draw) { const b = el('div', 'chart'); parent.append(b); charts.push([b, draw]); return b; }

    // ── chiffres ──
    const profit = sum(d.sales, s => s.profit), spent = sum(d.buys, b => b.price), cashed = sum(d.sales, s => s.sale);
    const blockedMs = sum(d.blocks, b => Math.min(b.end, d.now) - Math.max(b.start, d.since));
    const clicksOk = d.clicks.filter(c => c.ok).length;

    // ── en-tête ──
    app.append(el('h1', null, 'WikiMasters Bot · 24 dernières heures'));
    app.append(el('p', 'sub', `Du ${dm(d.since)} à ${hm(d.since)} au ${dm(d.now)} à ${hm(d.now)} · version ${d.version}${d.dryRun ? ' · simulation' : ''}`));
    if (d.firstAt - d.since > 30 * 60000) {
      app.append(el('p', 'warnline', `Mises, achats, blocages et clics : historique disponible depuis ${hm(d.firstAt)} seulement (${dur(d.now - d.firstAt)}). Il se remplit au fil de l’eau : le rapport couvrira 24 h complètes un jour après l’installation de la version ${d.version}. Les reventes et le bénéfice couvrent déjà les 24 h.`));
    }

    // ── héros : le bénéfice ──
    const hero = el('section', 'card hero');
    hero.append(el('div', 'l', 'Bénéfice des reventes du trading'), el('div', 'v', signed(profit)),
      el('div', 's', d.sales.length ? `${nb(d.sales.length, 'revente', 'reventes')} · ${fr(cashed)} encaissés pour ${fr(cashed - profit)} d’achat` : 'Aucune revente sur la période'));
    app.append(hero);

    // ── tuiles ──
    const kpis = el('div', 'kpis');
    const tile = (l, v, s) => { const t = el('div', 'tile'); t.append(el('div', 'l', l), el('div', 'v', v), el('div', 's', s)); kpis.append(t); };
    tile('Cartes achetées', fr(d.buys.length), d.buys.length ? `${fr(spent)} dépensés` : 'aucune');
    tile('Cartes revendues', fr(d.sales.length), d.sales.length ? `${fr(cashed)} encaissés` : 'aucune');
    tile('Mises placées', fr(d.bids), d.lost ? `${nb(d.lost, 'enchère perdue', 'enchères perdues')} ou abandonnée${d.lost > 1 ? 's' : ''}` : 'aucune enchère perdue');
    tile('Bonnes affaires repérées', fr(d.deals), d.scans ? `en ${nb(d.scans, 'recherche', 'recherches')} (${Math.round(d.scanSecs / d.scans)} s en moyenne)` : 'aucune recherche');
    tile('⛔ Blocages anti-bot', fr(d.blocks.length), d.blocks.length ? `bloqué ${dur(blockedMs)} au total` : 'aucun');
    tile('Clics de l’extension', d.clicks.length ? `${fr(clicksOk)} / ${fr(d.clicks.length)}` : '0', d.clicks.length ? `${nb(clicksOk, 'réussi', 'réussis')}${d.gaveUp ? ` · ${nb(d.gaveUp, 'abandon', 'abandons')} après 3 essais` : ''}` : 'aucun clic');
    tile('Mises en vente', fr(d.listed), d.unsold ? nb(d.unsold, 'invendue', 'invendues') : 'aucune invendue');
    tile('Stock du trading', fr(d.stock.n), `${fr(d.stock.cost)} d’achat immobilisés`);
    tile('Paquets ouverts', fr(d.packs), d.discards ? `${nb(d.discards, 'défausse', 'défausses')}` : 'aucune défausse');
    tile('Tours relancés', fr(d.watchdog), d.watchdog ? 'par le garde-fou (tour trop long)' : 'aucun : le bot a tourné sans à-coup');
    app.append(kpis);

    // ── 1. bénéfice cumulé ──
    const c1 = card('Bénéfice cumulé', 'Somme des bénéfices des reventes, heure par heure.');
    chartBox(c1, (box, W) => {
      const h = 230, top = 14, base = h - 26;
      const pts = [[d.since, 0]];
      let cum = 0;
      H.forEach((x, i) => { cum += x.profit; pts.push([Math.min(d.now, x.start + 3600000), cum]); });
      const sc = nice(Math.min(0, ...pts.map(p => p[1])), Math.max(0, ...pts.map(p => p[1])), 1);
      const s = svg(W, h), Y = v => top + (sc.hi - v) / (sc.hi - sc.lo) * (base - top);
      yGrid(s, W, sc, Y, signed);
      const X = timeAxis(s, W, Y(0), h);
      const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      add(s, 'path', { class: 'mark', d: `${line}L${X(d.now)},${Y(0)}L${X(d.since)},${Y(0)}Z`, fill: 'var(--s1)', 'fill-opacity': 0.1 });
      add(s, 'path', { class: 'mark', d: line, fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      const last = pts[pts.length - 1];
      add(s, 'circle', { class: 'mark', cx: X(last[0]), cy: Y(last[1]), r: 4, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 });
      add(s, 'text', { class: 'lbl', x: X(last[0]) - 8, y: Y(last[1]) + (last[1] >= 0 ? -10 : 18), 'text-anchor': 'end' }, signed(last[1]));
      const cross = add(s, 'line', { class: 'mark', y1: top, y2: base, stroke: 'var(--muted)', visibility: 'hidden' });
      const dot = add(s, 'circle', { class: 'mark', r: 4, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
      const hit = add(s, 'rect', { class: 'hit', x: ML, y: top, width: W - ML - MR, height: base - top });
      hit.style.fillOpacity = 0;                           // ici le survol se voit au réticule, pas à un fond
      hover(hit, ev => {
        let i = H.length;
        if (ev.type !== 'focus' && ev.clientX != null) {
          const b = s.getBoundingClientRect(), t = d.t0 + (ev.clientX - b.left - ML) / (W - ML - MR) * (T1 - d.t0);
          i = Math.max(1, Math.min(H.length, Math.round((t - d.t0) / 3600000)));
        }
        const [t, v] = pts[i], hr = H[i - 1];
        cross.setAttribute('x1', X(t)); cross.setAttribute('x2', X(t)); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', X(t)); dot.setAttribute('cy', Y(v)); dot.setAttribute('visibility', 'visible');
        showTip(ev, `${hourName(hr.start)} → ${t >= d.now ? 'maintenant' : hourName(t)}`, [[signed(v), 'cumulé', 'var(--s1)'], [signed(hr.profit), `dans l’heure · ${nb(hr.sold, 'revente', 'reventes')}`]]);
      }, () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
      box.replaceChildren(s);
    });
    c1.append(dataView(['Heure', 'Reventes', 'Bénéfice', 'Cumulé'], (() => { let c = 0; return H.map(x => [hourName(x.start), fr(x.sold), signed(x.profit), signed(c += x.profit)]); })(), [1, 2, 3]));
    app.append(c1);

    // ── 2. achats et reventes par heure ──
    const c2 = card('Achats et reventes par heure', 'Cartes gagnées aux enchères (toutes origines) et cartes du trading revendues.');
    c2.append(legend([['Achats', 'var(--s1)'], ['Reventes', 'var(--s2)']]));
    chartBox(c2, (box, W) => {
      const h = 210, top = 10, base = h - 26;
      const sc = nice(0, Math.max(1, ...H.map(x => Math.max(x.bought, x.sold))), 1);
      const s = svg(W, h), Y = v => top + (sc.hi - v) / (sc.hi - sc.lo) * (base - top);
      yGrid(s, W, sc, Y, fr);
      const X = timeAxis(s, W, base, h), slotW = X(d.t0 + 3600000) - X(d.t0);
      const bw = Math.max(2, Math.min(24, (slotW - 6) / 2));
      H.forEach(x => {
        const x0 = X(x.start), hit = add(s, 'rect', { class: 'hit', x: x0, y: top, width: slotW, height: base - top });
        const mid = x0 + slotW / 2;
        if (x.bought) add(s, 'path', { class: 'mark', d: colPath(mid - 1 - bw, bw, Y(x.bought), base), fill: 'var(--s1)' });
        if (x.sold) add(s, 'path', { class: 'mark', d: colPath(mid + 1, bw, Y(x.sold), base), fill: 'var(--s2)' });
        hover(hit, ev => showTip(ev, `${hourName(x.start)} → ${hourName(x.start + 3600000)}`, [
          [fr(x.bought), `${x.bought > 1 ? 'achats' : 'achat'} · ${fr(x.spent)} dépensés`, 'var(--s1)'],
          [fr(x.sold), `${x.sold > 1 ? 'reventes' : 'revente'} · bénéfice ${signed(x.profit)}`, 'var(--s2)']]));
      });
      box.replaceChildren(s);
    });
    c2.append(dataView(['Heure', 'Achats', 'Dépensé', 'Reventes', 'Bénéfice'], H.map(x => [hourName(x.start), fr(x.bought), fr(x.spent), fr(x.sold), signed(x.profit)]), [1, 2, 3, 4]));
    app.append(c2);

    // ── 3. blocages et clics ──
    const c3 = card('⛔ Blocages anti-bot et clics de l’extension', d.blocks.length
      ? `${nb(d.blocks.length, 'blocage', 'blocages')}, ${dur(blockedMs)} bloqué au total · ${nb(clicksOk, 'clic réussi', 'clics réussis')} sur ${fr(d.clicks.length)}.`
      : 'Aucun blocage du site sur la période.');
    const acts = ['Enchères', 'Ventes', 'Paquets', 'Mises', 'Mises en vente'].filter(a => d.blocks.some(b => b.what === a));
    d.blocks.forEach(b => { if (!acts.includes(b.what)) acts.push(b.what); });
    if (d.blocks.length || d.clicks.length) {
      c3.append(legend([['Bloqué', 'var(--critical)'], ['Clic réussi', 'var(--s1)', 'dot'], ['Clic sans effet', 'var(--s1)', 'ring']]));
      chartBox(c3, (box, W) => {
        const rows = [...acts, ...(d.clicks.length ? ['Clics'] : [])], rowH = 30, top = 6, h = top + rows.length * rowH + 26, base = top + rows.length * rowH;
        const s = svg(W, h), X = timeAxis(s, W, base, h);
        rows.forEach((r, i) => {
          if (i) add(s, 'line', { x1: ML, x2: W - MR, y1: top + i * rowH, y2: top + i * rowH, stroke: 'var(--grid)', 'shape-rendering': 'crispEdges' });
          add(s, 'text', { class: 'row', x: ML - 8, y: top + i * rowH + rowH / 2 + 4, 'text-anchor': 'end' }, r);
        });
        d.blocks.forEach(b => {
          const i = acts.indexOf(b.what), y = top + i * rowH + 8, x0 = X(Math.max(b.start, d.since)), x1 = Math.max(x0 + 3, X(Math.min(b.end, d.now)));
          const hit = add(s, 'rect', { class: 'hit', x: x0 - 6, y: top + i * rowH, width: x1 - x0 + 12, height: rowH });
          add(s, 'rect', { class: 'mark', x: x0, y, width: x1 - x0, height: rowH - 16, rx: 2, fill: 'var(--critical)' });
          hover(hit, ev => showTip(ev, `⛔ ${b.what} bloquées`, [[`${hm(b.start)} → ${b.open ? 'maintenant' : hm(b.end)}`, ''], [dur(b.end - b.start), 'bloqué'],
            [b.open ? 'toujours bloqué' : b.how || '?', b.open ? '' : 'a débloqué']]));
        });
        const cy = top + acts.length * rowH + rowH / 2;
        d.clicks.forEach(c => {
          const x = X(c.t), hit = add(s, 'rect', { class: 'hit', x: x - 12, y: cy - 12, width: 24, height: 24 });
          add(s, 'circle', { class: 'mark', cx: x, cy, r: c.ok ? 4 : 3.5, fill: c.ok ? 'var(--s1)' : 'var(--surface)', stroke: c.ok ? 'var(--surface)' : 'var(--s1)', 'stroke-width': 2 });
          hover(hit, ev => showTip(ev, `Clic de l’extension · ${hm(c.t)}`, [[c.ok ? (c.human ? 'fait, case à cocher' : 'réussi') : 'sans effet', c.msg]]));
        });
        box.replaceChildren(s);
      });
      c3.append(dataView(['Activité', 'Début', 'Fin', 'Durée', 'Débloqué par'], d.blocks.map(b => [b.what, `${dm(b.start)} ${hm(b.start)}`, b.open ? 'en cours' : hm(b.end), dur(b.end - b.start), b.open ? '—' : b.how || '?']), [3], 'Voir la liste des blocages'));
    } else c3.append(el('p', 'empty', '✓ Rien à signaler.'));
    app.append(c3);

    // ── 4 et 5. origine des achats, bénéfice par rareté ──
    const two = el('div', 'two');
    const c4 = card('Achats par origine', 'Nombre de cartes gagnées et prix payé.');
    const byOrigin = {};
    d.buys.forEach(b => { const o = byOrigin[b.origin] || (byOrigin[b.origin] = { n: 0, spent: 0 }); o.n++; o.spent += b.price; });
    const origins = Object.entries(byOrigin).sort((a, b) => b[1].n - a[1].n);
    if (origins.length) {
      chartBox(c4, (box, W) => {
        const rowH = 32, h = origins.length * rowH + 4, L = 110, R = 90, max = Math.max(...origins.map(o => o[1].n));
        const s = svg(W, h), X = v => L + v / max * (W - L - R);
        origins.forEach(([name, o], i) => {
          const y = i * rowH + 8, hit = add(s, 'rect', { class: 'hit', x: 0, y: i * rowH, width: W, height: rowH });
          add(s, 'text', { class: 'row', x: L - 10, y: y + 12, 'text-anchor': 'end' }, name);
          add(s, 'path', { class: 'mark', d: barPath(L, X(o.n), y, 16), fill: 'var(--s1)' });
          add(s, 'text', { class: 'lbl', x: X(o.n) + 8, y: y + 12 }, `${fr(o.n)} · ${fr(o.spent)}`);
          hover(hit, ev => showTip(ev, name, [[fr(o.n), o.n > 1 ? 'cartes' : 'carte', 'var(--s1)'], [fr(o.spent), 'dépensés'], [fr(o.spent / o.n), 'en moyenne']]));
        });
        box.replaceChildren(s);
      });
      c4.append(dataView(['Origine', 'Cartes', 'Dépensé'], origins.map(([n, o]) => [n, fr(o.n), fr(o.spent)]), [1, 2]));
    } else c4.append(el('p', 'empty', 'Aucun achat sur la période.'));
    two.append(c4);

    const c5 = card('Bénéfice par rareté', 'Reventes du trading : prix de revente moins prix d’achat.');
    const RAR = ['L', 'UR', 'SR', 'R', 'PC', 'C'], byR = {};
    d.sales.forEach(x => { const r = byR[x.rarity] || (byR[x.rarity] = { n: 0, profit: 0 }); r.n++; r.profit += x.profit; });
    const rars = Object.entries(byR).sort((a, b) => (RAR.indexOf(a[0]) + 99) % 99 - (RAR.indexOf(b[0]) + 99) % 99);
    if (rars.length) {
      chartBox(c5, (box, W) => {
        const rowH = 32, h = rars.length * rowH + 4, L = 44, R = 96;
        const lo = Math.min(0, ...rars.map(r => r[1].profit)), hi = Math.max(0, ...rars.map(r => r[1].profit)), span = hi - lo || 1;
        const s = svg(W, h), X = v => L + (v - lo) / span * (W - L - R);
        add(s, 'line', { x1: X(0), x2: X(0), y1: 0, y2: h, stroke: 'var(--axis)', 'shape-rendering': 'crispEdges' });
        rars.forEach(([r, o], i) => {
          const y = i * rowH + 8, hit = add(s, 'rect', { class: 'hit', x: 0, y: i * rowH, width: W, height: rowH }), pos = o.profit >= 0;
          add(s, 'text', { class: 'row', x: L - 10, y: y + 12, 'text-anchor': 'end' }, r);
          if (o.profit) add(s, 'path', { class: 'mark', d: barPath(X(0), X(o.profit), y, 16), fill: pos ? 'var(--s1)' : 'var(--neg)' });
          add(s, 'text', { class: 'lbl', x: pos ? X(o.profit) + 8 : X(0) + 8, y: y + 12 }, `${signed(o.profit)} · ${nb(o.n, 'vente', 'ventes')}`);
          hover(hit, ev => showTip(ev, `Rareté ${r}`, [[signed(o.profit), 'bénéfice', pos ? 'var(--s1)' : 'var(--neg)'], [fr(o.n), o.n > 1 ? 'reventes' : 'revente'], [signed(o.profit / o.n), 'par carte']]));
        });
        box.replaceChildren(s);
      });
      c5.append(dataView(['Rareté', 'Reventes', 'Bénéfice'], rars.map(([r, o]) => [r, fr(o.n), signed(o.profit)]), [1, 2]));
    } else c5.append(el('p', 'empty', 'Aucune revente sur la période.'));
    two.append(c5);
    app.append(two);

    // ── tableaux ──
    const c6 = card('Meilleures reventes', d.sales.length > 10 ? `Les 10 meilleures sur ${fr(d.sales.length)}.` : null);
    if (d.sales.length) c6.append(table(['Heure', 'Carte', 'Rareté', 'Achat', 'Revente', 'Bénéfice'],
      [...d.sales].sort((a, b) => b.profit - a.profit).slice(0, 10).map(x => [hm(x.t), x.title, x.rarity, fr(x.cost), fr(x.sale), signed(x.profit)]), [3, 4, 5]));
    else c6.append(el('p', 'empty', 'Aucune revente sur la période.'));
    const c7 = card('Cartes achetées', d.buys.length > 40 ? `Les 40 plus récentes sur ${fr(d.buys.length)}.` : null);
    if (d.buys.length) c7.append(table(['Heure', 'Carte', 'Rareté', 'Prix', 'Origine'],
      [...d.buys].reverse().slice(0, 40).map(b => [hm(b.t), b.title, b.rarity, fr(b.price), b.origin]), [3]));
    else c7.append(el('p', 'empty', 'Aucun achat sur la période.'));
    app.append(c6, c7);
    app.append(el('footer', null, `Rapport généré le ${dm(d.now)} à ${hm(d.now)} par WikiMasters Bot ${d.version}. Survole ou parcours au clavier (Tab) les graphiques pour le détail ; « Voir les données » donne les chiffres de chaque graphique.`));

    // ── dessin à la largeur réelle, et de nouveau quand la fenêtre change de taille ──
    const drawAll = () => charts.forEach(([box, draw]) => draw(box, Math.max(280, box.clientWidth)));
    drawAll();
    let raf = 0;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { hideTip(); drawAll(); }); });
  }

  function exportReport() {
    const data = JSON.stringify(reportData()).replace(/</g, '\\u003c');
    const end = '<' + '/script>';
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WikiMasters Bot · 24 h</title><style>${REPORT_CSS}</style></head><body><main id="app"></main>
<script>(${reportPage.toString()})(${data});${end}</body></html>`;
    const p = n => String(n).padStart(2, '0'), t = new Date();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `wikimasters-rapport-24h-${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}h${p(t.getMinutes())}.html`;
    a.click();
  }

  window.__wmbot = { start, stop, get config() { return config; }, estimateValue, scanTrading, scanWishlist, sellAndSort, evaluatePackCards, competition, resaleRate, resellPrice, sellPrice, sellTick, tradeSummary, tradeWatchdog, exportJournal, stockCounts, tradeStock, get watch() { return watch; }, snipeTick, endGuardTick, get debug() { return { workerTicks, clockOffset, snipeBusy, win: snipeWindowMs() }; }, makeShareCode, readShareCode, importSettings, flatten, stripPersonal, refreshOwned, recommendDemand, demandValues, tagTick, applyTag, reportData, exportReport };
  if (load(K.running, false)) start(); else ui.onStatus();
})();
