const VARIANT_SUFFIXES = ['A', 'B', 'C', 'D'];
const UPLIFT_FIELDS = ['', 'directUpliftPercent', 'directUpliftC', 'directUpliftD'];
const VISUAL_FIELDS = ['originalVisual', 'variantVisual', 'variantVisual2', 'variantVisual3'];
const CONVERSION_MEASURE = { id: 'conv', label: 'Conversion', format: value => formatPercent(value / 100) };
const BASKET_MEASURE = { id: 'basket', label: 'Panier moyen TTC pré-RB', format: formatMoney };
const REVENUE_MEASURE = { id: 'directCa', label: 'CA TTC pré-RB', format: formatMoney };
const VARIANT_MEASURES = {
  conversion: [CONVERSION_MEASURE],
  basket: [BASKET_MEASURE],
  both: [CONVERSION_MEASURE, BASKET_MEASURE],
  direct: [REVENUE_MEASURE],
};

function variantNumbers(inputs) {
  const count = Number(inputs.variantCount);
  return [1, 2, 3].slice(0, count === 2 || count === 3 ? count : 1);
}

function retainedVariantNumber(inputs) {
  const number = Number(inputs.retainedVariant);
  return variantNumbers(inputs).includes(number) ? number : 1;
}

function variantLabel(number) {
  return number === 0 ? 'Original' : `Variante ${number}`;
}

function observedMetricSummary(inputs, result) {
  const uplift = Number.isFinite(result.uplift) ? signedPercent(result.uplift) : '—';
  if (inputs.metricType !== 'conversion') return { label: 'Uplift observé', value: uplift };

  const label = 'Taux de conversion';
  const suffix = VARIANT_SUFFIXES[retainedVariantNumber(inputs)];
  const rates = [inputs.convA, inputs['conv' + suffix]];
  const hasRates = inputs.upliftEntryMode !== 'direct' && rates.every(rate =>
    rate?.trim() && Number.isFinite(Number(rate)) && Number(rate) >= 0
  );
  if (hasRates) {
    return { label, value: rates.map(rate => formatPercent(Number(rate) / 100)).join(' → '), change: `${uplift} d’évolution` };
  }
  return { label, value: Number.isFinite(result.uplift) ? `${uplift} d’évolution` : '—' };
}

function observedMetricText(inputs, result) {
  const { label, value, change } = observedMetricSummary(inputs, result);
  return `${label} ${value}${change ? ` · ${change}` : ''}`;
}

function updateVariantFields() {
  const numbers = variantNumbers({ variantCount: $('variantCount').value });
  const count = numbers.length;
  const retained = $('retainedVariant');
  for (const option of retained.options) {
    option.hidden = option.disabled = !numbers.includes(Number(option.value));
  }
  if (!numbers.includes(Number(retained.value))) retained.value = '1';
  $('retainedVariantField').classList.toggle('hidden', count === 1);
  $('addTestVariant').classList.toggle('hidden', count === 3);
  $('removeTestVariant').classList.toggle('hidden', count === 1);
  $('addTestVariant').textContent = `+ Ajouter la variante ${count + 1}`;
  $('removeTestVariant').textContent = `Retirer la variante ${count}`;

  const direct = $('upliftEntryMode').value === 'direct';
  const financialMetric = !!VARIANT_MEASURES[metricType.value];
  for (const field of document.querySelectorAll('[data-extra-variant]')) {
    const mode = field.dataset.entryMode;
    const visible = numbers.includes(Number(field.dataset.extraVariant)) &&
      (mode !== 'ab' || !direct) && (mode !== 'direct' || direct) &&
      (!field.closest('#upliftEntryFields') || financialMetric);
    field.classList.toggle('hidden', !visible);
  }
  $('directUpliftHelp').classList.toggle('hidden', !direct || !financialMetric);
}

$('addTestVariant').addEventListener('click', () => {
  $('variantCount').value = String(Math.min(3, Number($('variantCount').value) + 1));
  updateVariantFields();
  if (metricType.value === 'kpi') syncKpiInputs();
  if ($('addTestVariant').classList.contains('hidden')) $('removeTestVariant').focus();
});

