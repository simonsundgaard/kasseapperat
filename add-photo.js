const OFF_BASE = "https://world.openfoodfacts.net";
const OFF_USER = "off";
const OFF_PASS = "off";

const body = document.body;
const barcodeInput = document.getElementById("barcode-input");
const imageFieldEl = document.getElementById("image-field");
const productCard = document.getElementById("product-card");
const productImg = document.getElementById("product-img");
const productNameEl = document.getElementById("product-name");
const productBrandEl = document.getElementById("product-brand");
const titleEl = document.getElementById("photo-title");

const updateVideo = document.getElementById("camera");
const snapCanvas = document.getElementById("snap-canvas");
const snapPreview = document.getElementById("snap-preview");
const snapBtn = document.getElementById("snap-btn");
const retakeBtn = document.getElementById("retake-btn");
const uploadBtn = document.getElementById("upload-btn");

const createVideo = document.getElementById("create-camera");
const createCamStatus = document.getElementById("create-camera-status");
const createForm = document.getElementById("create-form");
const createSubmit = document.getElementById("create-submit");
const slotEls = document.querySelectorAll(".photo-slot");

const statusEl = document.getElementById("status");

let mode = "idle";
let currentBarcode = "";
let stream = null;
let updateBlob = null;
let updateUrl = null;
const slotBlobs = { front: null, ingredients: null, nutrition: null };
const slotUrls = { front: null, ingredients: null, nutrition: null };
let activeSlot = null;

function setMode(next) {
  mode = next;
  body.dataset.mode = next;
  if (next === "create") {
    titleEl.textContent = "Opret vare";
    createVideo.srcObject = stream;
    updateVideo.srcObject = null;
  } else if (next === "update") {
    titleEl.textContent = "Tilføj foto";
    updateVideo.srcObject = stream;
    createVideo.srcObject = null;
  } else {
    titleEl.textContent = "Tilføj foto";
  }
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function setProduct({ name, brand, imgUrl }) {
  productNameEl.textContent = name || "Ukendt vare";
  productBrandEl.textContent = brand || "";
  if (imgUrl) {
    productImg.src = imgUrl;
    productImg.hidden = false;
  } else {
    productImg.removeAttribute("src");
    productImg.hidden = true;
  }
  productCard.classList.remove("empty");
}

function resetProduct(msg) {
  productNameEl.textContent = msg;
  productBrandEl.textContent = "";
  productImg.removeAttribute("src");
  productImg.hidden = true;
  productCard.classList.add("empty");
}

async function fetchProduct(barcode) {
  const url =
    OFF_BASE +
    "/api/v2/product/" +
    encodeURIComponent(barcode) +
    ".json?fields=product_name,product_name_da,brands,image_front_url,image_front_small_url";
  const res = await fetch(url);
  if (!res.ok) throw new Error("http " + res.status);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  return {
    name: p.product_name_da || p.product_name || "",
    brand: p.brands || "",
    imgUrl: p.image_front_url || p.image_front_small_url || null,
  };
}

async function loadBarcode(barcode) {
  currentBarcode = barcode;
  setStatus("Henter " + barcode + "…");
  try {
    const product = await fetchProduct(barcode);
    if (product) {
      setProduct(product);
      setStatus("");
      setMode("update");
    } else {
      setProduct({ name: "Ny vare (" + barcode + ")", brand: "", imgUrl: null });
      setStatus("Ikke i database — opret ny");
      setMode("create");
    }
  } catch (err) {
    console.warn(err);
    setProduct({ name: "Ny vare (" + barcode + ")", brand: "", imgUrl: null });
    setStatus("Offline — opretter når forbundet");
    setMode("create");
  }
  refreshButtons();
  validateCreate();
}

function refreshButtons() {
  const haveCam = !!stream;
  const haveCode = !!currentBarcode;
  snapBtn.disabled = !haveCam || !haveCode || !!updateBlob;
  uploadBtn.disabled = !updateBlob || !haveCode;
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    updateVideo.srcObject = stream;
    refreshButtons();
  } catch (err) {
    console.warn(err);
    setStatus("Kamera afvist: " + err.message);
  }
}

