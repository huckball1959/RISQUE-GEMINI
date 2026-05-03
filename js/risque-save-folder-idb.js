/**
 * Shared IndexedDB storage for the RISQUE save / REPLAY folder (FileSystemDirectoryHandle).
 * Same DB/store/key as replay-machine so one "Connect folder" works everywhere.
 */
(function () {
  "use strict";

  var DB_NAME = "risque-replay-machine-v1";
  var STORE = "handles";
  var KEY = "replayDir";

  function openDb() {
    return new Promise(function (resolve, reject) {
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

  window.risqueSaveFolderIdbPut = function (handle) {
    if (!handle) return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(handle, KEY);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  };

  window.risqueSaveFolderIdbGet = function () {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var r = tx.objectStore(STORE).get(KEY);
        r.onsuccess = function () {
          resolve(r.result);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  };

  /** Replay viewer: list files (read-only). */
  window.risqueSaveFolderEnsureReadable = function (handle) {
    if (!handle || typeof handle.queryPermission !== "function") {
      return Promise.resolve(null);
    }
    return handle.queryPermission({ mode: "read" }).then(function (p) {
      if (p === "granted") return handle;
      return handle.requestPermission({ mode: "read" }).then(function (p2) {
        return p2 === "granted" ? handle : null;
      });
    });
  };

  /** Round autosave: create JSON files (readwrite). */
  window.risqueSaveFolderEnsureWritable = function (handle) {
    if (!handle || typeof handle.queryPermission !== "function") {
      return Promise.resolve(null);
    }
    return handle.queryPermission({ mode: "readwrite" }).then(function (p) {
      if (p === "granted") return handle;
      return handle.requestPermission({ mode: "readwrite" }).then(function (p2) {
        return p2 === "granted" ? handle : null;
      });
    });
  };
})();
