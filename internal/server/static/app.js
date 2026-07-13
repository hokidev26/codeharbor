(() => {
  const showBootError = (error) => {
    console.error("Failed to load Autoto frontend", error);
    const message = error && error.message ? error.message : String(error || "unknown error");
    const target = document.getElementById("messages") || document.body;
    if (target) {
      const card = document.createElement("div");
      card.className = "empty-workspace-card";
      const title = document.createElement("div");
      title.className = "empty-workspace-title";
      title.textContent = "前端加载失败";
      const text = document.createElement("div");
      text.className = "empty-workspace-text";
      text.textContent = message;
      card.append(title, text);
      target.prepend(card);
    }
  };

  import("./modules/app-main.mjs").catch(showBootError);
})();
