/**
 * gwzyrt.ai — Cloudflare Worker
 * Correção: sessões persistentes no frontend usando Bearer token.
 * D1 continua armazenando as sessões; GitHub OAuth continua sendo usado somente no admin.
 */

const GH = "https://api.github.com";
const GH_VERSION = "2026-03-10";
const ADMIN_COOKIE = "codigoia_session";
const USER_COOKIE = "gwzyrt_session";
const USER_SESSION_SECONDS = 60 * 60 * 24 * 30;
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const PASSWORD_ITERATIONS_DEFAULT = 100000;
const LOGIN_MAX_FAILURES = 8;
const LOGIN_LOCK_SECONDS = 15 * 60;
const MAX_COMMENT_LENGTH = 2000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(data,status=200,extra={}) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      ...extra
    }
  });
}
function redirect(url,headers={}) {
  return new Response(null,{status:302,headers:{Location:url,...headers}});
}
function b64url(bytes) {
  let s="";
  for(const b of new Uint8Array(bytes)) s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function ub64(s) {
  s=s.replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4)s+="=";
  return Uint8Array.from(atob(s),c=>c.charCodeAt(0));
}
async function hmac(secret,data,op="sign") {
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,[op]);
  return crypto.subtle[op]("HMAC",key,encoder.encode(data));
}
async function sign(payload,secret) {
  const body=b64url(encoder.encode(JSON.stringify(payload)));
  return body+"."+b64url(await hmac(secret,body));
}
async function verify(token,secret) {
  try {
    const [body,sig]=String(token||"").split(".");
    if(!body||!sig)return null;
    const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    if(!await crypto.subtle.verify("HMAC",key,ub64(sig),encoder.encode(body)))return null;
    const payload=JSON.parse(decoder.decode(ub64(body)));
    if(!payload.exp||payload.exp<Date.now()/1000)return null;
    return payload;
  }catch{return null}
}
function cookie(name,value,maxAge,sameSite="None") {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}
function clearCookie(name,sameSite="None") {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=${sameSite}`;
}
function getCookie(req,name) {
  const cookies=req.headers.get("Cookie")||"";
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const m=cookies.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return m?m[1]:null;
}
function bearer(req) {
  const h=req.headers.get("Authorization")||"";
  return h.startsWith("Bearer ")?h.slice(7).trim():null;
}
function envRequired(env,names) {
  for(const n of names)if(!env[n])throw new Error(`Configuração ausente: ${n}`);
}
function cors(env) {
  return {
    "Access-Control-Allow-Origin":env.PUBLIC_SITE_URL||"*",
    "Access-Control-Allow-Credentials":"true",
    "Access-Control-Allow-Headers":"Content-Type, Authorization",
    "Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS",
    "Vary":"Origin"
  };
}
function requireOrigin(req,env) {
  const origin=req.headers.get("Origin");
  if(!origin)return true;
  return origin===String(env.PUBLIC_SITE_URL||"").replace(/\/$/,"");
}
function db(env) {
  if(!env.DB||typeof env.DB.prepare!=="function")throw new Error("D1 não configurado. Verifique o binding DB do Worker.");
  return env.DB;
}
function ghHeaders(token) {
  return {
    Accept:"application/vnd.github+json",
    Authorization:`Bearer ${token}`,
    "X-GitHub-Api-Version":GH_VERSION,
    "User-Agent":"gwzyrt-ai-Admin"
  };
}
async function gh(path,token,init={}) {
  const r=await fetch(GH+path,{...init,headers:{...ghHeaders(token),...(init.headers||{})}});
  const text=await r.text();
  let data;try{data=JSON.parse(text)}catch{data={message:text}}
  if(!r.ok)throw new Error(`GitHub ${r.status}: ${data.message||"erro"}`);
  return data;
}
function pemToDer(pem) {
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),c=>c.charCodeAt(0));
}
async function appJwt(env) {
  const key=await crypto.subtle.importKey("pkcs8",pemToDer(env.GITHUB_APP_PRIVATE_KEY),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const now=Math.floor(Date.now()/1000);
  const head=b64url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const body=b64url(encoder.encode(JSON.stringify({iat:now-60,exp:now+540,iss:String(env.GITHUB_APP_ID)})));
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encoder.encode(head+"."+body));
  return head+"."+body+"."+b64url(sig);
}
async function installationToken(env) {
  const d=await gh(`/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,await appJwt(env),{method:"POST"});
  return d.token;
}
async function getInstallationInfo(env) {
  return gh(`/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/installation`,await appJwt(env));
}
async function getCodes(env) {
  const token=await installationToken(env);
  const d=await gh(`/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/data/codes.json?ref=${encodeURIComponent(env.GITHUB_BRANCH||"main")}`,token);
  const raw=atob(d.content.replace(/\n/g,""));
  return {token,codes:JSON.parse(decoder.decode(Uint8Array.from(raw,c=>c.charCodeAt(0)))),sha:d.sha};
}
function nextId(codes) {
  return String(Math.max(0,...codes.map(x=>parseInt(x.id,10)).filter(Number.isFinite))+1).padStart(3,"0");
}
function slugify(s) {
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);
}
function cleanUrl(v) {
  v=String(v||"").trim();
  if(!v)return "";
  try{const u=new URL(v);if(!["http:","https:"].includes(u.protocol))throw 0;return v}catch{throw new Error("URL inválida.")}
}
function cleanItem(p,codes) {
  if(!p.title||!p.url||!p.category)throw new Error("Título, categoria e URL são obrigatórios.");
  const id=String(p.originalId||p.id||nextId(codes));
  const slug=p.slug||slugify(p.title);
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))throw new Error("Slug inválido.");
  return {
    id,title:String(p.title).trim().slice(0,200),slug,
    category:String(p.category).trim().slice(0,100),
    tags:Array.isArray(p.tags)?p.tags.slice(0,30).map(String):[],
    description:String(p.description||"").trim().slice(0,5000),
    image:p.image||"assets/default.svg",url:cleanUrl(p.url),
    code:String(p.code||""),prompt:String(p.prompt||""),
    type:p.type||"code",status:p.status||"draft",access:p.access||"free",
    linkType:p.linkType||"normal",partner:String(p.partner||""),
    campaign:String(p.campaign||""),tiktokUrl:cleanUrl(p.tiktokUrl||""),
    youtubeUrl:cleanUrl(p.youtubeUrl||""),instagramUrl:cleanUrl(p.instagramUrl||""),
    facebookUrl:cleanUrl(p.facebookUrl||""),discordUrl:cleanUrl(p.discordUrl||""),
    telegramUrl:cleanUrl(p.telegramUrl||""),featured:!!p.featured,publishedAt:p.publishedAt||""
  };
}
async function commitFiles(env,token,files,message) {
  const owner=encodeURIComponent(env.GITHUB_OWNER),repo=encodeURIComponent(env.GITHUB_REPO),branch=env.GITHUB_BRANCH||"main";
  const ref=await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,token);
  const commit=await gh(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,token);
  const tree=[];
  for(const f of files){
    if(f.encoding==="base64"){
      const b=await gh(`/repos/${owner}/${repo}/git/blobs`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:f.content,encoding:"base64"})});
      tree.push({path:f.path,mode:"100644",type:"blob",sha:b.sha});
    }else tree.push({path:f.path,mode:"100644",type:"blob",content:f.content});
  }
  const nt=await gh(`/repos/${owner}/${repo}/git/trees`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({base_tree:commit.tree.sha,tree})});
  const nc=await gh(`/repos/${owner}/${repo}/git/commits`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,tree:nt.sha,parents:[commit.sha]})});
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,token,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sha:nc.sha,force:false})});
  return nc.sha;
}
function dataUrlToBytes(dataUrl) {
  const m=String(dataUrl||"").match(/^data:([^;]+);base64,(.+)$/);
  if(!m)throw new Error("Imagem inválida.");
  return {mime:m[1],bytes:Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0))};
}
async function sha256Hex(v) {
  const d=await crypto.subtle.digest("SHA-256",encoder.encode(v));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function randomToken() {
  const b=new Uint8Array(32);crypto.getRandomValues(b);return b64url(b);
}
async function passwordHash(password,salt,iterations=PASSWORD_ITERATIONS_DEFAULT) {
  const k=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:encoder.encode(salt),iterations,hash:"SHA-256"},k,256);
  return b64url(bits);
}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim().toLowerCase())}
function validUsername(v){return /^[a-zA-Z0-9_]{3,30}$/.test(String(v||"").trim())}
function validPassword(v){return typeof v==="string"&&v.length>=8&&v.length<=128}
function publicUser(r){return {id:r.id,username:r.username,display_name:r.display_name,email:r.email,status:r.status,created_at:r.created_at,last_login_at:r.last_login_at||null}}
async function createUserSession(env,userId) {
  const d=db(env),raw=randomToken(),hash=await sha256Hex(raw),id=crypto.randomUUID(),now=new Date(),expires=new Date(now.getTime()+USER_SESSION_SECONDS*1000).toISOString();
  await d.prepare(`INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)`).bind(id,userId,hash,expires,now.toISOString(),now.toISOString()).run();
  return {raw,expires};
}
function userCookie(raw){return cookie(USER_COOKIE,raw,USER_SESSION_SECONDS,"None")}
async function authUser(req,env) {
  const d=db(env),raw=bearer(req)||getCookie(req,USER_COOKIE);
  if(!raw)return null;
  const hash=await sha256Hex(raw);
  const row=await d.prepare(`SELECT s.id,s.user_id,s.expires_at,u.id uid,u.username,u.display_name,u.email,u.status,u.created_at,u.last_login_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? LIMIT 1`).bind(hash).first();
  if(!row)return null;
  if(row.expires_at<=new Date().toISOString()||row.status!=="active"){await d.prepare(`DELETE FROM sessions WHERE id=?`).bind(row.id).run();return null}
  await d.prepare(`UPDATE sessions SET last_seen_at=? WHERE id=?`).bind(new Date().toISOString(),row.id).run();
  return {sessionId:row.id,...publicUser({id:row.uid,username:row.username,display_name:row.display_name,email:row.email,status:row.status,created_at:row.created_at,last_login_at:row.last_login_at})};
}
async function authAdmin(req,env) {
  const token=bearer(req)||getCookie(req,ADMIN_COOKIE);
  if(!token)return null;
  const s=await verify(token,env.SESSION_SECRET);
  if(!s||s.type!=="admin")return null;
  if(String(s.login||"").toLowerCase()!==String(env.ADMIN_GITHUB_LOGIN||"").toLowerCase())return null;
  return s;
}

