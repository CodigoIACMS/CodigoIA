let CODES=[];
const $=s=>document.querySelector(s);

async function loadCodes(){
  const r=await fetch('data/codes.json?v='+Date.now());
  if(!r.ok)throw new Error('Não foi possível carregar o catálogo.');
  CODES=await r.json();
  return CODES;
}

function esc(s=''){
  return String(s).replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function isValidUrl(value=''){
  try{
    const u=new URL(String(value).trim());
    return u.protocol==='http:'||u.protocol==='https:';
  }catch{
    return false;
  }
}

function resourceUrl(c){
  return isValidUrl(c.url) ? c.url.trim() : '';
}

function itemUrl(c){
  return `item.html?id=${encodeURIComponent(c.id)}`;
}

function resourceButton(c){
  const url=resourceUrl(c);
  if(!url){
    return '<button class="btn disabled" type="button" disabled>URL inválida</button>';
  }
  return `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir</a>`;
}

function card(c){
  return `<article class="card">
    <img class="cover" src="${esc(c.image||'assets/default.svg')}" alt="${esc(c.title)}" loading="lazy">
    <div class="cardbody">
      <div class="eyebrow">${esc(c.category||'IA')} · #${esc(c.id)}</div>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.description||'')}</p>
      <div class="tags">${(c.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="actions">
        <a class="btn secondary" href="${itemUrl(c)}">Detalhes</a>
        ${resourceButton(c)}
      </div>
    </div>
  </article>`;
}

function render(list,host){
  if(!host)return;
  host.innerHTML=list.length
    ? list.map(card).join('')
    : `<div class="empty">Nenhum conteúdo encontrado.</div>`;
}

async function initHome(){
  try{
    await loadCodes();
    const visible=CODES.filter(x=>x.status!=='archived'&&x.status!=='draft');
    const featured=visible.filter(x=>x.featured);
    render(featured.length?featured:visible.slice(0,6),$('#featured'));
    render(visible.slice().reverse().slice(0,6),$('#latest'));
    if($('#count'))$('#count').textContent=visible.length;
  }catch(e){
    if($('#featured'))$('#featured').innerHTML=`<div class="empty">${esc(e.message)}</div>`;
  }
}

async function initCatalog(){
  try{
    await loadCodes();
    const visible=CODES.filter(x=>x.status!=='archived'&&x.status!=='draft');
    const q=$('#q'),cat=$('#cat'),host=$('#catalog');
    const cats=[...new Set(visible.map(x=>x.category).filter(Boolean))].sort();

    cat.innerHTML='<option value="">Todas as categorias</option>'+
      cats.map(x=>`<option>${esc(x)}</option>`).join('');

    function apply(){
      const term=q.value.toLowerCase().trim(),cv=cat.value;
      render(visible.filter(x=>
        (!cv||x.category===cv)&&
        (!term||[x.title,x.description,x.category,...(x.tags||[])]
          .join(' ').toLowerCase().includes(term))
      ),host);
    }

    q.oninput=apply;
    cat.onchange=apply;
    apply();
  }catch(e){
    $('#catalog').innerHTML=`<div class="empty">${esc(e.message)}</div>`;
  }
}

async function initItem(){
  try{
    await loadCodes();

    const params=new URLSearchParams(location.search);
    const path=location.pathname.split('/').filter(Boolean);
    const codigoIndex=path.indexOf('codigo');

    const slug=codigoIndex>=0
      ? path[codigoIndex+1]
      : params.get('slug');

    const id=params.get('id');

    const c=CODES.find(x=>
      (id&&x.id===id)||
      (slug&&((x.slug||x.id)===slug||x.id===slug))
    );

    if(!c){
      document.body.innerHTML=
        '<main class="container" style="padding:80px"><h1>Conteúdo não encontrado</h1><p>Confira o código ou volte ao catálogo.</p></main>';
      return;
    }

    document.title=c.title+' — CódigoIA';

    const item=$('#item');
    const url=resourceUrl(c);

    item.innerHTML=`
      <div class="detailgrid">
        <div>
          <img class="cover" src="${esc(c.image||'assets/default.svg')}" alt="${esc(c.title)}">
        </div>
        <div>
          <div class="eyebrow">${esc(c.category||'IA')} · #${esc(c.id)}</div>
          <h1>${esc(c.title)}</h1>
          <p>${esc(c.description||'')}</p>
          <div class="tags">${(c.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="tools">
            ${url
              ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir recurso</a>`
              : '<button class="btn disabled" type="button" disabled>URL inválida</button>'
            }
            <button class="btn secondary" id="copy" type="button">Copiar link</button>
            <a class="btn secondary" href="catalog.html">Voltar</a>
          </div>
        </div>
      </div>

      <section class="contentbox">
        <h2>Sobre este conteúdo</h2>
        <p>Recurso publicado pelo CódigoIA. Copie, cole e use.</p>
      </section>`;

    $('#copy').onclick=async()=>{
      try{
        await navigator.clipboard.writeText(location.href);
        $('#copy').textContent='Copiado ✓';
      }catch{
        const el=document.createElement('div');
        el.className='toast success';
        el.textContent='Copie o endereço desta página pelo navegador.';
        document.body.appendChild(el);
        setTimeout(()=>el.remove(),3000);
      }
    };
  }catch(e){
    document.body.innerHTML=
      `<main class="container" style="padding:80px"><h1>Erro</h1><p>${esc(e.message)}</p></main>`;
  }
}

async function initGo(){
  await loadCodes();
  const id=new URLSearchParams(location.search).get('c');
  const c=CODES.find(x=>x.id===id);

  if(c?.url&&isValidUrl(c.url)){
    location.replace(c.url);
  }else{
    document.body.innerHTML=
      '<main class="container" style="padding:80px"><h1>Link inválido</h1><p>Este conteúdo ainda não possui uma URL de recurso válida.</p><a class="btn" href="catalog.html">Voltar</a></main>';
  }
}
