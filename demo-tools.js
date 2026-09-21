(function () {
  "use strict";
  const store = window.SecureReportStore;
  const media = window.SecureReportMedia;
  const ui = window.SecureReportAdminUI;
  const areaSelect = document.getElementById("meterArea");
  const incidentSelect = document.getElementById("incidentSelect");

  ui.AREAS.forEach(function (area) { areaSelect.add(new Option(area.name, area.name)); });
  function setAreaCoordinates() {
    const area = ui.areaForName(areaSelect.value);
    document.getElementById("meterLatitude").value = area.latitude;
    document.getElementById("meterLongitude").value = area.longitude;
  }
  areaSelect.addEventListener("change", setAreaCoordinates);
  setAreaCoordinates();

  function renderIncidentOptions(selectedId) {
    const incidents = store.getIncidents();
    incidentSelect.innerHTML = "";
    if (!incidents.length) {
      incidentSelect.add(new Option("Trigger a meter event or submit a report first", ""));
      document.getElementById("setAwaiting").disabled = true;
      return;
    }
    document.getElementById("setAwaiting").disabled = false;
    incidents.forEach(function (incident) {
      incidentSelect.add(new Option(incident.id + " · " + incident.outageType, incident.id));
    });
    if (selectedId) incidentSelect.value = selectedId;
  }

  document.getElementById("meterForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const result = store.processSmartMeterSignal({
      meterId: document.getElementById("meterId").value.trim(),
      status: document.getElementById("meterStatus").value,
      outageType: "Power outage",
      latitude: Number(document.getElementById("meterLatitude").value),
      longitude: Number(document.getElementById("meterLongitude").value),
    });
    document.getElementById("meterResult").textContent =
      result.signal.id + " linked to " + result.incident.id + ". Priority recommendation updated to " +
      result.incident.triage.recommendation.priority + ".";
    renderIncidentOptions(result.incident.id);
  });

  document.getElementById("setAwaiting").addEventListener("click", function () {
    if (!incidentSelect.value) return;
    const incident = store.setIncidentAwaitingConfirmation(incidentSelect.value);
    document.getElementById("restorationResult").textContent = incident
      ? incident.id + " is now Awaiting Confirmation."
      : "Incident could not be updated.";
  });

  document.getElementById("resetDemonstration").addEventListener("click", async function () {
    const confirmed = window.confirm("Reset Secure Report application data? This removes all reports, incidents, signals, technician session data, and captured photos from this browser.");
    if (!confirmed) return;
    const button = this;
    const result = document.getElementById("resetResult");
    button.disabled = true;
    result.textContent = "Resetting application dataâ€¦";
    try {
      await media.clearPhotoStore();
      store.resetDemonstration();
      result.textContent = "Application data reset complete. The system is ready for a fresh report.";
      renderIncidentOptions();
    } catch (error) {
      result.textContent = "Application data could not be reset. Try again, or check browser storage permissions.";
      console.error("PowerGrid application data reset failed", error);
    } finally {
      button.disabled = false;
    }
  });
  store.subscribeToStore(function (change) { if (["incidents", "store"].includes(change.domain)) renderIncidentOptions(incidentSelect.value); });
  renderIncidentOptions();
})();
