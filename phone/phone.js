(() => {
  'use strict';

  const root = document.getElementById('nt-phone-v20');
  if (!root) return;

  // ---------- Internationalization ----------
  const localeCache = new Map();
  let currentLanguage = 'en';

  async function loadLocale(language) {
    const lang = language === 'fr' ? 'fr' : 'en';
    if (localeCache.has(lang)) return localeCache.get(lang);

    const response = await fetch(`./locales/${lang}.json`, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Unable to load locale ${lang}: HTTP ${response.status}`);
    }

    const dictionary = await response.json();
    localeCache.set(lang, dictionary);
    return dictionary;
  }

  function lookup(dictionary, key) {
    return key.split('.').reduce((value, part) => value?.[part], dictionary);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function updateLocalizedDate(language = currentLanguage) {
    const now = new Date();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const yyyy = now.getFullYear();
    const value = language === 'fr'
      ? `${dd}/${mm}/${yyyy}`
      : `${mm}/${dd}/${yyyy}`;

    document.querySelectorAll('[data-lena-date]').forEach(el => {
      el.textContent = value;
    });
  }

  async function applyLanguage(language) {
    const lang = language === 'fr' ? 'fr' : 'en';
    currentLanguage = lang;
    document.documentElement.lang = lang;

    try {
      const dictionary = await loadLocale(lang);
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const translated = lookup(dictionary, key);
        if (typeof translated === 'string') {
          el.textContent = translated;
        } else {
          console.warn(`[Lena Phone] Missing translation: ${lang}.${key}`);
        }
      });
    } catch (error) {
      console.error('[Lena Phone] Translation load failed.', error);
    }

    updateLocalizedDate(lang);
  }

  // ---------- Live date / clock ----------
  function initializeClock() {
    const now = new Date();
    root.classList.remove(
      ...[...root.classList].filter(x => /^h\d\d$|^m\d\d$|^s\d\d$/.test(x))
    );
    root.classList.add(`h${pad(now.getHours())}`, `m${pad(now.getMinutes())}`, `s${pad(now.getSeconds())}`);
    updateLocalizedDate(currentLanguage);
  }

  initializeClock();
  applyLanguage('en');

  // ---------- NastyBridge sandbox protocol ----------
  const bridge = {
    session: null,
    token: null,
    request: 0,
    pending: new Map(),
    capabilities: new Set(),
    ready: false,
  };

  let persistedUnlocked = false;

  function request(action, payload = {}) {
    if (!bridge.ready) return Promise.reject(new Error('NastyBridge is not ready.'));
    if (action !== 'frame.resize' && !bridge.capabilities.has(action)) {
      return Promise.reject(new Error(`Capability not granted: ${action}`));
    }

    const requestId = `lena-${++bridge.request}`;
    return new Promise((resolve, reject) => {
      bridge.pending.set(requestId, { resolve, reject });

      parent.postMessage({
        channel: 'nastybridge',
        version: 1,
        type: 'request',
        session: bridge.session,
        token: bridge.token,
        requestId,
        action,
        payload,
      }, '*');

      setTimeout(() => {
        const pending = bridge.pending.get(requestId);
        if (!pending) return;
        bridge.pending.delete(requestId);
        reject(new Error('NastyBridge request timed out.'));
      }, 5000);
    });
  }

  async function readState(key) {
    try {
      return await request('state.read', { key });
    } catch {
      return undefined;
    }
  }

  async function writeState(key, value, type = 'string') {
    try {
      return await request('state.write', {
        key,
        value: type === 'boolean' ? String(Boolean(value)) : String(value ?? ''),
        type,
      });
    } catch {
      return undefined;
    }
  }

  function checkRadio(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function restoreUnlockedPhone() {
    persistedUnlocked = true;

    // Once the correct PIN has been entered once, the phone is considered
    // trusted for this SillyTavern chat. Reopening/reloading skips the lock.
    checkRadio('nt20-home');
    root.classList.add('nt-phone-trusted');
  }


  function setMayaThreadRead(isRead = true) {
    document.querySelectorAll('[data-lena-unread="maya"]').forEach(badge => {
      badge.classList.toggle('is-read', Boolean(isRead));
      badge.setAttribute('aria-hidden', isRead ? 'true' : 'false');
    });
  }

  async function restoreBridgeState() {
    const unlocked = await readState('phone_unlocked');
    const wasUnlocked = unlocked === true || unlocked === 'true' || unlocked === 1 || unlocked === '1';

    const language = await readState('language');
    if (language === 'fr') {
      checkRadio('nt20-lang-fr');
      await applyLanguage('fr');
    } else {
      checkRadio('nt20-lang-en');
      await applyLanguage('en');
    }

    if (wasUnlocked) {
      restoreUnlockedPhone();
    }

    const mayaOpened = await readState('maya_thread_opened');
    const mayaWasOpened =
      mayaOpened === true || mayaOpened === 'true' || mayaOpened === 1 || mayaOpened === '1';
    setMayaThreadRead(mayaWasOpened);

    try {
      await request('frame.resize', { height: 750 });
    } catch {
      // The phone still works when opened outside NastyBridge or when resize is unavailable.
    }
  }

  addEventListener('message', event => {
    const data = event.data;
    if (!data || data.channel !== 'nastybridge' || data.version !== 1) return;

    if (data.type === 'hello') {
      bridge.session = data.session;
      bridge.token = data.token;
      bridge.capabilities = new Set(data.capabilities || []);
      bridge.ready = true;
      restoreBridgeState();
      return;
    }

    if (
      data.type === 'response' &&
      data.session === bridge.session &&
      data.token === bridge.token
    ) {
      const pending = bridge.pending.get(data.requestId);
      if (!pending) return;

      bridge.pending.delete(data.requestId);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.error || 'NastyBridge error'));
    }
  });

  // ---------- Phone progress ----------
  // Language preference.
  document.addEventListener('change', event => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;

    if (el.name === 'nt20lang' && el.checked) {
      const language = el.id === 'nt20-lang-fr' ? 'fr' : 'en';
      applyLanguage(language);
      writeState('language', language);
    }
  });

  // The final correct PIN key is the "0" label in pin stage 3.
  const unlockKey = document.querySelector('.pin-stage.pin-s3 label[for="nt20-home"]');
  unlockKey?.addEventListener('click', () => {
    restoreUnlockedPhone();
    writeState('phone_unlocked', true, 'boolean');
  });

  // If the PIN was already solved in this chat, powering the phone on goes straight home.
  const powerButton = document.querySelector('.power-button');
  powerButton?.addEventListener('click', event => {
    const off = document.getElementById('nt20-off');
    if (!persistedUnlocked || !off?.checked) return;

    event.preventDefault();
    event.stopPropagation();
    restoreUnlockedPhone();
  }, true);

  // Story/progress markers for later card logic.
  document.querySelectorAll('label[for="nt20-maya"]').forEach(el => {
    el.addEventListener('click', () => {
      // Clear the unread badge immediately, then persist it for future reloads.
      setMayaThreadRead(true);
      writeState('maya_thread_opened', true, 'boolean');
    });
  });

  const progressTargets = [
    ['label[for="nt20-photo1"]', 'photo1_opened'],
    ['label[for="nt20-notes"]', 'notes_opened'],
    ['label[for="nt20-recording1"]', 'recording_opened'],
  ];

  for (const [selector, key] of progressTargets) {
    document.querySelectorAll(selector).forEach(el => {
      el.addEventListener('click', () => writeState(key, true, 'boolean'));
    });
  }
})();
