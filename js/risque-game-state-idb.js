/**
 * Host-only: full gameState JSON in IndexedDB (large quota) alongside localStorage.
 * Survives LS QuotaExceededError; hydrate runs before game-shell boot (see game.html).
 */
(function () {
  "use strict";

  var DB_NAME = "risque-game-state-v1";
  var STORE = "kv";
  var KEY_BODY = "gameStateJson";
  var KEY_SEQ = "seq";
  var LS_SEQ_KEY = "risqueGameStateIdbSeq";
  var STORAGE_KEY = "gameState";
  var LOG_KEY = "gameLogs";

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("no idb"));
        return;
      }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idbGet(db, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readonly");
      var r = tx.objectStore(STORE).get(key);
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }

  function idbPut(db, key, val) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  }

  function tryWriteLsSeq(n) {
    try {
      localStorage.setItem(LS_SEQ_KEY, String(n));
    } catch (e) {
      /* ignore */
    }
  }

  function tryHydrateLs(gameJson) {
    try {
      localStorage.setItem(STORAGE_KEY, gameJson);
      return true;
    } catch (e1) {
      try {
        var lg = localStorage.getItem(LOG_KEY);
        var logsArr = [];
        try {
          logsArr = JSON.parse(lg || "[]");
        } catch (eP) {
          logsArr = [];
        }
        if (Array.isArray(logsArr) && logsArr.length > 30) {
          localStorage.setItem(LOG_KEY, JSON.stringify(logsArr.slice(-30)));
        } else {
          localStorage.removeItem(LOG_KEY);
        }
      } catch (eTr) {
        try {
          localStorage.removeItem(LOG_KEY);
        } catch (eRm) {
          /* ignore */
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, gameJson);
        return true;
      } catch (e2) {
        window.__risqueIdbBootstrapGameStateJson = gameJson;
        return false;
      }
    }
  }

  window.risqueGameStateIdbHydrateFromIndexedDb = function () {
    if (typeof indexedDB === "undefined") return Promise.resolve();
    return openDb()
      .then(function (db) {
        return Promise.all([idbGet(db, KEY_BODY), idbGet(db, KEY_SEQ)]);
      })
      .then(function (pair) {
        var body = pair[0];
        var idbSeq = Number(pair[1]) || 0;
        if (!body || typeof body !== "string" || body.length < 2) {
          return null;
        }
        var lsSeq = 0;
        try {
          lsSeq = Number(localStorage.getItem(LS_SEQ_KEY)) || 0;
        } catch (eLs) {
          lsSeq = 0;
        }
        if (idbSeq < lsSeq) {
          return null;
        }
        tryWriteLsSeq(idbSeq);
        tryHydrateLs(body);
        return null;
      })
      .catch(function () {
        return null;
      });
  };

  var __writeChain = Promise.resolve();

  window.risqueGameStateIdbQueuePut = function (jsonString) {
    if (!jsonString || typeof jsonString !== "string" || typeof indexedDB === "undefined") {
      return Promise.resolve();
    }
    __writeChain = __writeChain.then(
      function () {
        return openDb().then(function (db) {
          return idbGet(db, KEY_SEQ).then(function (prev) {
            var n = (Number(prev) || 0) + 1;
            return idbPut(db, KEY_BODY, jsonString)
              .then(function () {
                return idbPut(db, KEY_SEQ, n);
              })
              .then(function () {
                tryWriteLsSeq(n);
                return n;
              });
          });
        });
      },
      function () {
        return openDb().then(function (db) {
          return idbGet(db, KEY_SEQ).then(function (prev) {
            var n = (Number(prev) || 0) + 1;
            return idbPut(db, KEY_BODY, jsonString)
              .then(function () {
                return idbPut(db, KEY_SEQ, n);
              })
              .then(function () {
                tryWriteLsSeq(n);
                return n;
              });
          });
        });
      }
    );
    return __writeChain;
  };

  window.risqueGameStateIdbAwaitWrites = function () {
    return __writeChain.catch(function () {
      return undefined;
    });
  };
})();
