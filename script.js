let historicalData = [];
let lastProjection = [];

const $ = (id) => document.getElementById(id);

// ==============================
// INDEXEDDB CONFIG
// ==============================

const DB_NAME = "abTestRevenueCalculator";
const DB_VERSION = 2;
const TEST_STORE = "savedTests";
let lastResult = null;
let lastInputs = null;
const STORE_NAME = "historicalSales";
const META_STORE = "metadata";

let db = null;

// ==============================
// DOM
// ==============================

const csvFile = $("csvFile");
const uploadBtn = $("uploadBtn");
const dropZone = $("dropZone");
const fileStatus = $("fileStatus");
const metricType = $("metricType");
const storedDataInfo = $("storedDataInfo");
const storedDataText = $("storedDataText");
const replaceCsvBtn = $("replaceCsvBtn");

// ==============================
// INIT
// ==============================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initIndexedDB();
    await loadStoredHistoricalData();
    await renderSavedTests();
  } catch (error) {
    showError(error.message);
  }

  updateMetricFields();
});

// ==============================
// EVENTS
// ==============================

uploadBtn.addEventListener("click", () => {
  csvFile.click();
});

if (replaceCsvBtn) {
  replaceCsvBtn.addEventListener("click", () => {
    csvFile.click();
  });
}

csvFile.addEventListener("change", (event) => {
  if (event.target.files.length) {
    loadCSV(event.target.files[0]);
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");

  const file = e.dataTransfer.files[0];

  if (file) {
    loadCSV(file);
  }
});

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

      if (!rows.length || !metadata) {
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
}

// ==============================
// CSV
// ==============================

function loadCSV(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showError(
      "Le fichier doit être au format CSV."
    );
    return;
  }

  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const parsed =
        parseCSV(
          e.target.result
        );

      if (!parsed.length) {
        throw new Error(
          "Aucune donnée exploitable trouvée dans le fichier."
        );
      }

      lastProjection = [];
      lastResult = null;
      $("results").classList.add("hidden");
      historicalData =
        parsed.sort(
          (a, b) =>
            a.date - b.date
        );

      await saveHistoricalDataToDB(
        historicalData,
        file.name
      );

      const totalHT =
        historicalData.reduce(
          (sum, row) =>
            sum + row.revenue,
          0
        );

      const totalTTC =
        htPostRbToTtcPreRb(totalHT);

      const firstDate =
        historicalData[0].date;

      const lastDate =
        historicalData[
          historicalData.length - 1
        ].date;

      fileStatus.innerHTML = `
        ✓ <strong>${escapeHTML(file.name)}</strong><br>
        ${historicalData.length.toLocaleString("fr-FR")} lignes importées ·
        ${formatMoney(totalHT)} HT post-RB ·
        équivalent ${formatMoney(totalTTC)} TTC pré-RB ·
        du ${formatDate(firstDate)} au ${formatDate(lastDate)}
      `;

      fileStatus.classList.remove("hidden");

      showStoredDataInfo({
        firstDate:
          firstDate.toISOString(),
        lastDate:
          lastDate.toISOString(),
        importedAt:
          new Date().toISOString(),
        fileName:
          file.name,
        rowCount:
          historicalData.length
      });

      hideError();
    } catch (error) {
      historicalData = [];
      fileStatus.classList.add(
        "hidden"
      );

      showError(
        error.message
      );
    }
  };

  reader.readAsText(
    file,
    "UTF-8"
  );
}

function parseCSV(text) {
  text = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim();

  const lines =
    text
      .split("\n")
      .filter(
        (line) =>
          line.trim()
      );

  if (lines.length < 2) {
    throw new Error(
      "Le CSV ne contient pas suffisamment de lignes."
    );
  }

  const delimiter =
    lines[0].split(";").length >
    lines[0].split(",").length
      ? ";"
      : ",";

  const headers =
    splitCSVLine(
      lines[0],
      delimiter
    ).map(
      normalizeHeader
    );

  const dateIndex =
    headers.findIndex(
      (h) =>
        [
          "date",
          "jour",
          "day"
        ].includes(h)
    );

  const revenueIndex =
    headers.findIndex(
      (h) =>
        [
          "ca",
          "cahtpostrb",
          "htpostrb",
          "caht",
          "revenue",
          "revenu",
          "chiffredaffaires",
          "chiffreaffaires",
          "sales",
          "turnover"
        ].includes(h)
    );

  if (
    dateIndex === -1 ||
    revenueIndex === -1
  ) {
    throw new Error(
      'Le CSV doit contenir une colonne "date" et une colonne "ca_ht_post_rb" ou "ca".'
    );
  }

  const data = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const cells =
      splitCSVLine(
        lines[i],
        delimiter
      );

    const date =
      parseDate(
        cells[dateIndex]
      );

    const revenue =
      parseNumber(
        cells[revenueIndex]
      );

    if (
      date &&
      Number.isFinite(revenue) &&
      revenue >= 0
    ) {
      data.push({
        date,
        revenue
      });
    }
  }

  return data;
}

