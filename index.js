/**
 * gwzyrt.ai Admin + User API
 * Cloudflare Worker — GitHub OAuth + GitHub App + D1.
 *
 * Admin (GitHub OAuth):
 * /auth/login
 * /auth/callback
 * /api/session
 * /api/logout
 * /api/github-installation
 * /api/content
 * /api/content/save
 * /api/content/archive
 * /api/generate
 *
 * Users (D1):
 * /api/user/register
 * /api/user/login
 * /api/user/session
 * /api/user/logout
 * /api/user/profile
 * /api/user/password
 * /api/user/favorites
 * /api/user/favorite
 * /api/user/like
 * /api/user/history
 * /api/comments
 * /api/admin/users
 * /api/admin/users/status
 * /api/admin/comments
 * /api/admin/comments/moderate
 */

const GH = "https://api.github.com";
const GH_VERSION = "2026-03-10";
const ADMIN_COOKIE = "codigoia_session";
const ADMIN_STATE_COOKIE = "codigoia_state";
const USER_COOKIE = "gwzyrt_session";
const USER_SESSION_SECONDS = 60 * 60 * 24 * 30;
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const PASSWORD_ITERATIONS_DEFAULT = 120000;
const LOGIN_MAX_FAILURES = 8;
const LOGIN_LOCK_SECONDS = 15 * 60;
const MAX_COMMENT_LENGTH = 2000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra
    }
  });
}

function redirect(url, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: url, ...headers } });
}

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function ub64(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function hmac(secret, data, op = "sign") {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [op]
  );
  return crypto.subtle[op]("HMAC", key, encoder.encode(data));
}

async function sign(payload, secret) {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  return body + "." + b64url(await hmac(secret, body));
}

async function verify(token, secret) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      ub64(sig),
      encoder.encode(body)
    );
    if (!ok) return null;
    const payload = JSON.parse(decoder.decode(ub64(body)));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookie(name, value, maxAge, sameSite = "None") {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function clearCookie(name, sameSite = "None") {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=${sameSite}`;
}

function getCookie(req, name) {
  const cookies = req.headers.get("Cookie") || "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookies.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? match[1] : null;
}

function envRequired(env, names) {
  for (const name of names) {
    if (!env[name]) throw new Error(`Configuração ausente: ${name}`);
  }
}

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.PUBLIC_SITE_URL || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Vary": "Origin"
  };
}

function requireOrigin(req, env) {
  const origin = req.headers.get("Origin");
  if (!origin) return true;
  return origin === String(env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
}

function requireDB(env) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new Error("D1 não configurado. Verifique o binding DB do Worker.");
  }
  return env.DB;
}

function ghHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": GH_VERSION,
    "User-Agent": "gwzyrt-ai-Admin"
  };
}

async function gh(path, token, init = {}) {
  const r = await fetch(GH + path, {
    ...init,
    headers: { ...ghHeaders(token), ...(init.headers || {}) }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${data.message || "erro"}`);
  return data;
}

function pemToDer(pem) {
  return Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    c => c.charCodeAt(0)
  );
}

async function appJwt(env) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(encoder.encode(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: String(env.GITHUB_APP_ID)
  })));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(head + "." + body)
  );
  return head + "." + body + "." + b64url(signature);
}