$('removeTestVariant').addEventListener('click', () => {
  const count = Number($('variantCount').value);
  if (count < 2) return;
  for (const input of document.querySelectorAll(`[data-extra-variant="${count}"] input, [data-extra-variant="${count}"] textarea`)) {
    input.value = '';
  }
  $('variantCount').value = String(count - 1);
  updateVariantFields();
  if (metricType.value === 'kpi') syncKpiInputs();
  if (count === 2) $('addTestVariant').focus();
});

function measureVariantUplift(inputs, number) {
  const measures = VARIANT_MEASURES[inputs.metricType];
  if (!measures) return null;
  if (inputs.upliftEntryMode === 'direct') {
    const raw = (inputs[UPLIFT_FIELDS[number]] || '').trim().replace(',', '.');
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < -100) {
      throw Error(`${variantLabel(number)} : saisis un uplift supérieur ou égal à −100 %.`);
    }
    return value / 100;
  }

  const suffix = VARIANT_SUFFIXES[number];
  if (measures.every(measure => !inputs[measure.id + suffix]?.trim())) return null;
  let ratio = 1;
  for (const measure of measures) {
    const original = Number(inputs[measure.id + 'A']);
    const raw = inputs[measure.id + suffix]?.trim();
    const variant = Number(raw);
    if (!Number.isFinite(original) || original <= 0 || !raw || !Number.isFinite(variant) || variant < 0) {
      throw Error(`${variantLabel(number)} : vérifie les valeurs de « ${measure.label} ». L’original doit être supérieur à zéro et la variante peut être à zéro.`);
    }
    ratio *= variant / original;
  }
  if (!Number.isFinite(ratio)) throw Error(`${variantLabel(number)} : vérifie les valeurs saisies.`);
  return ratio - 1;
}

function measureTestUplift(inputs, required = true) {
  const selected = retainedVariantNumber(inputs);
  const uplifts = variantNumbers(inputs).map(number => measureVariantUplift(inputs, number));
  const uplift = uplifts[selected - 1];
  if (required && uplift === null) throw Error(`Renseigne la mesure de la variante ${selected}.`);
  return uplift;
}

function showVariantComparison(container, inputs, result) {
  container.querySelector('.variant-comparison')?.remove();
  const numbers = variantNumbers(inputs);
  if (numbers.length === 1 || !VARIANT_MEASURES[inputs.metricType]) return;
  const selected = retainedVariantNumber(inputs);
  const columns = [0, ...numbers];
  const section = document.createElement('section');
  section.className = 'card variant-comparison';
  const title = document.createElement('h3');
  title.textContent = 'Comparaison des variantes';
  const scroll = document.createElement('div');
  scroll.className = 'variant-table-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', title.textContent);
  const table = document.createElement('table');
  const headings = table.createTHead().insertRow();
  for (const label of ['Mesure', ...columns.map(n => variantLabel(n) + (n === selected ? ' · retenue' : ''))]) {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    headings.append(heading);
  }
  const body = table.createTBody();
  const measures = inputs.upliftEntryMode === 'direct' ? [] : VARIANT_MEASURES[inputs.metricType] || [];
  const values = measures.map(measure => [measure.label, ...columns.map(number => {
    const raw = inputs[measure.id + VARIANT_SUFFIXES[number]]?.trim();
    return raw && Number.isFinite(Number(raw)) ? measure.format(Number(raw)) : '—';
  })]);
  const uplifts = numbers.map(number => {
    if (number === selected && Number.isFinite(result.uplift)) return signedPercent(result.uplift);
    try {
      const uplift = measureVariantUplift(inputs, number);
      return Number.isFinite(uplift) ? signedPercent(uplift) : '—';
    } catch {
      return '—';
    }
  });
  values.push(['Uplift par rapport à l’original', '—', ...uplifts]);
  for (const [label, ...cells] of values) {
    const row = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    cells.forEach(value => { row.insertCell().textContent = value; });
  }
  scroll.append(table);
  section.append(title, scroll);
  insertTestDetail(container, section);
}
