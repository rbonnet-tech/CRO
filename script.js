let historicalData = [];
let lastProjection = [];

const $ = (id) => document.getElementById(id);

const csvFile = $("csvFile");
const uploadBtn = $("uploadBtn");
const dropZone = $("dropZone");
const fileStatus = $("fileStatus");
const metricType = $("metricType");

uploadBtn.addEventListener("click", () => csvFile.click());

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

window.addEventListener("resize", () => {
  if (lastProjection.length) {
    renderChart();
  }
});

updateMetricFields();

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

function loadCSV(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showError("Le fichier doit être au format CSV.");
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const parsed = parseCSV(e.target.result);

      if (!parsed.length) {
        throw new Error(
          "Aucune donnée exploitable trouvée dans le fichier."
        );
      }

      historicalData = parsed.sort((a, b) => a.date - b.date);

      const totalHT = historicalData.reduce(
        (sum, row) => sum + row.revenue,
        0
      );

      const totalTTC = htPostRbToTtcPreRb(totalHT);

      const firstDate = historicalData[0].date;
      const lastDate =
        historicalData[historicalData.length - 1].date;

      fileStatus.innerHTML = `
        ✓ <strong>${file.name}</strong><br>
        ${historicalData.length.toLocaleString("fr-FR")} lignes importées ·
        ${formatMoney(totalHT)} HT post-RB ·
        équivalent ${formatMoney(totalTTC)} TTC pré-RB ·
        du ${formatDate(firstDate)} au ${formatDate(lastDate)}
      `;

      fileStatus.classList.remove("hidden");

      hideError();
    } catch (error) {
      historicalData = [];
      fileStatus.classList.add("hidden");
      showError(error.message);
    }
  };

  reader.readAsText(file, "UTF-8");
}

function parseCSV(text) {
  text = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim();

  const lines = text
    .split("\n")
    .filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error(
      "Le CSV ne contient pas suffisamment de lignes."
    );
  }

  const delimiter =
    lines[0].split(";").length > lines[0].split(",").length
      ? ";"
      : ",";

  const headers = splitCSVLine(lines[0], delimiter)
    .map(normalizeHeader);

  const dateIndex = headers.findIndex((h) =>
    [
      "date",
      "jour",
      "day"
    ].includes(h)
  );

  const revenueIndex = headers.findIndex((h) =>
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

  if (dateIndex === -1 || revenueIndex === -1) {
    throw new Error(
      'Le CSV doit contenir une colonne "date" et une colonne "ca_ht_post_rb" ou "ca".'
    );
  }

  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delimiter);

    const date = parseDate(cells[dateIndex]);
    const revenue = parseNumber(cells[revenueIndex]);

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

function splitCSVLine(line, delimiter) {
  const result = [];

  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (
        insideQuotes &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (
      char === delimiter &&
      !insideQuotes
    ) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());

  return result;
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’\s_-]/g, "");
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  value = String(value)
    .trim()
    .replace(/"/g, "");

  let match = value.match(
    /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/
  );

  if (match) {
    return createSafeDate(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );
  }

  match = value.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/
  );

  if (match) {
    return createSafeDate(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1])
    );
  }

  const fallback = new Date(value);

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

