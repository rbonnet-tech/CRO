let historicalData = [];
let lastProjection = [];

// Legacy record keys remain compatible with existing saved tests.
const $ = (id) => document.getElementById(({kameleoonUrl:"testToolUrl",resultKameleoonLink:"resultTestToolLink"})[id] || id);

// ==============================
// INDEXEDDB CONFIG
// ==============================

const DB_NAME = "abTestRevenueCalculator";
const DB_VERSION = 2;
const TEST_STORE = "savedTests";
let lastResult = null;
let lastInputs = null;
let editingTestId = null;
const STORE_NAME = "historicalSales";
const META_STORE = "metadata";

let db = null;

// ==============================
// DOM
// ==============================

const fileStatus = $("fileStatus");
const metricType = $("metricType");
const storedDataInfo = $("storedDataInfo");
const storedDataText = $("storedDataText");

// ==============================
// INIT
// ==============================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initIndexedDB();
    // Workbook data is loaded only after Google sign-in.
    await renderSavedTests();
  } catch (error) {
    showError(error.message);
  }

  updateMetricFields();
  updateWorkspaceUI();
});

// ==============================
// EVENTS
// ==============================

metricType.addEventListener("change", updateMetricFields);

$("testEnd").addEventListener("change", () => {
  if (!$("rolloutDate").value && $("testEnd").value) {
    const d = new Date($("testEnd").value + "T12:00:00");
    d.setDate(d.getDate() + 1);

    $("rolloutDate").value = toInputDate(d);
  }
});

$("calculateBtn").addEventListener("click", calculateProjection);
$("exportBtn").addEventListener("click", exportResults);
$("pdfBtn")?.addEventListener("click", generatePDF);

window.addEventListener("resize", () => {
  if (lastProjection.length) {
    renderChart();
  }
});

// ==============================
// INDEXEDDB
// ==============================

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      DB_NAME,
      DB_VERSION
    );

    request.onerror = () => {
      reject(
        new Error(
          "Impossible d'ouvrir la base locale."
        )
      );
    };

    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => { db.close(); db = null; };
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(TEST_STORE)) {
        database.createObjectStore(TEST_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(
          STORE_NAME,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(
          META_STORE,
          {
            keyPath: "key"
          }
        );
      }
    };
  });
}

function saveHistoricalDataToDB(data, fileName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [STORE_NAME, META_STORE],
      "readwrite"
    );

    const salesStore =
      transaction.objectStore(STORE_NAME);

    const metaStore =
      transaction.objectStore(META_STORE);

    salesStore.clear();

    data.forEach((row) => {
      salesStore.add({
        date: row.date.toISOString(),
        revenue: row.revenue
      });
    });

    const firstDate =
      data[0].date;

    const lastDate =
      data[data.length - 1].date;

    metaStore.put({
      key: "salesMetadata",
      fileName,
      importedAt: new Date().toISOString(),
      firstDate: firstDate.toISOString(),
      lastDate: lastDate.toISOString(),
      rowCount: data.length
    });

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(
        new Error(
          "Erreur lors de la sauvegarde locale."
        )
      );
    };
  });
}

function loadStoredHistoricalData() {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }

    const transaction = db.transaction(
      [STORE_NAME, META_STORE],
      "readonly"
    );

    const salesStore =
      transaction.objectStore(STORE_NAME);

    const metaStore =
      transaction.objectStore(META_STORE);

    const salesRequest =
      salesStore.getAll();

    const metaRequest =
      metaStore.get("salesMetadata");

    transaction.oncomplete = () => {
      const rows =
        salesRequest.result || [];

      const metadata =
        metaRequest.result;

      if (!rows.length || !metadata || metadata.fileName !== "Google Sheet ERP") {
        resolve();
        return;
      }

      historicalData = rows
        .map((row) => ({
          date: new Date(row.date),
          revenue: row.revenue
        }))
        .sort(
          (a, b) =>
            a.date - b.date
        );

      showStoredDataInfo(metadata);

      const totalHT =
        historicalData.reduce(
          (sum, row) =>
            sum + row.revenue,
          0
        );

      const totalTTC =
        htPostRbToTtcPreRb(totalHT);

      fileStatus.innerHTML = `
        ✓ Base locale chargée automatiquement<br>
        ${historicalData.length.toLocaleString("fr-FR")} lignes disponibles ·
        ${formatMoney(totalHT)} HT post-RB ·
        équivalent ${formatMoney(totalTTC)} TTC pré-RB
      `;

      fileStatus.classList.remove("hidden");

      resolve();
    };

    transaction.onerror = () => {
      resolve();
    };
  });
}

function showStoredDataInfo(metadata) {
  if (!storedDataInfo || !storedDataText) {
    return;
  }

  const firstDate =
    new Date(metadata.firstDate);

  const lastDate =
    new Date(metadata.lastDate);

  const importedAt =
    new Date(metadata.importedAt);

  storedDataText.innerHTML = `
    Dernier import sur base du CA des ventes
    du <strong>${formatDate(firstDate)}</strong>
    au <strong>${formatDate(lastDate)}</strong>.
    Dernière mise à jour :
    <strong>${formatDateTime(importedAt)}</strong>.
  `;

  storedDataInfo.classList.remove("hidden");
}

// ==============================
// METRIC FIELDS
// ==============================

function updateMetricFields() {
  const type = metricType.value;
  updateKpiMode();

  $("conversionFields").classList.toggle(
    "hidden",
    !["conversion", "both"].includes(type)
  );

  $("basketFields").classList.toggle(
    "hidden",
    !["basket", "both"].includes(type)
  );

  $("directFields").classList.toggle(
    "hidden",
    type !== "direct"
  );
  updateOutcomeFields();
  updateUpliftEntry();
}

// ==============================
// CSV
// ==============================

function normalizeHeader(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /['’\s_-]/g,
      ""
    );
}

// ==============================
// DATE / NUMBER PARSING
// ==============================

function parseDate(value) {
  if (!value) {
    return null;
  }

  value =
    String(value)
      .trim()
      .replace(
        /"/g,
        ""
      );

  let match =
    value.match(
      /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/
    );

  if (match) {
    return createSafeDate(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );
  }

  match =
    value.match(
      /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/
    );

  if (match) {
    return createSafeDate(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1])
    );
  }

  const fallback =
    new Date(value);

  if (!isNaN(fallback)) {
    return new Date(
      fallback.getFullYear(),
      fallback.getMonth(),
      fallback.getDate(),
      12
    );
  }

  return null;
}

function createSafeDate(
  year,
  month,
  day
) {
  const d =
    new Date(
      year,
      month,
      day,
      12
    );

  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day
  ) {
    return null;
  }

  return d;
}

