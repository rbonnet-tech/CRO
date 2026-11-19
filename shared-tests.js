// Tokens remain in memory; Google enforces the signed-in user's Sheet permissions.
(() => {
  const CLIENT_ID = '581746742777-05ekvjkfglp9qi943693lb5p497gr7h4.apps.googleusercontent.com';
  const DEFAULT_SHEET_ID = '15ZGqjVFfMzZq2TzD0H42QTAzacAhvwVdzuA7yc4cXYQ';
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const MARKER = 'AB_TEST_REVENUE_V1';
  let SHEET_ID=DEFAULT_SHEET_ID;try{const stored=localStorage.getItem('ab-calculator-sheet');if(/^[\w-]{20,150}$/.test(stored || ''))SHEET_ID=stored;}catch{}
  let ready=false,sourceSheetId=null,workspace=null,expiryTimer,epoch=0;
  const root=()=>`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
  let token = '', expires = 0, client, busy = false;
  let tests = [];
  const el = id => document.getElementById(id);
  const status = text => {el('cloudStatus').textContent = text;};
  const authorized = () => !!token && Date.now() < expires;
  const connected = () => authorized() && ready;
  function clearWorkspace(){epoch++;ready=false;workspace=null;tests=[];window.clearWorkspaceView?.();}
  function disconnect(){token='';expires=0;clearTimeout(expiryTimer);clearWorkspace();controls();status('Connecte-toi à Google pour retrouver ton espace et enregistrer tes tests.');}
  const controls = () => {
    el('cloudConnect').replaceChildren();
    if(!authorized()){const logo=document.createElement('img');logo.src='https://upload.wikimedia.org/wikipedia/commons/3/3c/Google_Favicon_2025.svg';logo.alt='';logo.referrerPolicy='no-referrer';logo.width=18;logo.height=18;el('cloudConnect').append(logo);}
    el('cloudConnect').append(document.createTextNode(authorized()?'Changer de compte Google':'Se connecter à Google'));
    window.updateWorkspaceUI?.();
    el('cloudRefresh').disabled = !authorized() || busy;
    el('cloudDisconnect').hidden = !token;
  };
  async function api(path = '', options = {}) {
    if (!authorized()) throw Error('Connecte-toi à Google pour accéder à ton classeur.');
    const response = await fetch(root() + path, {...options, headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    if (!response.ok) {
      if (response.status === 401) {disconnect();throw Error('Connexion Google expirée. Reconnecte-toi ; le test reste disponible localement.');}
      if (response.status === 403 || response.status === 404) throw Error('Ce classeur est inaccessible à ton compte. Utilise ton propre Google Sheet dans la configuration ci-dessous ; un accès éditeur est nécessaire pour sauvegarder.');
      if (response.status === 429) throw Error('Trop de requêtes Google. Réessaie dans une minute.');
      throw Error(`Google Sheets n’a pas confirmé l’opération (${response.status}). Actualise avant de réessayer.`);
    }
    return response.json();
  }
  const quote = title => "'" + title.replace(/'/g,"''") + "'";
  function validate(test) {
    if (!test || typeof test.id !== 'string' || !test.inputs || typeof test.inputs.testTitle !== 'string' || !test.result || !Array.isArray(test.projection) || test.projection.length>25 || !Number.isFinite(Date.parse(test.updatedAt))) return false;
    if (Object.values(test.inputs).some(v=>typeof v!=='string')) return false;
    if (test.inputs.variantCount && !['1','2','3'].includes(test.inputs.variantCount)) return false;
    if (test.inputs.retainedVariant && !['1','2','3'].includes(test.inputs.retainedVariant)) return false;
    if (Number(test.inputs.retainedVariant || 1) > Number(test.inputs.variantCount || 1)) return false;
    if(test.inputs.testOutcome || test.inputs.testDecision) {
      if(!['won','promising','mixed','lost'].includes(test.inputs.testOutcome) || !['revenue','unreliable','deployed','not_deployed'].includes(test.inputs.testDecision))return false;
      if(test.inputs.testOutcome==='lost' && test.inputs.testDecision!=='not_deployed')return false;
      if(test.inputs.testDecision==='revenue' && (test.inputs.testOutcome!=='won' || ['kpi','observation'].includes(test.result.kind)))return false;
    }
    if(test.result.kind === 'observation') return test.projection.length===0 && (test.result.uplift===null || Number.isFinite(test.result.uplift)) && ['won','promising','mixed','lost'].includes(test.inputs.testOutcome) && ['revenue','unreliable','deployed','not_deployed'].includes(test.inputs.testDecision) && test.inputs.testDecision!=='revenue';
    if(test.result.kind === 'kpi') {
      const r=test.result;
      if(test.inputs.metricType !== 'kpi' || !Number.isFinite(r.eligibleTrafficShare) || r.eligibleTrafficShare<0 || r.eligibleTrafficShare>1 || !Array.isArray(r.kpis) || !r.kpis.length || r.kpis.length>20 || test.projection.length) return false;
      let inputs;try{inputs=JSON.parse(test.inputs.kpiInputs);}catch{return false;}
      if(!Array.isArray(inputs) || inputs.length!==r.kpis.length || inputs.some(k=>!k || !['Page produit consultée','Page collection consultée','Ajout au panier','Autre'].includes(k.type) || typeof k.a!=='string' || typeof k.b!=='string' || (k.type==='Autre' && typeof k.name!=='string'))) return false;
      return r.kpis.every(k=>k.entryMode==='direct' ? typeof k.name==='string' && k.name.trim() && k.name.length<=100 && k.a===null && k.b===null && k.globalPoints===null && Number.isFinite(k.uplift) && k.uplift>=-1 && Number.isFinite(k.globalUplift) && Math.abs(k.globalUplift-k.uplift*r.eligibleTrafficShare)<1e-9 : typeof k.name==='string' && k.name.trim() && k.name.length<=100 && [k.a,k.b,k.globalPoints].every(Number.isFinite) && k.a>=0 && k.a<=100 && k.b>=0 && k.b<=100 && Math.abs(k.globalPoints-(k.b-k.a)*r.eligibleTrafficShare)<1e-9 && (k.a===0 ? k.uplift===null && k.globalUplift===null : Number.isFinite(k.uplift) && Number.isFinite(k.globalUplift) && Math.abs(k.uplift-(k.b/k.a-1))<1e-9 && Math.abs(k.globalUplift-k.uplift*r.eligibleTrafficShare)<1e-9));
    }
    if(!test.projection.length) return false;
    for (const key of ['uplift','affectedShare','centralFactor','months','baselineTotal','centralTotal','lowTotal','highTotal','annualGrowth','lowFactor','highFactor']) if (!Number.isFinite(test.result[key])) return false;
    if (![3,6,12,18,24].includes(test.result.months) || test.result.affectedShare<0 || test.result.affectedShare>1) return false;
    if (Object.values(test.inputs).some(v=>typeof v!=='string')) return false;
    return test.projection.every(row=>Number.isFinite(Date.parse(row.date)) && ['baseline','central','low','high'].every(k=>Number.isFinite(row[k])));
  }
  async function properties() {
    const response = await api('?fields=sheets.properties');
    return (response.sheets || []).map(s=>s.properties);
  }
  async function readTests() {
    const sheets = (await properties()).filter(s=>s.sheetId!==sourceSheetId && s.title.startsWith('AB - '));
    const result=[];
    for(let i=0;i<sheets.length;i+=50) {
      const chunk=sheets.slice(i,i+50);
      const query=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});
      chunk.forEach(s=>query.append('ranges',quote(s.title)+'!A1:B2'));
      const data=await api('/values:batchGet?'+query);
      (data.valueRanges||[]).forEach((range,index)=>{
        if(range.values?.[0]?.[0]!==MARKER)return;
        try {const test=JSON.parse(range.values?.[1]?.[1]);if(validate(test) && range.values[1][0]===test.id) result.push({...test,cloudSheetId:chunk[index].sheetId});}catch{}
      });
    }
    return result;
  }
  async function readWorkspace(){
    const props=(await properties()).sort((a,b)=>(a.index || 0)-(b.index || 0));const first=props[0];
    if(!first)throw Error('Le classeur ne contient aucune feuille.');sourceSheetId=first.sheetId;
    const query=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
    query.append('ranges',quote(first.title)+'!A1:B'+Math.min(first.gridProperties?.rowCount || 1000,10001));query.append('ranges',quote(first.title)+'!E2:E6');
    const response=await api('/values:batchGet?'+query);const ranges=response.valueRanges || [];
    const v=ranges[1]?.values || [];const value=i=>String(v[i]?.[0] ?? '').trim().slice(0,2000);
    return {sheetId:SHEET_ID,sourceSheetId,sourceTitle:first.title,brand:{name:value(0),logo:value(1),website:value(2),tool:value(3),erp:value(4)},values:ranges[0]?.values || []};
  }
  async function refresh() {
    if(busy)return;
    busy=true;const version=epoch;controls();status('Chargement des tests partagés…');
    try {const next=await readWorkspace();const loaded=await readTests();if(version!==epoch || !authorized())throw Error('Synchronisation annulée. Reconnecte-toi pour charger ton espace.');workspace=next;tests=loaded;ready=true;await window.applyWorkspace?.(next);await window.renderSavedTests();status(`${tests.length} test(s) synchronisé(s) avec le classeur actif.`);}
    catch(error){status(error.message);throw error;}
    finally{busy=false;controls();}
  }
  async function save(test) {
    if(busy)throw Error('Une synchronisation est en cours. Le test reste local ; utilise « Enregistrer dans le Sheet » ensuite.');
    if(!connected())throw Error('Connecte-toi à Google pour enregistrer ce test dans le Sheet.');
    if(test.spreadsheetId && test.spreadsheetId!==SHEET_ID)throw Error('Ce test appartient à un autre classeur. Recharge le bon espace.');
    const payload=JSON.parse(JSON.stringify({...test,spreadsheetId:SHEET_ID}));delete payload.cloudSheetId;
    if(!validate(payload))throw Error('Ce test est incomplet et ne peut pas être synchronisé. Recalcule-le.');
    const json=JSON.stringify(payload);if(json.length>45000)throw Error('Ce test dépasse la taille de sauvegarde autorisée.');
    busy=true;controls();status('Enregistrement dans le Sheet…');
    try {
      const remote=await readTests();
      const existing=remote.find(t=>t.id===test.id);
      if(existing && Date.parse(existing.updatedAt)>Date.parse(test.updatedAt))throw Error('Une version plus récente existe dans le Sheet. Actualise et recharge-la avant de la modifier.');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(test.id)))).map(b=>b.toString(16).padStart(2,'0')).join('');
      const title='AB - '+test.inputs.testTitle.replace(/[\\/?*\[\]:]/g,' ').slice(0,45)+' - '+digest.slice(0,16);
      const props=await properties();
      if(!existing && props.some(p=>p.title===title))throw Error('Une feuille portant ce nom existe mais son contenu n’est pas reconnu. Elle n’a pas été modifiée.');
      let sheetId=existing?.cloudSheetId;
      if(sheetId==null){sheetId=parseInt(digest.slice(0,7),16)+1;while(props.some(p=>p.sheetId===sheetId))sheetId++;}
      if(sheetId===sourceSheetId || sheetId===0)throw Error('La feuille source ne peut pas être modifiée.');
      const variantRows = [];
      if (Number(test.inputs.variantCount) > 1) {
        const retained = retainedVariantNumber(test.inputs);
        variantRows.push(['Variante retenue pour la synthèse', variantLabel(retained)]);
        for (const number of variantNumbers(test.inputs)) {
          if (number > 1) variantRows.push([`Aperçus variante ${number}`, test.inputs[VISUAL_FIELDS[number]] || '']);
          if (test.result.kind !== 'kpi') {
            const uplift = number === retained ? test.result.uplift : measureVariantUplift(test.inputs, number);
            variantRows.push([`Uplift variante ${number}`, uplift ?? 'Non renseigné']);
          }
        }
      }
      const rows=(test.result.kind === 'observation' ? [
        [MARKER,'1'],[test.id,json],['Expérience',test.inputs.testTitle],['Mise à jour',test.updatedAt],
        ['Type','Résultat sans extrapolation de CA'],['Uplift observé',test.result.uplift ?? 'Non renseigné'],
        ['Aperçu original',test.inputs.originalVisual || ''],['Aperçu variante',test.inputs.variantVisual || ''],
        ['Début du test',test.inputs.testStart],['Fin du test',test.inputs.testEnd]
      ] : test.result.kind === 'kpi' ? [
        [MARKER,'1'],[test.id,json],['Expérience',test.inputs.testTitle],['Mise à jour',test.updatedAt],
        ['Aperçu original',test.inputs.originalVisual || ''],['Aperçu variante',test.inputs.variantVisual || ''],
        ['Type','KPI du parcours — Aucun gain fiable en CA estimé'],['Part des visiteurs ciblés',test.result.eligibleTrafficShare],
        ['Début du test',test.inputs.testStart],['Fin du test',test.inputs.testEnd],
        ['Méthode','Uplift global relatif estimé = uplift ciblé × part ciblée ; suppose le même taux initial hors cible.'],
        ...test.result.kpis.flatMap(k=>[[k.name,''],['Taux A (%)',k.a ?? 'Non renseigné (uplift direct)'],['Taux B (%)',k.b ?? 'Non renseigné (uplift direct)'],['Uplift ciblé',k.uplift ?? 'Non calculable (A = 0)'],['Uplift global estimé',k.globalUplift ?? 'Non calculable (A = 0)'],['Variation globale (points)',k.globalPoints ?? 'Non calculable sans taux A/B']])
      ] : [
        [MARKER,'1'],[test.id,json],['Expérience',test.inputs.testTitle],['Mise à jour',test.updatedAt],
        ['Aperçu original',test.inputs.originalVisual || ''],['Aperçu variante',test.inputs.variantVisual || ''],
        ['Uplift observé',test.result.uplift],['Part du CA adressable',test.result.affectedShare],
        ['Uplift réel sur le CA total',test.result.uplift*test.result.affectedShare],
        ['Coefficient central',test.result.centralFactor],['Gain central HT post-RB',test.result.centralTotal],
        ['CA de référence ERP HT post-RB',test.result.baselineTotal],['RB (%)',test.inputs.rbRate],
        ['Début du test',test.inputs.testStart],['Fin du test',test.inputs.testEnd],['Mise en production',test.inputs.rolloutDate],
        ['Paramètres et résultats complets','La cellule B2 permet le rechargement dans le calculateur.'],
        ['Mois','CA ERP HT post-RB','Gain prudent','Gain central','Gain haut'],
        ...test.projection.map(r=>[new Date(r.date).toISOString().slice(0,10),r.baseline,r.low,r.central,r.high])
      ]).concat(variantRows,[['Résultat',({won:'Gagnant',promising:'Encourageant',mixed:'Mitigé',lost:'Perdant'})[test.inputs.testOutcome] || 'À qualifier'],['Décision',({revenue:'Déployé sur la base du CA',unreliable:'Déployé sans gain CA fiable',deployed:'Déployé',not_deployed:'Non déployé'})[test.inputs.testDecision] || 'À qualifier'],['Conclusion',test.inputs.testNotes || ''],['Page ciblée',({pdp:'PDP',plp:'PLP',hp:'HP',side_cart:'Side cart',header:'Header',other:'Autre'})[test.inputs.targetPage] || 'Non renseignée'],['Device',({mobile:'Mobile',desktop:'Desktop',both:'Tous'})[test.inputs.targetDevice] || 'Non renseigné']]).map(row=>({values:row.map(value=>({userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')}}))}));
      const requests=[];
      if(!existing)requests.push({addSheet:{properties:{sheetId,title,gridProperties:{rowCount:200,columnCount:5}}}});
      if(existing)requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount:Math.max(200,props.find(p=>p.sheetId===sheetId)?.gridProperties?.rowCount || 200)}},fields:'gridProperties.rowCount'}});
      requests.push({updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:200,startColumnIndex:0,endColumnIndex:5},rows,fields:'userEnteredValue'}});
      requests.push({updateDimensionProperties:{range:{sheetId,dimension:'ROWS',startIndex:0,endIndex:2},properties:{hiddenByUser:true},fields:'hiddenByUser'}});
      await api(':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
      tests=await readTests();
      const saved=tests.find(t=>t.id===payload.id && t.updatedAt===payload.updatedAt);
      if(!saved || ['inputs','result','projection'].some(key=>JSON.stringify(saved[key])!==JSON.stringify(payload[key])))throw Error('Enregistrement envoyé, mais la vérification des données complètes a échoué. Actualise les tests avant de réessayer.');
      status('Test enregistré et vérifié dans le Sheet : liens des aperçus, résultat, décision, conclusion et données de calcul. Disponible sur les autres appareils.');
    } catch(error){status(error.message);throw error;}
    finally{busy=false;controls();await window.renderSavedTests();}
  }
  async function remove(test) {
    if(!connected())throw Error('Connecte-toi au classeur avant de supprimer un test.');
    if(test.spreadsheetId && test.spreadsheetId!==SHEET_ID)throw Error('Ce test appartient à un autre classeur.');
    if(busy)throw Error('Attends la fin de la synchronisation.');
    busy=true;controls();
    try {
      const current=(await readTests()).find(t=>t.id===test.id);
      if(current && current.cloudSheetId!==0 && current.cloudSheetId!==sourceSheetId)await api(':batchUpdate',{method:'POST',body:JSON.stringify({requests:[{deleteSheet:{sheetId:current.cloudSheetId}}]})});
      tests=tests.filter(t=>t.id!==test.id);status('Test supprimé du Sheet.');
    }finally{busy=false;controls();}
  }
  function connect() {
    if(busy)return;
    if(!window.google?.accounts?.oauth2){status('La connexion Google n’est pas chargée. Vérifie ta connexion puis réessaie.');return;}
    disconnect();
    client=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,
      callback:async response=>{
        if(response.error){status('Connexion Google refusée ou annulée. Vérifie les utilisateurs autorisés dans Google Cloud.');return;}
        if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)){status('Autorise l’accès à Google Sheets pour enregistrer les tests.');return;}
        token=response.access_token;expires=Date.now()+Number(response.expires_in)*1000-30000;tests=[];ready=false;clearTimeout(expiryTimer);expiryTimer=setTimeout(disconnect,Math.max(0,expires-Date.now()));controls();
        try{await refresh();if(connected())window.onWorkspaceConnected?.();}catch{}
      },error_callback:()=>status('Fenêtre Google fermée ou bloquée. Autorise les fenêtres de connexion puis réessaie.')});
    client.requestAccessToken({prompt:'select_account'});
  }
  async function useSheet(value){
    if(busy)throw Error('Attends la fin de la synchronisation.');
    const url=new URL(value);if(url.protocol!=='https:' || url.hostname!=='docs.google.com')throw Error('Colle le lien HTTPS de ton Google Sheet.');
    const id=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];if(!id || id.length<20)throw Error('Le lien doit pointer vers un Google Sheet.');
    clearWorkspace();SHEET_ID=id;sourceSheetId=null;try{localStorage.setItem('ab-calculator-sheet',id);}catch{}
    controls();if(authorized())await refresh();else status('Classeur sélectionné. Connecte-toi à Google pour le synchroniser.');
  }
  window.sharedTests={connected,authorized,get sheetId(){return SHEET_ID;},get defaultSheetId(){return DEFAULT_SHEET_ID;},get workspace(){return connected()?workspace:null;},get tests(){return connected()?tests:[];},refresh,useSheet,save,remove,validate};
  document.addEventListener('DOMContentLoaded',()=>{
    el('cloudConnect').addEventListener('click',connect);
    el('cloudRefresh').addEventListener('click',()=>refresh().catch(()=>{}));
    el('cloudDisconnect').addEventListener('click',()=>{if(!busy)disconnect();});
    controls();
  });
})();