async function installationToken(env) {
  const token = await gh(
    `/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,
    await appJwt(env),
    { method: "POST" }
  );
  return token.token;
}

async function getInstallationInfo(env) {
  const jwt = await appJwt(env);
  return await gh(
    `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/installation`,
    jwt
  );
}

async function getCodes(env) {
  const token = await installationToken(env);
  const d = await gh(
    `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/data/codes.json?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`,
    token
  );
  const raw = atob(d.content.replace(/\n/g, ""));
  return {
    token,
    codes: JSON.parse(decoder.decode(Uint8Array.from(raw, c => c.charCodeAt(0)))),
    sha: d.sha
  };
}

function nextId(codes) {
  return String(
    Math.max(0, ...codes.map(x => parseInt(x.id, 10)).filter(Number.isFinite)) + 1
  ).padStart(3, "0");
}

function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return v;
  } catch {
    throw new Error("URL inválida.");
  }
}

function cleanItem(p, codes) {
  if (!p.title || !p.url || !p.category) {
    throw new Error("Título, categoria e URL são obrigatórios.");
  }
  const id = String(p.originalId || p.id || nextId(codes));
  const slug = p.slug || slugify(p.title);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error("Slug inválido.");
  return {
    id,
    title: String(p.title).trim().slice(0, 200),
    slug,
    category: String(p.category).trim().slice(0, 100),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 30).map(String) : [],
    description: String(p.description || "").trim().slice(0, 5000),
    image: p.image || "assets/default.svg",
    url: cleanUrl(p.url),
    code: String(p.code || ""),
    prompt: String(p.prompt || ""),
    type: p.type || "code",
    status: p.status || "draft",
    access: p.access || "free",
    linkType: p.linkType || "normal",
    partner: String(p.partner || ""),
    campaign: String(p.campaign || ""),
    tiktokUrl: cleanUrl(p.tiktokUrl || ""),
    youtubeUrl: cleanUrl(p.youtubeUrl || ""),
    instagramUrl: cleanUrl(p.instagramUrl || ""),
    facebookUrl: cleanUrl(p.facebookUrl || ""),
    discordUrl: cleanUrl(p.discordUrl || ""),
    telegramUrl: cleanUrl(p.telegramUrl || ""),
    featured: !!p.featured,
    publishedAt: p.publishedAt || ""
  };
}

async function commitFiles(env, token, files, message) {
  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const branch = env.GITHUB_BRANCH || "main";
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  const commit = await gh(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, token);
  const tree = [];
  for (const f of files) {
    if (f.encoding === "base64") {
      const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: f.content, encoding: "base64" })
      });
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    } else {
      tree.push({ path: f.path, mode: "100644", type: "blob", content: f.content });
    }
  }
  const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: commit.tree.sha, tree })
  });
  const newCommit = await gh(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [commit.sha]
    })
  });
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
  return newCommit.sha;
}

function dataUrlToBytes(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Imagem inválida.");
  return {
    mime: m[1],
    bytes: Uint8Array.from(atob(m[2]), c => c.charCodeAt(0))
  };
}

async function generate(env, kind, content) {
  if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error("IA não configurada no backend. Defina AI_API_URL, AI_API_KEY e AI_MODEL.");
  }
  const prompt = kind === "social"
    ? `Crie um post curto para TikTok em português brasileiro sobre este conteúdo. Retorne texto pronto com: título do vídeo, gancho, roteiro curto, legenda, CTA, hashtags e comentário fixado. Não invente características do produto. Dados: ${JSON.stringify(content)}`
    : `Sugira metadados para este conteúdo em português brasileiro. Retorne JSON com description, tags (array), slug. Não invente características. Dados: ${JSON.stringify(content)}`;
  const r = await fetch(env.AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.AI_API_KEY}`
    },
    body: JSON.stringify({ model: env.AI_MODEL, input: prompt })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`IA ${r.status}: ${d.error?.message || "erro"}`);
  const text = d.output_text || d.output?.flatMap(x => x.content || []).find(x => x.text)?.text || d.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("A IA não retornou texto.");
  if (kind === "social") return { text };
  try {
    return { content: JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) };
  } catch {
    return { content: { description: text, tags: [], slug: slugify(content.title || "conteudo") } };
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function passwordHash(password, salt, iterations = PASSWORD_ITERATIONS_DEFAULT) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations, hash: "SHA-256" },
    baseKey,
    256
  );
  return b64url(bits);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim().toLowerCase());
}

function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(String(username || "").trim());
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    email: row.email,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null
  };
}

async function createUserSession(env, userId) {
  const db = requireDB(env);
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + USER_SESSION_SECONDS * 1000).toISOString();
  await db.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(id, userId, hash, expires, now.toISOString(), now.toISOString()).run();
  return { raw, expires };
}

async function authAdmin(req, env) {
  const token = getCookie(req, ADMIN_COOKIE);
  if (!token) return null;
  const session = await verify(token, env.SESSION_SECRET);
  if (!session) return null;
  if (session.type !== "admin") return null;
  if (!session.login || String(session.login).toLowerCase() !== String(env.ADMIN_GITHUB_LOGIN || "").toLowerCase()) return null;
  return session;
}

