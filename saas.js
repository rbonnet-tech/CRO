function updateUpliftEntry() {
  const allowed=metricType.value!=='observation', direct=allowed&&$('upliftEntryMode').value==='direct';
  $('upliftEntryFields').classList.toggle('hidden',!allowed);
  $('directUpliftField').classList.toggle('hidden',!direct || metricType.value==='kpi');
  document.querySelectorAll('.kpi-row').forEach(row=>{row.querySelector('.kpi-a').closest('label').classList.toggle('hidden',direct);row.querySelector('.kpi-b').closest('label').classList.toggle('hidden',direct);row.querySelector('.kpi-uplift').closest('label').classList.toggle('hidden',!direct);});
  if(metricType.value==='kpi')syncKpiInputs();
  if(direct) ['conversionFields','basketFields','directFields'].forEach(id=>$(id).classList.add('hidden'));
  updateVariantFields();
}
function scenarioName(){return {central:'central',low:'prudent',high:'haut'}[$('scenarioFilter')?.value] || 'central';}
function scenarioFactor(result){const key=$('scenarioFilter')?.value || 'central';return key==='low'?result.lowFactor:key==='high'?result.highFactor:result.referenceCentralFactor ?? result.centralFactor;}
function scenarioView(result,projection){
  const key=$('scenarioFilter')?.value || 'central', baseFactor=result.referenceCentralFactor ?? result.centralFactor;
  // Preserve the original central scenario so changing the view never edits saved assumptions.
  const factor=scenarioFactor(result),total=key==='low'?result.lowTotal:key==='high'?result.highTotal:result.baselineTotal*result.affectedShare*result.uplift*baseFactor;
  return {result:{...result,referenceCentralFactor:baseFactor,centralFactor:factor,centralTotal:total},projection:projection.map(r=>({...r,central:key==='low'?r.low:key==='high'?r.high:r.baseline*result.affectedShare*result.uplift*baseFactor}))};
}
function matchesDecision(test){const choice=$('decisionFilter')?.value || 'all',d=test.inputs.testDecision;return choice==='all' || (choice==='not_deployed'?d==='not_deployed':['revenue','unreliable','deployed'].includes(d));}
$('upliftEntryMode').addEventListener('change',updateMetricFields);
$('scenarioFilter').addEventListener('change',()=>refreshDashboardView().catch(e=>showError(e.message)));
$('decisionFilter').addEventListener('change',()=>{hideError();$('results').classList.add('hidden');$('kpiResults').classList.add('hidden');renderSavedTests().catch(e=>showError(e.message));});