async function userRoutes(req,env,url) {
  const d=db(env),method=req.method;
  if(url.pathname==="/api/user/session"&&method==="GET"){
    const user=await authUser(req,env);
    return json({authenticated:!!user,user:user||null},200,cors(env));
  }
  if(url.pathname==="/api/user/register"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),username=String(b.username||"").trim(),displayName=String(b.displayName||b.display_name||username).trim().slice(0,80),email=String(b.email||"").trim().toLowerCase(),password=b.password;
    if(!validUsername(username))return json({error:"Usuário inválido. Use 3–30 caracteres: letras, números ou _."},400,cors(env));
    if(!validEmail(email))return json({error:"E-mail inválido."},400,cors(env));
    if(!validPassword(password))return json({error:"A senha deve ter entre 8 e 128 caracteres."},400,cors(env));
    if(!displayName)return json({error:"Nome de exibição obrigatório."},400,cors(env));
    const exists=await d.prepare(`SELECT id,email,username FROM users WHERE lower(email)=? OR lower(username)=? LIMIT 1`).bind(email,username.toLowerCase()).first();
    if(exists)return json({error:String(exists.email).toLowerCase()===email?"E-mail já cadastrado.":"Nome de usuário já está em uso."},409,cors(env));
    const id=crypto.randomUUID(),salt=randomToken(),iterations=PASSWORD_ITERATIONS_DEFAULT,hash=await passwordHash(password,salt,iterations),now=new Date().toISOString();
    await d.prepare(`INSERT INTO users (id,email,username,display_name,password_hash,password_salt,password_iterations,status,failed_login_count,last_failed_at,created_at,updated_at,last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,email,username,displayName,hash,salt,iterations,"active",0,null,now,now,null).run();
    const session=await createUserSession(env,id),user=await d.prepare(`SELECT * FROM users WHERE id=?`).bind(id).first();
    return json({ok:true,authenticated:true,user:publicUser(user),sessionToken:session.raw},201,{...cors(env),"Set-Cookie":userCookie(session.raw)});
  }
  if(url.pathname==="/api/user/login"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),email=String(b.email||"").trim().toLowerCase(),password=b.password,generic="E-mail ou senha inválidos.";
    const row=await d.prepare(`SELECT * FROM users WHERE lower(email)=? LIMIT 1`).bind(email).first();
    if(!validEmail(email)||typeof password!=="string"||!row)return json({error:generic},401,cors(env));
    if(row.status!=="active")return json({error:"Esta conta está bloqueada."},403,cors(env));
    const nowMs=Date.now(),last=row.last_failed_at?Date.parse(row.last_failed_at):0,fail=Number(row.failed_login_count||0);
    if(fail>=LOGIN_MAX_FAILURES&&last&&nowMs-last<LOGIN_LOCK_SECONDS*1000)return json({error:"Muitas tentativas. Tente novamente mais tarde."},429,cors(env));
    const iterations=Number(row.password_iterations)||PASSWORD_ITERATIONS_DEFAULT,hash=await passwordHash(password,row.password_salt,iterations);
    if(hash!==row.password_hash){
      const failures=last&&nowMs-last<LOGIN_LOCK_SECONDS*1000?fail+1:1,failedAt=new Date().toISOString();
      await d.prepare(`UPDATE users SET failed_login_count=?,last_failed_at=?,updated_at=? WHERE id=?`).bind(failures,failedAt,failedAt,row.id).run();
      return json({error:generic},401,cors(env));
    }
    const now=new Date().toISOString();
    await d.prepare(`UPDATE users SET failed_login_count=0,last_failed_at=NULL,last_login_at=?,updated_at=? WHERE id=?`).bind(now,now,row.id).run();
    const session=await createUserSession(env,row.id),fresh=await d.prepare(`SELECT * FROM users WHERE id=?`).bind(row.id).first();
    return json({ok:true,authenticated:true,user:publicUser(fresh),sessionToken:session.raw},200,{...cors(env),"Set-Cookie":userCookie(session.raw)});
  }

  const user=await authUser(req,env);
  if(!user)return json({error:"Não autenticado."},401,cors(env));

  if(url.pathname==="/api/user/logout"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    await d.prepare(`DELETE FROM sessions WHERE id=?`).bind(user.sessionId).run();
    return json({ok:true},200,{...cors(env),"Set-Cookie":clearCookie(USER_COOKIE)});
  }
  if(url.pathname==="/api/user/profile"&&method==="GET")return json({user},200,cors(env));
  if(url.pathname==="/api/user/profile"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),displayName=String(b.displayName??b.display_name??"").trim().slice(0,80);
    if(!displayName)return json({error:"Nome de exibição obrigatório."},400,cors(env));
    await d.prepare(`UPDATE users SET display_name=?,updated_at=? WHERE id=?`).bind(displayName,new Date().toISOString(),user.id).run();
    return json({ok:true,user:publicUser(await d.prepare(`SELECT * FROM users WHERE id=?`).bind(user.id).first())},200,cors(env));
  }
  if(url.pathname==="/api/user/password"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),row=await d.prepare(`SELECT * FROM users WHERE id=?`).bind(user.id).first();
    if(!validPassword(b.newPassword))return json({error:"A nova senha deve ter entre 8 e 128 caracteres."},400,cors(env));
    if(await passwordHash(b.currentPassword||"",row.password_salt,Number(row.password_iterations)||PASSWORD_ITERATIONS_DEFAULT)!==row.password_hash)return json({error:"Senha atual incorreta."},401,cors(env));
    const salt=randomToken(),hash=await passwordHash(b.newPassword,salt,PASSWORD_ITERATIONS_DEFAULT),now=new Date().toISOString();
    await d.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=? WHERE id=?`).bind(hash,salt,PASSWORD_ITERATIONS_DEFAULT,now,user.id).run();
    await d.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(user.id).run();
    const session=await createUserSession(env,user.id);
    return json({ok:true,sessionToken:session.raw},200,{...cors(env),"Set-Cookie":userCookie(session.raw)});
  }
  if(url.pathname==="/api/user/favorites"&&method==="GET"){
    const r=await d.prepare(`SELECT content_id,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC`).bind(user.id).all();
    return json({favorites:r.results||[]},200,cors(env));
  }
  if(url.pathname==="/api/user/favorite"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),id=String(b.contentId||"").trim();
    if(!id||id.length>100)return json({error:"Conteúdo inválido."},400,cors(env));
    await d.prepare(`INSERT OR IGNORE INTO favorites(user_id,content_id,created_at) VALUES (?,?,?)`).bind(user.id,id,new Date().toISOString()).run();
    return json({ok:true,favorited:true},200,cors(env));
  }
  if(url.pathname==="/api/user/favorite"&&method==="DELETE"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    await d.prepare(`DELETE FROM favorites WHERE user_id=? AND content_id=?`).bind(user.id,String(url.searchParams.get("contentId")||"")).run();
    return json({ok:true,favorited:false},200,cors(env));
  }
  if(url.pathname==="/api/user/like"&&method==="GET"){
    const id=String(url.searchParams.get("contentId")||"");if(!id)return json({error:"Conteúdo inválido."},400,cors(env));
    const row=await d.prepare(`SELECT 1 FROM likes WHERE user_id=? AND content_id=? LIMIT 1`).bind(user.id,id).first();
    const count=await d.prepare(`SELECT COUNT(*) count FROM likes WHERE content_id=?`).bind(id).first();
    return json({liked:!!row,count:Number(count?.count||0)},200,cors(env));
  }
  if(url.pathname==="/api/user/like"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),id=String(b.contentId||"").trim();if(!id||id.length>100)return json({error:"Conteúdo inválido."},400,cors(env));
    const row=await d.prepare(`SELECT 1 FROM likes WHERE user_id=? AND content_id=? LIMIT 1`).bind(user.id,id).first();
    let liked;if(row){await d.prepare(`DELETE FROM likes WHERE user_id=? AND content_id=?`).bind(user.id,id).run();liked=false}else{await d.prepare(`INSERT INTO likes(user_id,content_id,created_at) VALUES (?,?,?)`).bind(user.id,id,new Date().toISOString()).run();liked=true}
    const count=await d.prepare(`SELECT COUNT(*) count FROM likes WHERE content_id=?`).bind(id).first();
    return json({ok:true,liked,count:Number(count?.count||0)},200,cors(env));
  }
  if(url.pathname==="/api/user/history"&&method==="GET"){
    const r=await d.prepare(`SELECT content_id,view_count,first_viewed_at,last_viewed_at FROM history WHERE user_id=? ORDER BY last_viewed_at DESC LIMIT 100`).bind(user.id).all();
    return json({history:r.results||[]},200,cors(env));
  }
  if(url.pathname==="/api/user/history"&&method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),id=String(b.contentId||"").trim();if(!id||id.length>100)return json({error:"Conteúdo inválido."},400,cors(env));
    const now=new Date().toISOString();
    await d.prepare(`INSERT INTO history(user_id,content_id,view_count,first_viewed_at,last_viewed_at) VALUES (?,?,1,?,?) ON CONFLICT(user_id,content_id) DO UPDATE SET view_count=view_count+1,last_viewed_at=excluded.last_viewed_at`).bind(user.id,id,now,now).run();
    return json({ok:true},200,cors(env));
  }
  if(url.pathname==="/api/user/history"&&method==="DELETE"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    await d.prepare(`DELETE FROM history WHERE user_id=?`).bind(user.id).run();return json({ok:true},200,cors(env));
  }
  return null;
}

