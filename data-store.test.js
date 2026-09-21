const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const storeSource = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-store.js"),
  "utf8",
);
const adminCommonSource = fs.readFileSync(
  path.join(__dirname, "..", "js", "admin-common.js"),
  "utf8",
);

function makeStore(seed) {
  const values = new Map(
    Object.entries(seed || {}).map(function ([key, value]) {
      return [key, JSON.stringify(value)];
    }),
  );
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const listeners = new Map();
  const window = {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach(function (callback) { callback(event); });
      return true;
    },
  };
  class TestCustomEvent {
    constructor(type, options) { this.type = type; this.detail = options && options.detail; }
  }
  const context = vm.createContext({
    console: console,
    localStorage: localStorage,
    window: window,
    CustomEvent: TestCustomEvent,
  });
  vm.runInContext(storeSource, context, { filename: "data-store.js" });
  context.window.SecureReportStore.__testValues = values;
  return context.window.SecureReportStore;
}

function makeAdminUI(store) {
  const context = vm.createContext({
    console: console,
    window: { SecureReportStore: store },
    document: {
      getElementById() { return null; },
      addEventListener() {},
    },
  });
  vm.runInContext(adminCommonSource, context, { filename: "admin-common.js" });
  return context.window.SecureReportAdminUI;
}

