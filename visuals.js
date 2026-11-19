function visualSource(value) {
  if(!value?.trim()) return null;
  const url=new URL(value.trim());
  if(url.protocol!=='https:' || url.username || url.password || url.href.length>2000) throw Error('Utilise un lien HTTPS valide pour chaque visuel.');
  if(url.hostname==='drive.google.com') {
    const id=url.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] || url.searchParams.get('id');
    if(!id || !/^[\w-]+$/.test(id)) throw Error('Le lien Drive doit pointer vers un fichier image, pas un dossier.');
    const key=url.searchParams.get('resourcekey');
    const thumbnail=new URL('https://drive.google.com/thumbnail');thumbnail.searchParams.set('id',id);thumbnail.searchParams.set('sz','w1000');
    if(key)thumbnail.searchParams.set('resourcekey',key);
    const large=new URL(thumbnail);large.searchParams.set('sz','w2400');
    const raw=new URL('https://lh3.googleusercontent.com/d/'+id);if(key)raw.searchParams.set('resourcekey',key);
    const preview=new URL('https://drive.google.com/file/d/'+id+'/preview');if(key)preview.searchParams.set('resourcekey',key);
    return {url:url.href,thumbnail:raw.href,fallback:thumbnail.href,large:raw.href,preview:preview.href};
  }
  return {url:url.href,thumbnail:url.href,large:url.href};
}
function validateVisualInputs() {
  const versions = [0, ...variantNumbers(captureInputs())];
  for (const number of versions) {
    try {
      visualLinks($(VISUAL_FIELDS[number]).value).forEach(visualSource);
    } catch (error) {
      showError(`${variantLabel(number)} · ${error.message}`);
      return false;
    }
  }
  return true;
}
function visualLinks(value){return String(value || '').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);}
function visualEntries(inputs) {
  return [0, ...variantNumbers(inputs)].map(number => {
    const links = visualLinks(inputs[VISUAL_FIELDS[number]]);
    const sources = [];
    for (const link of links) {
      try { sources.push(visualSource(link)); } catch { /* Older entries may contain an invalid URL. */ }
    }
    return { label: variantLabel(number), sources, hasLinks: links.length > 0 };
  });
}

function visualFigure({ label, sources, hasLinks }) {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(caption);
  const source = sources[0];
  if (!source) {
    const empty = document.createElement('p');
    empty.className = 'visual-empty';
    empty.textContent = hasLinks ? 'Lien invalide' : 'Non renseigné';
    figure.append(empty);
    return figure;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'visual-thumbnail';
  button.setAttribute('aria-label', `Agrandir : ${label}`);
  const img = document.createElement('img');
  img.alt = label;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  const message = document.createElement('span');
  message.className = 'visual-message';
  message.textContent = 'Chargement…';
  img.addEventListener('load', () => {
    message.textContent = sources.length > 1 ? `Voir les ${sources.length} aperçus` : 'Cliquer pour agrandir';
  });
  img.addEventListener('error', () => {
    if (source.fallback && img.src !== source.fallback) {
      img.src = source.fallback;
      return;
    }
    img.hidden = true;
    message.textContent = 'Aperçu indisponible. Clique pour vérifier le fichier et son partage.';
  });
  img.src = source.thumbnail;
  button.append(img, message);
  button.addEventListener('click', () => openVisual(sources, label));
  figure.append(button);
  return figure;
}

function visualComparison(inputs) {
  const entries = visualEntries(inputs);
  if (!entries.some(entry => entry.hasLinks)) return null;
  const grid = document.createElement('div');
  grid.className = 'visual-comparison';
  grid.setAttribute('aria-label', 'Aperçus des versions');
  grid.append(...entries.slice(0, 2).map(visualFigure));
  const extra = entries.slice(2).filter(entry => entry.hasLinks);
  if (extra.length) {
    const details = document.createElement('details');
    details.className = 'visual-disclosure';
    const summary = document.createElement('summary');
    const more = document.createElement('span');
    more.className = 'visual-more';
    more.textContent = `+${extra.length} ${extra.length === 1 ? 'variante' : 'variantes'}`;
    const less = document.createElement('span');
    less.className = 'visual-less';
    less.textContent = 'Masquer les variantes';
    summary.append(more, less);
    const extraGrid = document.createElement('div');
    extraGrid.className = 'visual-comparison';
    extraGrid.append(...extra.map(visualFigure));
    details.append(summary, extraGrid);
    grid.append(details);
  }
  return grid;
}
function renderResultVisuals(inputs,container) {
  container.querySelector('.result-visuals')?.remove();
  const comparison=visualComparison(inputs);if(!comparison)return;
  const section=document.createElement('section');section.className='result-visuals card';section.append(comparison);
  insertTestDetail(container, section);
}
let visualGallery=[],visualIndex=0,visualGalleryLabel='';
function showGalleryItem(){
  const source=visualGallery[visualIndex],content=$('visualDialogContent');content.replaceChildren();
  $('visualDialogTitle').textContent=visualGalleryLabel;
  $('visualPosition').textContent=`${visualIndex+1} / ${visualGallery.length}`;
  $('previousVisual').disabled=visualIndex===0;$('nextVisual').disabled=visualIndex===visualGallery.length-1;
  if(source.preview){
    const frame=document.createElement('iframe');frame.src=source.preview;frame.title=`${visualGalleryLabel} — aperçu ${visualIndex+1}`;frame.allow='autoplay; fullscreen';frame.referrerPolicy='no-referrer';content.append(frame);
  }else{
    const img=document.createElement('img');img.alt=`${visualGalleryLabel} — aperçu ${visualIndex+1}`;img.referrerPolicy='no-referrer';
    const status=document.createElement('p');status.textContent='Chargement de l’aperçu…';
    img.onload=()=>{status.textContent='';};img.onerror=()=>{img.hidden=true;status.textContent='Impossible de charger cet aperçu. Vérifie le lien et ses droits d’accès.';};
    img.src=source.large;content.append(img,status);
  }
  $('visualSourceLink').href=source.url;
}
function openVisual(sources,label){visualGallery=Array.isArray(sources)?sources:[sources];visualIndex=0;visualGalleryLabel=label;showGalleryItem();$('visualDialog').showModal();}
$('previousVisual').addEventListener('click',()=>{if(visualIndex>0){visualIndex--;showGalleryItem();}});
$('nextVisual').addEventListener('click',()=>{if(visualIndex<visualGallery.length-1){visualIndex++;showGalleryItem();}});
$('closeVisual').addEventListener('click',()=>$('visualDialog').close());
$('visualDialog').addEventListener('click',event=>{if(event.target===$('visualDialog'))$('visualDialog').close();});
$('visualDialog').addEventListener('close',()=>{$('visualDialogContent').replaceChildren();visualGallery=[];});
$('visualDialog').addEventListener('keydown',event=>{if(event.target.tagName==='IFRAME')return;if(event.key==='ArrowRight' && visualIndex<visualGallery.length-1){event.preventDefault();visualIndex++;showGalleryItem();}if(event.key==='ArrowLeft' && visualIndex>0){event.preventDefault();visualIndex--;showGalleryItem();}});
