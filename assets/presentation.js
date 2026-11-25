/* Revisian — Presentation mode
 *
 * A revision style that reads the note you have open, works out what actually
 * needs saying, and turns it into a 16:9 slide deck: title, agenda, section
 * dividers, bullet slides, tables, diagrams, videos, a keyword recap and a
 * two-minute blurt slide.
 *
 * Self-contained: no build step, no app internals. It reads the rendered note
 * (.prose), so it works on any note, pack, or shared deck in the workspace.
 */
(function () {
  "use strict";

  if (window.__revisianPresentation) return;
  window.__revisianPresentation = true;

  var STYLE_ACTION = "style:present";

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function clean(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sentences(text) {
    var parts = clean(text).split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/);
    return parts.map(clean).filter(Boolean);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* Keep inline markup (<strong>, <em>) but drop everything else. */
  function inlineHtml(el) {
    var out = "";
    el.childNodes.forEach(function (node) {
      if (node.nodeType === 3) {
        out += esc(node.nodeValue);
      } else if (node.nodeType === 1) {
        var tag = node.tagName.toLowerCase();
        if (tag === "strong" || tag === "b") out += "<strong>" + esc(node.textContent) + "</strong>";
        else if (tag === "em" || tag === "i") out += "<em>" + esc(node.textContent) + "</em>";
        else if (tag === "br") out += " ";
        else if (tag === "code") out += "<strong>" + esc(node.textContent) + "</strong>";
        else out += inlineHtml(node);
      }
    });
    return clean(out.replace(/<\/strong>\s*<strong>/g, " "));
  }

  function youtubeId(href) {
    var m = String(href || "").match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
    );
    return m ? m[1] : null;
  }

  function isImageHref(href) {
    return /Special:FilePath|\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(String(href || ""));
  }

  /* ------------------------------------------------------------------ *
   * Analyse the open note
   * ------------------------------------------------------------------ */

  function mediaFrom(el) {
    var found = [];
    var seen = {};
    var scope = el.querySelectorAll(".media-actions a[href], .video-activate a[href], a[href]");
    Array.prototype.forEach.call(scope, function (a) {
      var href = a.getAttribute("href") || "";
      var id = youtubeId(href);
      var key = id || href;
      if (seen[key]) return;
      if (id) {
        seen[key] = 1;
        found.push({ kind: "video", id: id, url: href });
      } else if (isImageHref(href) && href.indexOf("http") === 0) {
        seen[key] = 1;
        found.push({ kind: "image", url: href });
      }
    });
    return found;
  }

  function captionFrom(el) {
    var text = clean(el.innerText);
    text = text.replace(/^(Image|GIF|Diagram|YouTube video|Video)\s*/i, "");
    /* Cards repeat their own label in the caption text; collapse the repeat. */
    text = text.replace(/(.{12,90}?)\s*\1\b/g, "$1");
    text = text.replace(/\s*[·|]?\s*(Watch video|Watch on YouTube|Show image|Show GIF|Show diagram)\s*$/i, "");
    /* Media cards carry their own action labels; drop them and keep the first item. */
    text = text
      .replace(/\s*(Load YouTube video player|Load video player|Open original if embedding is blocked|Watch on YouTube|Show image|Show GIF)\s*/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    var first = text.split(/\s*YouTube video\s*/i)[0].trim();
    if (first.length > 2) text = first;
    /* The card label is often echoed in the caption; drop the repeat. */
    var half = Math.floor(text.length / 2);
    if (text.length > 40) {
      var a = text.slice(0, half).trim();
      var b = text.slice(half).trim();
      if (b.indexOf(a) === 0 || a.indexOf(b) === 0) text = a.length > b.length ? a : b;
      text = text.replace(/\s+(Show image|Show GIF|Show diagram|Load video player|Watch on YouTube|Watch video)$/i, "");
    }
    return text;
  }

  function analyse() {
    var article = document.querySelector("main article");
    if (!article) return null;
    var prose = article.querySelector(".prose");
    if (!prose) return null;

    var titleEl = article.querySelector("h1");
    var title = clean(titleEl ? titleEl.textContent : "Untitled note");
    var pill = article.querySelector(".doc-meta .pill");
    var subject = pill ? clean(pill.textContent) : "";

    var sections = [];
    var current = { heading: "", blocks: [] };

    Array.prototype.forEach.call(prose.children, function (el) {
      var tag = el.tagName.toLowerCase();

      if (tag === "h2" || tag === "h3") {
        if (current.blocks.length || current.heading) sections.push(current);
        current = { heading: clean(el.textContent), blocks: [] };
        return;
      }
      if (tag === "h1") return;

      if (tag === "table") {
        var head = [];
        var rows = [];
        Array.prototype.forEach.call(el.querySelectorAll("tr"), function (tr) {
          var inHead = tr.parentElement && tr.parentElement.tagName.toLowerCase() === "thead";
          var cells = Array.prototype.map.call(tr.children, function (cell) {
            return inHead ? clean(cell.textContent) : inlineHtml(cell);
          });
          if (!cells.length) return;
          if (inHead && !head.length) head = cells;
          else rows.push(cells);
        });
        if (rows.length) current.blocks.push({ type: "table", head: head, rows: rows });
        return;
      }

      if (tag === "ul" || tag === "ol") {
        var items = [];
        Array.prototype.forEach.call(el.querySelectorAll(":scope > li"), function (li) {
          var html = inlineHtml(li);
          if (html) items.push(html);
        });
        if (items.length) current.blocks.push({ type: "bullets", items: items });
        return;
      }

      if (tag === "p") {
        var media = mediaFrom(el);
        if (media.length) {
          current.blocks.push({ type: "media", media: media, caption: captionFrom(el) });
          return;
        }
        var html = inlineHtml(el);
        var text = clean(el.textContent);
        if (!text) return;
        if (el.querySelector("img, iframe, video")) {
          var src = el.querySelector("img");
          if (src && src.getAttribute("src")) {
            current.blocks.push({
              type: "media",
              media: [{ kind: "image", url: src.getAttribute("src") }],
              caption: captionFrom(el)
            });
            return;
          }
        }
        current.blocks.push({ type: "text", html: html, text: text });
        return;
      }

      if (tag === "blockquote") {
        current.blocks.push({ type: "text", html: inlineHtml(el), text: clean(el.textContent), quote: true });
      }
    });
    if (current.blocks.length || current.heading) sections.push(current);
    sections = sections.filter(function (s) { return s.blocks.length; });

    /* Key terms: the note's own emphasis. */
    var terms = [];
    var seenTerm = {};
    Array.prototype.forEach.call(prose.querySelectorAll("strong, b"), function (b) {
      var t = clean(b.textContent);
      if (!t || t.length > 28 || t.split(" ").length > 4) return;
      var key = t.toLowerCase();
      if (seenTerm[key]) return;
      seenTerm[key] = 1;
      terms.push(t);
    });

    return {
      title: title,
      subject: subject,
      sections: sections,
      terms: terms.slice(0, 12),
      intro: sections.length && sections[0].heading ? firstText(sections[0]) : ""
    };
  }

  function firstText(section) {
    for (var i = 0; i < section.blocks.length; i++) {
      var b = section.blocks[i];
      if (b.type === "text") return sentences(b.text)[0] || "";
      if (b.type === "bullets" && b.items.length) return clean(b.items[0].replace(/<[^>]+>/g, ""));
    }
    return "";
  }

  /* ------------------------------------------------------------------ *
   * Turn the analysis into slides
   * ------------------------------------------------------------------ */

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function buildDeck(note) {
    var slides = [];
    var total = note.sections.length;

    slides.push({
      kind: "title",
      title: note.title,
      subject: note.subject,
      intro: note.intro,
      sectionCount: total,
      slideCount: 0
    });

    if (total >= 3) {
      slides.push({
        kind: "agenda",
        title: "What this deck covers",
        items: note.sections.map(function (s, i) { return (i + 1) + ". " + (s.heading || note.title); })
      });
    }

    note.sections.forEach(function (section, index) {
      var heading = section.heading || note.title;
      var usedHeading = false;
      var pending = [];
      var secMeta = { sec: index + 1, secTotal: total };

      function flushText() {
        if (!pending.length) return;
        chunk(pending, 3).forEach(function (group) {
          var slide = {
            kind: "bullets",
            title: usedHeading ? heading + " (cont.)" : heading,
            items: group,
            sparse: group.length <= 2
          };
          slide.sec = secMeta.sec;
          slide.secTotal = secMeta.secTotal;
          slides.push(slide);
          usedHeading = true;
        });
        pending = [];
      }

      if (total >= 4) {
        slides.push({ kind: "section", number: index + 1, total: total, title: heading, note: firstText(section) });
      }

      section.blocks.forEach(function (block) {
        if (block.type === "text") {
          sentences(block.text).forEach(function (line) { pending.push(esc(line)); });
          return;
        }

        flushText();

        if (block.type === "bullets") {
          chunk(block.items, 5).forEach(function (group) {
            slides.push({
              kind: "bullets",
              kicker: heading,
              sec: secMeta.sec,
              secTotal: secMeta.secTotal,
              title: usedHeading ? heading + " (cont.)" : heading,
              items: group
            });
            usedHeading = true;
          });
          return;
        }

        if (block.type === "table") {
          chunk(block.rows, 4).forEach(function (rows) {
            slides.push({
              kind: "table",
              sec: secMeta.sec,
              secTotal: secMeta.secTotal,
              title: usedHeading ? heading + " (cont.)" : heading,
              head: block.head,
              rows: rows
            });
            usedHeading = true;
          });
          return;
        }

        if (block.type === "media") {
          block.media.forEach(function (m, mi) {
            slides.push({
              kind: m.kind === "video" ? "video" : "image",
              sec: secMeta.sec,
              secTotal: secMeta.secTotal,
              title: usedHeading ? heading + " (cont.)" : heading,
              media: m,
              caption: mi === 0 ? block.caption : ""
            });
            usedHeading = true;
          });
        }
      });

      flushText();
    });

    if (note.terms.length >= 3) {
      slides.push({
        kind: "recap",
        title: "Say each of these out loud, then define it",
        terms: note.terms
      });
    }

    slides.push({ kind: "blurt", title: "Now blurt it", subject: note.title });

    if (slides.length && slides[0].kind === "title") slides[0].slideCount = slides.length;
    slides.forEach(function (s, i) { s.n = i + 1; });
    return slides;
  }

  function speakerNotes(slide, note) {
    if (slide.kind === "title") return [note.intro || "Intro deck for " + note.title];
    if (slide.kind === "agenda") return ["Walk through the sections before you start. Say what the exam question is likely to be."];
    if (slide.kind === "section") return [slide.note || "Section " + slide.number + " of " + slide.total + "."];
    if (slide.kind === "table") return ["Read the table across, not down: one row at a time, linking each component to its job."];
    if (slide.kind === "image") return [slide.caption || "Name the parts of the diagram before you explain it."];
    if (slide.kind === "video") return [slide.caption || "Play a minute, pause, and say what you just saw."];
    if (slide.kind === "recap") return ["Point at each term. Say the definition out loud, then check it against the source note."];
    if (slide.kind === "blurt") return ["Two minutes, pen down, no notes. Then compare with the recap slide."];
    return (slide.items || []).map(function (i) { return clean(String(i).replace(/<[^>]+>/g, "")); });
  }

  /* ------------------------------------------------------------------ *
   * Deck UI
   * ------------------------------------------------------------------ */

  var state = { slides: [], index: 0, root: null, stage: null, notesOn: false, gridOn: false };

  var ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h9l4 4v14H6z"/><path d="M9 13h6M9 17h4"/></svg>'
  };

  function slideHtml(s) {
    var kicker = s.sec
      ? '<div class="rp-kicker">Section ' + s.sec + " of " + s.secTotal + "</div>"
      : s.kicker
      ? '<div class="rp-kicker"><b>' + esc(s.kicker) + "</b></div>"
      : "";

    if (s.kind === "title") {
      var chips = [];
      if (s.subject) chips.push('<span class="rp-chip">' + esc(s.subject) + "</span>");
      chips.push('<span class="rp-chip rp-chip-plain">' + s.sectionCount + " sections</span>");
      return (
        '<div class="rp-slide" data-kind="title">' +
        '<div class="rp-kicker"><b>Revision deck</b></div>' +
        '<div class="rp-hero">' + esc(s.title) + "</div>" +
        (s.intro ? '<div class="rp-sub">' + esc(s.intro) + "</div>" : '<div class="rp-sub"></div>') +
        '<div class="rp-chips">' + chips.join("") + "</div>" +
        '<div class="rp-meta">Built from your note · ' + s.slideCount + " slides · Revisian</div>" +
        "</div>"
      );
    }

    if (s.kind === "agenda") {
      return (
        '<div class="rp-slide" data-kind="bullets">' +
        '<div class="rp-kicker"><b>Agenda</b></div>' +
        '<h2 class="rp-title">' + esc(s.title) + "</h2>" +
        '<ul class="rp-bullets">' +
        s.items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") +
        "</ul></div>"
      );
    }

    if (s.kind === "section") {
      return (
        '<div class="rp-slide" data-kind="section">' +
        '<div class="rp-secnum">Section ' + s.number + " of " + s.total + "</div>" +
        '<h2 class="rp-sechead">' + esc(s.title) + "</h2>" +
        (s.note ? '<div class="rp-secnote">' + esc(s.note) + "</div>" : "") +
        "</div>"
      );
    }

    if (s.kind === "table") {
      var rows = s.rows
        .map(function (r) {
          return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
        })
        .join("");
      var head = s.head.length
        ? "<thead><tr>" + s.head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead>"
        : "";
      return (
        '<div class="rp-slide" data-kind="table">' +
        kicker +
        '<h2 class="rp-title' + (s.title.length > 44 ? " rp-long" : "") + '">' + esc(s.title) + "</h2>" +
        '<div class="rp-tablewrap"><table class="rp-table' + (s.rows.length >= 4 ? " rp-table-dense" : "") + '">' + head + "<tbody>" + rows + "</tbody></table></div>" +
        "</div>"
      );
    }

    if (s.kind === "image" || s.kind === "video") {
      var body =
        s.kind === "image"
          ? '<div class="rp-figure"><img src="' + esc(s.media.url) + '" alt="' + esc(s.caption || s.title) + '"></div>'
          : '<div class="rp-figure"><div class="rp-frame" data-video-id="' + esc(s.media.id) + '"></div></div>';
      return (
        '<div class="rp-slide" data-kind="' + s.kind + '">' +
        kicker +
        '<h2 class="rp-title rp-media-title">' + esc(s.title) + "</h2>" +
        body +
        (s.caption ? '<div class="rp-caption">' + esc(s.caption) + "</div>" : "") +
        "</div>"
      );
    }

    if (s.kind === "recap") {
      return (
        '<div class="rp-slide" data-kind="recap">' +
        '<div class="rp-kicker"><b>Keyword recap</b></div>' +
        '<h2 class="rp-title">' + esc(s.title) + "</h2>" +
        '<div class="rp-terms">' +
        s.terms.map(function (t) { return '<span class="rp-term">' + esc(t) + "</span>"; }).join("") +
        "</div>" +
        '<p class="rp-hint">Cover the note. For each term, give one sentence: what it is, and what goes wrong without it.</p>' +
        "</div>"
      );
    }

    if (s.kind === "blurt") {
      return (
        '<div class="rp-slide" data-kind="blurt">' +
        '<div class="rp-kicker"><b>Active recall</b></div>' +
        '<div class="rp-hero">' + esc(s.title) + "</div>" +
        '<p class="rp-hint">Close the deck. On blank paper, write everything you can remember about <strong>' +
        esc(s.subject) + "</strong>. Two minutes, no peeking.</p>" +
        '<div class="rp-timer"><button type="button" data-timer>Start 2:00</button><span class="rp-clock">2:00</span></div>' +
        "</div>"
      );
    }

    var listClass = "rp-bullets" + (s.sparse || s.items.length <= 2 ? " rp-sparse" : "");
    var items = s.items.map(function (item, i) {
      var cls = "";
      var plain = clean(String(item).replace(/<[^>]+>/g, ""));
      if (plain.length > 190) cls = ' class="rp-tight"';
      else if (plain.length > 120) cls = ' class="rp-dense"';
      return "<li" + cls + ">" + item + "</li>";
    });
    return (
      '<div class="rp-slide" data-kind="bullets"' + (s.sparse ? ' data-density="sparse"' : "") + ">" +
      kicker +
      '<h2 class="rp-title' + (s.title.length > 44 ? " rp-long" : "") + '">' + esc(s.title) + "</h2>" +
      '<ul class="' + listClass + '">' + items.join("") + "</ul></div>"
    );
  }

  function buildRoot(note) {
    var root = document.createElement("div");
    root.className = "rp-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Presentation mode: " + note.title);

    var slidesHtml = state.slides.map(slideHtml).join("");
    var gridItems = state.slides
      .map(function (s, i) {
        return (
          '<button type="button" class="rp-grid-item" data-goto="' + i + '">' +
          "<span>" + (i + 1) + " / " + state.slides.length + "</span>" +
          "<strong>" + esc(s.title) + "</strong></button>"
        );
      })
      .join("");

    root.innerHTML =
      '<div class="rp-progress"><span></span></div>' +
      '<div class="rp-topbar">' +
      '<span class="rp-brand"><i></i>Revisian presentation</span>' +
      '<span class="rp-scope">' + esc(note.title) + "</span>" +
      "</div>" +
      '<div class="rp-stage-wrap"><div class="rp-stage">' + slidesHtml + "</div></div>" +
      '<div class="rp-notes" aria-live="polite"><b>Speaker notes</b><div data-notes-body></div></div>' +
      '<div class="rp-grid"><h2>Jump to a slide</h2><div class="rp-grid-items">' + gridItems + "</div></div>" +
      '<div class="rp-controls">' +
      '<span class="rp-count" data-count></span>' +
      '<div class="rp-btns">' +
      '<button type="button" data-act="prev" aria-label="Previous slide">' + ICON.prev + "Back</button>" +
      '<button type="button" data-act="next" aria-label="Next slide">Next' + ICON.next + "</button>" +
      '<button type="button" data-act="grid" aria-label="All slides">' + ICON.grid + "</button>" +
      '<button type="button" data-act="notes" aria-label="Speaker notes">' + ICON.notes + "</button>" +
      '<button type="button" data-act="pdf" aria-label="Export as PDF" title="Export as PDF">' + ICON.pdf + "</button>" +
      '<button type="button" data-act="full" aria-label="Fullscreen">' + ICON.full + "</button>" +
      '<button type="button" data-act="exit" aria-label="Close presentation">' + ICON.exit + "</button>" +
      "</div></div>";

    document.body.appendChild(root);
    return root;
  }

  function fit() {
    if (!state.root) return;
    var wrap = state.root.querySelector(".rp-stage-wrap");
    var stage = state.stage;
    if (!wrap || !stage) return;
    var cs = getComputedStyle(wrap);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var availW = (wrap.clientWidth || window.innerWidth) - padX;
    var availH = (wrap.clientHeight || window.innerHeight) - padY;
    var k = Math.min(availW / 1200, availH / 675);
    stage.style.transform = "scale(" + (k > 0 ? k : 0.2) + ")";
  }

  function renderNotes() {
    if (!state.root) return;
    var slide = state.slides[state.index];
    var body = state.root.querySelector("[data-notes-body]");
    var lines = speakerNotes(slide, state.note);
    body.innerHTML = lines.length
      ? lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("")
      : "<p>No notes for this slide.</p>";
  }

  function activate(i) {
    if (!state.slides.length) return;
    state.index = Math.max(0, Math.min(state.slides.length - 1, i));
    var slides = state.root.querySelectorAll(".rp-slide");
    Array.prototype.forEach.call(slides, function (el, idx) {
      el.setAttribute("data-active", idx === state.index ? "1" : "0");
      if (idx === state.index) {
        var frame = el.querySelector("[data-video-id]");
        if (frame && !frame.querySelector("iframe")) {
          var id = frame.getAttribute("data-video-id");
          var iframe = document.createElement("iframe");
          iframe.src = "https://www.youtube-nocookie.com/embed/" + id + "?playsinline=1&rel=0";
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture";
          iframe.allowFullscreen = true;
          iframe.loading = "lazy";
          iframe.title = "Video";
          frame.appendChild(iframe);
        }
        var img = el.querySelector("img");
        if (img && !img.complete) img.loading = "eager";
      }
    });
    var count = state.root.querySelector("[data-count]");
    count.textContent = (state.index + 1) + " / " + state.slides.length;
    state.root.querySelector(".rp-progress span").style.width =
      ((state.index + 1) / state.slides.length) * 100 + "%";
    Array.prototype.forEach.call(state.root.querySelectorAll(".rp-grid-item"), function (b, idx) {
      b.setAttribute("data-current", idx === state.index ? "1" : "0");
    });
    renderNotes();
  }

  var idleTimer = null;
  function wake() {
    if (state.root) state.root.removeAttribute("data-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (state.root && !state.gridOn) state.root.setAttribute("data-idle", "1");
    }, 3200);
  }

  function toggleGrid(force) {
    state.gridOn = typeof force === "boolean" ? force : !state.gridOn;
    state.root.querySelector(".rp-grid").setAttribute("data-open", state.gridOn ? "1" : "0");
    var btn = state.root.querySelector('[data-act="grid"]');
    btn.setAttribute("aria-pressed", state.gridOn ? "true" : "false");
    if (state.gridOn) state.root.removeAttribute("data-idle");
  }

  function toggleNotes(force) {
    state.notesOn = typeof force === "boolean" ? force : !state.notesOn;
    state.root.querySelector(".rp-notes").setAttribute("data-open", state.notesOn ? "1" : "0");
    state.root.querySelector('[data-act="notes"]').setAttribute("aria-pressed", state.notesOn ? "true" : "false");
  }

  function closeDeck() {
    if (!state.root) return;
    state.root.remove();
    state.root = null;
    state.stage = null;
    state.slides = [];
    document.documentElement.style.overflow = state.prevOverflow || "";
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousemove", wake, true);
    clearTimeout(idleTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }

  function onKey(e) {
    if (!state.root) return;
    var k = e.key;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && !e.target.closest(".rp-root")) return;

    if (k === "Escape") {
      if (state.gridOn) { e.preventDefault(); e.stopPropagation(); toggleGrid(false); return; }
      e.preventDefault(); e.stopPropagation(); closeDeck(); return;
    }
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") {
      e.preventDefault(); e.stopPropagation(); activate(state.index + 1); wake(); return;
    }
    if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") {
      e.preventDefault(); e.stopPropagation(); activate(state.index - 1); wake(); return;
    }
    if (k === "Home") { e.preventDefault(); e.stopPropagation(); activate(0); wake(); return; }
    if (k === "End") { e.preventDefault(); e.stopPropagation(); activate(state.slides.length - 1); wake(); return; }
    if (k === "g" || k === "G") { e.preventDefault(); e.stopPropagation(); toggleGrid(); wake(); return; }
    if (k === "n" || k === "N") { e.preventDefault(); e.stopPropagation(); toggleNotes(); wake(); return; }
    if (k === "f" || k === "F") { e.preventDefault(); e.stopPropagation(); toggleFull(); wake(); }
  }

  function toggleFull() {
    if (!state.root) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else state.root.requestFullscreen().catch(function () {});
  }

  /* Countdown on the closing slide */
  function startTimer(btn) {
    var clock = btn.parentElement.querySelector(".rp-clock");
    var left = 120;
    if (btn.getAttribute("data-running") === "1") return;
    btn.setAttribute("data-running", "1");
    btn.textContent = "Running";
    var tick = setInterval(function () {
      left -= 1;
      var m = Math.floor(left / 60);
      var s = left % 60;
      clock.textContent = m + ":" + (s < 10 ? "0" + s : s);
      if (left <= 0) {
        clearInterval(tick);
        btn.textContent = "Again";
        btn.removeAttribute("data-running");
        clock.textContent = "Time";
      }
    }, 1000);
  }

  /* ---------- PDF export ----------
   Slides are cloned into a print-only container, one per page at 16:9, and
   the browser's own "Save as PDF" does the file making. No dependencies. */

  function preparePrint() {
    if (!state.root) return 0;
    var existing = document.querySelector(".rp-print");
    if (existing) existing.remove();

    var holder = document.createElement("div");
    holder.className = "rp-print";

    Array.prototype.forEach.call(state.root.querySelectorAll(".rp-slide"), function (sl) {
      var clone = sl.cloneNode(true);
      clone.removeAttribute("data-active");

      var frame = clone.querySelector("[data-video-id]");
      if (frame) {
        var box = document.createElement("div");
        box.className = "rp-print-video";
        var caption = sl.querySelector(".rp-caption");
        var vId = frame.getAttribute("data-video-id") || "";
        var label = caption && caption.textContent.trim()
          ? "<em>" + esc(caption.textContent.trim()) + "</em>"
          : vId
            ? "<em>Watch: youtu.be/" + esc(vId) + "</em>"
            : "";
        box.innerHTML =
          "<span>Video</span>" + label +
          (vId ? "<small>youtube.com/watch?v=" + esc(vId) + "</small>" : "");
        frame.parentElement.replaceChild(box, frame);
        var dup = clone.querySelector(".rp-caption");
        if (dup) dup.remove();
      }
      Array.prototype.forEach.call(clone.querySelectorAll("img"), function (img) {
        img.loading = "eager";
      });
      holder.appendChild(clone);
    });

    document.body.appendChild(holder);
    document.documentElement.classList.add("rp-printing");
    return holder.children.length;
  }

  function finishPrint() {
    var holder = document.querySelector(".rp-print");
    if (holder) holder.remove();
    document.documentElement.classList.remove("rp-printing");
  }

  function exportPdf() {
    var pages = preparePrint();
    if (!pages) return;
    var done = function () {
      finishPrint();
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(function () { window.print(); }, 140);
    setTimeout(done, 120000);
  }

  function openDeck() {
    var note = analyse();
    if (!note || !note.sections.length) {
      toast("Open a text note first — presentation mode builds slides from the note body.");
      return;
    }
    if (state.root) closeDeck();

    state.note = note;
    state.slides = buildDeck(note);
    state.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    state.root = buildRoot(note);
    state.stage = state.root.querySelector(".rp-stage");
    state.root.setAttribute("data-open", "1");
    activate(0);
    fit();
    wake();

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousemove", wake, true);
    window.addEventListener("resize", fit);

    state.root.addEventListener("click", function (e) {
      var act = e.target.closest("[data-act]");
      if (act) {
        var a = act.getAttribute("data-act");
        if (a === "next") activate(state.index + 1);
        else if (a === "prev") activate(state.index - 1);
        else if (a === "grid") toggleGrid();
        else if (a === "notes") toggleNotes();
        else if (a === "pdf") exportPdf();
        else if (a === "full") toggleFull();
        else if (a === "exit") closeDeck();
        wake();
        return;
      }
      var goto = e.target.closest("[data-goto]");
      if (goto) {
        activate(Number(goto.getAttribute("data-goto")));
        toggleGrid(false);
        return;
      }
      if (e.target.closest("[data-timer]")) {
        startTimer(e.target.closest("[data-timer]"));
        return;
      }
      var stage = e.target.closest(".rp-stage");
      if (stage && !e.target.closest("iframe")) {
        var rect = stage.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;
        if (x > 0.68) activate(state.index + 1);
        else if (x < 0.24) activate(state.index - 1);
      }
    });

    /* touch */
    var sx = null;
    state.root.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) sx = e.touches[0].clientX;
    }, { passive: true });
    state.root.addEventListener("touchend", function (e) {
      if (sx == null) return;
      var dx = (e.changedTouches[0] || {}).clientX - sx;
      if (Math.abs(dx) > 55) activate(state.index + (dx < 0 ? 1 : -1));
      sx = null;
    }, { passive: true });

    state.root.focus && state.root.focus();
  }

  /* ------------------------------------------------------------------ *
   * Small toast, only if the app's own isn't usable
   * ------------------------------------------------------------------ */

  function toast(msg) {
    var el = document.getElementById("toast");
    if (el) {
      el.textContent = msg;
      el.classList.add("show");
      setTimeout(function () { el.classList.remove("show"); }, 3200);
      return;
    }
    var box = document.createElement("div");
    box.textContent = msg;
    box.style.cssText =
      "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#22352b;color:#f4efe2;" +
      "padding:12px 18px;border-radius:10px;font:14px/1.4 system-ui;z-index:99;max-width:80vw";
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3200);
  }

  /* ------------------------------------------------------------------ *
   * Entry points: a Present button, and a new card in Revision styles
   * ------------------------------------------------------------------ */

  var launchSvg =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  function ensureToolbarButton() {
    if (document.querySelector("[data-present]")) return;
    var host = document.querySelector(".workspace-actions");
    if (!host) return;
    var trigger = host.querySelector('[data-action="revision-styles"]');
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn outline rp-launch btn-present";
    btn.setAttribute("data-present", "1");
    btn.title = "Presentation mode (Alt+P)";
    btn.innerHTML = launchSvg + "<span>Present</span>";
    if (trigger && trigger.parentElement === host) host.insertBefore(btn, trigger);
    else host.appendChild(btn);
  }

  function ensureStyleCard() {
    var dialog = document.getElementById("dialog");
    if (!dialog || !dialog.open) return;
    var choices = dialog.querySelector(".revision-choices");
    if (!choices || choices.querySelector("[data-action='" + STYLE_ACTION + "']")) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "revision-choice";
    btn.setAttribute("data-action", STYLE_ACTION);
    btn.setAttribute("data-testid", "revision-present");
    btn.innerHTML =
      "<span>" +
      '<svg aria-hidden="true" class="lucide" xmlns="http://www.w3.org/2000/svg" width="17" height="17" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>' +
      "</span><span><strong>Presentation mode</strong>" +
      "<small>Analyse this note and turn it into a slide deck you can present, rehearse or read back.</small>" +
      "</span>";
    choices.appendChild(btn);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      ensureToolbarButton();
      ensureStyleCard();
    });
  }

  document.addEventListener(
    "click",
    function (e) {
      var hit = e.target.closest("[data-present],[data-action='" + STYLE_ACTION + "']");
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      var dialog = document.getElementById("dialog");
      if (dialog && dialog.open) dialog.close && dialog.close();
      openDeck();
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        openDeck();
      }
    },
    true
  );

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  } else {
    schedule();
  }

  window.RevisianPresentation = {
    open: openDeck,
    close: closeDeck,
    analyse: analyse,
    exportPdf: exportPdf,
    preparePrint: preparePrint,
    finishPrint: finishPrint
  };
})();
