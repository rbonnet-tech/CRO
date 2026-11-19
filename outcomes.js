const OUTCOMES={won:'Gagnant',promising:'Encourageant',mixed:'Mitigé',lost:'Perdant'};
const DECISIONS={revenue:'Déployé sur la base du CA',unreliable:'Déployé sans gain CA fiable',deployed:'Déployé',not_deployed:'Non déployé'};
function reliableRevenue(inputs,result={}) {return inputs.testOutcome==='won' && inputs.testDecision==='revenue' && !['kpi','observation'].includes(inputs.metricType) && !['kpi','observation'].includes(result.kind);}
function testCategory(test) {
  const i=test.inputs;
  if(!OUTCOMES[i.testOutcome] || !DECISIONS[i.testDecision])return {rank:3,css:'unqualified',label:'À qualifier',decision:'Résultat et décision à renseigner'};
  if(reliableRevenue(i,test.result))return {rank:0,css:'revenue-win',label:OUTCOMES[i.testOutcome],decision:DECISIONS[i.testDecision]};
  return {rank:i.testDecision==='not_deployed'?2:1,css:i.testDecision==='not_deployed'?'not-deployed':'deployed',label:OUTCOMES[i.testOutcome],decision:DECISIONS[i.testDecision]};
}
function statusBadge(test) {
  const status=testCategory(test),badge=document.createElement('div');badge.className=`outcome-badge ${status.css}`;
  badge.textContent=`${status.label} · ${status.decision}`;return badge;
}
function addOutcomeDetail(container,inputs) {
  container.querySelector('.outcome-badge')?.remove();container.prepend(statusBadge({inputs,result:lastResult || {}}));
}
function updateOutcomeFields() {
  const financial=reliableRevenue(captureInputs()),kpi=metricType.value==='kpi';
  ['ga4TotalRevenue','ga4EligibleRevenue','rolloutDate','annualGrowth','projectionMonths','vatRate','rbRate'].forEach(id=>$(id).closest('label').classList.toggle('hidden',!financial));
  document.querySelector('.ga4-panel').classList.toggle('hidden',!financial&&!kpi);
  document.querySelector('.ga4-panel').nextElementSibling.classList.toggle('hidden',!financial);
  document.querySelector('.reference-banner').classList.toggle('hidden',!financial&&!kpi);
  document.querySelector('.reference-banner').previousElementSibling.classList.toggle('hidden',!financial);
  document.querySelector('.scenario-box').classList.toggle('hidden',!financial);
  $('revenueSharePreview').parentElement.classList.toggle('hidden',!financial);
  $('calculateBtn').disabled=financial&&sheetLoading;
  $('calculateBtn').textContent=financial?'Calculer et enregistrer le test':'Enregistrer le test';
}
function validateOutcome() {
  const i=captureInputs();
  if(!PAGE_LABELS[i.targetPage] || !DEVICE_LABELS[i.targetDevice]){showError('Renseigne la page ciblée et le device du test.');return false;}
  if(!OUTCOMES[i.testOutcome] || !DECISIONS[i.testDecision]){showError('Choisis un résultat et une décision pour ce test.');return false;}
  if(i.testDecision==='revenue' && !reliableRevenue(i)){showError('Le déploiement sur la base du CA est réservé à un test gagnant avec une métrique de CA fiable.');return false;}
  if(i.testOutcome==='lost' && i.testDecision!=='not_deployed'){showError('Pour un test perdant, sélectionne « Non déployé ».');return false;}
  if(i.testStart && i.testEnd && i.testStart>i.testEnd){showError('La fin du test doit suivre son début.');return false;}
  if(i.kameleoonUrl.trim() && !safeURL(i.kameleoonUrl)){showError('Le lien de l’outil A/B doit être une URL HTTP ou HTTPS valide.');return false;}
  return true;
}
function saveObservation() {
  let uplift;
  try {
    const inputs = captureInputs();
    const measures = VARIANT_MEASURES[inputs.metricType] || [];
    const required = measures.length > 0 && (inputs.upliftEntryMode === 'direct' || measures.some(measure => inputs[measure.id + 'A'].trim()));
    uplift = measureTestUplift(inputs, required);
  } catch (error) {
    showError(error.message);
    return;
  }
  if(!$('testTitle').value.trim())$('testTitle').value=`Test ${OUTCOMES[$('testOutcome').value].toLowerCase()}`;
  lastProjection=[];renderObservation({kind:'observation',uplift});
}
function renderObservation(data,save=true,projectionUnavailable=false) {
  showDashboard();lastResult={...data};lastInputs=captureInputs();lastProjection=[];
  $('results').classList.add('hidden');const panel=$('kpiResults');panel.classList.remove('hidden');panel.replaceChildren();
  addOutcomeDetail(panel,lastInputs);
  const title=document.createElement('h2');title.textContent=lastInputs.testTitle || 'Résultat du test';panel.append(title);
  const explanation=document.createElement('p');
  explanation.textContent = projectionUnavailable ? 'Projection indisponible. Vérifie l’historique de CA et la date de mise en production.' : 'Aucun gain CA extrapolé : seuls les tests gagnants déployés sur la base d’un CA fiable sont concernés.';
  panel.append(explanation);
  const observed=document.createElement('p');observed.textContent=Number.isFinite(data.uplift)?observedMetricText(lastInputs, data):'Résultat enregistré sans mesure chiffrée exploitable.';panel.append(observed);

  renderResultVisuals(lastInputs,panel);
  showVariantComparison(panel, lastInputs, data);
  renderTestComment(panel,lastInputs);
  if (!projectionUnavailable) {
    const pdf=document.createElement('button');pdf.type='button';pdf.className='secondary-btn';pdf.textContent='Exporter la synthèse PDF';pdf.addEventListener('click',exportObservationPDF);panel.append(pdf);
  }
  const link=document.createElement('a');link.href='#savedTestsList';link.textContent='Voir les tests enregistrés ↓';panel.append(link);
  if(save)saveCurrentTest().catch(error=>showError(error.message));panel.scrollIntoView({behavior:'smooth',block:'start'});
}
['testOutcome','testDecision'].forEach(id=>$(id).addEventListener('change',()=>{updateMetricFields();hideError();}));