async function authUser(req, env) {
  const db = requireDB(env);
  const raw = getCookie(req, USER_COOKIE);
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const row = await db.prepare(
    `SELECT s.id,s.user_id,s.expires_at,u.id AS uid,u.username,u.display_name,u.email,u.status,u.created_at,u.last_login_at
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? LIMIT 1`
  ).bind(hash).first();
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString() || row.status !== "active") {
    await db.prepare(`DELETE FROM sessions WHERE id=?`).bind(row.id).run();
    return null;
  }
  await db.prepare(`UPDATE sessions SET last_seen_at=? WHERE id=?`).bind(new Date().toISOString(), row.id).run();
  return { sessionId: row.id, ...publicUser({
    id: row.uid,
    username: row.username,
    display_name: row.display_name,
    email: row.email,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at
  }) };
}

function userCookieHeader(raw) {
  return cookie(USER_COOKIE, raw, USER_SESSION_SECONDS, "None");
}

async function handleUserRoutes(req, env, url) {
  const db = requireDB(env);
  const method = req.method;

  if (url.pathname === "/api/user/session" && method === "GET") {
    const user = await authUser(req, env);
    return json({ authenticated: !!user, user: user || null }, 200, cors(env));
  }

  if (url.pathname === "/api/user/register" && method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const username = String(body.username || "").trim();
    const displayName = String(body.displayName || username).trim().slice(0, 80);
    const email = String(body.email || "").trim().toLowerCase();
    const password = body.password;
    if (!validUsername(username)) return json({ error: "Usuário inválido. Use 3–30 caracteres: letras, números ou _." }, 400, cors(env));
    if (!validEmail(email)) return json({ error: "E-mail inválido." }, 400, cors(env));
    if (!validPassword(password)) return json({ error: "A senha deve ter entre 8 e 128 caracteres." }, 400, cors(env));
    if (displayName.length < 1) return json({ error: "Nome de exibição obrigatório." }, 400, cors(env));

    const existing = await db.prepare(
      `SELECT id,username,email FROM users WHERE lower(email)=? OR lower(username)=? LIMIT 1`
    ).bind(email, username.toLowerCase()).first();
    if (existing) {
      if (String(existing.email).toLowerCase() === email) return json({ error: "E-mail já cadastrado." }, 409, cors(env));
      return json({ error: "Nome de usuário já está em uso." }, 409, cors(env));
    }

    const id = crypto.randomUUID();
    const salt = randomToken();
    const iterations = PASSWORD_ITERATIONS_DEFAULT;
    const hash = await passwordHash(password, salt, iterations);
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO users
       (id,email,username,display_name,password_hash,password_salt,password_iterations,status,failed_login_count,last_failed_at,created_at,updated_at,last_login_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id,email,username,displayName,hash,salt,iterations,"active",0,null,now,now,null).run();

    const session = await createUserSession(env, id);
    const user = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(id).first();
    return json(
      { ok: true, authenticated: true, user: publicUser(user) },
      201,
      { ...cors(env), "Set-Cookie": userCookieHeader(session.raw) }
    );
  }

  if (url.pathname === "/api/user/login" && method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = body.password;
    const generic = "E-mail ou senha inválidos.";
    if (!validEmail(email) || typeof password !== "string") return json({ error: generic }, 401, cors(env));

    const row = await db.prepare(`SELECT * FROM users WHERE lower(email)=? LIMIT 1`).bind(email).first();
    if (!row) return json({ error: generic }, 401, cors(env));
    if (row.status !== "active") return json({ error: "Esta conta está bloqueada." }, 403, cors(env));

    const nowMs = Date.now();
    const lastFailedMs = row.last_failed_at ? Date.parse(row.last_failed_at) : 0;
    const failuresBefore = Number(row.failed_login_count || 0);
    if (failuresBefore >= LOGIN_MAX_FAILURES && lastFailedMs && nowMs - lastFailedMs < LOGIN_LOCK_SECONDS * 1000) {
      return json({ error: "Muitas tentativas. Tente novamente mais tarde." }, 429, cors(env));
    }

    const iterations = Number(row.password_iterations) || PASSWORD_ITERATIONS_DEFAULT;
    const hash = await passwordHash(password, row.password_salt, iterations);
    if (hash !== row.password_hash) {
      const failures = lastFailedMs && nowMs - lastFailedMs < LOGIN_LOCK_SECONDS * 1000
        ? failuresBefore + 1
        : 1;
      const failedAt = new Date().toISOString();
      await db.prepare(
        `UPDATE users SET failed_login_count=?,last_failed_at=?,updated_at=? WHERE id=?`
      ).bind(failures, failedAt, failedAt, row.id).run();
      return json({ error: generic }, 401, cors(env));
    }

    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE users SET failed_login_count=0,last_failed_at=NULL,last_login_at=?,updated_at=? WHERE id=?`
    ).bind(now, now, row.id).run();
    const session = await createUserSession(env, row.id);
    const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(row.id).first();
    return json(
      { ok: true, authenticated: true, user: publicUser(fresh) },
      200,
      { ...cors(env), "Set-Cookie": userCookieHeader(session.raw) }
    );
  }

  const protectedRoute = [
    "/api/user/logout",
    "/api/user/profile",
    "/api/user/password"
  ].includes(url.pathname);
  if (!protectedRoute) return null;

  const user = await authUser(req, env);
  if (!user) return json({ error: "Não autenticado." }, 401, cors(env));

  if (url.pathname === "/api/user/logout" && method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    await db.prepare(`DELETE FROM sessions WHERE id=?`).bind(user.sessionId).run();
    return json({ ok: true }, 200, { ...cors(env), "Set-Cookie": clearCookie(USER_COOKIE) });
  }

  if (url.pathname === "/api/user/profile" && method === "GET") {
    return json({ user }, 200, cors(env));
  }

  if (url.pathname === "/api/user/profile" && method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const displayName = String(body.displayName ?? body.display_name ?? "").trim().slice(0, 80);
    if (displayName.length < 1) return json({ error: "Nome de exibição obrigatório." }, 400, cors(env));
    await db.prepare(`UPDATE users SET display_name=?,updated_at=? WHERE id=?`).bind(displayName,new Date().toISOString(),user.id).run();
    const fresh = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(user.id).first();
    return json({ ok: true, user: publicUser(fresh) }, 200, cors(env));
  }

  if (url.pathname === "/api/user/password" && method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const currentPassword = body.currentPassword;
    const newPassword = body.newPassword;
    if (!validPassword(newPassword)) return json({ error: "A nova senha deve ter entre 8 e 128 caracteres." }, 400, cors(env));
    const row = await db.prepare(`SELECT * FROM users WHERE id=?`).bind(user.id).first();
    const oldHash = await passwordHash(currentPassword || "", row.password_salt, Number(row.password_iterations) || PASSWORD_ITERATIONS_DEFAULT);
    if (oldHash !== row.password_hash) return json({ error: "Senha atual incorreta." }, 401, cors(env));
    const salt = randomToken();
    const hash = await passwordHash(newPassword, salt, PASSWORD_ITERATIONS_DEFAULT);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=? WHERE id=?`).bind(hash,salt,PASSWORD_ITERATIONS_DEFAULT,now,user.id).run();
    await db.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(user.id).run();
    const session = await createUserSession(env, user.id);
    return json({ ok: true }, 200, { ...cors(env), "Set-Cookie": userCookieHeader(session.raw) });
  }

  return null;
}