async function comments(req,env,url,user) {
  const d=db(env);
  if(url.pathname!=="/api/comments")return null;
  if(req.method==="GET"){
    const id=String(url.searchParams.get("contentId")||"").trim();if(!id)return json({error:"Conteúdo inválido."},400,cors(env));
    const r=await d.prepare(`SELECT c.id,c.content_id,c.body,c.created_at,c.updated_at,u.username,u.display_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.content_id=? AND c.status='visible' AND u.status='active' ORDER BY c.created_at DESC LIMIT 100`).bind(id).all();
    return json({comments:r.results||[]},200,cors(env));
  }
  if(!user)return json({error:"Não autenticado."},401,cors(env));
  if(req.method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),id=String(b.contentId||"").trim(),body=String(b.body||"").trim();
    if(!id||!body||body.length>MAX_COMMENT_LENGTH)return json({error:`O comentário deve ter entre 1 e ${MAX_COMMENT_LENGTH} caracteres.`},400,cors(env));
    const now=new Date().toISOString(),cid=crypto.randomUUID();
    await d.prepare(`INSERT INTO comments(id,user_id,content_id,body,status,created_at,updated_at,moderated_at,moderated_by) VALUES (?,?,?,?,?,?,?,?,?)`).bind(cid,user.id,id,body,"pending",now,now,null,null).run();
    return json({ok:true,comment:{id:cid,content_id:id,body,status:"pending",created_at:now}},201,cors(env));
  }
  if(req.method==="DELETE"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const id=String(url.searchParams.get("id")||"");
    const row=await d.prepare(`SELECT id FROM comments WHERE id=? AND user_id=?`).bind(id,user.id).first();
    if(!row)return json({error:"Comentário não encontrado."},404,cors(env));
    await d.prepare(`DELETE FROM comments WHERE id=?`).bind(id).run();return json({ok:true},200,cors(env));
  }
  return null;
}

