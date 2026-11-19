function previewTestComment(comment) {
  const words = (comment || '').trim().split(/\s+/u);
  const snippet = words.slice(0, 16).join(' ');
  const spaceBeforeLimit = snippet.lastIndexOf(' ', 132);
  const end = snippet.length <= 132 ? snippet.length : Math.max(0, spaceBeforeLimit) || 132;
  const truncated = words.length > 16 || end < snippet.length;
  return snippet.slice(0, end) + (truncated ? '…' : '');
}

function insertTestDetail(container, section) {
  const identity = container.querySelector(':scope > .result-test-info, :scope > h2');
  if (identity) identity.after(section);
  else container.prepend(section);
}

function renderTestComment(container,inputs){
  container.querySelector('.test-comment')?.remove();
  const text=inputs.testNotes?.trim();if(!text)return;
  const section=document.createElement('section');section.className='card test-comment';
  const title=document.createElement('h3');title.textContent='Conclusion du test';
  const body=document.createElement('p');body.textContent=text;section.append(title,body);
  insertTestDetail(container, section);
}
function appendCommentPDF(doc,text,y=24){
  if(!text?.trim())return y;
  const height=doc.internal.pageSize.getHeight(),width=doc.internal.pageSize.getWidth();
  if(y>height-38){doc.addPage();y=24;}
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor('#415954');doc.text('Commentaire',18,y);y+=9;
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor('#15171a');
  const clean=text.trim().replace(/[\u00a0\u202f]/g,' ').replace(/[’]/g,"'");
  for(const line of doc.splitTextToSize(clean,width-36)){
    if(y>height-20){doc.addPage();y=24;}
    doc.text(line,18,y);y+=5;
  }
  return y+8;
}
function exportObservationPDF(event){
  if(!lastResult || lastResult.kind!=='observation' || JSON.stringify(captureInputs())!==JSON.stringify(lastInputs)){showError('Enregistre le test avant de générer son PDF.');return;}
  if(!window.jspdf?.jsPDF){showError('Le module PDF est indisponible. Réessaie après rechargement.');return;}
  const doc=new window.jspdf.jsPDF();doc.setTextColor('#415954');doc.setFontSize(18);
  const title=doc.splitTextToSize(lastInputs.testTitle || 'Résultat du test',174);doc.text(title,18,24);let y=24+title.length*8;
  doc.setFontSize(11);
  const category=testCategory({inputs:lastInputs,result:lastResult});
  for(const text of [`${category.label} - ${category.decision}`,'Aucun gain CA extrapolé',Number.isFinite(lastResult.uplift)?observedMetricText(lastInputs, lastResult).replace(' → ', ' à '):'Sans mesure chiffrée exploitable']){
    const lines=doc.splitTextToSize(text,174);doc.text(lines,18,y);y+=lines.length*6+6;
  }
  appendCommentPDF(doc,lastInputs.testNotes,y+4);
  return downloadTestPDF(doc, lastInputs, 'details-test.pdf', event?.currentTarget);
}
