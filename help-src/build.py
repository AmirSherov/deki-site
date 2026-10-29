"""Сборка Help Center (site.deki.one/help) из исходников в help-src/content.

Запуск из корня deki-site:  python help-src/build.py
Результат: deki/help/** (статические HTML + search-index.json). Сгенерированное
не правится руками — меняйте статьи в help-src/content и пересобирайте.

Статья — HTML-фрагмент, первая строка которого — метаданные в комментарии:
    <!--meta {"title": "...", "lead": "...", "keywords": "...", "order": 10} -->
Имя файла (без номера-префикса) становится slug: 03-storage.html → /help/artist/storage/.

В теле статьи:
  <h2>…</h2>                    — разделы, из них строится оглавление и якоря;
  <figure data-shot="name">подпись</figure>
                                — скриншот deki/help/img/name.webp|png; пока файла
                                  нет, figure не выводится (с DEKI_HELP_DRAFTS=1 —
                                  заглушка с подписью);
  <a href="@artist/storage">    — ссылка на другую статью (раскрывается в /help/…/).
"""

from __future__ import annotations

import html
import json
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent / 'deki'
OUT = SITE / 'help'
CONTENT = ROOT / 'content'
IMG_DIR = OUT / 'img'

# DEKI_HELP_DRAFTS=1 — показывать заглушки на месте ещё не снятых скриншотов (для проверки вёрстки)
DRAFTS = os.environ.get('DEKI_HELP_DRAFTS') == '1'

BOT_URL = 'https://t.me/Deki_music_bot?startapp'
COMMUNITY_URL = 'https://t.me/deki_community'

SECTIONS = {
    'artist': {
        'title': 'Я артист',
        'nav': 'Артистам',
        'lead': 'Как подключить канал, загрузить музыку, выпустить релиз и расти в Deki.',
        'icon': 'mic',
    },
    'listener': {
        'title': 'Я слушатель',
        'nav': 'Слушателям',
        'lead': 'Волна, плейлисты, чарты, клипы и эфиры — всё, что можно делать в Deki.',
        'icon': 'headphones',
    },
    'partners': {
        'title': 'Партнёрам и менеджерам',
        'nav': 'Партнёрам',
        'lead': 'Как устроен Deki, почему это выгодно артистам и как всё работает технически и юридически.',
        'icon': 'handshake',
    },
}

ICONS = {
    'mic': '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
    'headphones': '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
    'handshake': '<path d="m11 17 2 2a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4L14 8"/><path d="m14 8-2-2-5 5 2 2"/><path d="M3 11l4-4 3 3M21 11l-4-4"/>',
    'faq': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    'arrow': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'back': '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    'link': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    'image': '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    'chev': '<path d="m9 5 7 7-7 7"/>',
}


def icon(name: str, cls: str = 'ico') -> str:
    stroke = '2.4' if name == 'chev' else '1.8'
    return (f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{stroke}" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def app_icon(key: str, size: str = '') -> str:
    """Плитка-иконка раздела в стиле иконки приложения (цвет — по разделу)."""
    name = SECTIONS[key]['icon'] if key in SECTIONS else key
    return f'<span class="app-icon is-{key}{" " + size if size else ""}">{icon(name)}</span>'


@dataclass
class Article:
    section: str
    slug: str
    title: str
    lead: str
    keywords: str
    order: int
    body: str
    headings: list[tuple[str, str]] = field(default_factory=list)

    @property
    def url(self) -> str:
        return f'/help/{self.section}/{self.slug}/'


META_RE = re.compile(r'^\s*<!--meta\s+(\{.*?\})\s*-->', re.S)
H2_RE = re.compile(r'<h2>(.*?)</h2>', re.S)
SHOT_RE = re.compile(r'<figure data-shot="([\w-]+)"(?: data-kind="(\w+)")?>(.*?)</figure>', re.S)
XREF_RE = re.compile(r'href="@([\w-]+)/([\w-]+)(#[\w-]+)?"')


def slugify(text: str) -> str:
    table = str.maketrans({
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i',
        'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
        'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '',
        'э': 'e', 'ю': 'yu', 'я': 'ya',
    })
    text = re.sub(r'<[^>]+>', '', text).lower().translate(table)
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')[:60] or 'section'


def strip_tags(text: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text))).strip()


