# CódigoIA

**Códigos, prompts e ferramentas de IA que você pode copiar e usar.**  
**Copie. Cole. Use.**

O projeto mantém o site público estático e adiciona uma camada administrativa segura, sem colocar tokens do GitHub no navegador.

## Arquitetura V3

```text
VISITANTE
   |
   v
GitHub Pages
   |
   +--> catálogo / páginas SEO / links /go/ID/

ADMINISTRADOR
   |
   v
admin.html
   |
   v
Cloudflare Worker (API)
   |
   +--> GitHub OAuth: identifica o administrador
   |
   +--> GitHub App: recebe token de instalação no backend
   |
   +--> GitHub REST API
           |
           v
       codes.json + imagens
           |
           v
       GitHub Actions
           |
           v
       build.py
           |
           +--> /go/ID/
           +--> /codigo/slug/
           +--> sitemap.xml
           +--> robots.txt
           |
           v
       GitHub Pages
```

O site público continua compatível com GitHub Pages. O backend só é necessário para funções administrativas, autenticação, escrita no GitHub e geração opcional por IA.

A API usa secrets do Cloudflare Worker; a documentação do Cloudflare recomenda secrets para chaves e tokens e alerta para não colocar segredos em `vars` ou no código-fonte.

A escrita do repositório usa a API Git do GitHub para criar uma árvore, um commit e atualizar a referência, permitindo publicar os arquivos da operação em um commit.

## O que já existia e foi preservado

- Home.
- Catálogo.
- Busca por texto.
- Filtro por categoria.
- Cards.
- Página individual.
- `data/codes.json`.
- Links `/go/ID/`.
- `build.py`.
- GitHub Actions.
- Issue template.
- Manifest.
- Identidade visual dark/tech.
- Compatibilidade com GitHub Pages.

## O que foi evoluído

### Painel administrativo

Agora o `admin.html` foi transformado em cliente de uma API autenticada e permite:

- login com GitHub;
- cadastro;
- edição;
- ID automático;
- slug automático;
- tags;
- categoria;
- descrição;
- URL;
- código;
- prompt;
- tipo;
- status;
- gratuito/premium;
- afiliado/patrocinado;
- parceiro;
- campanha;
- destaque;
- data;
- upload de capa;
- preview;
- compressão/redimensionamento no navegador;
- publicação;
- arquivamento lógico;
- geração auxiliar por IA;
- geração de post para TikTok.

### Imagens

A imagem selecionada no painel é redimensionada para no máximo 1600 px no navegador e convertida para WebP antes do upload, quando o navegador suporta essa conversão.

O backend grava a imagem no próprio repositório em:

```text
assets/uploads/ID-slug.webp
```

A operação é feita no backend; o navegador nunca recebe uma credencial de escrita do GitHub.

### SEO

O build agora prepara:

- páginas estáticas `/codigo/slug/`;
- canonical;
- meta description;
- Open Graph;
- Twitter/X card;
- JSON-LD;
- `sitemap.xml`;
- `robots.txt`.

O sitemap só é gerado quando `SITE_URL` está configurado. Nenhum domínio é inventado.

### Links curtos

`/go/001/`, `/go/002/` etc. continuam sendo gerados por ID.

O ID é estável mesmo quando o slug ou destino muda.

### Monetização

O modelo de conteúdo já aceita:

- `access`: `free` ou `premium`;
- `linkType`: `normal`, `affiliate` ou `sponsored`;
- `partner`;
- `campaign`.

Pagamentos e área premium ainda não são ativados; a estrutura fica pronta para essa etapa.

### Analytics

A estrutura de conteúdo já possui `campaign` e `linkType`, e os links curtos continuam separados por ID, o que permite acrescentar rastreamento/UTM sem alterar a identidade do recurso.

A coleta persistente de métricas ainda depende de escolher e configurar um provedor de analytics ou um armazenamento próprio. Não foi criado um banco falso apenas para simular métricas.

## Configuração do backend

Entre em:

```text
api/
```

Arquivos principais:

- `api/src/index.js`
- `api/wrangler.toml`
- `api/.dev.vars.example`

### 1. GitHub App

Crie uma GitHub App e instale-a **somente no repositório do CódigoIA**.

A App precisa de permissão de conteúdo do repositório para escrita. A API do GitHub documenta que operações de árvore/commit aceitam tokens de instalação de GitHub App com permissão `Contents: write`.

Também habilite o fluxo OAuth da App.

No OAuth, o projeto usa o login do GitHub somente para identificar o administrador. O token usado para escrever no repositório vem da instalação da GitHub App, não fica no frontend.

O GitHub recomenda considerar GitHub Apps em vez de OAuth Apps quando apropriado, principalmente porque Apps permitem permissões mais granulares e tokens de instalação de curta duração.

### 2. Variáveis públicas do Worker

Edite `api/wrangler.toml`:

```toml
[vars]
GITHUB_APP_ID = "SEU_APP_ID"
GITHUB_INSTALLATION_ID = "SUA_INSTALLATION_ID"
GITHUB_OWNER = "SEU_USUARIO_OU_ORG"
GITHUB_REPO = "SEU_REPOSITORIO"
GITHUB_BRANCH = "main"
PUBLIC_SITE_URL = "https://SEU_SITE"
ADMIN_GITHUB_LOGIN = "SEU_LOGIN"
```

