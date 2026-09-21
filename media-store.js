(function () {
  "use strict";

  const DATABASE_NAME = "secureReportMedia";
  const DATABASE_VERSION = 1;
  const PHOTO_STORE = "photos";

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("Photo storage is unavailable in this browser."));
        return;
      }
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = function () {
        const database = request.result;
        if (!database.objectStoreNames.contains(PHOTO_STORE)) {
          database.createObjectStore(PHOTO_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Photo storage could not be opened.")); };
    });
  }

  function photoId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return "PHOTO-" + window.crypto.randomUUID();
    }
    return "PHOTO-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  async function withStore(mode, operation) {
    const database = await openDatabase();
    return new Promise(function (resolve, reject) {
      const transaction = database.transaction(PHOTO_STORE, mode);
      const store = transaction.objectStore(PHOTO_STORE);
      let request;
      let result;
      try {
        request = operation(store);
      } catch (error) {
        database.close();
        reject(error);
        return;
      }
      request.onsuccess = function () { result = request.result; };
      request.onerror = function () { reject(request.error || new Error("Photo storage operation failed.")); };
      transaction.oncomplete = function () { database.close(); resolve(result); };
      transaction.onerror = function () { database.close(); reject(transaction.error || new Error("Photo storage transaction failed.")); };
      transaction.onabort = function () { database.close(); reject(transaction.error || new Error("Photo storage transaction was cancelled.")); };
    });
  }

  async function savePhotoBlob(blob, details) {
    if (!(blob instanceof Blob)) throw new TypeError("A captured photo Blob is required.");
    const metadata = details || {};
    const record = {
      id: photoId(),
      blob: blob,
      createdAt: metadata.capturedAt || new Date().toISOString(),
      type: blob.type || "image/jpeg",
      size: blob.size,
      width: Number(metadata.width) || null,
      height: Number(metadata.height) || null,
    };
    await withStore("readwrite", function (store) { return store.put(record); });
    return {
      id: record.id,
      capturedAt: record.createdAt,
      type: record.type,
      size: record.size,
      width: record.width,
      height: record.height,
    };
  }

  async function getPhotoBlob(id) {
    if (!id) return null;
    const record = await withStore("readonly", function (store) { return store.get(id); });
    return record && record.blob instanceof Blob ? record.blob : null;
  }

  async function deletePhotoBlob(id) {
    if (!id) return false;
    await withStore("readwrite", function (store) { return store.delete(id); });
    return true;
  }

  async function clearPhotoStore() {
    await withStore("readwrite", function (store) { return store.clear(); });
    return true;
  }

  window.SecureReportMedia = {
    DATABASE_NAME: DATABASE_NAME,
    PHOTO_STORE: PHOTO_STORE,
    savePhotoBlob: savePhotoBlob,
    getPhotoBlob: getPhotoBlob,
    deletePhotoBlob: deletePhotoBlob,
    clearPhotoStore: clearPhotoStore,
  };
})();