def load_articles() -> list[Article]:
    articles = []
    for section in SECTIONS:
        for path in sorted((CONTENT / section).glob('*.html')):
            raw = path.read_text(encoding='utf-8')
            m = META_RE.match(raw)
            if not m:
                raise SystemExit(f'{path}: нет <!--meta {{...}} --> в первой строке')
            meta = json.loads(m.group(1))
            slug = re.sub(r'^\d+-', '', path.stem)
            articles.append(Article(
                section=section, slug=slug, title=meta['title'], lead=meta.get('lead', ''),
                keywords=meta.get('keywords', ''), order=meta.get('order', 100), body=raw[m.end():].strip(),
            ))
    articles.sort(key=lambda a: (list(SECTIONS).index(a.section), a.order, a.slug))
    return articles


def render_shot(name: str, kind: str | None, caption: str) -> str:
    cls = 'shot' + (f' shot-{kind}' if kind else '')
    for ext in ('webp', 'png', 'jpg'):
        if (IMG_DIR / f'{name}.{ext}').exists():
            alt = html.escape(strip_tags(caption), quote=True)
            return (f'<figure class="{cls}"><img src="/help/img/{name}.{ext}" alt="{alt}" loading="lazy" decoding="async">'
                    f'<figcaption>{caption.strip()}</figcaption></figure>')
    if not DRAFTS:
        return ''
    return (f'<figure class="{cls} shot-pending" data-shot="{name}"><div class="shot-ph">{icon("image")}'
            f'<span>Скриншот появится здесь</span></div><figcaption>{caption.strip()}</figcaption></figure>')


def prepare_body(article: Article, by_key: dict[str, Article]) -> str:
    used: set[str] = set()

    def h2(m: re.Match) -> str:
        text = m.group(1).strip()
        anchor = slugify(text)
        while anchor in used:
            anchor += '-2'
        used.add(anchor)
        article.headings.append((anchor, strip_tags(text)))
        return (f'<h2 id="{anchor}">{text}<a class="anchor" href="#{anchor}" aria-label="Ссылка на раздел" '
                f'data-copy-link>{icon("link")}</a></h2>')

    def xref(m: re.Match) -> str:
        key = f'{m.group(1)}/{m.group(2)}'
        if m.group(1) == 'faq':
            return f'href="/help/faq/#{m.group(2)}"'
        if key not in by_key:
            raise SystemExit(f'{article.section}/{article.slug}: ссылка на несуществующую статью @{key}')
        return f'href="{by_key[key].url}{m.group(3) or ""}"'

    body = H2_RE.sub(h2, article.body)
    body = SHOT_RE.sub(lambda m: render_shot(m.group(1), m.group(2), m.group(3)), body)
    return XREF_RE.sub(xref, body)


# ---------------------------------------------------------------- layout

def page(*, title: str, description: str, path: str, body: str, body_class: str = '') -> str:
    full_title = f'{title} — Помощь Deki' if title != 'Помощь Deki' else 'Помощь Deki — гайды для артистов и слушателей'
    nav_links = ''.join(f'<a href="/help/{key}/">{s["nav"]}</a>' for key, s in SECTIONS.items())
    return f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{html.escape(full_title)}</title>
