// Rates are percentages; traffic is a proportion. No revenue extrapolation.
const KPI_NAMES = ['Page produit consultée', 'Page collection consultée', 'Ajout au panier', 'Autre'];
function syncKpiInputs() {
  const alternatives = variantNumbers({ variantCount: $('variantCount').value }).slice(1);
  const rows = [...document.querySelectorAll('.kpi-row')].map(row => {
    const data = {
      type: row.querySelector('select').value, name: row.querySelector('.kpi-name').value,
      a: row.querySelector('.kpi-a').value, b: row.querySelector('.kpi-b').value,
      mode: $('upliftEntryMode').value || 'ab', directUplift: row.querySelector('.kpi-uplift').value,
    };
    for (const number of alternatives) {
      const suffix = VARIANT_SUFFIXES[number];
      data[suffix.toLowerCase()] = row.querySelector(`.kpi-rate-${number}`).value;
      data[`directUplift${suffix}`] = row.querySelector(`.kpi-uplift-${number}`).value;
    }
    return data;
  });
  $('kpiInputs').value = JSON.stringify(rows);
}
function addKpiRow(data = {}) {
  const row = document.createElement('div'); row.className = 'kpi-row';
  row.innerHTML = `<label>KPI<select>${KPI_NAMES.map(n=>`<option>${n}</option>`).join('')}</select></label>
    <label class="kpi-custom hidden">Nom du KPI<input class="kpi-name" maxlength="100" placeholder="Ex. : passage au paiement"></label>
    <div class="kpi-variant-inputs">
      <label>Taux original (%)<input class="kpi-a" type="number" min="0" max="100" step="any" placeholder="Ex. : 20"></label>
      <label>Taux variante 1 (%)<input class="kpi-b" type="number" min="0" max="100" step="any" placeholder="Ex. : 22"></label>
      <label class="kpi-direct hidden">Uplift variante 1 (%)<input class="kpi-uplift" type="number" min="-100" step="any" placeholder="Ex. : 5 ou -4,32"></label>
      ${[2, 3].map(number => `
        <label data-extra-variant="${number}" data-entry-mode="ab" class="hidden">Taux variante ${number} (%)<input class="kpi-rate-${number}" type="number" min="0" max="100" step="any"></label>
        <label data-extra-variant="${number}" data-entry-mode="direct" class="hidden">Uplift variante ${number} (%)<input class="kpi-uplift-${number}" type="number" min="-100" step="any"></label>`).join('')}
    </div>
    <button type="button" class="secondary-btn" aria-label="Supprimer ce KPI">Supprimer</button>`;
  row.querySelector('select').value = KPI_NAMES.includes(data.type) ? data.type : KPI_NAMES[0];
  row.querySelector('.kpi-name').value = data.name || '';
  row.querySelector('.kpi-a').value = data.a ?? ''; row.querySelector('.kpi-b').value = data.b ?? '';
  row.querySelector('.kpi-uplift').value=data.directUplift ?? '';
  for (const number of [2, 3]) {
    const suffix = VARIANT_SUFFIXES[number];
    row.querySelector(`.kpi-rate-${number}`).value = data[suffix.toLowerCase()] ?? '';
    row.querySelector(`.kpi-uplift-${number}`).value = data[`directUplift${suffix}`] ?? '';
  }
  const direct=$('upliftEntryMode').value==='direct';row.querySelector('.kpi-direct').classList.toggle('hidden',!direct);row.querySelector('.kpi-a').closest('label').classList.toggle('hidden',direct);row.querySelector('.kpi-b').closest('label').classList.toggle('hidden',direct);
  const update = () => { row.querySelector('.kpi-custom').classList.toggle('hidden',row.querySelector('select').value !== 'Autre'); syncKpiInputs(); };
  row.addEventListener('input',update);row.addEventListener('change',update);
  row.querySelector('button').addEventListener('click',()=>{row.remove();syncKpiInputs();});
  $('kpiRows').append(row);update();updateVariantFields();
}
function restoreKpiRows() {
  let rows;try {rows=JSON.parse($('kpiInputs').value);}catch {rows=[];}
  $('kpiRows').replaceChildren();
  (Array.isArray(rows)&&rows.length ? rows : [{}]).forEach(addKpiRow);
}
function updateKpiMode() {
  const kpi = metricType.value === 'kpi';
  $('kpiFields').classList.toggle('hidden',!kpi);
  document.querySelector('.ga4-grid').classList.toggle('kpi-ga4-grid',kpi);
  ['ga4TotalRevenue','ga4EligibleRevenue'].forEach(id=>$(id).closest('label').classList.toggle('hidden',kpi));
  ['rolloutDate','annualGrowth','projectionMonths','vatRate','rbRate'].forEach(id=>$(id).closest('label').classList.toggle('hidden',kpi));
  document.querySelector('.scenario-box').classList.toggle('hidden',kpi);
  $('revenueSharePreview').parentElement.classList.toggle('hidden',kpi);
  document.querySelector('.ga4-panel').nextElementSibling.classList.toggle('hidden',kpi);
  document.querySelector('.reference-banner').previousElementSibling.classList.toggle('hidden',kpi);
  $('calculateBtn').disabled = !kpi && sheetLoading;
  $('results').classList.add('hidden');$('kpiResults').classList.add('hidden');
  updateEligibilityPreview();
}
function readKpiTraffic() {
  const total=$('ga4TotalSessions').value.trim(), eligible=$('ga4EligibleSessions').value.trim();
  if(!total || !eligible || !Number.isSafeInteger(+total) || !Number.isSafeInteger(+eligible) || +total<=0 || +eligible<0 || +eligible>+total) throw Error('Renseigne des visiteurs entiers : total supérieur à zéro et visiteurs éligibles compris entre zéro et le total.');
  return +eligible/+total;
}
function computeKpi(row, traffic) {
  const name = row.type === 'Autre' ? row.name.trim() : row.type;
  if(row.mode==='direct'){
    const raw=String(row.directUplift ?? '').trim().replace(',','.');const uplift=Number(raw)/100;
    if(!KPI_NAMES.includes(row.type)|| !name || name.length>100 || !raw || !Number.isFinite(uplift) || uplift < -1)throw Error('Chaque KPI doit avoir un nom et un uplift valide, supérieur ou égal à −100 %.');
    return {name,a:null,b:null,uplift,globalUplift:uplift*traffic,globalPoints:null,entryMode:'direct'};
  }
  const a=Number(row.a),b=Number(row.b);
  if(!KPI_NAMES.includes(row.type) || !name || name.length>100 || !String(row.a).trim() || !String(row.b).trim() || !Number.isFinite(a) || !Number.isFinite(b) || a<0 || b<0 || a>100 || b>100) throw Error('Chaque KPI doit avoir un nom et des taux A et B compris entre 0 et 100 %.');
  const uplift = a === 0 ? null : b/a-1;
  return {name,a,b,uplift,globalUplift:uplift===null ? null : uplift*traffic,globalPoints:(b-a)*traffic};
}
function computeVariantKpis(rows, number, traffic, required = false) {
  const suffix = VARIANT_SUFFIXES[number];
  try {
    return rows.flatMap(row => {
      const comparison = number === 1 ? row : {
        ...row, b: row[suffix.toLowerCase()], directUplift: row[`directUplift${suffix}`],
      };
      const input = comparison.mode === 'direct' ? comparison.directUplift : comparison.b;
      return required || String(input ?? '').trim() ? [computeKpi(comparison, traffic)] : [];
    });
  } catch (error) {
    throw Error(`${variantLabel(number)} · ${error.message}`);
  }
}

