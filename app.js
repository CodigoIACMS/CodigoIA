let CODES=[];const $=(s,r=document)=>r.querySelector(s);
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function validUrl(v=""){try{const u=new URL(String(v).trim());return u.protocol==='http:'||u.protocol==='https:'}catch{return false}}
function urlOf(x){return validUrl(x?.url)?x.url.trim():''}
function itemUrl(x){return `item.html?id=${encodeURIComponent(x.id)}`}
function imgOf(x){return x?.image||'assets/default.svg'}
function norm(v=""){return String(v).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/^#/,'').trim()}
function matches(x,q){q=norm(q);if(!q)return true;const id=norm(x.id),n=String(parseInt(x.id,10));const text=norm([x.id,x.title,x.slug,x.category,x.description,...(x.tags||[])].join(' '));return id===q||n===q||id.padStart(3,'0')===q.padStart(3,'0')||text.includes(q)}
function visible(){return CODES.filter(x=>x.status!=='archived'&&x.status!=='draft')}
async function loadCodes(){const r=await fetch(`data/codes.json?v=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error('Não foi possível carregar os códigos.');CODES=await r.json();return CODES}
function fallback(){return "this.onerror=null;this.src='assets/default.svg';"}
function badge(x){return `<span class="code-badge">#${esc(String(x.id).padStart(3,'0'))}</span>`}
function openBtn(x,label='Abrir →'){const u=urlOf(x);return u?`<a class="action-btn primary" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label}</a>`:`<button class="action-btn disabled" disabled>URL inválida</button>`}
function card(x){return `<article class="content-card"><a class="card-image-wrap" href="${itemUrl(x)}"><img class="card-image" src="${esc(imgOf(x))}" alt="${esc(x.title||'Código')}" loading="lazy" onerror="${fallback()}">${badge(x)}</a><div class="card-body"><div class="card-category">${esc(x.category||'CÓDIGO')}</div><h3>${esc(x.title||'Sem título')}</h3><p>${esc(x.description||'Conteúdo pronto para usar.')}</p><div class="card-actions"><a class="action-btn secondary" href="${itemUrl(x)}">Detalhes</a>${openBtn(x)}</div></div></article>`}
function icon(c=''){const v=norm(c);if(v.includes('imagem'))return '▧';if(v.includes('video'))return '▶';if(v.includes('automacao'))return '⚙';if(v.includes('pesquisa'))return '⌕';if(v.includes('ia'))return '✦';return '</>'}
function quick(x){return `<a class="quick-item" href="${itemUrl(x)}"><span class="quick-icon">${icon(x.category)}</span><span class="quick-text"><strong>#${esc(String(x.id).padStart(3,'0'))}</strong><span>${esc(x.title||'Sem título')}</span><small>${esc(x.category||'Código')}</small></span><span class="quick-arrow">→</span></a>`}
function render(xs,h){if(!h)return;h.innerHTML=xs.length?xs.map(card).join(''):`<div class="empty-state"><strong>Nenhum código encontrado.</strong><span>Tente outro nome ou código, como #005.</span></div>`}
function homeSearch(){const f=$('#homeSearch'),i=$('#homeSearchInput');if(!f||!i)return;const go=q=>location.href=`catalog.html${q.trim()?`?q=${encodeURIComponent(q.trim())}`:''}`;f.addEventListener('submit',e=>{e.preventDefault();go(i.value)});document.querySelectorAll('[data-search]').forEach(b=>b.onclick=()=>go(b.dataset.search))}
async function initHome(){try{await loadCodes();const xs=visible(),quickXs=xs.slice().sort((a,b)=>parseInt(a.id)-parseInt(b.id)).slice(0,6),feat=xs.filter(x=>x.featured);$('#quickCodes').innerHTML=quickXs.length?quickXs.map(quick).join(''):`<div class="empty-state">Nenhum código publicado ainda.</div>`;render((feat.length?feat:xs.slice().reverse()).slice(0,3),$('#featured'));homeSearch()}catch(e){const m=esc(e.message);if($('#quickCodes'))$('#quickCodes').innerHTML=`<div class="empty-state">${m}</div>`;if($('#featured'))$('#featured').innerHTML=`<div class="empty-state">${m}</div>`}}
async function initCatalog(){try{await loadCodes();const xs=visible(),q=$('#q'),cat=$('#cat'),host=$('#catalog'),count=$('#resultCount');const cats=[...new Set(xs.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));cat.innerHTML='<option value="">Todas as categorias</option>'+cats.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');const p=new URLSearchParams(location.search);q.value=p.get('q')||'';function apply(){const term=q.value.trim(),c=cat.value,filtered=xs.filter(x=>(!c||x.category===c)&&matches(x,term));render(filtered,host);count.textContent=filtered.length;$('#catalogTitle').textContent=term?`Resultados para “${term}”`:c?c:'Todos os códigos'}q.oninput=apply;cat.onchange=apply;$('#clearFilters').onclick=()=>{q.value='';cat.value='';history.replaceState(null,'','catalog.html');apply();q.focus()};apply()}catch(e){$('#catalog').innerHTML=`<div class="empty-state"><strong>Erro</strong><span>${esc(e.message)}</span></div>`}}
async function initItem(){try{await loadCodes();const p=new URLSearchParams(location.search),id=p.get('id'),slug=p.get('slug'),path=location.pathname.split('/').filter(Boolean),ci=path.indexOf('codigo'),ps=ci>=0?path[ci+1]:'';const x=CODES.find(y=>(id&&String(y.id)===String(id))||(slug&&y.slug===slug)||(ps&&(y.slug===ps||String(y.id)===ps)));if(!x){$('#item').innerHTML='<div class="not-found"><span class="eyebrow">gwzyrt.ai</span><h1>Conteúdo não encontrado</h1><p>Confira o código informado ou volte para a biblioteca.</p><a class="action-btn primary big-btn" href="catalog.html">Voltar aos códigos</a></div>';return}document.title=`${x.title||'Conteúdo'} — gwzyrt.ai`;const u=urlOf(x),tags=(x.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('');$('#item').innerHTML=`<a class="back-link" href="catalog.html">← Voltar para códigos</a><div class="detail-shell"><div class="detail-media"><div class="detail-image-frame"><img src="${esc(imgOf(x))}" alt="${esc(x.title||'Código')}" onerror="${fallback()}">${badge(x)}</div></div><div class="detail-info"><div class="detail-category"><span>${esc(x.category||'CÓDIGO')}</span><b>#${esc(String(x.id).padStart(3,'0'))}</b></div><h1>${esc(x.title||'Sem título')}</h1><p class="detail-description">${esc(x.description||'Conteúdo pronto para usar.')}</p>${tags?`<div class="tags">${tags}</div>`:''}<div class="code-callout"><div><span>USE ESTE CÓDIGO NO SITE</span><strong>#${esc(String(x.id).padStart(3,'0'))}</strong></div><button class="copy-code" id="copyCode">Copiar código</button></div><div class="detail-actions">${u?`<a class="action-btn primary big-btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Abrir recurso <span>↗</span></a>`:'<button class="action-btn disabled big-btn" disabled>URL inválida</button>'}<button class="action-btn secondary big-btn" id="copyLink">Copiar link</button></div></div></div><section class="about-box"><span class="eyebrow">SOBRE</span><h2>${esc(x.title||'Este conteúdo')}</h2><p>Encontre este conteúdo rapidamente pesquisando pelo código <strong>#${esc(String(x.id).padStart(3,'0'))}</strong> no gwzyrt.ai.</p></section>`;$('#copyCode').onclick=()=>copyText(`#${String(x.id).padStart(3,'0')}`,$('#copyCode'),'Copiado ✓');$('#copyLink').onclick=()=>copyText(location.href,$('#copyLink'),'Link copiado ✓')}catch(e){$('#item').innerHTML=`<div class="not-found"><span class="eyebrow">ERRO</span><h1>Não foi possível carregar</h1><p>${esc(e.message||'Erro desconhecido.')}</p><a class="action-btn primary big-btn" href="catalog.html">Voltar</a></div>`}}
async function copyText(t,b,s){try{await navigator.clipboard.writeText(t)}catch{const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}const old=b.textContent;b.textContent=s;setTimeout(()=>b.textContent=old,1800)}

function initMobileNav(){
  const toggle=document.querySelector('#menuToggle');
  const nav=document.querySelector('#mainNav');
  if(!toggle||!nav)return;
  const close=()=>{
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Abrir menu');
  };
  toggle.addEventListener('click',()=>{
    const open=nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Fechar menu':'Abrir menu');
  });
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  document.addEventListener('click',e=>{
    if(!nav.contains(e.target)&&!toggle.contains(e.target))close();
  });
}
const API_BASE='https://codigoia-api.maru62638.workers.dev';
let CURRENT_USER=null;

async function userApi(path,options={}){
  const r=await fetch(API_BASE+path,{
    credentials:'include',
    headers:{
      'Content-Type':'application/json',
      ...(options.headers||{})
    },
    ...options
  });

  let d={};
  try{d=await r.json()}catch{}

  if(!r.ok){
    throw Error(d.error||d.message||'Não foi possível concluir a operação.');
  }

  return d;
}

function userStyles(){
  if(document.getElementById('userStyles'))return;

  const s=document.createElement('style');
  s.id='userStyles';

  s.textContent=`
.user-area{
  display:flex;
  align-items:center;
  gap:8px;
  margin-left:10px;
}

.user-btn{
  border:1px solid rgba(255,255,255,.15);
  background:transparent;
  color:inherit;
  border-radius:10px;
  padding:9px 12px;
  cursor:pointer;
}

.user-modal{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.72);
  z-index:9999;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:18px;
}

.user-box{
  width:min(430px,100%);
  background:#10151b;
  border:1px solid rgba(255,255,255,.12);
  border-radius:18px;
  padding:22px;
  box-shadow:0 20px 70px rgba(0,0,0,.5);
}

.user-box h2{
  margin:0 0 8px;
}

.user-box p{
  opacity:.75;
}

.user-box form{
  display:grid;
  gap:10px;
}

.user-box input{
  width:100%;
  box-sizing:border-box;
  padding:12px;
  border-radius:10px;
  border:1px solid rgba(255,255,255,.15);
  background:#080b0f;
  color:inherit;
}

.user-box button{
  cursor:pointer;
}

.user-tabs{
  display:flex;
  gap:8px;
  margin:14px 0;
}

.user-tabs button{
  flex:1;
}

.user-close{
  float:right;
  background:none;
  border:0;
  color:inherit;
  font-size:22px;
}

.user-msg{
  min-height:20px;
  color:#ffb4a8;
}

.user-profile{
  position:relative;
}

.user-menu{
  position:absolute;
  right:0;
  top:calc(100% + 8px);
  min-width:180px;
  background:#10151b;
  border:1px solid rgba(255,255,255,.12);
  border-radius:12px;
  padding:8px;
  z-index:1000;
}

.user-menu button{
  display:block;
  width:100%;
  text-align:left;
  background:none;
  border:0;
  color:inherit;
  padding:10px;
  border-radius:8px;
}

.user-menu button:hover{
  background:rgba(255,255,255,.07);
}

@media(max-width:760px){
  .user-area{
    margin:8px 0;
  }

  .user-profile{
    width:100%;
  }

  .user-profile>.user-btn{
    width:100%;
  }
}
`;

  document.head.appendChild(s);
}

function userModal(mode='login'){
  const old=document.getElementById('userModal');

  if(old)old.remove();

  const m=document.createElement('div');

  m.className='user-modal';
  m.id='userModal';

  m.innerHTML=`
<div class="user-box">

<button class="user-close" aria-label="Fechar">×</button>

<h2 id="userTitle"></h2>

<p id="userIntro"></p>

<div class="user-tabs">
<button class="action-btn secondary" id="tabLogin">Entrar</button>
<button class="action-btn secondary" id="tabRegister">Criar conta</button>
</div>

<form id="userForm">

<div id="userFields"></div>

<input
id="userEmail"
type="email"
placeholder="E-mail"
autocomplete="email"
required
>

<input
id="userPassword"
type="password"
placeholder="Senha"
autocomplete="current-password"
required
>

<div class="user-msg" id="userMsg"></div>

<button
class="action-btn primary"
type="submit"
id="userSubmit">
</button>

</form>

</div>
`;

  document.body.appendChild(m);

  m.querySelector('.user-close').onclick=()=>m.remove();

  m.addEventListener('click',e=>{
    if(e.target===m)m.remove();
  });

  const fields=$('#userFields',m);
  const title=$('#userTitle',m);
  const intro=$('#userIntro',m);
  const submit=$('#userSubmit',m);
  const form=$('#userForm',m);

  function setMode(x){

    const reg=x==='register';

    title.textContent=reg?'Criar conta':'Entrar';

    intro.textContent=reg
      ?'Crie sua conta para salvar favoritos, curtidas e histórico.'
      :'Entre para acessar seu perfil e seus conteúdos salvos.';

    fields.innerHTML=reg
      ?`
<input
id="userUsername"
placeholder="Nome de usuário"
autocomplete="username"
required
>

<input
id="userDisplay"
placeholder="Nome de exibição"
autocomplete="name"
required
>
`
      :'';

    $('#userPassword',m).autocomplete=
      reg?'new-password':'current-password';

    submit.textContent=reg?'Criar conta':'Entrar';

    m.dataset.mode=x;
  }

  $('#tabLogin',m).onclick=()=>setMode('login');

  $('#tabRegister',m).onclick=()=>setMode('register');

  form.onsubmit=async e=>{

    e.preventDefault();

    const msg=$('#userMsg',m);

    msg.textContent='';

    try{

      const body={
        email:$('#userEmail',m).value.trim(),
        password:$('#userPassword',m).value
      };

      let d;

      if(m.dataset.mode==='register'){

        body.username=$('#userUsername',m).value.trim();

        body.display_name=
          $('#userDisplay',m).value.trim();

        d=await userApi(
          '/api/user/register',
          {
            method:'POST',
            body:JSON.stringify(body)
          }
        );

      }else{

        d=await userApi(
          '/api/user/login',
          {
            method:'POST',
            body:JSON.stringify(body)
          }
        );
      }

      CURRENT_USER=d.user||null;

      m.remove();

      updateUserUI();

    }catch(err){

      msg.textContent=
        err.message||'Erro ao entrar.';
    }
  };

  setMode(mode);
}

async function loadUser(){

  try{

    const d=await userApi('/api/user/session');

    CURRENT_USER=
      d.authenticated
      ?d.user
      :null;

  }catch{

    CURRENT_USER=null;
  }

  updateUserUI();
}

function updateUserUI(){

  const host=document.querySelector('.header-inner');

  if(!host)return;

  let area=document.getElementById('userArea');

  if(!area){

    area=document.createElement('div');

    area.id='userArea';

    area.className='user-area';

    host.appendChild(area);
  }

  if(!CURRENT_USER){

    area.innerHTML=`
<button
class="user-btn"
id="userLoginBtn">
Entrar
</button>
`;

    $('#userLoginBtn',area).onclick=
      ()=>userModal('login');

    return;
  }

  area.innerHTML=`
<div class="user-profile">

<button
class="user-btn"
id="userProfileBtn">
${esc(CURRENT_USER.display_name||CURRENT_USER.username||'Minha conta')} ▾
</button>

<div
class="user-menu"
id="userMenu"
hidden>

<button id="profileBtn">
Meu perfil
</button>

<button id="logoutBtn">
Sair
</button>

</div>

</div>
`;

  $('#userProfileBtn',area).onclick=()=>{
    $('#userMenu',area).toggleAttribute('hidden');
  };

  $('#logoutBtn',area).onclick=async()=>{

    try{

      await userApi(
        '/api/user/logout',
        {method:'POST'}
      );

    }catch{}

    CURRENT_USER=null;

    updateUserUI();
  };

  $('#profileBtn',area).onclick=
    ()=>showProfile();
}

function showProfile(){

  const old=document.getElementById('userModal');

  if(old)old.remove();

  const m=document.createElement('div');

  m.className='user-modal';

  m.id='userModal';

  m.innerHTML=`
<div class="user-box">

<button class="user-close">
×
</button>

<h2>Meu perfil</h2>

<p>
<strong>
${esc(CURRENT_USER?.display_name||'')}
</strong>
<br>
@${esc(CURRENT_USER?.username||'')}
<br>
${esc(CURRENT_USER?.email||'')}
</p>

<button
class="action-btn primary"
id="favProfile">
Ver favoritos
</button>

</div>
`;

  document.body.appendChild(m);

  m.querySelector('.user-close').onclick=
    ()=>m.remove();

  $('#favProfile',m).onclick=async()=>{

    try{

      const d=
        await userApi('/api/user/favorites');

      alert(
        'Você tem '+
        ((d.favorites||[]).length)+
        ' favorito(s).'
      );

    }catch(e){

      alert(e.message);
    }
  };
}

async function trackHistory(id){

  if(!CURRENT_USER||!id)return;

  try{

    await userApi(
      '/api/user/history',
      {
        method:'POST',
        body:JSON.stringify({
          content_id:String(id)
        })
      }
    );

  }catch{}
}

function initUserUI(){

  userStyles();

  loadUser();
}

document.addEventListener(
  'DOMContentLoaded',
  ()=>{
    initMobileNav();

    initUserUI();

    const p=document.body.dataset.page;

    if(p==='home')initHome();

    if(p==='catalog')initCatalog();

    if(p==='item')initItem();
  }
);