<meta name="description" content="{html.escape(description, quote=True)}">
<link rel="canonical" href="https://site.deki.one{path}">
<meta property="og:title" content="{html.escape(full_title, quote=True)}">
<meta property="og:description" content="{html.escape(description, quote=True)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://site.deki.one{path}">
<meta property="og:site_name" content="Deki">
<meta property="og:locale" content="ru_RU">
<meta property="og:image" content="https://site.deki.one/05_Background/DEKI_cassettes_background.jpg">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<link rel="icon" type="image/png" href="/01_Logotype/Logotype.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/help/assets/help.css">
</head>
<body class="{body_class}">
<header class="nav">
  <div class="wrap nav-inner">
    <a href="/" class="logo pressable" aria-label="DEKI — на главную">
      <img src="/01_Logotype/Logotype.png" alt="" width="28" height="28"><span>DEKI</span>
    </a>
    <a href="/help/" class="nav-help">Помощь</a>
    <nav class="links" aria-label="Разделы помощи">{nav_links}<a href="/help/faq/">Вопросы</a></nav>
    <div class="right">
      <button class="search-open pressable" type="button" data-search-open aria-label="Поиск по помощи">{icon("search")}<span>Поиск</span><kbd>/</kbd></button>
      <a class="btn btn-sm pressable" href="{BOT_URL}" target="_blank" rel="noopener">Открыть Deki</a>
    </div>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="footer">
  <div class="wrap footer-grid">
    <div>
      <div class="footer-brand"><img src="/01_Logotype/Logotype.png" alt="" width="22" height="22"> DEKI</div>
      <p>Музыка, клипы и эфиры артистов — прямо в Telegram.</p>
    </div>
    <div class="fcol"><h6>Помощь</h6>{nav_links}<a href="/help/faq/">Частые вопросы</a></div>
    <div class="fcol"><h6>Deki</h6><a href="/">О проекте</a><a href="{BOT_URL}" target="_blank" rel="noopener">Открыть в Telegram</a><a href="{COMMUNITY_URL}" target="_blank" rel="noopener">Сообщество</a></div>
    <div class="fcol"><h6>Связаться</h6><a href="mailto:hi@deki.app">hi@deki.app</a><a href="/help/partners/contacts/">Для партнёров</a></div>
  </div>
  <div class="wrap"><div class="legal"><span>© 2026 DEKI</span><span>Помощь · v 0.1 beta</span></div></div>
</footer>
<div class="search-layer" data-search-layer hidden>
  <div class="search-dialog" role="dialog" aria-modal="true" aria-label="Поиск по помощи">
    <div class="search-field">{icon("search")}<input type="search" placeholder="Например: как подключить витрину" data-search-input autocomplete="off" aria-label="Что ищем?"><button type="button" class="search-close" data-search-close aria-label="Закрыть">Esc</button></div>
    <div class="search-results" data-search-results role="listbox"></div>
  </div>
</div>
<div class="toast" data-toast role="status" aria-live="polite"></div>
<script src="/help/assets/help.js" defer></script>
</body>
</html>
'''


def crumbs(*parts: tuple[str, str | None]) -> str:
    """Хлебные крошки: (текст, url) — последний элемент обычно без ссылки."""
    items = [f'<a href="{url}">{html.escape(text)}</a>' if url else f'<span>{html.escape(text)}</span>' for text, url in parts]
    return f'<nav class="crumbs" aria-label="Навигация">{icon("chev").join(items)}</nav>'


def article_row(article: Article, num: int) -> str:
    return (f'<li><a class="row" href="{article.url}"><span class="row-num">{num}</span>'
            f'<span class="row-text"><span class="row-title">{html.escape(article.title)}</span>'
            f'<span class="row-sub">{html.escape(article.lead)}</span></span>{icon("chev", "chev")}</a></li>')


def render_article(article: Article, siblings: list[Article], body: str) -> str:
    idx = siblings.index(article)
    prev_a = siblings[idx - 1] if idx > 0 else None
    next_a = siblings[idx + 1] if idx + 1 < len(siblings) else None
    side = ''.join(
        f'<a href="{a.url}"{" aria-current=page" if a is article else ""}>{html.escape(a.title)}</a>' for a in siblings
    )
    toc = ''.join(f'<a href="#{anc}">{html.escape(text)}</a>' for anc, text in article.headings)
    pager = '<nav class="pager" aria-label="Соседние статьи">'
    pager += (f'<a class="pager-prev pressable" href="{prev_a.url}"><span>Назад</span>{html.escape(prev_a.title)}</a>'
              if prev_a else '<span></span>')
    pager += (f'<a class="pager-next pressable" href="{next_a.url}"><span>Дальше</span>{html.escape(next_a.title)}</a>'
              if next_a else '<span></span>')
    pager += '</nav>'
    sec = SECTIONS[article.section]
    return f'''<div class="wrap article-layout">
  <aside class="side" aria-label="Статьи раздела">
    <a class="side-sec" href="/help/{article.section}/">{app_icon(article.section)}{sec["title"]}</a>
    <nav>{side}</nav>
  </aside>
  <article class="article">
    {crumbs(("Помощь", "/help/"), (sec["nav"], f"/help/{article.section}/"))}
    <h1>{html.escape(article.title)}</h1>
    <p class="lead">{html.escape(article.lead)}</p>
    <div class="prose">{body}</div>
    {pager}
  </article>
  <aside class="toc" aria-label="На этой странице">{"<h6>На странице</h6>" + toc if toc else ""}</aside>