function parseNumber(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return NaN;
  }

  let v =
    String(value)
      .replace(/"/g, "")
      .replace(/\u00A0/g, "")
      .replace(/\s/g, "")
      .replace(/€/g, "");

  if (
    v.includes(",") &&
    !v.includes(".")
  ) {
    v =
      v.replace(
        ",",
        "."
      );
  } else if (
    v.includes(",") &&
    v.includes(".")
  ) {
    if (
      v.lastIndexOf(",") >
      v.lastIndexOf(".")
    ) {
      v =
        v
          .replace(/\./g, "")
          .replace(
            ",",
            "."
          );
    } else {
      v =
        v.replace(
          /,/g,
          ""
        );
    }
  }

  return v.trim() ? Number(v) : NaN;
}

// ==============================
// FINANCIAL REFERENCES
// ==============================

function getVatRate() {
  return (
    Number(
      $("vatRate").value ||
        20
    ) / 100
  );
}

function getRbRate() {
  return (
    Number(
      $("rbRate").value ||
        15.34
    ) / 100
  );
}

function ttcPreRbToHtPostRb(
  value
) {
  const vat =
    getVatRate();

  const rb =
    getRbRate();

  return (
    value /
    (1 + vat) *
    (1 - rb)
  );
}

function htPostRbToTtcPreRb(
  value
) {
  const vat =
    getVatRate();

  const rb =
    getRbRate();

  if (rb >= 1) {
    return 0;
  }

  return (
    value /
    (1 - rb) *
    (1 + vat)
  );
}

// ==============================
// PROJECTION
// ==============================

function calculateProjection() {
  hideError();
  if(!window.sharedTests?.connected()){showError('Connecte-toi à Google et configure ton classeur pour enregistrer un test.');return;}
  if(!validateVisualInputs() || !validateOutcome()) return;
  if(!$("testTitle").value.trim()) $("testTitle").value=`Test ${OUTCOMES[$("testOutcome").value].toLowerCase()}`;
  if (metricType.value === "kpi") { calculateKpis(); return; }
  if(!reliableRevenue(captureInputs())){saveObservation();return;}
  if (sheetLoading) { showError("Attends la fin du chargement du Sheet."); return; }
  const numericFields = [ "annualGrowth", "lowFactor", "centralFactor", "highFactor"];
  if (numericFields.some(id => !$(id).value.trim() || !Number.isFinite(Number($(id).value))) ||
      Number($("annualGrowth").value) <= -100 ||
      ![3, 6, 12, 18, 24].includes(Number($("projectionMonths").value)) ||
      !parseDate($("rolloutDate").value)) {
    showError("Vérifie la date et les hypothèses de projection."); return;
  }
  if ($("testStart").value && $("testEnd").value && $("testStart").value > $("testEnd").value) {
    showError("La fin du test doit suivre son début."); return;
  }
  const link = $("kameleoonUrl")?.value.trim();
  if (link && !safeURL(link)) { showError("Le lien de l’outil A/B doit être une URL HTTP ou HTTPS valide."); return; }


  if (!historicalData.length) {
    showError(
      "Charge la base ERP depuis le Google Sheet avant de calculer."
    );
    return;
  }

  const uplift =
    calculateUplift();

  if (uplift !== null && uplift <= 0) {showError("Un test gagnant déployé sur la base du CA doit avoir un uplift positif. Vérifie les taux ou choisis un autre résultat.");return;}
  if (uplift === null) {
    return;
  }

  const rolloutValue =
    $("rolloutDate").value;

  if (!rolloutValue) {
    showError(
      "Indique une date de mise en production."
    );
    return;
  }

  const vat =
    getVatRate();

  const rb =
    getRbRate();

  if (
    !Number.isFinite(vat) ||
    vat < 0
  ) {
    showError(
      "Le taux de TVA n'est pas valide."
    );
    return;
  }

  if (
    !Number.isFinite(rb) ||
    rb < 0 ||
    rb >= 1
  ) {
    showError(
      "Le taux de RB doit être compris entre 0 % et moins de 100 %."
    );
    return;
  }

  const startDate =
    new Date(
      rolloutValue +
        "T12:00:00"
    );

  const months =
    Number(
      $("projectionMonths").value
    );

  const endDate =
    addMonths(
      startDate,
      months
    );

  endDate.setDate(
    endDate.getDate() -
      1
  );

  let eligibility;
  try { eligibility = readEligibility(); }
  catch (error) { showError(error.message); return; }
  const affectedShare = eligibility.revenueShare;

  const annualGrowth =
    Number(
      $("annualGrowth").value ||
        0
    ) / 100;

  const lowFactor =
    Number(
      $("lowFactor").value ||
        0
    ) / 100;

  const centralFactor =
    Number(
      $("centralFactor").value ||
        0
    ) / 100;

  const highFactor =
    Number(
      $("highFactor").value ||
        0
    ) / 100;

  const calculated = projectRevenue(startDate, months, {uplift, affectedShare, eligibleTrafficShare:eligibility.trafficShare, annualGrowth, lowFactor, centralFactor, highFactor}, buildSeasonalityProfile());
  lastProjection = calculated.projection;
  renderResults(calculated.result);
}

// ==============================
// UPLIFT
// ==============================

function calculateUplift() {
  try {
    return measureTestUplift(captureInputs());
  } catch (error) {
    showError(error.message);
    return null;
  }
}

// ==============================
// SEASONALITY
// ==============================

function buildSeasonalityProfile() {
  const byDay = {};
  const byMonth = {};

  let globalSum = 0;
  let globalCount = 0;

  historicalData.forEach(
    (row) => {
      const month =
        String(
          row.date.getMonth() +
            1
        ).padStart(
          2,
          "0"
        );

      const day =
        String(
          row.date.getDate()
        ).padStart(
          2,
          "0"
        );

      const dayKey =
        `${month}-${day}`;

      if (
        !byDay[dayKey]
      ) {
        byDay[dayKey] = [];
      }

      byDay[dayKey].push(
        row.revenue
      );

      const monthKey =
        row.date.getMonth();

      if (
        !byMonth[
          monthKey
        ]
      ) {
        byMonth[
          monthKey
        ] = [];
      }

      byMonth[
        monthKey
      ].push(
        row.revenue
      );

      globalSum +=
        row.revenue;

      globalCount++;
    }
  );

  const dailyAverage =
    {};

  Object.keys(
    byDay
  ).forEach(
    (key) => {
      dailyAverage[key] =
        average(
          byDay[key]
        );
    }
  );

  const monthlyAverage =
    {};

  Object.keys(
    byMonth
  ).forEach(
    (key) => {
      monthlyAverage[key] =
        average(
          byMonth[key]
        );
    }
  );

  return {
    dailyAverage,
    monthlyAverage,
    globalAverage:
      globalCount
        ? globalSum /
          globalCount
        : 0
  };
}

