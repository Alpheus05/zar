(function () {
  "use strict";
  const ui = window.SecureReportAdminUI;
  const store = window.SecureReportStore;
  const alertOverlay = document.getElementById("residentReportAlert");
  const alertDialog = document.getElementById("residentReportDialog");
  const reviewIncidentButton = document.getElementById("reviewIncidentButton");
  const acknowledgeButton = document.getElementById("acknowledgeReportButton");
  const warnedMissingIncidents = new Set();
  let currentAlertReportId = null;
  let previouslyFocusedElement = null;

  document.getElementById("currentDate").textContent = new Date().toLocaleString([], {
    weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  document.querySelectorAll(".kpi-link").forEach(function (card) {
    card.addEventListener("keydown", function (event) {
      if (event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
  });

  function storedRestorationReason(incident) {
    const event = (incident.timeline || []).slice().reverse().find(function (item) {
      return item.type === "RESIDENT_REPORTED_NOT_RESTORED";
    });
    return event ? event.message : "";
  }

  function attentionReason(incident) {
    const restorationReason = storedRestorationReason(incident);
    const technicianRequest = (incident.timeline || []).slice().reverse().find(function (item) {
      return ["TECHNICIAN_BACKUP_REQUESTED", "TECHNICIAN_REASSIGNMENT_REQUESTED", "FALSE_ALARM_REVIEW_REQUESTED"].includes(item.type);
    });
    if (restorationReason) return restorationReason;
    if (incident.triage && incident.triage.state === "deferred") return "Saved for later Admin review";
    if (incident.triage && incident.triage.state === "pending") return "Priority recommendation awaiting Admin decision";
    if (incident.status === "Reopened") return "Incident reopened and requires review";
    if (!ui.hasUsableLocation(incident)) return "Location requires verification";
    if (ui.hasNegativeRestorationFeedback(incident)) return "Negative restoration feedback requires review";
    if (typeof incident.attentionFlag === "string") return incident.attentionFlag;
    if (incident.attentionFlag && incident.attentionFlag.message) return incident.attentionFlag.message;
    if (technicianRequest) return technicianRequest.message;
    if (incident.status === "Needs Review") return "Incident requires an admin decision";
    if (incident.priority === "High" && incident.requiresReview === true) return "High-priority incident requires review";
    if (incident.criticalInfrastructure.length) return incident.criticalInfrastructure[0].name + " affected";
    return incident.priorityReasons[0] || "Incident requires attention";
  }

  function attentionIndicator(incident) {
    if (incident.status === "Reopened") return ui.status("Reopened");
    if (incident.status === "Needs Review" || !ui.hasUsableLocation(incident) || ui.hasNegativeRestorationFeedback(incident)) {
      return ui.status("Needs Review");
    }
    return ui.priority(incident.priority);
  }

  function activityArea(item) {
    if (item.kind === "report") return ui.reportArea(item.record);
    const incident = item.record.incidentId ? ui.getIncident(item.record.incidentId) : null;
    if (incident && incident.area) return incident.area;
    if (item.record.latitude !== null && item.record.longitude !== null) {
      return Number(item.record.latitude).toFixed(5) + ", " + Number(item.record.longitude).toFixed(5);
    }
    return "Location unavailable";
  }

  function renderDashboard() {
    const incidents = ui.getDisplayIncidents();
    const active = ui.getActiveIncidents(incidents);
    const reports = store.getReports();
    const signals = store.getSignals();

    document.getElementById("activeKpi").textContent = active.length;
    document.getElementById("criticalKpi").textContent = ui.getCriticalIncidents(incidents).length;
    document.getElementById("reportsKpi").textContent = ui.getReportsToday(reports).length;
    document.getElementById("resolvedKpi").textContent = ui.getResolvedToday(incidents).length;
    document.getElementById("pendingReviewKpi").textContent = incidents.filter(function (item) { return item.triage && item.triage.state === "pending"; }).length;
    document.getElementById("deferredKpi").textContent = incidents.filter(function (item) { return item.triage && item.triage.state === "deferred"; }).length;
    document.getElementById("awaitingDispatchKpi").textContent = incidents.filter(function (item) { return item.triage && item.triage.state === "approved" && item.status === "Awaiting Dispatch" && !(item.assignment && item.assignment.technicianId); }).length;
    document.getElementById("technicianActiveKpi").textContent = incidents.filter(function (item) { return ["Assigned", "En Route", "On Site", "Repairing"].includes(item.status); }).length;
    document.getElementById("awaitingConfirmationKpi").textContent = incidents.filter(function (item) { return item.status === "Awaiting Confirmation"; }).length;

    document.getElementById("mapPins").innerHTML = active.slice(0, 8).map(function (incident, index) {
      const x = incident.mapX || ui.AREAS[index % ui.AREAS.length].x;
      const y = incident.mapY || ui.AREAS[index % ui.AREAS.length].y;
      return '<a class="map-pin ' + ui.slug(incident.priority) + '" style="left:' + x + '%;top:' + y + '%" href="incident.html?id=' +
        encodeURIComponent(incident.id) + '" aria-label="View ' + ui.escapeHtml(ui.incidentLabel(incident)) + '"></a>' +
        '<span class="map-label" style="left:calc(' + x + '% + 14px);top:calc(' + y + '% - 3px)">' + ui.escapeHtml(incident.area) + "</span>";
    }).join("");

    const attention = ui.getAttentionIncidents(incidents).sort(function (a, b) {
      const ranks = { Critical: 4, High: 3, Medium: 2, Low: 1 };
      return (ranks[b.priority] || 0) - (ranks[a.priority] || 0) || new Date(b.updatedAt) - new Date(a.updatedAt);
    }).slice(0, 5);
    document.getElementById("attentionList").innerHTML = attention.length
      ? attention.map(function (incident) {
          const reportCount = ui.getReports(incident).length;
          const reportLabel = reportCount === 1 ? "human report" : "human reports";
          return '<div class="attention-item"><div class="attention-copy"><h3>' +
            ui.escapeHtml(ui.incidentLabel(incident)) + '</h3><strong class="attention-area">' + ui.escapeHtml(incident.area) +
            '</strong><div class="attention-state">' + attentionIndicator(incident) + '</div>' +
            '<p class="attention-reason">' + ui.escapeHtml(attentionReason(incident)) + '</p>' +
            '<p>' + reportCount + ' ' + reportLabel + '<br>Reported ' + ui.relativeTime(incident.createdAt) +
            '</p></div><a class="btn btn-soft btn-sm attention-action" href="incident.html?id=' +
            encodeURIComponent(incident.id) + '">View →</a></div>';
        }).join("")
      : '<div class="empty-state">No incidents currently require an admin decision.</div>';

    const reportActivity = reports.map(function (report) {
      return {
        kind: "report",
        record: report,
        id: report.id,
        source: ui.reportSourceLabel(report),
        summary: report.description || report.outageType,
        timestamp: report.timestamp,
        incidentId: report.incidentId,
      };
    });
    const signalActivity = signals.map(function (signal) {
      return {
        kind: "signal",
        record: signal,
        id: signal.id,
        source: "Smart-meter signal",
        summary: "Meter " + (signal.meterId || "unknown") + " reported " + signal.status + ".",
        timestamp: signal.timestamp,
        incidentId: signal.incidentId,
      };
    });
    const recentActivity = reportActivity.concat(signalActivity).sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    }).slice(0, 8);

    document.getElementById("recentActivityList").innerHTML = recentActivity.length
      ? recentActivity.map(function (item) {
          const incident = item.incidentId ? ui.getIncident(item.incidentId) : null;
          const action = incident
            ? '<a class="btn btn-soft btn-sm" href="incident.html?id=' + encodeURIComponent(item.incidentId) + '">View →</a>'
            : '<span class="tiny muted">Not linked</span>';
          return '<article class="activity-item activity-' + item.kind + '"><div class="activity-identity"><strong>' +
            ui.escapeHtml(item.id) + '</strong><span>' + ui.escapeHtml(item.source) + '</span></div><div class="activity-area">' +
            ui.escapeHtml(activityArea(item)) + '</div><p class="activity-summary">' + ui.escapeHtml(item.summary) +
            '</p><div class="activity-meta"><span>' + ui.relativeTime(item.timestamp) + '</span><strong>' +
            ui.escapeHtml(item.incidentId || "Not linked") + '</strong></div><div class="activity-action">' + action + "</div></article>";
        }).join("")
      : '<div class="empty-state">No human reports or smart-meter signals have been received yet.</div>';
  }

  function hasUncertainLocation(report) {
    const area = ui.reportArea(report);
    return report.latitude === null || report.longitude === null ||
      area === "Location pending" || area === "Location unavailable";
  }

  function renderReportAlert(report, pendingCount) {
    const isNewAlert = currentAlertReportId !== report.id;
    const wasHidden = alertOverlay.hidden;
    const incident = report.incidentId ? ui.getIncident(report.incidentId) : null;
    const area = ui.reportArea(report);
    document.getElementById("reportQueueCount").textContent = "Report 1 of " + pendingCount + " pending";
    document.getElementById("alertReportId").textContent = report.id || "Report ID unavailable";
    document.getElementById("alertReportArea").textContent = area;
    document.getElementById("alertReportTime").textContent = "Reported " + ui.relativeTime(report.timestamp);
    document.getElementById("alertOutageType").textContent = report.outageType || "Not specified";
    document.getElementById("alertDescription").textContent = report.description || "No description supplied.";
    const alertLocation = document.getElementById("alertLocation");
    const locationUncertain = hasUncertainLocation(report);
    alertLocation.textContent = locationUncertain ? "⚠ Location requires verification" : area;
    alertLocation.classList.toggle("location-warning", locationUncertain);
    const evidenceCount = Array.isArray(report.evidence) ? report.evidence.length : (report.evidence ? 1 : 0);
    document.getElementById("alertEvidence").textContent = evidenceCount ? evidenceCount + (evidenceCount === 1 ? " photo attached" : " photos attached") : "None";
    document.getElementById("alertIncidentId").textContent = incident
      ? ui.incidentLabel(incident)
      : "Linked incident unavailable";
    document.getElementById("alertPriority").innerHTML = incident
      ? ui.priority(incident.priority || incident.triage.recommendation.priority) + (incident.priority ? "" : ' <span class="tiny muted">AI recommendation</span>')
      : '<span class="muted">Unavailable</span>';
    const recommendationReasons = incident && incident.triage ? incident.triage.recommendation.reasons : [];
    document.getElementById("alertPriorityReasons").innerHTML = recommendationReasons.length
      ? recommendationReasons.slice(0, 3).map(function (reason) {
          return "<li>" + ui.escapeHtml(reason) + "</li>";
        }).join("")
      : '<li class="muted">No incident priority reasons available.</li>';

    if (incident) {
      reviewIncidentButton.href = "incident.html?id=" + encodeURIComponent(incident.id);
      reviewIncidentButton.textContent = "Review incident";
      reviewIncidentButton.removeAttribute("aria-disabled");
      reviewIncidentButton.classList.remove("is-disabled");
    } else {
      reviewIncidentButton.removeAttribute("href");
      reviewIncidentButton.textContent = "Linked incident unavailable";
      reviewIncidentButton.setAttribute("aria-disabled", "true");
      reviewIncidentButton.classList.add("is-disabled");
      if (report.incidentId && !warnedMissingIncidents.has(report.id)) {
        warnedMissingIncidents.add(report.id);
        console.warn("PowerGrid could not display linked incident for report", report.id, report.incidentId);
      }
    }

    currentAlertReportId = report.id;
    if (wasHidden) {
      previouslyFocusedElement = document.activeElement;
      alertOverlay.hidden = false;
      alertOverlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("modal-open");
    }
    if (wasHidden || isNewAlert) {
      const initialFocus = incident ? reviewIncidentButton : acknowledgeButton;
      window.setTimeout(function () { initialFocus.focus(); }, 0);
    }
  }

  function closeReportAlert() {
    if (alertOverlay.hidden) return;
    alertOverlay.hidden = true;
    alertOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    currentAlertReportId = null;
    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === "function") {
      previouslyFocusedElement.focus();
    }
    previouslyFocusedElement = null;
  }

  function refreshReportQueue() {
    renderDashboard();
    const pending = store.getUnacknowledgedResidentReports();
    if (!pending.length) {
      closeReportAlert();
      return;
    }
    renderReportAlert(pending[0], pending.length);
  }

  acknowledgeButton.addEventListener("click", function () {
    if (!currentAlertReportId) return;
    store.acknowledgeReport(currentAlertReportId, "Admin");
    refreshReportQueue();
  });

  alertOverlay.addEventListener("mousedown", function (event) {
    if (event.target === alertOverlay) {
      event.preventDefault();
    }
  });

  alertOverlay.addEventListener("click", function (event) {
    if (event.target === alertOverlay) {
      const focusTarget = reviewIncidentButton.getAttribute("aria-disabled") === "true"
        ? acknowledgeButton
        : reviewIncidentButton;
      focusTarget.focus();
    }
  });

  document.addEventListener("focusin", function (event) {
    if (!alertOverlay.hidden && !alertDialog.contains(event.target)) {
      const focusTarget = reviewIncidentButton.getAttribute("aria-disabled") === "true"
        ? acknowledgeButton
        : reviewIncidentButton;
      focusTarget.focus();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (alertOverlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(alertDialog.querySelectorAll('a[href]:not([aria-disabled="true"]), button:not([disabled])'));
    if (!focusable.length) {
      event.preventDefault();
      alertDialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !alertDialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !alertDialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  store.subscribeToStore(function (change) {
    if (["reports", "incidents", "signals", "store"].includes(change.domain)) refreshReportQueue();
  });
  window.addEventListener("focus", refreshReportQueue);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshReportQueue();
  });
  window.setInterval(refreshReportQueue, 5000);

  refreshReportQueue();
})();