function kpiVariantGroups(inputs, result) {
  const selected = retainedVariantNumber(inputs);
  let rows;
  try { rows = JSON.parse(inputs.kpiInputs); } catch { rows = []; }
  return variantNumbers(inputs).map(number => {
    if (number === selected) return { number, retained: true, kpis: result.kpis };
    let kpis;
    try { kpis = computeVariantKpis(rows, number, result.eligibleTrafficShare); } catch { kpis = []; }
    return { number, retained: false, kpis };
  });
}

function calculateKpis() {
  try {
    if($('testStart').value && $('testEnd').value && $('testStart').value > $('testEnd').value) throw Error('La fin du test doit suivre son début.');
    if($('kameleoonUrl').value.trim() && !safeURL($('kameleoonUrl').value)) throw Error('Le lien de l’outil A/B doit être une URL HTTP ou HTTPS valide.');
    const traffic=readKpiTraffic(),rows=JSON.parse($('kpiInputs').value);
    if(!rows.length || rows.length>20) throw Error('Ajoute entre 1 et 20 KPI.');
    const inputs = captureInputs();
    const selected = retainedVariantNumber(inputs);
    const groups = variantNumbers(inputs).map(number => computeVariantKpis(rows, number, traffic, number === selected));
    const kpis = groups[selected - 1];
    if (!$('testTitle').value.trim()) $('testTitle').value = `Test KPI — ${kpis.map(k=>k.name).join(' / ')}`;
    lastProjection=[];renderKpiResults({kind:'kpi',eligibleTrafficShare:traffic,kpis});
  } catch(error) {showError(error.message);}
}
function kpiPercent(value) {return value===null ? 'Non calculable (A = 0)' : signedPercent(value);}
function kpiPoints(value) {if(value===null)return 'Non calculable sans les taux A/B';return `${value>0?'+':''}${value.toLocaleString('fr-FR',{maximumFractionDigits:3})} point${Math.abs(value)>1?'s':''}`;}
function renderKpiGroup({ number, retained, kpis }, hasAlternatives) {
  const heading = hasAlternatives ? `<h3>${variantLabel(number)}${retained ? ' · retenue' : ''}</h3>` : '';
  const cards = kpis.map(k => `<article class="kpi-result"><h4>${escapeHTML(k.name)}</h4>
    <p>${k.entryMode==='direct'?'Uplift saisi directement':`Original ${formatPercent(k.a/100)} → Variante ${formatPercent(k.b/100)}`}</p>
    <div class="grid two"><div><small>Uplift sur les visiteurs ciblés</small><strong>${kpiPercent(k.uplift)}</strong></div>
    <div><small>Uplift global estimé*</small><strong>${kpiPercent(k.globalUplift)}</strong></div></div>
    <p>Variation du taux à l’échelle du site <b>${kpiPoints(k.globalPoints)}</b>.</p></article>`).join('');
  return `<section class="kpi-variant-group">${heading}${cards || '<p>Mesures non renseignées.</p>'}</section>`;
}

