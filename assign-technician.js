(function () {
  "use strict";

  const store = window.SecureReportStore;
  const form = document.getElementById("assignmentForm");
  const incidentSelect = document.getElementById("incidentSelect");
  const technicianSelect = document.getElementById("technicianSelect");
  const incidentPreview = document.getElementById("incidentPreview");
  const technicianPreview = document.getElementById("technicianPreview");
  const message = document.getElementById("assignmentMessage");
  const requestedIncidentId = new URLSearchParams(window.location.search).get("incident");

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function area(incident) {
    return incident.area || (incident.latitude !== null && incident.longitude !== null
      ? Number(incident.latitude).toFixed(5) + ", " + Number(incident.longitude).toFixed(5)
      : "Location pending");
  }

  function activeIncidents() {
    return store.getIncidents().filter(function (incident) {
      return store.canIncidentBeAssigned(incident);
    }).sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  function renderIncidentPreview() {
    const incident = store.getIncident(incidentSelect.value);
    if (!incident) {
      incidentPreview.innerHTML = '<p class="meta">Select an incident.</p>';
      return;
    }
    const assigned = incident.assignment && incident.assignment.technicianId
      ? store.getTechnician(incident.assignment.technicianId)
      : null;
    incidentPreview.innerHTML =
      '<strong>' + escapeHtml(incident.id) + " · " + escapeHtml(area(incident)) + "</strong>" +
      '<span>' + escapeHtml(incident.outageType) + " · " + escapeHtml(incident.priority) + " priority · " +
      escapeHtml(incident.status) + "</span>" +
      '<span>Current assignment: ' + escapeHtml(assigned ? assigned.name : "Unassigned") + "</span>";
  }

  function renderTechnicianPreview() {
    const technician = store.getTechnician(technicianSelect.value);
    technicianPreview.innerHTML = technician
      ? '<strong>' + escapeHtml(technician.name) + "</strong><span>" +
        escapeHtml(technician.team) + " · " + escapeHtml(technician.baseArea) + " · " +
        escapeHtml(technician.status) + "</span>"
      : '<p class="meta">Select a technician.</p>';
  }

  function render() {
    const incidents = activeIncidents();
    const technicians = store.getTechnicians();
    incidentSelect.innerHTML = incidents.map(function (incident) {
      return '<option value="' + escapeHtml(incident.id) + '">' + escapeHtml(incident.id) +
        " · " + escapeHtml(area(incident)) + " · " + escapeHtml(incident.status) + "</option>";
    }).join("");
    technicianSelect.innerHTML = technicians.map(function (technician) {
      return '<option value="' + escapeHtml(technician.id) + '">' + escapeHtml(technician.name) +
        " · " + escapeHtml(technician.team) + "</option>";
    }).join("");
    form.querySelector('button[type="submit"]').disabled = !incidents.length;
    if (!incidents.length) message.textContent = "No approved incidents are currently eligible for assignment.";

    if (requestedIncidentId && incidents.some(function (incident) { return incident.id === requestedIncidentId; })) {
      incidentSelect.value = requestedIncidentId;
    }
    renderIncidentPreview();
    renderTechnicianPreview();
  }

  incidentSelect.addEventListener("change", renderIncidentPreview);
  technicianSelect.addEventListener("change", renderTechnicianPreview);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const updated = store.assignTechnician(incidentSelect.value, technicianSelect.value, "Admin");
    if (!updated) {
      message.textContent = "The assignment could not be saved.";
      return;
    }
    const technician = store.getTechnician(technicianSelect.value);
    message.textContent = updated.id + " assigned to " + technician.name + ".";
    renderIncidentPreview();
  });

  store.subscribeToStore(function (change) {
    if (["incidents", "technicians", "store"].includes(change.domain)) render();
  });
  render();
})();
