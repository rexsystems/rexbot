import "./style.css";

const form = document.querySelector("#connect-form");
const input = document.querySelector("#website");
const button = document.querySelector("#connect");
const status = document.querySelector("#connection-status");
const error = document.querySelector("#connection-error");
const invoke = window.__TAURI__?.core.invoke;
try { localStorage.removeItem("rex.sessionToken"); } catch { /* Older app sessions are no longer stored in the launcher. */ }

if (invoke) {
  invoke("saved_website").then((url) => { if (url) input.value = url; }).catch(() => {});
} else {
  error.hidden = false;
  error.textContent = "Open this connection screen in the Rex desktop app.";
  button.disabled = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invoke || !form.reportValidity()) return;
  error.hidden = true;
  button.disabled = true;
  input.disabled = true;
  status.textContent = "Checking website…";
  try {
    await invoke("connect_website", { address: input.value.trim() });
    status.textContent = "Connected. Your workspace is open. Use the Rex menu to change website.";
  } catch (reason) {
    error.hidden = false;
    error.textContent = typeof reason === "string" ? reason : "Could not connect. Check the address and try again.";
    status.textContent = "";
  } finally {
    button.disabled = false;
    input.disabled = false;
  }
});