function renderKpiResults(data,save=true) {
  showDashboard();
  lastResult=structuredClone(data);lastInputs=captureInputs();lastProjection=[];
  const groups = kpiVariantGroups(lastInputs, data);
  $('results').classList.add('hidden');const panel=$('kpiResults');panel.classList.remove('hidden');
  panel.innerHTML=`<p class="test-type-badge">KPI · CA non fiable</p><h2>${escapeHTML(lastInputs.testTitle || 'Résultats du test')}</h2>
    <p><strong>Aucun gain fiable en CA estimé.</strong> ${formatPercent(data.eligibleTrafficShare)} des visiteurs sont ciblés.</p>
    <div class="kpi-result-list">${groups.map(group => renderKpiGroup(group, groups.length > 1)).join('')}</div>
    <details><summary>Comprendre l’estimation</summary><p>Variation globale en points = (taux B − taux A) × part des visiteurs ciblés. Exemple : 20 % → 22 % sur 30 % des visiteurs = +0,6 point à l’échelle du site.</p>
    <p>* Uplift global relatif estimé = uplift du KPI × part ciblée. Cela suppose le même taux initial chez les visiteurs hors cible. Dans cet exemple : +10 % × 30 % = +3 %. Sans cette hypothèse, le taux global initial est nécessaire pour calculer un uplift relatif exact.</p>
    <p>Le calcul suppose un déploiement sur toute la population éligible et aucun changement hors cible. Utilise des taux par visiteur et des populations comparables. Ces estimations ne mesurent pas la significativité statistique et n’appliquent aucun coefficient de scénario.</p></details>
    <p class="field-help">* Estimation sous hypothèse d’un même taux initial hors cible ; voir le détail ci-dessus.</p>
    <p id="kpiSaveStatus" role="status"></p><a href="#savedTestsList">Voir les tests enregistrés ↓</a><br><br>
    <button type="button" class="secondary-btn" id="kpiPdf">Exporter la synthèse PDF</button>`;
  addOutcomeDetail(panel,lastInputs);
  renderResultVisuals(lastInputs,panel);
  renderTestComment(panel,lastInputs);
  $('kpiPdf').addEventListener('click',exportKpiPDF);
  if(save) {
    $('kpiSaveStatus').textContent = 'Enregistrement du test…';
    saveCurrentTest().then(()=>{ $('kpiSaveStatus').textContent = 'Test ajouté à « Tests enregistrés » en bas de page.'; }).catch(error=>{ $('kpiSaveStatus').textContent = error.message; showError(error.message); });
  }
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
function exportKpiPDF(event) {
  if(!checkCurrentResult())return;
  if(!window.jspdf){showError('Le module PDF est indisponible. Réessaie après rechargement.');return;}
  const doc=new window.jspdf.jsPDF();let y=22;
  const line=(text,size=11)=>{doc.setFontSize(size);const lines=doc.splitTextToSize(text,170);if(y+lines.length*6>275){doc.addPage();y=22;}doc.text(lines,20,y);y+=lines.length*6+4;};
  doc.setTextColor(65,89,84);line(lastInputs.testTitle || 'Synthèse du test',20);line('KPI du parcours - Aucun gain fiable en CA estimé',14);
  line(`${OUTCOMES[lastInputs.testOutcome] || 'À qualifier'} - ${DECISIONS[lastInputs.testDecision] || 'Décision non renseignée'}`);
  line(`Période : ${lastInputs.testStart || '—'} au ${lastInputs.testEnd || '—'}`);
  line(`Visiteurs ciblés : ${formatPercent(lastResult.eligibleTrafficShare)}`);
  const groups = kpiVariantGroups(lastInputs, lastResult);
  for (const { number, retained, kpis } of groups) {
    if (groups.length > 1) line(`${variantLabel(number)}${retained ? ' - retenue' : ''}`, 15);
    if (!kpis.length) line('Mesures non renseignées.');
    kpis.forEach(k=>{line(k.name,15);line(k.entryMode==='direct'?'Uplift saisi directement':`Original ${formatPercent(k.a/100)} / Variante ${formatPercent(k.b/100)}`);line(`Uplift ciblé : ${kpiPercent(k.uplift)}`);line(`Uplift global estimé* : ${kpiPercent(k.globalUplift)}`,13);line(`Variation globale du taux : ${kpiPoints(k.globalPoints)}`);});
  }
  line('* Uplift relatif global : uplift ciblé × part ciblée. Hypothèse : même taux initial hors cible. Variation en points : (B - A) × part ciblée. Déploiement sur tous les visiteurs éligibles, aucun changement hors cible. Aucun coefficient de scénario ni conclusion de significativité.',9);
  appendCommentPDF(doc,lastInputs.testNotes,y);
  return downloadTestPDF(doc, lastInputs, 'synthese-kpi.pdf', event?.currentTarget);
}
$('addKpi').addEventListener('click',()=>{if(document.querySelectorAll('.kpi-row').length<20)addKpiRow();else showError('Maximum : 20 KPI par test.');});
restoreKpiRows();
