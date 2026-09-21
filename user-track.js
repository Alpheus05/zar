(function () {
  "use strict";
  const store = window.SecureReportStore;
  const selector = document.getElementById("reportSelector");
  const progressStates = ["Reported", "Verified", "Prioritised", "Assigned", "En Route", "On Site", "Repairing", "Awaiting Confirmation", "Resolved"];
  let reports = [];
  let selectedId = null;

  // TODO: Add live technician GPS/WebSocket updates.

  if (!store || !selector) {
    console.error("PowerGrid could not initialise outage tracking.");
    return;
  }

  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function currentReport() {
    return reports.find(function (report) { return report.id === selectedId; }) || null;
  }
  function progressIndex(status) {
    if (status === "Resolved") return progressStates.length - 1;
    if (status === "Awaiting Dispatch") return 2;
    if (status === "Repair Completed") return 7;
    if (status === "Reopened") return 1;
    return Math.max(0, progressStates.indexOf(status));
  }
  function statusCopy(status) {
    const copy = {
      Reported: ["Your outage report has been received.", "We are checking nearby reports and outage signals."],
      Verified: ["Your outage has been verified.", "The incident is ready for priority assessment."],
      Prioritised: ["Your outage has been verified and prioritised.", "We are working to restore power in your area."],
      "Awaiting Dispatch": ["Your outage is awaiting dispatch.", "The incident remains active in the municipal response queue."],
      Assigned: ["A field technician has been assigned.", "The assigned technician will acknowledge the job before travelling to the incident."],
      "En Route": ["A technician is on the way.", "The shared incident was updated by the assigned field technician."],
      "On Site": ["The technician has arrived on site.", "The fault is being assessed safely before repair work begins."],
      Repairing: ["Repair work is in progress.", "The assigned technician is working on the fault."],
      "Repair Completed": ["Repair work has been marked complete.", "We are waiting to confirm that electricity has been restored."],
      "Awaiting Confirmation": ["Please confirm whether power has been restored.", "Your response helps close or reopen the incident."],
      Resolved: ["Your outage has been resolved.", "Restoration was confirmed for this incident."],
      Reopened: ["Your incident has been reopened.", "A resident reported that electricity is still unavailable."],
    };
    return copy[status] || copy.Reported;
  }

  function renderTimeline(incident) {
    const container = document.getElementById("residentTimeline");
    const hiddenTypes = ["TECHNICIAN_NOTE", "TECHNICIAN_BACKUP_REQUESTED", "TECHNICIAN_REASSIGNMENT_REQUESTED", "FALSE_ALARM_REVIEW_REQUESTED", "ADMIN_REVIEW_DEFERRED"];
    const events = incident.timeline.filter(function (event) { return !hiddenTypes.includes(event.type); }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    container.innerHTML = "";
    events.forEach(function (event) {
      const row = document.createElement("div");
      row.className = "timeline-event";
      const time = document.createElement("span");
      time.className = "timeline-time";
      time.textContent = formatTime(event.timestamp);
      const text = document.createElement("span");
      text.className = "timeline-message";
      text.textContent = event.message;
      row.appendChild(time);
      row.appendChild(text);
      container.appendChild(row);
    });
  }

  function render(report) {
    if (!report) {
      document.getElementById("currentStatusTitle").textContent = "No report selected";
      return;
    }
    const incident = store.getIncident(report.incidentId);
    if (!incident) {
      document.getElementById("currentStatusTitle").textContent = "Incident unavailable";
      return;
    }

    document.getElementById("trackingReportId").textContent = report.id;
    document.getElementById("trackingIncidentId").textContent = incident.id;
    document.getElementById("trackingStatusBadge").innerHTML =
      '<span class="badge badge-' + slug(incident.status) + '">' + incident.status + "</span>";
    const index = progressIndex(incident.status);
    const progressTrack = document.getElementById("progressTrack");
    progressTrack.style.gridTemplateColumns = "repeat(" + progressStates.length + ", minmax(78px, 1fr))";
    progressTrack.innerHTML = progressStates.map(function (state, stepIndex) {
      const className = stepIndex < index ? "progress-step complete" : stepIndex === index ? "progress-step current" : "progress-step";
      return '<div class="' + className + '"><div class="progress-dot">' + (stepIndex <= index ? "✓" : "") +
        "</div><span>" + state + "</span></div>";
    }).join("");
    const underReview = incident.triage && incident.triage.state !== "approved";
    const copy = underReview
      ? ["Your report has been received and is being reviewed.", "The municipality is reviewing the incident before dispatch."]
      : statusCopy(incident.status);
    document.getElementById("currentStatusTitle").textContent = copy[0];
    document.getElementById("currentStatusText").textContent = copy[1];
    document.getElementById("restorationCard").hidden = incident.status !== "Awaiting Confirmation";

    const location = incident.latitude === null
      ? "Unavailable"
      : Number(incident.latitude).toFixed(5) + ", " + Number(incident.longitude).toFixed(5);
    const rows = [
      ["Outage type", incident.outageType],
      ["Priority", incident.priority || "Under review"],
      ["Linked reports", incident.linkedReportIds.length],
      ["Smart-meter signals", incident.linkedSignals.length],
      ["Incident location", location],
      ["Image verification", (Array.isArray(report.evidence) ? report.evidence.length : (report.evidence ? 1 : 0)) ? "Photo received" : "No image attached"],
    ];
    document.getElementById("residentSummary").innerHTML = rows.map(function (row) {
      return '<div class="summary-row"><span>' + row[0] + "</span><strong>" + row[1] + "</strong></div>";
    }).join("");
    renderTimeline(incident);
  }

  function refresh(preferredId) {
    reports = store.getReports();
    selector.innerHTML = "";
    if (!reports.length) {
      selector.add(new Option("No reports available", ""));
      render(null);
      return;
    }
    reports.slice().reverse().forEach(function (report) {
      selector.add(new Option(report.id + " · " + report.outageType, report.id));
    });
    selectedId = reports.some(function (report) { return report.id === preferredId; })
      ? preferredId
      : reports[reports.length - 1].id;
    selector.value = selectedId;
    render(currentReport());
  }

  selector.addEventListener("change", function () {
    selectedId = selector.value;
    render(currentReport());
  });
  document.getElementById("confirmRestored").addEventListener("click", function () {
    const report = currentReport();
    if (!report) return;
    store.recordRestorationConfirmation(report.incidentId, report.id, true);
    document.getElementById("residentMessage").textContent = "Thank you. Restoration was confirmed.";
    refresh(report.id);
  });
  document.getElementById("confirmNotRestored").addEventListener("click", function () {
    const report = currentReport();
    if (!report) return;
    store.recordRestorationConfirmation(report.incidentId, report.id, false);
    document.getElementById("residentMessage").textContent = "Thank you. The incident was reopened for review.";
    refresh(report.id);
  });

  const requested = new URLSearchParams(window.location.search).get("report") ||
    new URLSearchParams(window.location.search).get("id");
  refresh(requested);
  store.subscribeToStore(function (change) {
    if (["incidents", "reports", "store"].includes(change.domain)) refresh(selectedId);
  });
  window.addEventListener("focus", function () { refresh(selectedId); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh(selectedId);
  });
})();
