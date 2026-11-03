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

fetch("/api/me", { credentials: "include" }).then((r) => {
  if (r.ok) window.location.href = "/";
});
