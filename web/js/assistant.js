// Chat UI for the read-only AI device assistant (POST /assistant).
(() => {
  const chat = document.getElementById("chat");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("q");
  const snapshotEl = document.getElementById("snapshot");
  const sendBtn = form.querySelector("button");
  let busy = false;

  function add(kind, text) {
    const div = document.createElement("div");
    div.className = `msg ${kind}`;
    if (text) div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  async function ask(question) {
    if (busy) return;
    busy = true; sendBtn.disabled = true;
    add("user", question);
    const reply = add("bot");
    reply.innerHTML = '<span class="typing" aria-label="Retrieving your device data"><i></i><i></i><i></i></span>';
    try {
      const res = await Api.ask(question);
      reply.textContent = res.answer;
      snapshotEl.textContent = JSON.stringify(res.snapshot, null, 2);
    } catch (e) {
      reply.textContent = `Sorry, I couldn't answer: ${e.message}`;
      reply.classList.add("err");
    } finally {
      busy = false; sendBtn.disabled = false;
      chat.scrollTop = chat.scrollHeight;
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    ask(q);
  });

  document.querySelectorAll(".suggestions button").forEach((b) =>
    b.addEventListener("click", () => ask(b.textContent)));
})();
