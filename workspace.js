let pageWorkspaceId=null;
let workspaceBrand={name:'',logo:'',website:'',tool:'',erp:''};
let brandLogoVersion=0;
const brandTextSlots=[];
function toolName(){return workspaceBrand.tool || 'de l’outil A/B';}
function erpName(){return workspaceBrand.erp || 'ERP';}
function httpsURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function initializeBrandSlots(){
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode())if(!['SCRIPT','STYLE','TEXTAREA'].includes(node.parentElement?.tagName) && !node.parentElement?.closest('#workspaceSetup,#sheetConfigDialog') && /\bERP\b|outil A\/B/.test(node.textContent))brandTextSlots.push({node,text:node.textContent});
}
function applyBrand(brand={}){
  workspaceBrand={name:'',logo:'',website:'',tool:'',erp:'',...brand};
  for(const slot of brandTextSlots)slot.node.textContent=slot.text.replace(/\bERP\b/g,erpName()).replace(/de l’outil A\/B/g,workspaceBrand.tool ? 'de '+workspaceBrand.tool : 'de l’outil A/B').replace(/outil A\/B/g,workspaceBrand.tool || 'outil A/B');
  $('workspaceName').textContent=workspaceBrand.name;
  const link=document.querySelector('.saas-brand');link.href=httpsURL(workspaceBrand.website)||'#';
  if(httpsURL(workspaceBrand.website)){link.target='_blank';link.rel='noopener noreferrer';}else link.removeAttribute('target');
  const logo=$('workspaceLogo'),version=++brandLogoVersion;
  logo.onload=null;logo.onerror=null;logo.classList.remove('is-brand');logo.hidden=false;logo.src='favicon.svg';logo.alt='Logo de l’espace';
  if(httpsURL(workspaceBrand.logo)){
    let source;try{source=visualSource(workspaceBrand.logo);}catch{}
    if(source){
      logo.onload=()=>{if(version===brandLogoVersion)logo.classList.add('is-brand');};
      logo.onerror=()=>{
        if(version!==brandLogoVersion)return;
        if(source.fallback && logo.src!==source.fallback){logo.src=source.fallback;return;}
        logo.onload=null;logo.onerror=null;logo.classList.remove('is-brand');logo.src='favicon.svg';logo.alt='Logo de l’espace';
      };
      logo.alt=workspaceBrand.name || 'Logo de la marque';logo.referrerPolicy='no-referrer';logo.src=source.thumbnail;
    }
  }
}
function parseRevenueValues(values){
  if(!Array.isArray(values)||!values.length)throw Error('Aucun CA dans la première feuille. Ajoute les colonnes A : date et B : ca_ht_post_rb.');
  if(normalizeHeader(values[0]?.[0])!=='date' || normalizeHeader(values[0]?.[1])!=='cahtpostrb')throw Error('La première feuille doit commencer par A1 : date et B1 : ca_ht_post_rb.');
  const rows=[];
  for(const [index,row] of values.slice(1).entries()){
    if((row[0]===undefined||row[0]==='')&&(row[1]===undefined||row[1]===''))continue;
    let date;if(typeof row[0]==='number'){const serial=new Date(Math.round((row[0]-25569)*86400000));date=createSafeDate(serial.getUTCFullYear(),serial.getUTCMonth(),serial.getUTCDate());}else date=parseDate(row[0]);
    const revenue=parseNumber(row[1]);if(!date || row[1]==='' || row[1]===undefined || !Number.isFinite(revenue))throw Error(`Ligne ${index+2} : renseigne une date et un CA numérique valides.`);
    rows.push({date,revenue});
  }
  if(!rows.length)throw Error('Aucun CA renseigné : complète la colonne A et la colonne B à partir de la ligne 2.');
  rows.sort((a,b)=>a.date-b.date);if(new Set(rows.map(r=>toInputDate(r.date))).size!==rows.length)throw Error('Une date apparaît plusieurs fois dans la source de CA.');return rows;
}
function resetCalculationView(){
  historicalData=[];lastResult=null;lastInputs=null;lastProjection=[];editingTestId=null;
  $('results').classList.add('hidden');$('results').querySelector('.test-comment')?.remove();$('kpiResults').replaceChildren();$('kpiResults').classList.add('hidden');$('savedTestsList').replaceChildren();
  $('results').querySelector('.result-visuals')?.remove();$('results').querySelector('.variant-comparison')?.remove();$('resultTestTitle').textContent='—';$('resultTestToolLink').removeAttribute('href');$('resultTestToolLink').textContent='Lien non renseigné';$('resultTable').replaceChildren();$('methodologyText').textContent='';
  const canvas=$('revenueChart');canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
  $('dashboardStatus').textContent='Connecte-toi pour charger les données de ton espace.';
  $('fileStatus').textContent='';$('fileStatus').classList.add('hidden');$('storedDataInfo').classList.add('hidden');$('storedDataText').textContent='';$('localImportStatus').textContent='';
  for(const id of INPUT_IDS){const field=$(id);if(!field)continue;field.value=field.tagName==='SELECT'?(Array.from(field.options).find(o=>o.defaultSelected)||field.options[0]).value:field.defaultValue;}
  $('variantCount').value = '1';
  $('kpiInputs').value = '[]';
  restoreKpiRows();updateMetricFields();showConfiguration();hideError();$('globalError').textContent='';$('errorMessage').textContent='';
}
window.clearWorkspaceView=()=>{pageWorkspaceId=null;resetCalculationView();applyBrand();$('sheetStatus').textContent='Aucun historique chargé. Connecte-toi ou importe un CSV.';updateWorkspaceUI(0);$('savedTestsList').textContent='Connecte-toi à Google pour retrouver tes tests et commencer à en enregistrer.';};
window.onWorkspaceConnected=()=>{showDashboard();window.scrollTo?.({top:0,behavior:'smooth'});};
window.applyWorkspace=async config=>{
  applyBrand(config.brand);let problem='';
  try{historicalData=parseRevenueValues(config.values);}catch(error){historicalData=[];problem=error.message;}
  $('activeSheetLink').href=`https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`;
  $('sheetStatus').textContent=problem || `${erpName()} · ${historicalData.length} jours de CA synchronisés.`;
  $('localImportStatus').textContent='';lastResult=null;lastInputs=null;lastProjection=[];editingTestId=null;$('results').classList.add('hidden');$('kpiResults').classList.add('hidden');
  updateWorkspaceUI();
  if(pageWorkspaceId!==config.sheetId){pageWorkspaceId=config.sheetId;showDashboard();}
};
function updateWorkspaceUI(count){
  const connected=!!window.sharedTests?.connected(),authorized=!!window.sharedTests?.authorized();
  if(count!==undefined)updateWorkspaceUI.testCount=count;
  const total=updateWorkspaceUI.testCount || 0;
  $('connectionInvite').classList.toggle('hidden',connected);
  $('workspaceSetup').classList.toggle('hidden',connected && total>0);
  $('setupTitle').textContent=connected?'Pas encore de tests enregistrés : voici la configuration':'Pas encore de tests enregistrés ? Configure ton espace';
  $('gainRecap').classList.toggle('hidden',!connected);
  document.querySelectorAll('[data-connected-only]').forEach(e=>e.classList.toggle('hidden',!connected));
  $('dashboardRefreshERP').classList.toggle('hidden',!connected);
  $('newTestBtn').setAttribute('data-needs-login',String(!connected));
  $('localRevenueInput').disabled=connected;
  if(!connected && !authorized)$('connectionInvite').querySelector('h2').textContent='Connecte-toi pour commencer à enregistrer tes tests';
  else if(!connected)$('connectionInvite').querySelector('h2').textContent='Compte Google connecté : configure ton classeur';
}
function parseCSVRevenue(text){
  const first=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0];const delimiter=first.includes(';')?';':first.includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(ch===delimiter||ch==='\n'||ch==='\r')){row.push(cell);cell='';if(ch!==delimiter){if(ch==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}}else cell+=ch;}
  if(quoted)throw Error('Le CSV contient des guillemets non refermés.');if(cell||row.length){row.push(cell);rows.push(row);}if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');return parseRevenueValues(rows);
}
$('localRevenueInput').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file || window.sharedTests?.connected())return;
  try{if(file.size>5*1024*1024)throw Error('Le CSV doit faire moins de 5 Mo.');const rows=parseCSVRevenue(await file.text());historicalData=rows;$('localImportStatus').textContent=`${rows.length} jours importés sur cet appareil. Connecte-toi pour configurer ton espace et enregistrer des tests.`;}catch(error){showError(error.message);}finally{event.target.value='';}
});
$('configureSheet').addEventListener('click',()=>{$('sheetConfigStatus').textContent='';$('sheetConfigDialog').showModal();});
$('closeSheetConfig').addEventListener('click',()=>$('sheetConfigDialog').close());
$('useCustomSheet').addEventListener('click',async()=>{
  $('useCustomSheet').disabled=true;try{await window.sharedTests.useSheet($('customSheetUrl').value.trim());$('sheetConfigDialog').close();}catch(error){$('sheetConfigStatus').textContent=error.message;}finally{$('useCustomSheet').disabled=false;}
});
initializeBrandSlots();applyBrand();updateWorkspaceUI(0);showConfiguration();