async function handleFavoriteRoutes(req, env, url, user) {
  const db = requireDB(env);
  if (url.pathname === "/api/user/favorites" && req.method === "GET") {
    const result = await db.prepare(
      `SELECT content_id,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC`
    ).bind(user.id).all();
    return json({ favorites: result.results || [] }, 200, cors(env));
  }
  if (url.pathname === "/api/user/favorite" && req.method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const contentId = String(body.contentId || "").trim();
    if (!contentId || contentId.length > 100) return json({ error: "Conteúdo inválido." }, 400, cors(env));
    await db.prepare(`INSERT OR IGNORE INTO favorites(user_id,content_id,created_at) VALUES (?,?,?)`).bind(user.id,contentId,new Date().toISOString()).run();
    return json({ ok: true, favorited: true }, 200, cors(env));
  }
  if (url.pathname === "/api/user/favorite" && req.method === "DELETE") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const contentId = String(url.searchParams.get("contentId") || "").trim();
    await db.prepare(`DELETE FROM favorites WHERE user_id=? AND content_id=?`).bind(user.id,contentId).run();
    return json({ ok: true, favorited: false }, 200, cors(env));
  }
  return null;
}

async function handleLikeRoutes(req, env, url, user) {
  const db = requireDB(env);
  if (url.pathname === "/api/user/like" && req.method === "GET") {
    const contentId = String(url.searchParams.get("contentId") || "").trim();
    if (!contentId) return json({ error: "Conteúdo inválido." }, 400, cors(env));
    const row = await db.prepare(`SELECT 1 FROM likes WHERE user_id=? AND content_id=? LIMIT 1`).bind(user.id,contentId).first();
    const count = await db.prepare(`SELECT COUNT(*) AS count FROM likes WHERE content_id=?`).bind(contentId).first();
    return json({ liked: !!row, count: Number(count?.count || 0) }, 200, cors(env));
  }
  if (url.pathname === "/api/user/like" && req.method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const contentId = String(body.contentId || "").trim();
    if (!contentId || contentId.length > 100) return json({ error: "Conteúdo inválido." }, 400, cors(env));
    const row = await db.prepare(`SELECT 1 FROM likes WHERE user_id=? AND content_id=? LIMIT 1`).bind(user.id,contentId).first();
    let liked;
    if (row) {
      await db.prepare(`DELETE FROM likes WHERE user_id=? AND content_id=?`).bind(user.id,contentId).run();
      liked = false;
    } else {
      await db.prepare(`INSERT INTO likes(user_id,content_id,created_at) VALUES (?,?,?)`).bind(user.id,contentId,new Date().toISOString()).run();
      liked = true;
    }
    const count = await db.prepare(`SELECT COUNT(*) AS count FROM likes WHERE content_id=?`).bind(contentId).first();
    return json({ ok: true, liked, count: Number(count?.count || 0) }, 200, cors(env));
  }
  return null;
}