function splitCSVLine(
  line,
  delimiter
) {
  const result = [];

  let current = "";
  let insideQuotes = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char =
      line[i];

    if (char === '"') {
      if (
        insideQuotes &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        insideQuotes =
          !insideQuotes;
      }
    } else if (
      char === delimiter &&
      !insideQuotes
    ) {
      result.push(
        current.trim()
      );

      current = "";
    } else {
      current += char;
    }
  }

  result.push(
    current.trim()
  );

  return result;
}

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
        24.65
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
  const numericFields = ["affectedShare", "annualGrowth", "lowFactor", "centralFactor", "highFactor"];
  if (numericFields.some(id => !$(id).value.trim() || !Number.isFinite(Number($(id).value))) ||
      Number($("annualGrowth").value) <= -100 ||
      ![6, 12, 18, 24].includes(Number($("projectionMonths").value)) ||
      !parseDate($("rolloutDate").value)) {
    showError("Vérifie la date et les hypothèses de projection."); return;
  }
  if ($("testStart").value && $("testEnd").value && $("testStart").value > $("testEnd").value) {
    showError("La fin du test doit suivre son début."); return;
  }
  const link = $("kameleoonUrl")?.value.trim();
  if (link && !safeURL(link)) { showError("Le lien Kameleoon doit être une URL HTTP ou HTTPS valide."); return; }


  if (!historicalData.length) {
    showError(
      "Commence par importer ton historique de CA HT post-RB."
    );
    return;
  }

  const uplift =
    calculateUplift();

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

  const affectedShare =
    clamp(
      Number(
        $("affectedShare").value
      ) / 100,
      0,
      1
    );

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

  const seasonalProfile =
    buildSeasonalityProfile();

  const monthlyMap = {};

  let baselineTotal = 0;
  let lowTotal = 0;
  let centralTotal = 0;
  let highTotal = 0;

  let current =
    new Date(startDate);

  while (
    current <= endDate
  ) {
    const baselineHT =
      getExpectedRevenue(
        current,
        seasonalProfile
      );

    if (
      baselineHT !== null
    ) {
      const daysFromStart =
        (
          current -
          startDate
        ) /
        86400000;

      const growthMultiplier =
        Math.pow(
          Math.max(
            0.01,
            1 +
              annualGrowth
          ),
          daysFromStart /
            365.25
        );

      const adjustedBaselineHT =
        baselineHT *
        growthMultiplier;

      const applicableRevenueHT =
        adjustedBaselineHT *
        affectedShare;

      const lowGainHT =
        applicableRevenueHT *
        uplift *
        lowFactor;

      const centralGainHT =
        applicableRevenueHT *
        uplift *
        centralFactor;

      const highGainHT =
        applicableRevenueHT *
        uplift *
        highFactor;

      const key =
        `${current.getFullYear()}-${String(
          current.getMonth() +
            1
        ).padStart(
          2,
          "0"
        )}`;

      if (!monthlyMap[key]) {
        monthlyMap[key] = {
          date: new Date(
            current.getFullYear(),
            current.getMonth(),
            1,
            12
          ),
          baseline: 0,
          low: 0,
          central: 0,
          high: 0
        };
      }

      monthlyMap[key].baseline +=
        adjustedBaselineHT;

      monthlyMap[key].low +=
        lowGainHT;

      monthlyMap[key].central +=
        centralGainHT;

      monthlyMap[key].high +=
        highGainHT;

      baselineTotal +=
        adjustedBaselineHT;

      lowTotal +=
        lowGainHT;

      centralTotal +=
        centralGainHT;

      highTotal +=
        highGainHT;
    }

    current.setDate(
      current.getDate() +
        1
    );
  }

  lastProjection =
    Object.values(
      monthlyMap
    ).sort(
      (a, b) =>
        a.date -
        b.date
    );

  renderResults({
    uplift,
    months,
    baselineTotal,
    lowTotal,
    centralTotal,
    highTotal,
    affectedShare,
    annualGrowth,
    lowFactor,
    centralFactor,
    highFactor
  });
}

// ==============================
// UPLIFT
// ==============================

