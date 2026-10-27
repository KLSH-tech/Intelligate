const zones = [
  { name: "Z01", label: "L_UPPER", triggers: 0, metals: 0 },
  { name: "Z02", label: "L_MIDDLE", triggers: 0, metals: 0 },
  { name: "Z03", label: "L_LOWER", triggers: 0, metals: 0 },
  { name: "Z04", label: "R_UPPER", triggers: 0, metals: 0 },
  { name: "Z05", label: "R_MIDDLE", triggers: 0, metals: 0 },
  { name: "Z06", label: "R_LOWER", triggers: 0, metals: 0 },
];
const screeningModel = window.IntelliGateScreeningModel;

const initialZones = zones.map((zone) => ({ ...zone }));
let trafficEntries = Array(24).fill(0);
let trafficExits = Array(24).fill(0);
let entriesToday = 0;
let exitsToday = 0;
let occupancy = 0;
let nextPassageId = 1;
let remainingMetalZones = [];
let previousMetalZone = "";
let events = [];
let alarmContext = null;
let entryAudioContext = null;
let alarmInterval = null;
let alarmToneIndex = 0;
let personEntryAnimationTimeout = null;
let personEntryProgressFrame = null;
let communityHighlightTimeout = null;
let takeoverTimerInterval = null;
let takeoverTimerStartedAt = null;
let systemInitialized = false;
let machineActive = false;
let machineRebooting = false;

const trafficChart = document.querySelector("#traffic-chart");
const zoneChart = document.querySelector("#zone-chart");
const eventLog = document.querySelector("#event-log");
const alertsLog = document.querySelector("#alerts-log");
const thresholdInput = document.querySelector("#threshold");
const thresholdReadout = document.querySelector("#threshold-readout");
const settingsFeedback = document.querySelector("#settings-feedback");
const alertTakeover = document.querySelector("#alert-takeover");
const takeoverTitle = document.querySelector("#takeover-title");
const takeoverDetail = document.querySelector("#takeover-detail");
const takeoverMeta = document.querySelector("#takeover-meta");
const takeoverEntryButton = document.querySelector("#takeover-entry");
const takeoverResetButton = document.querySelector("#takeover-reset");
const takeoverTimerDisplay = document.querySelector("#takeover-timer");

function formatTimestamp(date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return parts;
}

function shortTime(timestamp) {
  return timestamp.slice(11, 19);
}

function parseTimestamp(timestamp) {
  return new Date(timestamp.replace(" ", "T"));
}

function drawRandomMetalZone() {
  if (remainingMetalZones.length === 0) {
    remainingMetalZones = zones.map((zone) => zone.name);
    for (let index = remainingMetalZones.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [remainingMetalZones[index], remainingMetalZones[randomIndex]] =
        [remainingMetalZones[randomIndex], remainingMetalZones[index]];
    }

    if (remainingMetalZones[remainingMetalZones.length - 1] === previousMetalZone) {
      [remainingMetalZones[0], remainingMetalZones[remainingMetalZones.length - 1]] =
        [remainingMetalZones[remainingMetalZones.length - 1], remainingMetalZones[0]];
    }
  }

  previousMetalZone = remainingMetalZones.pop();
  return zones.find((zone) => zone.name === previousMetalZone);
}

function activeMetalAlertExists() {
  return events.some((event) => event.zone && event.status !== "NORMAL" && !event.acknowledged);
}

function playEntryChime(entryNumber) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return "this browser does not support the entry chime";
  }

  try {
    entryAudioContext ??= new AudioContextConstructor();
    const context = entryAudioContext;
    const variation = (entryNumber - 1) % 8;
    const startTime = context.currentTime + 0.03;
    const notes = [
      { frequency: 660 + variation * 32, offset: 0, duration: 0.12 },
      { frequency: 880 + variation * 28, offset: 0.15, duration: 0.18 },
    ];

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startTime + note.offset;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.35, noteStart + 0.015);
      gain.gain.setValueAtTime(0.35, noteStart + note.duration * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + note.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + note.duration);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }

    if (context.state === "suspended") {
      void context.resume().catch((error) => {
        settingsFeedback.style.color = "#ef7279";
        settingsFeedback.textContent = `Entry recorded, but the entry chime could not start: ${error.message}`;
      });
    }
    return null;
  } catch (error) {
    return `the entry chime failed: ${error.message}`;
  }
}

function updateAlarmState(label, isSounding) {
  const state = document.querySelector("#alarm-state");
  state.textContent = label;
  state.classList.toggle("is-sounding", isSounding);
}

function stopMetalAlarm() {
  if (alarmInterval !== null) {
    window.clearInterval(alarmInterval);
    alarmInterval = null;
  }

  if (alarmContext) {
    const context = alarmContext;
    alarmContext = null;
    void context.close().catch((error) => {
      settingsFeedback.textContent = `Could not stop audio alarm cleanly: ${error.message}`;
    });
  }

  updateAlarmState(
    activeMetalAlertExists() ? "ALERT ACTIVE · MUTED" : "SOUND ARMED",
    false,
  );
}

