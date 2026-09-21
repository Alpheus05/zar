(function () {
  "use strict";
  const store = window.SecureReportStore;
  const ui = window.SecureReportAdminUI;
  function render() {
    const stored = store.getAnalytics();
    const incidents = ui.getDisplayIncidents();
    const reports = store.getReports();
    document.getElementById("analyticsReports").textContent = stored.totalReports;
    document.getElementById("analyticsIncidents").textContent = incidents.length;
    document.getElementById("analyticsConsolidated").textContent = stored.consolidatedReports;
    document.getElementById("analyticsResolved").textContent = stored.resolvedIncidents;
    document.getElementById("donutTotal").textContent = stored.totalReports;

  const daily = Array.from({ length: 7 }, function (_, index) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return [date.toLocaleDateString([], { weekday: "short" }), reports.filter(function (report) {
      const timestamp = new Date(report.timestamp);
      return timestamp >= date && timestamp < next;
    }).length];
  });
  const max = Math.max(1, Math.max.apply(null, daily.map(function (item) { return item[1]; })));
  document.getElementById("reportsBarChart").innerHTML = daily.map(function (item) {
    return '<div class="bar-item"><div class="bar" title="' + item[1] + ' reports" style="height:' +
      Math.round(item[1] / max * 100) + '%"></div><span class="bar-label">' + item[0] + "</span></div>";
  }).join("");

    const areas = {};
    incidents.forEach(function (incident) { areas[incident.area] = (areas[incident.area] || 0) + incident.linkedReportIds.length; });
    const ranking = Object.entries(areas)
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5)
    .map(function (item, index) {
      return '<div class="rank-row"><strong>' + (index + 1) + '.</strong><span>' + ui.escapeHtml(item[0]) +
        "</span><strong>" + item[1] + "</strong></div>";
      }).join("");
    document.getElementById("areaRanking").innerHTML = ranking || '<div class="empty-state">No reporting-area data is available yet.</div>';
  }
  store.subscribeToStore(function (change) { if (["reports", "incidents", "signals", "store"].includes(change.domain)) render(); });
  render();
})();
