(() => {
  const stepEmail = document.getElementById("step-email");
  const stepCode = document.getElementById("step-code");
  const stepDone = document.getElementById("step-done");
  const emailEl = document.getElementById("email");
  const codeEl = document.getElementById("code");
  const emailError = document.getElementById("email-error");
  const codeError = document.getElementById("code-error");
  const sentHint = document.getElementById("sent-hint");
  const devCode = document.getElementById("dev-code");
  const doneMsg = document.getElementById("done-msg");
  const btnSend = document.getElementById("btn-send");
  const btnVerify = document.getElementById("btn-verify");
  const btnBack = document.getElementById("btn-back-email");
  const btnLogout = document.getElementById("btn-logout");

  let pendingEmail = "";

  function show(step) {
    stepEmail.classList.toggle("hidden", step !== "email");
    stepCode.classList.toggle("hidden", step !== "code");
    stepDone.classList.toggle("hidden", step !== "done");
  }

  async function refreshMe() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      const data = await res.json();
      if (data.ok && data.email) {
        doneMsg.textContent = `已登录：${data.email}`;
        show("done");
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  btnSend.addEventListener("click", async () => {
    emailError.textContent = "";
    devCode.classList.add("hidden");
    const email = String(emailEl.value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError.textContent = "请输入有效邮箱";
      return;
    }
    btnSend.disabled = true;
    btnSend.textContent = "发送中…";
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "发送失败");
      pendingEmail = email;
      sentHint.textContent = data.message || `验证码已发送至 ${email}`;
      if (data.devCode) {
        devCode.textContent = `（邮件未配置）验证码：${data.devCode}`;
        devCode.classList.remove("hidden");
      }
      show("code");
      codeEl.focus();
    } catch (err) {
      emailError.textContent = err.message || "发送失败";
    } finally {
      btnSend.disabled = false;
      btnSend.textContent = "发送验证码";
    }
  });

  btnVerify.addEventListener("click", async () => {
    codeError.textContent = "";
    const code = String(codeEl.value || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      codeError.textContent = "请输入 6 位数字验证码";
      return;
    }
    btnVerify.disabled = true;
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail || emailEl.value, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "验证失败");
      doneMsg.textContent = `已登录：${data.email}`;
      show("done");
    } catch (err) {
      codeError.textContent = err.message || "验证失败";
    } finally {
      btnVerify.disabled = false;
    }
  });

  btnBack.addEventListener("click", () => {
    codeError.textContent = "";
    codeEl.value = "";
    show("email");
  });

  btnLogout.addEventListener("click", async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    pendingEmail = "";
    codeEl.value = "";
    emailEl.value = "";
    show("email");
  });

  codeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnVerify.click();
  });
  emailEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSend.click();
  });

  refreshMe();
})();
