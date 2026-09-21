const severityWeight = { Low: 1, Medium: 2, High: 4, Critical: 6 };
      const outageRegions = ['Pretoria West', 'Soshanguve', 'Centurion', 'Mamelodi', 'Atteridgeville', 'Tembisa'];
      const statusOrder = ['Reported', 'Prioritised', 'Dispatched', 'En Route', 'Nearby', 'On Site', 'Repairing', 'Resolved'];

      const syncCustomerDetails = () => {
        const meterValue = document.getElementById('accountNumber');
        const locationValue = document.getElementById('location');
        const phoneValue = document.getElementById('contactDetails');
        const outageTypeValue = document.getElementById('serviceType');

        const meterDisplay = document.getElementById('meterNumberValue');
        const locationDisplay = document.getElementById('customerLocationValue');
        const phoneDisplay = document.getElementById('customerPhoneValue');
        const outageDisplay = document.getElementById('customerOutageTypeValue');

        if (meterDisplay && meterValue) meterDisplay.textContent = meterValue.value || 'TWN-48291';
        if (locationDisplay && locationValue) locationDisplay.textContent = locationValue.value || 'Pretoria West, Region 5';
        if (phoneDisplay && phoneValue) phoneDisplay.textContent = phoneValue.value || '082 451 1234';
        if (outageDisplay && outageTypeValue) outageDisplay.textContent = outageTypeValue.value || 'Electricity';
      };

      document.getElementById('accountNumber')?.addEventListener('input', syncCustomerDetails);
      document.getElementById('location')?.addEventListener('input', syncCustomerDetails);
      document.getElementById('contactDetails')?.addEventListener('input', syncCustomerDetails);
      document.getElementById('serviceType')?.addEventListener('change', syncCustomerDetails);

      syncCustomerDetails();

      const technicians = [
        { id: 'T-101', name: 'Mpho Nkosi', status: 'Available', location: 'Pretoria West', workload: 3 },
        { id: 'T-102', name: 'Aisha Rahman', status: 'En Route', location: 'Soshanguve', workload: 2 },
        { id: 'T-103', name: 'Lebo Sithole', status: 'On Site', location: 'Mamelodi', workload: 4 },
        { id: 'T-104', name: 'Kagiso Dlamini', status: 'Available', location: 'Centurion', workload: 1 },
        { id: 'T-105', name: 'Nandi Jacobs', status: 'Available', location: 'Atteridgeville', workload: 2 }
      ];

      const outages = [
        {
          id: 'OUT-1001',
          accountNumber: 'TWN-48190',
          customerName: 'Thabo Mokoena',
          location: 'Pretoria West, Region 5',
          contactDetails: '071 234 8811',
          serviceType: 'Electricity',
          severity: 'Critical',
          affectedCustomers: 180,
          serviceImpact: 'Critical infrastructure',
          reportedAt: new Date(Date.now() - 30 * 60000).toISOString(),
          priorityScore: 0,
          status: 'On Site',
          technicianId: 'T-103',
          technicianName: 'Lebo Sithole',
          duplicate: false,
          notifications: [
            { time: '09:18', text: 'Service outage reported and verified.' },
            { time: '09:20', text: 'Technician en route to site.' },
            { time: '09:35', text: 'Technician is on site and diagnosing feeder fault.' }
          ],
          history: []
        },
        {
          id: 'OUT-1002',
          accountNumber: 'TWN-48302',
          customerName: 'Amina Ndlovu',
          location: 'Soshanguve, Block L',
          contactDetails: '082 556 9181',
          serviceType: 'Water',
          severity: 'High',
          affectedCustomers: 90,
          serviceImpact: 'Neighbourhood disruption',
          reportedAt: new Date(Date.now() - 90 * 60000).toISOString(),
          priorityScore: 0,
          status: 'Dispatched',
          technicianId: 'T-102',
          technicianName: 'Aisha Rahman',
          duplicate: false,
          notifications: [
            { time: '08:50', text: 'Water outage received and duplicate check passed.' },
            { time: '08:58', text: 'Supervisor assigned technician to pressure zone.' }
          ],
          history: []
        },
        {
          id: 'OUT-1003',
          accountNumber: 'TWN-48512',
          customerName: 'Johan van Wyk',
          location: 'Centurion, Rooihuiskraal',
          contactDetails: '079 876 3321',
          serviceType: 'Electricity',
          severity: 'Medium',
          affectedCustomers: 32,
          serviceImpact: 'Local outage',
          reportedAt: new Date(Date.now() - 160 * 60000).toISOString(),
          priorityScore: 0,
          status: 'Reported',
          technicianId: null,
          technicianName: null,
          duplicate: false,
          notifications: [
            { time: '08:20', text: 'Outage reported for local feeder inspection.' }
          ],
          history: []
        }
      ];

      const state = {
        selectedOutageId: outages[0]?.id || null,
        lastGeneratedId: 1003,
      };

      function calculatePriorityScore(outage) {
        const severityScore = severityWeight[outage.severity] || 1;
        const impactScore = outage.serviceImpact === 'Critical infrastructure' ? 5 :
          outage.serviceImpact === 'Regional risk' ? 4 :
          outage.serviceImpact === 'Neighbourhood disruption' ? 3 : 2;
        const customersScore = Math.min(Math.ceil(outage.affectedCustomers / 25), 6);
        return severityScore * 10 + impactScore * 7 + customersScore * 3;
      }

      function deduplicateCheck(outageData) {
        const normalizedArea = outageData.location.toLowerCase();
        const baseline = outages.filter((item) => {
          const sameType = item.serviceType === outageData.serviceType;
          const nearbyArea = item.location.toLowerCase().includes(normalizedArea.split(',')[0].trim()) ||
            normalizedArea.includes(item.location.toLowerCase().split(',')[0].trim());
          const recent = new Date(item.reportedAt) > new Date(Date.now() - 4 * 60 * 60 * 1000);
          return sameType && recent && (nearbyArea || item.accountNumber === outageData.accountNumber);
        });

        return baseline;
      }

      function autoAssignTechnician(outage) {
        const available = technicians.filter((tech) => tech.status !== 'Offline');
        if (!available.length) return null;

        const candidate = available.sort((a, b) => {
          const distanceA = localityScore(a.location, outage.location);
          const distanceB = localityScore(b.location, outage.location);
          return (a.workload + distanceA) - (b.workload + distanceB);
        })[0];

        return candidate;
      }

      function localityScore(techLocation, outageLocation) {
        const tech = techLocation.toLowerCase();
        const outage = outageLocation.toLowerCase();
        const techRegion = tech.split(',')[0].trim();
        const outageRegion = outage.split(',')[0].trim();
        if (techRegion === outageRegion) return 0;
        return outageRegions.includes(techRegion) && outageRegions.includes(outageRegion) ? 2 : 4;
      }

      function formatTime(dateInput) {
        const date = new Date(dateInput);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      function severityClass(severity) {
        const value = severity.toLowerCase();
        return value === 'critical' ? 'sev-critical' :
               value === 'high' ? 'sev-high' :
               value === 'medium' ? 'sev-medium' : 'sev-low';
      }

      function statusClass(status) {
        const value = status.toLowerCase().replace(/\s+/g, '-');
        return `status-${value}`;
      }

      function getSelectedOutage() {
        return outages.find((item) => item.id === state.selectedOutageId) || outages[0];
      }

      function renderTechnicians() {
        const techGrid = document.getElementById('techGrid');
        techGrid.innerHTML = technicians.map((tech) => {
          const progress = `${Math.min(100, tech.workload * 22)}%`;
          return `
            <div class="tech-card">
              <div class="tech-header">
                <div class="tech-name">${tech.name}</div>
                <span class="badge ${tech.status === 'Available' ? 'sev-low' : tech.status === 'On Site' ? 'sev-high' : 'sev-medium'}">${tech.status}</span>
              </div>
              <div class="tech-meta">ID: ${tech.id}</div>
              <div class="tech-meta">Base: ${tech.location}</div>
              <div class="tech-meta">Workload: ${tech.workload} jobs</div>
              <div class="progress-wrap">
                <div class="progress-bar"><div class="progress-fill" style="width: ${progress};"></div></div>
              </div>
            </div>
          `;
        }).join('');
      }

      function renderNotifications() {
        const selectedOutage = getSelectedOutage();
        const list = document.getElementById('notificationList');
        const notifications = selectedOutage?.notifications || [];

        list.innerHTML = notifications.slice().reverse().slice(0, 6).map((item) => `
          <li>
            <span class="dot"></span>
            <div>
              <strong>${item.time}</strong>
              <div>${item.text}</div>
            </div>
          </li>
        `).join('');
      }

      function renderOutageTable() {
        const tbody = document.getElementById('outageTableBody');
        const closeJobSelect = document.getElementById('closeJobSelect');

        tbody.innerHTML = outages.map((outage) => {
          const score = calculatePriorityScore(outage);
          outage.priorityScore = score;
          return `
            <tr data-id="${outage.id}" style="cursor: pointer; ${state.selectedOutageId === outage.id ? 'background: #eff6ff;' : ''}">
              <td>${outage.id}</td>
              <td>${outage.location.split(',')[0]}</td>
              <td><span class="badge ${severityClass(outage.severity)}">${outage.priorityScore}</span></td>
              <td><span class="badge ${statusClass(outage.status)}">${outage.status}</span></td>
              <td>${outage.technicianName || 'Unassigned'}</td>
            </tr>
          `;
        }).join('');

        closeJobSelect.innerHTML = outages.map((outage) => `
          <option value="${outage.id}">${outage.id} · ${outage.location.split(',')[0]}</option>
        `).join('');

        document.querySelectorAll('#outageTableBody tr').forEach((row) => {
          row.addEventListener('click', () => {
            state.selectedOutageId = row.dataset.id;
            render();
          });
        });
      }

      function renderInsights() {
        const recurring = [
          { label: 'Transformer faults', value: 72 },
          { label: 'Water main bursts', value: 58 },
          { label: 'Street light failures', value: 34 },
          { label: 'Cable faults', value: 29 }
        ];

        document.getElementById('insightsBars').innerHTML = recurring.map((item) => `
          <div class="bar-row">
            <span>${item.label}</span>
            <div class="bar"><span style="width: ${item.value}%"></span></div>
            <strong>${item.value}%</strong>
          </div>
        `).join('');

        const openCount = outages.filter((o) => o.status !== 'Resolved').length;
        const resolvedCount = outages.filter((o) => o.status === 'Resolved').length;
        const resolutionRate = outages.length ? Math.round((resolvedCount / outages.length) * 100) : 0;
        const avgResponse = Math.round(outages.reduce((total, outage) => total + (Math.max(20, 65 - outage.priorityScore)), 0) / Math.max(outages.length, 1));

        document.getElementById('repeatCalls').textContent = String(Math.max(11, openCount + 5));
        document.getElementById('resolutionRate').textContent = `${resolutionRate}%`;
        document.getElementById('mttr').textContent = `${Math.max(1, Math.round(avgResponse / 60))}h`;
      }

      function renderMetrics() {
        const openCount = outages.filter((o) => o.status !== 'Resolved').length;
        const criticalCount = outages.filter((o) => o.severity === 'Critical' && o.status !== 'Resolved').length;
        const activeTech = technicians.filter((tech) => tech.status !== 'Offline').length;
        const resolvedToday = outages.filter((o) => o.status === 'Resolved').length;
        const avgResponse = outages.reduce((sum, outage) => sum + (outage.priorityScore ? Math.max(20, 58 - outage.priorityScore / 3) : 20), 0) / outages.length || 20;

        document.getElementById('openOutages').textContent = String(openCount);
        document.getElementById('criticalJobs').textContent = String(criticalCount);
        document.getElementById('avgResponse').textContent = `${Math.round(avgResponse)}m`;
        document.getElementById('activeTech').textContent = String(activeTech);
        document.getElementById('resolvedToday').textContent = String(resolvedToday);
      }

      function renderMap() {
        const mapGrid = document.getElementById('mapGrid');
        const cells = Array.from({ length: 25 }, (_, index) => {
          const active = index > 8 && index < 19;
          return `<div class="cell ${active ? 'active' : ''}"></div>`;
        }).join('');
        mapGrid.innerHTML = cells;

        const selected = getSelectedOutage();
        document.getElementById('travelTime').textContent = selected ? `${Math.max(5, 20 - selected.priorityScore / 7)} min` : '12 min';
        document.getElementById('etaTime').textContent = selected ? `${Math.max(12, 30 - selected.priorityScore / 4)} min` : '18 min';
        document.getElementById('crewStatus').textContent = `${Math.max(2, technicians.filter((t) => t.status !== 'Offline').length)} active`;
      }

      function updateDuplicateBox(outageData) {
        const duplicateBox = document.getElementById('duplicateBox');
        const duplicates = deduplicateCheck(outageData);
        if (!duplicates.length) {
          duplicateBox.classList.remove('visible');
          duplicateBox.textContent = '';
          return;
        }

        duplicateBox.classList.add('visible');
        duplicateBox.innerHTML = `Duplicate check found <strong>${duplicates.length}</strong> similar outage(s) in the same service area. Existing case: <strong>${duplicates[0].id}</strong> (${duplicates[0].status})`;
      }

      function pushNotification(outage, message) {
        outage.notifications.push({
          time: formatTime(new Date()),
          text: message
        });
      }

      function advanceOutageStage(outageId, customStatus = null) {
        const outage = outages.find((item) => item.id === outageId);
        if (!outage) return;

        const nextStatus = customStatus || statusOrder[Math.min(statusOrder.indexOf(outage.status) + 1, statusOrder.length - 1)];
        outage.status = nextStatus;

        if (nextStatus === 'Prioritised') {
          pushNotification(outage, 'Outage prioritised against risk and customer impact.');
        } else if (nextStatus === 'Dispatched') {
          const tech = autoAssignTechnician(outage);
          if (tech) {
            outage.technicianId = tech.id;
            outage.technicianName = tech.name;
            tech.status = 'En Route';
            tech.workload += 1;
            pushNotification(outage, `${tech.name} was dispatch-assigned to this outage.`);
          }
        } else if (nextStatus === 'En Route') {
          pushNotification(outage, 'Technician is travelling to the affected service point.');
        } else if (nextStatus === 'Nearby') {
          pushNotification(outage, 'Technician is within a few minutes of the site and customer updates have been sent.');
        } else if (nextStatus === 'On Site') {
          pushNotification(outage, 'Crew has arrived on site and started diagnostic work.');
        } else if (nextStatus === 'Repairing') {
          pushNotification(outage, 'Repair work is underway and a temporary isolation has been applied.');
        } else if (nextStatus === 'Resolved') {
          pushNotification(outage, 'Repair completed and customer restoration confirmed.');
        }

        render();
      }

      function submitOutage(e) {
        e.preventDefault();

        const formData = {
          accountNumber: document.getElementById('accountNumber').value,
          customerName: document.getElementById('customerName').value,
          location: document.getElementById('location').value,
          contactDetails: document.getElementById('contactDetails').value,
          serviceType: document.getElementById('serviceType').value,
          severity: document.getElementById('severity').value,
          affectedCustomers: Number(document.getElementById('affectedCustomers').value),
          serviceImpact: document.getElementById('serviceImpact').value,
          status: 'Reported',
          priorityScore: 0,
          technicianId: null,
          technicianName: null,
          reportedAt: new Date().toISOString(),
          duplicate: false,
          notifications: [{ time: formatTime(new Date()), text: 'Outage reported and customer profile validated.' }],
          history: []
        };

        const similar = deduplicateCheck(formData);
        formData.duplicate = Boolean(similar.length);
        updateDuplicateBox(formData);
        formData.priorityScore = calculatePriorityScore(formData);

        const newId = `OUT-${++state.lastGeneratedId}`;
        formData.id = newId;
        outages.unshift(formData);
        state.selectedOutageId = newId;

        if (formData.duplicate) {
          pushNotification(formData, 'Duplicate check flagged a near-identical outage; task merged into active case review.');
        }

        render();
      }

      function closeJob(e) {
        e.preventDefault();
        const selectedId = document.getElementById('closeJobSelect').value;
        const outage = outages.find((item) => item.id === selectedId);
        if (!outage) return;

        const workPerformed = document.getElementById('workPerformed').value;
        outage.status = 'Resolved';
        outage.history.push({
          type: 'close',
          note: `Repair completed: ${workPerformed}`,
          time: new Date().toISOString(),
        });
        outage.notifications.push({
          time: formatTime(new Date()),
          text: 'Issue resolved, customer notified, and job closed in the system.'
        });

        const technician = technicians.find((tech) => tech.id === outage.technicianId);
        if (technician) {
          technician.status = 'Available';
          technician.workload = Math.max(0, technician.workload - 1);
        }

        render();
      }

      function logDelay() {
        const outage = getSelectedOutage();
        if (!outage) return;

        const reason = prompt('Enter the change reason (e.g. supply delay, postponement, reassignment, weather impact):');
        if (!reason) return;

        outage.history.push({
          type: 'change',
          note: reason,
          time: new Date().toISOString(),
        });

        outage.status = 'Dispatched';
        outage.notifications.push({
          time: formatTime(new Date()),
          text: `Operational change logged: ${reason}`
        });
        render();
      }

      function render() {
        renderMetrics();
        renderOutageTable();
        renderTechnicians();
        renderNotifications();
        renderMap();
        renderInsights();
      }

      document.getElementById('outageForm').addEventListener('submit', submitOutage);
      document.getElementById('closeJobForm').addEventListener('submit', closeJob);
      document.getElementById('delayBtn').addEventListener('click', logDelay);

      outages.forEach((outage) => {
        outage.priorityScore = calculatePriorityScore(outage);
      });
      render();
