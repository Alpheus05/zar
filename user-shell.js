(function () {
  "use strict";

  const menuButton = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  if (!menuButton || !sidebar || !overlay) {
    return;
  }

  function closeMenu() {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  menuButton.setAttribute("aria-controls", "sidebar");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.addEventListener("click", function () {
    const isOpen = sidebar.classList.toggle("open");
    overlay.classList.toggle("open", isOpen);
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });
  overlay.addEventListener("click", closeMenu);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
})();
