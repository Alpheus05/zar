(function () {
  "use strict";

  // TODO: Replace localStorage repository with backend API/database.
  const STORAGE_KEYS = {
    reports: "secureReportReports",
    incidents: "secureReportIncidents",
    signals: "secureReportSignals",
    technicians: "secureReportTechnicians",
    currentUser: "secureReportCurrentUser",
  };

  const INCIDENT_STATUSES = [
    "Reported",
    "Verified",
    "Prioritised",
    "Awaiting Dispatch",
    "Assigned",
    "En Route",
    "On Site",
    "Repairing",
    "Repair Completed",
    "Awaiting Confirmation",
    "Resolved",
    "Reopened",
  ];

  const ACTIVE_STATUSES = INCIDENT_STATUSES.filter(function (status) {
    return status !== "Resolved";
  });

  const HUMAN_REPORT_SOURCES = ["resident_report", "admin_manual"];
  const PRIORITY_LEVELS = ["Critical", "High", "Medium", "Low"];
  const storeSubscribers = new Set();
  let storeChannel = null;

  // Local workforce directory only. Assignment and job state still live on incidents.
  // TODO: Replace the local technician directory with authenticated workforce data.
  const DEFAULT_TECHNICIANS = [
    {
      id: "TECH-001",
      name: "Lerato Molefe",
      team: "Team B",
      status: "available",
      skills: ["electrical", "transformer", "cable"],
      baseArea: "Pretoria West",
    },
    {
      id: "TECH-002",
      name: "Sipho Dlamini",
      team: "Team A",
      status: "available",
      skills: ["electrical", "meter", "cable"],
      baseArea: "Mamelodi",
    },
    {
      id: "TECH-003",
      name: "Anele Khumalo",
      team: "Team B",
      status: "available",
      skills: ["electrical", "transformer", "switchgear"],
      baseArea: "Centurion",
    },
  ];

  const MATCHING = {
    nearbyMeters: 250,
    maximumDistanceMeters: 1000,
    recentHours: 2,
    maximumAgeHours: 24,
    threshold: 70,
  };

  // TODO: Replace local critical-infrastructure data with City GIS data.
  const CRITICAL_INFRASTRUCTURE = [
    {
      id: "FAC-001",
      name: "Steve Biko Academic Hospital",
      type: "Hospital",
      latitude: -25.7297,
      longitude: 28.2022,
      radiusMeters: 1300,
    },
    {
      id: "FAC-002",
      name: "Pretoria West Hospital",
      type: "Hospital",
      latitude: -25.7547,
      longitude: 28.1468,
      radiusMeters: 1200,
    },
    {
      id: "FAC-003",
      name: "Tshwane Central Fire Station",
      type: "Fire station",
      latitude: -25.7479,
      longitude: 28.1907,
      radiusMeters: 900,
    },
    {
      id: "FAC-004",
      name: "Church Square Traffic Signals",
      type: "Traffic lights",
      latitude: -25.7462,
      longitude: 28.1881,
      radiusMeters: 650,
    },
    {
      id: "FAC-005",
      name: "Rietvlei Water Pump Station",
      type: "Water pump station",
      latitude: -25.8872,
      longitude: 28.2738,
      radiusMeters: 1000,
    },
  ];

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn("PowerGrid ignored invalid localStorage data for", key, error);
      return [];
    }
  }

  function writeArray(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch (error) {
      console.warn("PowerGrid ignored invalid localStorage data for", key, error);
      return null;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function asNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function normalizeEvidenceItem(rawEvidence, fallbackSource) {
    if (!rawEvidence || typeof rawEvidence !== "object") return null;
    const capturedAt = rawEvidence.capturedAt || rawEvidence.timestamp || rawEvidence.lastModified || nowIso();
    const fallbackIdentity = String(rawEvidence.imageRef || rawEvidence.name || fallbackSource || "photo")
      .replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(-32) || "photo";
    return {
      id: rawEvidence.id || "EVID-" + String(capturedAt).replace(/\D/g, "") + "-" + fallbackIdentity,
      type: "photo",
      source: rawEvidence.source || fallbackSource,
      capturedAt: capturedAt,
      imageRef: rawEvidence.imageRef || null,
      mimeType: rawEvidence.mimeType || rawEvidence.type || "image/jpeg",
      size: Number(rawEvidence.size) || null,
      width: Number(rawEvidence.width) || null,
      height: Number(rawEvidence.height) || null,
      name: rawEvidence.name || null,
      storageState: rawEvidence.imageRef ? "indexeddb" : (rawEvidence.storageState || "metadata_only"),
      technicianId: rawEvidence.technicianId || null,
      technicianName: rawEvidence.technicianName || null,
      stage: rawEvidence.stage || null,
      caption: String(rawEvidence.caption || "").trim(),
    };
  }

  function normalizeEvidenceList(value, fallbackSource) {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return values.map(function (item) { return normalizeEvidenceItem(item, fallbackSource); }).filter(Boolean);
  }

  function notifyStoreChanged(domain) {
    storeSubscribers.forEach(function (callback) {
      try { callback({ domain: domain, source: "local" }); } catch (error) { console.error("PowerGrid store subscriber failed", error); }
    });
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("secure-report:store-changed", { detail: { domain: domain } }));
    }
    if (storeChannel) {
      try { storeChannel.postMessage({ domain: domain, timestamp: Date.now() }); } catch (error) { console.warn("PowerGrid could not broadcast store change", error); }
    }
  }

  function notifyReportsChanged() {
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("secure-report:reports-changed"));
    }
    notifyStoreChanged("reports");
  }

  function notifyIncidentsChanged() {
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("secure-report:incidents-changed"));
    }
    notifyStoreChanged("incidents");
  }

  function subscribeToStore(callback) {
    if (typeof callback !== "function") return function () {};
    storeSubscribers.add(callback);
    return function () { storeSubscribers.delete(callback); };
  }

  if (typeof BroadcastChannel === "function") {
    storeChannel = new BroadcastChannel("powergrid-store");
    storeChannel.addEventListener("message", function (event) {
      const domain = event && event.data && event.data.domain || "store";
      storeSubscribers.forEach(function (callback) {
        try { callback({ domain: domain, source: "broadcast" }); } catch (error) { console.error("PowerGrid store subscriber failed", error); }
      });
    });
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("storage", function (event) {
      const domain = event.key === STORAGE_KEYS.incidents ? "incidents"
        : event.key === STORAGE_KEYS.reports ? "reports"
          : event.key === STORAGE_KEYS.signals ? "signals"
            : event.key === STORAGE_KEYS.technicians ? "technicians" : null;
      if (!domain) return;
      storeSubscribers.forEach(function (callback) {
        try { callback({ domain: domain, source: "storage" }); } catch (error) { console.error("PowerGrid store subscriber failed", error); }
      });
    });
  }

  function normalizeStatus(status) {
    if (INCIDENT_STATUSES.includes(status)) {
      return status;
    }

    const legacyStatuses = {
      Dispatched: "Awaiting Dispatch",
      Completed: "Repair Completed",
    };

    return legacyStatuses[status] || "Reported";
  }

  function nextId(prefix, values, startAt) {
    let maximum = startAt - 1;

    values.forEach(function (value) {
      const id = String(value.id || value.reportId || "");
      const match = id.match(/(\d+)$/);
      if (match) {
        maximum = Math.max(maximum, Number(match[1]));
      }
    });

    return prefix + String(maximum + 1).padStart(3, "0");
  }

  function reportCoordinates(report) {
    return {
      latitude: asNumber(
        report.latitude !== undefined
          ? report.latitude
          : report.location && report.location.lat,
      ),
      longitude: asNumber(
        report.longitude !== undefined
          ? report.longitude
          : report.location && report.location.lng,
      ),
    };
  }

  function normalizeReport(rawReport) {
    const coordinates = reportCoordinates(rawReport);
    const id = rawReport.id || rawReport.reportId;
    const timestamp =
      rawReport.timestamp || rawReport.createdAt || rawReport.reportedAt || nowIso();
    let evidence = normalizeEvidenceList(rawReport.evidence, "resident");
    const source = HUMAN_REPORT_SOURCES.includes(rawReport.source)
      ? rawReport.source
      : "resident_report";
    const existingReview = rawReport.adminReview;
    const adminReview = existingReview && typeof existingReview === "object"
      ? {
          acknowledged: existingReview.acknowledged === true,
          acknowledgedAt: existingReview.acknowledgedAt || null,
          acknowledgedBy: existingReview.acknowledgedBy || null,
        }
      : {
          // Existing reports predate the acknowledgement workflow and must not flood the admin queue.
          acknowledged: true,
          acknowledgedAt: null,
          acknowledgedBy: null,
        };

    if (!evidence.length && rawReport.photoName) {
      evidence = normalizeEvidenceList({
        name: rawReport.photoName,
        type: rawReport.photoType || null,
        size: rawReport.photoSize || null,
        lastModified: null,
        storageState: "metadata_only",
      }, "resident");
    }

    return {
      id: id,
      reportId: id,
      source: source,
      resident: rawReport.resident || null,
      contact: rawReport.contact || null,
      description: rawReport.description || "",
      outageType: rawReport.outageType || rawReport.issue || "Electrical issue",
      issue: rawReport.outageType || rawReport.issue || "Electrical issue",
      issueType: rawReport.issueType || "Resident report",
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timestamp: timestamp,
      createdAt: timestamp,
      evidence: evidence,
      photoName: evidence.length ? evidence[0].name : null,
      imageAnalysis: rawReport.imageAnalysis || null,
      incidentId: rawReport.incidentId || null,
      adminReview: adminReview,
      locationCapture: rawReport.locationCapture ||
        (rawReport.location
          ? {
              status: rawReport.location.status || null,
              text: rawReport.location.text || null,
            }
          : null),
    };
  }

  function emptyRestorationState() {
    return {
      state: "not_requested",
      positiveCount: 0,
      negativeCount: 0,
      needsReview: false,
    };
  }

  function emptyAssignment() {
    return {
      technicianId: null,
      assignedAt: null,
      assignedBy: null,
      acceptedAt: null,
      acceptedBy: null,
    };
  }

  function normalizeChecklist(checklist) {
    return (Array.isArray(checklist) ? checklist : []).map(function (item, index) {
      const value = typeof item === "string" ? { text: item } : item || {};
      return {
        id: value.id || "STEP-" + String(index + 1).padStart(2, "0"),
        text: value.text || "Checklist step",
        done: value.done === true,
        completedAt: value.completedAt || null,
        completedBy: value.completedBy || null,
      };
    });
  }

  function normalizeTriage(rawIncident, operationalPriority) {
    const raw = rawIncident.triage && typeof rawIncident.triage === "object" ? rawIncident.triage : null;
    const legacyRecommendation = {
      priority: PRIORITY_LEVELS.includes(rawIncident.recommendedPriority)
        ? rawIncident.recommendedPriority
        : (PRIORITY_LEVELS.includes(operationalPriority) ? operationalPriority : "Low"),
      reasons: Array.isArray(rawIncident.priorityReasons) ? rawIncident.priorityReasons : [],
      generatedAt: rawIncident.updatedAt || rawIncident.createdAt || nowIso(),
    };
    const recommendation = Object.assign({}, legacyRecommendation, raw && raw.recommendation || {});
    recommendation.priority = PRIORITY_LEVELS.includes(recommendation.priority) ? recommendation.priority : "Low";
    recommendation.reasons = Array.isArray(recommendation.reasons) ? recommendation.reasons : [];
    recommendation.generatedAt = recommendation.generatedAt || nowIso();

    const inferredApproved = !raw && PRIORITY_LEVELS.includes(operationalPriority);
    const state = raw && ["pending", "approved", "deferred"].includes(raw.state)
      ? raw.state
      : (inferredApproved ? "approved" : "pending");
    return {
      state: state,
      recommendation: recommendation,
      adminPriority: raw && PRIORITY_LEVELS.includes(raw.adminPriority)
        ? raw.adminPriority
        : (state === "approved" && PRIORITY_LEVELS.includes(operationalPriority) ? operationalPriority : null),
      reviewedBy: raw && raw.reviewedBy || null,
      reviewedAt: raw && raw.reviewedAt || null,
      deferredAt: raw && raw.deferredAt || null,
    };
  }

  function normalizeIncident(rawIncident) {
    const latitude = asNumber(
      rawIncident.latitude !== undefined
        ? rawIncident.latitude
        : rawIncident.location && rawIncident.location.latitude,
    );
    const longitude = asNumber(
      rawIncident.longitude !== undefined
        ? rawIncident.longitude
        : rawIncident.location && rawIncident.location.longitude,
    );
    const priority =
      typeof rawIncident.priority === "string"
        ? rawIncident.priority
        : rawIncident.priority && rawIncident.priority.level
          ? rawIncident.priority.level
          : null;
    const triage = normalizeTriage(rawIncident, priority);
    const legacyTechnicianId = rawIncident.technicianId || null;
    const assignment = Object.assign(
      emptyAssignment(),
      rawIncident.assignment || {},
    );
    if (!assignment.technicianId && legacyTechnicianId) {
      assignment.technicianId = legacyTechnicianId;
    }
    const work = rawIncident.work && typeof rawIncident.work === "object"
      ? rawIncident.work
      : {};

    return {
      id: rawIncident.id,
      createdAt: rawIncident.createdAt || nowIso(),
      updatedAt: rawIncident.updatedAt || rawIncident.createdAt || nowIso(),
      status: normalizeStatus(rawIncident.status),
      latitude: latitude,
      longitude: longitude,
      location: {
        latitude: latitude,
        longitude: longitude,
      },
      outageType: rawIncident.outageType || "Electrical issue",
      linkedReportIds: unique(rawIncident.linkedReportIds),
      linkedSignals: unique(rawIncident.linkedSignals),
      priority: PRIORITY_LEVELS.includes(priority) ? priority : null,
      priorityScore: Number(rawIncident.priorityScore) || 0,
      priorityReasons: Array.isArray(rawIncident.priorityReasons)
        ? rawIncident.priorityReasons
        : [],
      criticalInfrastructure: Array.isArray(rawIncident.criticalInfrastructure)
        ? rawIncident.criticalInfrastructure
        : [],
      timeline: Array.isArray(rawIncident.timeline) ? rawIncident.timeline : [],
      restorationConfirmations: Array.isArray(
        rawIncident.restorationConfirmations,
      )
        ? rawIncident.restorationConfirmations
        : [],
      restorationState: Object.assign(
        emptyRestorationState(),
        rawIncident.restorationState || {},
      ),
      area: rawIncident.area || null,
      region: rawIncident.region || null,
      affectedCustomers: Number(rawIncident.affectedCustomers) || null,
      locationUncertain: rawIncident.locationUncertain === true,
      requiresReview: rawIncident.requiresReview === true,
      attentionFlag: rawIncident.attentionFlag || null,
      assignment: assignment,
      technicianId: assignment.technicianId,
      work: {
        checklist: normalizeChecklist(work.checklist),
        startedAt: work.startedAt || null,
        completedAt: work.completedAt || null,
        outcome: work.outcome || null,
        repairNotes: work.repairNotes || null,
        evidence: normalizeEvidenceList(work.evidence, "technician"),
      },
      backupRequest: rawIncident.backupRequest || null,
      reassignmentRequest: rawIncident.reassignmentRequest || null,
      falseAlarmReview: rawIncident.falseAlarmReview || null,
      triage: triage,
    };
  }

  function normalizeSignal(rawSignal) {
    return {
      id: rawSignal.id,
      meterId: rawSignal.meterId,
      source: "smart_meter",
      status: rawSignal.status || "offline",
      outageType: rawSignal.outageType || "Power outage",
      latitude: asNumber(rawSignal.latitude),
      longitude: asNumber(rawSignal.longitude),
      timestamp: rawSignal.timestamp || nowIso(),
      incidentId: rawSignal.incidentId || null,
    };
  }

  function createTimelineEvent(type, message, source, metadata) {
    return {
      type: type,
      timestamp: nowIso(),
      message: message,
      source: source || "system",
      metadata: metadata || {},
    };
  }

  function distanceMeters(first, second) {
    const firstLat = asNumber(first.latitude);
    const firstLng = asNumber(first.longitude);
    const secondLat = asNumber(second.latitude);
    const secondLng = asNumber(second.longitude);

    if ([firstLat, firstLng, secondLat, secondLng].includes(null)) {
      return null;
    }

    const earthRadius = 6371000;
    const toRadians = function (degrees) {
      return (degrees * Math.PI) / 180;
    };
    const latDifference = toRadians(secondLat - firstLat);
    const lngDifference = toRadians(secondLng - firstLng);
    const value =
      Math.sin(latDifference / 2) * Math.sin(latDifference / 2) +
      Math.cos(toRadians(firstLat)) *
        Math.cos(toRadians(secondLat)) *
        Math.sin(lngDifference / 2) *
        Math.sin(lngDifference / 2);

    return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function findMatchingIncident(reportOrSignal, incidents) {
    const reportTime = new Date(reportOrSignal.timestamp || nowIso()).getTime();
    let bestMatch = null;

    incidents
      .filter(function (incident) {
        return ACTIVE_STATUSES.includes(incident.status);
      })
      .forEach(function (incident) {
        const distance = distanceMeters(reportOrSignal, incident);
        if (distance === null || distance > MATCHING.maximumDistanceMeters) {
          return;
        }

        const incidentTime = new Date(
          incident.updatedAt || incident.createdAt,
        ).getTime();
        const hoursApart = Math.abs(reportTime - incidentTime) / 3600000;
        if (!Number.isFinite(hoursApart) || hoursApart > MATCHING.maximumAgeHours) {
          return;
        }

        let score = 0;
        const reasons = [];

        if (distance <= MATCHING.nearbyMeters) {
          score += 55;
        } else {
          score += 35;
        }
        reasons.push("Reports/signals are " + Math.round(distance) + "m apart");

        if (hoursApart <= MATCHING.recentHours) {
          score += 25;
        } else {
          score += 10;
        }
        reasons.push("Received within " + Math.max(1, Math.round(hoursApart * 60)) + " minutes");

        if (
          String(reportOrSignal.outageType || "").toLowerCase() ===
          String(incident.outageType || "").toLowerCase()
        ) {
          score += 25;
          reasons.push("Same outage type");
        }

        if (
          score >= MATCHING.threshold &&
          (!bestMatch || score > bestMatch.score)
        ) {
          bestMatch = {
            matched: true,
            incidentId: incident.id,
            score: score,
            reasons: reasons,
            distanceMeters: Math.round(distance),
          };
        }
      });

    return (
      bestMatch || {
        matched: false,
        incidentId: null,
        score: 0,
        reasons: ["No active nearby incident met the matching threshold"],
      }
    );
  }

  function findCriticalInfrastructure(incident) {
    return CRITICAL_INFRASTRUCTURE.map(function (facility) {
      const distance = distanceMeters(incident, facility);
      return Object.assign({}, facility, {
        distanceMeters: distance === null ? null : Math.round(distance),
      });
    }).filter(function (facility) {
      return (
        facility.distanceMeters !== null &&
        facility.distanceMeters <= facility.radiusMeters
      );
    });
  }

  function calculateIncidentPriority(incident, reports, signals) {
    const linkedReports = reports.filter(function (report) {
      return incident.linkedReportIds.includes(report.id);
    });
    const linkedOfflineSignals = signals.filter(function (signal) {
      return (
        incident.linkedSignals.includes(signal.id) && signal.status === "offline"
      );
    });
    const ageHours = Math.max(
      0,
      (Date.now() - new Date(incident.createdAt).getTime()) / 3600000,
    );
    const hazardPattern =
      /fire|spark|explosion|live wire|fallen (?:line|cable)|electrical hazard|smoke|damaged power line/i;
    const hazardDetected = linkedReports.some(function (report) {
      return (
        hazardPattern.test(report.description + " " + report.outageType) ||
        (report.imageAnalysis &&
          report.imageAnalysis.analyzed === true &&
          report.imageAnalysis.hazardDetected === true)
      );
    });
    const criticalInfrastructure = findCriticalInfrastructure(incident);
    let score = 10;
    const reasons = [];

    if (linkedReports.length) {
      score += Math.min(linkedReports.length * 8, 30);
      reasons.push(
        linkedReports.length +
          " human " +
          (linkedReports.length === 1 ? "report" : "reports") +
          " linked",
      );
    }

    if (linkedOfflineSignals.length) {
      score += Math.min(linkedOfflineSignals.length * 4, 25);
      reasons.push(
        linkedOfflineSignals.length +
          " smart " +
          (linkedOfflineSignals.length === 1 ? "meter" : "meters") +
          " offline",
      );
    }

    if (ageHours >= 1) {
      score += Math.min(Math.floor(ageHours / 2) * 3, 20);
      reasons.push("Incident open for " + Math.floor(ageHours) + " hours");
    }

    if (hazardDetected) {
      score += 30;
      reasons.push("Possible electrical hazard reported");
    }

    if (criticalInfrastructure.length) {
      score += Math.min(criticalInfrastructure.length * 20, 35);
      criticalInfrastructure.forEach(function (facility) {
        reasons.push(facility.name + " within affected area");
      });
    }

    score = Math.min(100, Math.round(score));
    let level = "Low";
    if (score >= 75) {
      level = "Critical";
    } else if (score >= 50) {
      level = "High";
    } else if (score >= 25) {
      level = "Medium";
    }

    return {
      level: level,
      score: score,
      reasons: reasons.length ? reasons : ["Newly reported incident"],
      criticalInfrastructure: criticalInfrastructure,
    };
  }

  function recalculatePriority(incident, reports, signals, recordChange) {
    const previousLevel = incident.triage.recommendation.priority;
    const previousScore = incident.priorityScore;
    const result = calculateIncidentPriority(incident, reports, signals);

    incident.priorityScore = result.score;
    incident.priorityReasons = result.reasons;
    incident.criticalInfrastructure = result.criticalInfrastructure;
    incident.triage.recommendation = {
      priority: result.level,
      reasons: result.reasons.slice(),
      generatedAt: nowIso(),
    };

    const hasRecommendationEvent = incident.timeline.some(function (event) {
      return event.type === "PRIORITY_RECOMMENDATION_UPDATED";
    });
    if (recordChange && (!hasRecommendationEvent || previousLevel !== result.level || previousScore !== result.score)) {
      incident.timeline.push(
        createTimelineEvent(
          "PRIORITY_RECOMMENDATION_UPDATED",
          "Priority recommendation generated: " + result.level + ".",
          "rules_engine",
          {
            previousLevel: previousLevel,
            previousScore: previousScore,
            reasons: result.reasons,
          },
        ),
      );
    }

    return result;
  }

  function newIncident(id, sourceItem, reportIds, signalIds) {
    const createdAt = sourceItem.timestamp || nowIso();
    const incident = normalizeIncident({
      id: id,
      createdAt: createdAt,
      updatedAt: createdAt,
      status: "Reported",
      latitude: sourceItem.latitude,
      longitude: sourceItem.longitude,
      outageType: sourceItem.outageType,
      linkedReportIds: reportIds || [],
      linkedSignals: signalIds || [],
      timeline: [],
    });

    incident.timeline.push(
      createTimelineEvent(
        "INCIDENT_CREATED",
        "A new incident was created from incoming outage evidence.",
        sourceItem.source,
        { sourceId: sourceItem.id },
      ),
    );

    incident.triage.state = "pending";
    incident.triage.adminPriority = null;
    incident.priority = null;

    return incident;
  }

  function createIncident(input) {
    const reports = getReports();
    const signals = getSignals();
    const incidents = getIncidents();
    const sourceItem = Object.assign(
      {
        id: input.sourceId || "manual",
        source: input.source || "system",
        timestamp: input.createdAt || nowIso(),
        outageType: input.outageType || "Electrical issue",
        latitude: input.latitude,
        longitude: input.longitude,
      },
      input,
    );
    const incident = newIncident(
      input.id || nextId("INC-", incidents, 1),
      sourceItem,
      input.linkedReportIds || [],
      input.linkedSignals || [],
    );
    incident.status = normalizeStatus(input.status);
    recalculatePriority(incident, reports, signals, true);
    incidents.push(incident);
    saveIncidents(incidents);
    return incident;
  }

  function migrateLegacyData() {
    const rawReports = readArray(STORAGE_KEYS.reports);
    const reports = rawReports.map(normalizeReport).filter(function (report) {
      return Boolean(report.id);
    });
    const signals = readArray(STORAGE_KEYS.signals)
      .map(normalizeSignal)
      .filter(function (signal) {
        return Boolean(signal.id);
      });
    const incidents = readArray(STORAGE_KEYS.incidents)
      .map(normalizeIncident)
      .filter(function (incident) {
        return Boolean(incident.id);
      });

    reports.forEach(function (report, reportIndex) {
      let incident = incidents.find(function (item) {
        return item.id === report.incidentId;
      });

      if (!incident) {
        const legacy = rawReports[reportIndex] || {};
        const incidentId = nextId("INC-", incidents, 1);
        incident = newIncident(incidentId, report, [report.id], []);
        incident.status = normalizeStatus(legacy.status);
        const reportSourceLabel = report.source === "admin_manual" ? "Admin manual report " : "Resident report ";
        incident.timeline.push(
          createTimelineEvent(
            "REPORT_RECEIVED",
            reportSourceLabel + report.id + " was received.",
            report.source,
            { reportId: report.id, migrated: true },
          ),
        );
        incidents.push(incident);
        report.incidentId = incidentId;
      } else if (!incident.linkedReportIds.includes(report.id)) {
        incident.linkedReportIds.push(report.id);
      }
    });

    signals.forEach(function (signal) {
      const incident = incidents.find(function (item) {
        return item.id === signal.incidentId;
      });
      if (incident && !incident.linkedSignals.includes(signal.id)) {
        incident.linkedSignals.push(signal.id);
      }
    });

    const storedReportIds = new Set(reports.map(function (report) { return report.id; }));
    incidents.forEach(function (incident) {
      incident.linkedReportIds = incident.linkedReportIds.filter(function (reportId) {
        return storedReportIds.has(reportId);
      });
      recalculatePriority(incident, reports, signals, false);
    });

    writeArray(STORAGE_KEYS.reports, reports);
    writeArray(STORAGE_KEYS.incidents, incidents);
    writeArray(STORAGE_KEYS.signals, signals);
  }

  function getReports() {
    return readArray(STORAGE_KEYS.reports).map(normalizeReport);
  }

  function saveReports(reports) {
    writeArray(STORAGE_KEYS.reports, reports.map(normalizeReport));
    notifyReportsChanged();
  }

  function getIncidents() {
    return readArray(STORAGE_KEYS.incidents).map(normalizeIncident);
  }

  function saveIncidents(incidents) {
    writeArray(STORAGE_KEYS.incidents, incidents.map(normalizeIncident));
    notifyIncidentsChanged();
  }

  function getSignals() {
    return readArray(STORAGE_KEYS.signals).map(normalizeSignal);
  }

  function saveSignals(signals) {
    writeArray(STORAGE_KEYS.signals, signals.map(normalizeSignal));
    notifyStoreChanged("signals");
  }

  function normalizeTechnician(rawTechnician) {
    const technician = rawTechnician || {};
    return {
      id: technician.id,
      name: technician.name || "Technician",
      team: technician.team || "Field services",
      status: technician.status || "available",
      skills: unique(technician.skills),
      baseArea: technician.baseArea || "Tshwane",
    };
  }

  function getTechnicians() {
    let technicians = readArray(STORAGE_KEYS.technicians)
      .map(normalizeTechnician)
      .filter(function (technician) { return Boolean(technician.id); });
    if (!technicians.length) {
      technicians = DEFAULT_TECHNICIANS.map(normalizeTechnician);
      writeArray(STORAGE_KEYS.technicians, technicians);
    }
    return technicians;
  }

  function saveTechnicians(technicians) {
    writeArray(
      STORAGE_KEYS.technicians,
      (technicians || []).map(normalizeTechnician).filter(function (technician) {
        return Boolean(technician.id);
      }),
    );
    notifyStoreChanged("technicians");
  }

  function getTechnician(id) {
    return getTechnicians().find(function (technician) {
      return technician.id === id;
    }) || null;
  }

  function getCurrentUser() {
    const stored = readObject(STORAGE_KEYS.currentUser);
    if (stored && stored.role === "technician" && getTechnician(stored.id)) {
      return {
        id: stored.id,
        role: "technician",
        name: stored.name || getTechnician(stored.id).name,
      };
    }
    const fallback = getTechnician("TECH-001") || getTechnicians()[0];
    if (!fallback) return null;
    // TODO: Replace local technician identity with an authenticated session.
    return { id: fallback.id, role: "technician", name: fallback.name };
  }

  function setCurrentUser(user) {
    if (!user || user.role !== "technician" || !getTechnician(user.id)) {
      return null;
    }
    const value = {
      id: user.id,
      role: "technician",
      name: user.name || getTechnician(user.id).name,
    };
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(value));
    return value;
  }

  function resetDemonstration() {
    [STORAGE_KEYS.reports, STORAGE_KEYS.incidents, STORAGE_KEYS.signals, STORAGE_KEYS.technicians, STORAGE_KEYS.currentUser].forEach(function (key) {
      localStorage.removeItem(key);
    });
    writeArray(STORAGE_KEYS.technicians, DEFAULT_TECHNICIANS.map(normalizeTechnician));
    notifyStoreChanged("store");
    return { reports: 0, incidents: 0, signals: 0, technicians: DEFAULT_TECHNICIANS.length };
  }

  function getReport(id) {
    return (
      getReports().find(function (report) {
        return report.id === id || report.reportId === id;
      }) || null
    );
  }

  function getUnacknowledgedResidentReports() {
    return getReports().filter(function (report) {
      return report.source === "resident_report" && report.adminReview.acknowledged !== true;
    }).sort(function (a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  }

  function getNextUnacknowledgedReport() {
    return getUnacknowledgedResidentReports()[0] || null;
  }

  function acknowledgeReport(reportId, adminName) {
    const reports = getReports();
    const report = reports.find(function (item) { return item.id === reportId; });
    if (!report || report.source !== "resident_report") {
      return null;
    }
    if (report.adminReview.acknowledged) {
      return report;
    }

    const acknowledgedAt = nowIso();
    report.adminReview = {
      acknowledged: true,
      acknowledgedAt: acknowledgedAt,
      // TODO: Replace local admin identity with an authenticated user.
      acknowledgedBy: adminName || "Admin",
    };

    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === report.incidentId; });
    if (incident) {
      incident.timeline.push(
        createTimelineEvent(
          "ADMIN_REVIEWED_REPORT",
          "Admin reviewed report " + report.id + ".",
          "admin",
          { reportId: report.id, acknowledgedBy: report.adminReview.acknowledgedBy },
        ),
      );
      incident.updatedAt = acknowledgedAt;
      saveIncidents(incidents);
    } else if (report.incidentId) {
      console.warn("PowerGrid could not find linked incident for report", report.id, report.incidentId);
    }

    saveReports(reports);
    return report;
  }

  function getLinkedReports(incidentOrId) {
    const incident = typeof incidentOrId === "string"
      ? getIncident(incidentOrId)
      : incidentOrId;
    if (!incident) {
      return [];
    }
    const linkedIds = new Set(incident.linkedReportIds || []);
    return getReports().filter(function (report) {
      return linkedIds.has(report.id);
    });
  }

  function getIncident(id) {
    return (
      getIncidents().find(function (incident) {
        return incident.id === id;
      }) || null
    );
  }

  function appendIncidentEvent(incidentId, event) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) {
      return item.id === incidentId;
    });
    if (!incident) {
      return null;
    }

    incident.timeline.push(
      createTimelineEvent(
        event.type,
        event.message,
        event.source,
        event.metadata,
      ),
    );
    incident.updatedAt = nowIso();
    saveIncidents(incidents);
    return incident;
  }

  function updateIncident(incidentId, changes, event) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) {
      return item.id === incidentId;
    });
    if (!incident) {
      return null;
    }

    const allowedChanges = Object.assign({}, changes);
    if (allowedChanges.status) {
      allowedChanges.status = normalizeStatus(allowedChanges.status);
    }
    delete allowedChanges.id;
    delete allowedChanges.linkedReportIds;
    delete allowedChanges.linkedSignals;
    Object.assign(incident, allowedChanges, { updatedAt: nowIso() });

    if (event) {
      incident.timeline.push(
        createTimelineEvent(
          event.type,
          event.message,
          event.source,
          event.metadata,
        ),
      );
    }

    saveIncidents(incidents);
    return incident;
  }

  function approveIncidentPriority(incidentId, selectedPriority, reviewedBy) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    if (!incident || ["Resolved", "Awaiting Confirmation"].includes(incident.status)) return null;
    const recommended = incident.triage.recommendation.priority;
    const approved = selectedPriority || recommended;
    if (!PRIORITY_LEVELS.includes(approved)) return null;
    const reviewedAt = nowIso();
    incident.priority = approved;
    incident.triage.state = "approved";
    incident.triage.adminPriority = approved;
    incident.triage.reviewedBy = reviewedBy || "Admin";
    incident.triage.reviewedAt = reviewedAt;
    incident.triage.deferredAt = null;
    if (["Reported", "Verified", "Prioritised"].includes(incident.status)) incident.status = "Awaiting Dispatch";
    incident.updatedAt = reviewedAt;
    const changed = approved !== recommended;
    incident.timeline.push(createTimelineEvent(
      changed ? "ADMIN_PRIORITY_OVERRIDDEN" : "ADMIN_PRIORITY_APPROVED",
      changed
        ? "Priority changed from AI recommendation " + recommended + " to " + approved + " by " + incident.triage.reviewedBy + "."
        : "Priority " + approved + " approved by " + incident.triage.reviewedBy + ".",
      "admin",
      { recommendedPriority: recommended, approvedPriority: approved, reviewedBy: incident.triage.reviewedBy },
    ));
    if (!(incident.assignment && incident.assignment.technicianId)) {
      const technician = selectEligibleTechnician(incident, incidents, getTechnicians());
      if (technician) {
        applyTechnicianAssignment(incident, technician, "System", true);
      } else {
        incident.attentionFlag = {
          type: "no_technician_available",
          timestamp: reviewedAt,
          message: "No eligible technician is currently available for automatic assignment.",
        };
      }
    }
    saveIncidents(incidents);
    return incident;
  }

  function deferIncidentReview(incidentId, reviewedBy) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    if (!incident || ["Assigned", "En Route", "On Site", "Repairing", "Awaiting Confirmation", "Resolved"].includes(incident.status)) return null;
    const deferredAt = nowIso();
    incident.triage.state = "deferred";
    incident.triage.adminPriority = null;
    incident.triage.reviewedBy = reviewedBy || "Admin";
    incident.triage.reviewedAt = null;
    incident.triage.deferredAt = deferredAt;
    incident.priority = null;
    incident.updatedAt = deferredAt;
    incident.timeline.push(createTimelineEvent("ADMIN_REVIEW_DEFERRED", "Saved for later Admin review.", "admin", { reviewedBy: incident.triage.reviewedBy }));
    saveIncidents(incidents);
    return incident;
  }

  function canIncidentBeAssigned(incidentOrId) {
    const incident = typeof incidentOrId === "string" ? getIncident(incidentOrId) : incidentOrId;
    if (!incident || !incident.triage || incident.triage.state !== "approved") return false;
    if (!PRIORITY_LEVELS.includes(incident.priority)) return false;
    if (["Resolved", "Awaiting Confirmation", "Repair Completed", "Reopened"].includes(incident.status)) return false;
    if (incident.falseAlarmReview && incident.falseAlarmReview.status === "pending_admin_review") return false;
    return true;
  }

  function assignedTechnician(incident, technicianId) {
    return Boolean(
      incident &&
      incident.assignment &&
      incident.assignment.technicianId === technicianId &&
      getTechnician(technicianId),
    );
  }

  function getJobsForTechnician(technicianId, includeCompleted) {
    return getIncidents().filter(function (incident) {
      return assignedTechnician(incident, technicianId) &&
        incident.triage.state === "approved" &&
        (includeCompleted === true || incident.status !== "Resolved");
    });
  }

  function requiredSkillForIncident(incident) {
    const text = String(incident && incident.outageType || "").toLowerCase();
    if (/transformer|substation/.test(text)) return "transformer";
    if (/meter/.test(text)) return "meter";
    if (/cable|line|wire|pole/.test(text)) return "cable";
    return "electrical";
  }

  function selectEligibleTechnician(incident, incidents, technicians) {
    const activeWorkStatuses = ["Assigned", "En Route", "On Site", "Repairing"];
    const requiredSkill = requiredSkillForIncident(incident);
    const workload = {};
    (incidents || []).forEach(function (item) {
      const technicianId = item.assignment && item.assignment.technicianId;
      if (technicianId && activeWorkStatuses.includes(item.status)) {
        workload[technicianId] = (workload[technicianId] || 0) + 1;
      }
    });
    return (technicians || []).filter(function (technician) {
      return technician && technician.id && ["available", "on-duty", "on duty"].includes(String(technician.status || "").toLowerCase());
    }).slice().sort(function (left, right) {
      const workloadDifference = (workload[left.id] || 0) - (workload[right.id] || 0);
      if (workloadDifference) return workloadDifference;
      const leftSkill = (left.skills || []).includes(requiredSkill) ? 1 : 0;
      const rightSkill = (right.skills || []).includes(requiredSkill) ? 1 : 0;
      if (leftSkill !== rightSkill) return rightSkill - leftSkill;
      const leftArea = left.baseArea && incident.area && left.baseArea.toLowerCase() === String(incident.area).toLowerCase() ? 1 : 0;
      const rightArea = right.baseArea && incident.area && right.baseArea.toLowerCase() === String(incident.area).toLowerCase() ? 1 : 0;
      if (leftArea !== rightArea) return rightArea - leftArea;
      return String(left.id).localeCompare(String(right.id));
    })[0] || null;
  }

  function applyTechnicianAssignment(incident, technician, assignedBy, automatic) {
    const previousTechnicianId = incident.assignment && incident.assignment.technicianId;
    const assignedAt = nowIso();
    incident.assignment = {
      technicianId: technician.id,
      assignedAt: assignedAt,
      assignedBy: assignedBy || "Admin",
      acceptedAt: null,
      acceptedBy: null,
    };
    incident.technicianId = technician.id;
    incident.status = "Assigned";
    incident.reassignmentRequest = null;
    incident.attentionFlag = null;
    incident.updatedAt = assignedAt;
    incident.timeline.push(createTimelineEvent(
      automatic ? "TECHNICIAN_AUTO_ASSIGNED" : (previousTechnicianId && previousTechnicianId !== technician.id ? "TECHNICIAN_REASSIGNED" : "TECHNICIAN_ASSIGNED"),
      automatic ? "System automatically assigned " + technician.name + " to this incident." : technician.name + " was assigned to this incident.",
      automatic ? "system" : "admin",
      {
        technicianId: technician.id,
        technicianName: technician.name,
        previousTechnicianId: previousTechnicianId || null,
        assignedBy: incident.assignment.assignedBy,
        automatic: automatic === true,
      },
    ));
    return incident;
  }

  function assignTechnician(incidentId, technicianId, assignedBy) {
    const technician = getTechnician(technicianId);
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    if (!incident || !technician || !canIncidentBeAssigned(incident)) return null;

    applyTechnicianAssignment(incident, technician, assignedBy || "Admin", false);
    saveIncidents(incidents);
    return incident;
  }

  function acceptTechnicianAssignment(incidentId, technicianId) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    if (!incident || !technician || !assignedTechnician(incident, technicianId)) return null;
    if (incident.status !== "Assigned") return null;
    if (incident.assignment.acceptedAt) return incident;

    const acceptedAt = nowIso();
    incident.assignment.acceptedAt = acceptedAt;
    incident.assignment.acceptedBy = technician.id;
    incident.updatedAt = acceptedAt;
    incident.timeline.push(
      createTimelineEvent(
        "TECHNICIAN_ACCEPTED_JOB",
        technician.name + " accepted the assigned job.",
        "technician",
        { technicianId: technician.id, technicianName: technician.name },
      ),
    );
    saveIncidents(incidents);
    return incident;
  }

  const TECHNICIAN_STATUS_TRANSITIONS = {
    "Assigned": ["En Route"],
    "En Route": ["On Site"],
    "On Site": ["Repairing"],
  };

  function updateTechnicianStatus(incidentId, technicianId, nextStatus) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    if (!incident || !technician || !assignedTechnician(incident, technicianId)) return null;
    const allowed = TECHNICIAN_STATUS_TRANSITIONS[incident.status] || [];
    if (!allowed.includes(nextStatus)) return null;
    if (incident.status === "Assigned" && !incident.assignment.acceptedAt) return null;

    const previousStatus = incident.status;
    const eventTypes = {
      "En Route": "TECHNICIAN_EN_ROUTE",
      "On Site": "TECHNICIAN_ON_SITE",
      "Repairing": "REPAIR_STARTED",
    };
    const messages = {
      "En Route": technician.name + " is travelling to the incident.",
      "On Site": technician.name + " arrived on site.",
      "Repairing": technician.name + " started repair work.",
    };
    incident.status = nextStatus;
    if (nextStatus === "Repairing" && !incident.work.startedAt) {
      incident.work.startedAt = nowIso();
    }
    incident.updatedAt = nowIso();
    incident.timeline.push(
      createTimelineEvent(
        eventTypes[nextStatus] || "STATUS_CHANGED",
        messages[nextStatus] || technician.name + " updated the incident status.",
        "technician",
        {
          technicianId: technician.id,
          technicianName: technician.name,
          previousStatus: previousStatus,
          nextStatus: nextStatus,
        },
      ),
    );
    saveIncidents(incidents);
    return incident;
  }

  function saveTechnicianChecklist(incidentId, technicianId, checklist) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    if (!incident || !assignedTechnician(incident, technicianId) || !["Assigned", "En Route", "On Site", "Repairing"].includes(incident.status)) return null;
    const previousDone = incident.work.checklist.filter(function (item) { return item.done; }).length;
    incident.work.checklist = normalizeChecklist(checklist);
    const done = incident.work.checklist.filter(function (item) { return item.done; }).length;
    incident.updatedAt = nowIso();
    if (done !== previousDone) {
      incident.timeline.push(createTimelineEvent("TECHNICIAN_CHECKLIST_UPDATED", "Repair checklist updated: " + done + " of " + incident.work.checklist.length + " completed.", "technician", { technicianId: technicianId, completed: done, total: incident.work.checklist.length }));
    }
    saveIncidents(incidents);
    return incident;
  }

  function addTechnicianNote(incidentId, technicianId, note) {
    const technician = getTechnician(technicianId);
    const text = String(note || "").trim();
    if (!technician || !text) return null;
    const incident = getIncident(incidentId);
    if (!assignedTechnician(incident, technicianId)) return null;
    return appendIncidentEvent(incidentId, {
      type: "TECHNICIAN_NOTE",
      message: technician.name + ": “" + text + "”",
      source: "technician",
      metadata: {
        technicianId: technician.id,
        technicianName: technician.name,
        note: text,
      },
    });
  }

  function requestTechnicianBackup(incidentId, technicianId, reason) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    if (!incident || !technician || !assignedTechnician(incident, technicianId) ||
      !["Assigned", "En Route", "On Site", "Repairing"].includes(incident.status)) return null;
    const requestedAt = nowIso();
    const details = String(reason || "Additional field support requested.").trim();
    incident.backupRequest = {
      requestedAt: requestedAt,
      requestedBy: technician.id,
      reason: details,
      status: "pending_admin_review",
    };
    incident.attentionFlag = {
      type: "backup_requested",
      timestamp: requestedAt,
      message: technician.name + " requested backup: " + details,
    };
    incident.timeline.push(
      createTimelineEvent(
        "TECHNICIAN_BACKUP_REQUESTED",
        technician.name + " requested backup: " + details,
        "technician",
        { technicianId: technician.id, reason: details },
      ),
    );
    incident.updatedAt = requestedAt;
    saveIncidents(incidents);
    return incident;
  }

  function requestTechnicianReassignment(incidentId, technicianId, reason, details) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    if (!incident || !technician || !assignedTechnician(incident, technicianId) ||
      !["Assigned", "En Route", "On Site", "Repairing"].includes(incident.status)) return null;
    const requestedAt = nowIso();
    incident.reassignmentRequest = {
      requestedAt: requestedAt,
      requestedBy: technician.id,
      reason: String(reason || "Other"),
      details: String(details || "").trim(),
      status: "pending_admin_review",
    };
    incident.attentionFlag = {
      type: "reassignment_requested",
      timestamp: requestedAt,
      message: technician.name + " requested reassignment: " + incident.reassignmentRequest.reason,
    };
    incident.timeline.push(
      createTimelineEvent(
        "TECHNICIAN_REASSIGNMENT_REQUESTED",
        technician.name + " requested reassignment: " + incident.reassignmentRequest.reason +
          (incident.reassignmentRequest.details ? " — " + incident.reassignmentRequest.details : "."),
        "technician",
        {
          technicianId: technician.id,
          reason: incident.reassignmentRequest.reason,
          details: incident.reassignmentRequest.details,
        },
      ),
    );
    incident.updatedAt = requestedAt;
    saveIncidents(incidents);
    return incident;
  }

  function requestFalseAlarmReview(incidentId, technicianId, reason) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    const details = String(reason || "").trim();
    if (!incident || !technician || !details || !assignedTechnician(incident, technicianId) ||
      !["Assigned", "En Route", "On Site", "Repairing"].includes(incident.status)) return null;
    const requestedAt = nowIso();
    incident.falseAlarmReview = {
      requestedAt: requestedAt,
      requestedBy: technician.id,
      reason: details,
      status: "pending_admin_review",
    };
    incident.attentionFlag = {
      type: "false_alarm_review",
      timestamp: requestedAt,
      message: technician.name + " requested false-alarm review.",
    };
    incident.timeline.push(
      createTimelineEvent(
        "FALSE_ALARM_REVIEW_REQUESTED",
        technician.name + " requested false-alarm review: " + details,
        "technician",
        { technicianId: technician.id, reason: details },
      ),
    );
    incident.updatedAt = requestedAt;
    saveIncidents(incidents);
    return incident;
  }

  function completeTechnicianRepair(incidentId, technicianId, outcome, repairNotes) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    const notes = String(repairNotes || "").trim();
    if (!incident || !technician || !assignedTechnician(incident, technicianId)) return null;
    if (incident.status !== "Repairing" || !String(outcome || "").trim() || !notes) return null;

    const completedAt = nowIso();
    incident.status = "Awaiting Confirmation";
    incident.work.completedAt = completedAt;
    incident.work.outcome = String(outcome).trim();
    incident.work.repairNotes = notes;
    incident.restorationState.state = "awaiting_confirmation";
    incident.restorationState.needsReview = false;
    incident.updatedAt = completedAt;
    incident.timeline.push(
      createTimelineEvent(
        "REPAIR_COMPLETED",
        technician.name + " completed repair work: " + incident.work.outcome + ".",
        "technician",
        {
          technicianId: technician.id,
          technicianName: technician.name,
          outcome: incident.work.outcome,
          repairNotes: notes,
        },
      ),
    );
    incident.timeline.push(
      createTimelineEvent(
        "RESTORATION_PENDING_CONFIRMATION",
        "Repair completed; awaiting confirmation from linked residents.",
        "system",
        { technicianId: technician.id },
      ),
    );
    saveIncidents(incidents);
    return incident;
  }

  function addTechnicianEvidence(incidentId, technicianId, evidenceMetadata) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) { return item.id === incidentId; });
    const technician = getTechnician(technicianId);
    const metadata = evidenceMetadata && typeof evidenceMetadata === "object" ? evidenceMetadata : {};
    if (!incident || !technician || !assignedTechnician(incident, technicianId)) return null;
    if (!["On Site", "Repairing"].includes(incident.status) || !metadata.imageRef) return null;

    const capturedAt = metadata.capturedAt || nowIso();
    const committedAt = nowIso();
    const evidence = normalizeEvidenceItem({
      id: metadata.id || "EVID-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8),
      type: "photo",
      source: "technician",
      technicianId: technician.id,
      technicianName: technician.name,
      capturedAt: capturedAt,
      stage: incident.status === "On Site" ? "on_site" : "repairing",
      caption: metadata.caption || "",
      imageRef: metadata.imageRef,
      mimeType: metadata.mimeType || "image/jpeg",
      size: metadata.size,
      width: metadata.width,
      height: metadata.height,
    }, "technician");
    incident.work.evidence.push(evidence);
    incident.updatedAt = committedAt;
    incident.timeline.push(createTimelineEvent(
      "TECHNICIAN_EVIDENCE_ADDED",
      technician.name + " added repair photo evidence.",
      "technician",
      {
        technicianId: technician.id,
        technicianName: technician.name,
        evidenceId: evidence.id,
        stage: evidence.stage,
        caption: evidence.caption,
      },
    ));
    saveIncidents(incidents);
    return incident;
  }

  function createEvidence(file) {
    if (!file) {
      return null;
    }

    return {
      id: "EVID-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8),
      type: "photo",
      source: "resident",
      capturedAt: nowIso(),
      imageRef: file.imageRef || null,
      name: file.name,
      mimeType: file.type || null,
      size: file.size || 0,
      lastModified: file.lastModified || null,
      storageState: file.imageRef ? "indexeddb" : "metadata_only",
    };
  }

  async function analyzeOutageImage(image) {
    if (!image) {
      return null;
    }

    // No vision service is configured. This is an adapter seam, not simulated AI.
    // TODO: Replace simulated image analysis with real vision API/model.
    // TODO: Replace simulated image analysis with real vision service.
    return {
      analyzed: false,
      mode: "pending_real_service",
      labels: [],
      hazardDetected: null,
      severity: null,
      confidence: null,
      summary: "Photo evidence stored locally. Automated analysis is not connected yet.",
    };
  }

  function submitReport(input) {
    const reports = getReports();
    const incidents = getIncidents();
    const signals = getSignals();
    const source = input.source === "admin_manual" ? "admin_manual" : "resident_report";
    const sourceLabel = source === "admin_manual" ? "Admin manual report " : "Resident report ";
    const id = nextId("SR-", reports, 1001);
    const submittedAt = input.timestamp || nowIso();
    const report = normalizeReport({
      id: id,
      source: source,
      resident: input.resident || null,
      contact: input.contact || null,
      description: input.description,
      outageType: input.outageType,
      issueType: input.issueType,
      latitude: input.latitude,
      longitude: input.longitude,
      timestamp: submittedAt,
      evidence: input.evidence || null,
      imageAnalysis: input.imageAnalysis || null,
      locationCapture: input.locationCapture || null,
      adminReview: source === "admin_manual"
        ? {
            acknowledged: true,
            acknowledgedAt: submittedAt,
            // TODO: Replace local admin identity with an authenticated user.
            acknowledgedBy: "Admin",
          }
        : { acknowledged: false, acknowledgedAt: null, acknowledgedBy: null },
    });
    const match = findMatchingIncident(report, incidents);
    let incident;

    if (match.matched) {
      incident = incidents.find(function (item) {
        return item.id === match.incidentId;
      });
      report.incidentId = incident.id;
      reports.push(report);
      incident.linkedReportIds.push(report.id);
      incident.updatedAt = nowIso();
      incident.timeline.push(
        createTimelineEvent(
          "REPORT_LINKED",
          sourceLabel + report.id + " was linked to this incident.",
          source,
          { reportId: report.id, matchScore: match.score, reasons: match.reasons },
        ),
      );
    } else {
      const incidentId = nextId("INC-", incidents, 1);
      report.incidentId = incidentId;
      reports.push(report);
      incident = newIncident(incidentId, report, [report.id], []);
      incident.timeline.push(
        createTimelineEvent(
          "REPORT_RECEIVED",
          sourceLabel + report.id + " was received.",
          source,
          { reportId: report.id },
        ),
      );
      incidents.push(incident);
    }

    if (report.evidence.length) {
      incident.timeline.push(
        createTimelineEvent(
          "IMAGE_EVIDENCE_ADDED",
          "Resident photo evidence was attached to report " + report.id + ".",
          source,
          { reportId: report.id, evidenceCount: report.evidence.length },
        ),
      );
    }

    recalculatePriority(incident, reports, signals, true);
    // Persist the processed incident first so cross-tab report listeners can
    // resolve report.incidentId as soon as the report storage event arrives.
    saveIncidents(incidents);
    saveReports(reports);

    return {
      report: report,
      incident: incident,
      matched: match.matched,
      match: match,
    };
  }

  function processSmartMeterSignal(input) {
    const reports = getReports();
    const incidents = getIncidents();
    const signals = getSignals();
    const signal = normalizeSignal({
      id: input.id || nextId("METER-EVT-", signals, 1),
      meterId: input.meterId || "MTR-OPS-" + String(signals.length + 1).padStart(3, "0"),
      source: "smart_meter",
      status: input.status || "offline",
      outageType: input.outageType || "Power outage",
      latitude: input.latitude,
      longitude: input.longitude,
      timestamp: input.timestamp || nowIso(),
    });
    const match = findMatchingIncident(signal, incidents);
    let incident;

    if (match.matched) {
      incident = incidents.find(function (item) {
        return item.id === match.incidentId;
      });
      signal.incidentId = incident.id;
      incident.linkedSignals.push(signal.id);
      incident.updatedAt = nowIso();
    } else {
      const incidentId = nextId("INC-", incidents, 1);
      signal.incidentId = incidentId;
      incident = newIncident(incidentId, signal, [], [signal.id]);
      incidents.push(incident);
    }

    signals.push(signal);
    incident.timeline.push(
      createTimelineEvent(
        "SMART_METER_SIGNAL",
        "Smart meter " + signal.meterId + " reported " + signal.status + ".",
        "smart_meter",
        { signalId: signal.id, meterId: signal.meterId, matchScore: match.score },
      ),
    );
    recalculatePriority(incident, reports, signals, true);
    saveSignals(signals);
    saveIncidents(incidents);

    return {
      signal: signal,
      incident: incident,
      matched: match.matched,
      match: match,
    };
  }

  // DEMO: Smart-meter events are simulated.
  // TODO: Replace simulated smart-meter signals with real telemetry.
  // TODO: Replace with municipal/smart-meter telemetry integration.
  function simulateSmartMeterEvent(incidentId) {
    const incident = getIncident(incidentId);
    if (!incident || incident.latitude === null || incident.longitude === null) {
      throw new Error("The selected incident needs coordinates for a nearby meter event.");
    }

    const signalNumber = getSignals().length + 1;
    const offset = ((signalNumber % 5) + 1) * 0.00008;
    return processSmartMeterSignal({
      meterId: "MTR-OPS-" + String(signalNumber).padStart(3, "0"),
      status: "offline",
      outageType: incident.outageType,
      latitude: incident.latitude + offset,
      longitude: incident.longitude - offset,
    });
  }

  function linkReportToIncident(reportId, incidentId, matchDetails) {
    const reports = getReports();
    const incidents = getIncidents();
    const signals = getSignals();
    const report = reports.find(function (item) {
      return item.id === reportId;
    });
    const incident = incidents.find(function (item) {
      return item.id === incidentId;
    });

    if (!report || !incident) {
      return null;
    }

    report.incidentId = incident.id;
    incident.linkedReportIds = unique(incident.linkedReportIds.concat(report.id));
    incident.updatedAt = nowIso();
    const sourceLabel = report.source === "admin_manual" ? "Admin manual report " : "Resident report ";
    incident.timeline.push(
      createTimelineEvent(
        "REPORT_LINKED",
        sourceLabel + report.id + " was linked to this incident.",
        report.source,
        Object.assign({ reportId: report.id }, matchDetails || {}),
      ),
    );
    recalculatePriority(incident, reports, signals, true);
    saveReports(reports);
    saveIncidents(incidents);
    return incident;
  }

  function setIncidentAwaitingConfirmation(incidentId) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) {
      return item.id === incidentId;
    });
    if (!incident) {
      return null;
    }

    incident.status = "Awaiting Confirmation";
    incident.updatedAt = nowIso();
    incident.restorationState.state = "awaiting_confirmation";
    incident.timeline.push(
      createTimelineEvent(
        "RESTORATION_PENDING_CONFIRMATION",
        "Restoration is awaiting confirmation from linked residents.",
        "system",
        { operationalControl: true },
      ),
    );
    saveIncidents(incidents);
    return incident;
  }

  function recordRestorationConfirmation(incidentId, reportId, restored) {
    const incidents = getIncidents();
    const incident = incidents.find(function (item) {
      return item.id === incidentId;
    });
    if (!incident || incident.status !== "Awaiting Confirmation" || !incident.linkedReportIds.includes(reportId)) {
      return null;
    }

    const confirmation = {
      reportId: reportId,
      restored: Boolean(restored),
      timestamp: nowIso(),
      source: "resident_report",
    };
    const existingIndex = incident.restorationConfirmations.findIndex(
      function (item) {
        return item.reportId === reportId;
      },
    );

    if (existingIndex >= 0) {
      incident.restorationConfirmations[existingIndex] = confirmation;
    } else {
      incident.restorationConfirmations.push(confirmation);
    }

    const positiveCount = incident.restorationConfirmations.filter(function (item) {
      return item.restored;
    }).length;
    const negativeCount = incident.restorationConfirmations.length - positiveCount;
    incident.restorationState.positiveCount = positiveCount;
    incident.restorationState.negativeCount = negativeCount;
    incident.restorationState.needsReview = !restored;
    incident.updatedAt = nowIso();

    if (restored) {
      incident.restorationState.state = "resident_confirmed";
      incident.timeline.push(
        createTimelineEvent(
          "RESIDENT_CONFIRMED_RESTORED",
          "A linked resident confirmed that electricity was restored.",
          "resident_report",
          { reportId: reportId, positiveCount: positiveCount },
        ),
      );
      incident.status = "Resolved";
      incident.timeline.push(
        createTimelineEvent(
          "INCIDENT_RESOLVED",
          "The incident was resolved after resident confirmation.",
          "system",
          { reportId: reportId },
        ),
      );
    } else {
      incident.restorationState.state = "not_restored";
      incident.status = "Reopened";
      incident.attentionFlag = { type: "restoration_failed", timestamp: confirmation.timestamp, message: "Resident reported service is still unavailable." };
      incident.timeline.push(
        createTimelineEvent(
          "RESIDENT_REPORTED_NOT_RESTORED",
          "A linked resident reported that electricity was not restored.",
          "resident_report",
          { reportId: reportId, negativeCount: negativeCount },
        ),
      );
      incident.timeline.push(
        createTimelineEvent(
          "INCIDENT_REOPENED",
          "The incident was reopened for review.",
          "system",
          { reportId: reportId },
        ),
      );
    }

    saveIncidents(incidents);
    return incident;
  }

  function getAnalytics() {
    const reports = getReports();
    const incidents = getIncidents();
    const signals = getSignals();
    const confirmations = incidents.reduce(function (total, incident) {
      return total + incident.restorationConfirmations.length;
    }, 0);

    return {
      totalReports: reports.length,
      activeIncidents: incidents.filter(function (incident) {
        return ACTIVE_STATUSES.includes(incident.status);
      }).length,
      resolvedIncidents: incidents.filter(function (incident) {
        return incident.status === "Resolved";
      }).length,
      consolidatedReports: incidents.reduce(function (total, incident) {
        return total + Math.max(0, incident.linkedReportIds.length - 1);
      }, 0),
      smartMeterSignals: signals.length,
      restorationConfirmations: confirmations,
    };
  }

  migrateLegacyData();

  window.SecureReportStore = {
    STORAGE_KEYS: STORAGE_KEYS,
    INCIDENT_STATUSES: INCIDENT_STATUSES.slice(),
    MATCHING: Object.assign({}, MATCHING),
    CRITICAL_INFRASTRUCTURE: CRITICAL_INFRASTRUCTURE.slice(),
    getReports: getReports,
    saveReports: saveReports,
    getIncidents: getIncidents,
    saveIncidents: saveIncidents,
    getSignals: getSignals,
    saveSignals: saveSignals,
    getTechnicians: getTechnicians,
    saveTechnicians: saveTechnicians,
    getTechnician: getTechnician,
    getCurrentUser: getCurrentUser,
    setCurrentUser: setCurrentUser,
    resetDemonstration: resetDemonstration,
    getReport: getReport,
    getUnacknowledgedResidentReports: getUnacknowledgedResidentReports,
    getNextUnacknowledgedReport: getNextUnacknowledgedReport,
    acknowledgeReport: acknowledgeReport,
    getLinkedReports: getLinkedReports,
    getIncident: getIncident,
    subscribeToStore: subscribeToStore,
    createReport: submitReport,
    createIncident: createIncident,
    updateIncident: updateIncident,
    approveIncidentPriority: approveIncidentPriority,
    deferIncidentReview: deferIncidentReview,
    canIncidentBeAssigned: canIncidentBeAssigned,
    selectEligibleTechnician: selectEligibleTechnician,
    appendIncidentEvent: appendIncidentEvent,
    getJobsForTechnician: getJobsForTechnician,
    assignTechnician: assignTechnician,
    acceptTechnicianAssignment: acceptTechnicianAssignment,
    updateTechnicianStatus: updateTechnicianStatus,
    saveTechnicianChecklist: saveTechnicianChecklist,
    addTechnicianNote: addTechnicianNote,
    requestTechnicianBackup: requestTechnicianBackup,
    requestTechnicianReassignment: requestTechnicianReassignment,
    requestFalseAlarmReview: requestFalseAlarmReview,
    addTechnicianEvidence: addTechnicianEvidence,
    completeTechnicianRepair: completeTechnicianRepair,
    linkReportToIncident: linkReportToIncident,
    findMatchingIncident: findMatchingIncident,
    calculateIncidentPriority: calculateIncidentPriority,
    processSmartMeterSignal: processSmartMeterSignal,
    simulateSmartMeterEvent: simulateSmartMeterEvent,
    createEvidence: createEvidence,
    analyzeOutageImage: analyzeOutageImage,
    setIncidentAwaitingConfirmation: setIncidentAwaitingConfirmation,
    recordRestorationConfirmation: recordRestorationConfirmation,
    getAnalytics: getAnalytics,
  };

  // TODO: Integrate dispatcher/admin panel with authenticated roles.
  // TODO: Replace local technician identity with an authenticated session.
  // TODO: Implement live technician GPS/WebSocket updates.
  // TODO: Add authentication and report ownership.
})();