</div>'''


def render_section(key: str, articles: list[Article]) -> str:
    sec = SECTIONS[key]
    rows = ''.join(article_row(a, i) for i, a in enumerate(articles, 1))
    return f'''<section class="wrap section-hero">
  {crumbs(("Помощь", "/help/"), (sec["nav"], None))}
  {app_icon(key, "lg")}
  <h1 class="large-title">{sec["title"]}</h1>
  <p class="lead">{sec["lead"]}</p>
</section>
<section class="wrap list-group"><ul class="group-list continuous">{rows}</ul></section>'''


def render_home(articles: list[Article], faq_html: str) -> str:
    roles = ''
    for key, sec in SECTIONS.items():
        items = [a for a in articles if a.section == key][:4]
        links = ''.join(f'<li><a href="{a.url}"><span>{html.escape(a.title)}</span>{icon("chev", "chev")}</a></li>' for a in items)
        roles += f'''<div class="role continuous">
  <div class="role-head">{app_icon(key)}<h2>{sec["title"]}</h2></div>
  <p>{sec["lead"]}</p>
  <ul>{links}</ul>
  <a class="role-all" href="/help/{key}/">Все статьи раздела {icon("chev", "ico")}</a>
</div>'''
    start = next(a for a in articles if a.section == 'artist' and a.slug == 'quick-start')
    return f'''<section class="wrap home-hero">
  <span class="tag"><span class="dot"></span>Центр помощи</span>
  <h1>Как пользоваться <em>Deki</em></h1>
  <p class="lead">Пошаговые гайды для артистов, возможности для слушателей и подробности для партнёров. Одна ссылка вместо длинных объяснений.</p>
  <button class="home-search pressable" type="button" data-search-open>{icon("search")}<span>Поиск по помощи</span><kbd>/</kbd></button>
</section>
<section class="band"><div class="wrap">
  <div class="roles">{roles}</div>
  <div class="quick continuous">
    <div><span class="tag">Для артистов</span><h2>{html.escape(start.title)}</h2><p>{html.escape(start.lead)}</p></div>
    <a class="btn pressable" href="{start.url}">Начать</a>
  </div>
</div></section>
<section class="band"><div class="wrap list-group">
  <div class="faq-head"><h2>Частые вопросы</h2><a href="/help/faq/">Все вопросы {icon("chev", "ico")}</a></div>
  <div class="qa-list continuous">{faq_html}</div>
</div></section>'''


def load_faq(by_key: dict[str, Article]) -> list[dict]:
    data = json.loads((CONTENT / 'faq.json').read_text(encoding='utf-8'))
    for group in data:
        for q in group['items']:
            q['a'] = XREF_RE.sub(
                lambda m: f'href="{by_key[m.group(1) + "/" + m.group(2)].url}{m.group(3) or ""}"', q['a'])
    return data


def render_faq_items(items: list[dict]) -> str:
    out = ''
    for q in items:
        out += (f'<details class="qa" id="{q["id"]}"><summary><span>{html.escape(q["q"])}</span>'
                f'<a class="anchor" href="#{q["id"]}" aria-label="Ссылка на вопрос" data-copy-link>{icon("link")}</a></summary>'
                f'<div class="qa-body">{q["a"]}</div></details>')
    return out


def render_faq(groups: list[dict]) -> str:
    tabs = ''.join(f'<a href="#g-{g["id"]}" class="chip">{html.escape(g["title"])}</a>' for g in groups)
    blocks = ''.join(f'<section class="faq-group" id="g-{g["id"]}"><h2>{html.escape(g["title"])}</h2>'
                     f'<div class="qa-list continuous">{render_faq_items(g["items"])}</div></section>' for g in groups)
    return f'''<section class="wrap section-hero">
  {crumbs(("Помощь", "/help/"), ("Частые вопросы", None))}
  <span class="app-icon is-faq lg">{icon("faq")}</span>
  <h1 class="large-title">Частые вопросы</h1>
  <p class="lead">Короткие ответы. У каждого вопроса своя ссылка — нажмите на значок, чтобы скопировать её и отправить.</p>
  <div class="chips">{tabs}</div>
