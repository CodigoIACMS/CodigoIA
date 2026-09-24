/**
 * CódigoIA Admin API
 * Cloudflare Worker — GitHub OAuth + GitHub App installation token.
 *
 * Required secrets:
 * GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_APP_PRIVATE_KEY,
 * SESSION_SECRET
 *
 * Required vars:
 * GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_OWNER, GITHUB_REPO,
 * GITHUB_BRANCH, PUBLIC_SITE_URL, ADMIN_GITHUB_LOGIN
 *
 * Optional AI:
 * AI_API_URL, AI_API_KEY, AI_MODEL
 */
const GH="https://api.github.com";
const GH_VERSION="2026-03-10";
const encoder=new TextEncoder();

function json(data,status=200,extra={}){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}});
}
function redirect(url,headers={}){return new Response(null,{status:302,headers:{Location:url,...headers}})}
function b64url(bytes){let s="";for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function ub64(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function hmac(secret,data,op="sign"){
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,[op]);
  return crypto.subtle[op]("HMAC",key,encoder.encode(data));
}
async function sign(payload,secret){const body=b64url(encoder.encode(JSON.stringify(payload)));return body+"."+b64url(await hmac(secret,body))}
async function verify(token,secret){
  try{const [body,sig]=token.split(".");if(!body||!sig)return null;const ok=await crypto.subtle.verify("HMAC",await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]),ub64(sig),encoder.encode(body));if(!ok)return null;const p=JSON.parse(new TextDecoder().decode(ub64(body)));if(!p.exp||p.exp<Date.now()/1000)return null;return p}catch{return null}
}
function cookie(name,value,maxAge){return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`}
function clearCookie(name){return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`}
function getCookie(req,name){const c=req.headers.get("Cookie")||"";const m=c.match(new RegExp("(?:^|; )"+name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"=([^;]*)"));return m?m[1]:null}
function envRequired(env,names){for(const n of names)if(!env[n])throw new Error(`Configuração ausente: ${n}`)}
function ghHeaders(token){return{"Accept":"application/vnd.github+json","Authorization":`Bearer ${token}`,"X-GitHub-Api-Version":GH_VERSION,"User-Agent":"CodigoIA-Admin"}}
async function gh(path,token,init={}){
  const r=await fetch(GH+path,{...init,headers:{...ghHeaders(token),...(init.headers||{})}});
  const text=await r.text();let d;try{d=JSON.parse(text)}catch{d={message:text}}
  if(!r.ok)throw new Error(`GitHub ${r.status}: ${d.message||"erro"}`);
  return d;
}
function pemToDer(pem){return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),c=>c.charCodeAt(0))}
async function appJwt(env){
  const key=await crypto.subtle.importKey("pkcs8",pemToDer(env.GITHUB_APP_PRIVATE_KEY),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const now=Math.floor(Date.now()/1000);const head=b64url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));const body=b64url(encoder.encode(JSON.stringify({iat:now-60,exp:now+540,iss:String(env.GITHUB_APP_ID)})));
  return head+"."+body+"."+b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encoder.encode(head+"."+body)));
}
async function installationToken(env){
  const token=await gh(`/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,await appJwt(env),{method:"POST"});
  return token.token;
}
async function getCodes(env){
  const token=await installationToken(env);
  const d=await gh(`/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/data/codes.json?ref=${encodeURIComponent(env.GITHUB_BRANCH||"main")}`,token);
  const raw=atob(d.content.replace(/\n/g,""));return {token,codes:JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)))),sha:d.sha};
}
function nextId(codes){return String(Math.max(0,...codes.map(x=>parseInt(x.id,10)).filter(Number.isFinite))+1).padStart(3,"0")}
function slugify(s){return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)}
function cleanItem(p,codes){
  if(!p.title||!p.url||!p.category)throw new Error("Título, categoria e URL são obrigatórios.");
  const id=p.originalId||p.id||nextId(codes),slug=p.slug||slugify(p.title);
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))throw new Error("Slug inválido.");
  return {id,title:p.title.trim(),slug,category:p.category.trim(),tags:Array.isArray(p.tags)?p.tags.slice(0,30):[],description:(p.description||"").trim(),image:p.image||"assets/default.svg",url:p.url.trim(),code:p.code||"",prompt:p.prompt||"",type:p.type||"code",status:p.status||"draft",access:p.access||"free",linkType:p.linkType||"normal",partner:p.partner||"",campaign:p.campaign||"",featured:!!p.featured,publishedAt:p.publishedAt||""};
}
async function commitFiles(env,token,files,message){
  const owner=encodeURIComponent(env.GITHUB_OWNER),repo=encodeURIComponent(env.GITHUB_REPO),branch=env.GITHUB_BRANCH||"main";
  const ref=await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,token);
  const commit=await gh(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,token);
  const tree=[];
  for(const f of files){
    if(f.encoding==="base64"){
      const blob=await gh(`/repos/${owner}/${repo}/git/blobs`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:f.content,encoding:"base64"})});
      tree.push({path:f.path,mode:"100644",type:"blob",sha:blob.sha});
    }else{
      tree.push({path:f.path,mode:"100644",type:"blob",content:f.content});
    }
  }
  const newTree=await gh(`/repos/${owner}/${repo}/git/trees`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({base_tree:commit.tree.sha,tree})});
  const newCommit=await gh(`/repos/${owner}/${repo}/git/commits`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,tree:newTree.sha,parents:[commit.sha]})});
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,token,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sha:newCommit.sha,force:false})});
  return newCommit.sha;
}
function dataUrlToBytes(dataUrl){const m=dataUrl.match(/^data:([^;]+);base64,(.+)$/);if(!m)throw new Error("Imagem inválida.");return {mime:m[1],bytes:Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0))}}
async function generate(env,kind,content){
  if(!env.AI_API_URL||!env.AI_API_KEY||!env.AI_MODEL)throw new Error("IA não configurada no backend. Defina AI_API_URL, AI_API_KEY e AI_MODEL.");
  const prompt=kind==="social"
    ? `Crie um post curto para TikTok em português brasileiro sobre este conteúdo. Retorne texto pronto com: título do vídeo, gancho, roteiro curto, legenda, CTA, hashtags e comentário fixado. Não invente características do produto. Dados: ${JSON.stringify(content)}`
    : `Sugira metadados para este conteúdo em português brasileiro. Retorne JSON com description, tags (array), slug. Não invente características. Dados: ${JSON.stringify(content)}`;
  const r=await fetch(env.AI_API_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${env.AI_API_KEY}`},body:JSON.stringify({model:env.AI_MODEL,input:prompt})});
  const d=await r.json();if(!r.ok)throw new Error(`IA ${r.status}: ${d.error?.message||"erro"}`);
  const text=d.output_text||d.output?.flatMap(x=>x.content||[]).find(x=>x.text)?.text||d.choices?.[0]?.message?.content||"";
  if(!text)throw new Error("A IA não retornou texto.");
  if(kind==="social")return {text};
  try{return {content:JSON.parse(text.replace(/^```json\s*|\s*```$/g,""))}}catch{return {content:{description:text,tags:[],slug:slugify(content.title||"conteudo")}}}
}
async function authUser(req,env){
  const s=getCookie(req,"codigoia_session");const p=s&&await verify(s,env.SESSION_SECRET);return p;
}
function cors(env){return{"Access-Control-Allow-Origin":env.PUBLIC_SITE_URL||"*","Access-Control-Allow-Credentials":"true","Vary":"Origin"}}
export default {async fetch(req,env){
  try{
    envRequired(env,["GITHUB_CLIENT_ID","GITHUB_CLIENT_SECRET","GITHUB_APP_ID","GITHUB_APP_PRIVATE_KEY","GITHUB_INSTALLATION_ID","GITHUB_OWNER","GITHUB_REPO","SESSION_SECRET","ADMIN_GITHUB_LOGIN"]);
    const u=new URL(req.url),method=req.method;
    if(method==="OPTIONS")return new Response(null,{headers:{"Access-Control-Allow-Origin":env.PUBLIC_SITE_URL||"*","Access-Control-Allow-Credentials":"true","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"}});
    if(u.pathname==="/auth/login"){const state=await sign({nonce:crypto.randomUUID(),exp:Math.floor(Date.now()/1000)+600},env.SESSION_SECRET);const cb=new URL("/auth/callback",u.origin).href;const loc="https://github.com/login/oauth/authorize?"+new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:cb,scope:"read:user"});return redirect(loc,{"Set-Cookie":cookie("codigoia_state",state,600)})}
    if(u.pathname==="/auth/callback"){
      const state=u.searchParams.get("state"),code=u.searchParams.get("code"),saved=getCookie(req,"codigoia_state");if(!state||!code||!saved) return new Response("Autenticação inválida.",{status:400});
      const sp=await verify(saved,env.SESSION_SECRET);if(!sp||state!==saved)return new Response("Estado OAuth inválido.",{status:403});
      const tokenR=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code})});const tok=await tokenR.json();if(!tok.access_token)throw new Error("GitHub não retornou um token.");
      const me=await fetch("https://api.github.com/user",{headers:{"Accept":"application/vnd.github+json","Authorization":`Bearer ${tok.access_token}`,"X-GitHub-Api-Version":GH_VERSION,"User-Agent":"CodigoIA-Admin"}});const user=await me.json();
      if(user.login?.toLowerCase()!==env.ADMIN_GITHUB_LOGIN.toLowerCase())return new Response("Usuário não autorizado.",{status:403});
      const session=await sign({login:user.login,id:user.id,exp:Math.floor(Date.now()/1000)+28800},env.SESSION_SECRET);
      const response=redirect(env.PUBLIC_SITE_URL+"/admin.html");
      response.headers.append("Set-Cookie",cookie("codigoia_session",session,28800));
      response.headers.append("Set-Cookie",clearCookie("codigoia_state"));
      return response;
    }
    if(u.pathname==="/api/session"){const p=await authUser(req,env);return json({authenticated:!!p,user:p?{login:p.login}:null},200,cors(env))}
    if(u.pathname==="/api/logout")return json({ok:true},200,{...cors(env),"Set-Cookie":clearCookie("codigoia_session")});
    const user=await authUser(req,env);if(!user)return json({error:"Não autenticado."},401,cors(env));
    if(u.pathname==="/api/content"&&method==="GET"){const {codes}=await getCodes(env);return json({items:codes},200,cors(env))}
    if(u.pathname==="/api/content/save"&&method==="POST"){
      const p=await req.json();const current=await getCodes(env);const item=cleanItem(p,current.codes);let codes=current.codes.filter(x=>x.id!==item.id);
      if(p.originalId&&p.originalId!==item.id)codes=codes.filter(x=>x.id!==p.originalId);
      if(codes.some(x=>x.id===item.id))throw new Error("ID já existe.");
      codes.push(item);codes.sort((a,b)=>parseInt(a.id)-parseInt(b.id));
      const files=[{path:"data/codes.json",content:JSON.stringify(codes,null,2)+"\n"}];
      if(p.imageData){const im=dataUrlToBytes(p.imageData);if(im.bytes.byteLength>2_000_000)throw new Error("Imagem acima de 2 MB após compressão.");const ext=im.mime==="image/webp"?"webp":im.mime==="image/png"?"png":"jpg";item.image=`assets/uploads/${item.id}-${item.slug}.${ext}`;codes[codes.findIndex(x=>x.id===item.id)]=item;files[0].content=JSON.stringify(codes,null,2)+"\n";files.push({path:item.image,content:p.imageData.split(",")[1],encoding:"base64"});}
      const sha=await commitFiles(env,current.token,files,`content: publicar ${item.id} ${item.title}`);
      return json({ok:true,item,items:codes,commit:sha},200,cors(env));
    }
    if(u.pathname==="/api/content/archive"&&method==="POST"){
      const {id}=await req.json();const current=await getCodes(env);const c=current.codes.find(x=>x.id===id);if(!c)throw new Error("Conteúdo não encontrado.");c.status="archived";const codes=current.codes.map(x=>x.id===id?c:x);const sha=await commitFiles(env,current.token,[{path:"data/codes.json",content:JSON.stringify(codes,null,2)+"\n"}],`content: arquivar ${id}`);return json({ok:true,items:codes,commit:sha},200,cors(env));
    }
    if(u.pathname==="/api/generate"&&method==="POST"){const p=await req.json();return json(await generate(env,p.kind,p.content),200,cors(env))}
    return json({error:"Rota não encontrada."},404,cors(env));
  }catch(e){return json({error:e.message||"Erro interno."},500,{"Access-Control-Allow-Origin":env.PUBLIC_SITE_URL||"*","Access-Control-Allow-Credentials":"true"})}
}};
