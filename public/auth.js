const form = document.getElementById("auth-form");
const errorEl = document.getElementById("auth-error");

async function post(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Auth failed (${res.status})`);
  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await post("/api/auth/sign-in/email", { email, password });
    window.location.href = "/";
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("signup").addEventListener("click", async () => {
  errorEl.textContent = "";
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const name = document.getElementById("name").value || email;
  try {
    await post("/api/auth/sign-up/email", { email, password, name });
    window.location.href = "/";
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

const judgeBtn = document.getElementById("judge-login-btn");
if (judgeBtn) {
  judgeBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    judgeBtn.disabled = true;
    judgeBtn.innerHTML = "<span>⏳</span> Signing in...";
    document.getElementById("email").value = "judge@hackathon.meta.ai";
    document.getElementById("password").value = "MetaHackathon2026!";
    try {
      await post("/api/auth/sign-in/email", {
        email: "judge@hackathon.meta.ai",
        password: "MetaHackathon2026!",
      });
      window.location.href = "/";
    } catch (err) {
      // If sign in fails for any reason, attempt sign up then redirect
      try {
        await post("/api/auth/sign-up/email", {
          email: "judge@hackathon.meta.ai",
          password: "MetaHackathon2026!",
          name: "Hackathon Judge",
        });
        window.location.href = "/";
      } catch (signupErr) {
        errorEl.textContent = err.message || signupErr.message;
        judgeBtn.disabled = false;
        judgeBtn.innerHTML = "<span>⚡</span> 1-Click Judge Sign-In";
      }
    }
  });
}

fetch("/api/me", { credentials: "include" }).then((r) => {
  if (r.ok) window.location.href = "/";
});