async function adminRoutes(req,env,url,admin) {
  const d=db(env);
  if(url.pathname==="/api/admin/users"&&req.method==="GET"){
    const r=await d.prepare(`SELECT id,username,display_name,email,status,failed_login_count,last_failed_at,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 500`).all();
    return json({users:r.results||[]},200,cors(env));
  }
  if(url.pathname==="/api/admin/users/status"&&req.method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),id=String(b.id||""),status=b.status==="blocked"?"blocked":"active";
    await d.prepare(`UPDATE users SET status=?,updated_at=? WHERE id=?`).bind(status,new Date().toISOString(),id).run();
    if(status==="blocked")await d.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(id).run();
    return json({ok:true},200,cors(env));
  }
  if(url.pathname==="/api/admin/comments"&&req.method==="GET"){
    const r=await d.prepare(`SELECT c.id,c.content_id,c.body,c.status,c.created_at,c.updated_at,u.username,u.display_name,u.email FROM comments c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 500`).all();
    return json({comments:r.results||[]},200,cors(env));
  }
  if(url.pathname==="/api/admin/comments/moderate"&&req.method==="POST"){
    if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
    const b=await req.json(),status=["pending","visible","hidden"].includes(b.status)?b.status:null;
    if(!b.id||!status)return json({error:"Dados de moderação inválidos."},400,cors(env));
    const now=new Date().toISOString();
    await d.prepare(`UPDATE comments SET status=?,updated_at=?,moderated_at=?,moderated_by=? WHERE id=?`).bind(status,now,now,admin.login||"admin",String(b.id)).run();
    return json({ok:true},200,cors(env));
  }
  return null;
}