function captureBlob(videoEl) {
  return new Promise((resolve) => {
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return resolve(null);
    snapCanvas.width = w;
    snapCanvas.height = h;
    const ctx = snapCanvas.getContext("2d");
    ctx.drawImage(videoEl, 0, 0, w, h);
    snapCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}

async function snapUpdate() {
  if (!stream) return;
  const blob = await captureBlob(updateVideo);
  if (!blob) return;
  updateBlob = blob;
  if (updateUrl) URL.revokeObjectURL(updateUrl);
  updateUrl = URL.createObjectURL(blob);
  snapPreview.src = updateUrl;
  snapPreview.hidden = false;
  updateVideo.hidden = true;
  retakeBtn.hidden = false;
  snapBtn.hidden = true;
  refreshButtons();
}

function retakeUpdate() {
  updateBlob = null;
  if (updateUrl) {
    URL.revokeObjectURL(updateUrl);
    updateUrl = null;
  }
  snapPreview.removeAttribute("src");
  snapPreview.hidden = true;
  updateVideo.hidden = false;
  retakeBtn.hidden = true;
  snapBtn.hidden = false;
  refreshButtons();
}

async function uploadImage(barcode, imagefield, blob) {
  const fd = new FormData();
  fd.append("code", barcode);
  fd.append("imagefield", imagefield);
  fd.append("user_id", OFF_USER);
  fd.append("password", OFF_PASS);
  fd.append("imgupload_" + imagefield, blob, barcode + "_" + imagefield + ".jpg");
  const res = await fetch(OFF_BASE + "/cgi/product_image_upload.pl", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error("image http " + res.status);
  const data = await res.json();
  if (data.status !== "status ok" && data.status !== "ok") {
    throw new Error("image: " + (data.error || JSON.stringify(data)));
  }
  return data;
}

async function uploadUpdate() {
  if (!updateBlob || !currentBarcode) return;
  uploadBtn.disabled = true;
  setStatus("Uploader…");
  try {
    await uploadImage(currentBarcode, imageFieldEl.value, updateBlob);
    setStatus("Sendt ✓");
    retakeUpdate();
  } catch (err) {
    console.warn(err);
    setStatus("Upload fejl: " + err.message);
    uploadBtn.disabled = false;
  }
}

function setSlot(slotName, blob) {
  if (slotUrls[slotName]) URL.revokeObjectURL(slotUrls[slotName]);
  slotBlobs[slotName] = blob;
  slotUrls[slotName] = blob ? URL.createObjectURL(blob) : null;
  const slotEl = document.querySelector(`.photo-slot[data-slot="${slotName}"]`);
  const preview = slotEl.querySelector(".slot-preview");
  preview.innerHTML = "";
  if (blob) {
    preview.classList.remove("empty");
    const img = document.createElement("img");
    img.src = slotUrls[slotName];
    preview.appendChild(img);
    slotEl.querySelector(".slot-snap").textContent = "Tag igen";
  } else {
    preview.classList.add("empty");
    slotEl.querySelector(".slot-snap").textContent = "Tag billede";
  }
  validateCreate();
}

async function snapSlot(slotName) {
  if (!stream) return;
  activeSlot = slotName;
  createCamStatus.textContent = "Tager " + slotName + "…";
  const blob = await captureBlob(createVideo);
  activeSlot = null;
  createCamStatus.textContent = "";
  if (!blob) return;
  setSlot(slotName, blob);
}

function validateCreate() {
  if (mode !== "create") {
    createSubmit.disabled = true;
    return;
  }
  const fd = new FormData(createForm);
  const haveCode = !!currentBarcode;
  const haveRequired = ["product_name", "brands", "quantity"].every(
    (k) => (fd.get(k) || "").toString().trim().length > 0,
  );
  const havePhotos = !!(slotBlobs.front && slotBlobs.ingredients && slotBlobs.nutrition);
  createSubmit.disabled = !(haveCode && haveRequired && havePhotos);
}

async function submitCreate(e) {
  e.preventDefault();
  if (!currentBarcode) return;
  createSubmit.disabled = true;
  setStatus("Opretter vare…");
  const fd = new FormData(createForm);
  const params = new URLSearchParams();
  params.append("code", currentBarcode);
  params.append("user_id", OFF_USER);
  params.append("password", OFF_PASS);
  for (const [k, v] of fd.entries()) {
    const val = (v || "").toString().trim();
    if (!val) continue;
    params.append(k, val);
  }
  // Tag nutriment units where relevant (skip empty values)
  for (const [k, v] of fd.entries()) {
    if (!(v || "").toString().trim()) continue;
    if (k === "nutriment_energy-kcal") {
      params.append("nutriment_energy-kcal_unit", "kcal");
    } else if (k.startsWith("nutriment_")) {
      params.append(k + "_unit", "g");
    }
  }
  try {
    const res = await fetch(OFF_BASE + "/cgi/product_jqm2.pl", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    if (data.status !== 1) throw new Error(data.status_verbose || "ukendt fejl");
  } catch (err) {
    console.warn(err);
    setStatus("Fejl: " + err.message);
    createSubmit.disabled = false;
    return;
  }

  setStatus("Uploader billeder…");
  for (const slot of ["front", "ingredients", "nutrition"]) {
    if (!slotBlobs[slot]) continue;
    try {
      await uploadImage(currentBarcode, slot, slotBlobs[slot]);
    } catch (err) {
      console.warn(err);
      setStatus("Billed-fejl (" + slot + "): " + err.message);
      createSubmit.disabled = false;
      return;
    }
  }
  setStatus("Vare oprettet ✓");
  createForm.reset();
  for (const s of ["front", "ingredients", "nutrition"]) setSlot(s, null);
  validateCreate();
}

barcodeInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const code = barcodeInput.value.trim();
  if (code.length >= 6) loadBarcode(code);
});

let buf = "";
let lastKeyAt = 0;
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  const now = performance.now();
  if (now - lastKeyAt > 200) buf = "";
  lastKeyAt = now;
  if (e.key === "Enter") {
    if (buf.length >= 6) {
      barcodeInput.value = buf;
      loadBarcode(buf);
    }
    buf = "";
    return;
  }
  if (/^[0-9]$/.test(e.key)) {
    buf += e.key;
  } else if (e.key.length === 1) {
    buf = "";
  }
});

snapBtn.addEventListener("click", snapUpdate);
retakeBtn.addEventListener("click", retakeUpdate);
uploadBtn.addEventListener("click", uploadUpdate);

slotEls.forEach((slotEl) => {
  const name = slotEl.dataset.slot;
  slotEl.querySelector(".slot-snap").addEventListener("click", () => {
    if (slotBlobs[name]) {
      setSlot(name, null);
    } else {
      snapSlot(name);
    }
  });
});

createForm.addEventListener("input", validateCreate);
createForm.addEventListener("submit", submitCreate);

window.addEventListener("beforeunload", () => {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (updateUrl) URL.revokeObjectURL(updateUrl);
  for (const k of Object.keys(slotUrls)) {
    if (slotUrls[k]) URL.revokeObjectURL(slotUrls[k]);
  }
});

resetProduct("Indtast eller scan stregkode");
startCamera();
