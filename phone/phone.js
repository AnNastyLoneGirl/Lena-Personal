(() => {
  const pages = [...document.querySelectorAll("[data-page]")];
  const openButtons = [...document.querySelectorAll("[data-open]")];
  const backButton = document.getElementById("navBack");
  const langButtons = [...document.querySelectorAll("[data-lang]")];

  let currentPage = "home";
  let currentLang = localStorage.getItem("lena-phone-lang") || "en-en";

  const parentFor = {
    home: "home",
    gallery: "home",
    photo: "gallery",
    messages: "home",
    settings: "home"
  };

  function showPage(name) {
    currentPage = name;
    pages.forEach(page => page.classList.toggle("active", page.dataset.page === name));
  }

  openButtons.forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.open));
  });

  backButton.addEventListener("click", () => {
    showPage(parentFor[currentPage] || "home");
  });

  async function loadLocale(lang) {
    try {
      const response = await fetch(`./locales/${lang}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dictionary = await response.json();

      document.querySelectorAll("[data-i18n]").forEach(node => {
        const key = node.dataset.i18n;
        const value = key.split(".").reduce((obj, part) => obj && obj[part], dictionary);
        if (typeof value === "string") node.textContent = value;
      });

      currentLang = lang;
      localStorage.setItem("lena-phone-lang", lang);
      document.documentElement.lang = lang.startsWith("fr") ? "fr" : "en";
      langButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.lang === lang));
    } catch (error) {
      console.error("Locale load failed:", error);
    }
  }

  langButtons.forEach(button => {
    button.addEventListener("click", () => loadLocale(button.dataset.lang));
  });

  loadLocale(currentLang);
})();
