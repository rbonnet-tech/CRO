const PAGE_LABELS={pdp:'PDP',plp:'PLP',hp:'HP',side_cart:'Side cart',header:'Header',other:'Autre'};
const DEVICE_LABELS={mobile:'Mobile',desktop:'Desktop',both:'Tous'};
function matchesTargeting(test){
  const page=$('pageFilter').value,device=$('deviceFilter').value;
  return (page==='all'||test.inputs.targetPage===page) && (device==='all'||test.inputs.targetDevice===device||test.inputs.targetDevice==='both');
}
function recentTest(test,months,now=new Date()){
  const raw=test.inputs.testEnd;if(!/^\d{4}-\d{2}-\d{2}$/.test(raw || ''))return false;
  const date=parseDate(raw);if(!date || toInputDate(date)!==raw)return false;
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  return date>addMonths(today,-months) && date<=today;
}
function calculateRecap(tests,months,profile,now=new Date()){
  const eligible=tests.filter(t=>reliableRevenue(t.inputs,t.result));
  const completed = tests.filter(test => recentTest(test, months, now));
  const winning = completed.filter(test => test.inputs.testOutcome === 'won').length;
  const recent = completed.filter(test => reliableRevenue(test.inputs, test.result));
  let ht = 0, ttc = 0, missing = 0;
  for(const test of recent){
    try{const data=projectSavedTest(test,months,profile);const vat=Number(test.inputs.vatRate)/100,rb=Number(test.inputs.rbRate)/100;
      if(!data || !Number.isFinite(data.result.centralTotal)|| !Number.isFinite(vat)|| !Number.isFinite(rb)|| vat<0|| rb<0|| rb>=1)throw Error();
      ht+=data.result.centralTotal;ttc+=data.result.centralTotal*(1+vat)/(1-rb);
    }catch{missing++;}
  }
  return {ht,ttc,count:recent.length,launched:completed.length,winning,missing,undated:eligible.filter(t=>!t.inputs.testEnd || !parseDate(t.inputs.testEnd)).length};
}
function renderGainRecap(tests){
  const months=dashboardMonths(),recap=calculateRecap(tests,months,historicalData.length?buildSeasonalityProfile():null);
  $('recapTitle').textContent=`Gains CA totaux projetés sur ${months} mois`;
  $('recapHT').textContent=recap.missing?'—':signedMoney(recap.ht);
  $('recapTTC').textContent=recap.missing?'—':signedMoney(recap.ttc);
  const winnerLabel = recap.winning > 1 ? 'tests gagnants' : 'test gagnant';
  const launchedLabel = recap.launched > 1 ? 'lancés' : 'lancé';
  const ratio = `${recap.winning} ${winnerLabel} sur ${recap.launched} ${launchedLabel}`;
  const cohort = `Tests terminés il y a moins de ${months} mois, selon les filtres sélectionnés.`;
  const gains = `Cumul des projections de CA fiable (${recap.count} ${recap.count > 1 ? 'tests' : 'test'}), scénario ${scenarioName()} sur ${months} mois à partir de chaque mise en production.`;
  const undated = recap.undated ? ` ${recap.undated} test(s) sans date de fin valide exclus du total.` : '';
  const missing = recap.missing ? ' Cumul indisponible pour cette sélection.' : '';
  $('recapNote').textContent = `${ratio}. ${cohort} ${gains}${undated}${missing}`;
}
function testSortDate(test) {
  return [test.inputs.testEnd, test.inputs.testStart].find(value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const parsed = parseDate(value);
    return parsed && toInputDate(parsed) === value;
  }) || '';
}

function compareSavedTests(a, b, order) {
  if (order === 'recent' || order === 'oldest') {
    const first = testSortDate(a);
    const second = testSortDate(b);
    if (first !== second) {
      if (!first) return 1;
      if (!second) return -1;
      return order === 'recent' ? second.localeCompare(first) : first.localeCompare(second);
    }
  } else {
    const rank = testCategory(a).rank - testCategory(b).rank;
    if (rank) return rank;
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

const filterBar=document.querySelector('.header-filters');
const mobileFilters=window.matchMedia('(max-width:750px)');
function placeFilterBar(){
  (mobileFilters.matches?$('mobileFilterSlot'):$('desktopFilterSlot')).append(filterBar);
}
placeFilterBar();mobileFilters.addEventListener('change',placeFilterBar);
$('openFilters').addEventListener('click',()=>$('filtersDialog').showModal());
['closeFilters','applyFilters'].forEach(id=>$(id).addEventListener('click',()=>$('filtersDialog').close()));
$('filtersDialog').addEventListener('click',e=>{if(e.target===$('filtersDialog'))$('filtersDialog').close();});
function updateTargetFilters(){hideError();$('results').classList.add('hidden');$('kpiResults').classList.add('hidden');renderSavedTests().catch(e=>showError(e.message));}
['pageFilter','deviceFilter'].forEach(id=>$(id).addEventListener('change',updateTargetFilters));
$('testSort').addEventListener('change', () => renderSavedTests().catch(error => showError(error.message)));
$('resetFilters').addEventListener('click',()=>{$('pageFilter').value='all';$('deviceFilter').value='all';$('decisionFilter').value='all';$('dashboardMonths').value='12';$('scenarioFilter').value='central';$('testSort').value='priority';updateTargetFilters();});
