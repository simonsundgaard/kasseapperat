import { get, put, clear } from "./db.js";

const CLEAR_BARCODE = "14ed4ccb11cd0981";

const heroEl = document.getElementById("hero");
const heroImgEl = document.getElementById("hero-img");
const heroNameEl = document.getElementById("hero-name");
const heroBrandEl = document.getElementById("hero-brand");
const historyEl = document.getElementById("history");
const statusEl = document.getElementById("status");
const payBtn = document.getElementById("pay-btn");
const payModal = document.getElementById("pay-modal");
const payCountEl = document.getElementById("pay-count");
const payTotalEl = document.getElementById("pay-total");
const paidBtn = document.getElementById("paid-btn");
const cancelBtn = document.getElementById("cancel-btn");
const successEl = document.getElementById("success");

const history = [];
const objectUrls = new Set();

function randomPrice() {
  return Math.floor(Math.random() * 26) + 5;
}

let audioCtx;
function playBeep() {
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.value = 700;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5, t + 0.002);
  gain.gain.setValueAtTime(0.5, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

async function beep() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();
    playBeep();
  } catch (e) {
    console.warn("beep failed", e);
  }
}

function primeAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
document.addEventListener("pointerdown", primeAudio, { once: true });
document.addEventListener("keydown", primeAudio, { once: true });

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function flashHero() {
  heroEl.classList.remove("flash");
  void heroEl.offsetWidth;
  heroEl.classList.add("flash");
}

function renderHero(record) {
  if (record.imageBlob) {
    heroImgEl.src = objectUrl(record.imageBlob);
    heroImgEl.hidden = false;
  } else {
    heroImgEl.hidden = true;
    heroImgEl.removeAttribute("src");
  }
  heroNameEl.textContent = record.name;
  heroBrandEl.textContent = record.brand || "";
  heroEl.classList.remove("empty");
  flashHero();
}

function renderHistory() {
  historyEl.innerHTML = "";
  for (const item of history) {
    const li = document.createElement("li");
    const img = document.createElement("img");
    if (item.imageBlob) img.src = objectUrl(item.imageBlob);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name;
    const price = document.createElement("span");
    price.className = "price";
    price.textContent = item.price + " kr";
    li.appendChild(img);
    li.appendChild(name);
    li.appendChild(price);
    historyEl.appendChild(li);
  }
  payBtn.disabled = history.length === 0;
}

function addToHistory(record) {
  history.unshift(record);
  if (history.length > 50) history.pop();
  renderHistory();
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

async function fetchFromApi(barcode) {
  const url =
    "https://world.openfoodfacts.org/api/v2/product/" +
    encodeURIComponent(barcode) +
    ".json?lc=da&fields=product_name,product_name_da,generic_name,generic_name_da,brands,image_front_url,image_front_small_url";
  const res = await fetch(url);
  if (!res.ok) throw new Error("http " + res.status);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  const name =
    p.generic_name_da ||
    p.generic_name ||
    p.product_name_da ||
    p.product_name ||
    "";
  const imgUrl = p.image_front_url || p.image_front_small_url || null;
  let imageBlob = null;
  if (imgUrl) {
    try {
      const imgRes = await fetch(imgUrl);
      if (imgRes.ok) imageBlob = await imgRes.blob();
    } catch {
      // image fetch failed; keep record without blob
    }
  }
  return {
    name: name || "Ukendt vare",
    brand: p.brands || "",
    imageBlob,
    price: randomPrice(),
    scannedAt: Date.now(),
  };
}

function isIsbn13(barcode) {
  return /^(978|979)\d{10}$/.test(barcode);
}

async function fetchFromOpenLibrary(isbn) {
  const url =
    "https://openlibrary.org/api/books?bibkeys=ISBN:" +
    encodeURIComponent(isbn) +
    "&jscmd=data&format=json";
  const res = await fetch(url);
  if (!res.ok) throw new Error("http " + res.status);
  const data = await res.json();
  const book = data["ISBN:" + isbn];
  if (!book) return null;
  const authors = Array.isArray(book.authors)
    ? book.authors.map((a) => a.name).filter(Boolean).join(", ")
    : "";
  const imgUrl =
    book.cover?.large ||
    book.cover?.medium ||
    book.cover?.small ||
    "https://covers.openlibrary.org/b/isbn/" +
      encodeURIComponent(isbn) +
      "-L.jpg?default=false";
  let imageBlob = null;
  if (imgUrl) {
    try {
      const imgRes = await fetch(imgUrl);
      if (imgRes.ok) imageBlob = await imgRes.blob();
    } catch {
      // image fetch failed; keep record without blob
    }
  }
  return {
    name: book.title || "Ukendt vare",
    brand: authors,
    imageBlob,
    price: randomPrice(),
    scannedAt: Date.now(),
  };
}

function resetHero(msg) {
  heroEl.classList.add("empty");
  heroImgEl.hidden = true;
  heroImgEl.removeAttribute("src");
  heroNameEl.textContent = msg;
  heroBrandEl.textContent = "";
}

function resetSession() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  history.length = 0;
  renderHistory();
}

