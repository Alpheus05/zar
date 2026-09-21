(function () {
  "use strict";

  let stream = null;
  let capturedUrl = null;
  let capturedResult = null;
  let pendingResolve = null;
  let elements = null;
  let cameraSession = 0;

  function build() {
    if (elements) return elements;
    const overlay = document.createElement("div");
    overlay.className = "camera-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<section class="camera-dialog" role="dialog" aria-modal="true" aria-labelledby="cameraTitle">' +
        '<header class="camera-head"><div><span class="eyebrow">Camera capture</span><h2 id="cameraTitle">Take photo</h2><p id="cameraHint">Position the fault clearly inside the frame.</p></div><button class="camera-close" type="button" aria-label="Close camera">&times;</button></header>' +
        '<div class="camera-stage">' +
          '<video class="camera-video" autoplay playsinline muted></video>' +
          '<img class="camera-preview" alt="Captured photo preview" hidden />' +
          '<div class="camera-message" role="alert" hidden></div>' +
        '</div>' +
        '<footer class="camera-actions camera-live-actions"><button class="btn btn-soft camera-cancel" type="button">Cancel</button><button class="btn btn-primary camera-capture" type="button"><span aria-hidden="true">&#9679;</span> Capture photo</button></footer>' +
        '<footer class="camera-actions camera-review-actions" hidden><button class="btn btn-soft camera-retake" type="button">Retake</button><button class="btn btn-primary camera-use" type="button">Use photo</button></footer>' +
        '<footer class="camera-actions camera-error-actions" hidden><button class="btn btn-primary camera-error-close" type="button">Close</button></footer>' +
      '</section>';
    document.body.appendChild(overlay);
    elements = {
      overlay: overlay,
      dialog: overlay.querySelector(".camera-dialog"),
      title: overlay.querySelector("#cameraTitle"),
      hint: overlay.querySelector("#cameraHint"),
      video: overlay.querySelector(".camera-video"),
      preview: overlay.querySelector(".camera-preview"),
      message: overlay.querySelector(".camera-message"),
      liveActions: overlay.querySelector(".camera-live-actions"),
      reviewActions: overlay.querySelector(".camera-review-actions"),
      errorActions: overlay.querySelector(".camera-error-actions"),
      captureButton: overlay.querySelector(".camera-capture"),
    };
    overlay.querySelector(".camera-close").addEventListener("click", cancel);
    overlay.querySelector(".camera-cancel").addEventListener("click", cancel);
    overlay.querySelector(".camera-error-close").addEventListener("click", cancel);
    overlay.querySelector(".camera-capture").addEventListener("click", capture);
    overlay.querySelector(".camera-retake").addEventListener("click", showLive);
    overlay.querySelector(".camera-use").addEventListener("click", usePhoto);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) cancel(); });
    return elements;
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    if (elements) elements.video.srcObject = null;
  }

  function revokeCapturedUrl() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    capturedUrl = null;
  }

  function finish(result) {
    cameraSession += 1;
    const resolve = pendingResolve;
    pendingResolve = null;
    stopCamera();
    revokeCapturedUrl();
    capturedResult = null;
    if (elements) {
      elements.overlay.hidden = true;
      elements.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("camera-open");
    }
    if (resolve) resolve(result);
  }

  function cancel() { finish(null); }

  function errorMessage(error) {
    if (!window.isSecureContext) return "Camera access needs HTTPS on this connection. Use HTTPS, localhost, or 127.0.0.1 and try again.";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "Camera access is unavailable in this browser or on this device.";
    if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "Camera permission was denied. Allow camera access in your browser settings and try again.";
    if (error && (error.name === "NotFoundError" || error.name === "DevicesNotFoundError")) return "No camera was found on this device.";
    if (error && (error.name === "NotReadableError" || error.name === "TrackStartError")) return "The camera is already being used or could not be started. Close other camera apps and try again.";
    if (error && error.message === "Camera frame unavailable") return "The camera opened but did not provide a usable image. Close other camera apps and try again.";
    return "Camera access is unavailable on this device or connection.";
  }

  function showError(error) {
    stopCamera();
    elements.video.hidden = true;
    elements.preview.hidden = true;
    elements.message.hidden = false;
    elements.message.textContent = errorMessage(error);
    elements.liveActions.hidden = true;
    elements.reviewActions.hidden = true;
    elements.errorActions.hidden = false;
  }

  async function startCamera(sessionId) {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError(new Error("Camera unavailable"));
      return;
    }
    let requestedStream = null;
    try {
      try {
        requestedStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (preferredCameraError) {
        if (!preferredCameraError || !["OverconstrainedError", "ConstraintNotSatisfiedError", "TypeError"].includes(preferredCameraError.name)) throw preferredCameraError;
        requestedStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (sessionId !== cameraSession) {
        requestedStream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = requestedStream;
      elements.video.srcObject = stream;
      await elements.video.play();
      if (!elements.video.videoWidth || !elements.video.videoHeight) {
        await new Promise(function (resolve, reject) {
          const timeout = window.setTimeout(function () {
            cleanup();
            reject(new Error("Camera frame unavailable"));
          }, 5000);
          function cleanup() {
            window.clearTimeout(timeout);
            elements.video.removeEventListener("loadedmetadata", ready);
            elements.video.removeEventListener("resize", ready);
          }
          function ready() {
            if (!elements.video.videoWidth || !elements.video.videoHeight) return;
            cleanup();
            resolve();
          }
          elements.video.addEventListener("loadedmetadata", ready);
          elements.video.addEventListener("resize", ready);
        });
      }
      elements.captureButton.disabled = false;
      elements.captureButton.innerHTML = '<span aria-hidden="true">&#9679;</span> Capture photo';
    } catch (error) {
      if (sessionId !== cameraSession) {
        if (requestedStream) requestedStream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      showError(error);
    }
  }

  function showLive() {
    capturedResult = null;
    revokeCapturedUrl();
    elements.video.hidden = false;
    elements.preview.hidden = true;
    elements.message.hidden = true;
    elements.liveActions.hidden = false;
    elements.reviewActions.hidden = true;
    elements.errorActions.hidden = true;
    elements.captureButton.disabled = true;
    elements.captureButton.textContent = "Starting camera…";
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("The captured frame could not be encoded."));
      }, "image/jpeg", 0.82);
    });
  }

  async function capture() {
    const sourceWidth = elements.video.videoWidth;
    const sourceHeight = elements.video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      showError(new Error("Camera frame unavailable"));
      return;
    }
    const longest = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(1, 1600 / longest);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(elements.video, 0, 0, width, height);
    try {
      const blob = await canvasBlob(canvas);
      capturedResult = { blob: blob, width: width, height: height, capturedAt: new Date().toISOString() };
      revokeCapturedUrl();
      capturedUrl = URL.createObjectURL(blob);
      elements.preview.src = capturedUrl;
      elements.video.hidden = true;
      elements.preview.hidden = false;
      elements.liveActions.hidden = true;
      elements.reviewActions.hidden = false;
    } catch (error) {
      showError(error);
    }
  }

  function usePhoto() {
    if (capturedResult) finish(capturedResult);
  }

  function open(options) {
    if (pendingResolve) return Promise.reject(new Error("The camera is already open."));
    build();
    elements.title.textContent = options && options.title || "Take photo";
    elements.hint.textContent = options && options.hint || "Position the fault clearly inside the frame.";
    showLive();
    elements.overlay.hidden = false;
    elements.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("camera-open");
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      cameraSession += 1;
      startCamera(cameraSession);
    });
  }

  window.addEventListener("pagehide", stopCamera);
  window.addEventListener("beforeunload", stopCamera);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && elements && !elements.overlay.hidden) cancel();
  });

  build();
  window.PowerGridCamera = { open: open, stop: stopCamera };
})();
