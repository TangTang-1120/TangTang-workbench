/**
 * Tang Tang：仅浅色工作台（已移除深色主题）
 */
(function () {
  const KEY = "tangtang-theme";
  const meta = () => document.querySelector('meta[name="theme-color"]');

  function applyLight() {
    document.documentElement.setAttribute("data-theme", "light");
    document.body?.classList.add("is-workbench");
    const m = meta();
    if (m) m.setAttribute("content", "#ffffff");
    try {
      localStorage.setItem(KEY, "light");
    } catch {
      /* ignore */
    }
  }

  applyLight();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyLight);
  }

  window.TangTheme = {
    apply: () => applyLight(),
    current: () => "light",
  };
})();
