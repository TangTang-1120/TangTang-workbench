/**
 * 浅色工作台：侧栏导航 / 移动端抽屉
 */
(function () {
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(() => {
    const sidebar = document.getElementById("wb-sidebar");
    const backdrop = document.getElementById("wb-backdrop");
    const menuBtn = document.getElementById("wb-menu-btn");
    const uploadBtn = document.getElementById("wb-nav-upload");
    const fileInput = document.getElementById("file");

    function closeDrawer() {
      document.body.classList.remove("wb-drawer-open");
      if (backdrop) backdrop.hidden = true;
    }

    function openDrawer() {
      document.body.classList.add("wb-drawer-open");
      if (backdrop) backdrop.hidden = false;
    }

    menuBtn?.addEventListener("click", () => {
      if (document.body.classList.contains("wb-drawer-open")) closeDrawer();
      else openDrawer();
    });
    backdrop?.addEventListener("click", closeDrawer);

    uploadBtn?.addEventListener("click", () => {
      closeDrawer();
      fileInput?.click();
    });

    document.querySelectorAll("[data-wb-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        document
          .querySelectorAll(".wb-nav-item.is-active")
          .forEach((n) => n.classList.remove("is-active"));
        if (el.classList.contains("wb-nav-item")) {
          el.classList.add("is-active");
        }
        closeDrawer();
      });
    });
  });
})();