function playMetalAlarmTone() {
  if (!alarmContext || alarmContext.state !== "running") return;

  const context = alarmContext;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startedAt = context.currentTime;
  const duration = 0.26;
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(alarmToneIndex % 2 === 0 ? 880 : 660, startedAt);
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.exponentialRampToValueAtTime(0.1, startedAt + 0.025);
  gain.gain.setValueAtTime(0.1, startedAt + 0.16);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + duration);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  alarmToneIndex += 1;
}

function startMetalAlarm() {
  if (alarmInterval !== null || !activeMetalAlertExists()) return;

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    updateAlarmState("AUDIO UNAVAILABLE", false);
    settingsFeedback.style.color = "#ef7279";
    settingsFeedback.textContent = "This browser does not support the audio alarm.";
    return;
  }

  try {
    const context = new AudioContextConstructor();
    alarmContext = context;
    void context.resume().then(() => {
      if (alarmContext === context && activeMetalAlertExists()) playMetalAlarmTone();
    }).catch((error) => {
      if (alarmContext !== context) return;
      stopMetalAlarm();
      settingsFeedback.style.color = "#ef7279";
      settingsFeedback.textContent = `Could not start the audio alarm: ${error.message}`;
    });
    alarmInterval = window.setInterval(() => {
      try {
        playMetalAlarmTone();
      } catch (error) {
        stopMetalAlarm();
        settingsFeedback.style.color = "#ef7279";
        settingsFeedback.textContent = `Audio alarm playback failed: ${error.message}`;
      }
    }, 650);
    updateAlarmState("ALARM SOUNDING", true);
    settingsFeedback.style.color = "";
    settingsFeedback.textContent = "Metal alert · repeating audio alarm until next entry";
  } catch (error) {
    stopMetalAlarm();
    settingsFeedback.style.color = "#ef7279";
    settingsFeedback.textContent = `Could not initialize the audio alarm: ${error.message}`;
  }
}

function syncMetalAlarm({ allowStart = false } = {}) {
  const metalAlertActive = activeMetalAlertExists();
  const buzzerEnabled = document.querySelector("#audio-alarm-enabled").checked;
  if (!metalAlertActive) {
    if (alarmInterval !== null || alarmContext) {
      stopMetalAlarm();
    } else {
      updateAlarmState("SOUND ARMED", false);
    }
    return;
  }

  if (!buzzerEnabled) {
    if (alarmInterval !== null || alarmContext) {
      stopMetalAlarm();
    } else {
      updateAlarmState("ALERT ACTIVE · MUTED", false);
    }
    return;
  }

  if (allowStart) {
    startMetalAlarm();
  } else if (alarmInterval === null) {
    updateAlarmState("ALERT ACTIVE · SOUND REQUIRED", false);
  }
}

function createEvent({ direction = "ENTRY", temperature = null, zone = "", minutesAgo = 0 }) {
  const status = screeningModel.classifyEvent(
    { temperature, zone },
    Number(thresholdInput.value),
  );
  const timestamp = formatTimestamp(new Date(Date.now() - minutesAgo * 60_000));
  return {
    timestamp,
    id: String(nextPassageId++).padStart(7, "0"),
    direction,
    temperature,
    zone,
    status,
    acknowledged: false,
    acknowledgedAt: null,
  };
}

function renderTrafficChart() {
  const maximum = Math.max(4, ...trafficEntries, ...trafficExits);
  const bars = trafficEntries.map((entry, index) => {
    const exit = trafficExits[index];
    const entryHeight = entry ? Math.max(2, entry / maximum * 100) : 0;
    const exitHeight = exit ? Math.max(2, exit / maximum * 100) : 0;
    return `<span class="traffic-group" title="${String(index).padStart(2, "0")}:00 · ${entry} entries · ${trafficExits[index]} exits"><i class="bar entries" style="height:${entryHeight}%"></i><i class="bar exits" style="height:${exitHeight}%"></i></span>`;
  }).join("");
  const yAxis = [maximum, maximum * .75, maximum * .5, maximum * .25, 0]
    .map((value) => `<span>${Math.round(value)}</span>`)
    .join("");
  trafficChart.innerHTML = `<div class="traffic-y-axis" aria-hidden="true">${yAxis}</div><div class="traffic-bars">${bars}</div><div class="chart-ticks"><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span></div>`;
}

function renderZoneChart() {
  const bars = zones.map((zone) => {
    const maxTriggers = Math.max(4, ...zones.map((item) => item.triggers));
    const triggerHeight = zone.triggers / maxTriggers * 100;
    const metalHeight = zone.metals / maxTriggers * 100;
    return `<span class="zone-group" title="${zone.name} ${zone.label} · ${zone.triggers} triggers · ${zone.metals} metal detections"><i class="bar triggers" style="height:${triggerHeight}%"></i><i class="bar metal-key" style="height:${metalHeight}%"></i></span>`;
  }).join("");
  const labels = zones.map((zone) => `<span>${zone.name}<br>${zone.label}</span>`).join("");
  zoneChart.innerHTML = `<div class="zone-bars">${bars}</div><div class="zone-labels">${labels}</div>`;
}

