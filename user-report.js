(function () {
  "use strict";

  const store = window.SecureReportStore;
  const media = window.SecureReportMedia;
  const camera = window.PowerGridCamera;
  const reportForm = document.getElementById("reportForm");
  const photoPreview = document.getElementById("photoPreview");
  const photoEmpty = document.getElementById("residentCameraEmpty");
  const takePhotoButton = document.getElementById("takeResidentPhoto");
  const removePhotoButton = document.getElementById("removeResidentPhoto");
  const photoAnalysisState = document.getElementById("photoAnalysisState");
  const reportToast = document.getElementById("reportToast");
  const locationStatus = document.getElementById("locationStatus");
  const locationText = document.getElementById("locationText");
  const captureLocationButton = document.getElementById("captureLocationButton");
  let capturedLocation = null;
  let residentEvidence = null;
  let residentPreviewUrl = null;

  if (!store || !reportForm) {
    console.error("PowerGrid could not initialise the resident report form.");
    return;
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function showToast(message) {
    if (!reportToast) {
      return;
    }

    reportToast.textContent = message;
    reportToast.style.display = "block";
    setTimeout(function () {
      reportToast.style.display = "none";
    }, 3500);
  }

  function clearPreviewUrl() {
    if (residentPreviewUrl) URL.revokeObjectURL(residentPreviewUrl);
    residentPreviewUrl = null;
  }

  function renderPhoto() {
    const hasPhoto = Boolean(residentEvidence && residentPreviewUrl);
    photoPreview.hidden = !hasPhoto;
    photoEmpty.hidden = hasPhoto;
    removePhotoButton.hidden = !hasPhoto;
    takePhotoButton.textContent = hasPhoto ? "Retake photo" : "Take photo";
    if (hasPhoto) photoPreview.src = residentPreviewUrl;
    else photoPreview.removeAttribute("src");
    setText(photoAnalysisState, hasPhoto ? "Photo captured and stored securely on this device." : "No photo captured.");
  }

  takePhotoButton.addEventListener("click", async function () {
    try {
      const capture = await camera.open({
        title: residentEvidence ? "Retake fault photo" : "Take fault photo",
        hint: "Frame the electrical fault clearly. Avoid photographing people where possible.",
      });
      if (!capture) return;
      const saved = await media.savePhotoBlob(capture.blob, capture);
      if (residentEvidence && residentEvidence.imageRef) await media.deletePhotoBlob(residentEvidence.imageRef);
      clearPreviewUrl();
      residentPreviewUrl = URL.createObjectURL(capture.blob);
      residentEvidence = {
        id: "EVID-" + Date.now() + "-resident",
        type: "photo",
        source: "resident",
        capturedAt: saved.capturedAt,
        imageRef: saved.id,
        mimeType: saved.type,
        size: saved.size,
        width: saved.width,
        height: saved.height,
      };
      renderPhoto();
    } catch (error) {
      console.error("Resident photo capture failed", error);
      showToast("The captured photo could not be stored. Please try again.");
    }
  });

  removePhotoButton.addEventListener("click", async function () {
    if (residentEvidence && residentEvidence.imageRef) {
      try { await media.deletePhotoBlob(residentEvidence.imageRef); } catch (error) { console.warn("Photo cleanup failed", error); }
    }
    residentEvidence = null;
    clearPreviewUrl();
    renderPhoto();
  });

  window.addEventListener("pagehide", clearPreviewUrl);
  renderPhoto();

  function getLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({
          status: "Location unavailable",
          text: "Browser geolocation is not supported. The report can still be saved without coordinates.",
          latitude: null,
          longitude: null,
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (position) {
          resolve({
            status: "Location captured",
            text:
              "GPS coordinates captured: " +
              position.coords.latitude.toFixed(5) +
              ", " +
              position.coords.longitude.toFixed(5),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        function () {
          resolve({
            status: "Location permission not granted",
            text: "GPS coordinates were unavailable. The report will be saved without coordinates.",
            latitude: null,
            longitude: null,
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0,
        },
      );
    });
  }

  async function captureLocation() {
    if (captureLocationButton) {
      captureLocationButton.disabled = true;
      captureLocationButton.textContent = "Capturing location…";
    }
    setText(locationStatus, "Capturing");
    setText(locationText, "Please allow location access if your browser asks.");
    capturedLocation = await getLocation();
    setText(locationStatus, capturedLocation.status);
    setText(locationText, capturedLocation.text);
    if (captureLocationButton) {
      captureLocationButton.disabled = false;
      captureLocationButton.textContent = "⌖ Use my current location";
    }
    return capturedLocation;
  }

  if (captureLocationButton) {
    captureLocationButton.addEventListener("click", captureLocation);
  }

  reportForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const issueElement = document.getElementById("electricalIssue");
    const issueTypeElement = document.getElementById("issueType");
    const descriptionElement = document.getElementById("description");
    const issue = issueElement ? issueElement.value : "";
    const issueType = issueTypeElement ? issueTypeElement.value : "";
    const description = descriptionElement
      ? descriptionElement.value.trim()
      : "";

    if (!issue || !issueType || !description) {
      alert("Please complete all required fields.");
      return;
    }

    const submitButton = reportForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Capturing location...";
    }
    setText(locationStatus, "Capturing");
    setText(
      locationText,
      "Please allow location access if your browser asks for permission.",
    );

    try {
      const location = capturedLocation || (await captureLocation());
      const imageAnalysis = await store.analyzeOutageImage(residentEvidence);
      const result = store.createReport({
        source: "resident_report",
        description: description,
        outageType: issue,
        issueType: issueType,
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: new Date().toISOString(),
        evidence: residentEvidence ? [residentEvidence] : [],
        imageAnalysis: imageAnalysis,
        locationCapture: {
          status: location.status,
          text: location.text,
        },
      });

      setText(locationStatus, location.status);
      setText(locationText, location.text);

      const feedback = result.matched
        ? "Report " +
          result.report.id +
          " was consolidated into incident " +
          result.incident.id +
          "."
        : "Report " +
          result.report.id +
          " created incident " +
          result.incident.id +
          ".";

      sessionStorage.setItem("secureReportLastSubmission", feedback);
      showToast(feedback);
      setTimeout(function () {
        window.location.href =
          "user-track.html?report=" + encodeURIComponent(result.report.id);
      }, 1300);
    } catch (error) {
      console.error("Report submission failed", error);
      showToast("The report could not be saved. Please try again.");
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Send Report";
      }
    }
  });
})();
