(function () {
  "use strict";
  const store = window.SecureReportStore;
  const ui = window.SecureReportAdminUI;
  const dateFilter = new URLSearchParams(window.location.search).get("date");

  if (dateFilter === "today") {
    document.getElementById("reportsDescription").textContent = "Human-submitted outage reports received today.";
  }

  function incidentAction(report, incident) {
    if (!report.incidentId) return '<span class="muted tiny">Not linked</span>';
    if (!incident) return '<span class="muted tiny">Incident unavailable</span>';
    return '<a class="btn btn-soft btn-sm" href="incident.html?id=' +
      encodeURIComponent(report.incidentId) + '">View incident</a>';
  }

  function render() {
    const allReports = store.getReports();
    const reports = (dateFilter === "today" ? ui.getReportsToday(allReports) : allReports).slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    document.getElementById("reportRows").innerHTML = reports.length
    ? reports.map(function (report) {
        const incident = ui.getIncident(report.incidentId);
        return "<tr><td>" + ui.escapeHtml(report.id) + "</td><td>" +
          ui.escapeHtml(new Date(report.timestamp).toLocaleString()) + "</td><td>" +
          ui.escapeHtml(ui.reportSourceLabel(report)) + "</td><td>" + ui.escapeHtml(ui.reportArea(report)) +
          "</td><td><strong>" + ui.escapeHtml(report.outageType) + "</strong><br><span class=\"muted tiny\">" +
          ui.escapeHtml(report.description) + "</span></td><td>" + ((Array.isArray(report.evidence) ? report.evidence.length : (report.evidence ? 1 : 0)) ? (Array.isArray(report.evidence) ? report.evidence.length : 1) + " photo" : "None") +
          "</td><td>" + ui.escapeHtml(report.incidentId || "Not linked") +
          (incident ? '<br><span class="tiny muted">' + ui.escapeHtml(incident.status) + "</span>" : "") +
          "</td><td>" + ui.status(report.adminReview.acknowledged ? "Reviewed" : "Awaiting Review") +
          "</td><td>" + incidentAction(report, incident) + "</td></tr>";
      }).join("")
    : '<tr><td colspan="9"><div class="empty-state">No human reports have been submitted in this browser yet.</div></td></tr>';
    document.getElementById("reportCount").textContent = "Showing " + reports.length +
      (dateFilter === "today" ? " human reports received today" : " human reports");
  }
  store.subscribeToStore(function (change) { if (["reports", "incidents", "store"].includes(change.domain)) render(); });
  render();
})();