async function run() {
  const store = makeStore();
  let storeChangeCount = 0;
  const unsubscribe = store.subscribeToStore(function () { storeChangeCount += 1; });
  const first = store.createReport({
    description: "The whole street has no electricity.",
    outageType: "Power outage",
    issueType: "Public issue",
    latitude: -25.75,
    longitude: 28.19,
    evidence: [{
      id: "EVID-RESIDENT-001",
      type: "photo",
      source: "resident",
      capturedAt: "2026-09-21T10:00:00.000Z",
      imageRef: "PHOTO-RESIDENT-001",
      mimeType: "image/jpeg",
      size: 125000,
      width: 1280,
      height: 960,
    }],
  });

  assert.equal(store.getReports().length, 1);
  assert.equal(store.getIncidents().length, 1);
  assert.equal(first.report.incidentId, first.incident.id);
  assert.equal(first.report.adminReview.acknowledged, false);
  assert.equal(Object.hasOwn(first.report, "status"), false);
  assert.equal(Object.hasOwn(first.report, "priority"), false);
  assert.equal(first.incident.triage.state, "pending");
  assert.ok(["Critical", "High", "Medium", "Low"].includes(first.incident.triage.recommendation.priority));
  assert.equal(first.incident.priority, null);
  assert.equal(first.report.evidence.length, 1);
  assert.equal(first.report.evidence[0].imageRef, "PHOTO-RESIDENT-001");
  assert.equal(store.getReport(first.report.id).evidence[0].source, "resident");
  assert.equal(store.assignTechnician(first.incident.id, "TECH-001", "Test Admin"), null);

  const noLocation = store.createReport({
    description: "An isolated meter problem with no available GPS.",
    outageType: "Prepaid meter problem",
    issueType: "Household issue",
    latitude: null,
    longitude: null,
  });
  assert.equal(noLocation.incident.latitude, null);
  assert.equal(noLocation.incident.longitude, null);

  const duplicate = store.createReport({
    description: "Still no power nearby.",
    outageType: "Power outage",
    issueType: "Household issue",
    latitude: -25.7502,
    longitude: 28.1902,
  });

  assert.equal(duplicate.matched, true);
  assert.equal(store.getIncidents().length, 2);
  assert.equal(store.getReports().length, 3);
  assert.equal(store.getIncident(first.incident.id).linkedReportIds.length, 2);
  assert.ok(
    store
      .getIncident(first.incident.id)
      .timeline.some((event) => event.type === "REPORT_LINKED"),
  );

  const manual = store.createReport({
    source: "admin_manual",
    resident: { name: "Control room operator" },
    contact: { phone: "0120000000", meterAccount: "ACC-DEMO" },
    description: "Caller confirms the same nearby outage.",
    outageType: "Power outage",
    issueType: "Admin manual report",
    latitude: -25.7501,
    longitude: 28.1901,
    locationCapture: { area: "Pretoria West", text: "Pretoria West, Region 3" },
  });
  assert.equal(manual.report.source, "admin_manual");
  assert.equal(manual.report.adminReview.acknowledged, true);
  assert.equal(manual.report.adminReview.acknowledgedBy, "Admin");
  assert.equal(manual.matched, true);
  assert.equal(manual.report.incidentId, first.incident.id);
  assert.equal(store.getLinkedReports(first.incident.id).length, 3);
  assert.equal(store.getIncident(first.incident.id).linkedReportIds.length, 3);
  assert.equal(store.getUnacknowledgedResidentReports().length, 3);
  assert.equal(store.getNextUnacknowledgedReport().id, first.report.id);

  const acknowledged = store.acknowledgeReport(first.report.id, "Test Admin");
  assert.equal(acknowledged.adminReview.acknowledged, true);
  assert.equal(acknowledged.adminReview.acknowledgedBy, "Test Admin");
  assert.equal(store.getUnacknowledgedResidentReports().length, 2);
  assert.ok(
    store
      .getIncident(first.incident.id)
      .timeline.some((event) => event.type === "ADMIN_REVIEWED_REPORT"),
  );

  const different = store.createReport({
    description: "Separate transformer issue.",
    outageType: "Transformer / substation fault",
    issueType: "Public issue",
    latitude: -25.9,
    longitude: 28.4,
  });
  assert.equal(different.matched, false);
  assert.equal(store.getIncidents().length, 3);
  const originalRecommendation = different.incident.triage.recommendation.priority;
  const deferred = store.deferIncidentReview(different.incident.id, "Test Admin");
  assert.equal(deferred.triage.state, "deferred");
  assert.equal(store.canIncidentBeAssigned(deferred), false);
  assert.equal(store.assignTechnician(different.incident.id, "TECH-001", "Test Admin"), null);
  const overridePriority = originalRecommendation === "Medium" ? "High" : "Medium";
  const approvedOverride = store.approveIncidentPriority(different.incident.id, overridePriority, "Test Admin");
  assert.equal(approvedOverride.triage.state, "approved");
  assert.equal(approvedOverride.priority, overridePriority);
  assert.equal(approvedOverride.triage.recommendation.priority, originalRecommendation);
  assert.equal(approvedOverride.status, "Assigned");
  assert.equal(approvedOverride.assignment.technicianId, "TECH-001");
  assert.equal(approvedOverride.assignment.acceptedAt, null);
  assert.equal(approvedOverride.assignment.assignedBy, "System");
  assert.ok(approvedOverride.timeline.some((event) => event.type === "TECHNICIAN_AUTO_ASSIGNED"));
  assert.equal(store.canIncidentBeAssigned(approvedOverride), true);

  const recommendationApproved = store.approveIncidentPriority(first.incident.id, null, "Test Admin");
  assert.equal(recommendationApproved.priority, recommendationApproved.triage.recommendation.priority);
  assert.equal(recommendationApproved.status, "Assigned");
  assert.equal(recommendationApproved.assignment.technicianId, "TECH-002");

  const humanReportCountBeforeMeter = store.getReports().length;
  const meter = store.simulateSmartMeterEvent(first.incident.id);
  assert.equal(meter.matched, true);
  assert.equal(store.getSignals().length, 1);
  assert.equal(store.getReports().length, humanReportCountBeforeMeter);
  assert.ok(
    store
      .getIncident(first.incident.id)
      .timeline.some((event) => event.type === "SMART_METER_SIGNAL"),
  );
  assert.ok(
    store
      .getIncident(first.incident.id)
      .priorityReasons.some((reason) => reason.includes("smart meter")),
  );

  const critical = store.processSmartMeterSignal({
    meterId: "MTR-HOSPITAL",
    status: "offline",
    outageType: "Power outage",
    latitude: -25.7297,
    longitude: 28.2022,
  });
  assert.ok(critical.incident.criticalInfrastructure.length > 0);
  assert.ok(
    critical.incident.priorityReasons.some((reason) =>
      reason.includes("within affected area"),
    ),
  );

  const analysis = await store.analyzeOutageImage({
    name: "evidence.jpg",
    type: "image/jpeg",
    size: 1000,
  });
  assert.equal(analysis.analyzed, false);
  assert.equal(analysis.confidence, null);

  store.setIncidentAwaitingConfirmation(first.incident.id);
  const resolved = store.recordRestorationConfirmation(
    first.incident.id,
    first.report.id,
    true,
  );
  assert.equal(resolved.status, "Resolved");
  assert.equal(resolved.restorationState.positiveCount, 1);

  store.setIncidentAwaitingConfirmation(first.incident.id);
  const reopened = store.recordRestorationConfirmation(
    first.incident.id,
    duplicate.report.id,
    false,
  );
  assert.equal(reopened.status, "Reopened");
  assert.equal(reopened.restorationState.needsReview, true);
  assert.ok(
    reopened.timeline.some((event) => event.type === "INCIDENT_REOPENED"),
  );

  const technicians = store.getTechnicians();
  assert.ok(technicians.some((technician) => technician.id === "TECH-001"));
  assert.equal(store.getCurrentUser().id, "TECH-001");

  const assigned = store.assignTechnician(different.incident.id, "TECH-001", "Test Admin");
  assert.equal(assigned.status, "Assigned");
  assert.equal(assigned.assignment.technicianId, "TECH-001");
  assert.equal(store.getJobsForTechnician("TECH-001", true).length, 1);
  assert.equal(store.getLinkedReports(assigned.id).length, assigned.linkedReportIds.length);

  const noTechnicianStore = makeStore();
  noTechnicianStore.saveTechnicians(noTechnicianStore.getTechnicians().map(function (technician) {
    return Object.assign({}, technician, { status: "unavailable" });
  }));
  const unstaffed = noTechnicianStore.createReport({
    description: "No power and no field team is available.",
    outageType: "Power outage",
    latitude: -25.8,
    longitude: 28.1,
  });
  const unstaffedApproval = noTechnicianStore.approveIncidentPriority(unstaffed.incident.id, null, "Test Admin");
  assert.equal(unstaffedApproval.status, "Awaiting Dispatch");
  assert.equal(unstaffedApproval.assignment.technicianId, null);
  assert.equal(unstaffedApproval.attentionFlag.type, "no_technician_available");

  const acceptedJob = store.acceptTechnicianAssignment(assigned.id, "TECH-001");
  assert.ok(acceptedJob.assignment.acceptedAt);
  assert.ok(acceptedJob.timeline.some((event) => event.type === "TECHNICIAN_ACCEPTED_JOB"));
  assert.equal(store.updateTechnicianStatus(assigned.id, "TECH-002", "En Route"), null);
  assert.equal(store.updateTechnicianStatus(assigned.id, "TECH-001", "En Route").status, "En Route");
  assert.equal(store.updateTechnicianStatus(assigned.id, "TECH-001", "On Site").status, "On Site");

  const notificationCountBeforeEvidence = storeChangeCount;
  const onSiteEvidence = store.addTechnicianEvidence(assigned.id, "TECH-001", {
    imageRef: "PHOTO-TECH-ONSITE",
    capturedAt: "2026-09-21T11:00:00.000Z",
    mimeType: "image/jpeg",
    size: 140000,
    width: 1280,
    height: 960,
    caption: "Damaged breaker before replacement",
  });
  assert.equal(onSiteEvidence.work.evidence.length, 1);
  assert.equal(onSiteEvidence.work.evidence[0].technicianId, "TECH-001");
  assert.equal(onSiteEvidence.work.evidence[0].technicianName, "Lerato Molefe");
  assert.equal(onSiteEvidence.work.evidence[0].stage, "on_site");
  assert.equal(onSiteEvidence.work.evidence[0].capturedAt, "2026-09-21T11:00:00.000Z");
  assert.ok(onSiteEvidence.timeline.some((event) => event.type === "TECHNICIAN_EVIDENCE_ADDED"));
  assert.equal(store.addTechnicianEvidence(assigned.id, "TECH-002", { imageRef: "PHOTO-NOT-ASSIGNED" }), null);
  assert.equal(store.addTechnicianEvidence(first.incident.id, "TECH-001", { imageRef: "PHOTO-UNRELATED" }), null);
  assert.ok(storeChangeCount > notificationCountBeforeEvidence);

  assert.equal(store.updateTechnicianStatus(assigned.id, "TECH-001", "Repairing").status, "Repairing");
  assert.equal(store.updateTechnicianStatus(assigned.id, "TECH-001", "Resolved"), null);

  const repairingEvidence = store.addTechnicianEvidence(assigned.id, "TECH-001", {
    imageRef: "PHOTO-TECH-REPAIRING",
    capturedAt: "2026-09-21T11:15:00.000Z",
    caption: "Replacement breaker installed",
  });
  assert.equal(repairingEvidence.work.evidence.length, 2);
  assert.equal(repairingEvidence.work.evidence[1].stage, "repairing");
  assert.equal(store.getIncident(assigned.id).work.evidence.length, 2);

  const checklistSaved = store.saveTechnicianChecklist(assigned.id, "TECH-001", [
    { id: "STEP-01", text: "Make the area safe", done: true },
    { id: "STEP-02", text: "Test restored supply", done: false },
  ]);
  assert.equal(checklistSaved.work.checklist[0].done, true);
  assert.equal(store.getIncident(assigned.id).work.checklist[0].done, true);
  assert.ok(checklistSaved.timeline.some((event) => event.type === "TECHNICIAN_CHECKLIST_UPDATED"));

  const noted = store.addTechnicianNote(assigned.id, "TECH-001", "Fuse replacement required.");
  assert.ok(noted.timeline.some((event) => event.type === "TECHNICIAN_NOTE"));
  const backup = store.requestTechnicianBackup(assigned.id, "TECH-001", "Need lifting equipment");
  assert.equal(backup.attentionFlag.type, "backup_requested");
  const reassignment = store.requestTechnicianReassignment(
    assigned.id,
    "TECH-001",
    "Additional specialist needed",
    "Cable jointer required",
  );
  assert.equal(reassignment.reassignmentRequest.status, "pending_admin_review");
  assert.equal(reassignment.assignment.technicianId, "TECH-001");
  const falseAlarm = store.requestFalseAlarmReview(assigned.id, "TECH-001", "Supply is normal at the service point.");
  assert.equal(falseAlarm.status, "Repairing");
  assert.equal(falseAlarm.falseAlarmReview.status, "pending_admin_review");

  const repairCompleted = store.completeTechnicianRepair(
    assigned.id,
    "TECH-001",
    "Fault repaired",
    "Replaced the damaged fuse and tested supply.",
  );
  assert.equal(repairCompleted.status, "Awaiting Confirmation");
  assert.equal(repairCompleted.restorationState.state, "awaiting_confirmation");
  assert.ok(repairCompleted.timeline.some((event) => event.type === "REPAIR_COMPLETED"));
  assert.ok(repairCompleted.timeline.some((event) => event.type === "RESTORATION_PENDING_CONFIRMATION"));
  assert.equal(store.addTechnicianEvidence(assigned.id, "TECH-001", { imageRef: "PHOTO-TOO-LATE" }), null);

  const legacyStore = makeStore({
    secureReportReports: [
      {
        reportId: "SR-1005",
        issue: "Power outage",
        issueType: "Household issue",
        description: "Legacy report",
        status: "Resolved",
        priority: "High",
        createdAt: "2026-01-01T10:00:00.000Z",
        location: { lat: -25.75, lng: 28.19 },
      },
    ],
  });
  const migratedReport = legacyStore.getReport("SR-1005");
  const migratedIncident = legacyStore.getIncident(migratedReport.incidentId);
  assert.equal(migratedIncident.status, "Resolved");
  assert.equal(Object.hasOwn(migratedReport, "status"), false);
  assert.equal(Object.hasOwn(migratedReport, "priority"), false);
  assert.equal(migratedReport.adminReview.acknowledged, true);

  const danglingLinkStore = makeStore({
    secureReportReports: [
      {
        id: "SR-2001",
        source: "resident_report",
        description: "Stored report",
        outageType: "Power outage",
        timestamp: "2026-01-01T10:00:00.000Z",
        incidentId: "INC-2001",
        latitude: -25.75,
        longitude: 28.19,
      },
    ],
    secureReportIncidents: [
      {
        id: "INC-2001",
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
        status: "Reported",
        latitude: -25.75,
        longitude: 28.19,
        outageType: "Power outage",
        linkedReportIds: ["SR-2001", "SR-MISSING"],
        linkedSignals: [],
      },
    ],
  });
  assert.deepEqual(
    Array.from(danglingLinkStore.getIncident("INC-2001").linkedReportIds),
    ["SR-2001"],
  );
  assert.equal(danglingLinkStore.getLinkedReports("INC-2001").length, 1);

  const ui = makeAdminUI(store);
  assert.equal(ui.requiresAttention(store.getIncident(assigned.id)), true);
  const attentionBase = {
    id: "INC-ATTENTION",
    status: "Reported",
    priority: "Low",
    latitude: -25.75,
    longitude: 28.19,
    area: "Pretoria West",
    updatedAt: new Date().toISOString(),
    timeline: [],
    restorationState: { needsReview: false, negativeCount: 0 },
  };
  const normalLow = Object.assign({}, attentionBase);
  const criticalIncident = Object.assign({}, attentionBase, { id: "INC-CRITICAL", priority: "Critical" });
  const reopenedIncident = Object.assign({}, attentionBase, { id: "INC-REOPENED", status: "Reopened" });
  const normalHigh = Object.assign({}, attentionBase, { id: "INC-HIGH", priority: "High" });
  const configuredHigh = Object.assign({}, normalHigh, { id: "INC-HIGH-REVIEW", requiresReview: true });
  const awaitingNormally = Object.assign({}, attentionBase, { id: "INC-AWAITING", status: "Awaiting Confirmation" });
  const awaitingNegative = Object.assign({}, awaitingNormally, {
    id: "INC-AWAITING-NEGATIVE",
    restorationState: { needsReview: true, negativeCount: 1 },
  });
  const missingLocation = Object.assign({}, attentionBase, {
    id: "INC-NO-LOCATION",
    latitude: null,
    longitude: null,
    area: "Location pending",
  });
  const resolvedCritical = Object.assign({}, criticalIncident, { id: "INC-RESOLVED", status: "Resolved" });

  assert.equal(ui.requiresAttention(normalLow), false);
  assert.equal(ui.requiresAttention(criticalIncident), true);
  assert.equal(ui.requiresAttention(reopenedIncident), true);
  assert.equal(ui.requiresAttention(normalHigh), false);
  assert.equal(ui.requiresAttention(configuredHigh), true);
  assert.equal(ui.requiresAttention(awaitingNormally), false);
  assert.equal(ui.requiresAttention(awaitingNegative), true);
  assert.equal(ui.requiresAttention(missingLocation), true);
  assert.equal(ui.requiresAttention(resolvedCritical), false);
  assert.equal(ui.getActiveIncidents([normalLow, criticalIncident, resolvedCritical]).length, 2);
  assert.equal(ui.getCriticalIncidents([normalLow, criticalIncident, resolvedCritical]).length, 2);
  assert.equal(ui.getAttentionIncidents([normalLow, criticalIncident, reopenedIncident]).length, 2);
  assert.equal(ui.getReportsToday(store.getReports()).length, store.getReports().length);

  const resolvedAssigned = store.recordRestorationConfirmation(assigned.id, different.report.id, true);
  assert.equal(resolvedAssigned.status, "Resolved");
  assert.equal(store.getJobsForTechnician("TECH-001", false).some((job) => job.id === assigned.id), false);
  assert.ok(storeChangeCount > 0);
  unsubscribe();

  const resetStore = makeStore({
    secureReportReports: [{ id: "SR-RESET" }],
    secureReportIncidents: [{ id: "INC-RESET" }],
    secureReportSignals: [{ id: "SIG-RESET" }],
    secureReportCurrentUser: { id: "TECH-001", role: "technician" },
    unrelatedApplicationKey: { keep: true },
  });
  let resetNotifications = 0;
  resetStore.subscribeToStore(function (change) { if (change.domain === "store") resetNotifications += 1; });
  const resetResult = resetStore.resetDemonstration();
  assert.equal(resetResult.technicians, 3);
  assert.equal(resetStore.getReports().length, 0);
  assert.equal(resetStore.getIncidents().length, 0);
  assert.equal(resetStore.getSignals().length, 0);
  assert.equal(resetStore.getTechnicians().length, 3);
  assert.equal(resetStore.__testValues.has("secureReportCurrentUser"), false);
  assert.equal(resetStore.__testValues.has("unrelatedApplicationKey"), true);
  assert.equal(resetNotifications, 1);
  resetStore.resetDemonstration();
  assert.equal(resetStore.getIncidents().length, 0);

  console.log("data-store acceptance tests passed");
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