function getExpectedRevenue(
  date,
  profile
) {
  const month =
    String(
      date.getMonth() +
        1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  const dayKey =
    `${month}-${day}`;

  if (
    Number.isFinite(
      profile.dailyAverage[
        dayKey
      ]
    )
  ) {
    return (
      profile.dailyAverage[
        dayKey
      ]
    );
  }

  if (
    month === "02" &&
    day === "29" &&
    Number.isFinite(
      profile.dailyAverage[
        "02-28"
      ]
    )
  ) {
    return (
      profile.dailyAverage[
        "02-28"
      ]
    );
  }

  if (
    Number.isFinite(
      profile.monthlyAverage[
        date.getMonth()
      ]
    )
  ) {
    return (
      profile.monthlyAverage[
        date.getMonth()
      ]
    );
  }

  return (
    Number.isFinite(profile.globalAverage) ? profile.globalAverage : null
  );
}

// ==============================
// RESULTS
// ==============================

function renderResults(data, save = true) {
  showDashboard();
  if(save) $('dashboardMonths').value=String(data.months || dashboardMonths());
  if (data.kind === "kpi") { renderKpiResults(data, save); return; }
  $("kpiResults").classList.add("hidden");
  lastResult = { ...data };
  lastInputs = captureInputs();
  if(save) saveCurrentTest().catch(error=>showError(error.message));
  const selected = scenarioView(data,lastProjection);data=selected.result;lastProjection=selected.projection;lastResult={...data};
  const variant = variantNumbers(lastInputs).length > 1 ? ` · ${variantLabel(retainedVariantNumber(lastInputs)).toUpperCase()}` : '';
  $('activeScenarioHeading').textContent=`SCÉNARIO ${scenarioName().toUpperCase()} · IMPACT ESTIMÉ${variant}`;
  renderTestIdentity();
  addOutcomeDetail($("results"),lastInputs);
  renderResultVisuals(lastInputs, $("results"));
  showVariantComparison($("results"), lastInputs, data);
  renderTestComment($("results"),lastInputs);
  $("centralScenarioLabel").textContent = `${formatPercent(data.centralFactor)} de l’uplift observé retenu`; 
  $("eligibleTrafficResult").textContent = Number.isFinite(data.eligibleTrafficShare) ? formatPercent(data.eligibleTrafficShare) : "Non renseignée (ancien test)";
  $("addressableShareResult").textContent = formatPercent(data.affectedShare);
  $("addressableErpResult").textContent = formatMoney(data.baselineTotal * data.affectedShare);


  $("results").classList.remove(
    "hidden"
  );

  const baselineHT =
    data.baselineTotal;

  const baselineTTC =
    htPostRbToTtcPreRb(
      baselineHT
    );

  const gainHT =
    data.centralTotal;

  const gainTTC =
    htPostRbToTtcPreRb(
      gainHT
    );

  const lowGainTTC =
    htPostRbToTtcPreRb(
      data.lowTotal
    );

  const highGainTTC =
    htPostRbToTtcPreRb(
      data.highTotal
    );

  $("annualGainTTC").textContent =
    signedMoney(
      gainTTC
    );

  $("annualGainHT").textContent =
    signedMoney(
      gainHT
    );

  $("centralGainTTC").textContent =
    signedMoney(
      gainTTC
    );

  $("centralGainHT").textContent =
    signedMoney(
      gainHT
    );

  $("baselineRevenueHT").textContent =
    formatMoney(
      baselineHT
    );

  $("baselineRevenueTTC").textContent =
    formatMoney(
      baselineTTC
    );

  const observed = observedMetricSummary(lastInputs, data);
  $('upliftMetricLabel').textContent = observed.label;
  $('upliftValue').textContent = observed.value;
  $('upliftMetricChange').textContent = observed.change || '';
  $('upliftMetricChange').hidden = !observed.change;

  $("periodLabel").textContent =
    `sur ${data.months} mois à partir du ${formatDate(new Date($("rolloutDate").value + "T12:00:00"))}`;

  $("displayVAT").textContent =
    formatPercent(
      getVatRate()
    );

  $("displayRB").textContent =
    formatPercent(
      getRbRate()
    );

  if (
    $("prudentAnnualGain")
  ) {
    $("prudentAnnualGain").textContent =
      signedMoney(
        lowGainTTC
      );
  }

  if (
    $("highAnnualGain")
  ) {
    $("highAnnualGain").textContent =
      signedMoney(
        highGainTTC
      );
  }

  renderTable();
  renderChart();

  $("methodologyText").innerHTML = `
    L'estimation part du
    <strong>CA HT post-RB journalier réellement observé</strong>
    afin de conserver la saisonnalité du site.
    L'uplift mesuré de
    <strong>${signedPercent(data.uplift)}</strong>
    est appliqué uniquement à
    <strong>${formatPercent(data.affectedShare)}</strong>
    du CA de référence ERP projeté. Les montants GA4 servent uniquement au calcul de cette part ; la part du trafic éligible est informative et ne multiplie pas le gain.
    Le scénario sélectionné conserve
    <strong>${formatPercent(data.centralFactor)}</strong>
    de l'uplift observé.
    Le scénario prudent retient
    <strong>${formatPercent(data.lowFactor)}</strong>
    et le scénario haut
    <strong>${formatPercent(data.highFactor)}</strong>.
    Les résultats sont restitués en
    <strong>HT post-RB</strong>
    et en
    <strong>TTC pré-RB</strong>,
    avec une TVA de
    <strong>${formatPercent(getVatRate())}</strong>
    et un RB annuel moyen de
    <strong>${formatPercent(getRbRate())}</strong>.
  `;

  $("results").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function renderTable() {
  const tbody = $("resultTable");
  tbody.innerHTML = "";

  lastProjection.forEach(row => {
    const baselineHT = row.baseline;
    const gainHT = row.central;
    const totalHT = baselineHT + gainHT;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${formatMonth(row.date)}</td>
      <td>${formatMoney(baselineHT)}</td>
      <td><strong>${signedMoney(gainHT)}</strong></td>
      <td><strong>${formatMoney(totalHT)}</strong></td>
    `;

    tbody.appendChild(tr);
  });
}

// ==============================
// CHART
// ==============================

// Both series use the saved calculation, including when a test is reloaded.
const CHART_COLORS = {
  baseline: "#A7ABB5",
  tested: "#415954"
};

function comparisonRows() {
  if (!lastResult || !lastInputs) return [];

  return lastProjection.map(row => {
    const baseline = row.baseline;

    return {
      date: row.date,
      baseline,
      tested:
        baseline *
        (1 + lastResult.uplift * lastResult.affectedShare * lastResult.centralFactor)
    };
  });
}

function drawComparisonChart(canvas, width, height, scale = 1) {
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const rows = comparisonRows();
  if (!rows.length) return;

  const pad = {
    left: 85,
    right: 20,
    top: 35,
    bottom: 85
  };

  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const max =
    Math.max(
      1,
      ...rows.flatMap(row => [row.baseline, row.tested])
    ) * 1.12;

  const min = Math.min(0, ...rows.flatMap(row => [row.baseline, row.tested]));

  const py = value =>
    pad.top + ((max - value) / (max - min)) * h;

  ctx.font = "12px Arial, sans-serif";
  ctx.fillStyle = "#555b68";
  ctx.textAlign = "left";
  ctx.fillText("CA projeté - HT post-RB", pad.left, 18);

  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    const y = py(value);

    ctx.strokeStyle = "#e8eaf0";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = "#555b68";
    ctx.textAlign = "right";
    ctx.fillText(compactMoney(value), pad.left - 10, y + 4);
  }

  const slot = w / rows.length;
  const bar = Math.min(28, slot * 0.33);
  const zero = py(0);

  rows.forEach((row, i) => {
    const middle = pad.left + slot * (i + 0.5);

    [
      [row.baseline, CHART_COLORS.baseline, middle - bar - 2],
      [row.tested, CHART_COLORS.tested, middle + 2]
    ].forEach(([value, color, x]) => {
      ctx.fillStyle = color;
      ctx.fillRect(
        x,
        Math.min(py(value), zero),
        bar,
        Math.abs(py(value) - zero)
      );
    });

    ctx.save();
    ctx.translate(middle, pad.top + h + 18);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "#555b68";
    ctx.textAlign = "right";
    ctx.font = "11px Arial, sans-serif";
    ctx.fillText(shortMonth(row.date), 0, 0);
    ctx.restore();
  });
}

function renderChart() {
  const canvas = $("revenueChart");
  if (!canvas || !lastProjection.length) return;

  const width = Math.max(
    canvas.parentElement.clientWidth,
    lastProjection.length * 55,
    600
  );

  canvas.style.width = `${width}px`;
  canvas.style.height = "360px";

  drawComparisonChart(
    canvas,
    width,
    360,
    window.devicePixelRatio || 1
  );

  canvas.setAttribute(
    "aria-label",
    comparisonRows()
      .map(
        row =>
          `${formatMonth(row.date)} : ` +
          `sans test ${formatMoney(row.baseline)} HT post-RB, ` +
          `avec scénario ${scenarioName()} ${formatMoney(row.tested)} HT post-RB`
      )
      .join(" ; ")
  );
}

function roundRect(
  ctx,
  x,
  y,
  w,
  h,
  r
) {
  const radius =
    Math.min(
      r,
      Math.abs(w) /
        2,
      Math.abs(h) /
        2
    );

  ctx.beginPath();

  ctx.moveTo(
    x +
      radius,
    y
  );

  ctx.arcTo(
    x + w,
    y,
    x + w,
    y + h,
    radius
  );

  ctx.arcTo(
    x + w,
    y + h,
    x,
    y + h,
    radius
  );

  ctx.arcTo(
    x,
    y + h,
    x,
    y,
    radius
  );

  ctx.arcTo(
    x,
    y,
    x + w,
    y,
    radius
  );

  ctx.closePath();
}

// ==============================
// EXPORT
// ==============================

function exportResults() {
  if (!checkCurrentResult()) return;
  if (
    !lastProjection.length
  ) {
    return;
  }

  const lines = [
    [
      "Mois",
      "CA HT post-RB",
      "CA TTC pre-RB",
      "Gain TTC pre-RB",
      "Gain HT post-RB",
      "Part trafic eligible (%)",
      "Part CA adressable (%)",
      "CA adressable ERP HT post-RB"
    ].join(";")
  ];

  lastProjection.forEach(
    (row) => {
      const baselineHT =
        row.baseline;

      const baselineTTC =
        htPostRbToTtcPreRb(
          baselineHT
        );

      const gainHT =
        row.central;

      const gainTTC =
        htPostRbToTtcPreRb(
          gainHT
        );

      lines.push(
        [
          formatMonth(
            row.date
          ),
          baselineHT.toFixed(
            2
          ),
          baselineTTC.toFixed(
            2
          ),
          gainTTC.toFixed(
            2
          ),
          gainHT.toFixed(
            2
          ),
          Number.isFinite(lastResult.eligibleTrafficShare) ? (lastResult.eligibleTrafficShare * 100).toFixed(4) : "",
          (lastResult.affectedShare * 100).toFixed(4),
          (baselineHT * lastResult.affectedShare).toFixed(2)
        ].join(";")
      );
    }
  );

  const blob =
    new Blob(
      [
        "\uFEFF" +
          lines.join(
            "\n"
          )
      ],
      {
        type:
          "text/csv;charset=utf-8;"
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const a =
    document.createElement(
      "a"
    );

  a.href =
    url;

  a.download =
    "projection-ab-test.csv";

  a.click();

  URL.revokeObjectURL(
    url
  );
}

// ==============================
// HELPERS
// ==============================

function average(
  values
) {
  if (
    !values.length
  ) {
    return 0;
  }

  return (
    values.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    ) /
    values.length
  );
}

function addMonths(
  date,
  months
) {
  const result =
    new Date(date);

  const originalDay =
    result.getDate();

  result.setDate(
    1
  );

  result.setMonth(
    result.getMonth() +
      months
  );

  const lastDay =
    new Date(
      result.getFullYear(),
      result.getMonth() +
        1,
      0
    ).getDate();

  result.setDate(
    Math.min(
      originalDay,
      lastDay
    )
  );

  return result;
}

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

function formatMoney(
  value
) {
  return new Intl.NumberFormat(
    "fr-FR",
    {
      style:
        "currency",
      currency:
        "EUR",
      maximumFractionDigits:
        0
    }
  ).format(
    value
  );
}

function signedMoney(
  value
) {
  const sign =
    value > 0
      ? "+"
      : "";

  return (
    sign +
    formatMoney(
      value
    )
  );
}

function compactMoney(
  value
) {
  return new Intl.NumberFormat(
    "fr-FR",
    {
      notation:
        "compact",
      style:
        "currency",
      currency:
        "EUR",
      maximumFractionDigits:
        1
    }
  ).format(
    value
  );
}

function formatPercent(
  value
) {
  return new Intl.NumberFormat(
    "fr-FR",
    {
      style:
        "percent",
      maximumFractionDigits:
        2
    }
  ).format(
    value
  );
}

function signedPercent(
  value
) {
  const sign =
    value > 0
      ? "+"
      : "";

  return (
    sign +
    formatPercent(
      value
    )
  );
}

function formatDate(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR"
  ).format(
    date
  );
}

function formatDateTime(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      dateStyle:
        "short",
      timeStyle:
        "short"
    }
  ).format(
    date
  );
}

function formatMonth(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      month:
        "long",
      year:
        "numeric"
    }
  ).format(
    date
  );
}

function shortMonth(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      month:
        "short",
      year:
        "2-digit"
    }
  ).format(
    date
  );
}

function toInputDate(
  date
) {
  const y =
    date.getFullYear();

  const m =
    String(
      date.getMonth() +
        1
    ).padStart(
      2,
      "0"
    );

  const d =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${y}-${m}-${d}`;
}

function showError(
  message
) {
  $("globalError").textContent=message;$("globalError").classList.remove("hidden");
  $("errorMessage").textContent =
    message;

  $("errorMessage").classList.remove(
    "hidden"
  );
}

function hideError() {
  $("globalError").classList.add("hidden");
  $("errorMessage").classList.add(
    "hidden"
  );
}
// Test history and PDF export. All data stays in this browser.
const INPUT_IDS = ["targetPage", "targetDevice", "upliftEntryMode", "directUpliftPercent", "testOutcome", "testDecision", "testNotes", "originalVisual", "variantVisual", "variantVisual2", "variantVisual3", "variantCount", "retainedVariant", "kpiInputs", "testTitle", "kameleoonUrl", "testStart", "testEnd", "metricType",
  "convA", "convB", "convC", "convD", "basketA", "basketB", "basketC", "basketD",
  "directCaA", "directCaB", "directCaC", "directCaD", "directUpliftC", "directUpliftD", "rolloutDate",
  "ga4TotalSessions", "ga4EligibleSessions", "ga4TotalRevenue", "ga4EligibleRevenue", "annualGrowth", "projectionMonths", "vatRate", "rbRate",
  "lowFactor", "centralFactor", "highFactor"];

function captureInputs() {
  return Object.fromEntries(INPUT_IDS.map(id => [id, $(id)?.value ?? ""]));
}
function safeURL(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
}
function renderTestIdentity() {
  if ($("resultTestTitle")) $("resultTestTitle").textContent = lastInputs.testTitle.trim() || "Expérience sans nom";
  const link = $("resultKameleoonLink");
  if (!link) return;
  const url = safeURL(lastInputs.kameleoonUrl);
  link.textContent = url ? `Voir les résultats ${toolName()}` : "Lien non renseigné";
  link.removeAttribute("href");
  if (url) link.href = url;
  link.rel = "noopener noreferrer";
}
function checkCurrentResult() {
  if (!lastResult || (!lastProjection.length && lastResult.kind !== "kpi")) {
    showError("Calcule d'abord les résultats."); return false;
  }
  if (JSON.stringify(captureInputs()) !== JSON.stringify(lastInputs)) {
    showError("Le formulaire a changé : recalcule l'impact avant l'export."); return false;
  }
  return true;
}
function testTransaction(mode, operation) {
  return new Promise((resolve, reject) => {
    if (!db) { reject(new Error("Stockage local indisponible. Le test n'a pas été sauvegardé.")); return; }
    const transaction = db.transaction(TEST_STORE, mode);
    const request = operation(transaction.objectStore(TEST_STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(new Error("Impossible d'accéder à l'historique des tests."));
  });
}
async function saveCurrentTest() {
  if (!lastInputs?.testTitle.trim()) return;
  if(!window.sharedTests?.connected())throw Error('Connecte-toi à Google pour enregistrer le test.');
  const inputs = { ...lastInputs, testTitle: lastInputs.testTitle.trim() };
  const identity=JSON.stringify([inputs.testTitle, inputs.testStart, inputs.testEnd, inputs.metricType]);
  const id = editingTestId || (window.sharedTests.sheetId===window.sharedTests.defaultSheetId ? identity : JSON.stringify([window.sharedTests.sheetId,identity]));
  editingTestId = id;
  const test = { spreadsheetId:window.sharedTests.sheetId, id, inputs, result: { ...lastResult }, projection: lastProjection.map(row => ({ ...row })), updatedAt: new Date().toISOString() };
  let localError = null;
  try { await testTransaction("readwrite", store => store.put(test)); } catch (error) { localError = error; }
  await renderSavedTests();
  if (window.sharedTests?.connected()) await window.sharedTests.save(test);
  else if (localError) throw localError;
  else $("cloudStatus").textContent="Test sauvegardé sur cet appareil uniquement. Connecte-toi à Google, puis clique sur « Enregistrer dans le Sheet » pour partager toutes ses données.";
}
async function renderSavedTests() {
  const list = $("savedTestsList");
  if (!list) return;
  if(!window.sharedTests?.connected()){list.replaceChildren();list.textContent='Connecte-toi à Google pour retrouver tes tests et commencer à en enregistrer.';updateWorkspaceUI(0);return;}
  const currentSheetId=window.sharedTests.sheetId;
  const allLocal = db ? await testTransaction('readonly', store => store.getAll()) : [];
  if(!window.sharedTests.connected() || currentSheetId!==window.sharedTests.sheetId)return renderSavedTests();
  const localTests=allLocal.filter(t=>t.spreadsheetId===window.sharedTests.sheetId || (!t.spreadsheetId && window.sharedTests.sheetId===window.sharedTests.defaultSheetId));
  const merged = new Map(localTests.map(t=>[t.id,t]));
  for (const remote of (window.sharedTests?.tests || [])) {
    const local = merged.get(remote.id);
    merged.set(remote.id, local && local.updatedAt > remote.updatedAt ? {...local, cloudSheetId:remote.cloudSheetId, pendingCloud:true} : remote);
  }
  updateWorkspaceUI(merged.size);
  const tests = [...merged.values()].filter(matchesDecision).filter(matchesTargeting);
  renderGainRecap(tests);
  list.replaceChildren();
  $('dashboardStatus').textContent = historicalData.length ? `Gagnants déployés sur la base du CA fiable : gains sur ${dashboardMonths()} mois. Autres tests hors extrapolation. Les anciens tests sans statut sont à qualifier.` : (sheetLoading ? 'Chargement de la base ERP pour recalculer les gains. Les KPI restent consultables.' : 'Base ERP indisponible : les gains ne peuvent pas être recalculés. Réessaie avec le bouton ci-dessus.');
  if (!tests.length) { list.textContent = merged.size ? "Aucun test ne correspond aux filtres sélectionnés. Modifie les filtres ou réinitialise-les." : "Aucun test enregistré. Enregistre un nouveau test pour commencer."; return; }
  const order = $('testSort').value;
  tests.sort((a, b) => compareSavedTests(a, b, order));
  const profile=historicalData.length ? buildSeasonalityProfile() : null;
  for (const test of tests) {
    let displayed=null;
    try { displayed=projectSavedTest(test,dashboardMonths(),profile); } catch { /* Missing ERP or legacy date: never show a gain for the wrong duration. */ }
    const category=testCategory(test);
    const card = document.createElement("div"); card.className = `saved-test-card status-${category.css}`;
    const title = document.createElement("strong"); title.textContent = test.inputs.testTitle;
    const storage = document.createElement("small"); storage.textContent = test.pendingCloud ? "Modification locale à envoyer" : test.cloudSheetId != null ? "Enregistré dans le Sheet" : "Sur cet appareil uniquement";
    const details = document.createElement("p");
    details.textContent = `${test.inputs.testStart || "—"} → ${test.inputs.testEnd || "—"} · Mis à jour le ${formatDateTime(new Date(test.updatedAt))}`;
    const summary = document.createElement("div"); summary.className = "saved-test-summary";
    const info = document.createElement("div");
    const formula = document.createElement("p"); formula.className = "saved-uplift-formula";
    formula.textContent = `${signedPercent(test.result.uplift)} sur ${formatPercent(test.result.affectedShare)} du CA =`;
    const real = document.createElement("strong"); real.className = "saved-real-uplift";
    real.textContent = `Uplift réel ${signedPercent(test.result.uplift * test.result.affectedShare)}`;
    const note = document.createElement("small"); note.textContent = "Sur le CA total, avant coefficient de scénario.";
    const badge = document.createElement("span"); badge.className = "test-type-badge";
    badge.textContent = test.result.kind === "kpi" ? "KPI · CA non fiable" : "Projection de CA";
    const targeting=document.createElement('small');targeting.textContent=`${PAGE_LABELS[test.inputs.targetPage] || 'Page non renseignée'} · ${DEVICE_LABELS[test.inputs.targetDevice] || 'Device non renseigné'}`;
    info.append(statusBadge(test), badge, title, targeting, storage, details, formula, real, note);
    const gain = document.createElement("div"); gain.className = "saved-gain";
    const gainLabel = document.createElement("span"); gainLabel.textContent = "Gain de CA HT post-RB";
    const gainValue = document.createElement("strong"); gainValue.textContent = displayed ? signedMoney(displayed.result.centralTotal) : "—";
    const gainNote = document.createElement("small"); gainNote.textContent = `Scénario ${scenarioName()} ${formatPercent(displayed?.result.centralFactor ?? scenarioFactor(test.result))} · ${dashboardMonths()} mois`;
    const retained = document.createElement("small"); retained.textContent = `Uplift ${scenarioName()} sur le CA total : ${signedPercent(test.result.uplift * test.result.affectedShare * scenarioFactor(test.result))}`;
    const ttc = document.createElement('small');
    const vat=Number(test.inputs.vatRate)/100, rb=Number(test.inputs.rbRate)/100;
    ttc.textContent=displayed && Number.isFinite(vat) && Number.isFinite(rb) && rb<1 ? `Gain TTC pré-RB : ${signedMoney(displayed.result.centralTotal*(1+vat)/(1-rb))}` : 'Recalcul indisponible : vérifie la base ERP et la date de mise en production.';
    gain.append(gainLabel, gainValue, ttc, gainNote, retained); summary.append(info, gain);
    if (test.result.kind === "kpi") {
      ttc.remove();
      summary.classList.add('kpi-saved-summary');
      card.classList.add('saved-kpi-card');
      formula.textContent = "KPI du parcours · Hors CA";
      real.textContent = test.result.kpis.map(k => `${k.name} : ${kpiPercent(k.uplift)}`).join(" · ");
      note.textContent = `Sur les visiteurs ciblés (${formatPercent(test.result.eligibleTrafficShare)} du trafic).`;
      gainLabel.textContent = "Impact global estimé";
      gainValue.textContent = test.result.kpis.map(k => `${k.name} : ${kpiPercent(k.globalUplift)}`).join(" · ");
      gainValue.classList.add("kpi-saved-value");
      gainNote.textContent = "Hypothèse : même taux initial hors cible.";
      retained.textContent = "Aucun gain fiable en CA estimé";
    }
    if(!reliableRevenue(test.inputs,test.result) && test.result.kind!=='kpi') {
      badge.textContent='Sans extrapolation de CA';formula.textContent='';
      real.textContent=Number.isFinite(test.result.uplift)?observedMetricText(test.inputs, test.result):'Sans mesure chiffrée';
      note.textContent=category.rank===3?'Renseigne le résultat et la décision via « Modifier le test ».':'';
      gainLabel.textContent=category.decision;gainValue.textContent=category.label;ttc.remove();gainNote.textContent='';retained.textContent='Aucun gain CA extrapolé';
    }
    if (reliableRevenue(test.inputs, test.result) && test.inputs.metricType === 'conversion') {
      const conversion = document.createElement('small');
      conversion.className = 'saved-conversion';
      conversion.textContent = observedMetricText(test.inputs, test.result);
      formula.before(conversion);
    }
    if (variantNumbers(test.inputs).length > 1) {
      const retained = document.createElement('small');
      retained.className = 'saved-retained-variant';
      retained.textContent = `${variantLabel(retainedVariantNumber(test.inputs))} retenue pour la synthèse`;
      info.append(retained);
    }
    const visuals=visualComparison(test.inputs);
    if(visuals){summary.classList.add('with-visuals');summary.insertBefore(visuals,gain);}
    const actions = document.createElement("div"); actions.className = "saved-test-actions";
    const fillTest = () => {
      editingTestId = test.id;
      for (const id of INPUT_IDS) if ($(id)) $(id).value = test.inputs[id] ?? (id === "upliftEntryMode" ? "ab" : "");
      restoreKpiRows(); updateMetricFields(); updateEligibilityPreview(); hideError();
    };
    const description = previewTestComment(test.inputs.testNotes);
    const load = document.createElement('button');
    load.type = 'button';
    load.className = description ? 'saved-read-more' : 'secondary-btn';
    load.textContent = description ? 'Voir plus' : 'Voir les détails';
    if (description) load.setAttribute('aria-label', `Voir plus sur ${test.inputs.testTitle}`);
    load.addEventListener('click',()=>{
      fillTest();
      if(test.result.kind==='kpi') renderKpiResults(test.result,false);
      else if(displayed) { $('projectionMonths').value=String(dashboardMonths()); lastProjection=displayed.projection;renderResults(displayed.result,false); }
      else renderObservation({kind:'observation',uplift:test.result.uplift ?? null},false,reliableRevenue(test.inputs,test.result));
      const heading = displayed ? $('resultTestTitle') : $('kpiResults').querySelector('h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
    if (description) {
      const preview = document.createElement('p');
      preview.className = 'saved-description';
      preview.append(description, ' ', load);
      info.append(preview);
    }
    const edit = document.createElement('button');edit.type='button';edit.className='secondary-btn';edit.textContent='Modifier le test';
    edit.addEventListener('click',()=>{fillTest();showTestEditor(false);});
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-btn"; remove.textContent = "Supprimer";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Supprimer le test « ${test.inputs.testTitle} » ${test.cloudSheetId != null ? "du Sheet pour tous les appareils et de cet appareil" : "de cet appareil"} ?`)) return;
      try { if(test.cloudSheetId != null) await window.sharedTests.remove(test); if(db) await testTransaction("readwrite", store => store.delete(test.id)); await renderSavedTests(); }
      catch (error) { showError(error.message); }
    });
    const sync = document.createElement("button"); sync.type="button";sync.className="secondary-btn";sync.textContent="Enregistrer dans le Sheet";
    sync.addEventListener("click",async()=>{sync.disabled=true;try{await window.sharedTests.save(test);}catch(error){showError(error.message);}finally{sync.disabled=false;}});
    if (!description) actions.append(load);
    actions.append(edit, sync, remove); card.append(summary, actions); list.append(card);
  }
}
function formatMoneyPDF(value) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value).replace(/[\u00a0\u202f]/g, " ") + " EUR";
}
function signedMoneyPDF(value) { return (value > 0 ? "+" : "") + formatMoneyPDF(value); }
function generatePDF(event) {
  if (!checkCurrentResult()) return;
  if (!window.jspdf?.jsPDF) { showError("La bibliothèque jsPDF n'est pas chargée. Vérifie son inclusion dans le HTML."); return; }
  try {
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const clean = value => String(value).replace(/[\u00a0\u202f]/g, " ").replace(/[’]/g, "'");
    const write = (value, x, y, size = 10, bold = false, color = "#15171a", width = 174) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
      const lines = doc.splitTextToSize(clean(value), width);
      doc.text(lines, x, y); return lines.length * size * .4;
    };
    const money = (value, x, y, width = 76) => {
      const label = signedMoneyPDF(value); doc.setFont("helvetica", "bold"); doc.setFontSize(25);
      const size = Math.min(25, 25 * width / Math.max(1, doc.getTextWidth(label)));
      write(label, x, y, size, true, "#ffffff", width);
    };
    const date = value => value ? formatDate(parseDate(value)) : "Non renseignée";
    const equivalent = value => value / (1 - Number(lastInputs.rbRate || 15.34) / 100) * (1 + Number(lastInputs.vatRate || 20) / 100);
    doc.setFillColor("#415954"); doc.rect(0, 0, 210, 4, "F");
    write("A/B TEST  /  SYNTHÈSE D'IMPACT", 18, 17, 9, true, "#606873");
    let y = 29;
    y += write(lastInputs.testTitle.trim() || "Expérience sans nom",18,y,20,true);
    y += 5;
    y += write(`Test : ${date(lastInputs.testStart)} au ${date(lastInputs.testEnd)}`,18,y,9,false,"#606873");
    y += 7;
    y += write(`Projection sur ${lastResult.months} mois à partir du ${date(lastInputs.rolloutDate)}`,18,y,11,true);
    y += 7;
    // Keep long experiment titles readable without colliding with the summary.
    if (y > 72) { doc.addPage(); y = 20; }
    doc.setFillColor("#415954"); doc.rect(18,y,174,53,"F");
    write(`SCÉNARIO ${scenarioName().toUpperCase()}  /  ${formatPercent(lastResult.centralFactor)} DE L'UPLIFT RETENU`,25,y+10,10,true,"#ffffff",160);
    write("Gain de CA HT post-RB",25,y+22,11,false,"#ffffff",76);
    write("Gain TTC pré-RB",111,y+22,11,false,"#ffffff",74);
    money(lastResult.centralTotal,25,y+36);
    money(equivalent(lastResult.centralTotal),111,y+36,74);
    const observed = observedMetricText(lastInputs, lastResult).replace(' → ', ' à ');
    write(`${observed}  |  Uplift du scénario ${signedPercent(lastResult.uplift * lastResult.centralFactor)}`,25,y+46,9,false,"#ffffff",160);
    y += 65;
    write("BASE DE LA PROJECTION",18,y,10,true); y += 8;
    const row = (label,value) => {write(label,18,y,10,false,"#606873",99);write(value,121,y,10,true,"#15171a",71);y+=8;};
    row(`CA de référence ${erpName()} · HT post-RB`,formatMoneyPDF(lastResult.baselineTotal));
    row("Part du CA adressable",formatPercent(lastResult.affectedShare));
    row(`CA adressable ${erpName()} · HT post-RB`,formatMoneyPDF(lastResult.baselineTotal * lastResult.affectedShare));
    row("Part des visiteurs éligibles",Number.isFinite(lastResult.eligibleTrafficShare) ? formatPercent(lastResult.eligibleTrafficShare) : "Non renseignée");
    y += 2;
    y += write("Gain du scénario = CA adressable ERP × uplift observé × coefficient du scénario. Les montants GA4 servent uniquement à calculer la part adressable ; le CA projeté provient de l'ERP.",18,y,9,false,"#606873");
    y += 10;
    doc.setFillColor("#f2f4f3");doc.rect(18,y,174,30,"F");
    write("AUTRES SCÉNARIOS",24,y+7,8,true,"#68716d");
    for (const [label,key,factor,x] of [["Prudent","lowTotal","lowFactor",24],["Haut","highTotal","highFactor",110]]) {
      write(`${label} · ${lastInputs[factor]} % de l'uplift`,x,y+14,9,true,"#606873",76);
      write(`${signedMoneyPDF(lastResult[key])} HT post-RB`,x,y+20,9,false,"#606873",76);
      write(`${signedMoneyPDF(equivalent(lastResult[key]))} TTC pré-RB`,x,y+26,9,false,"#606873",76);
    }
    y += 39;
    y += write(`Hypothèses : croissance annuelle ${lastInputs.annualGrowth} % · TVA ${lastInputs.vatRate} % · RB ${lastInputs.rbRate} %.`,18,y,8,false,"#6b7179");
    y += 5;
    y += write("Estimation saisonnalisée selon l'historique ERP et les hypothèses saisies. Les gains futurs ne sont pas garantis.",18,y,8,false,"#6b7179");
    y += 9;
    const simulator = new URL(window.location.href); simulator.search = ""; simulator.hash = "";
    doc.setFontSize(9);doc.setTextColor("#15171a");
    if (safeURL(lastInputs.kameleoonUrl)) doc.textWithLink(`Résultats ${toolName()}`,18,y,{url:safeURL(lastInputs.kameleoonUrl)});
    doc.textWithLink("Ouvrir le simulateur",125,y,{url:safeURL(simulator.href)});
    const name = (lastInputs.testTitle || "ab-test").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
    appendCommentPDF(doc,lastInputs.testNotes,y+12);
    appendComparisonPDF(doc);
    return downloadTestPDF(doc, lastInputs, `projection-${name}.pdf`, event?.currentTarget);
  } catch (error) { showError(`Impossible de générer le PDF : ${error.message}`); }
}

function appendComparisonPDF(doc) {
  doc.addPage("a4", "landscape");
  doc.setTextColor(25, 31, 64); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("Projection du CA mois par mois", 15, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const title = lastInputs.testTitle.trim() || "Expérience sans nom";
  const heading = doc.splitTextToSize(title, 265).slice(0,2);
  doc.text(heading, 15, 26);
  doc.setFillColor(CHART_COLORS.baseline); doc.rect(15, 39, 4, 4, "F");
  doc.text("Sans impact de l'A/B test", 22, 42);
  doc.setFillColor(CHART_COLORS.tested); doc.rect(112, 39, 4, 4, "F");
  doc.text(`Avec le scénario ${scenarioName()}`, 119, 42);
  doc.setTextColor(70, 75, 85); doc.setFontSize(9);
  doc.text(`CA total HT post-RB - Part du CA adressable : ${formatPercent(lastResult.affectedShare)} - Uplift : ${signedPercent(lastResult.uplift).replace(/[\u00a0\u202f]/g," ")}`,15,50);
  const rows = comparisonRows();
  const left = 32, top = 60, width = 247, height = 98;
  const max = Math.max(1, ...rows.flatMap(row => [row.baseline, row.tested])) * 1.12;
  const min = Math.min(0, ...rows.flatMap(row => [row.baseline, row.tested]));
  const py = value => top + (max - value) / (max - min) * height;
  doc.setFontSize(8);
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4, y = py(value);
    doc.setDrawColor(230, 233, 239); doc.line(left, y, left + width, y);
    const label = (value / 1000).toLocaleString("fr-FR", {maximumFractionDigits: 0}).replace(/[\u00a0\u202f]/g, " ") + " k EUR";
    doc.text(label, left - 3, y + 1, {align: "right"});
  }
  const slot = width / rows.length, bar = Math.min(6, slot * .32), zero = py(0);
  rows.forEach((row, i) => {
    const middle = left + slot * (i + .5);
    [[row.baseline, CHART_COLORS.baseline, middle-bar-.4], [row.tested, CHART_COLORS.tested, middle+.4]].forEach(([value,color,x]) => {
      doc.setFillColor(color); doc.rect(x, Math.min(py(value),zero),bar,Math.abs(py(value)-zero),"F");
    });
    doc.setFontSize(rows.length > 18 ? 6 : 8);
    doc.text(shortMonth(row.date), middle - 2, 174, {angle: 45});
  });
  doc.setFontSize(9);
  doc.text("Avec test = CA sans test + CA sans test x part concernée x uplift observé (coefficient du scénario sélectionné).",15,190);
  const url = new URL(window.location.href); url.search = ""; url.hash = "";
  if (safeURL(url.href)) doc.textWithLink("Ouvrir le simulateur",15,199,{url:url.href});
}
// GA4 amounts establish ratios only; ERP remains the projection baseline.
function readEligibility() {
  if (metricType.value === "kpi") return {trafficShare: readKpiTraffic(), revenueShare: 0};
  const ids = ["ga4TotalSessions", "ga4EligibleSessions", "ga4TotalRevenue", "ga4EligibleRevenue"];
  const values = ids.map(id => $(id).value.trim());
  if (values.some(value => value === "" || !Number.isFinite(Number(value)))) throw new Error("Renseigne les quatre valeurs GA4 pour calculer les parts éligibles.");
  const [sessions, eligibleSessions, revenue, eligibleRevenue] = values.map(Number);
  if (!Number.isSafeInteger(sessions) || sessions <= 0 || !Number.isSafeInteger(eligibleSessions) || eligibleSessions < 0 || eligibleSessions > sessions) throw new Error("Les visiteurs doivent être des entiers : total supérieur à zéro, visiteurs éligibles compris entre zéro et le total.");
  if (revenue <= 0 || eligibleRevenue < 0 || eligibleRevenue > revenue) throw new Error("Le CA total GA4 doit être supérieur à zéro et le CA éligible compris entre zéro et ce total.");
  return { trafficShare: eligibleSessions / sessions, revenueShare: eligibleRevenue / revenue };
}
function updateEligibilityPreview() {
  try {
    const ratios = readEligibility();
    $("trafficSharePreview").textContent = formatPercent(ratios.trafficShare);
    $("revenueSharePreview").textContent = formatPercent(ratios.revenueShare);
    const traffic = formatPercent(ratios.trafficShare);
    if (metricType.value === "kpi") {
      $("eligibilitySummary").textContent = `Pour ce test, ${traffic} des visiteurs ont été ciblés. Cette part sert à pondérer l’évolution des KPI à l’échelle du site.`;
      return;
    }
    const revenue = formatPercent(ratios.revenueShare);
    $("eligibilitySummary").textContent = `Pour ce test, ${traffic} des visiteurs ont été ciblés. Ces ${traffic} de visiteurs ont généré ${revenue} du CA total sur la période du test.`;
  } catch {
    $("trafficSharePreview").textContent = "—";
    $("revenueSharePreview").textContent = "—";
    $("eligibilitySummary").textContent = metricType.value === "kpi" ? "Renseigne les deux nombres de visiteurs GA4 pour calculer la part ciblée." : "Renseigne les quatre données GA4 avec des valeurs valides pour voir la part des visiteurs ciblés et leur contribution au CA.";
  }
}
["ga4TotalSessions", "ga4EligibleSessions", "ga4TotalRevenue", "ga4EligibleRevenue"].forEach(id => $(id).addEventListener("input", updateEligibilityPreview));

// Public Google Sheet: Google Visualization callback works across origins without credentials.
let sheetLoading = false;
function parseSheetResponse(response) {
  if (response.status !== "ok" || !response.table) throw new Error("Le Sheet n'a pas renvoyé de données exploitables.");
  const {cols, rows} = response.table;
  const dateIndex = cols.findIndex(c => normalizeHeader(c.label) === "date");
  const revenueIndex = cols.findIndex(c => normalizeHeader(c.label) === "cahtpostrb");
  if (dateIndex < 0 || revenueIndex < 0) throw new Error("Le Sheet doit contenir les colonnes date et ca_ht_post_rb.");
  const data = [];
  for (const row of rows) {
    const d = row.c?.[dateIndex], r = row.c?.[revenueIndex];
    if (d?.v == null && r?.v == null) continue;
    const match = String(d?.v ?? "").match(/^Date\((\d+),(\d+),(\d+)\)$/);
    const date = match ? createSafeDate(+match[1], +match[2], +match[3]) : parseDate(d?.f || d?.v);
    const revenue = parseNumber(r?.v);
    if (!date || !Number.isFinite(revenue)) throw new Error("Une ligne du Sheet contient une date ou un CA invalide. Corrige-la avant d'actualiser.");
    data.push({date, revenue});
  }
  if (!data.length) throw new Error("Le Sheet est vide.");
  data.sort((a,b) => a.date-b.date);
  if (new Set(data.map(r => toInputDate(r.date))).size !== data.length) throw new Error("Le Sheet contient plusieurs lignes pour une même date.");
  return data;
}
async function refreshSheetData(){
  if(!window.sharedTests?.connected()){showError('Connecte-toi à Google pour charger le CA de ton classeur, ou importe un CSV.');return;}
  try{await window.sharedTests.refresh();}catch(error){showError(error.message);}
}
$('refreshSheetBtn').addEventListener('click',refreshSheetData);
