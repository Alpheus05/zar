(function () {
  "use strict";
  const ui = window.SecureReportAdminUI;
  const store = window.SecureReportStore;
  const media = window.SecureReportMedia;
  const id = new URLSearchParams(window.location.search).get("id") || "INC-004";
  let incident = ui.getIncident(id);
  const message = document.getElementById("detailMessage");

  if (!incident) {
    document.querySelector(".page-wrap").innerHTML =
      '<a class="back-link" href="incidents.html">← Back to incidents</a><div class="card empty-state"><h1>Incident not found</h1><p>No incident matches ' +
      ui.escapeHtml(id) + ".</p></div>";
    return;
  }

  let reports = ui.getReports(incident);
  const STATUS_TRANSITIONS = {
    "Reported": ["Verified"],
    "Verified": ["Prioritised"],
    "Prioritised": ["Awaiting Dispatch"],
    "Awaiting Dispatch": [],
    "Assigned": [],
    "En Route": [],
    "On Site": [],
    "Repairing": [],
    "Repair Completed": ["Awaiting Confirmation"],
    "Awaiting Confirmation": ["Reopened"],
    "Resolved": ["Reopened"],
    "Reopened": ["Verified", "Awaiting Dispatch"],
  };
  const CONSEQUENTIAL_STATUSES = ["Resolved", "Reopened"];
  let pendingStatus = null;
  let activeModal = null;
  let modalReturnFocus = null;
  const evidenceObjectUrls = new Set();

  const currentStatus = document.getElementById("currentStatus");
  const changeStatusButton = document.getElementById("changeStatusButton");
  const statusEditor = document.getElementById("statusEditor");
  const statusSelect = document.getElementById("statusSelect");
  const applyStatusButton = document.getElementById("applyStatusButton");
  const cancelStatusButton = document.getElementById("cancelStatusButton");
  const locationModal = document.getElementById("locationModal");
  const locationDialog = document.getElementById("locationDialog");
  const statusConfirmModal = document.getElementById("statusConfirmModal");
  const statusConfirmDialog = document.getElementById("statusConfirmDialog");

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function hasCoordinates(item) {
    return number(item && item.latitude) !== null && number(item && item.longitude) !== null;
  }

  function incidentName() {
    return ui.incidentLabel(incident);
  }

  function renderHeader() {
    document.getElementById("incidentId").textContent = incidentName();
    document.getElementById("incidentArea").textContent = incident.area + ", " + incident.region;
    document.getElementById("priorityBadge").innerHTML = incident.priority ? ui.priority(incident.priority) : ui.status("Awaiting Review");
    document.getElementById("priorityQuestion").textContent = incident.priority ? "Why is this " + incident.priority.toLowerCase() + "?" : "Recommendation evidence";
    document.getElementById("tabReportCount").textContent = reports.length;
    const assignmentLink = document.getElementById("assignmentLink");
    const assignedTechnician = incident.assignment && incident.assignment.technicianId
      ? store.getTechnician(incident.assignment.technicianId)
      : null;
    assignmentLink.href = "assign-technician.html?incident=" + encodeURIComponent(incident.id);
    assignmentLink.textContent = assignedTechnician ? "Reassign technician" : "Assign technician";
    assignmentLink.hidden = !store.canIncidentBeAssigned(incident);
  }

  function renderTriage() {
    const triage = incident.triage;
    const recommendation = triage.recommendation;
    document.getElementById("recommendedPriority").innerHTML = ui.priority(recommendation.priority);
    document.getElementById("recommendationReasons").innerHTML = recommendation.reasons.length
      ? recommendation.reasons.map(function (reason) { return '<div class="reason"><span class="reason-icon" aria-hidden="true"></span><span>' + ui.escapeHtml(reason) + '</span></div>'; }).join("")
      : '<p class="muted tiny">No recommendation evidence is available.</p>';
    const stateCopy = triage.state === "approved"
      ? "Approved operational priority: " + incident.priority + ". Recommendation retained for audit."
      : triage.state === "deferred"
        ? "Saved for later review. This incident is not eligible for dispatch."
        : "Pending an explicit Admin decision. This incident is not eligible for dispatch.";
    document.getElementById("triageStateText").textContent = stateCopy;
    document.getElementById("adminPrioritySelect").value = triage.adminPriority || recommendation.priority;
    document.getElementById("approveRecommendation").textContent = triage.state === "approved" ? "Approve recommendation instead" : "Approve recommendation";
    const stored = Boolean(store.getIncident(incident.id));
    ["approveRecommendation", "approveSelectedPriority", "deferReview", "adminPrioritySelect"].forEach(function (elementId) {
      document.getElementById(elementId).disabled = !stored;
    });
  }

  function nextStatuses() {
    return STATUS_TRANSITIONS[incident.status] || [];
  }

  function renderStatusControl() {
    const storedIncident = store.getIncident(incident.id);
    const available = nextStatuses();
    currentStatus.innerHTML = ui.status(incident.status);
    statusSelect.innerHTML = '<option value="">Select next status</option>' + available.map(function (status) {
      return '<option value="' + ui.escapeHtml(status) + '">' + ui.escapeHtml(status) + "</option>";
    }).join("");
    applyStatusButton.disabled = true;
    statusEditor.hidden = true;

    if (!storedIncident) {
      changeStatusButton.disabled = true;
      changeStatusButton.textContent = "Read-only incident";
      changeStatusButton.title = "This incident is read-only.";
    } else if (incident.triage.state !== "approved") {
      changeStatusButton.disabled = true;
      changeStatusButton.textContent = "Review priority first";
      changeStatusButton.title = "Approve an operational priority before changing workflow status.";
    } else if (!available.length) {
      changeStatusButton.disabled = true;
      changeStatusButton.textContent = "No next state";
    } else {
      changeStatusButton.disabled = false;
      changeStatusButton.textContent = "Change status";
      changeStatusButton.removeAttribute("title");
    }
  }

  function renderSummary() {
    const lastReport = reports.slice().sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    })[0];
    const checklist = incident.work && incident.work.checklist || [];
    const checklistDone = checklist.filter(function (step) { return step.done; }).length;
    const summary = [
      ["Outage type", incident.outageType],
      ["Status", ui.status(incident.status), true],
      ["Operational priority", incident.priority ? ui.priority(incident.priority) : '<span class="muted">Not yet approved</span>', true],
      ["AI recommendation", ui.priority(incident.triage.recommendation.priority), true],
      ["First reported", ui.formatTime(incident.createdAt)],
      ["Last report", ui.formatTime(lastReport ? lastReport.timestamp : incident.createdAt)],
      ["Reports linked", reports.length],
      ["Smart meter signals", incident.linkedSignals.length],
      ["Affected customers", incident.affectedCustomers || Math.max(reports.length * 4, incident.linkedSignals.length)],
      ["Critical infrastructure", incident.criticalInfrastructure.length || "None detected"],
      ["Assigned technician", incident.assignment && incident.assignment.technicianId
        ? ((store.getTechnician(incident.assignment.technicianId) || {}).name || incident.assignment.technicianId)
        : "Unassigned"],
      ["Repair progress", checklist.length ? checklistDone + " of " + checklist.length + " checklist items completed" : "Not started"],
      ["Field evidence", (incident.work && incident.work.evidence || []).length + " photo(s)"],
      ["Repair outcome", incident.work && incident.work.outcome || "Not recorded"],
    ];
    document.getElementById("incidentSummary").innerHTML = summary.map(function (row) {
      const value = row[2] ? row[1] : ui.escapeHtml(row[1]);
      return '<div class="summary-row"><span>' + ui.escapeHtml(row[0]) + "</span><strong>" + value + "</strong></div>";
    }).join("");
  }

  function renderPriorityReasons() {
    const reasons = incident.triage.recommendation.reasons;
    document.getElementById("priorityReasons").innerHTML = reasons.length
      ? reasons.map(function (reason) {
          return '<div class="reason"><span class="reason-icon" aria-hidden="true"></span><span>' + ui.escapeHtml(reason) + "</span></div>";
        }).join("")
      : '<p class="muted tiny">No priority reasons have been recorded.</p>';
  }

  function releaseEvidenceUrls() {
    evidenceObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    evidenceObjectUrls.clear();
  }

  async function hydrateEvidenceImages() {
    const images = Array.from(document.querySelectorAll("#evidenceGrid img[data-image-ref]"));
    await Promise.all(images.map(async function (image) {
      try {
        const blob = await media.getPhotoBlob(image.dataset.imageRef);
        if (!blob || !image.isConnected) return;
        const url = URL.createObjectURL(blob);
        evidenceObjectUrls.add(url);
        image.src = url;
        const frame = image.closest(".admin-evidence-photo");
        if (frame) frame.classList.add("loaded");
      } catch (error) {
        image.alt = "Photo could not be loaded";
      }
    }));
  }

  function evidencePhoto(item, title, subtitle) {
    const visual = item.imageRef
      ? '<button class="admin-evidence-photo" type="button" aria-label="Enlarge ' + ui.escapeHtml(title) + '"><img data-image-ref="' + ui.escapeHtml(item.imageRef) + '" alt="' + ui.escapeHtml(title) + '" /></button>'
      : '<div class="admin-evidence-photo metadata-only"><span aria-hidden="true">▧</span></div>';
    return '<article class="admin-evidence-card">' + visual + '<div><strong>' + ui.escapeHtml(title) + '</strong><span>' + ui.escapeHtml(subtitle) + '</span>' + (item.caption ? '<p>' + ui.escapeHtml(item.caption) + '</p>' : '') + '</div></article>';
  }

  function renderEvidence() {
    releaseEvidenceUrls();
    const residentEvidence = [];
    reports.forEach(function (report) {
      (Array.isArray(report.evidence) ? report.evidence : (report.evidence ? [report.evidence] : [])).forEach(function (item) {
        residentEvidence.push({ item: item, report: report });
      });
    });
    const fieldEvidence = incident.work && incident.work.evidence || [];
    const total = residentEvidence.length + fieldEvidence.length;
    document.getElementById("evidenceCount").textContent = total
      ? total + " photo " + (total === 1 ? "item" : "items")
      : "No evidence submitted yet.";
    document.getElementById("viewAllEvidence").hidden = !total;
    document.getElementById("evidenceGrid").innerHTML = total
      ? '<section class="evidence-group"><h3>Reported evidence</h3>' + (residentEvidence.length ? '<div class="admin-evidence-grid">' + residentEvidence.map(function (entry) {
          return evidencePhoto(entry.item, "Resident photo · " + entry.report.id, ui.formatTime(entry.item.capturedAt || entry.report.timestamp));
        }).join("") + '</div>' : '<p class="evidence-empty">No resident photo evidence.</p>') + '</section>' +
        '<section class="evidence-group"><h3>Field evidence</h3>' + (fieldEvidence.length ? '<div class="admin-evidence-grid">' + fieldEvidence.map(function (item) {
          const stage = item.stage === "on_site" ? "On site" : "During repair";
          return evidencePhoto(item, item.technicianName || "Technician photo", stage + " · " + ui.formatTime(item.capturedAt));
        }).join("") + '</div>' : '<p class="evidence-empty">No technician repair evidence.</p>') + '</section>'
      : '<div class="evidence-empty">No photo evidence is stored for this incident.</div>';
    hydrateEvidenceImages();
  }

  function pointPosition(point, bounds) {
    return {
      x: 10 + ((number(point.longitude) - bounds.minLng) / bounds.lngSpan) * 80,
      y: 10 + ((bounds.maxLat - number(point.latitude)) / bounds.latSpan) * 80,
    };
  }

  function mapPoints(includeRelated) {
    const points = [];
    if (hasCoordinates(incident)) {
      points.push({ kind: "incident", label: "Incident centre", latitude: incident.latitude, longitude: incident.longitude });
    }
    if (includeRelated) {
      reports.filter(hasCoordinates).forEach(function (report) {
        points.push({ kind: "report", label: report.id, latitude: report.latitude, longitude: report.longitude });
      });
      incident.criticalInfrastructure.filter(hasCoordinates).forEach(function (facility) {
        points.push({ kind: "infrastructure", label: facility.name, latitude: facility.latitude, longitude: facility.longitude });
      });
    }
    return points;
  }

  function mapMarkup(includeRelated) {
    const points = mapPoints(includeRelated);
    if (!points.length) {
      return '<span class="map-empty-note">Location coordinates unavailable</span>';
    }
    const latitudes = points.map(function (point) { return number(point.latitude); });
    const longitudes = points.map(function (point) { return number(point.longitude); });
    const minLat = Math.min.apply(Math, latitudes);
    const maxLat = Math.max.apply(Math, latitudes);
    const minLng = Math.min.apply(Math, longitudes);
    const maxLng = Math.max.apply(Math, longitudes);
    const bounds = {
      minLng: minLng - (maxLng === minLng ? 0.005 : 0),
      maxLat: maxLat + (maxLat === minLat ? 0.005 : 0),
      lngSpan: maxLng === minLng ? 0.01 : maxLng - minLng,
      latSpan: maxLat === minLat ? 0.01 : maxLat - minLat,
    };
    return points.map(function (point) {
      const position = pointPosition(point, bounds);
      const showLabel = point.kind !== "report";
      return '<span class="location-marker location-marker-' + point.kind + '" style="left:' + position.x + "%;top:" + position.y +
        '%" title="' + ui.escapeHtml(point.label) + '" aria-label="' + ui.escapeHtml(point.label) + '"></span>' +
        (showLabel ? '<span class="location-marker-label location-label-' + point.kind + '" style="left:calc(' + position.x +
          '% + 12px);top:calc(' + position.y + '% - 5px)">' + ui.escapeHtml(point.label) + "</span>" : "");
    }).join("");
  }

  function renderLocation() {
    const reportsWithCoordinates = reports.filter(hasCoordinates).length;
    const infrastructureNames = incident.criticalInfrastructure.map(function (item) { return item.name; });
    const coordinates = hasCoordinates(incident)
      ? number(incident.latitude).toFixed(5) + ", " + number(incident.longitude).toFixed(5)
      : "Unavailable";
    document.getElementById("incidentMap").innerHTML = mapMarkup(false);
    document.getElementById("fullIncidentMap").innerHTML = mapMarkup(true);
    document.getElementById("locationSummary").innerHTML =
      '<div class="summary-row"><span>Affected area</span><strong>' + ui.escapeHtml(incident.area) +
      '</strong></div><div class="summary-row"><span>Critical infrastructure</span><strong>' +
      ui.escapeHtml(infrastructureNames.join(", ") || "None detected") + "</strong></div>";
    document.getElementById("locationModalTitle").textContent = incidentName();
    document.getElementById("locationModalSubtitle").textContent = incident.area + ", " + incident.region;
    document.getElementById("fullLocationSummary").innerHTML =
      '<div class="summary-row"><span>Coordinates</span><strong>' + ui.escapeHtml(coordinates) +
      '</strong></div><div class="summary-row"><span>Affected area</span><strong>' + ui.escapeHtml(incident.area) +
      '</strong></div><div class="summary-row"><span>Affected infrastructure</span><strong>' +
      ui.escapeHtml(infrastructureNames.join(", ") || "None detected") +
      '</strong></div><div class="summary-row"><span>Reports with coordinates</span><strong>' + reportsWithCoordinates + " of " + reports.length + "</strong></div>";
    document.getElementById("locationMapLegend").innerHTML =
      '<span><i class="legend-symbol legend-incident"></i>Incident centre</span>' +
      '<span><i class="legend-symbol legend-report"></i>Resident reports (' + reportsWithCoordinates + ")</span>" +
      '<span><i class="legend-symbol legend-infrastructure"></i>Critical infrastructure (' + incident.criticalInfrastructure.filter(hasCoordinates).length + ")</span>";
  }

  function eventTone(event) {
    const text = (event.type + " " + event.message).toLowerCase();
    if (/critical/.test(text)) return "critical";
    if (/reopen|not restored|warning/.test(text)) return "warning";
    if (/resolved|confirmed restored/.test(text)) return "success";
    return "information";
  }

  function timelineMarkup(events, compact) {
    const sorted = events.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    if (!sorted.length) return '<div class="empty-state">No timeline events have been recorded.</div>';
    return sorted.map(function (event) {
      const source = String(event.source || "system").replace(/_/g, " ");
      const timestamp = compact
        ? ui.formatTime(event.timestamp)
        : new Date(event.timestamp).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      return '<div class="timeline-event timeline-event-' + eventTone(event) + '"><span class="timeline-time">' +
        ui.escapeHtml(timestamp) + '</span><span class="timeline-content"><span class="timeline-message">' +
        ui.escapeHtml(event.message) + '</span><span class="timeline-source">' + ui.escapeHtml(source) + "</span></span></div>";
    }).join("");
  }

  function renderTimelines() {
    const latest = incident.timeline.slice().sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    }).slice(0, 3);
    document.getElementById("recentTimeline").innerHTML = timelineMarkup(latest, true);
    document.getElementById("fullTimeline").innerHTML = timelineMarkup(incident.timeline, false);
  }

  function refreshSharedIncident() {
    const updated = ui.getIncident(id);
    if (!updated) return;
    incident = updated;
    reports = ui.getReports(incident);
    renderHeader();
    renderTriage();
    renderStatusControl();
    renderSummary();
    renderPriorityReasons();
    renderEvidence();
    renderLocation();
    renderTimelines();
    renderReportsTable();
  }

  function sourceLabel(report) {
    return report.source === "admin_manual" ? "Admin manual" : "Resident";
  }

  function reportLocation(report) {
    const capture = report.locationCapture || {};
    if (capture.area) return capture.area;
    if (capture.text) return capture.text;
    if (report.latitude !== null && report.longitude !== null) {
      return Number(report.latitude).toFixed(5) + ", " + Number(report.longitude).toFixed(5);
    }
    return "Location unavailable";
  }

  // Step 1 source-of-truth logic is intentionally preserved: this table is
  // rendered from the exact report objects resolved through linkedReportIds.
  function renderReportsTable() {
    document.getElementById("linkedReportRows").innerHTML = reports.length
    ? reports.map(function (report) {
        return "<tr><td>" + ui.escapeHtml(report.id) + "</td><td>" +
          ui.escapeHtml(new Date(report.timestamp).toLocaleString()) + "</td><td>" +
          ui.escapeHtml(sourceLabel(report)) + "</td><td>" + ui.escapeHtml(reportLocation(report)) +
          "</td><td><strong>" + ui.escapeHtml(report.outageType) + "</strong><br><span class=\"muted tiny\">" +
          ui.escapeHtml(report.description) + "</span></td><td>" + ((Array.isArray(report.evidence) ? report.evidence.length : (report.evidence ? 1 : 0)) ? (Array.isArray(report.evidence) ? report.evidence.length : 1) + " photo" : "None") +
          "</td><td>" + ui.escapeHtml(report.incidentId || "Not linked") + "</td></tr>";
      }).join("")
      : '<tr><td colspan="7"><div class="empty-state">No stored human reports are linked to this incident.</div></td></tr>';
  }

  function showTab(name) {
    document.querySelectorAll(".tab-button[data-tab]").forEach(function (button) {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      panel.hidden = panel.id !== "panel-" + name;
    });
  }

  function openModal(overlay, dialog, opener) {
    modalReturnFocus = opener || document.activeElement;
    activeModal = { overlay: overlay, dialog: dialog };
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(function () { dialog.focus(); }, 0);
  }

  function closeModal(overlay) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    activeModal = null;
    if (modalReturnFocus && typeof modalReturnFocus.focus === "function") modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function commitStatus(nextStatus) {
    const valid = nextStatuses();
    if (!valid.includes(nextStatus)) {
      message.textContent = "That status transition is not permitted from " + incident.status + ".";
      return;
    }
    const previousStatus = incident.status;
    const updated = store.updateIncident(incident.id, { status: nextStatus }, {
      type: "STATUS_CHANGED",
      message: "Admin changed status: " + previousStatus + " → " + nextStatus + ".",
      source: "admin",
      metadata: { previousStatus: previousStatus, nextStatus: nextStatus },
    });
    if (!updated) {
      message.textContent = "This incident is read-only.";
      return;
    }
    incident = ui.getIncident(id);
    message.textContent = "Incident status updated to " + nextStatus + ".";
    renderHeader();
    renderStatusControl();
    renderSummary();
    renderTimelines();
  }

  changeStatusButton.addEventListener("click", function () {
    statusEditor.hidden = false;
    changeStatusButton.hidden = true;
    statusSelect.focus();
  });
  cancelStatusButton.addEventListener("click", function () {
    statusEditor.hidden = true;
    changeStatusButton.hidden = false;
    statusSelect.value = "";
    applyStatusButton.disabled = true;
    changeStatusButton.focus();
  });
  statusSelect.addEventListener("change", function () {
    applyStatusButton.disabled = !statusSelect.value;
  });
  applyStatusButton.addEventListener("click", function () {
    const nextStatus = statusSelect.value;
    if (!nextStatuses().includes(nextStatus)) {
      message.textContent = "Select a valid next status.";
      return;
    }
    if (CONSEQUENTIAL_STATUSES.includes(nextStatus)) {
      pendingStatus = nextStatus;
      document.getElementById("statusConfirmText").textContent =
        "Change incident " + incidentName() + " from " + incident.status + " to " + nextStatus + "?";
      openModal(statusConfirmModal, statusConfirmDialog, applyStatusButton);
      document.getElementById("statusConfirmCancel").focus();
      return;
    }
    commitStatus(nextStatus);
    changeStatusButton.hidden = false;
  });

  document.getElementById("statusConfirmCancel").addEventListener("click", function () {
    pendingStatus = null;
    closeModal(statusConfirmModal);
  });
  document.getElementById("statusConfirmApply").addEventListener("click", function () {
    const nextStatus = pendingStatus;
    pendingStatus = null;
    closeModal(statusConfirmModal);
    if (nextStatus) commitStatus(nextStatus);
    changeStatusButton.hidden = false;
  });

  document.querySelectorAll(".tab-button[data-tab]").forEach(function (button) {
    button.addEventListener("click", function () { showTab(button.dataset.tab); });
  });
  document.querySelectorAll("[data-open-tab]").forEach(function (button) {
    button.addEventListener("click", function () { showTab(button.dataset.openTab); });
  });
  document.getElementById("evidenceGrid").addEventListener("click", function (event) {
    const photo = event.target.closest(".admin-evidence-photo[type='button']");
    if (photo) photo.classList.toggle("expanded");
  });
  window.addEventListener("pagehide", releaseEvidenceUrls);

  document.getElementById("approveRecommendation").addEventListener("click", function () {
    const updated = store.approveIncidentPriority(incident.id, incident.triage.recommendation.priority, "Admin");
    const technician = updated && updated.assignment && store.getTechnician(updated.assignment.technicianId);
    message.textContent = updated ? (technician ? "Recommended priority approved. " + technician.name + " was assigned automatically." : "Recommended priority approved. No eligible technician is currently available; dispatch attention is required.") : "The review could not be approved.";
    refreshSharedIncident();
  });
  document.getElementById("approveSelectedPriority").addEventListener("click", function () {
    const selected = document.getElementById("adminPrioritySelect").value;
    const updated = store.approveIncidentPriority(incident.id, selected, "Admin");
    const technician = updated && updated.assignment && store.getTechnician(updated.assignment.technicianId);
    message.textContent = updated ? ("Operational priority " + selected + " approved. " + (technician ? technician.name + " was assigned automatically." : "No eligible technician is currently available; dispatch attention is required.")) : "The selected priority could not be approved.";
    refreshSharedIncident();
  });
  document.getElementById("deferReview").addEventListener("click", function () {
    const updated = store.deferIncidentReview(incident.id, "Admin");
    message.textContent = updated ? "Incident saved for later Admin review." : "This incident cannot be deferred in its current state.";
    refreshSharedIncident();
  });

  store.subscribeToStore(function (change) {
    if (["incidents", "reports", "signals", "store"].includes(change.domain)) refreshSharedIncident();
  });
  window.addEventListener("focus", refreshSharedIncident);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshSharedIncident();
  });

  document.getElementById("locationMapTrigger").addEventListener("click", function () {
    openModal(locationModal, locationDialog, this);
  });
  document.getElementById("locationModalClose").addEventListener("click", function () { closeModal(locationModal); });
  document.getElementById("locationModalDone").addEventListener("click", function () { closeModal(locationModal); });
  [locationModal, statusConfirmModal].forEach(function (overlay) {
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        if (overlay === statusConfirmModal) pendingStatus = null;
        closeModal(overlay);
      }
    });
  });

  document.addEventListener("keydown", function (event) {
    if (!activeModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (activeModal.overlay === statusConfirmModal) pendingStatus = null;
      closeModal(activeModal.overlay);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(activeModal.dialog.querySelectorAll('button:not([disabled]), a[href], select:not([disabled])'));
    if (!focusable.length) {
      event.preventDefault();
      activeModal.dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !activeModal.dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeModal.dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  renderHeader();
  renderTriage();
  renderStatusControl();
  renderSummary();
  renderPriorityReasons();
  renderEvidence();
  renderLocation();
  renderTimelines();
  renderReportsTable();
})();
