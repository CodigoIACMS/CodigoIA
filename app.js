let CODES = [];

const $ = s => document.querySelector(s);

async function loadCodes() {
  const r = await fetch('data/codes.json?v=' + Date.now());

  if (!r.ok) {
    throw new Error('Não foi possível carregar o catálogo.');
  }

  CODES = await r.json();

  return CODES;
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function isValidUrl(value = '') {
  try {
    const u = new URL(String(value).trim());

    return (
      u.protocol === 'http:' ||
      u.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

function resourceUrl(c) {
  return isValidUrl(c.url)
    ? c.url.trim()
    : '';
}

function codeLabel(c) {
  const id = String(c.id || '')
    .replace(/^#/, '');

  return id
    ? `#${esc(id)}`
    : '';
}

function itemUrl(c) {
  return `item.html?id=${encodeURIComponent(c.id)}`;
}

function resourceButton(c) {
  const url = resourceUrl(c);

  if (!url) {
    return `
      <button
        class="btn disabled"
        type="button"
        disabled
      >
        Indisponível
      </button>
    `;
  }

  return `
    <a
      class="btn"
      href="${esc(url)}"
      target="_blank"
      rel="noopener noreferrer"
    >
      Abrir recurso <span>↗</span>
    </a>
  `;
}

function card(c) {
  const url = itemUrl(c);

  const description =
    (c.description || '').trim();

  return `
    <article class="card">

      <a
        class="cardmedia"
        href="${url}"
        aria-label="Ver ${esc(c.title)}"
      >

        <img
          class="cover"
          src="${esc(c.image || 'assets/default.svg')}"
          alt="${esc(c.title)}"
          loading="lazy"
        >

        <span class="codebadge">
          ${codeLabel(c)}
        </span>

      </a>

      <div class="cardbody">

        <div class="cardmeta">
          <span>
            ${esc(c.category || 'IA')}
          </span>

          <span>•</span>

          <span>
            ${codeLabel(c)}
          </span>
        </div>

        <h3>
          <a href="${url}">
            ${esc(c.title)}
          </a>
        </h3>

        ${
          description
            ? `
              <p>
                ${esc(description)}
              </p>
            `
            : ''
        }

        <div class="cardbottom">

          <a
            class="detailslink"
            href="${url}"
          >
            Ver detalhes
            <span>→</span>
          </a>

          ${resourceButton(c)}

        </div>

      </div>

    </article>
  `;
}

function render(list, host) {
  if (!host) {
    return;
  }

  host.innerHTML = list.length
    ? list.map(card).join('')
    : `
      <div class="empty">

        <strong>
          Nenhum resultado.
        </strong>

        <span>
          Tente outro nome, categoria
          ou código, como #005.
        </span>

      </div>
    `;
}

function normalizeSearch(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, ' ');
}

function matches(c, term) {
  if (!term) {
    return true;
  }

  const id =
    String(c.id || '')
      .toLowerCase()
      .replace(/^#/, '');

  const title =
    String(c.title || '')
      .toLowerCase();

  const category =
    String(c.category || '')
      .toLowerCase();

  const description =
    String(c.description || '')
      .toLowerCase();

  const tags =
    (c.tags || [])
      .join(' ')
      .toLowerCase();

  return [
    id,
    title,
    category,
    description,
    tags,
    `#${id}`
  ].some(value =>
    value.includes(term)
  );
}

async function initHome() {
  try {
    await loadCodes();

    const visible =
      CODES.filter(
        x =>
          x.status !== 'archived' &&
          x.status !== 'draft'
      );

    const featured =
      visible.filter(
        x => x.featured
      );

    render(
      featured.length
        ? featured
        : visible.slice(0, 6),
      $('#featured')
    );

    render(
      visible
        .slice()
        .reverse()
        .slice(0, 6),
      $('#latest')
    );

    if ($('#count')) {
      $('#count').textContent =
        visible.length;
    }

  } catch (e) {

    if ($('#featured')) {
      $('#featured').innerHTML =
        `<div class="empty">
          ${esc(e.message)}
        </div>`;
    }
  }
}

async function initCatalog() {
  try {
    await loadCodes();

    const visible =
      CODES.filter(
        x =>
          x.status !== 'archived' &&
          x.status !== 'draft'
      );

    const q = $('#q');
    const cat = $('#cat');
    const host = $('#catalog');

    if (q) {
      q.placeholder =
        'Pesquisar por nome, categoria ou código #005';
    }

    const cats = [
      ...new Set(
        visible
          .map(x => x.category)
          .filter(Boolean)
      )
    ].sort();

    if (cat) {

      cat.innerHTML =
        '<option value="">Todas as categorias</option>' +

        cats
          .map(
            x =>
              `<option value="${esc(x)}">
                ${esc(x)}
              </option>`
          )
          .join('');
    }

    const params =
      new URLSearchParams(
        location.search
      );

    if (q && params.get('q')) {
      q.value =
        params.get('q');
    }

    function apply() {

      const term =
        normalizeSearch(
          q?.value || ''
        );

      const category =
        cat?.value || '';

      const result =
        visible.filter(
          x =>
            (!category ||
              x.category === category) &&
            matches(x, term)
        );

      render(
        result,
        host
      );

      const count =
        $('#resultsCount');

      if (count) {
        count.textContent =
          `${result.length} resultado${
            result.length === 1
              ? ''
              : 's'
          }`;
      }
    }

    q?.addEventListener(
      'input',
      apply
    );

    cat?.addEventListener(
      'change',
      apply
    );

    apply();

  } catch (e) {

    if ($('#catalog')) {
      $('#catalog').innerHTML =
        `<div class="empty">
          ${esc(e.message)}
        </div>`;
    }
  }
}

async function initItem() {

  try {

    await loadCodes();

    const params =
      new URLSearchParams(
        location.search
      );

    const path =
      location.pathname
        .split('/')
        .filter(Boolean);

    const codigoIndex =
      path.indexOf('codigo');

    const slug =
      codigoIndex >= 0
        ? path[codigoIndex + 1]
        : params.get('slug');

    const id =
      params.get('id');

    const c =
      CODES.find(
        x =>
          (
            id &&
            String(x.id) === String(id)
          ) ||
          (
            slug &&
            (
              String(x.slug || '') === slug ||
              String(x.id) === slug
            )
          )
      );

    if (!c) {

      document.body.innerHTML = `
        <main class="container pageerror">

          <div class="eyebrow">
            CÓDIGOIA
          </div>

          <h1>
            Conteúdo não encontrado
          </h1>

          <p>
            Confira o código informado
            ou volte para o catálogo.
          </p>

          <a
            class="btn"
            href="catalog.html"
          >
            Voltar ao catálogo
          </a>

        </main>
      `;

      return;
    }

    document.title =
      `${c.title} — CódigoIA`;

    const item =
      $('#item');

    if (!item) {
      return;
    }

    const url =
      resourceUrl(c);

    const code =
      String(c.id || '')
        .replace(/^#/, '');

    const codeText =
      code
        ? `#${code}`
        : '';

    item.innerHTML = `

      <div class="detailhero">

        <div class="detailimage">

          <img
            class="cover"
            src="${esc(
              c.image ||
              'assets/default.svg'
            )}"
            alt="${esc(c.title)}"
          >

        </div>

        <div class="detailinfo">

          <div class="detailcode">

            CÓDIGO

            <strong>
              ${esc(codeText)}
            </strong>

          </div>

          <div class="eyebrow">
            ${esc(c.category || 'IA')}
          </div>

          <h1>
            ${esc(c.title)}
          </h1>

          ${
            c.description
              ? `
                <p class="detaildescription">
                  ${esc(c.description)}
                </p>
              `
              : ''
          }

          <div class="detailcodebox">

            <span>
              Use este código no site
            </span>

            <strong>
              ${esc(codeText)}
            </strong>

            <button
              class="copycode"
              id="copyCode"
              type="button"
            >
              Copiar código
            </button>

          </div>

          <div class="tags">

            ${(c.tags || [])
              .map(
                t =>
                  `<span class="tag">
                    ${esc(t)}
                  </span>`
              )
              .join('')
            }

          </div>

          <div class="tools">

            ${
              url
                ? `
                  <a
                    class="btn"
                    href="${esc(url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir recurso
                    <span>↗</span>
                  </a>
                `
                : `
                  <button
                    class="btn disabled"
                    type="button"
                    disabled
                  >
                    Recurso indisponível
                  </button>
                `
            }

            <button
              class="btn secondary"
              id="copy"
              type="button"
            >
              Copiar link
            </button>

            <a
              class="btn secondary"
              href="catalog.html"
            >
              Voltar
            </a>

          </div>

        </div>

      </div>

      <section class="contentbox">

        <div class="sectionlabel">
          SOBRE
        </div>

        <h2>
          ${esc(c.title)}
        </h2>

        <p>
          Encontre este conteúdo rapidamente
          pesquisando pelo código
          <strong>
            ${esc(codeText)}
          </strong>
          no CódigoIA.
        </p>

      </section>

    `;

    const copyCode =
      $('#copyCode');

    copyCode?.addEventListener(
      'click',
      async () => {

        try {

          await navigator.clipboard
            .writeText(codeText);

          copyCode.textContent =
            'Copiado ✓';

          setTimeout(() => {

            copyCode.textContent =
              'Copiar código';

          }, 1800);

        } catch {

          const el =
            document.createElement(
              'div'
            );

          el.className =
            'toast success';

          el.textContent =
            `Código: ${codeText}`;

          document.body.appendChild(
            el
          );

          setTimeout(
            () => el.remove(),
            3000
          );
        }
      }
    );

    const copy =
      $('#copy');

    copy?.addEventListener(
      'click',
      async () => {

        try {

          await navigator.clipboard
            .writeText(
              location.href
            );

          copy.textContent =
            'Link copiado ✓';

          setTimeout(() => {

            copy.textContent =
              'Copiar link';

          }, 1800);

        } catch {

          const el =
            document.createElement(
              'div'
            );

          el.className =
            'toast success';

          el.textContent =
            'Copie o endereço desta página pelo navegador.';

          document.body.appendChild(
            el
          );

          setTimeout(
            () => el.remove(),
            3000
          );
        }
      }
    );

  } catch (e) {

    document.body.innerHTML = `
      <main class="container pageerror">

        <div class="eyebrow">
          CÓDIGOIA
        </div>

        <h1>
          Erro ao carregar
        </h1>

        <p>
          ${esc(e.message)}
        </p>

        <a
          class="btn"
          href="catalog.html"
        >
          Voltar ao catálogo
        </a>

      </main>
    `;
  }
}

async function initGo() {

  try {

    await loadCodes();

    const id =
      new URLSearchParams(
        location.search
      ).get('c');

    const c =
      CODES.find(
        x =>
          String(x.id) ===
          String(id)
      );

    if (
      c?.url &&
      isValidUrl(c.url)
    ) {

      location.replace(
        c.url
      );

    } else {

      document.body.innerHTML = `
        <main class="container pageerror">

          <div class="eyebrow">
            CÓDIGOIA
          </div>

          <h1>
            Recurso indisponível
          </h1>

          <p>
            Este conteúdo ainda não possui
            uma URL de recurso válida.
          </p>

          <a
            class="btn"
            href="catalog.html"
          >
            Voltar ao catálogo
          </a>

        </main>
      `;
    }

  } catch (e) {

    document.body.innerHTML = `
      <main class="container pageerror">

        <h1>
          Erro
        </h1>

        <p>
          ${esc(e.message)}
        </p>

      </main>
    `;
  }
}

function init() {

  if (
    document.querySelector(
      '#featured'
    ) ||
    document.querySelector(
      '#latest'
    )
  ) {
    initHome();
  }

  if (
    document.querySelector(
      '#catalog'
    )
  ) {
    initCatalog();
  }

  if (
    document.querySelector(
      '#item'
    )
  ) {
    initItem();
  }

  if (
    document.body.dataset.page ===
    'go' ||
    location.pathname.includes(
      '/go'
    )
  ) {
    initGo();
  }
}

document.addEventListener(
  'DOMContentLoaded',
  init
);
