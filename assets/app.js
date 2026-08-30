/* ==========================================================================
   Semantica-Learning — 交互逻辑（移动端优先）
   ========================================================================== */
(function () {
  "use strict";

  // ── 章节顺序（用于上一章 / 下一章导航） ────────────────
  const chapterOrder = [
    "overview", "concepts", "architecture", "pipeline", "kg",
    "reasoning", "ontology", "provenance", "decisions", "conflicts",
    "storage", "playground",
    "tutorial", "stage-0", "stage-1", "stage-2", "stage-3",
    "stage-4", "stage-5", "stage-6", "stage-7", "stage-8", "quiz",
  ];

  const navItems = document.querySelectorAll(".nav-item[data-chapter]");
  const chapters = document.querySelectorAll("section.chapter");
  const progressBar = document.getElementById("progressBar");
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("overlay");
  const headerTitle = document.getElementById("headerTitle");
  const menuBtn = document.getElementById("menuBtn");

  function chapterTitle(id) {
    const section = document.getElementById(id);
    if (section) {
      const h1 = section.querySelector("h1");
      if (h1) return h1.textContent.trim();
    }
    const nav = document.querySelector(`.nav-item[data-chapter="${id}"]`);
    if (nav) return nav.textContent.trim();
    return "";
  }

  function activateChapter(id, updateHash) {
    chapters.forEach((c) => c.classList.toggle("active", c.id === id));
    navItems.forEach((n) => n.classList.toggle("active", n.dataset.chapter === id));
    if (updateHash !== false) history.pushState(null, "", "#" + id);
    if (headerTitle) headerTitle.textContent = chapterTitle(id);
    updateBottomNav(id);
    closeDrawer();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // ── 底部导航 ──────────────────────────────────────────
  function updateBottomNav(id) {
    const idx = chapterOrder.indexOf(id);
    const prevBtn = document.getElementById("bnPrev");
    const nextBtn = document.getElementById("bnNext");
    const prevTitle = document.getElementById("bnPrevTitle");
    const nextTitle = document.getElementById("bnNextTitle");
    if (!prevBtn || !nextBtn) return;
    const prevId = chapterOrder[idx - 1];
    const nextId = chapterOrder[idx + 1];
    prevBtn.disabled = !prevId;
    nextBtn.disabled = !nextId;
    if (prevTitle) prevTitle.textContent = prevId ? chapterTitle(prevId) : "";
    if (nextTitle) nextTitle.textContent = nextId ? chapterTitle(nextId) : "";
    prevBtn.onclick = () => prevId && activateChapter(prevId);
    nextBtn.onclick = () => nextId && activateChapter(nextId);
  }

  // ── 抽屉导航（移动端） ─────────────────────────────────
  function openDrawer() { if (sidebar) sidebar.classList.add("open"); if (overlay) overlay.classList.add("show"); }
  function closeDrawer() { if (sidebar) sidebar.classList.remove("open"); if (overlay) overlay.classList.remove("show"); }
  if (menuBtn) menuBtn.addEventListener("click", openDrawer);
  if (overlay) overlay.addEventListener("click", closeDrawer);

  // ── 路由 ──────────────────────────────────────────────
  function routeFromHash() {
    const id = location.hash.replace("#", "") || "overview";
    activateChapter(document.getElementById(id) ? id : "overview", false);
  }

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      activateChapter(item.dataset.chapter);
    });
  });

  window.addEventListener("hashchange", routeFromHash);
  routeFromHash();

  // ── 进度条 ────────────────────────────────────────────
  window.addEventListener("scroll", () => {
    const h = document.documentElement;
    const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    progressBar.style.width = (scrolled * 100) + "%";
  }, { passive: true });

  // ── 代码高亮（轻量） ──────────────────────────────────
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function highlight(el) {
    if (el.dataset.highlighted) return;
    el.dataset.highlighted = "1";
    const lang = el.closest(".codeblock")?.dataset.lang || "";
    if (lang === "text" || lang === "bash" || lang === "json" || lang === "shell") {
      el.innerHTML = escapeHtml(el.textContent);
      return;
    }
    const text = el.textContent;
    const html = escapeHtml(text)
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)/g, '<span class="tok-str">$1</span>')
      .replace(/\b(function|class|const|let|var|return|if|else|for|while|new|import|from|export|async|await|interface|type|extends|implements|def|None|True|False|self|lambda|yield|with|as|in|is|not|and|or)\b/g, '<span class="tok-kw">$1</span>')
      .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-num">$1</span>')
      .replace(/(\/\/[^\n]*|#[^\n]*)/g, '<span class="tok-com">$1</span>')
      .replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, '<span class="tok-ty">$1</span>');
    el.innerHTML = html;
  }

  document.querySelectorAll(".codeblock pre code").forEach(highlight);

  // ── 复制按钮 ──────────────────────────────────────────
  function fallbackCopy(text, btn) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); flashCopied(btn); } catch (e) {}
    document.body.removeChild(ta);
  }
  function flashCopied(btn) {
    const orig = btn.textContent;
    btn.textContent = "已复制 ✓";
    setTimeout(() => (btn.textContent = orig), 1500);
  }

  document.querySelectorAll(".codeblock").forEach((block) => {
    const btn = block.querySelector(".copy-btn");
    const code = block.querySelector("pre code");
    if (!btn || !code) return;
    btn.addEventListener("click", () => {
      const text = code.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashCopied(btn)).catch(() => fallbackCopy(text, btn));
      } else {
        fallbackCopy(text, btn);
      }
    });
  });

  // ── 标签页 ────────────────────────────────────────────
  document.querySelectorAll(".tabs").forEach((tabs) => {
    const heads = tabs.querySelectorAll(".tab-btn");
    const panes = tabs.querySelectorAll(".tab-pane");
    heads.forEach((btn) => {
      btn.addEventListener("click", () => {
        heads.forEach((b) => b.classList.remove("active"));
        panes.forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const target = tabs.querySelector(`.tab-pane[data-tab="${btn.dataset.tab}"]`);
        if (target) target.classList.add("active");
      });
    });
  });

  // ── 手风琴 ────────────────────────────────────────────
  document.querySelectorAll(".acc").forEach((acc) => {
    const head = acc.querySelector(".acc-head");
    head.addEventListener("click", () => acc.classList.toggle("open"));
  });

  // ── 流水线交互 ────────────────────────────────────────
  document.querySelectorAll(".pipeline .stage[data-desc]").forEach((stage) => {
    stage.addEventListener("click", () => {
      document.querySelectorAll(".pipeline .stage").forEach((s) => s.classList.remove("hot"));
      stage.classList.add("hot");
      const desc = document.getElementById("pipelineDesc");
      if (desc) desc.innerHTML = stage.dataset.desc;
    });
  });

  // ── 交互实验室 ────────────────────────────────────────
  const runBtn = document.getElementById("runPlayground");
  const codeArea = document.getElementById("playgroundCode");
  const output = document.getElementById("playgroundOutput");
  const exampleBtns = document.querySelectorAll(".example-btn");

  if (exampleBtns.length) {
    exampleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = document.getElementById(btn.dataset.example);
        if (codeArea && src) codeArea.value = src.textContent.trim();
        if (runBtn) runBtn.click();
      });
    });
  }

  if (runBtn && codeArea && output) {
    runBtn.addEventListener("click", () => runPlayground(codeArea.value, output));
  }

  function runPlayground(src, outEl) {
    const lines = [];
    const log = (...args) => {
      lines.push(args.map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a, null, 2) : String(a))).join(" "));
    };
    const sandbox = {
      SemanticaPlayground: window.SemanticaPlayground,
      ContextGraph: window.SemanticaPlayground?.ContextGraph,
      DecisionEngine: window.SemanticaPlayground?.DecisionEngine,
      Reasoner: window.SemanticaPlayground?.Reasoner,
      console: { log },
      JSON, Math, Date, Map, Set, Array, Object, Number, String, Boolean,
    };
    try {
      const fn = new Function(...Object.keys(sandbox), `"use strict";\n${src}`);
      fn(...Object.values(sandbox));
      outEl.innerHTML = lines.length
        ? lines.map((l) => `<span class="ok">${escapeHtml(l)}</span>`).join("\n")
        : '<span class="err">（无输出 — 代码已执行完毕）</span>';
    } catch (e) {
      outEl.innerHTML = `<span class="err">✗ 错误：${escapeHtml(e.message)}</span>`;
    }
  }

  // ── 图可视化（canvas 力导向） ─────────────────────────
  const graphCanvas = document.getElementById("graphCanvas");
  if (graphCanvas) renderDemoGraph(graphCanvas);

  function renderDemoGraph(canvas) {
    const ctx = canvas.getContext("2d");
    const wrap = canvas.parentElement;
    function resize() {
      const W = wrap.clientWidth;
      const H = window.innerWidth < 680 ? 300 : 420;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { W, H };
    }
    let { W, H } = resize();

    const nodes = [
      { id: "Alice", type: "Person", x: 0, y: 0, color: "#7c5cff" },
      { id: "Acme Corp", type: "Org", x: 0, y: 0, color: "#00d4ff" },
      { id: "Contract-001", type: "Contract", x: 0, y: 0, color: "#22e0a0" },
      { id: "Decision: approved", type: "decision", x: 0, y: 0, color: "#ffb454" },
      { id: "Cupertino", type: "Location", x: 0, y: 0, color: "#ff6b9d" },
    ];
    const edges = [
      { s: 0, t: 1, label: "works_for" },
      { s: 1, t: 2, label: "party_to" },
      { s: 0, t: 3, label: "made" },
      { s: 1, t: 4, label: "located_in" },
    ];

    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      n.x = W / 2 + Math.cos(angle) * (W < 500 ? 90 : 140);
      n.y = H / 2 + Math.sin(angle) * (W < 500 ? 80 : 120);
    });

    function step() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = 800 / (d * d);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          nodes[i].x -= fx; nodes[i].y -= fy;
          nodes[j].x += fx; nodes[j].y += fy;
        }
      }
      edges.forEach((e) => {
        const a = nodes[e.s], b = nodes[e.t];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const ideal = W < 500 ? 90 : 130;
        const f = (d - ideal) * 0.02;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.x += fx; a.y += fy; b.x -= fx; b.y -= fy;
      });
      nodes.forEach((n) => {
        n.x += (W / 2 - n.x) * 0.004;
        n.y += (H / 2 - n.y) * 0.004;
        n.x = Math.max(50, Math.min(W - 50, n.x));
        n.y = Math.max(40, Math.min(H - 40, n.y));
      });

      edges.forEach((e) => {
        const a = nodes[e.s], b = nodes[e.t];
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "rgba(124,92,255,.4)"; ctx.lineWidth = 1.5; ctx.stroke();
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.fillStyle = "#9aa0c0"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(e.label, mx, my - 4);
      });
      nodes.forEach((n) => {
        ctx.beginPath(); ctx.arc(n.x, n.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = n.color + "33"; ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = n.color; ctx.fill();
        ctx.fillStyle = "#e8eaf6"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(n.id, n.x, n.y - 16);
        ctx.fillStyle = "#6b7195"; ctx.font = "10px sans-serif";
        ctx.fillText(n.type, n.x, n.y + 24);
      });
      requestAnimationFrame(step);
    }
    step();

    window.addEventListener("resize", () => { ({ W, H } = resize()); });
  }

  // ── 测验 ──────────────────────────────────────────────
  const quiz = document.getElementById("quiz");
  if (quiz) {
    const options = quiz.querySelectorAll(".quiz-opt");
    const resultEl = document.getElementById("quizResult");
    let answered = 0;
    let correct = 0;
    const total = new Set([...options].map((o) => o.dataset.q)).size;

    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        const q = opt.dataset.q;
        const siblings = quiz.querySelectorAll(`.quiz-opt[data-q="${q}"]`);
        if ([...siblings].some((s) => s.disabled)) return;
        const isCorrect = opt.dataset.ok === "1";
        siblings.forEach((s) => {
          s.disabled = true;
          if (s.dataset.ok === "1") s.classList.add("correct");
        });
        if (!isCorrect) opt.classList.add("wrong");
        answered++;
        if (isCorrect) correct++;
        if (answered === total) {
          const pct = Math.round((correct / total) * 100);
          resultEl.innerHTML = `
            <div class="quiz-score">${correct}/${total}</div>
            <p>你答对了 ${pct}% 的题目${pct === 100 ? "，太棒了！🎉" : pct >= 70 ? "，掌握得不错！" : "，建议回看前面的章节巩固一下。"}</p>
            <button class="run-btn" onclick="location.reload()">重新测验</button>
          `;
          resultEl.scrollIntoView({ behavior: "smooth" });
        }
      });
    });
  }
})();