function calculateUplift() {
  const fields = { conversion: ["convA", "convB"], basket: ["basketA", "basketB"],
    both: ["convA", "convB", "basketA", "basketB"], direct: ["directCaA", "directCaB"] }[metricType.value];
  if (!fields || fields.some(id => !$(id).value.trim() || !Number.isFinite(Number($(id).value)) || Number($(id).value) < 0)) {
    showError("Renseigne toutes les valeurs A et B avec des nombres positifs ou nuls.");
    return null;
  }

  const type =
    metricType.value;

  if (
    type === "conversion"
  ) {
    const a =
      Number(
        $("convA").value
      );

    const b =
      Number(
        $("convB").value
      );

    if (
      !(a > 0) ||
      !Number.isFinite(b)
    ) {
      showError(
        "Renseigne les taux de conversion A et B."
      );

      return null;
    }

    return (
      b / a -
      1
    );
  }

  if (
    type === "basket"
  ) {
    const a =
      Number(
        $("basketA").value
      );

    const b =
      Number(
        $("basketB").value
      );

    if (
      !(a > 0) ||
      !Number.isFinite(b)
    ) {
      showError(
        "Renseigne les paniers moyens TTC pré-RB A et B."
      );

      return null;
    }

    return (
      b / a -
      1
    );
  }

  if (
    type === "both"
  ) {
    const convA =
      Number(
        $("convA").value
      ) / 100;

    const convB =
      Number(
        $("convB").value
      ) / 100;

    const basketA =
      Number(
        $("basketA").value
      );

    const basketB =
      Number(
        $("basketB").value
      );

    if (
      !(convA > 0) ||
      !(basketA > 0) ||
      !Number.isFinite(
        convB
      ) ||
      !Number.isFinite(
        basketB
      )
    ) {
      showError(
        "Renseigne conversion et panier moyen pour A et B."
      );

      return null;
    }

    const revenuePerVisitorA =
      convA *
      basketA;

    const revenuePerVisitorB =
      convB *
      basketB;

    return (
      revenuePerVisitorB /
        revenuePerVisitorA -
      1
    );
  }

  if (
    type === "direct"
  ) {
    const caA =
      Number(
        $("directCaA").value
      );

    const caB =
      Number(
        $("directCaB").value
      );

    if (
      !(caA > 0) ||
      !Number.isFinite(caB)
    ) {
      showError(
        "Renseigne le CA TTC pré-RB des versions A et B."
      );

      return null;
    }

    return (
      caB / caA -
      1
    );
  }

  return null;
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
    profile.globalAverage ||
    null
  );
}

// ==============================
// RESULTS
// ==============================

function renderResults(data, save = true) {
  lastResult = { ...data };
  lastInputs = captureInputs();
  renderTestIdentity();
  if (save) saveCurrentTest().catch(error => showError(error.message));
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

  $("upliftValue").textContent =
    signedPercent(
      data.uplift
    );

  $("periodLabel").textContent =
    `sur les ${data.months} prochains mois`;

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
    du CA concerné.
    Le scénario central conserve
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
  const tbody =
    $("resultTable");

  tbody.innerHTML = "";

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

      const tr =
        document.createElement(
          "tr"
        );

      tr.innerHTML = `
        <td>
          ${formatMonth(row.date)}
        </td>

        <td>
          ${formatMoney(baselineHT)}
        </td>

        <td>
          ${formatMoney(baselineTTC)}
        </td>

        <td>
          <strong>
            ${signedMoney(gainTTC)}
          </strong>
        </td>

        <td>
          <strong>
            ${signedMoney(gainHT)}
          </strong>
        </td>
      `;

      tbody.appendChild(
        tr
      );
    }
  );
}

// ==============================
// CHART
// ==============================