Não coloque segredos nesses campos.

### 3. Secrets

Configure:

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
SESSION_SECRET
```

Com Wrangler:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put SESSION_SECRET
```

O Cloudflare documenta `wrangler secret put` como mecanismo para armazenar segredos do Worker.

### 4. URL de callback

A GitHub App deve apontar o callback OAuth para:

```text
https://SEU-WORKER/auth/callback
```

O Worker gera esse endereço dinamicamente a partir da URL em que está sendo executado.

## IA

A geração de IA é propositalmente opcional.

O Worker aceita:

```text
AI_API_URL
AI_API_KEY
AI_MODEL
```

Quando essas três variáveis não existem, os botões de IA informam que a IA ainda não foi configurada.

Isso evita colocar uma chave de IA no frontend.

Para um provedor específico, configure o endpoint e o formato compatível no backend antes de usar em produção. O código atual envia um corpo compatível com a Responses API quando `AI_API_URL` aponta para um endpoint desse formato, mas não inclui nenhuma chave ou modelo real.

## Configuração do painel

Depois de publicar o Worker, edite:

```text
admin-config.js
```

e coloque somente a URL pública do Worker:

```js
window.CODIGOIA_API_URL = "https://SEU-WORKER";
```

Esse endereço não é segredo.

Não coloque:

- GitHub App private key;
- GitHub client secret;
- token de GitHub;
- chave de IA;
- `SESSION_SECRET`

nesse arquivo.

## GitHub Pages

O site público continua funcionando como antes:

1. envie o projeto para a branch `main`;
2. ative GitHub Pages;
3. use a raiz do repositório como fonte;
4. configure uma variável de repositório chamada `SITE_URL` com a URL pública real do site.

Exemplo de valor:

```text
https://seu-dominio-real
```

Não copie esse exemplo literalmente.

O workflow usa `SITE_URL` somente para gerar URLs absolutas do sitemap e canonical.

## Fluxo de publicação

```text
Login
  ↓
Novo conteúdo
  ↓
Imagem / título / URL / metadados
  ↓
Gerar com IA (opcional)
  ↓
Revisar
  ↓
PUBLICAR
  ↓
Cloudflare Worker
  ↓
GitHub App
  ↓
Commit
  ↓
GitHub Actions
  ↓
build.py
  ↓
/go/ID/
/codigo/slug/
sitemap.xml
robots.txt
  ↓
GitHub Pages
```

## Exclusão

O painel usa arquivamento lógico.

Em vez de apagar imediatamente um item de `codes.json`, ele muda:

```json
"status": "archived"
```

Isso reduz o risco de perda acidental e preserva o histórico no Git.

## Segurança

Não existe Personal Access Token no frontend.

O fluxo é:

```text
Browser
  ↓
OAuth
  ↓
Worker
  ↓
GitHub App installation token
  ↓
GitHub API
```

As credenciais ficam no backend. O Cloudflare recomenda manter chaves e tokens como secrets, não em variáveis públicas ou no código.

## Teste local

O build público não precisa de Node:

```bash
python scripts/build.py
```

Para o Worker:

```bash
cd api
npm install -D wrangler
npx wrangler dev
```

Use `api/.dev.vars` localmente. Não faça commit desse arquivo.

## Verificação

O workflow existente valida:

- JSON;
- IDs duplicados;
- campos obrigatórios;
- build;
- geração dos links.

A estrutura nova também deve ser validada antes de publicar:

```bash
python -m py_compile scripts/build.py
python scripts/build.py
```

## Limitações que ainda dependem de configuração

Estas partes não podem ser preenchidas sem dados reais do proprietário:

- GitHub App;
- App ID;
- Installation ID;
- OAuth client ID;
- OAuth client secret;
- private key da App;
- login autorizado;
- URL real do site;
- URL real do Worker;
- provedor/modelo de IA;
- provedor de analytics;
- domínio personalizado, se desejado.

Nenhuma dessas credenciais foi inventada ou incluída no pacote.

## Próximas evoluções

1. Analytics persistente com eventos por `/go/ID/`.
2. UTM automático por plataforma.
3. Dashboard de acessos.
4. Integração de banco para métricas.
5. Biblioteca de prompts.
6. Conteúdo premium.
7. Área de membros.
8. Produtos digitais.
9. Integrações de publicação social.
10. fila de geração de conteúdo.
11. histórico/versionamento no painel.
12. permissões para múltiplos administradores.

## Estrutura principal

```text
codigoia-site/
├── index.html
├── catalog.html
├── item.html
├── admin.html
├── admin-config.js
├── app.js
├── style.css
├── data/
│   ├── codes.json
│   └── inventory.json
├── assets/
│   ├── default.svg
│   └── uploads/
├── codigo/
├── go/
├── scripts/
│   └── build.py
├── api/
│   ├── src/
│   │   └── index.js
│   ├── wrangler.toml
│   └── .dev.vars.example
├── .github/
│   ├── workflows/
│   └── ISSUE_TEMPLATE/
└── README.md
```
