(async function () {
  const btn = document.getElementById("run");
  btn.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        console.error("[BookBuddy][popup] No active tab.");
        return;
      }
      console.log("[BookBuddy][popup] Sending RUN to tab", tab.id, tab.url);
      await chrome.tabs.sendMessage(tab.id, { cmd: "BOOK_BUDDY_RUN" });
      if (chrome.runtime.lastError) {
        console.error("[BookBuddy][popup] sendMessage error:", chrome.runtime.lastError.message);
      }
      window.close();
    } catch (e) {
      console.error("[BookBuddy][popup] Failed to send RUN:", e);
    }
  });
})();