async function handleScan(barcode) {
  beep();
  if (barcode === CLEAR_BARCODE) {
    await clear();
    resetSession();
    resetHero("Cache tømt");
    flashHero();
    setStatus("");
    return;
  }
  setStatus("Scanner " + barcode + "…");
  let record = await get(barcode);
  if (record) {
    if (record.price === undefined) {
      record.price = randomPrice();
      await put(barcode, record);
    }
    setStatus("");
    renderHero(record);
    addToHistory(record);
    return;
  }
  try {
    record = isIsbn13(barcode)
      ? await fetchFromOpenLibrary(barcode)
      : await fetchFromApi(barcode);
  } catch (err) {
    setStatus("Ingen forbindelse");
    const fallback = {
      name: "Ukendt vare",
      brand: "",
      imageBlob: null,
      price: randomPrice(),
      scannedAt: Date.now(),
    };
    renderHero(fallback);
    addToHistory(fallback);
    return;
  }
  if (!record) {
    setStatus("");
    const fallback = {
      name: "Ukendt vare",
      brand: "",
      imageBlob: null,
      price: randomPrice(),
      scannedAt: Date.now(),
    };
    renderHero(fallback);
    addToHistory(fallback);
    return;
  }
  await put(barcode, record);
  setStatus("");
  renderHero(record);
  addToHistory(record);
}

let buf = "";
let lastKeyAt = 0;
document.addEventListener("keydown", (e) => {
  const now = performance.now();
  if (now - lastKeyAt > 200) buf = "";
  lastKeyAt = now;
  if (e.key === "Enter") {
    if (buf.length >= 6) handleScan(buf);
    buf = "";
    return;
  }
  if (/^[0-9]$/.test(e.key)) {
    buf += e.key;
  } else if (e.key.length === 1) {
    buf = "";
  }
});

document.addEventListener("gesturestart", (e) => e.preventDefault());

payBtn.addEventListener("click", () => {
  if (history.length === 0) return;
  const total = history.reduce((sum, item) => sum + item.price, 0);
  payCountEl.textContent = history.length + " varer";
  payTotalEl.textContent = total + " kr";
  payModal.hidden = false;
});

cancelBtn.addEventListener("click", () => {
  payModal.hidden = true;
});

paidBtn.addEventListener("click", () => {
  payModal.hidden = true;
  successEl.hidden = false;
  setTimeout(() => {
    successEl.hidden = true;
    resetSession();
    resetHero("Scan en vare");
  }, 1500);
});

document.addEventListener("paste", (e) => {
  const text = (e.clipboardData?.getData("text") || "").trim();
  if (!text) return;
  e.preventDefault();
  handleScan(text);
});