async function generate(env,kind,content) {
  if(!env.AI_API_URL||!env.AI_API_KEY||!env.AI_MODEL)throw new Error("IA não configurada no backend. Defina AI_API_URL, AI_API_KEY e AI_MODEL.");
  const prompt=kind==="social"
    ?`Crie um post curto para TikTok em português brasileiro sobre este conteúdo. Retorne texto pronto com título, gancho, roteiro, legenda, CTA, hashtags e comentário fixado. Não invente características. Dados: ${JSON.stringify(content)}`
    :`Sugira metadados em português brasileiro. Retorne JSON com description, tags (array) e slug. Não invente características. Dados: ${JSON.stringify(content)}`;
  const r=await fetch(env.AI_API_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${env.AI_API_KEY}`},body:JSON.stringify({model:env.AI_MODEL,input:prompt})});
  const d=await r.json();if(!r.ok)throw new Error(`IA ${r.status}: ${d.error?.message||"erro"}`);
  const text=d.output_text||d.output?.flatMap(x=>x.content||[]).find(x=>x.text)?.text||d.choices?.[0]?.message?.content||"";
  if(!text)throw new Error("A IA não retornou texto.");
  if(kind==="social")return {text};
  try{return {content:JSON.parse(text.replace(/^```json\s*|\s*```$/g,""))}}catch{return {content:{description:text,tags:[],slug:slugify(content.title||"conteudo")}}}
}

export default {
  async fetch(req,env) {
    try {
      envRequired(env,["GITHUB_CLIENT_ID","GITHUB_CLIENT_SECRET","GITHUB_APP_ID","GITHUB_APP_PRIVATE_KEY","GITHUB_INSTALLATION_ID","GITHUB_OWNER","GITHUB_REPO","SESSION_SECRET","ADMIN_GITHUB_LOGIN"]);
      const url=new URL(req.url),method=req.method;
      if(method==="OPTIONS")return new Response(null,{status:204,headers:cors(env)});

      if(url.pathname==="/auth/login"&&method==="GET"){
        const state=await sign({nonce:crypto.randomUUID(),exp:Math.floor(Date.now()/1000)+600},env.SESSION_SECRET);
        const callback=new URL("/auth/callback",url.origin).href;
        const location="https://github.com/login/oauth/authorize?"+new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:callback,scope:"read:user",state});
        return redirect(location);
      }

      if(url.pathname==="/auth/callback"&&method==="GET"){
        const state=url.searchParams.get("state"),code=url.searchParams.get("code");
        if(!state||!code)return new Response("Autenticação inválida.",{status:400});
        if(!await verify(state,env.SESSION_SECRET))return new Response("Estado OAuth inválido.",{status:403});
        const tr=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code})});
        const td=await tr.json();if(!td.access_token)throw new Error("GitHub não retornou um token.");
        const me=await fetch("https://api.github.com/user",{headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${td.access_token}`,"X-GitHub-Api-Version":GH_VERSION,"User-Agent":"gwzyrt-ai-Admin"}});
        const gu=await me.json();
        if(gu.login?.toLowerCase()!==String(env.ADMIN_GITHUB_LOGIN).toLowerCase())return new Response("Usuário não autorizado.",{status:403});
        const session=await sign({type:"admin",login:gu.login,id:gu.id,exp:Math.floor(Date.now()/1000)+ADMIN_SESSION_SECONDS},env.SESSION_SECRET);
        const target=new URL(env.PUBLIC_SITE_URL+"/CodigoIA/admin.html");
        target.hash="admin_token="+encodeURIComponent(session);
        const response=redirect(target.href);
        response.headers.append("Set-Cookie",cookie(ADMIN_COOKIE,session,ADMIN_SESSION_SECONDS,"None"));
        return response;
      }

      if(url.pathname==="/api/session"&&method==="GET"){
        const admin=await authAdmin(req,env);
        return json({authenticated:!!admin,user:admin?{login:admin.login}:null},200,cors(env));
      }
      if(url.pathname==="/api/logout"&&method==="POST"){
        return json({ok:true},200,{...cors(env),"Set-Cookie":clearCookie(ADMIN_COOKIE,"None")});
      }
      if(url.pathname==="/api/github-installation"&&method==="GET"){
        const admin=await authAdmin(req,env);if(!admin)return json({error:"Não autenticado."},401,cors(env));
        const i=await getInstallationInfo(env);return json({id:i.id,account:i.account?.login||null,repository_selection:i.repository_selection},200,cors(env));
      }

      const isUser=url.pathname.startsWith("/api/user/");
      if(isUser){
        const result=await userRoutes(req,env,url);
        if(result)return result;
      }
      if(url.pathname==="/api/comments"){
        const user=await authUser(req,env);
        const result=await comments(req,env,url,user);
        if(result)return result;
      }

      const admin=await authAdmin(req,env);
      if(!admin)return json({error:"Não autenticado."},401,cors(env));

      const ar=await adminRoutes(req,env,url,admin);if(ar)return ar;

      if(url.pathname==="/api/content"&&method==="GET"){
        const {codes}=await getCodes(env);return json({items:codes},200,cors(env));
      }
      if(url.pathname==="/api/content/save"&&method==="POST"){
        if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
        const p=await req.json(),current=await getCodes(env),item=cleanItem(p,current.codes);
        let codes=current.codes.filter(x=>x.id!==item.id);
        if(p.originalId&&p.originalId!==item.id)codes=codes.filter(x=>x.id!==p.originalId);
        if(codes.some(x=>x.id===item.id))throw new Error("ID já existe.");
        codes.push(item);codes.sort((a,b)=>parseInt(a.id)-parseInt(b.id));
        const files=[{path:"data/codes.json",content:JSON.stringify(codes,null,2)+"\n"}];
        if(p.imageData){
          const image=dataUrlToBytes(p.imageData);
          if(image.bytes.byteLength>2_000_000)throw new Error("Imagem acima de 2 MB após compressão.");
          const ext=image.mime==="image/webp"?"webp":image.mime==="image/png"?"png":"jpg";
          item.image=`assets/uploads/${item.id}-${item.slug}.${ext}`;
          codes[codes.findIndex(x=>x.id===item.id)]=item;
          files[0].content=JSON.stringify(codes,null,2)+"\n";
          files.push({path:item.image,content:p.imageData.split(",")[1],encoding:"base64"});
        }
        const sha=await commitFiles(env,current.token,files,`content: publicar ${item.id} ${item.title}`);
        return json({ok:true,item,items:codes,commit:sha},200,cors(env));
      }
      if(url.pathname==="/api/content/archive"&&method==="POST"){
        if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
        const {id}=await req.json(),current=await getCodes(env),content=current.codes.find(x=>x.id===id);
        if(!content)throw new Error("Conteúdo não encontrado.");
        content.status="archived";
        const codes=current.codes.map(x=>x.id===id?content:x);
        const sha=await commitFiles(env,current.token,[{path:"data/codes.json",content:JSON.stringify(codes,null,2)+"\n"}],`content: arquivar ${id}`);
        return json({ok:true,items:codes,commit:sha},200,cors(env));
      }
      if(url.pathname==="/api/generate"&&method==="POST"){
        if(!requireOrigin(req,env))return json({error:"Origem não autorizada."},403,cors(env));
        const p=await req.json();return json(await generate(env,p.kind,p.content),200,cors(env));
      }
      return json({error:"Rota não encontrada."},404,cors(env));
    }catch(e){
      return json({error:e.message||"Erro interno."},500,{...cors(env)});
    }
  }
};