function renderAlertTakeover(activeAlerts) {
  if (activeAlerts.length === 0) {
    stopTakeoverTimer();
    if (alertTakeover.open) alertTakeover.close();
    return;
  }

  const metalAlerts = activeAlerts.filter((event) => event.zone);
  const temperatureAlerts = activeAlerts.filter(
    (event) => screeningModel.isElevatedTemperature(event.temperature, Number(thresholdInput.value)),
  );
  const zoneNames = [...new Set(metalAlerts.map((event) => event.zone))];

  if (metalAlerts.length > 0) {
    takeoverTitle.textContent = "HOLD! Metal Object Detected!";
    takeoverDetail.textContent = temperatureAlerts.length > 0
      ? "A metal object and elevated temperature were detected. Keep the gate area clear and follow the screening procedure."
      : "Keep the gate area clear. Follow the screening procedure before allowing the next passage.";
    takeoverMeta.textContent = `DETECTED ZONE${zoneNames.length === 1 ? "" : "S"} · ${zoneNames.join(", ")}`;
  } else {
    takeoverTitle.textContent = "HOLD! Elevated Temperature Detected!";
    takeoverDetail.textContent = `A reading exceeded the ${Number(thresholdInput.value).toFixed(1)} °C threshold. Follow the screening procedure before allowing the next passage.`;
    takeoverMeta.textContent = `HIGHEST READING · ${Math.max(...temperatureAlerts.map((event) => event.temperature)).toFixed(1)} °C`;
  }

  if (!alertTakeover.open) {
    alertTakeover.showModal();
    startTakeoverTimer();
    takeoverEntryButton.focus();
  }
}