function renderChart() {
  const canvas =
    $("revenueChart");

  if (!canvas) {
    return;
  }

  const rect =
    canvas.getBoundingClientRect();

  const dpr =
    window.devicePixelRatio ||
    1;

  canvas.width =
    rect.width *
    dpr;

  canvas.height =
    rect.height *
    dpr;

  const ctx =
    canvas.getContext(
      "2d"
    );

  ctx.setTransform(
    1,
    0,
    0,
    1,
    0,
    0
  );

  ctx.scale(
    dpr,
    dpr
  );

  const width =
    rect.width;

  const height =
    rect.height;

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  if (
    !lastProjection.length
  ) {
    return;
  }

  const padding = {
    top: 25,
    right: 20,
    bottom: 60,
    left: 80
  };

  const chartW =
    width -
    padding.left -
    padding.right;

  const chartH =
    height -
    padding.top -
    padding.bottom;

  const values =
    lastProjection.map(
      (row) =>
        htPostRbToTtcPreRb(
          row.central
        )
    );

  const max =
    Math.max(
      ...values.map(
        (v) =>
          Math.abs(v)
      ),
      1
    );

  ctx.strokeStyle =
    "#dfe2e6";

  ctx.lineWidth = 1;

  ctx.beginPath();

  ctx.moveTo(
    padding.left,
    padding.top
  );

  ctx.lineTo(
    padding.left,
    padding.top +
      chartH
  );

  ctx.lineTo(
    padding.left +
      chartW,
    padding.top +
      chartH
  );

  ctx.stroke();

  ctx.font =
    "12px Inter, sans-serif";

  ctx.fillStyle =
    "#777";

  ctx.textAlign =
    "right";

  for (
    let i = 0;
    i <= 4;
    i++
  ) {
    const y =
      padding.top +
      chartH -
      chartH *
        i /
        4;

    const value =
      max *
      i /
      4;

    ctx.strokeStyle =
      "#eef0f2";

    ctx.beginPath();

    ctx.moveTo(
      padding.left,
      y
    );

    ctx.lineTo(
      padding.left +
        chartW,
      y
    );

    ctx.stroke();

    ctx.fillText(
      compactMoney(
        value
      ),
      padding.left -
        10,
      y + 4
    );
  }

  const barSpace =
    chartW /
    Math.max(
      lastProjection.length,
      1
    );

  const barWidth =
    Math.max(
      8,
      barSpace *
        0.55
    );

  lastProjection.forEach(
    (row, i) => {
      const value =
        htPostRbToTtcPreRb(
          row.central
        );

      const barHeight =
        Math.abs(value) /
        max *
        chartH;

      const x =
        padding.left +
        i *
          barSpace +
        (
          barSpace -
          barWidth
        ) /
          2;

      const y =
        padding.top +
        chartH -
        barHeight;

      ctx.fillStyle =
        value >= 0
          ? "#15171a"
          : "#b42318";

      roundRect(
        ctx,
        x,
        y,
        barWidth,
        barHeight,
        5
      );

      ctx.fill();

      ctx.save();

      ctx.translate(
        x +
          barWidth /
            2,
        padding.top +
          chartH +
          20
      );

      ctx.rotate(
        -Math.PI /
          5
      );

      ctx.fillStyle =
        "#777";

      ctx.font =
        "11px Inter, sans-serif";

      ctx.textAlign =
        "right";

      ctx.fillText(
        shortMonth(
          row.date
        ),
        0,
        0
      );

      ctx.restore();
    }
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
      "Gain HT post-RB"
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
          )
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
  $("errorMessage").textContent =
    message;

  $("errorMessage").classList.remove(
    "hidden"
  );
}

