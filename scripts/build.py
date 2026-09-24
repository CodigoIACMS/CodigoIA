import json, html, shutil, os, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "codes.json"
OUT = ROOT / "go"
PAGES = ROOT / "codigo"
codes = json.loads(DATA.read_text(encoding="utf-8"))
visible = [c for c in codes if c.get("status") not in {"archived", "draft"}]

def slugify(s):
    import unicodedata
    s=unicodedata.normalize("NFD",s).encode("ascii","ignore").decode().lower()
    return re.sub(r"^-+|-+$","",re.sub(r"[^a-z0-9]+","-",s))[:80]

def clean(s):
    return html.escape(str(s or ""), quote=True)

def reset_dir(path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)

reset_dir(OUT)
reset_dir(PAGES)

for c in codes:
    cid = str(c["id"])
    target = str(c.get("url",""))
    d = OUT / cid
    d.mkdir(parents=True, exist_ok=True)
    target_html = clean(target)
    js_url = json.dumps(target)
    (d / "index.html").write_text(f'''<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url={target_html}">
<script>location.replace({js_url});</script>
<title>Abrindo...</title></head>
<body><p>Abrindo o recurso... <a href="{target_html}">continuar</a></p></body></html>''', encoding="utf-8")

site_url=os.environ.get("SITE_URL","").rstrip("/")
for c in visible:
    slug=c.get("slug") or slugify(c["title"]) or str(c["id"])
    d=PAGES/slug
    d.mkdir(parents=True,exist_ok=True)
    title=clean(c["title"])
    desc=clean(c.get("description",""))
    raw_image=str(c.get("image","assets/default.svg"))
    image=clean(raw_image if raw_image.startswith(("http://","https://","/")) else "../../"+raw_image)
    canonical=f"{site_url}/codigo/{slug}/" if site_url else f"codigo/{slug}/"
    short=f"{site_url}/go/{c['id']}/" if site_url else f"../../go/{c['id']}/"
    schema=json.dumps({"@context":"https://schema.org","@type":"SoftwareApplication" if c.get("type") in {"tool","code"} else "Article","name":c["title"],"description":c.get("description",""),"url":canonical if site_url else ""},ensure_ascii=False)
    tags=''.join(f'<span class="tag">{clean(t)}</span>' for t in c.get("tags",[]))
    (d/"index.html").write_text(f'''<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} - CodigoIA</title><meta name="description" content="{desc}">
<link rel="canonical" href="{clean(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:image" content="{image}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../../style.css"><link rel="manifest" href="../../site.webmanifest">
<script type="application/ld+json">{schema}</script>
</head><body><header class="nav"><div class="container navin"><a class="brand" href="../../index.html">CÓDIGO<span>IA</span></a><nav class="links"><a href="../../index.html">Início</a><a href="../../catalog.html">Catálogo</a></nav></div></header>
<main class="detail container"><div class="detailgrid"><div><img class="cover" src="{image}" alt="{title}"></div><div><div class="eyebrow">{clean(c.get("category","IA"))} - #{clean(c["id"])}</div><h1>{title}</h1><p>{desc}</p><div class="tags">{tags}</div><div class="tools"><a class="btn" href="{clean(short)}">Abrir recurso</a><a class="btn secondary" href="../../catalog.html">Voltar ao catálogo</a></div></div></div></main>
<footer><div class="container">CÓDIGOIA - Copie. Cole. Use.</div></footer></body></html>''',encoding="utf-8")

(ROOT/"data"/"inventory.json").write_text(json.dumps([{"id":c["id"],"slug":c.get("slug",slugify(c["title"])),"title":c["title"],"category":c.get("category",""),"status":c.get("status","published")} for c in codes],ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

if site_url:
    urls=[f"{site_url}/",f"{site_url}/catalog.html"]+[f"{site_url}/codigo/{c.get('slug') or slugify(c['title'])}/" for c in visible]+[f"{site_url}/go/{c['id']}/" for c in visible]
    (ROOT/"sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join(f"<url><loc>{html.escape(u)}</loc></url>" for u in urls)+"</urlset>\n",encoding="utf-8")
    (ROOT/"robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {site_url}/sitemap.xml\n",encoding="utf-8")
else:
    for p in [ROOT/"sitemap.xml",ROOT/"robots.txt"]:
        if p.exists(): p.unlink()

print(f"Generated {len(codes)} short-link pages, {len(visible)} SEO pages.")
