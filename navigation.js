const pageNavigation=document.querySelector('.dashboard-nav');
const mobileNavigation=window.matchMedia('(max-width:750px)');
function placePageNavigation(){
  if(mobileNavigation.matches)$('mobileNavigationSlot').append(pageNavigation);
  else {if($('navigationDialog').open)$('navigationDialog').close();$('desktopNavigationSlot').append(pageNavigation);}
}
placePageNavigation();mobileNavigation.addEventListener('change',placePageNavigation);
$('openNavigation').addEventListener('click',()=>{$('openNavigation').setAttribute('aria-expanded','true');$('navigationDialog').showModal();});
$('closeNavigation').addEventListener('click',()=>$('navigationDialog').close());
$('navigationDialog').addEventListener('close',()=>$('openNavigation').setAttribute('aria-expanded','false'));
$('navigationDialog').addEventListener('click',event=>{if(event.target===$('navigationDialog'))$('navigationDialog').close();});
pageNavigation.addEventListener('click',event=>{if(event.target.closest('.nav-page') && $('navigationDialog').open)$('navigationDialog').close();},true);
const appHeader=document.querySelector('.saas-header');
function measureAppHeader(){document.documentElement.style.setProperty('--app-header-height',`${appHeader.getBoundingClientRect().height}px`);}
measureAppHeader();
new ResizeObserver(measureAppHeader).observe(appHeader);