function createSafeDate(year, month, day) {
  const d = new Date(
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

function parseNumber(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return NaN;
  }

  let v = String(value)
    .replace(/"/g, "")
    .replace(/\u00A0/g, "")
    .replace(/\s/g, "")
    .replace(/€/g, "");

  if (
    v.includes(",") &&
    !v.includes(".")
  ) {
    v = v.replace(",", ".");
  } else if (
    v.includes(",") &&
    v.includes(".")
  ) {
    if (
      v.lastIndexOf(",") >
      v.lastIndexOf(".")
    ) {
      v = v
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      v = v.replace(/,/g, "");
    }
  }

  return Number(v);
}

function getVatRate() {
  return Number(
    $("vatRate").value || 20
  ) / 100;
}

function getRbRate() {
  return Number(
    $("rbRate").value || 24.65
  ) / 100;
}

function ttcPreRbToHtPostRb(value) {
  const vat = getVatRate();
  const rb = getRbRate();

  return (
    value /
    (1 + vat) *
    (1 - rb)
  );
}

function htPostRbToTtcPreRb(value) {
  const vat = getVatRate();
  const rb = getRbRate();

  if (rb >= 1) {
    return 0;
  }

  return (
    value /
    (1 - rb) *
    (1 + vat)
  );
}

function calculateProjection() {
  hideError();

  if (!historicalData.length) {
    showError(
      "Commence par importer ton historique de CA HT post-RB."
    );
    return;
  }

  const uplift = calculateUplift();

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

  const vat = getVatRate();
  const rb = getRbRate();

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
      rolloutValue + "T12:00:00"
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
    endDate.getDate() - 1
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
      $("annualGrowth").value || 0
    ) / 100;

  const lowFactor =
    Number(
      $("lowFactor").value || 0
    ) / 100;

  const centralFactor =
    Number(
      $("centralFactor").value || 0
    ) / 100;

  const highFactor =
    Number(
      $("highFactor").value || 0
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

  while (current <= endDate) {
    const baselineHT =
      getExpectedRevenue(
        current,
        seasonalProfile
      );

    if (baselineHT !== null) {
      const daysFromStart =
        (
          current -
          startDate
        ) / 86400000;

      const growthMultiplier =
        Math.pow(
          Math.max(
            0.01,
            1 + annualGrowth
          ),
          daysFromStart / 365.25
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
          current.getMonth() + 1
        ).padStart(2, "0")}`;

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
      current.getDate() + 1
    );
  }

  lastProjection =
    Object.values(
      monthlyMap
    ).sort(
      (a, b) =>
        a.date - b.date
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

function calculateUplift() {
  const type =
    metricType.value;

  if (type === "conversion") {
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

    return b / a - 1;
  }

  if (type === "basket") {
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

    return b / a - 1;
  }

  if (type === "both") {
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
      !Number.isFinite(convB) ||
      !Number.isFinite(basketB)
    ) {
      showError(
        "Renseigne conversion et panier moyen pour A et B."
      );
      return null;
    }

    const revenuePerVisitorA =
      convA * basketA;

    const revenuePerVisitorB =
      convB * basketB;

    return (
      revenuePerVisitorB /
      revenuePerVisitorA -
      1
    );
  }

if (type === "direct") {
  const caA = Number($("directCaA").value);
  const caB = Number($("directCaB").value);

  if (!(caA > 0) || !Number.isFinite(caB)) {
    showError(
      "Renseigne le CA TTC pré-RB des versions A et B."
    );
    return null;
  }

  return caB / caA - 1;

  const seasonalProfile = buildSeasonalityProfile();

  let testRevenueHT = 0;
  let current = new Date(testStart);

  while (current <= testEnd) {
    const expectedHT = getExpectedRevenue(
      current,
      seasonalProfile
    );

    if (expectedHT !== null) {
      testRevenueHT += expectedHT;
    }

    current.setDate(current.getDate() + 1);
  }

  if (testRevenueHT <= 0) {
    showError(
      "Impossible d'estimer le CA de référence sur la période du test."
    );
    return null;
  }

  const testRevenueTTC =
    htPostRbToTtcPreRb(testRevenueHT);

  return directGainTTC / testRevenueTTC;
}

  return null;
}

function buildSeasonalityProfile() {
  const byDay = {};
  const byMonth = {};

  let globalSum = 0;
  let globalCount = 0;

  historicalData.forEach(
    (row) => {
      const month =
        String(
          row.date.getMonth() + 1
        ).padStart(2, "0");

      const day =
        String(
          row.date.getDate()
        ).padStart(2, "0");

      const dayKey =
        `${month}-${day}`;

      if (!byDay[dayKey]) {
        byDay[dayKey] = [];
      }

      byDay[dayKey].push(
        row.revenue
      );

      const monthKey =
        row.date.getMonth();

      if (!byMonth[monthKey]) {
        byMonth[monthKey] = [];
      }

      byMonth[monthKey].push(
        row.revenue
      );

      globalSum +=
        row.revenue;

      globalCount++;
    }
  );

  const dailyAverage = {};

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

  const monthlyAverage = {};

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
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

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

function renderResults(data) {
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
    Le résultat est ensuite restitué dans les deux référentiels :
    <strong>HT post-RB</strong> et
    <strong>TTC pré-RB</strong>.
    La conversion utilise une TVA de
    <strong>${formatPercent(getVatRate())}</strong>
    et un RB annuel moyen de
    <strong>${formatPercent(getRbRate())}</strong>.
    Il s'agit d'une estimation basée sur l'uplift observé et sur la saisonnalité historique.
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

      tbody.appendChild(tr);
    }
  );
}

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
    rect.width * dpr;

  canvas.height =
    rect.height * dpr;

  const ctx =
    canvas.getContext("2d");

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

  if (!lastProjection.length) {
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
    padding.top + chartH
  );

  ctx.lineTo(
    padding.left + chartW,
    padding.top + chartH
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
      padding.left - 10,
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
      barSpace * 0.55
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
        i * barSpace +
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
        -Math.PI / 5
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
      Math.abs(w) / 2,
      Math.abs(h) / 2
    );

  ctx.beginPath();

  ctx.moveTo(
    x + radius,
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

function exportResults() {
  if (!lastProjection.length) {
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
          baselineHT.toFixed(2),
          baselineTTC.toFixed(2),
          gainTTC.toFixed(2),
          gainHT.toFixed(2)
        ].join(";")
      );
    }
  );

  const blob =
    new Blob(
      [
        "\uFEFF" +
          lines.join("\n")
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

  a.href = url;

  a.download =
    "projection-ab-test.csv";

  a.click();

  URL.revokeObjectURL(
    url
  );
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
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

  result.setDate(1);

  result.setMonth(
    result.getMonth() +
      months
  );

  const lastDay =
    new Date(
      result.getFullYear(),
      result.getMonth() + 1,
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
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0
    }
  ).format(value);
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
    formatMoney(value)
  );
}

function compactMoney(
  value
) {
  return new Intl.NumberFormat(
    "fr-FR",
    {
      notation: "compact",
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 1
    }
  ).format(value);
}

function formatPercent(
  value
) {
  return new Intl.NumberFormat(
    "fr-FR",
    {
      style: "percent",
      maximumFractionDigits: 2
    }
  ).format(value);
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
    formatPercent(value)
  );
}

function formatDate(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR"
  ).format(date);
}

function formatMonth(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      month: "long",
      year: "numeric"
    }
  ).format(date);
}

function shortMonth(
  date
) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      month: "short",
      year: "2-digit"
    }
  ).format(date);
}

function toInputDate(
  date
) {
  const y =
    date.getFullYear();

  const m =
    String(
      date.getMonth() + 1
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
