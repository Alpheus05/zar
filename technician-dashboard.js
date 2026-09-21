(function () {
  "use strict";

  const store = window.SecureReportStore;
  const media = window.SecureReportMedia;
  const camera = window.PowerGridCamera;
  const currentUser = store.getCurrentUser();
  const technician = currentUser && store.getTechnician(currentUser.id);
  const queueBody = document.getElementById("queueBody");
  const detailPane = document.getElementById("detailPane");
  const tabs = document.getElementById("tabs");
  const priorityFilter = document.getElementById("priorityFilter");
  const jobSearch = document.getElementById("jobSearch");
  const dialog = document.getElementById("actionDialog");
  const dialogForm = document.getElementById("dialogForm");
  let dialogHandler = null;
  let selectedId = null;
  let activeTab = "active";
  const evidenceObjectUrls = new Set();

  const TAB_LABELS = { active: "All", awaiting: "Awaiting acceptance", progress: "In progress", completed: "Completed" };
  const PRIORITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const CHECKLISTS = {
    transformer: ["Isolate and secure the transformer area", "Inspect protection and fuse condition", "Test input and output readings", "Complete repair and safety checks"],
    cable: ["Establish a safe exclusion zone", "Identify and isolate the damaged cable", "Repair or replace the damaged section", "Test supply before re-energising"],
    meter: ["Confirm supply at the service point", "Inspect meter and enclosure", "Test connections and protection", "Record readings and corrective work"],
    area: ["Confirm affected feeder or circuit", "Inspect upstream protection", "Locate and repair the fault", "Test phased restoration"],
    generic: ["Confirm the reported fault on site", "Make the area electrically safe", "Diagnose and repair the fault", "Test the restored supply"],
  };
  const GUIDANCE = {
    transformer: { action: "Inspect transformer protection, fuses, terminals and operating condition.", safety: "Treat all transformer equipment as energised until isolated and proved safe.", crew: "Authorised electrical crew, PPE and transformer test equipment." },
    cable: { action: "Locate, isolate and repair the affected cable section.", safety: "Establish an exclusion zone and prove the cable dead before work begins.", crew: "Cable repair crew, PPE, test instruments and jointing equipment." },
    meter: { action: "Inspect the service connection, meter and protection devices.", safety: "Isolate the customer installation before opening the meter enclosure.", crew: "Meter technician, PPE and approved test instruments." },
    area: { action: "Trace the affected feeder and restore supply in controlled stages.", safety: "Coordinate switching and confirm isolation before field work.", crew: "Electrical response crew, switching authority and fault-location equipment." },
    generic: { action: "Verify the fault, make the area safe and complete the required repair.", safety: "Follow municipal electrical isolation and PPE procedures.", crew: "Appropriately authorised electrical crew and standard fault equipment." },
  };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function area(incident) {
    const captureReport = store.getLinkedReports(incident).find(function (report) {
      return report.locationCapture && (report.locationCapture.area || report.locationCapture.text);
    });
    if (incident.area) return incident.area + (incident.region ? ", " + incident.region : "");
    if (captureReport) return captureReport.locationCapture.area || captureReport.locationCapture.text;
    if (incident.latitude !== null && incident.longitude !== null) return Number(incident.latitude).toFixed(5) + ", " + Number(incident.longitude).toFixed(5);
    return "Location pending";
  }

  function relativeTime(timestamp) {
    const difference = Math.max(0, Date.now() - new Date(timestamp).getTime());
    const minutes = Math.floor(difference / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function statusClass(status) {
    return "status-" + String(status || "Unknown").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  }

  function isToday(timestamp) {
    const date = new Date(timestamp);
    return !Number.isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
  }

  function faultKey(incident) {
    const text = String(incident.outageType || "").toLowerCase();
    if (/transformer|substation/.test(text)) return "transformer";
    if (/cable|wire|line|pole/.test(text)) return "cable";
    if (/meter|household|service/.test(text)) return "meter";
    if (/area|power outage|supply|feeder/.test(text)) return "area";
    return "generic";
  }

  function checklist(incident) {
    const saved = incident.work && incident.work.checklist || [];
    if (saved.length) return saved;
    return CHECKLISTS[faultKey(incident)].map(function (text, index) {
      return { id: "STEP-" + String(index + 1).padStart(2, "0"), text: text, done: false, completedAt: null, completedBy: null };
    });
  }

  function allJobs() {
    if (!technician) return [];
    return store.getJobsForTechnician(technician.id, true).sort(function (a, b) {
      return (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0) || new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  function inTab(incident, tab) {
    const accepted = incident.assignment && incident.assignment.acceptedAt;
    if (tab === "awaiting") return incident.status === "Assigned" && !accepted;
    if (tab === "progress") return ["En Route", "On Site", "Repairing"].includes(incident.status) || (incident.status === "Assigned" && accepted);
    if (tab === "completed") return ["Repair Completed", "Awaiting Confirmation", "Resolved"].includes(incident.status);
    return incident.status !== "Resolved" && incident.status !== "Reopened";
  }

  function filteredJobs() {
    const priority = priorityFilter.value;
    const query = jobSearch.value.trim().toLowerCase();
    return allJobs().filter(function (incident) {
      if (!inTab(incident, activeTab)) return false;
      if (priority !== "all" && incident.priority !== priority) return false;
      return !query || [incident.id, incident.outageType, area(incident)].join(" ").toLowerCase().includes(query);
    });
  }

  function renderSummary() {
    const jobs = allJobs();
    document.getElementById("summaryAssigned").textContent = jobs.filter(function (item) {
      return item.status !== "Resolved" && item.status !== "Reopened";
    }).length;
    document.getElementById("summaryAwaiting").textContent = jobs.filter(function (item) { return inTab(item, "awaiting"); }).length;
    document.getElementById("summaryProgress").textContent = jobs.filter(function (item) { return inTab(item, "progress"); }).length;
    document.getElementById("summaryCompleted").textContent = jobs.filter(function (item) {
      if (!["Repair Completed", "Awaiting Confirmation", "Resolved"].includes(item.status)) return false;
      const event = (item.timeline || []).slice().reverse().find(function (entry) { return ["REPAIR_COMPLETED", "INCIDENT_RESOLVED"].includes(entry.type); });
      return isToday(event ? event.timestamp : item.updatedAt);
    }).length;
  }

  function renderTabs() {
    const jobs = allJobs();
    tabs.innerHTML = Object.keys(TAB_LABELS).map(function (key) {
      const count = jobs.filter(function (incident) { return inTab(incident, key); }).length;
      return '<button class="tab' + (key === activeTab ? " active" : "") + '" type="button" data-tab="' + key + '">' + escapeHtml(TAB_LABELS[key]) + " (" + count + ")</button>";
    }).join("");
  }

  function renderQueue() {
    const jobs = filteredJobs();
    document.getElementById("jobCount").textContent = jobs.length + (jobs.length === 1 ? " assigned incident" : " assigned incidents");
    if (!jobs.length) {
      queueBody.innerHTML = '<div class="empty"><strong>No assigned jobs in this view.</strong><p>Assignments made by Admin will appear here.</p></div>';
      return;
    }
    queueBody.innerHTML = '<ul class="job-list">' + jobs.map(function (incident) {
      const reportCount = store.getLinkedReports(incident).length;
      return '<li><button class="job-row priority-' + escapeHtml(incident.priority) + (incident.id === selectedId ? " selected" : "") + '" type="button" data-action="select" data-id="' + escapeHtml(incident.id) + '">' +
        '<span class="job-top"><strong>' + escapeHtml(incident.id) + '</strong><span class="priority ' + escapeHtml(incident.priority) + '">' + escapeHtml(incident.priority) + '</span></span>' +
        '<h3>' + escapeHtml(incident.outageType) + '</h3><span class="job-location">' + escapeHtml(area(incident)) + '</span>' +
        '<span class="job-meta"><span class="status ' + statusClass(incident.status) + '">' + escapeHtml(incident.status) + '</span><span class="assigned-time">Assigned ' + escapeHtml(relativeTime(incident.assignment.assignedAt)) + '</span></span>' +
        '<span class="job-bottom"><span>' + reportCount + (reportCount === 1 ? " report" : " reports") + ' &middot; ' + (incident.linkedSignals || []).length + ' meter signals</span><span>Updated ' + escapeHtml(relativeTime(incident.updatedAt)) + '</span></span></button></li>';
    }).join("") + "</ul>";
  }

  function primaryAction(incident) {
    const accepted = incident.assignment && incident.assignment.acceptedAt;
    if (incident.status === "Assigned" && !accepted) return { action: "accept", label: "Accept job" };
    if (incident.status === "Assigned" && accepted) return { action: "enroute", label: "I am on my way" };
    if (incident.status === "En Route") return { action: "onsite", label: "Arrived / On site" };
    if (incident.status === "On Site") return { action: "repairing", label: "Start repair" };
    if (incident.status === "Repairing") return { action: "complete", label: "Complete repair" };
    return null;
  }

  function renderReports(incident) {
    const reports = store.getLinkedReports(incident).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    return '<ul class="reports">' + reports.map(function (report) {
      const source = report.source === "admin_manual" ? "Admin manual" : "Resident report";
      const evidenceCount = Array.isArray(report.evidence) ? report.evidence.length : (report.evidence ? 1 : 0);
      return '<li><div class="report-top"><strong>' + escapeHtml(report.id) + '</strong><span>' + escapeHtml(source) + '</span><time>' + escapeHtml(relativeTime(report.timestamp)) + '</time></div><p>' + escapeHtml(report.description || report.outageType) + '</p><small>' + (evidenceCount ? evidenceCount + (evidenceCount === 1 ? " photo attached" : " photos attached") : "Evidence: None") + '</small></li>';
    }).join("") + "</ul>";
  }

  function releaseEvidenceUrls() {
    evidenceObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    evidenceObjectUrls.clear();
  }

  async function hydrateEvidenceImages(root) {
    const images = Array.from(root.querySelectorAll("img[data-image-ref]"));
    await Promise.all(images.map(async function (image) {
      try {
        const blob = await media.getPhotoBlob(image.dataset.imageRef);
        if (!blob || !image.isConnected) return;
        const url = URL.createObjectURL(blob);
        evidenceObjectUrls.add(url);
        image.src = url;
        const frame = image.closest(".field-evidence-photo");
        if (frame) frame.classList.add("loaded");
      } catch (error) {
        image.alt = "Photo could not be loaded";
      }
    }));
  }

  function renderFieldEvidence(evidence) {
    if (!evidence.length) return '<p class="section-note">No repair photo evidence has been recorded yet.</p>';
    return '<div class="field-evidence-grid">' + evidence.map(function (item) {
      const stage = item.stage === "on_site" ? "On site" : "During repair";
      return '<article class="field-evidence-card"><button class="field-evidence-photo" type="button" data-action="view-evidence" aria-label="Enlarge repair photo"><img data-image-ref="' + escapeHtml(item.imageRef) + '" alt="Repair evidence captured by ' + escapeHtml(item.technicianName || technician.name) + '" /></button><div><strong>' + escapeHtml(item.technicianName || technician.name) + '</strong><span>' + escapeHtml(stage) + ' · ' + escapeHtml(formatDate(item.capturedAt)) + '</span>' + (item.caption ? '<p>' + escapeHtml(item.caption) + '</p>' : '') + '</div></article>';
    }).join("") + "</div>";
  }

  function renderTimeline(incident) {
    const events = (incident.timeline || []).slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).slice(0, 12);
    if (!events.length) return '<p class="section-note">No activity recorded yet.</p>';
    return '<ul class="timeline">' + events.map(function (event) {
      return '<li><div class="timeline-top"><time>' + escapeHtml(formatDate(event.timestamp)) + '</time><strong>' + escapeHtml(event.source || "system") + '</strong></div><p>' + escapeHtml(event.message) + '</p></li>';
    }).join("") + "</ul>";
  }

  function renderDetail() {
    releaseEvidenceUrls();
    const incident = selectedId ? store.getIncident(selectedId) : null;
    if (!incident || !incident.assignment || incident.assignment.technicianId !== technician.id) {
      selectedId = null;
      document.body.dataset.screen = "queue";
      detailPane.innerHTML = '<div class="empty"><h2>Select an assigned job</h2><p>Open a job to review the required action, safety guidance and shared timeline.</p></div>';
      return;
    }
    const reports = store.getLinkedReports(incident);
    const steps = checklist(incident);
    const done = steps.filter(function (step) { return step.done; }).length;
    const progress = steps.length ? Math.round(done / steps.length * 100) : 0;
    const guidance = GUIDANCE[faultKey(incident)];
    const action = primaryAction(incident);
    const assignment = incident.assignment;
    const canWork = assignment.acceptedAt && !["Awaiting Confirmation", "Resolved"].includes(incident.status);
    const canRequest = ["Assigned", "En Route", "On Site", "Repairing"].includes(incident.status);
    const backupPending = incident.backupRequest && incident.backupRequest.status === "pending_admin_review";
    const reassignPending = incident.reassignmentRequest && incident.reassignmentRequest.status === "pending_admin_review";
    const falseAlarmPending = incident.falseAlarmReview && incident.falseAlarmReview.status === "pending_admin_review";
    const navigateQuery = incident.latitude !== null && incident.longitude !== null ? incident.latitude + "," + incident.longitude : area(incident);
    const latestReport = reports.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })[0];
    const latestNote = (incident.timeline || []).slice().reverse().find(function (event) { return event.type === "TECHNICIAN_NOTE" || /note/i.test(event.type || ""); });
    const priorityReasons = (incident.priorityReasons || []).slice(0, 4);
    const completionTime = incident.work && incident.work.completedAt || incident.updatedAt;
    const outcome = incident.work && incident.work.outcome;
    const fieldEvidence = incident.work && incident.work.evidence || [];
    const canAddEvidence = Boolean(assignment.acceptedAt && ["On Site", "Repairing"].includes(incident.status));
    const completionCopy = incident.status === "Resolved"
      ? '<div class="completion-state"><strong>✓ Resolved</strong><br>Completed ' + escapeHtml(formatDate(completionTime)) + (outcome ? '<br>Outcome: ' + escapeHtml(outcome) : "") + '<br>Confirmed by resident</div>'
      : (["Repair Completed", "Awaiting Confirmation"].includes(incident.status) ? '<div class="completion-state"><strong>✓ Repair completed</strong><br>' + (outcome ? 'Outcome: ' + escapeHtml(outcome) + '<br>' : "") + 'Awaiting resident confirmation</div>' : "");

    detailPane.innerHTML = '<article class="detail-card">' +
      '<section class="detail-section detail-head"><button class="mobile-back" type="button" data-action="back">← Back to jobs</button><p class="detail-id">' + escapeHtml(incident.id) + '</p>' +
      '<div class="detail-title-row"><div><h2>' + escapeHtml(incident.outageType) + '</h2><p class="detail-sub">' + escapeHtml(area(incident)) + '</p></div><div class="detail-state"><span class="priority ' + escapeHtml(incident.priority) + '">' + escapeHtml(incident.priority) + '</span><span class="status ' + statusClass(incident.status) + '">' + escapeHtml(incident.status) + '</span></div></div>' +
      '<div class="assignment-line"><span>' + (assignment.acceptedAt ? "Assignment accepted" : "New assignment") + '</span><span>Assigned by ' + escapeHtml(assignment.assignedBy || "Admin") + ' · ' + escapeHtml(relativeTime(assignment.assignedAt)) + '</span></div>' +
      '<div class="action-row">' + (action ? '<button class="btn primary" type="button" data-action="' + action.action + '">' + action.label + '</button>' : '') + '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(navigateQuery) + '">Open directions</a></div>' + completionCopy + '</section>' +
      '<section class="detail-section"><h2 class="section-title">Incident Summary</h2><div class="info-grid"><div class="fact"><h3>Location</h3><p>' + escapeHtml(area(incident)) + '</p></div><div class="fact"><h3>Outage type</h3><p>' + escapeHtml(incident.outageType) + '</p></div><div class="fact"><h3>Priority</h3><p><span class="priority ' + escapeHtml(incident.priority) + '">' + escapeHtml(incident.priority) + '</span></p></div><div class="fact"><h3>Resident reports</h3><p><strong>' + reports.length + '</strong> linked</p></div><div class="fact"><h3>Meter signals</h3><p><strong>' + (incident.linkedSignals || []).length + '</strong> linked</p></div><div class="fact"><h3>Current status</h3><p><span class="status ' + statusClass(incident.status) + '">' + escapeHtml(incident.status) + '</span></p></div></div>' +
      (priorityReasons.length ? '<ul class="reason-list" aria-label="Priority reasons">' + priorityReasons.map(function (reason) { return '<li>' + escapeHtml(reason) + '</li>'; }).join("") + '</ul>' : "") + '</section>' +
      '<section class="detail-section"><h2 class="section-title">Safety &amp; Action</h2><div class="safety"><strong>⚠ Safety first</strong><br>' + escapeHtml(guidance.safety) + '</div><div class="guidance-grid"><div class="guidance-block"><h3>Required action</h3><p>' + escapeHtml(guidance.action) + '</p></div><div class="guidance-block"><h3>Crew / equipment</h3><p>' + escapeHtml(guidance.crew) + '</p></div></div></section>' +
      '<section class="detail-section"><h2 class="section-title">Work Progress</h2><div class="progress-head"><span>Work checklist</span><strong>' + done + ' of ' + steps.length + ' completed · ' + progress + '%</strong></div><div class="progress-bar" aria-label="Work progress ' + progress + ' percent"><span style="width:' + progress + '%"></span></div><ul class="checks">' + steps.map(function (step, index) { return '<li><label class="check"><input type="checkbox" data-action="check" data-index="' + index + '" ' + (step.done ? "checked" : "") + (canWork ? "" : " disabled") + ' /><span>' + escapeHtml(step.text) + '</span></label></li>'; }).join("") + '</ul></section>' +
      '<section class="detail-section"><h2 class="section-title">Evidence / Reports</h2><div class="evidence-summary"><div class="fact"><h3>Resident reports</h3><p><strong>' + reports.length + '</strong></p></div><div class="fact"><h3>Smart-meter signals</h3><p><strong>' + (incident.linkedSignals || []).length + '</strong></p></div>' + (latestReport ? '<p class="latest-report"><strong>Latest report</strong><br>“' + escapeHtml(latestReport.description || latestReport.outageType) + '”</p>' : '<p class="latest-report">No linked resident reports.</p>') + '</div>' + (reports.length ? '<details class="reports-disclosure"><summary>View reports</summary>' + renderReports(incident) + '</details>' : "") + '</section>' +
      '<section class="detail-section"><div class="section-title-row"><div><p class="eyebrow">Repair evidence</p><h2 class="section-title">Field Evidence</h2></div><span class="evidence-count">' + fieldEvidence.length + (fieldEvidence.length === 1 ? " photo" : " photos") + '</span></div>' +
      (canAddEvidence ? '<div class="field-camera-controls"><label><span>Optional caption</span><input id="evidenceCaption" maxlength="160" placeholder="E.g. Replacement breaker installed" /></label><button class="btn primary" type="button" data-action="equipment-photo"><span aria-hidden="true">&#128247;</span> Take equipment photo</button></div>' : '<p class="section-note">New repair photos can be captured while the job is On Site or Repairing.</p>') + renderFieldEvidence(fieldEvidence) + '</section>' +
      '<section class="detail-section"><h2 class="section-title">Job Notes</h2><p class="note-preview">' + (latestNote ? 'Latest: “' + escapeHtml(latestNote.message) + '”<br>' + escapeHtml(formatDate(latestNote.timestamp)) : "No technician notes yet.") + '</p><button class="btn" type="button" data-action="toggle-note">Add note</button><form class="note-form" id="noteForm" hidden><label class="sr" for="noteInput">Add technician note</label><input id="noteInput" required placeholder="Note visible to Admin" /><button class="btn primary" type="submit">Save note</button></form></section>' +
      '<section class="detail-section"><h2 class="section-title">Job Activity</h2>' + renderTimeline(incident) + '</section>' +
      '<section class="detail-section"><h2 class="section-title">Operational Requests</h2><div class="request-grid"><div class="request-action"><strong>' + (backupPending ? "⚠ Backup requested" : "Need additional assistance?") + '</strong><p>' + (backupPending ? "Waiting for control room response." : "Request another crew or specialist equipment.") + '</p><button class="btn" type="button" data-action="backup" ' + (!canRequest || backupPending ? "disabled" : "") + '>Request backup</button></div><div class="request-action"><strong>' + (reassignPending ? "⚠ Reassignment requested" : "Cannot continue this job?") + '</strong><p>' + (reassignPending ? "Waiting for Admin review." : "Send a reason to the control room.") + '</p><button class="btn" type="button" data-action="reassign" ' + (!canRequest || reassignPending ? "disabled" : "") + '>Request reassignment</button></div><div class="request-action"><strong>' + (falseAlarmPending ? "⚠ False-alarm review requested" : "Possible false alarm?") + '</strong><p>' + (falseAlarmPending ? "Waiting for Admin decision." : "Submit the on-site finding for review.") + '</p><button class="btn warn" type="button" data-action="falsealarm" ' + (!canRequest || falseAlarmPending ? "disabled" : "") + '>Request review</button></div></div>' + (incident.attentionFlag ? '<p class="attention">Pending Admin attention: ' + escapeHtml(incident.attentionFlag.message || incident.attentionFlag.type) + '</p>' : '') + '</section></article>';

    hydrateEvidenceImages(detailPane);

    document.getElementById("noteForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const input = document.getElementById("noteInput");
      if (store.addTechnicianNote(incident.id, technician.id, input.value)) { toast("Note added to the shared incident timeline."); refresh(); }
    });
  }

  function render() { renderSummary(); renderTabs(); renderQueue(); renderDetail(); }
  function refresh() {
    if (selectedId && !store.getJobsForTechnician(technician.id, true).some(function (incident) { return incident.id === selectedId; })) selectedId = null;
    render();
  }

  function toast(message) {
    const element = document.getElementById("toast");
    element.textContent = message;
    element.classList.add("show");
    window.setTimeout(function () { element.classList.remove("show"); }, 2800);
  }

  function openDialog(options) {
    document.getElementById("dialogTitle").textContent = options.title;
    document.getElementById("dialogBody").innerHTML = options.body;
    document.getElementById("dialogSubmit").textContent = options.submit || "Save";
    dialogHandler = options.onSubmit;
    dialog.showModal();
    const first = dialogForm.querySelector("textarea, select, input");
    if (first) first.focus();
  }

  function transition(action) {
    const incident = store.getIncident(selectedId);
    let updated = null;
    if (action === "accept") updated = store.acceptTechnicianAssignment(incident.id, technician.id);
    if (action === "enroute") updated = store.updateTechnicianStatus(incident.id, technician.id, "En Route");
    if (action === "onsite") updated = store.updateTechnicianStatus(incident.id, technician.id, "On Site");
    if (action === "repairing") updated = store.updateTechnicianStatus(incident.id, technician.id, "Repairing");
    if (!updated) return toast("That workflow step is not available.");
    toast(action === "accept" ? "Assignment accepted." : "Shared incident status updated to " + updated.status + ".");
    refresh();
  }

  function openCompletionDialog() {
    const incident = store.getIncident(selectedId);
    const incomplete = checklist(incident).filter(function (step) { return !step.done; }).length;
    openDialog({
      title: "Complete repair for " + incident.id,
      submit: "Repair completed",
      body: '<label><span>Work outcome</span><select name="outcome" required><option value="">Select outcome</option><option>Fault repaired</option><option>Damaged component replaced</option><option>Supply restored after isolation and test</option><option>Made safe; follow-up work required</option></select></label><label><span>Repair notes</span><textarea name="notes" rows="4" required placeholder="Parts used, readings and work completed"></textarea></label>' + (incomplete ? '<p class="attention">' + incomplete + ' checklist step(s) are not complete. Confirm the record before submission.</p>' : ''),
      onSubmit: function (data) {
        const updated = store.completeTechnicianRepair(incident.id, technician.id, data.outcome, data.notes);
        if (!updated) return false;
        toast("Repair recorded. Awaiting resident confirmation.");
        refresh();
      },
    });
  }

  queueBody.addEventListener("click", function (event) {
    const button = event.target.closest('[data-action="select"]');
    if (!button) return;
    selectedId = button.dataset.id;
    document.body.dataset.screen = "detail";
    render();
    if (window.innerWidth <= 760) window.scrollTo({ top: 0, behavior: "smooth" });
  });
  tabs.addEventListener("click", function (event) {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    activeTab = button.dataset.tab;
    render();
  });
  priorityFilter.addEventListener("change", render);
  jobSearch.addEventListener("input", render);
  detailPane.addEventListener("click", async function (event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "back") { document.body.dataset.screen = "queue"; return; }
    if (action === "toggle-note") {
      const form = document.getElementById("noteForm");
      form.hidden = !form.hidden;
      target.textContent = form.hidden ? "Add note" : "Cancel";
      if (!form.hidden) document.getElementById("noteInput").focus();
      return;
    }
    if (["accept", "enroute", "onsite", "repairing"].includes(action)) return transition(action);
    if (action === "complete") return openCompletionDialog();
    if (action === "view-evidence") {
      target.classList.toggle("expanded");
      return;
    }
    if (action === "equipment-photo") {
      const incident = store.getIncident(selectedId);
      const captionInput = document.getElementById("evidenceCaption");
      try {
        const capture = await camera.open({
          title: "Take equipment photo",
          hint: "Frame the inspected or repaired component clearly.",
        });
        if (!capture) return;
        const saved = await media.savePhotoBlob(capture.blob, capture);
        const updated = store.addTechnicianEvidence(incident.id, technician.id, {
          imageRef: saved.id,
          capturedAt: saved.capturedAt,
          mimeType: saved.type,
          size: saved.size,
          width: saved.width,
          height: saved.height,
          caption: captionInput ? captionInput.value.trim() : "",
        });
        if (!updated) {
          await media.deletePhotoBlob(saved.id);
          toast("Photo evidence is not permitted at this workflow stage.");
          return;
        }
        toast("Repair photo added to the canonical incident.");
        refresh();
      } catch (error) {
        console.error("Technician photo capture failed", error);
        toast("The repair photo could not be stored. Please try again.");
      }
      return;
    }
    if (action === "check") {
      const incident = store.getIncident(selectedId);
      const steps = checklist(incident);
      const step = steps[Number(target.dataset.index)];
      step.done = target.checked;
      step.completedAt = target.checked ? new Date().toISOString() : null;
      step.completedBy = target.checked ? technician.id : null;
      if (store.saveTechnicianChecklist(incident.id, technician.id, steps)) { toast("Checklist saved on the incident."); refresh(); }
      return;
    }
    if (action === "backup") openDialog({ title: "Request backup", submit: "Send request", body: '<label><span>What support is needed?</span><textarea name="reason" rows="3" required placeholder="Crew, equipment or specialist support"></textarea></label>', onSubmit: function (data) { const updated = store.requestTechnicianBackup(selectedId, technician.id, data.reason); if (!updated) return false; toast("Backup request sent for Admin review."); refresh(); } });
    if (action === "reassign") openDialog({ title: "Request reassignment", submit: "Send request", body: '<label><span>Reason</span><select name="reason" required><option>Vehicle problem</option><option>Wrong skill set</option><option>Shift ending</option><option>Additional specialist needed</option><option>Other</option></select></label><label><span>Details</span><textarea name="details" rows="3" required placeholder="Explain what Admin needs to know"></textarea></label>', onSubmit: function (data) { const updated = store.requestTechnicianReassignment(selectedId, technician.id, data.reason, data.details); if (!updated) return false; toast("Reassignment request sent to Admin."); refresh(); } });
    if (action === "falsealarm") openDialog({ title: "Report possible false alarm", submit: "Request Admin review", body: '<p>This does not close the incident. Admin must review the finding.</p><label><span>What did you find?</span><textarea name="reason" rows="4" required placeholder="Describe the on-site finding"></textarea></label>', onSubmit: function (data) { const updated = store.requestFalseAlarmReview(selectedId, technician.id, data.reason); if (!updated) return false; toast("False-alarm review requested."); refresh(); } });
  });

  dialogForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(dialogForm));
    if (dialogHandler && dialogHandler(data) === false) return;
    dialog.close();
    dialogHandler = null;
  });
  document.getElementById("dialogCancel").addEventListener("click", function () { dialog.close(); dialogHandler = null; });
  window.addEventListener("pagehide", releaseEvidenceUrls);

  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const menuButton = document.getElementById("menuBtn");
  function closeSidebar() { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("open"); menuButton.setAttribute("aria-expanded", "false"); }
  menuButton.addEventListener("click", function () { const open = sidebar.classList.toggle("open"); sidebarOverlay.classList.toggle("open", open); menuButton.setAttribute("aria-expanded", String(open)); });
  sidebarOverlay.addEventListener("click", closeSidebar);
  document.querySelectorAll("[data-sidebar-tab]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      activeTab = link.dataset.sidebarTab;
      document.body.dataset.screen = "queue";
      document.querySelectorAll("[data-sidebar-tab]").forEach(function (item) { item.classList.toggle("active", item === link); });
      closeSidebar();
      render();
    });
  });

  store.subscribeToStore(function (change) {
    if (["incidents", "reports", "signals", "store"].includes(change.domain)) refresh();
  });
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });

  if (!technician) {
    queueBody.innerHTML = '<div class="empty"><strong>Technician session unavailable.</strong></div>';
    detailPane.innerHTML = '<div class="empty"><p>A valid technician identity is required to continue.</p></div>';
    return;
  }
  document.getElementById("techName").textContent = technician.name;
  document.getElementById("headerTechName").textContent = technician.name;
  document.getElementById("techMeta").textContent = technician.team + " · " + technician.baseArea;
  document.getElementById("techInitials").textContent = technician.name.split(/\s+/).map(function (part) { return part[0]; }).join("").slice(0, 2).toUpperCase();
  render();
})();
