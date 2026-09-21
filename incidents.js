(function () {
  "use strict";
  const ui = window.SecureReportAdminUI;
  const store = window.SecureReportStore;
  let incidents = ui.getDisplayIncidents();
  const search = document.getElementById("incidentSearch");
  const statusFilter = document.getElementById("statusFilter");
  const priorityFilter = document.getElementById("priorityFilter");
  const areaFilter = document.getElementById("areaFilter");
  const query = new URLSearchParams(window.location.search);

  statusFilter.add(new Option("Active incidents", "active"));
  Array.from(new Set(incidents.map(function (incident) { return incident.status; }))).sort().forEach(function (status) {
    statusFilter.add(new Option(status, status));
  });
  Array.from(new Set(incidents.map(function (incident) { return incident.area; }))).sort().forEach(function (area) {
    areaFilter.add(new Option(area, area));
  });

  const requestedStatus = query.get("status");
  const requestedPriority = query.get("priority");
  const requestedDate = query.get("date");
  const attentionOnly = query.get("attention") === "1";
  const requestedReview = query.get("review");
  const requestedWork = query.get("work");

  if (requestedStatus) {
    const statusOption = Array.from(statusFilter.options).find(function (option) {
      return option.value.toLowerCase() === requestedStatus.toLowerCase();
    });
    if (statusOption) statusFilter.value = statusOption.value;
  }
  if (requestedPriority) {
    const priorityOption = Array.from(priorityFilter.options).find(function (option) {
      return option.value.toLowerCase() === requestedPriority.toLowerCase();
    });
    if (priorityOption) priorityFilter.value = priorityOption.value;
  }

  function render() {
    incidents = ui.getDisplayIncidents();
    const term = search.value.trim().toLowerCase();
    const filtered = incidents.filter(function (incident) {
      const matchesText = !term || [incident.id, ui.incidentLabel(incident), incident.area, incident.outageType].some(function (value) {
        return String(value).toLowerCase().includes(term);
      });
      const matchesStatus = !statusFilter.value ||
        (statusFilter.value === "active" ? ui.isActiveIncident(incident) : incident.status === statusFilter.value);
      const matchesDate = requestedDate !== "today" ||
        (statusFilter.value === "Resolved" ? ui.isResolvedToday(incident) : ui.isToday(incident.updatedAt));
      return matchesText &&
        matchesStatus && matchesDate &&
        (!priorityFilter.value || incident.priority === priorityFilter.value) &&
        (!areaFilter.value || incident.area === areaFilter.value) &&
        (!requestedReview || (incident.triage && incident.triage.state === requestedReview)) &&
        (!requestedWork || (requestedWork === "active" && ["Assigned", "En Route", "On Site", "Repairing"].includes(incident.status))) &&
        (!attentionOnly || ui.requiresAttention(incident));
    });

    document.getElementById("incidentRows").innerHTML = filtered.length
      ? filtered.map(function (incident) {
          return "<tr><td>" + ui.escapeHtml(ui.incidentLabel(incident)) + "</td><td>" + ui.escapeHtml(incident.area) +
            "</td><td>" + ui.escapeHtml(incident.outageType) + "</td><td>" + ui.priority(incident.priority) +
            "</td><td>" + ui.getReports(incident).length + "</td><td>" + ui.status(incident.status) +
            "</td><td>" + ui.relativeTime(incident.updatedAt) +
            '</td><td><a class="btn btn-soft btn-sm" href="incident.html?id=' +
            encodeURIComponent(incident.id) + '">View →</a></td></tr>';
        }).join("")
      : '<tr><td colspan="8"><div class="empty-state">No incidents match these filters.</div></td></tr>';
    document.getElementById("incidentCount").textContent = "Showing " + filtered.length + " of " + incidents.length + " incidents" +
      (attentionOnly ? " requiring attention" : requestedDate === "today" ? " for today" : "");
  }

  [search, statusFilter, priorityFilter, areaFilter].forEach(function (control) {
    control.addEventListener("input", render);
    control.addEventListener("change", render);
  });

  const modal = document.getElementById("manualReportModal");
  const modalButton = document.getElementById("manualReportButton");
  const modalClose = document.getElementById("manualReportClose");
  const modalCancel = document.getElementById("manualReportCancel");
  const manualForm = document.getElementById("manualReportForm");
  const manualArea = document.getElementById("manualArea");
  const manualLatitude = document.getElementById("manualLatitude");
  const manualLongitude = document.getElementById("manualLongitude");
  const feedback = document.getElementById("manualReportFeedback");

  ui.AREAS.forEach(function (area) {
    manualArea.add(new Option(area.name + " — " + area.region, area.name));
  });

  function setCoordinatesForArea() {
    const area = ui.areaForName(manualArea.value);
    manualLatitude.value = area.latitude;
    manualLongitude.value = area.longitude;
  }

  function openManualReport() {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setCoordinatesForArea();
    document.getElementById("manualReporter").focus();
  }

  function closeManualReport() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    modalButton.focus();
  }

  function optionalNumber(input) {
    return input.value.trim() === "" ? null : Number(input.value);
  }

  manualArea.addEventListener("change", setCoordinatesForArea);
  modalButton.addEventListener("click", openManualReport);
  modalClose.addEventListener("click", closeManualReport);
  modalCancel.addEventListener("click", closeManualReport);
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeManualReport();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !modal.hidden) closeManualReport();
  });

  manualForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const reporter = document.getElementById("manualReporter").value.trim();
    const phone = document.getElementById("manualContact").value.trim();
    const account = document.getElementById("manualAccount").value.trim();
    const area = ui.areaForName(manualArea.value);
    const result = store.createReport({
      source: "admin_manual",
      resident: reporter ? { name: reporter } : null,
      contact: phone || account ? { phone: phone || null, meterAccount: account || null } : null,
      description: document.getElementById("manualDescription").value.trim(),
      outageType: document.getElementById("manualOutageType").value,
      issueType: "Admin manual report",
      latitude: optionalNumber(manualLatitude),
      longitude: optionalNumber(manualLongitude),
      locationCapture: {
        status: "Admin supplied location",
        text: area.name + ", " + area.region,
        area: area.name,
      },
    });

    incidents = ui.getDisplayIncidents();
    manualForm.reset();
    closeManualReport();
    render();
    feedback.textContent = result.matched
      ? "Manual report " + result.report.id + " linked to existing incident " + result.incident.id + "."
      : "Manual report " + result.report.id + " created incident " + result.incident.id + ".";
  });

  if (new URLSearchParams(window.location.search).get("manual") === "1") {
    openManualReport();
    window.history.replaceState({}, "", "incidents.html");
  }
  store.subscribeToStore(function (change) {
    if (["incidents", "reports", "signals", "store"].includes(change.domain)) render();
  });
  render();
})();
