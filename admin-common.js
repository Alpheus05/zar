(function () {
  "use strict";

  const store = window.SecureReportStore;

  const AREAS = [
    { name: "Pretoria West", region: "Region 3", latitude: -25.7547, longitude: 28.1468, x: 32, y: 48 },
    { name: "Mamelodi", region: "Region 6", latitude: -25.717, longitude: 28.365, x: 76, y: 34 },
    { name: "Centurion", region: "Region 4", latitude: -25.86, longitude: 28.19, x: 57, y: 76 },
    { name: "Soshanguve", region: "Region 1", latitude: -25.54, longitude: 28.09, x: 43, y: 19 },
    { name: "Atteridgeville", region: "Region 3", latitude: -25.7722, longitude: 28.0758, x: 18, y: 61 },
  ];

  function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
  }

  function ids(prefix, count) {
    return Array.from({ length: count }, function (_, index) {
      return prefix + String(index + 1).padStart(3, "0");
    });
  }

  // Legacy reference records retained for schema compatibility only.
  // Operational views use canonical stored incidents exclusively.
  const REFERENCE_INCIDENTS = [
    {
      id: "INC-004",
      createdAt: minutesAgo(48),
      updatedAt: minutesAgo(22),
      status: "Verified",
      latitude: AREAS[0].latitude,
      longitude: AREAS[0].longitude,
      area: AREAS[0].name,
      region: AREAS[0].region,
      outageType: "Cable fault",
      linkedReportIds: [],
      linkedSignals: ids("REF-MTR-004-", 22),
      priority: "Critical",
      priorityScore: 92,
      priorityReasons: [
        "22 smart meters offline in the area",
        "Steve Biko Academic Hospital within affected area",
        "High impact (estimated 120+ customers)",
      ],
      criticalInfrastructure: [
        { id: "FAC-REF-1", name: "Pretoria West Clinic", type: "Clinic", distanceMeters: 420 },
      ],
      restorationConfirmations: [],
      restorationState: { state: "not_requested", positiveCount: 0, negativeCount: 0, needsReview: false },
      timeline: [
        { type: "INCIDENT_CREATED", timestamp: minutesAgo(48), message: "Reference incident created", source: "reference", metadata: {} },
        { type: "SMART_METER_SIGNAL", timestamp: minutesAgo(44), message: "12 smart meters detected offline", source: "smart_meter", metadata: {} },
        { type: "PRIORITY_CHANGED", timestamp: minutesAgo(40), message: "Clinic detected in affected area; priority increased", source: "rules_engine", metadata: {} },
      ],
      sourceType: "reference",
    },
    {
      id: "INC-007",
      createdAt: minutesAgo(92),
      updatedAt: minutesAgo(45),
      status: "Verified",
      latitude: AREAS[1].latitude,
      longitude: AREAS[1].longitude,
      area: AREAS[1].name,
      region: AREAS[1].region,
      outageType: "Transformer fault",
      linkedReportIds: [],
      linkedSignals: ids("REF-MTR-007-", 9),
      priority: "High",
      priorityScore: 66,
      priorityReasons: ["9 smart meters offline", "Possible transformer fault"],
      criticalInfrastructure: [],
      restorationConfirmations: [],
      restorationState: { state: "not_requested", positiveCount: 0, negativeCount: 0, needsReview: false },
      timeline: [
        { type: "INCIDENT_CREATED", timestamp: minutesAgo(92), message: "Reference incident created", source: "reference", metadata: {} },
      ],
      sourceType: "reference",
    },
    {
      id: "INC-009",
      createdAt: minutesAgo(104),
      updatedAt: minutesAgo(72),
      status: "Reported",
      latitude: AREAS[2].latitude,
      longitude: AREAS[2].longitude,
      area: AREAS[2].name,
      region: AREAS[2].region,
      outageType: "Local supply fault",
      linkedReportIds: [],
      linkedSignals: [],
      priority: "Medium",
      priorityScore: 38,
      priorityReasons: ["Local supply fault awaiting verification"],
      criticalInfrastructure: [],
      restorationConfirmations: [],
      restorationState: { state: "not_requested", positiveCount: 0, negativeCount: 0, needsReview: false },
      timeline: [
        { type: "INCIDENT_CREATED", timestamp: minutesAgo(104), message: "Reference incident created", source: "reference", metadata: {} },
      ],
      sourceType: "reference",
    },
    {
      id: "INC-012",
      createdAt: minutesAgo(148),
      updatedAt: minutesAgo(123),
      status: "Reported",
      latitude: AREAS[4].latitude,
      longitude: AREAS[4].longitude,
      area: AREAS[4].name,
      region: AREAS[4].region,
      outageType: "Meter-related fault",
      linkedReportIds: [],
      linkedSignals: [],
      priority: "Low",
      priorityScore: 18,
      priorityReasons: ["Meter-related fault awaiting verification"],
      criticalInfrastructure: [],
      restorationConfirmations: [],
      restorationState: { state: "not_requested", positiveCount: 0, negativeCount: 0, needsReview: false },
      timeline: [
        { type: "INCIDENT_CREATED", timestamp: minutesAgo(148), message: "Reference incident created", source: "reference", metadata: {} },
      ],
      sourceType: "reference",
    },
    {
      id: "INC-015",
      createdAt: minutesAgo(220),
      updatedAt: minutesAgo(180),
      status: "Resolved",
      latitude: AREAS[3].latitude,
      longitude: AREAS[3].longitude,
      area: AREAS[3].name,
      region: AREAS[3].region,
      outageType: "Cable fault",
      linkedReportIds: [],
      linkedSignals: [],
      priority: "Low",
      priorityScore: 12,
      priorityReasons: ["Reference incident marked resolved"],
      criticalInfrastructure: [],
      restorationConfirmations: [],
      restorationState: { state: "not_requested", positiveCount: 0, negativeCount: 0, needsReview: false },
      timeline: [
        { type: "INCIDENT_CREATED", timestamp: minutesAgo(220), message: "Reference incident created", source: "reference", metadata: {} },
        { type: "INCIDENT_RESOLVED", timestamp: minutesAgo(180), message: "Reference incident marked resolved", source: "reference", metadata: {} },
      ],
      sourceType: "reference",
    },
  ];

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function distance(first, second) {
    const firstLat = number(first.latitude);
    const firstLng = number(first.longitude);
    const secondLat = number(second.latitude);
    const secondLng = number(second.longitude);
    if ([firstLat, firstLng, secondLat, secondLng].includes(null)) {
      return Infinity;
    }
    const toRad = function (value) { return value * Math.PI / 180; };
    const lat = toRad(secondLat - firstLat);
    const lng = toRad(secondLng - firstLng);
    const a = Math.sin(lat / 2) ** 2 +
      Math.cos(toRad(firstLat)) * Math.cos(toRad(secondLat)) * Math.sin(lng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function closestArea(incident, fallbackIndex) {
    if (number(incident.latitude) === null || number(incident.longitude) === null) {
      return { name: "Location pending", region: "Tshwane", x: 50, y: 50 };
    }
    const ranked = AREAS.map(function (area) {
      return { area: area, distance: distance(incident, area) };
    }).sort(function (a, b) { return a.distance - b.distance; });

    if (ranked[0] && ranked[0].distance < 40000) {
      return ranked[0].area;
    }
    return AREAS[fallbackIndex % AREAS.length];
  }

  function enrichIncident(incident, index) {
    const area = incident.area
      ? (AREAS.find(function (item) { return item.name === incident.area; }) ||
        { name: incident.area, region: incident.region || "Tshwane", x: 50, y: 50 })
      : closestArea(incident, index);
    return Object.assign({}, incident, {
      area: area.name,
      region: area.region,
      mapX: area.x,
      mapY: area.y,
      linkedReportIds: incident.linkedReportIds || [],
      linkedSignals: incident.linkedSignals || [],
      priorityReasons: incident.priorityReasons || [],
      criticalInfrastructure: incident.criticalInfrastructure || [],
      timeline: incident.timeline || [],
      restorationState: incident.restorationState || {},
      triage: incident.triage || {
        state: "approved",
        recommendation: { priority: incident.priority || "Low", reasons: incident.priorityReasons || [], generatedAt: incident.updatedAt || incident.createdAt },
        adminPriority: incident.priority || "Low",
        reviewedBy: "Imported record",
        reviewedAt: incident.updatedAt || null,
        deferredAt: null,
      },
      sourceType: incident.sourceType || "stored",
    });
  }

  function getStoredIncidents() {
    return store ? store.getIncidents().map(enrichIncident) : [];
  }

  function getDisplayIncidents() {
    return getStoredIncidents();
  }

  function getIncident(id) {
    const incidents = getDisplayIncidents();
    return incidents.find(function (incident) {
      return incident.id === id;
    }) || incidents.find(function (incident) {
      return incident.displayId === id;
    }) || null;
  }

  function incidentLabel(incident) {
    return incident.displayId || incident.id;
  }

  function getReports(incident) {
    if (!store) {
      return [];
    }
    return store.getLinkedReports
      ? store.getLinkedReports(incident)
      : store.getReports().filter(function (report) {
          return incident.linkedReportIds.includes(report.id);
        });
  }

  function relativeTime(timestamp) {
    const difference = Math.max(0, Date.now() - new Date(timestamp).getTime());
    const minutes = Math.floor(difference / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h " + (minutes % 60) + "m ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function slug(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function badge(value) {
    return '<span class="badge badge-' + slug(value) + '">' + escapeHtml(value) + "</span>";
  }

  function priority(value) {
    const label = value || "Not approved";
    return '<span class="priority priority-' + slug(label) + '"><span class="priority-dot" aria-hidden="true"></span>' +
      escapeHtml(label) + "</span>";
  }

  const STATUS_ICONS = {
    "Reported": "●",
    "Verified": "✓",
    "Prioritised": "◆",
    "Awaiting Dispatch": "◷",
    "Repair Completed": "✓",
    "Awaiting Confirmation": "◷",
    "Resolved": "✓",
    "Reopened": "↻",
    "Needs Review": "⚠",
    "Reviewed": "✓",
    "Awaiting Review": "⚠",
  };

  function statusIcon(value) {
    return STATUS_ICONS[value] || "●";
  }

  function status(value) {
    const label = value || "Reported";
    return '<span class="status status-' + slug(label) + '"><span class="status-icon" aria-hidden="true">' +
      statusIcon(label) + "</span>" + escapeHtml(label) + "</span>";
  }

  function setupShell() {
    const button = document.getElementById("menuBtn");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (!button || !sidebar || !overlay) return;

    function close() {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    }
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", function () {
      const open = sidebar.classList.toggle("open");
      overlay.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
    });
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  function areaForName(name) {
    return AREAS.find(function (area) { return area.name === name; }) || AREAS[0];
  }

  function isToday(timestamp) {
    const date = new Date(timestamp);
    return !Number.isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
  }

  function isActiveIncident(incident) {
    return incident.status !== "Resolved";
  }

  function isCriticalIncident(incident) {
    return incident.priority === "Critical";
  }

  function resolvedTimestamp(incident) {
    const resolutionEvent = (incident.timeline || []).slice().reverse().find(function (event) {
      return event.type === "INCIDENT_RESOLVED";
    });
    return resolutionEvent ? resolutionEvent.timestamp : incident.updatedAt;
  }

  function isResolvedToday(incident) {
    return incident.status === "Resolved" && isToday(resolvedTimestamp(incident));
  }

  function getActiveIncidents(incidents) {
    return (incidents || getDisplayIncidents()).filter(isActiveIncident);
  }

  function getCriticalIncidents(incidents) {
    return (incidents || getDisplayIncidents()).filter(isCriticalIncident);
  }

  function getReportsToday(reports) {
    const humanReports = reports || (store ? store.getReports() : []);
    return humanReports.filter(function (report) { return isToday(report.timestamp); });
  }

  function getResolvedToday(incidents) {
    return (incidents || getDisplayIncidents()).filter(isResolvedToday);
  }

  function hasUsableLocation(incident) {
    const latitude = number(incident.latitude);
    const longitude = number(incident.longitude);
    return latitude !== null && longitude !== null &&
      !(Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) &&
      incident.area !== "Location pending" && incident.locationUncertain !== true;
  }

  function hasNegativeRestorationFeedback(incident) {
    const restoration = incident.restorationState || {};
    return restoration.needsReview === true || Number(restoration.negativeCount || 0) > 0;
  }

  function requiresAttention(incident) {
    const pendingTriage = Boolean(incident.triage && ["pending", "deferred"].includes(incident.triage.state));
    const pendingTechnicianRequest = Boolean(
      (incident.backupRequest && incident.backupRequest.status === "pending_admin_review") ||
      (incident.reassignmentRequest && incident.reassignmentRequest.status === "pending_admin_review") ||
      (incident.falseAlarmReview && incident.falseAlarmReview.status === "pending_admin_review") ||
      (incident.timeline || []).some(function (event) {
        return ["TECHNICIAN_BACKUP_REQUESTED", "TECHNICIAN_REASSIGNMENT_REQUESTED", "FALSE_ALARM_REVIEW_REQUESTED"].includes(event.type);
      }),
    );
    const explicitlyFlagged = Boolean(incident.attentionFlag) || pendingTechnicianRequest;
    const configuredHighReview = incident.priority === "High" && incident.requiresReview === true;
    const negativeRestoration = hasNegativeRestorationFeedback(incident);
    return isActiveIncident(incident) && (
      incident.priority === "Critical" ||
      configuredHighReview ||
      incident.status === "Reopened" ||
      incident.status === "Needs Review" ||
      (incident.status === "Awaiting Confirmation" && negativeRestoration) ||
      negativeRestoration ||
      !hasUsableLocation(incident) ||
      explicitlyFlagged
      || pendingTriage
    );
  }

  function getAttentionIncidents(incidents) {
    return (incidents || getDisplayIncidents()).filter(requiresAttention);
  }

  function reportSourceLabel(report) {
    return report.source === "admin_manual" ? "Admin manual" : "Resident report";
  }

  function reportArea(report) {
    const capture = report.locationCapture || {};
    if (capture.area) return capture.area;
    const incident = report.incidentId ? getIncident(report.incidentId) : null;
    if (incident && incident.area && incident.area !== "Location pending") return incident.area;
    if (capture.text) {
      return /unavailable|without coordinates|permission denied/i.test(capture.text)
        ? "Location pending"
        : capture.text;
    }
    if (number(report.latitude) !== null && number(report.longitude) !== null) {
      return number(report.latitude).toFixed(5) + ", " + number(report.longitude).toFixed(5);
    }
    return "Location unavailable";
  }

  window.SecureReportAdminUI = {
    AREAS: AREAS,
    REFERENCE_INCIDENTS: REFERENCE_INCIDENTS,
    getStoredIncidents: getStoredIncidents,
    getDisplayIncidents: getDisplayIncidents,
    getIncident: getIncident,
    getReports: getReports,
    relativeTime: relativeTime,
    formatTime: formatTime,
    slug: slug,
    escapeHtml: escapeHtml,
    badge: badge,
    priority: priority,
    status: status,
    statusIcon: statusIcon,
    incidentLabel: incidentLabel,
    setupShell: setupShell,
    areaForName: areaForName,
    isToday: isToday,
    isActiveIncident: isActiveIncident,
    isCriticalIncident: isCriticalIncident,
    isResolvedToday: isResolvedToday,
    getActiveIncidents: getActiveIncidents,
    getCriticalIncidents: getCriticalIncidents,
    getReportsToday: getReportsToday,
    getResolvedToday: getResolvedToday,
    hasUsableLocation: hasUsableLocation,
    hasNegativeRestorationFeedback: hasNegativeRestorationFeedback,
    requiresAttention: requiresAttention,
    getAttentionIncidents: getAttentionIncidents,
    reportSourceLabel: reportSourceLabel,
    reportArea: reportArea,
  };

  setupShell();
})();
