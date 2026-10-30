(function () {
  if (window.__amayaGlassLoaded) {
    if (window.__amayaApplyInsets) window.__amayaApplyInsets();
    return;
  }
  window.__amayaGlassLoaded = true;

  var root = document.documentElement;
  var updateReady = false;
  var checking = false;
  var chip = null;
  var menu = null;
  var toast = null;
  var toastTimer = null;

  function make(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function ensureAurora() {
    if (document.getElementById("amaya-aurora")) return;
    var aurora = make("div");
    aurora.id = "amaya-aurora";
    aurora.innerHTML = '<span class="a1"></span><span class="a2"></span><span class="a3"></span><span class="a4"></span>';
    document.body.insertBefore(aurora, document.body.firstChild);
  }

  function applyInsets() {
    var insets = window.__AMAYA_INSETS || { top: 0, bottom: 0 };
    root.style.setProperty("--amaya-top", (insets.top || 0) + "px");
    root.style.setProperty("--amaya-bottom", (insets.bottom || 0) + "px");
    var pull = document.getElementById("amaya-pull");
    if (pull) pull.style.top = "calc(" + (insets.top || 0) + "px + 10px)";
  }
  window.__amayaApplyInsets = applyInsets;
  applyInsets();

  function ensureMenu() {
    if (menu && menu.isConnected) return menu;
    var host = document.querySelector(".topbar-right");
    if (!host) return null;
    menu = make("button", "amaya-menu", "<span></span><span></span><span></span>");
    menu.type = "button";
    menu.title = "Open navigation";
    menu.setAttribute("aria-label", "Open navigation");
    menu.addEventListener("click", function () {
      var trigger = document.querySelector(".mobile-menu");
      if (trigger) trigger.click();
    });
    host.insertBefore(menu, host.firstChild);
    return menu;
  }

  function ensureChip() {
    ensureMenu();
    if (chip && chip.isConnected) return chip;
    var host = document.querySelector(".topbar-right") || document.querySelector(".topbar");
    if (!host) return null;
    chip = make("button", "amaya-live", "<i></i><b>LIVE</b>");
    chip.type = "button";
    chip.title = "Live-synced with abraar05.github.io";
    chip.addEventListener("click", function () {
      if (updateReady) {
        location.reload();
        return;
      }
      checkForUpdate(true);
    });
    if (host.classList.contains("topbar-right")) {
      host.insertBefore(chip, host.firstChild);
    } else {
      host.appendChild(chip);
    }
    refreshOnline();
    return chip;
  }

  function setChip(state, label) {
    var node = ensureChip();
    if (!node) return;
    node.setAttribute("data-state", state);
    var labelNode = node.querySelector("b");
    if (labelNode) labelNode.textContent = label || "LIVE";
  }

  function showToast(message, action, duration, onAction) {
    if (!toast) {
      toast = make("div");
      toast.id = "amaya-toast";
      document.body.appendChild(toast);
    }
    toast.innerHTML = "";
    var text = make("span");
    text.textContent = message;
    toast.appendChild(text);
    if (action) {
      var button = make("button");
      button.type = "button";
      button.textContent = action;
      button.addEventListener("click", function () {
        hideToast();
        if (onAction) onAction();
      });
      toast.appendChild(button);
    }
    toast.classList.add("show");
    clearTimeout(toastTimer);
    if (duration !== 0) {
      toastTimer = setTimeout(hideToast, duration || 2600);
    }
  }

  function hideToast() {
    if (toast) toast.classList.remove("show");
  }

  function refreshOnline() {
    if (updateReady) {
      setChip("update", "UPDATE");
      return;
    }
    if (navigator.onLine) {
      setChip("live", "LIVE");
    } else {
      setChip("offline", "OFFLINE");
    }
  }
  window.__amayaRefreshOnline = refreshOnline;

  var ASSET_SELECTOR = 'script[src*="/assets/"],link[rel="stylesheet"][href*="/assets/"]';

  function signatureFromRoot(root) {
    var nodes = root.querySelectorAll(ASSET_SELECTOR);
    var names = [];
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].getAttribute("src") || nodes[i].getAttribute("href") || "";
      if (value) names.push(value.replace(/^.*\//, "").split("?")[0]);
    }
    return names.sort().join("|");
  }

  function assetSignatureFromDocument() {
    return signatureFromRoot(document);
  }

  function assetSignatureFromHtml(html) {
    try {
      return signatureFromRoot(new DOMParser().parseFromString(html, "text/html"));
    } catch (e) {
      return "";
    }
  }

  function flagUpdate(message) {
    var wasReady = updateReady;
    updateReady = true;
    setChip("update", "UPDATE");
    if (wasReady) return;
    showToast(message, "Sync now", 0, function () {
      location.reload();
    });
  }

  var currentSignature = assetSignatureFromDocument();

  function checkForUpdate(manual) {
    if (checking) return;
    if (!navigator.onLine) {
      setChip("offline", "OFFLINE");
      if (manual) showToast("Offline · reconnect to check for a new build", null, 2600);
      return;
    }
    checking = true;
    setChip("syncing", "SYNC");
    fetch(location.origin + "/index.html?amaya=" + Date.now(), {
      cache: "reload",
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.text();
    }).then(function (html) {
      var nextSignature = assetSignatureFromHtml(html);
      if (currentSignature && nextSignature && nextSignature !== currentSignature) {
        flagUpdate("A new live build is available");
      } else if (!updateReady) {
        setChip("live", "LIVE");
        if (chip) {
          chip.title = "Live-synced · checked " + new Date().toLocaleTimeString();
        }
        if (manual) showToast("You are on the latest live build", null, 2000);
      }
    }).catch(function () {
      refreshOnline();
      if (manual) showToast("Could not reach the live site", null, 2400);
    }).then(function () {
      checking = false;
    });
  }

  function watchServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration().then(function (registration) {
      if (!registration) return;
      if (registration.waiting && navigator.serviceWorker.controller) {
        flagUpdate("A new live build is ready");
      }
      registration.addEventListener("updatefound", function () {
        var worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", function () {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            flagUpdate("A new live build is ready");
          }
        });
      });
      try {
        registration.update();
      } catch (e) {
      }
    }).catch(function () {
    });
  }

  window.__amayaSyncNow = function (reason) {
    refreshOnline();
    if (updateReady && reason === "resume") {
      showToast("Update ready", "Sync now", 0, function () {
        location.reload();
      });
      return;
    }
    checkForUpdate(false);
    watchServiceWorker();
  };

  window.addEventListener("online", function () {
    refreshOnline();
    showToast("Back online · syncing now", null, 2200);
    checkForUpdate(false);
  });

  window.addEventListener("offline", function () {
    refreshOnline();
    showToast("Offline · showing the last synced snapshot", null, 2600);
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      refreshOnline();
      checkForUpdate(false);
    }
  });

  setInterval(function () {
    if (!document.hidden) {
      refreshOnline();
      checkForUpdate(false);
      watchServiceWorker();
    }
  }, 120000);

  var pull = make("div", "", '<span class="amaya-pull-ring"></span><b>Pull to sync</b>');
  pull.id = "amaya-pull";
  document.body.appendChild(pull);
  applyInsets();

  var startY = null;
  var pullDistance = 0;

  function isBlocked(target) {
    if (root.classList.contains("amaya-keyboard")) return true;
    if (target && target.closest && target.closest("input,textarea,select,button,a")) {
      return true;
    }
    if (document.querySelector(".drawer,.src-window,.modal-card,.tour-card,.lang-menu,.theme-panel,.lock-screen")) {
      return true;
    }
    var node = target;
    while (node && node !== document.body) {
      var style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
        if (node.scrollTop > 0) return true;
      }
      node = node.parentElement;
    }
    return (window.scrollY || document.documentElement.scrollTop || 0) > 0;
  }

  document.addEventListener("touchstart", function (event) {
    if (event.touches.length !== 1 || isBlocked(event.target)) {
      startY = null;
      return;
    }
    startY = event.touches[0].clientY;
    pullDistance = 0;
  }, { passive: true });

  document.addEventListener("touchmove", function (event) {
    if (startY == null || event.touches.length !== 1) return;
    var delta = event.touches[0].clientY - startY;
    if (delta <= 0 || (window.scrollY || document.documentElement.scrollTop || 0) > 0) {
      pull.classList.remove("show", "armed");
      pull.style.transform = "";
      pullDistance = 0;
      return;
    }
    pullDistance = Math.min(delta * 0.55, 108);
    pull.classList.add("show");
    pull.classList.toggle("armed", pullDistance > 72);
    pull.style.transform = "translate(-50%, " + pullDistance + "px)";
    var label = pull.querySelector("b");
    if (label) label.textContent = pullDistance > 72 ? "Release to sync" : "Pull to sync";
  }, { passive: true });

  function endPull() {
    if (startY == null) return;
    var armed = pullDistance > 72;
    startY = null;
    pullDistance = 0;
    if (armed) {
      pull.classList.add("syncing");
      var label = pull.querySelector("b");
      if (label) label.textContent = "Syncing…";
      setTimeout(function () {
        location.reload();
      }, 280);
    } else {
      pull.classList.remove("show", "armed", "syncing");
      pull.style.transform = "";
    }
  }

  document.addEventListener("touchend", endPull, { passive: true });
  document.addEventListener("touchcancel", endPull, { passive: true });

  var blobStore = new Map();
  var originalCreate = URL.createObjectURL;
  var originalRevoke = URL.revokeObjectURL;

  URL.createObjectURL = function (blob) {
    var url = originalCreate.call(URL, blob);
    try {
      blobStore.set(url, blob);
    } catch (e) {
    }
    return url;
  };

  URL.revokeObjectURL = function (url) {
    setTimeout(function () {
      try {
        originalRevoke.call(URL, url);
      } catch (e) {
      }
      blobStore.delete(url);
    }, 10000);
  };

  var nativeAnchorClick = window.HTMLAnchorElement && HTMLAnchorElement.prototype.click;
  if (nativeAnchorClick) {
    HTMLAnchorElement.prototype.click = function () {
      if (this.__amayaPass) {
        return nativeAnchorClick.apply(this, arguments);
      }
      if (this.hasAttribute("download") && /^(blob:|data:)/i.test(this.href || "")) {
        var blob = blobStore.get(this.href);
        if (blob) {
          saveViaAndroid(this.getAttribute("download") || "amaya-export", blob.type, blob);
          return;
        }
      }
      return nativeAnchorClick.apply(this, arguments);
    };
  }

  function guessMime(name, mime) {
    if (mime) return mime;
    if (/\.csv$/i.test(name)) return "text/csv";
    if (/\.tsv$/i.test(name)) return "text/tab-separated-values";
    if (/\.json$/i.test(name)) return "application/json";
    return "application/octet-stream";
  }

  function toBase64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(""));
  }

  function readBlob(blob, onDone, onError) {
    if (blob.arrayBuffer) {
      blob.arrayBuffer().then(function (buffer) {
        onDone(new Uint8Array(buffer));
      }).catch(onError);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      onDone(new Uint8Array(reader.result));
    };
    reader.onerror = onError;
    reader.readAsArrayBuffer(blob);
  }

  function saveViaAndroid(name, mime, blob) {
    readBlob(blob, function (bytes) {
      if (bytes.length > 96 * 1024 * 1024) {
        showToast("That export is too large for the in-app saver", null, 3000);
        return;
      }
      var base64 = toBase64(bytes);
      if (window.AmayaAndroid && window.AmayaAndroid.saveBlob) {
        window.AmayaAndroid.saveBlob(name, guessMime(name, mime), base64);
      } else {
        var link = document.createElement("a");
        link.__amayaPass = true;
        link.href = originalCreate.call(URL, blob);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        setTimeout(function () {
          document.body.removeChild(link);
        }, 1000);
      }
    }, function () {
      showToast("Could not prepare the export", null, 2600);
    });
  }

  document.addEventListener("click", function (event) {
    var node = event.target;
    while (node && node !== document && node.tagName !== "A") {
      node = node.parentElement;
    }
    if (!node || node.tagName !== "A" || node.__amayaPass) return;
    if (!node.hasAttribute("download")) return;
    var href = node.href || "";
    if (!/^(blob:|data:)/i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    var name = node.getAttribute("download") || "amaya-export";
    var blob = blobStore.get(href);
    if (blob) {
      saveViaAndroid(name, blob.type, blob);
      return;
    }
    fetch(href).then(function (response) {
      return response.blob();
    }).then(function (fetched) {
      saveViaAndroid(name, fetched.type, fetched);
    }).catch(function () {
      showToast("Could not prepare the export", null, 2600);
    });
  }, true);

  function syncBars() {
    var light = root.getAttribute("data-theme-light") === "true";
    if (window.AmayaAndroid && window.AmayaAndroid.setLightStatusBar) {
      try {
        window.AmayaAndroid.setLightStatusBar(light);
      } catch (e) {
      }
    }
  }

  new MutationObserver(syncBars).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme-light"]
  });
  syncBars();

  var baseHeight = Math.max(window.innerHeight || 0,
    window.visualViewport ? window.visualViewport.height : 0);

  function updateKeyboardState() {
    if (window.visualViewport && baseHeight) {
      var hidden = baseHeight - window.visualViewport.height;
      root.classList.toggle("amaya-keyboard", hidden > 140);
    }
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateKeyboardState);
  }

  window.addEventListener("orientationchange", function () {
    setTimeout(function () {
      baseHeight = Math.max(window.innerHeight || 0,
        window.visualViewport ? window.visualViewport.height : 0);
      updateKeyboardState();
    }, 350);
  });

  document.addEventListener("focusin", function (event) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName || "")) {
      root.classList.add("amaya-keyboard");
    }
  });

  document.addEventListener("focusout", function () {
    setTimeout(function () {
      if (!/^(INPUT|TEXTAREA)$/.test((document.activeElement && document.activeElement.tagName) || "")) {
        root.classList.remove("amaya-keyboard");
      }
    }, 90);
  });

  var chipScheduled = false;
  new MutationObserver(function () {
    if (chipScheduled) return;
    chipScheduled = true;
    requestAnimationFrame(function () {
      chipScheduled = false;
      ensureChip();
    });
  }).observe(document.body, { childList: true, subtree: true });

  ensureAurora();
  ensureChip();
  window.addEventListener("resize", function () {
    setTimeout(ensureChip, 80);
  });

  /* ===== Theme toggle ===== */
  var GLASS_THEMES = ["aurora", "midnight", "steel", "graphite", "paper", "solar"];
  var GLASS_THEME_LABELS = {
    aurora: "Aurora", midnight: "Midnight", steel: "Steel",
    graphite: "Graphite", paper: "Paper", solar: "Solar"
  };

  function applyGlassTheme(name) {
    if (GLASS_THEMES.indexOf(name) === -1) name = "aurora";
    root.setAttribute("data-glass-theme", name);
    if (name === "paper") {
      root.setAttribute("data-theme-light", "true");
    } else {
      root.removeAttribute("data-theme-light");
    }
    try { localStorage.setItem("amaya-glass-theme", name); } catch (e) { }
    if (window.AmayaAndroid && window.AmayaAndroid.setLightStatusBar) {
      try { window.AmayaAndroid.setLightStatusBar(name === "paper"); } catch (e) { }
    }
  }

  var savedTheme = "aurora";
  try { savedTheme = localStorage.getItem("amaya-glass-theme") || "aurora"; } catch (e) { }
  applyGlassTheme(savedTheme);

  var themeBtn = make("button", "amaya-theme-toggle");
  themeBtn.type = "button";
  themeBtn.title = "Switch theme";
  themeBtn.setAttribute("aria-label", "Switch theme");
  themeBtn.innerHTML = '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  document.body.appendChild(themeBtn);

  themeBtn.addEventListener("click", function () {
    var current = root.getAttribute("data-glass-theme") || "aurora";
    var idx = GLASS_THEMES.indexOf(current);
    var next = GLASS_THEMES[(idx + 1) % GLASS_THEMES.length];
    applyGlassTheme(next);
    showToast("Theme: " + GLASS_THEME_LABELS[next], null, 1800);
  });

  refreshOnline();
  setTimeout(ensureChip, 900);
  setTimeout(ensureChip, 2600);
  setTimeout(function () {
    checkForUpdate(false);
  }, 1400);
  setTimeout(watchServiceWorker, 1800);
})();
