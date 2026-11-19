// Shared daily projection: dashboard and calculator use identical seasonality and growth.
function projectRevenue(startDate, months, params, seasonalProfile) {
  if (!(startDate instanceof Date) || !Number.isFinite(startDate.getTime())) throw Error('Date de mise en production manquante ou invalide.');
  const {uplift,affectedShare,annualGrowth,lowFactor,centralFactor,highFactor}=params;
  const endDate=addMonths(startDate,months);endDate.setDate(endDate.getDate()-1);
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

  const projection =
    Object.values(
      monthlyMap
    ).sort(
      (a, b) =>
        a.date -
        b.date
    );

  return {projection,result:{...params,months,baselineTotal,lowTotal,centralTotal,highTotal,addressableErpTotal:baselineTotal*affectedShare}};
}
function dashboardMonths() {
  const months=Number($('dashboardMonths').value);
  return [3,6,12].includes(months) ? months : 12;
}
function projectSavedTest(test, months, profile) {
  if(!reliableRevenue(test.inputs || {},test.result)) return null;
  if(!profile) throw Error('La base ERP est indisponible.');
  if(!test.inputs.rolloutDate) throw Error('Date de mise en production manquante.');
  const base={...test.result,centralFactor:test.result.referenceCentralFactor ?? test.result.centralFactor};
  const calculated=projectRevenue(new Date(test.inputs.rolloutDate+'T12:00:00'),months,base,profile);
  return scenarioView(calculated.result,calculated.projection);
}
let activeAppPage='configuration';
function selectAppPage(page){
  activeAppPage=page;
  $('resultsFiltersBar').classList.toggle('hidden',page!=='results');
  if(page!=='results' && $('filtersDialog').open)$('filtersDialog').close();
  for(const [name,panel,tab] of [['results','resultsDashboard','resultsTab'],['new','testEditor','newTestBtn'],['configuration','configurationPage','configurationTab']]){
    $(panel).classList.toggle('hidden',name!==page);$(tab).className='nav-page';
    if(name===page)$(tab).setAttribute('aria-current','page');else $(tab).removeAttribute('aria-current');
  }
}
function showDashboard(){selectAppPage('results');}
function showConfiguration(){hideError();selectAppPage('configuration');}
function showTestEditor(fresh=true) {
  if(!window.sharedTests?.connected()){showConfiguration();showError('Connecte-toi à Google pour commencer à enregistrer tes tests.');$('cloudConnect').focus();return;}
  hideError();
  if(fresh) {
    editingTestId=null;
    for(const id of INPUT_IDS) {const field=$(id);if(!field)continue;field.value=field.tagName==='SELECT' ? (id==='metricType'?'conversion':id==='projectionMonths'?'12':field.options[0].value) : field.defaultValue;}
    $('variantCount').value = '1';
    $('kpiInputs').value = '[]';
    $('projectionMonths').value=String(dashboardMonths());
    restoreKpiRows();updateMetricFields();updateEligibilityPreview();
  }
  if(!fresh) $('projectionMonths').value=String(dashboardMonths());
  lastResult=null;lastProjection=[];lastInputs=null;
  selectAppPage('new');
  $('testEditor').scrollIntoView({behavior:'smooth',block:'start'});
  $('testTitle').focus({preventScroll:true});
}
$('newTestBtn').addEventListener('click',event=>{event.preventDefault();showTestEditor(true);});
function returnToDashboard() {
  hideError();showDashboard();$('results').classList.add('hidden');$('kpiResults').classList.add('hidden');
  renderSavedTests().catch(error=>showError(error.message));
}
$('resultsTab').addEventListener('click',event=>{event.preventDefault();returnToDashboard();});
$('configurationTab').addEventListener('click',event=>{event.preventDefault();showConfiguration();});
$('backToResults').addEventListener('click',returnToDashboard);
async function refreshDashboardView(){
  hideError();
  // Recompute any open detail without saving or modifying the original test.
  if(activeAppPage==='results' && lastResult && lastResult.kind!=='kpi' && !$('results').classList.contains('hidden')) {
    try {
      const calculated=projectSavedTest({result:lastResult,inputs:lastInputs},dashboardMonths(),historicalData.length?buildSeasonalityProfile():null);
      $('projectionMonths').value=String(dashboardMonths());lastProjection=calculated.projection;
      renderResults(calculated.result,false);
    } catch(error) { $('results').classList.add('hidden');showError(error.message); }
  }
  await renderSavedTests();
}
$('dashboardMonths').addEventListener('change',refreshDashboardView);

$('dashboardRefreshERP').addEventListener('click',async()=>{ $('dashboardRefreshERP').disabled=true;try{await refreshSheetData();}finally{$('dashboardRefreshERP').disabled=false;} });