</section>
<div class="wrap faq-list">{blocks}</div>'''


def write(path: str, content: str) -> None:
    target = OUT / path.strip('/') / 'index.html' if path.strip('/') else OUT / 'index.html'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def write_sitemap(help_paths: list[str]) -> None:
    """Корень сайта + все страницы помощи в deki/sitemap.xml."""
    urls = [('/', 'weekly', '1.0')] + [(p, 'monthly', '0.6') for p in help_paths]
    body = ''.join(f'  <url>\n    <loc>https://site.deki.one{p}</loc>\n    <changefreq>{freq}</changefreq>\n'
                   f'    <priority>{prio}</priority>\n  </url>\n' for p, freq, prio in urls)
    (SITE / 'sitemap.xml').write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}</urlset>\n',
        encoding='utf-8')


def main() -> None:
    articles = load_articles()
    by_key = {f'{a.section}/{a.slug}': a for a in articles}

    for key in SECTIONS:
        sec_dir = OUT / key
        if sec_dir.exists():
            shutil.rmtree(sec_dir)
    faq_dir = OUT / 'faq'
    if faq_dir.exists():
        shutil.rmtree(faq_dir)

    index = []
    for article in articles:
        siblings = [a for a in articles if a.section == article.section]
        body = prepare_body(article, by_key)
        write(article.url.removeprefix('/help'), page(
            title=article.title, description=article.lead, path=article.url,
            body=render_article(article, siblings, body), body_class='is-article'))
        index.append({
            'u': article.url, 't': article.title, 's': SECTIONS[article.section]['nav'], 'l': article.lead,
            'k': article.keywords, 'h': [text for _, text in article.headings], 'x': strip_tags(body)[:1600],
        })

    for key in SECTIONS:
        write(f'/{key}/', page(title=SECTIONS[key]['title'], description=SECTIONS[key]['lead'], path=f'/help/{key}/',
                               body=render_section(key, [a for a in articles if a.section == key]),
                               body_class='page-grouped'))

    faq = load_faq(by_key)
    write('/faq/', page(title='Частые вопросы', description='Короткие ответы на частые вопросы о Deki.',
                        path='/help/faq/', body=render_faq(faq), body_class='page-grouped'))
    for group in faq:
        for q in group['items']:
            index.append({'u': f'/help/faq/#{q["id"]}', 't': q['q'], 's': 'Вопросы', 'l': strip_tags(q['a'])[:180],
                          'k': q.get('k', ''), 'h': [], 'x': strip_tags(q['a'])})

    featured = [q for g in faq for q in g['items'] if q.get('featured')][:6]
    write('/', page(title='Помощь Deki', description='Гайды Deki для артистов, слушателей и партнёров.',
                    path='/help/', body=render_home(articles, render_faq_items(featured)), body_class='is-home'))

    (OUT / 'search-index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    write_sitemap(['/help/', '/help/faq/', *(f'/help/{key}/' for key in SECTIONS), *(a.url for a in articles)])

    pending = sorted({m.group(1) for a in articles for m in SHOT_RE.finditer(a.body)
                      if not any((IMG_DIR / f'{m.group(1)}.{e}').exists() for e in ('webp', 'png', 'jpg'))})
    print(f'Собрано: {len(articles)} статей, {sum(len(g["items"]) for g in faq)} вопросов → {OUT}')
    if pending:
        print(f'Ждут скриншотов ({len(pending)}): {", ".join(pending)}')


if __name__ == '__main__':
    main()
