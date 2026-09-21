(function () {
  "use strict";
  const store = window.SecureReportStore;
  const list = document.getElementById("reportList");
  if (!store || !list) {
    console.error("PowerGrid could not initialise My Reports.");
    return;
  }

  function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + " minutes ago";
    if (minutes < 1440) return Math.floor(minutes / 60) + " hours ago";
    return Math.floor(minutes / 1440) + " days ago";
  }
  function slug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function render() {
    const reports = store.getReports().slice().reverse();
    list.innerHTML = "";
    if (!reports.length) {
      list.innerHTML = '<div class="card empty-state"><h2>No reports yet</h2><p>Submit an outage report and its incident status will appear here.</p><a class="btn btn-primary" href="user-report.html">Report an outage</a></div>';
      return;
    }
    reports.forEach(function (report) {
    const incident = store.getIncident(report.incidentId);
    const status = incident ? incident.status : "Incident unavailable";
    const card = document.createElement("article");
    card.className = "card report-card";
    const details = document.createElement("div");
    const actions = document.createElement("div");
    details.innerHTML = "<h3>" + report.id + "</h3><p>" + report.outageType +
      "</p><div class=\"report-meta\"><span>⌖ " +
      (incident && incident.latitude !== null
        ? Number(incident.latitude).toFixed(4) + ", " + Number(incident.longitude).toFixed(4)
        : "Location unavailable") +
      "</span><span>◈ " + (report.incidentId || "Not linked") + "</span></div>";
    actions.className = "report-actions";
    const badge = document.createElement("span");
    badge.className = "badge badge-" + slug(status);
    badge.textContent = status;
    const time = document.createElement("span");
    time.className = "tiny muted";
    time.textContent = relativeTime(report.timestamp);
    const link = document.createElement("a");
    link.className = "btn btn-soft btn-sm";
    link.href = "user-track.html?report=" + encodeURIComponent(report.id);
    link.textContent = "View details →";
    actions.appendChild(badge);
    actions.appendChild(time);
    actions.appendChild(link);
    card.appendChild(details);
    card.appendChild(actions);
    list.appendChild(card);
    });
  }
  store.subscribeToStore(function (change) { if (["reports", "incidents", "store"].includes(change.domain)) render(); });
  render();
})();