function updateTakeoverTimer() {
  if (takeoverTimerStartedAt === null) return;
  const elapsedSeconds = Math.floor((Date.now() - takeoverTimerStartedAt) / 1000);
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  takeoverTimerDisplay.textContent = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function startTakeoverTimer() {
  stopTakeoverTimer();
  takeoverTimerStartedAt = Date.now();
  updateTakeoverTimer();
  takeoverTimerInterval = window.setInterval(updateTakeoverTimer, 250);
}

function stopTakeoverTimer() {
  if (takeoverTimerInterval !== null) {
    window.clearInterval(takeoverTimerInterval);
    takeoverTimerInterval = null;
  }
  takeoverTimerStartedAt = null;
  takeoverTimerDisplay.textContent = "00:00:00";
}

function renderEvents() {
  const period = document.querySelector("#report-range").value;
  const cutoff = period === "24h"
    ? Date.now() - 24 * 60 * 60 * 1000
    : period === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;
  const reportEvents = events.filter((event) => parseTimestamp(event.timestamp).getTime() >= cutoff);
  const visibleEvents = reportEvents.slice(0, 100);
  eventLog.innerHTML = visibleEvents.length ? visibleEvents.map((event) => {
    const statusClass = event.status === "CRITICAL" ? "critical" : event.status === "WARNING" ? "log-warning" : "normal-badge";
    const hasTemperatureReading = screeningModel.hasTemperatureReading(event.temperature);
    const temperatureClass = screeningModel.isElevatedTemperature(event.temperature, Number(thresholdInput.value)) ? "alert-number" : "";
    const temperature = hasTemperatureReading ? `${event.temperature.toFixed(1)} °C` : "No reading";
    return `<tr><td>${event.timestamp}</td><td>${event.id}</td><td>${event.direction}</td><td class="${temperatureClass}">${temperature}</td><td>${event.zone || "—"}</td><td><span class="badge ${statusClass}">${event.status}</span></td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty-alerts">No screening records in this reporting period.</td></tr>`;
  const recordCountLabel = reportEvents.length > 100
    ? `Latest 100 of ${reportEvents.length} records`
    : `${reportEvents.length} record${reportEvents.length === 1 ? "" : "s"}`;
  document.querySelector("#event-log-count").textContent =
    `${recordCountLabel} · ${period === "all" ? "all available demo data" : period === "7d" ? "last 7 days" : "last 24 hours"}`;

  const alertEvents = events.filter((event) => event.status !== "NORMAL");
  const activeAlerts = alertEvents.filter((event) => !event.acknowledged);
  const clearedAlertCount = alertEvents.filter((event) => event.acknowledged).length;
  document.querySelector("#total-alert-count").textContent = String(alertEvents.length);
  document.querySelector("#detected-alert-count").textContent = String(alertEvents.length);
  document.querySelector("#cleared-alert-count").textContent = String(clearedAlertCount);
  document.querySelector(".alert-totals").innerHTML = `<span class="badge detected">${alertEvents.length}&nbsp; Detected</span><span class="badge alert-completed">${clearedAlertCount}&nbsp; Cleared</span>`;
  alertsLog.innerHTML = alertEvents.length
    ? alertEvents.map((event) => {
      const hasMetalDetection = Boolean(event.zone);
      const hasTemperatureAlert = screeningModel.isElevatedTemperature(event.temperature, Number(thresholdInput.value));
      const message = hasMetalDetection && hasTemperatureAlert
        ? "Metal + elevated temperature"
        : hasTemperatureAlert ? "Elevated temperature" : "Metal detected";
      const details = [
        hasMetalDetection ? "Possible metallic object" : "",
        hasTemperatureAlert
          ? `${event.temperature.toFixed(1)} °C · threshold ${Number(thresholdInput.value).toFixed(1)} °C`
          : "",
      ].filter(Boolean).join(" · ");
      const detectedZone = zones.find((zone) => zone.name === event.zone);
      const zoneDetails = detectedZone ? `${detectedZone.name} (${detectedZone.label})` : "—";
      const statusClass = event.acknowledged ? "alert-completed" : "alert-active";
      const statusLabel = event.acknowledged ? "COMPLETED" : "ACTIVE";
      const completionTime = event.acknowledgedAt || "Pending · awaiting next entry";
      const icon = hasTemperatureAlert ? "#i-thermometer" : "#i-magnet";
      const severityClass = event.status === "CRITICAL" ? "critical" : "warning";
      return `<tr class="${event.acknowledged ? "alert-history-row" : "active-alert-row"}"><td title="${event.timestamp}">${shortTime(event.timestamp)}<br><span class="table-detail">${event.timestamp.slice(0, 10)}</span></td><td><svg class="table-icon alert-icon"><use href="${icon}"/></svg><span class="alert-type-label">${message}</span></td><td><span class="table-detail">${details}</span></td><td>${zoneDetails}</td><td><span class="badge ${statusClass}">${statusLabel}</span><br><span class="table-detail ${severityClass}">${event.status}</span></td><td>${completionTime}</td></tr>`;
    }).join("")
    : `<tr><td colspan="6" class="empty-alerts">No alert records · all clear</td></tr>`;
  renderAlertTakeover(activeAlerts);
  syncMetalAlarm();
  renderReportInsights();
}

function renderReportInsights() {
  const metalCount = zones.reduce((total, zone) => total + zone.metals, 0);
  const elevatedCount = events.filter(
    (event) => screeningModel.isElevatedTemperature(event.temperature, Number(thresholdInput.value)),
  ).length;
  const activeAlertCount = events.filter(
    (event) => event.status !== "NORMAL" && !event.acknowledged,
  ).length;
  document.querySelector("#report-screenings").textContent =
    (entriesToday + exitsToday).toLocaleString();
  document.querySelector("#report-metals").textContent = metalCount.toLocaleString();
  document.querySelector("#report-elevated").textContent = elevatedCount.toLocaleString();
  document.querySelector("#report-occupancy").textContent = occupancy.toLocaleString();
  document.querySelector("#report-generated").textContent =
    `Generated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;

  const busiestZone = [...zones].sort((first, second) => second.metals - first.metals)[0];
  const recommendations = [];
  if (elevatedCount > 0) {
    recommendations.push({
      tone: "urgent",
      title: "Review elevated-temperature records",
      detail: `${elevatedCount} available demo record${elevatedCount === 1 ? "" : "s"} exceed the current ${Number(thresholdInput.value).toFixed(1)} °C threshold. Follow your screening protocol for any real-world alert.`,
    });
  }
  if (busiestZone?.metals > 0) {
    recommendations.push({
      tone: "review",
      title: `Review activity at ${busiestZone.name} · ${busiestZone.label}`,
      detail: `This zone has the highest simulated metal-detection count (${busiestZone.metals}). Use the event log to review individual demonstration records.`,
    });
  }
  if (activeAlertCount > 0) {
    recommendations.push({
      tone: "review",
      title: "Run a new entry to clear active demo alerts",
      detail: `${activeAlertCount} alert${activeAlertCount === 1 ? " is" : "s are"} still active. In this prototype, recording a new entry clears the active zone highlights and stops the audible metal alarm.`,
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      tone: "clear",
      title: "No outstanding demo recommendations",
      detail: "There are no elevated sample readings or active alerts at the current threshold.",
    });
  }
  document.querySelector("#recommendations-list").innerHTML = recommendations
    .map((item) => `<li class="recommendation-item ${item.tone}"><span class="recommendation-indicator"></span><div><strong>${item.title}</strong><p>${item.detail}</p></div></li>`)
    .join("");
}

function renderLatestEvent() {
  const event = events[0];
  const peopleIcon = document.querySelector("#passage-people");
  const multiplePeople = entriesToday > 1;
  const communityPeople = entriesToday >= 20;
  const communityShadowSteps = Math.min(Math.max(entriesToday - 20, 0), 30);
  peopleIcon.setAttribute(
    "aria-label",
    communityPeople
      ? `Community screening, ${entriesToday} entries recorded`
      : multiplePeople ? "Multiple people screened" : "Single person",
  );
  peopleIcon.classList.toggle("multiple-people", multiplePeople);
  peopleIcon.classList.toggle("community-people", communityPeople);
  peopleIcon.style.setProperty("--community-glow-opacity", String(communityShadowSteps / 30 * 0.78));
  peopleIcon.style.setProperty("--community-glow-blur", `${communityShadowSteps / 30 * 24}px`);
  const activeAlerts = events.filter(
    (item) => item.status !== "NORMAL" && !item.acknowledged,
  );
  const activeZones = new Set(
    activeAlerts.map((item) => item.zone).filter(Boolean),
  );
  const hasGateAlert = activeAlerts.length > 0;
  const gatePanel = document.querySelector(".gate-panel");
  gatePanel.classList.toggle("has-alert", hasGateAlert);
  const gateIllustration = document.querySelector(".gate-illustration");
  gateIllustration.classList.toggle("gate-system-ready", machineActive && !hasGateAlert);
  gateIllustration.classList.toggle("gate-system-inactive", systemInitialized && !machineActive && !hasGateAlert);
  gateIllustration.classList.toggle("gate-alert-active", hasGateAlert);
  document.querySelector("#gate-state").textContent = hasGateAlert
    ? `ALERT · ${[...activeZones].join(", ") || "TEMPERATURE"}`
    : !systemInitialized ? "INITIALIZING" : machineActive ? "MACHINE ACTIVE · READY" : "MACHINE INACTIVE";
  document.querySelector(".gate-active-label").textContent =
    !systemInitialized ? "INITIALIZING" : machineActive ? "MACHINE ACTIVE" : "MACHINE INACTIVE";
  document.querySelectorAll(".zone-tag").forEach((tag) => {
    tag.classList.toggle("zone-detected", activeZones.has(tag.querySelector("strong").textContent));
  });
  document.querySelectorAll(".detector-dot").forEach((dot) => {
    dot.classList.toggle("is-alert", activeZones.has(dot.dataset.zone));
  });

  if (!event) {
    document.querySelector("#passage-id").textContent = "Awaiting event";
    document.querySelector("#passage-direction").textContent = "—";
    document.querySelector("#event-time").textContent = "No simulated screening yet";
    document.querySelector("#event-temperature").textContent = "— °C";
    document.querySelector("#sensor-temperature").textContent = "Awaiting event";
    document.querySelector("#temperature-badge").textContent = "NO READING";
    document.querySelector("#temperature-badge").classList.remove("elevated");
    document.querySelector("#temperature-badge").classList.add("normal-badge");
    document.querySelector("#detected-zone").textContent = "Awaiting screening";
    document.querySelector("#metal-badge").hidden = true;
    document.querySelector("#metal-detail").textContent = "All detection zones clear";
    document.querySelector("#metal-finding").classList.add("no-metal");
    document.querySelector("#live-temperature").innerHTML = "— <small>°C</small>";
    const temperatureNote = document.querySelector("#temperature-note");
    temperatureNote.textContent = "Awaiting simulated screening";
    temperatureNote.classList.remove("danger");
    temperatureNote.classList.add("good");
    return;
  }

  document.querySelector("#passage-id").textContent = `#${event.id}`;
  document.querySelector("#passage-direction").textContent = event.direction;
  document.querySelector("#event-time").textContent = event.timestamp;
  const hasTemperatureReading = screeningModel.hasTemperatureReading(event.temperature);
  document.querySelector("#event-temperature").textContent = hasTemperatureReading
    ? `${event.temperature.toFixed(1)} °C`
    : "No reading";
  document.querySelector("#sensor-temperature").textContent = hasTemperatureReading
    ? `${event.temperature.toFixed(1)} °C · demo sample`
    : "No sample for this demo event";

  const elevated = screeningModel.isElevatedTemperature(event.temperature, Number(thresholdInput.value));
  const temperatureBadge = document.querySelector("#temperature-badge");
  temperatureBadge.textContent = !hasTemperatureReading ? "NO READING" : elevated ? "ELEVATED" : "NORMAL";
  temperatureBadge.classList.toggle("elevated", elevated);
  temperatureBadge.classList.toggle("normal-badge", !elevated);

  const zone = zones.find((item) => item.name === event.zone);
  document.querySelector("#detected-zone").textContent = zone ? `${zone.name} (${zone.label})` : "No detection";
  document.querySelector("#metal-badge").hidden = !zone;
  document.querySelector("#metal-detail").textContent = zone ? "Possible metallic object" : "All detection zones clear";
  document.querySelector("#metal-finding").classList.toggle("no-metal", !zone);
  document.querySelector("#live-temperature").innerHTML = hasTemperatureReading
    ? `${event.temperature.toFixed(1)} <small>°C</small>`
    : `— <small>°C</small>`;
  const temperatureNote = document.querySelector("#temperature-note");
  temperatureNote.textContent = !hasTemperatureReading
    ? "No temperature sample in this demo event"
    : elevated
      ? `Above demo threshold (${Number(thresholdInput.value).toFixed(1)} °C)`
      : `Normal (≤ ${Number(thresholdInput.value).toFixed(1)} °C)`;
  temperatureNote.classList.toggle("danger", elevated);
  temperatureNote.classList.toggle("good", !elevated);
}

function refreshDashboard() {
  document.querySelector("#entry-count").textContent = String(entriesToday);
  document.querySelector("#exit-count").textContent = String(exitsToday);
  document.querySelector("#occupancy-count").textContent = String(occupancy);
  renderTrafficChart();
  renderEvents();
  renderLatestEvent();
}

function animateGateEntry() {
  const gateIllustration = document.querySelector(".gate-illustration");
  const peopleIcon = document.querySelector("#passage-people");
  const progressBar = document.querySelector("#gate-entry-progress");
  if (personEntryAnimationTimeout !== null) {
    window.clearTimeout(personEntryAnimationTimeout);
  }
  if (communityHighlightTimeout !== null) {
    window.clearTimeout(communityHighlightTimeout);
    communityHighlightTimeout = null;
  }
  if (entriesToday >= 20) {
    peopleIcon.classList.remove("community-entry-flash");
    void peopleIcon.offsetWidth;
    peopleIcon.classList.add("community-entry-flash");
    communityHighlightTimeout = window.setTimeout(() => {
      peopleIcon.classList.remove("community-entry-flash");
      communityHighlightTimeout = null;
    }, 800);
  }
  if (personEntryProgressFrame !== null) {
    window.cancelAnimationFrame(personEntryProgressFrame);
    personEntryProgressFrame = null;
  }

  gateIllustration.classList.remove("person-entering");
  void gateIllustration.offsetWidth;
  gateIllustration.classList.add("person-entering");
  progressBar.value = 0;
  progressBar.style.setProperty("--entry-progress-color", "rgb(167, 160, 167)");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    progressBar.value = 100;
    progressBar.style.setProperty("--entry-progress-color", "rgb(98, 245, 161)");
  } else {
    const animationStartedAt = performance.now();
    const updateProgress = (now) => {
      const progress = Math.min((now - animationStartedAt) / 1400, 1);
      const colorProgress = progress * 2;
      const startColor = colorProgress < 1
        ? [167, 160, 167]
        : [239, 89, 99];
      const endColor = colorProgress < 1
        ? [239, 89, 99]
        : [98, 245, 161];
      const colorRatio = colorProgress < 1 ? colorProgress : colorProgress - 1;
      const color = startColor.map((start, index) =>
        Math.round(start + (endColor[index] - start) * colorRatio),
      );
      progressBar.value = progress * 100;
      progressBar.style.setProperty("--entry-progress-color", `rgb(${color.join(", ")})`);
      if (progress < 1) {
        personEntryProgressFrame = window.requestAnimationFrame(updateProgress);
      } else {
        personEntryProgressFrame = null;
      }
    };
    personEntryProgressFrame = window.requestAnimationFrame(updateProgress);
  }
  personEntryAnimationTimeout = window.setTimeout(() => {
    gateIllustration.classList.remove("person-entering");
    progressBar.value = 0;
    progressBar.style.setProperty("--entry-progress-color", "rgb(167, 160, 167)");
    personEntryAnimationTimeout = null;
  }, 1500);
}

function addScreeningEvent({ type, direction = "SCREENING", temperature = null, zone = "" }) {
  if (!systemInitialized) return;

  machineActive = true;
  if (direction === "ENTRY") {
    animateGateEntry();
    const completionTime = formatTimestamp(new Date());
    events.forEach((event) => {
      if (event.status !== "NORMAL" && !event.acknowledged) {
        event.acknowledged = true;
        event.acknowledgedAt = completionTime;
      }
    });
  }
  const event = createEvent({ direction, temperature, zone });
  events.unshift(event);
  if (direction === "ENTRY") {
    entriesToday += 1;
    occupancy += 1;
    trafficEntries[new Date().getHours()] += 1;
  } else if (direction === "EXIT") {
    exitsToday += 1;
    occupancy = Math.max(0, occupancy - 1);
    trafficExits[new Date().getHours()] += 1;
  }
  if (zone) {
    const activeZone = zones.find((item) => item.name === zone);
    activeZone.triggers += 1;
    activeZone.metals += 1;
    renderZoneChart();
    syncMetalAlarm({ allowStart: true });
  }
  refreshDashboard();
  if (direction === "ENTRY") {
    const chimeError = playEntryChime(entriesToday);
    syncMetalAlarm();
    if (chimeError) {
      settingsFeedback.style.color = "#ef7279";
      settingsFeedback.textContent = `Entry recorded, but ${chimeError}.`;
    } else {
      settingsFeedback.style.color = "";
      settingsFeedback.textContent = "New entry recorded · previous alerts cleared and alarm stopped";
    }
    return;
  }
  syncMetalAlarm({ allowStart: Boolean(zone) });
  settingsFeedback.style.color = "";
  settingsFeedback.textContent = type;
}

function updateThreshold() {
  if (!systemInitialized) return;

  const threshold = Number(thresholdInput.value);
  if (!Number.isFinite(threshold) || threshold < 30 || threshold > 45) {
    thresholdInput.setCustomValidity("Enter a threshold from 30 to 45 °C.");
    settingsFeedback.textContent = "Enter a value from 30 to 45 °C.";
    settingsFeedback.style.color = "#ef7279";
    thresholdInput.reportValidity();
    return;
  }
  thresholdInput.setCustomValidity("");
  thresholdReadout.textContent = threshold.toFixed(1);
  events.forEach((event) => {
    const previousStatus = event.status;
    event.status = screeningModel.classifyEvent(event, threshold);
    const wasAlert = previousStatus !== "NORMAL";
    const isAlert = event.status !== "NORMAL";
    if (!isAlert || !wasAlert) {
      event.acknowledged = false;
      event.acknowledgedAt = null;
    }
  });
  refreshDashboard();
  settingsFeedback.style.color = "";
  settingsFeedback.textContent = `Demo threshold set to ${threshold.toFixed(1)} °C`;
}

function resetDemo() {
  if (!systemInitialized || machineRebooting) return;

  stopMetalAlarm();
  if (personEntryAnimationTimeout !== null) {
    window.clearTimeout(personEntryAnimationTimeout);
    personEntryAnimationTimeout = null;
  }
  if (personEntryProgressFrame !== null) {
    window.cancelAnimationFrame(personEntryProgressFrame);
    personEntryProgressFrame = null;
  }
  if (communityHighlightTimeout !== null) {
    window.clearTimeout(communityHighlightTimeout);
    communityHighlightTimeout = null;
  }
  document.querySelector("#passage-people").classList.remove("community-entry-flash");
  const progressBar = document.querySelector("#gate-entry-progress");
  progressBar.value = 0;
  progressBar.style.setProperty("--entry-progress-color", "rgb(167, 160, 167)");
  document.querySelector(".gate-illustration").classList.remove("person-entering");
  entriesToday = 0;
  exitsToday = 0;
  occupancy = 0;
  trafficEntries = Array(24).fill(0);
  trafficExits = Array(24).fill(0);
  events = [];
  nextPassageId = 1;
  remainingMetalZones = [];
  previousMetalZone = "";
  zones.forEach((zone, index) => Object.assign(zone, initialZones[index]));
  thresholdInput.value = "37.5";
  thresholdReadout.textContent = "37.5";
  document.querySelector("#report-range").value = "24h";
  machineActive = false;
  renderZoneChart();
  refreshDashboard();
  settingsFeedback.style.color = "";
  settingsFeedback.textContent = "Machine inactive · simulated reboot starting";
  void startMachineReboot();
}

async function startMachineReboot() {
  if (machineRebooting) return;
  machineRebooting = true;

  const rebootOverlay = document.querySelector("#machine-reboot");
  const countdown = document.querySelector("#machine-reboot-countdown");
  const rebootTrack = rebootOverlay.querySelector(".machine-reboot-track");
  const initiatingText = document.querySelector("#machine-reboot-scroll");
  const durationMs = 30_000;
  const startedAt = Date.now();
  let countdownTimer = null;

  if (alertTakeover.open) alertTakeover.close();
  document.querySelector(".topbar").inert = true;
  document.querySelector(".dashboard").inert = true;
  rebootOverlay.hidden = false;
  rebootOverlay.classList.remove("is-exiting", "is-initiating");
  initiatingText.hidden = true;
  rebootTrack.hidden = false;
  countdown.hidden = false;
  rebootOverlay.focus();
  const keepRebootModalFocused = (event) => {
    if (event.key === "Escape" || event.key === "Tab") event.preventDefault();
  };
  rebootOverlay.addEventListener("keydown", keepRebootModalFocused);

  const updateCountdown = () => {
    const remainingSeconds = Math.max(0, Math.ceil((durationMs - (Date.now() - startedAt)) / 1000));
    countdown.textContent = `00:${String(remainingSeconds).padStart(2, "0")}`;
  };
  updateCountdown();
  countdownTimer = window.setInterval(updateCountdown, 250);
  await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  window.clearInterval(countdownTimer);

  countdown.hidden = true;
  rebootTrack.hidden = true;
  initiatingText.hidden = false;
  rebootOverlay.classList.add("is-initiating");
  await new Promise((resolve) => window.setTimeout(resolve, 3500));

  machineActive = true;
  refreshDashboard();
  rebootOverlay.classList.add("is-exiting");
  await new Promise((resolve) => window.setTimeout(
    resolve,
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
  ));
  rebootOverlay.hidden = true;
  rebootOverlay.removeEventListener("keydown", keepRebootModalFocused);
  document.querySelector(".topbar").inert = false;
  document.querySelector(".dashboard").inert = false;
  machineRebooting = false;
  document.querySelector("#reset-demo").focus();
}

function showReports(show) {
  if (!systemInitialized) return;

  const reportsView = document.querySelector("#reports-view");
  const liveDashboard = document.querySelector("#live-dashboard");
  reportsView.hidden = !show;
  liveDashboard.hidden = show;
  document.querySelector("#reports-button").setAttribute("aria-expanded", String(show));
  if (show) {
    renderEvents();
    reportsView.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    document.querySelector(".demo-banner").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function exportReport() {
  if (!systemInitialized) return;

  const period = document.querySelector("#report-range").value;
  const cutoff = period === "24h"
    ? Date.now() - 24 * 60 * 60 * 1000
    : period === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;
  const reportEvents = events.filter((event) => parseTimestamp(event.timestamp).getTime() >= cutoff);
  const rows = [
    ["Timestamp", "Passage ID", "Direction", "Temperature (C)", "Detected zone", "Status"],
    ...reportEvents.map((event) => [
      event.timestamp,
      event.id,
      event.direction,
      screeningModel.hasTemperatureReading(event.temperature) ? event.temperature.toFixed(1) : "",
      event.zone || "None",
      event.status,
    ]),
  ];
  const csv = rows.map((row) => row
    .map((value) => `"${String(value).replaceAll('"', '""')}"`)
    .join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = `intelli-gate-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  settingsFeedback.style.color = "";
  settingsFeedback.textContent = `Exported ${reportEvents.length} demo screening records`;
}

function updateClock() {
  const now = new Date();
  document.querySelector("#current-date").textContent = new Intl.DateTimeFormat(
    "en-US",
    { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" },
  ).format(now);
  document.querySelector("#current-time").textContent = new Intl.DateTimeFormat(
    "en-GB",
    { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Manila" },
  ).format(now);
}

async function togglePresentationMode() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    settingsFeedback.style.color = "#ef7279";
    settingsFeedback.textContent = `Could not enter presentation mode: ${error.message}`;
  }
}

renderTrafficChart();
renderZoneChart();
refreshDashboard();
updateClock();
window.setInterval(updateClock, 1000);
window.addEventListener("system:initialize-simulation", () => {
  systemInitialized = true;
  machineActive = true;
  document.querySelector("#system-status-title").textContent = "MACHINE READY";
  document.querySelector("#simulation-mode-label").textContent = "SIMULATION ACTIVE";
  refreshDashboard();
  window.dispatchEvent(new Event("system:simulation-ready"));
});

thresholdInput.addEventListener("change", updateThreshold);
document.querySelector("#sensitivity").addEventListener("change", (event) => {
  settingsFeedback.style.color = "";
  settingsFeedback.textContent = `Demo sensitivity set to ${event.target.value.toLowerCase()}`;
});
document.querySelectorAll(".alarm-row input").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    const enabled = [...document.querySelectorAll(".alarm-row input:checked")].length;
    if (checkbox.id === "audio-alarm-enabled") {
      if (!checkbox.checked && activeMetalAlertExists() && alarmInterval !== null) {
        checkbox.checked = true;
        settingsFeedback.style.color = "";
        settingsFeedback.textContent = "A sounding metal alarm can only be stopped by the next entry.";
        return;
      }
      syncMetalAlarm({ allowStart: checkbox.checked });
    }
    settingsFeedback.style.color = "";
    settingsFeedback.textContent = `${enabled} of 3 demo alarm outputs enabled`;
  });
});
document.querySelector("#simulate-entry").addEventListener("click", () => {
  addScreeningEvent({ type: "Simulated entry recorded", direction: "ENTRY", temperature: 36.6 });
});
document.querySelector("#simulate-exit").addEventListener("click", () => {
  addScreeningEvent({ type: "Simulated exit recorded", direction: "EXIT" });
});
alertTakeover.addEventListener("cancel", (event) => event.preventDefault());
alertTakeover.addEventListener("close", stopTakeoverTimer);
takeoverEntryButton.addEventListener("click", () => {
  addScreeningEvent({ type: "Simulated entry recorded", direction: "ENTRY", temperature: 36.6 });
});
takeoverResetButton.addEventListener("click", resetDemo);
document.querySelector("#simulate-metal").addEventListener("click", () => {
  const zone = drawRandomMetalZone();
  addScreeningEvent({
    type: `Randomized metal detection simulated in ${zone.name} · ${zone.label}`,
    zone: zone.name,
    temperature: null,
  });
});
document.querySelector("#simulate-temperature").addEventListener("click", () => {
  const demoTemperature = Math.max(38.1, Number(thresholdInput.value) + 0.6);
  addScreeningEvent({
    type: "Elevated-temperature screening simulated",
    temperature: demoTemperature,
  });
});
document.querySelector("#reset-demo").addEventListener("click", resetDemo);
document.querySelector("#presentation-mode").addEventListener("click", togglePresentationMode);
document.querySelector("#reports-button").addEventListener("click", () => showReports(true));
document.querySelector("#return-dashboard").addEventListener("click", () => showReports(false));
document.querySelector("#report-range").addEventListener("change", renderEvents);
document.querySelector("#export-report").addEventListener("click", exportReport);
document.querySelector("#print-report").addEventListener("click", () => window.print());
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  document.querySelector("#presentation-mode").setAttribute("aria-pressed", String(active));
  document.body.classList.toggle("presentation-mode", active);
});
