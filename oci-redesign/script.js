(() => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".primary-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const sizes = { "A−": 0.94, A: 1, "A+": 1.08 };
  document.querySelectorAll(".text-size button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = btn.textContent.trim();
      const scale = sizes[label] ?? 1;
      document.documentElement.style.fontSize = `${16 * scale}px`;
    });
  });
})();
