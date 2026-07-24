/**
 * 浅色工作台：侧栏导航 / 桌面收起 / 移动端抽屉
 */
(function () {
  const STORAGE_KEY = "tangtang-wb-sidebar-collapsed";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  ready(() => {
    const sidebar = document.getElementById("wb-sidebar");
    const backdrop = document.getElementById("wb-backdrop");
    const menuBtn = document.getElementById("wb-menu-btn");
    const collapseBtn = document.getElementById("wb-collapse-btn");
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

    function setCollapsed(collapsed) {
      document.body.classList.toggle("wb-sidebar-collapsed", collapsed);
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (collapseBtn) {
        collapseBtn.setAttribute(
          "aria-label",
          collapsed ? "展开侧栏" : "收起侧栏"
        );
        collapseBtn.setAttribute("title", collapsed ? "展开侧栏" : "收起侧栏");
        collapseBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
      if (menuBtn && !isMobile()) {
        menuBtn.setAttribute(
          "aria-label",
          collapsed ? "展开侧栏" : "收起侧栏"
        );
      }
    }

    function toggleCollapsed() {
      setCollapsed(!document.body.classList.contains("wb-sidebar-collapsed"));
    }

    // 恢复桌面收起状态
    try {
      if (!isMobile() && localStorage.getItem(STORAGE_KEY) === "1") {
        setCollapsed(true);
      } else {
        setCollapsed(false);
      }
    } catch {
      setCollapsed(false);
    }

    collapseBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (isMobile()) {
        closeDrawer();
        return;
      }
      toggleCollapsed();
    });

    menuBtn?.addEventListener("click", () => {
      if (isMobile()) {
        if (document.body.classList.contains("wb-drawer-open")) closeDrawer();
        else openDrawer();
        return;
      }
      toggleCollapsed();
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

    window.addEventListener("resize", () => {
      if (isMobile()) {
        document.body.classList.remove("wb-sidebar-collapsed");
      } else {
        closeDrawer();
        try {
          setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
        } catch {
          /* ignore */
        }
      }
    });

    // 顶栏 / 侧栏显示登录状态
    const loginLink = document.getElementById("wb-login-link");
    const loginNav = document.querySelector('[data-wb-nav="login"] .wb-nav-label');
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok || !data.email) return;
        const short =
          data.email.length > 18
            ? `${data.email.slice(0, 12)}…`
            : data.email;
        if (loginLink) {
          loginLink.textContent = short;
          loginLink.title = data.email;
        }
        if (loginNav) loginNav.textContent = "已登录";
      })
      .catch(() => {});
  });
})();