function hideError() {
  $("errorMessage").classList.add(
    "hidden"
  );
}
// Test history and PDF export. All data stays in this browser.
const INPUT_IDS = ["testTitle", "kameleoonUrl", "testStart", "testEnd", "metricType",
  "convA", "convB", "basketA", "basketB", "directCaA", "directCaB", "rolloutDate",
  "affectedShare", "annualGrowth", "projectionMonths", "vatRate", "rbRate",
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
  link.textContent = url ? "Voir les résultats Kameleoon" : "Lien non renseigné";
  link.removeAttribute("href");
  if (url) link.href = url;
  link.rel = "noopener noreferrer";
}
function checkCurrentResult() {
  if (!lastResult || !lastProjection.length) {
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
  const inputs = { ...lastInputs, testTitle: lastInputs.testTitle.trim() };
  const id = JSON.stringify([inputs.testTitle, inputs.testStart, inputs.testEnd, inputs.metricType]);
  const test = { id, inputs, result: { ...lastResult }, projection: lastProjection.map(row => ({ ...row })), updatedAt: new Date().toISOString() };
  await testTransaction("readwrite", store => store.put(test));
  await renderSavedTests();
}
async function renderSavedTests() {
  const list = $("savedTestsList");
  if (!list || !db) return;
  const tests = await testTransaction("readonly", store => store.getAll());
  list.replaceChildren();
  if (!tests.length) { list.textContent = "Aucun test sauvegardé. Renseigne un nom puis calcule l'impact."; return; }
  tests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const test of tests) {
    const card = document.createElement("div"); card.className = "saved-test-card";
    const title = document.createElement("strong"); title.textContent = test.inputs.testTitle;
    const details = document.createElement("p");
    details.textContent = `${test.inputs.testStart || "—"} → ${test.inputs.testEnd || "—"} · ${signedPercent(test.result.uplift)} · Mis à jour le ${formatDateTime(new Date(test.updatedAt))}`;
    const actions = document.createElement("div"); actions.className = "saved-test-actions";
    const load = document.createElement("button"); load.type = "button"; load.className = "secondary-btn"; load.textContent = "Recharger";
    load.addEventListener("click", () => {
      for (const id of INPUT_IDS) if ($(id)) $(id).value = test.inputs[id] ?? "";
      updateMetricFields();
      lastProjection = test.projection.map(row => ({ ...row, date: new Date(row.date) }));
      renderResults(test.result, false);
      hideError();
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-btn"; remove.textContent = "Supprimer";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Supprimer le test « ${test.inputs.testTitle} » ?`)) return;
      try { await testTransaction("readwrite", store => store.delete(test.id)); await renderSavedTests(); }
      catch (error) { showError(error.message); }
    });
    actions.append(load, remove); card.append(title, details, actions); list.append(card);
  }
}
function formatMoneyPDF(value) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value).replace(/[\u00a0\u202f]/g, " ") + " EUR";
}
function signedMoneyPDF(value) { return (value > 0 ? "+" : "") + formatMoneyPDF(value); }
function generatePDF() {
  if (!checkCurrentResult()) return;
  if (!window.jspdf?.jsPDF) { showError("La bibliothèque jsPDF n'est pas chargée. Vérifie son inclusion dans le HTML."); return; }
  try {
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    let y = 20;
    const text = (value, size = 11, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(value).replace(/[\u00a0\u202f]/g, " "), 170);
      for (const line of lines) {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(line, 20, y); y += size * 0.45 + 2;
      }
    };
    const link = (label, url) => {
      if (!url) return;
      if (y > 275) { doc.addPage(); y = 20; }
      doc.setFontSize(10); doc.setTextColor(40, 80, 180);
      doc.textWithLink(label, 20, y, { url }); doc.setTextColor(0, 0, 0); y += 10;
    };
    text("A/B TEST - ESTIMATION", 11, true);
    text(lastInputs.testTitle.trim() || "Expérience sans nom", 20, true);
    const date = value => value ? formatDate(parseDate(value)) : "Non renseignée";
    text(`Période du test : ${date(lastInputs.testStart)} au ${date(lastInputs.testEnd)}`, 10);
    link("Voir les résultats Kameleoon", safeURL(lastInputs.kameleoonUrl));
    text(`Uplift observé : ${signedPercent(lastResult.uplift)}`, 16, true);
    text(`Projection sur ${lastResult.months} mois à partir du ${date(lastInputs.rolloutDate)}`, 12, true);
    const equivalent = value => value / (1 - Number(lastInputs.rbRate || 24.65) / 100) * (1 + Number(lastInputs.vatRate || 20) / 100);
    text(`CA de référence : ${formatMoneyPDF(lastResult.baselineTotal)} HT post-RB`, 10);
    text(`Équivalent : ${formatMoneyPDF(equivalent(lastResult.baselineTotal))} TTC pré-RB`, 10);
    y += 4;
    for (const [label, key] of [["Prudent", "lowTotal"], ["Central", "centralTotal"], ["Haut", "highTotal"]]) {
      text(`Scénario ${label} - gain estimé`, 12, true);
      text(`${signedMoneyPDF(equivalent(lastResult[key]))} TTC pré-RB`, 14, true);
      text(`${signedMoneyPDF(lastResult[key])} HT post-RB`, 11); y += 3;
    }
    text(`Part du CA concernée : ${lastInputs.affectedShare} % ; croissance annuelle : ${lastInputs.annualGrowth} %.`, 9);
    text(`Uplift retenu : prudent ${lastInputs.lowFactor} %, central ${lastInputs.centralFactor} %, haut ${lastInputs.highFactor} %.`, 9);
    text(`TVA : ${lastInputs.vatRate} % ; RB : ${lastInputs.rbRate} %.`, 9);
    text("Estimation basée sur la saisonnalité historique et les hypothèses saisies. Les gains futurs ne sont pas garantis.", 9);
    const simulator = new URL(window.location.href); simulator.search = ""; simulator.hash = "";
    link("Ouvrir le simulateur", safeURL(simulator.href));
    const name = (lastInputs.testTitle || "ab-test").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
    doc.save(`projection-${name}.pdf`);
  } catch (error) { showError(`Impossible de générer le PDF : ${error.message}`); }
}
