/* Lockify Labs — nav, scroll reveals and the news list, shared by every page. */
(function () {
  'use strict';

  var nav = document.querySelector('.nav');
  if (nav) {
    var toggle = nav.querySelector('.nav-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      nav.querySelectorAll('.nav-links a').forEach(function (a) {
        a.addEventListener('click', function () { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); });
      });
    }
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /*
   * News: <div data-news="/neon-mania/dev-updates.json" data-limit="3"> renders the same feed the
   * game's Lockify Labs screen reads. Text is set with textContent only, never as HTML.
   */
  document.querySelectorAll('[data-news]').forEach(function (host) {
    var limit = parseInt(host.getAttribute('data-limit') || '20', 10);
    var full = host.hasAttribute('data-full');
    fetch(host.getAttribute('data-news'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (feed) {
        var posts = (feed.updates || []).slice(0, limit);
        if (!posts.length) return;
        host.innerHTML = '';
        posts.forEach(function (post) { host.appendChild(renderPost(post, full)); });
      })
      .catch(function () { /* keep the static fallback already in the page */ });
  });

  function renderPost(post, full) {
    var item = document.createElement('article');
    item.className = 'news-item';
    if (post.id) item.id = post.id;
    var date = document.createElement('span');
    date.className = 'date';
    date.textContent = post.date || '';
    var body = document.createElement('div');
    var h = document.createElement('h3');
    h.className = 'h3';
    h.textContent = post.title || '';
    body.appendChild(h);
    if (post.body) {
      var p = document.createElement('p');
      var text = full || post.body.length < 220 ? post.body : post.body.slice(0, 200).replace(/\s+\S*$/, '') + '…';
      p.textContent = text;
      body.appendChild(p);
    }
    if (full && post.link && /^https:\/\//.test(post.link) && new URL(post.link).pathname !== location.pathname) {
      var a = document.createElement('a');
      a.className = 'arrow-link';
      a.href = post.link;
      a.rel = 'noopener';
      a.style.marginTop = '12px';
      a.textContent = 'Read more';
      body.appendChild(a);
    }
    var badge = document.createElement('span');
    badge.className = 'news-badge';
    badge.textContent = post.badge || 'News';
    item.appendChild(date);
    item.appendChild(body);
    item.appendChild(badge);
    return item;
  }
})();
