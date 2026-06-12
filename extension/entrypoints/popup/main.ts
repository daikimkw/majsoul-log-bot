const endpointInput = document.getElementById("endpoint") as HTMLInputElement;
const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const statusEl = document.getElementById("status")!;

browser.storage.sync.get(["endpoint", "apiKey"]).then((v) => {
  endpointInput.value = (v.endpoint as string) || "";
  apiKeyInput.value = (v.apiKey as string) || "";
});

document.getElementById("save")!.addEventListener("click", async () => {
  await browser.storage.sync.set({
    endpoint: endpointInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
  });
  statusEl.textContent = "保存しました";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 2000);
});

export {};
