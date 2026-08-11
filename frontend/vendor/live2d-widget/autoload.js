/*!
 * Local Live2D Widget integration.
 * Runtime files are from live2d-widgets@1.0.1:
 * https://github.com/stevenjoezhang/live2d-widget
 */

const live2dPath = new URL("./", document.currentScript?.src || document.baseURI).href;

function loadExternalResource(url, type) {
  return new Promise((resolve, reject) => {
    let tag;
    if (type === "css") {
      tag = document.createElement("link");
      tag.rel = "stylesheet";
      tag.href = url;
    } else if (type === "js") {
      tag = document.createElement("script");
      tag.type = "module";
      tag.src = url;
    }
    if (!tag) {
      reject(new Error(`Unsupported Live2D resource type: ${type}`));
      return;
    }
    tag.onload = () => resolve(url);
    tag.onerror = () => reject(new Error(`Unable to load Live2D resource: ${url}`));
    document.head.appendChild(tag);
  });
}

async function loadWidgetTips() {
  const tipsUrl = new URL("waifu-tips.json", live2dPath).href;
  const modelsUrl = new URL("../live2d-models/models.json", live2dPath).href;
  const [tipsResponse, modelsResponse] = await Promise.all([fetch(tipsUrl), fetch(modelsUrl)]);
  if (!tipsResponse.ok || !modelsResponse.ok) {
    throw new Error("Unable to load local Live2D configuration");
  }
  const tips = await tipsResponse.json();
  const models = await modelsResponse.json();
  tips.models = models.models;
  return URL.createObjectURL(new Blob([JSON.stringify(tips)], { type: "application/json" }));
}

(async () => {
  const OriginalImage = window.Image;
  window.Image = function (...args) {
    const image = new OriginalImage(...args);
    image.crossOrigin = "anonymous";
    return image;
  };
  window.Image.prototype = OriginalImage.prototype;

  await Promise.all([
    loadExternalResource(new URL("waifu.css", live2dPath).href, "css"),
    loadExternalResource(new URL("waifu-tips.js", live2dPath).href, "js"),
  ]);

  window.initWidget({
    waifuPath: await loadWidgetTips(),
    cubism2Path: new URL("live2d.min.js", live2dPath).href,
    tools: ["switch-model", "photo", "info", "quit"],
    showToggleAfterQuit: true,
    logLevel: "warn",
    drag: true,
  });
})().catch((error) => {
  console.error("[Live2D Widget] local runtime failed to start", error);
});