async function handleHistoryRoutes(req, env, url, user) {
  const db = requireDB(env);
  if (url.pathname === "/api/user/history" && req.method === "GET") {
    const result = await db.prepare(
      `SELECT content_id,view_count,first_viewed_at,last_viewed_at FROM history WHERE user_id=? ORDER BY last_viewed_at DESC LIMIT 100`
    ).bind(user.id).all();
    return json({ history: result.results || [] }, 200, cors(env));
  }
  if (url.pathname === "/api/user/history" && req.method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const contentId = String(body.contentId || "").trim();
    if (!contentId || contentId.length > 100) return json({ error: "Conteúdo inválido." }, 400, cors(env));
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO history(user_id,content_id,view_count,first_viewed_at,last_viewed_at)
       VALUES (?,?,1,?,?)
       ON CONFLICT(user_id,content_id) DO UPDATE SET view_count=view_count+1,last_viewed_at=excluded.last_viewed_at`
    ).bind(user.id,contentId,now,now).run();
    return json({ ok: true }, 200, cors(env));
  }
  if (url.pathname === "/api/user/history" && req.method === "DELETE") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    await db.prepare(`DELETE FROM history WHERE user_id=?`).bind(user.id).run();
    return json({ ok: true }, 200, cors(env));
  }
  return null;
}

async function handleCommentRoutes(req, env, url, user) {
  const db = requireDB(env);
  if (url.pathname === "/api/comments" && req.method === "GET") {
    const contentId = String(url.searchParams.get("contentId") || "").trim();
    if (!contentId) return json({ error: "Conteúdo inválido." }, 400, cors(env));
    const result = await db.prepare(
      `SELECT c.id,c.content_id,c.body,c.created_at,c.updated_at,u.username,u.display_name
       FROM comments c JOIN users u ON u.id=c.user_id
       WHERE c.content_id=? AND c.status='visible' AND u.status='active'
       ORDER BY c.created_at DESC LIMIT 100`
    ).bind(contentId).all();
    return json({ comments: result.results || [] }, 200, cors(env));
  }
  if (url.pathname === "/api/comments" && req.method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const contentId = String(body.contentId || "").trim();
    const text = String(body.body || "").trim();
    if (!contentId || contentId.length > 100) return json({ error: "Conteúdo inválido." }, 400, cors(env));
    if (!text || text.length > MAX_COMMENT_LENGTH) return json({ error: `O comentário deve ter entre 1 e ${MAX_COMMENT_LENGTH} caracteres.` }, 400, cors(env));
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO comments(id,user_id,content_id,body,status,created_at,updated_at,moderated_at,moderated_by)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(id,user.id,contentId,text,"pending",now,now,null,null).run();
    return json({ ok: true, comment: { id, content_id: contentId, body: text, status: "pending", created_at: now } }, 201, cors(env));
  }
  if (url.pathname === "/api/comments" && req.method === "DELETE") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const id = String(url.searchParams.get("id") || "").trim();
    const row = await db.prepare(`SELECT id FROM comments WHERE id=? AND user_id=?`).bind(id,user.id).first();
    if (!row) return json({ error: "Comentário não encontrado." }, 404, cors(env));
    await db.prepare(`DELETE FROM comments WHERE id=?`).bind(id).run();
    return json({ ok: true }, 200, cors(env));
  }
  return null;
}

async function handleAdminRoutes(req, env, url, admin) {
  const db = requireDB(env);
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const result = await db.prepare(
      `SELECT id,username,display_name,email,status,failed_login_count,last_failed_at,created_at,last_login_at
       FROM users ORDER BY created_at DESC LIMIT 500`
    ).all();
    return json({ users: result.results || [] }, 200, cors(env));
  }
  if (url.pathname === "/api/admin/users/status" && req.method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const id = String(body.id || "").trim();
    const status = body.status === "blocked" ? "blocked" : "active";
    if (!id) return json({ error: "Usuário inválido." }, 400, cors(env));
    await db.prepare(`UPDATE users SET status=?,updated_at=? WHERE id=?`).bind(status,new Date().toISOString(),id).run();
    if (status === "blocked") await db.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(id).run();
    return json({ ok: true }, 200, cors(env));
  }
  if (url.pathname === "/api/admin/comments" && req.method === "GET") {
    const result = await db.prepare(
      `SELECT c.id,c.content_id,c.body,c.status,c.created_at,c.updated_at,u.username,u.display_name,u.email
       FROM comments c JOIN users u ON u.id=c.user_id
       ORDER BY c.created_at DESC LIMIT 500`
    ).all();
    return json({ comments: result.results || [] }, 200, cors(env));
  }
  if (url.pathname === "/api/admin/comments/moderate" && req.method === "POST") {
    if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
    const body = await req.json();
    const id = String(body.id || "").trim();
    const status = ["pending","visible","hidden"].includes(body.status) ? body.status : null;
    if (!id || !status) return json({ error: "Dados de moderação inválidos." }, 400, cors(env));
    await db.prepare(
      `UPDATE comments SET status=?,updated_at=?,moderated_at=?,moderated_by=? WHERE id=?`
    ).bind(status,new Date().toISOString(),new Date().toISOString(),admin.login || "admin",id).run();
    return json({ ok: true }, 200, cors(env));
  }
  return null;
}

export default {
  async fetch(req, env) {
    try {
      envRequired(env, [
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "GITHUB_APP_ID",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_INSTALLATION_ID",
        "GITHUB_OWNER",
        "GITHUB_REPO",
        "SESSION_SECRET",
        "ADMIN_GITHUB_LOGIN"
      ]);

      const url = new URL(req.url);
      const method = req.method;

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors(env) });
      }

      if (url.pathname === "/auth/login" && method === "GET") {
        const state = await sign({
          nonce: crypto.randomUUID(),
          exp: Math.floor(Date.now() / 1000) + 600
        }, env.SESSION_SECRET);
        const callback = new URL("/auth/callback", url.origin).href;
        const location = "https://github.com/login/oauth/authorize?" + new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID,
          redirect_uri: callback,
          scope: "read:user",
          state
        });
        return redirect(location);
      }

      if (url.pathname === "/auth/callback" && method === "GET") {
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (!state || !code) return new Response("Autenticação inválida.", { status: 400 });
        const verified = await verify(state, env.SESSION_SECRET);
        if (!verified) return new Response("Estado OAuth inválido.", { status: 403 });

        const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code
          })
        });
        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) throw new Error("GitHub não retornou um token.");

        const me = await fetch("https://api.github.com/user", {
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${tokenData.access_token}`,
            "X-GitHub-Api-Version": GH_VERSION,
            "User-Agent": "gwzyrt-ai-Admin"
          }
        });
        const githubUser = await me.json();
        if (githubUser.login?.toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) {
          return new Response("Usuário não autorizado.", { status: 403 });
        }

        const session = await sign({
          type: "admin",
          login: githubUser.login,
          id: githubUser.id,
          exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS
        }, env.SESSION_SECRET);
        const response = redirect(`${env.PUBLIC_SITE_URL}/CodigoIA/admin.html`);
        response.headers.append("Set-Cookie", cookie(ADMIN_COOKIE, session, ADMIN_SESSION_SECONDS, "None"));
        return response;
      }

      if (url.pathname === "/api/session" && method === "GET") {
        const admin = await authAdmin(req, env);
        return json({ authenticated: !!admin, user: admin ? { login: admin.login } : null }, 200, cors(env));
      }

      if (url.pathname === "/api/logout" && method === "POST") {
        return json({ ok: true }, 200, { ...cors(env), "Set-Cookie": clearCookie(ADMIN_COOKIE, "None") });
      }

      if (url.pathname === "/api/github-installation" && method === "GET") {
        const admin = await authAdmin(req, env);
        if (!admin) return json({ error: "Não autenticado." }, 401, cors(env));
        const info = await getInstallationInfo(env);
        return json({
          id: info.id,
          account: info.account?.login || null,
          repository_selection: info.repository_selection
        }, 200, cors(env));
      }

      const publicUserRoute = url.pathname.startsWith("/api/user/") || url.pathname === "/api/comments";
      if (publicUserRoute) {
        const handled = await handleUserRoutes(req, env, url);
        if (handled) return handled;

        const user = await authUser(req, env);
        if (url.pathname === "/api/comments" && method === "GET") {
          return handleCommentRoutes(req, env, url, user);
        }
        if (!user) return json({ error: "Não autenticado." }, 401, cors(env));
        return (
          await handleFavoriteRoutes(req, env, url, user) ||
          await handleLikeRoutes(req, env, url, user) ||
          await handleHistoryRoutes(req, env, url, user) ||
          await handleCommentRoutes(req, env, url, user) ||
          json({ error: "Rota não encontrada." }, 404, cors(env))
        );
      }

      const admin = await authAdmin(req, env);
      if (!admin) return json({ error: "Não autenticado." }, 401, cors(env));

      const adminHandled = await handleAdminRoutes(req, env, url, admin);
      if (adminHandled) return adminHandled;

      if (url.pathname === "/api/content" && method === "GET") {
        const { codes } = await getCodes(env);
        return json({ items: codes }, 200, cors(env));
      }

      if (url.pathname === "/api/content/save" && method === "POST") {
        if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
        const p = await req.json();
        const current = await getCodes(env);
        const item = cleanItem(p, current.codes);
        let codes = current.codes.filter(x => x.id !== item.id);
        if (p.originalId && p.originalId !== item.id) codes = codes.filter(x => x.id !== p.originalId);
        if (codes.some(x => x.id === item.id)) throw new Error("ID já existe.");
        codes.push(item);
        codes.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
        const files = [{ path: "data/codes.json", content: JSON.stringify(codes, null, 2) + "\n" }];
        if (p.imageData) {
          const image = dataUrlToBytes(p.imageData);
          if (image.bytes.byteLength > 2_000_000) throw new Error("Imagem acima de 2 MB após compressão.");
          const ext = image.mime === "image/webp" ? "webp" : image.mime === "image/png" ? "png" : "jpg";
          item.image = `assets/uploads/${item.id}-${item.slug}.${ext}`;
          codes[codes.findIndex(x => x.id === item.id)] = item;
          files[0].content = JSON.stringify(codes, null, 2) + "\n";
          files.push({ path: item.image, content: p.imageData.split(",")[1], encoding: "base64" });
        }
        const sha = await commitFiles(env, current.token, files, `content: publicar ${item.id} ${item.title}`);
        return json({ ok: true, item, items: codes, commit: sha }, 200, cors(env));
      }

      if (url.pathname === "/api/content/archive" && method === "POST") {
        if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
        const { id } = await req.json();
        const current = await getCodes(env);
        const content = current.codes.find(x => x.id === id);
        if (!content) throw new Error("Conteúdo não encontrado.");
        content.status = "archived";
        const codes = current.codes.map(x => x.id === id ? content : x);
        const sha = await commitFiles(
          env,
          current.token,
          [{ path: "data/codes.json", content: JSON.stringify(codes, null, 2) + "\n" }],
          `content: arquivar ${id}`
        );
        return json({ ok: true, items: codes, commit: sha }, 200, cors(env));
      }

      if (url.pathname === "/api/generate" && method === "POST") {
        if (!requireOrigin(req, env)) return json({ error: "Origem não autorizada." }, 403, cors(env));
        const p = await req.json();
        return json(await generate(env, p.kind, p.content), 200, cors(env));
      }

      return json({ error: "Rota não encontrada." }, 404, cors(env));
    } catch (e) {
      return json(
        { error: e.message || "Erro interno." },
        500,
        { "Access-Control-Allow-Origin": env.PUBLIC_SITE_URL || "*", "Access-Control-Allow-Credentials": "true" }
      );
    }
  }
};
