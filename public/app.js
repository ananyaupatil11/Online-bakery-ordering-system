const state = {
  products: [], categories: [], cart: JSON.parse(localStorage.getItem("sweetcrust-cart") || "[]"),
  favorites: new Set(), user: null, coupon: null, lastOrder: null, activeCategory: "",
  search: "", visibleCount: 12, accountTab: "orders", adminTab: "overview", checkoutPending: false, reviewProduct: null, recent: JSON.parse(localStorage.getItem("sweetcrust-recent") || "[]"),
};
const categoryImages = [
  "photo-1571115177098-24ec42ed204d", "photo-1535254973040-607b474cb50d", "photo-1464349095431-e9a21285b5f3",
  "photo-1578985545062-69928b1d9587", "photo-1542826438-bd32f43d626f", "photo-1486427944299-d1955d23e34d",
  "photo-1483695028939-5bb13f8648b0", "photo-1499636136210-6f4ee915583e", "photo-1606313564200-e75d5e30476c",
  "photo-1551024506-0bccd828d307", "photo-1585478259715-876acc5be8eb", "photo-1535141192574-5d4897c12636",
];
const money = (value) => `$${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const icon = (name) => `<i data-lucide="${name}"></i>`;
const safeImage = (url) => /^https:\/\//.test(url || "") ? url : "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80";

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  document.querySelector("#toast-region").append(item);
  setTimeout(() => item.remove(), 3400);
}

function openModal(content, wide = false) {
  const backdrop = document.querySelector("#modal-backdrop");
  const panel = document.querySelector("#modal-panel");
  panel.classList.toggle("wide", wide);
  document.querySelector("#modal-content").innerHTML = content;
  const detailButton = document.querySelector("#modal-content [data-action='add-detail']");
  if (detailButton) loadProductReviews(detailButton.dataset.id);
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  refreshIcons();
  panel.querySelector("input,button,select,textarea")?.focus({ preventScroll: true });
}

async function loadProductReviews(productId) {
  const detail = document.querySelector(".detail-info");
  if (!detail) return;
  let reviews = [];
  try { reviews = await api(`/api/products/${productId}/reviews`); } catch {}
  if (!document.querySelector(".detail-info [data-action='add-detail']")) return;
  const panel = document.createElement("section");
  panel.className = "detail-reviews";
  panel.innerHTML = `<h3>Little notes from our customers</h3>${reviews.length ? reviews.map((review) => `<article><span>${"★".repeat(Number(review.rating))}${"☆".repeat(5 - Number(review.rating))}</span><p></p><small></small></article>`).join("") : `<p class="review-empty">No notes yet. You could be first.</p>`}${state.user ? `<form id="review-form" data-product-id="${Number(productId)}"><label>Leave a note<select name="rating"><option value="5">★★★★★ · Loved it</option><option value="4">★★★★ · Really good</option><option value="3">★★★ · Nice</option><option value="2">★★ · Could be better</option><option value="1">★ · Not for me</option></select></label><textarea name="comment" minlength="3" maxlength="500" required placeholder="A few words for the next happy table…"></textarea><button class="text-link" type="submit">Share your note ${icon("arrow-right")}</button><span class="modal-message"></span></form>` : `<button class="text-link" type="button" data-action="review-login" data-id="${Number(productId)}">Sign in to leave a note ${icon("arrow-right")}</button>`}`;
  reviews.forEach((review, index) => {
    const entry = panel.querySelectorAll("article")[index];
    entry.querySelector("p").textContent = review.comment;
    entry.querySelector("small").textContent = `${review.name} · ${new Date(review.created_at).toLocaleDateString()}`;
  });
  detail.append(panel);
  const selectedProduct = state.products.find((product) => Number(product.id) === Number(productId));
  const related = state.products.filter((product) => Number(product.id) !== Number(productId) && product.category_id === selectedProduct?.category_id);
  const recommendations = (related.length ? related : state.products.filter((product) => Number(product.id) !== Number(productId))).sort((first, second) => second.rating - first.rating).slice(0, 3);
  if (recommendations.length) {
    const section = document.createElement("section");
    section.className = "detail-recommendations";
    section.innerHTML = `<h3>You might also love</h3><div>${recommendations.map((product) => `<button type="button" data-action="detail" data-id="${product.id}"><img src="${safeImage(product.image)}" alt=""><span>${escapeHTML(product.name)}</span><strong>${money(effectivePrice(product))}</strong></button>`).join("")}</div>`;
    detail.append(section);
  }
  refreshIcons();
}

function closeModal() {
  document.querySelector("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
  state.checkoutPending = false;
  state.reviewProduct = null;
}

function persistCart() {
  localStorage.setItem("sweetcrust-cart", JSON.stringify(state.cart));
  updateCartCount();
}

function updateCartCount() {
  document.querySelector("#cart-count").textContent = state.cart.reduce((total, item) => total + item.quantity, 0);
}

function effectivePrice(product) {
  return product.price * (1 - (Number(product.discount || 0) / 100));
}

function renderCategories() {
  const grid = document.querySelector("#category-grid");
  const options = document.querySelector("#category-filter");
  grid.innerHTML = state.categories.slice(0, 6).map((category, index) => `
    <button class="category-tile" type="button" data-category="${escapeHTML(category.slug)}" aria-label="Shop ${escapeHTML(category.name)}">
      <img src="https://images.unsplash.com/${categoryImages[index]}?auto=format&fit=crop&w=520&q=78" alt="${escapeHTML(category.name)}" loading="lazy">
      <span>${escapeHTML(category.name.replace(/ cakes?/i, ""))}</span>${icon("arrow-up-right")}
    </button>`).join("");
  options.innerHTML = `<option value="">Everything good</option>${state.categories.map((category) => `<option value="${escapeHTML(category.slug)}">${escapeHTML(category.name)}</option>`).join("")}`;
  options.value = state.activeCategory;
  refreshIcons();
}

function renderProducts() {
  const grid = document.querySelector("#product-grid");
  const products = state.products.slice(0, state.visibleCount);
  document.querySelector("#result-count").textContent = `${state.products.length} freshly baked favorite${state.products.length === 1 ? "" : "s"}`;
  document.querySelector(".load-more").hidden = products.length >= state.products.length;
  document.querySelector(".clear-filter").hidden = !state.activeCategory && !state.search && !document.querySelector("#price-filter").value && !document.querySelector("#rating-filter").value;
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state">${icon("search-x")}<strong>Nothing in the oven just yet.</strong><span>Try another search or clear your filters.</span></div>`;
    refreshIcons();
    return;
  }
  grid.innerHTML = products.map((product) => {
    const sale = effectivePrice(product);
    const isFavorite = state.favorites.has(Number(product.id));
    const badge = product.discount ? `<span class="product-badge special">${product.discount}% off</span>` : product.featured ? `<span class="product-badge">Bestseller</span>` : "";
    return `<article class="product-card">
      <div class="product-image-wrap"><img src="${safeImage(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">${badge}
        <button class="product-favorite ${isFavorite ? "is-active" : ""}" type="button" data-action="favorite" data-id="${product.id}" aria-label="${isFavorite ? "Remove from" : "Add to"} wishlist">${icon("heart")}</button>
        <button class="quick-add" type="button" data-action="detail" data-id="${product.id}">${icon("plus")} Choose your details</button></div>
      <div class="product-meta"><span class="product-category">${escapeHTML(product.category_name || "Fresh from the oven")}</span><div class="product-name-line"><span class="product-name" role="button" tabindex="0" data-action="detail" data-id="${product.id}">${escapeHTML(product.name)}</span><span class="product-price">${product.discount ? `<del>${money(product.price)}</del> ` : ""}${money(sale)}</span></div><div class="product-rating"><b>★★★★★</b> ${Number(product.rating).toFixed(1)} <span>·</span> <span>${product.stock > 0 ? "Baked fresh" : "Sold out today"}</span></div></div></article>`;
  }).join("");
  refreshIcons();
}

async function loadProducts() {
  const parameters = new URLSearchParams();
  if (state.activeCategory) parameters.set("category", state.activeCategory);
  if (state.search) parameters.set("search", state.search);
  if (document.querySelector("#price-filter").value) parameters.set("max", document.querySelector("#price-filter").value);
  if (document.querySelector("#rating-filter").value) parameters.set("min_rating", document.querySelector("#rating-filter").value);
  const sort = document.querySelector("#sort-filter").value;
  if (sort) parameters.set("sort", sort);
  document.querySelector("#product-grid").innerHTML = `<div class="empty-state">${icon("loader-circle")}<span>Finding something lovely…</span></div>`;
  try {
    state.products = await api(`/api/products?${parameters}`);
    state.visibleCount = 12;
    renderProducts();
  } catch (error) {
    document.querySelector("#product-grid").innerHTML = `<div class="empty-state"><strong>The oven's taking a moment.</strong><span>${escapeHTML(error.message)}</span></div>`;
  }
}

function addToCart(product, options = {}) {
  if (Number(product.stock) < 1) return toast("This bake is sold out today.", "error");
  const details = { productId: Number(product.id), name: product.name, image: product.image, unitPrice: effectivePrice(product), quantity: 1, size: options.size || product.sizes?.[0] || "", flavor: options.flavor || product.flavors?.[0] || product.flavor || "", note: options.note || "", customCake: Boolean(options.customCake), sponge: options.sponge || "" };
  const matching = state.cart.find((item) => item.productId === details.productId && item.size === details.size && item.flavor === details.flavor && item.note === details.note);
  if (matching) matching.quantity = Math.min(20, matching.quantity + 1);
  else state.cart.push(details);
  persistCart();
  toast(`${product.name} added to your bag.`);
}

function openProduct(productId) {
  const product = state.products.find((item) => Number(item.id) === Number(productId));
  if (!product) return;
  state.recent = [Number(product.id), ...state.recent.filter((id) => id !== Number(product.id))].slice(0, 5);
  localStorage.setItem("sweetcrust-recent", JSON.stringify(state.recent));
  const recentProducts = state.recent.slice(1).map((id) => state.products.find((item) => Number(item.id) === id)).filter(Boolean);
  const sizeOptions = (product.sizes || []).map((size) => `<option>${escapeHTML(size)}</option>`).join("");
  const flavorOptions = (product.flavors || []).map((flavor) => `<option>${escapeHTML(flavor)}</option>`).join("");
  const history = recentProducts.length ? `<div class="recent-row"><small>YOU HAD A LOOK AT</small><span>${recentProducts.map((item) => escapeHTML(item.name)).join(" · ")}</span></div>` : "";
  openModal(`<div class="product-detail"><img src="${safeImage(product.image)}" alt="${escapeHTML(product.name)}"><div class="detail-info"><span class="modal-eyebrow">${escapeHTML(product.category_name || "FRESH FROM THE OVEN")}</span><h2 id="modal-title">${escapeHTML(product.name)}</h2><div class="detail-rating">★★★★★ <span style="color:#77776e">${Number(product.rating).toFixed(1)} · ${product.stock} left in today's batch</span></div><div class="detail-price">${money(effectivePrice(product))}${product.discount ? `<del>${money(product.price)}</del>` : ""}</div><p>${escapeHTML(product.description)}</p><div class="detail-options">${sizeOptions ? `<label>SIZE / BOX<select id="detail-size">${sizeOptions}</select></label>` : ""}${flavorOptions ? `<label>FLAVOR<select id="detail-flavor">${flavorOptions}</select></label>` : ""}<label>A LITTLE NOTE<input id="detail-note" maxlength="80" placeholder="Happy birthday, lovely!" ${product.category_slug === "custom-cakes" ? "" : ""}></label></div><div class="detail-actions"><button class="button button-dark" type="button" data-action="add-detail" data-id="${product.id}">${icon("shopping-bag")} Add to bag</button><button class="button button-outline" type="button" data-action="buy-detail" data-id="${product.id}">Buy now</button><button class="detail-heart" data-action="favorite" data-id="${product.id}" aria-label="Add to wishlist">${icon("heart")}</button></div>${history}</div></div>`);
}

function renderCart() {
  if (!state.cart.length) {
    openModal(`<span class="modal-eyebrow">THE GOOD THINGS ARE WAITING</span><h2 id="modal-title">Your bag is taking a breather.</h2><p class="modal-copy">Add something lovely from today's batch and it'll be right here.</p><a href="#shop" class="button button-dark" data-action="close-and-shop">Find a treat ${icon("arrow-right")}</a>`);
    return;
  }
  const subtotal = state.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discount = state.coupon ? Math.min(subtotal, state.coupon.kind === "percent" ? subtotal * state.coupon.value / 100 : state.coupon.value) : 0;
  const delivery = subtotal - discount >= 60 ? 0 : 5;
  const lines = state.cart.map((item, index) => `<article class="cart-item"><img src="${safeImage(item.image)}" alt="${escapeHTML(item.name)}"><div><h3>${escapeHTML(item.name)}</h3><small>${[item.size, item.flavor, item.note].filter(Boolean).map(escapeHTML).join(" · ")}</small><div class="quantity-control"><button data-action="quantity" data-index="${index}" data-change="-1" aria-label="Decrease quantity">${icon("minus")}</button><span>${item.quantity}</span><button data-action="quantity" data-index="${index}" data-change="1" aria-label="Increase quantity">${icon("plus")}</button></div></div><div class="cart-item-price"><span>${money(item.unitPrice * item.quantity)}</span><button class="remove-item" data-action="remove-item" data-index="${index}" aria-label="Remove item">${icon("trash-2")}</button></div></article>`).join("");
  openModal(`<span class="modal-eyebrow">A VERY GOOD CHOICE</span><h2 id="modal-title">Your little bag.</h2><p class="modal-copy">${state.cart.reduce((sum, item) => sum + item.quantity, 0)} freshly baked thing${state.cart.reduce((sum, item) => sum + item.quantity, 0) === 1 ? "" : "s"}, coming right up.</p><div class="cart-layout"><div class="cart-list">${lines}</div><aside class="cart-summary"><h3>The little details</h3><div class="coupon-row"><input id="coupon-input" placeholder="Have a little code?" value="${state.coupon ? escapeHTML(state.coupon.code) : ""}"><button data-action="apply-coupon" type="button">Apply</button></div><div class="coupon-note">${state.coupon ? `${escapeHTML(state.coupon.code)} applied` : "Try SWEET10 for 10% off"}</div><div class="summary-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div><div class="summary-line"><span>Little thank-you discount</span><strong>−${money(discount)}</strong></div><div class="summary-line"><span>Delivery</span><strong>${delivery ? money(delivery) : "On us"}</strong></div><div class="summary-line total"><span>Total</span><strong>${money(subtotal - discount + delivery)}</strong></div><button class="button button-dark" data-action="checkout" type="button">To the good part ${icon("arrow-right")}</button><p class="shipping-note">${delivery ? `${money(60 - subtotal + discount)} away from free delivery` : "Free delivery on this order. Lovely."}</p></aside></div>`);
}

function openAuth(mode = "login", message = "") {
  const isRegister = mode === "register";
  openModal(`<span class="modal-eyebrow">${isRegister ? "FIRST TIME HERE?" : "YOUR TABLE IS WAITING"}</span><h2 id="modal-title">${isRegister ? "Let's get acquainted." : "Welcome back."}</h2><p class="modal-copy">${isRegister ? "A little account makes your next celebration even sweeter." : "Sign in to see your orders, saved favorites and sweet surprises."}</p><form class="modal-form" id="auth-form" data-mode="${mode}">${isRegister ? `<label>Your name<input name="name" required minlength="2" autocomplete="name" placeholder="Lovely human"></label>` : ""}<label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Password<input name="password" type="password" required minlength="${isRegister ? 8 : 1}" autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="${isRegister ? "At least 8 characters" : "Your password"}"></label><div class="modal-message">${escapeHTML(message)}</div><button class="button button-dark" type="submit">${isRegister ? "Create my account" : "Sign in"} ${icon("arrow-right")}</button></form><p class="modal-copy">${isRegister ? "Already part of the family?" : "New around here?"} <button class="modal-switch" data-action="auth-mode" data-mode="${isRegister ? "login" : "register"}" type="button">${isRegister ? "Sign in" : "Create an account"}</button></p>${!isRegister ? `<small class="demo-admin">Demo admin: admin@sweetcrust.com · SweetCrust2026!</small>` : ""}`);
}

function openCheckout() {
  if (!state.user) {
    state.checkoutPending = true;
    openAuth("login", "Sign in (or create an account) to place your order.");
    return;
  }
  state.checkoutPending = false;
  const today = new Date();
  const minimumDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const subtotal = state.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discount = state.coupon ? Math.min(subtotal, state.coupon.kind === "percent" ? subtotal * state.coupon.value / 100 : state.coupon.value) : 0;
  const delivery = subtotal - discount >= 60 ? 0 : 5;
  const itemSummary = state.cart.map((item) => `<div class="checkout-line"><span>${item.quantity} × ${escapeHTML(item.name)}<br><small>${escapeHTML([item.size, item.flavor].filter(Boolean).join(" · "))}</small></span><strong>${money(item.unitPrice * item.quantity)}</strong></div>`).join("");
  openModal(`<span class="modal-eyebrow">THE LAST LITTLE DETAILS</span><h2 id="modal-title">Let's get this to you.</h2><p class="modal-copy">A few details for a very good delivery.</p><form id="checkout-form" class="checkout-grid"><div class="checkout-fields"><label class="full">Full name<input name="fullName" required value="${escapeHTML(state.user.name)}" autocomplete="name"></label><label>Email<input name="email" type="email" required value="${escapeHTML(state.user.email)}" autocomplete="email"></label><label>Phone number<input name="phone" type="tel" required minlength="8" value="${escapeHTML(state.user.phone || "")}" autocomplete="tel"></label><label class="full">Delivery address<input name="street" required minlength="5" placeholder="House number and street" autocomplete="street-address"></label><label>City<input name="city" required minlength="2" autocomplete="address-level2"></label><label>Postal code<input name="postalCode" required pattern="[0-9]{5,10}" placeholder="12345" autocomplete="postal-code"></label><label>Delivery date<input name="deliveryDate" type="date" required min="${minimumDate}" value="${minimumDate}"></label><label>Little delivery window<select name="timeSlot"><option>10am–1pm</option><option>1pm–4pm</option><option>4pm–7pm</option></select></label><label class="full">A note for the baker <textarea name="note" maxlength="300" placeholder="A gate code, a surprise, a heads-up…"></textarea></label><div class="full"><span class="field-label">How shall we settle up?</span><div class="payment-options"><label class="payment-option"><input type="radio" name="paymentMethod" value="Cash on delivery" checked> Cash on delivery</label><label class="payment-option"><input type="radio" name="paymentMethod" value="UPI"> UPI · demo payment</label><label class="payment-option"><input type="radio" name="paymentMethod" value="Card"> Card · demo payment</label></div></div><div class="full modal-message" id="checkout-message"></div></div><aside class="checkout-summary"><h3>Something delicious</h3>${itemSummary}<div class="summary-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div><div class="summary-line"><span>Discount</span><strong>−${money(discount)}</strong></div><div class="summary-line"><span>Delivery</span><strong>${delivery ? money(delivery) : "On us"}</strong></div><div class="summary-line total"><span>Total</span><strong>${money(subtotal - discount + delivery)}</strong></div><button class="button button-dark" type="submit">Place my order ${icon("arrow-right")}</button><p class="shipping-note">Online payment is a safe demo flow. No card is charged.</p></aside></form>` , true);
}

function showOrderConfirmation(order) {
  state.lastOrder = order;
  state.cart = [];
  state.coupon = null;
  persistCart();
  const items = (order.items || []).map((item) => `<span><span>${Number(item.quantity)} × ${escapeHTML(item.name)}</span><strong>${money(item.price ?? Number(item.unit_price) * item.quantity)}</strong></span>`).join("");
  openModal(`<div class="success-mark">${icon("check")}</div><span class="modal-eyebrow">FRESH FROM US TO YOU</span><h2 id="modal-title">Order placed. Nicely done.</h2><p class="modal-copy">We're already telling the oven. You'll get an update as soon as we start baking.</p><div class="success-order-code">${escapeHTML(order.id || order.order_code)}</div><div class="tracking-steps">${["Order placed", "Confirmed", "Baking", "Out for delivery", "Delivered"].map((label, index) => `<div class="tracking-step ${index === 0 ? "done" : ""}"><span>${index === 0 ? "✓" : index + 1}</span>${label}</div>`).join("")}</div><div class="confirmation-lines">${items}<span><strong>Delivery</strong><strong>${escapeHTML(order.address?.street || order.street || "")}, ${escapeHTML(order.address?.city || order.city || "")}</strong></span><span><strong>Arriving</strong><strong>${escapeHTML(order.deliveryDate || order.delivery_date || "")}, ${escapeHTML(order.timeSlot || order.time_slot || "")}</strong></span><span><strong>Payment</strong><strong>${escapeHTML(order.paymentMethod || order.payment_method || "")}</strong></span><span><strong>Total</strong><strong>${money(order.total)}</strong></span></div><button class="button button-dark" data-action="track-order" data-code="${escapeHTML(order.id || order.order_code)}" type="button">Track your order ${icon("arrow-right")}</button>`);
}

async function showTracking(orderCode) {
  try {
    const order = await api(`/api/orders/${encodeURIComponent(orderCode)}`);
    const statuses = ["Order placed", "Order confirmed", "Baking", "Out for delivery", "Delivered"];
    const current = statuses.indexOf(order.status);
    const steps = statuses.map((label, index) => `<div class="tracking-step ${index <= current ? "done" : ""}"><span>${index < current ? "✓" : index + 1}</span>${label}</div>`).join("");
    openModal(`<span class="modal-eyebrow">A LITTLE UPDATE FROM THE OVEN</span><h2 id="modal-title">Your order, in good hands.</h2><p class="modal-copy">Order ${escapeHTML(order.order_code)} · ${escapeHTML(order.delivery_date)}</p><div class="tracking-steps">${steps}</div><div class="confirmation-lines"><span><strong>Current status</strong><strong>${escapeHTML(order.status)}</strong></span><span><strong>Delivery window</strong><strong>${escapeHTML(order.time_slot)}</strong></span><span><strong>Order total</strong><strong>${money(order.total)}</strong></span></div>`);
  } catch (error) { toast(error.message, "error"); }
}

async function openAccount(tab = "orders") {
  if (!state.user) return openAuth();
  state.accountTab = tab;
  let orders = [];
  let wishlist = [];
  let addresses = [];
  try {
    if (tab === "orders") orders = await api("/api/orders");
    if (tab === "wishlist") wishlist = await api("/api/wishlist");
    if (tab === "profile") addresses = await api("/api/addresses");
  } catch (error) { toast(error.message, "error"); }
  const content = tab === "orders" ? orders.length ? orders.map((order) => `<div class="account-order"><span><strong>${escapeHTML(order.order_code)}</strong><br><small>${new Date(order.created_at).toLocaleDateString()} · ${escapeHTML(order.status)}</small></span><span>${money(order.total)}<br><button data-action="track-order" data-code="${escapeHTML(order.order_code)}">Track order</button></span></div>`).join("") : `<p class="modal-copy">No orders yet. That feels like an easy fix.</p><a class="text-link" href="#shop" data-action="close-and-shop">Find something lovely ${icon("arrow-right")}</a>`
    : tab === "wishlist" ? wishlist.length ? wishlist.map((product) => `<div class="account-order"><span><strong>${escapeHTML(product.name)}</strong><br><small>${money(product.price)}</small></span><span><button data-action="detail" data-id="${product.id}">View</button> · <button data-action="favorite" data-id="${product.id}">Remove</button></span></div>`).join("") : `<p class="modal-copy">Your little list is waiting for a favorite.</p>`
    : `<div class="account-order"><span><strong>${escapeHTML(state.user.name)}</strong><br><small>${escapeHTML(state.user.email)}</small></span><span>${escapeHTML(state.user.phone || "Add phone at checkout")}</span></div>${addresses.length ? addresses.map((address) => `<div class="account-order"><span><strong>${escapeHTML(address.full_name)}</strong><br><small>${escapeHTML(address.street)}, ${escapeHTML(address.city)} ${escapeHTML(address.postal_code)}</small></span><span>${escapeHTML(address.phone)}</span></div>`).join("") : `<p class="modal-copy">Your saved delivery addresses will appear here after your first order.</p>`}`;
  openModal(`<span class="modal-eyebrow">YOUR LITTLE CORNER</span><h2 id="modal-title">My SweetCrust.</h2><div class="account-welcome"><strong>Hello, ${escapeHTML(state.user.name.split(" ")[0])}.</strong><button data-action="logout" type="button">Sign out</button></div><div class="account-tabs"><button class="${tab === "orders" ? "active" : ""}" data-action="account-tab" data-tab="orders">My orders</button><button class="${tab === "wishlist" ? "active" : ""}" data-action="account-tab" data-tab="wishlist">Saved favorites</button><button class="${tab === "profile" ? "active" : ""}" data-action="account-tab" data-tab="profile">Profile</button></div><div>${content}</div>${state.user.role === "admin" ? `<button class="button button-dark" data-action="admin" style="margin-top:20px">Open bakery dashboard ${icon("arrow-right")}</button>` : ""}`);
}

async function openAdmin(tab = "overview") {
  if (state.user?.role !== "admin") return toast("Admin access is required.", "error");
  state.adminTab = tab;
  try {
    const stats = await api("/api/admin/stats");
    const section = tab === "overview" ? `<div class="admin-stats">${[["Orders", stats.orders], ["Customers", stats.customers], ["Products", stats.products], ["Revenue", money(stats.revenue)], ["Pending", stats.pending], ["Completed", stats.completed]].map(([label, value]) => `<div class="admin-stat"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div><h3>Recent orders</h3>${adminOrdersTable(stats.recentOrders)}`
      : tab === "products" ? `<div class="admin-actions"><button class="button button-dark admin-add" data-action="admin-add-product">${icon("plus")} Add a product</button></div>${adminProductsTable(await api("/api/admin/products"))}`
      : tab === "categories" ? `${adminCategoriesTable(await api("/api/admin/categories"))}<button class="button button-dark admin-add" data-action="admin-add-category">${icon("plus")} Add a category</button>`
      : tab === "coupons" ? `${adminCouponsTable(await api("/api/admin/coupons"))}<button class="button button-dark admin-add" data-action="admin-add-coupon">${icon("plus")} Add a coupon</button>`
      : tab === "customers" ? adminCustomersTable(await api("/api/admin/customers"))
      : adminOrdersTable(await api("/api/orders"));
    openModal(`<span class="modal-eyebrow">SWEETCRUST · BACK OF HOUSE</span><h2 id="modal-title">Bakery dashboard.</h2><div class="admin-tabs">${["overview", "orders", "products", "categories", "coupons", "customers"].map((value) => `<button class="${tab === value ? "active" : ""}" data-action="admin-tab" data-tab="${value}">${value[0].toUpperCase()}${value.slice(1)}</button>`).join("")}</div>${section}`, true);
  } catch (error) { toast(error.message, "error"); }
}

function adminOrdersTable(orders) {
  if (!orders.length) return `<p class="modal-copy">No orders just yet. The oven's ready.</p>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Update</th></tr></thead><tbody>${orders.map((order) => `<tr><td>${escapeHTML(order.order_code)}</td><td>${escapeHTML(order.full_name)}</td><td>${money(order.total)}</td><td>${escapeHTML(order.status)}</td><td><select data-order-status="${escapeHTML(order.order_code)}"><option>${escapeHTML(order.status)}</option>${["Order placed", "Order confirmed", "Baking", "Out for delivery", "Delivered", "Cancelled"].filter((status) => status !== order.status).map((status) => `<option>${status}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
}

function adminProductsTable(products) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Action</th></tr></thead><tbody>${products.filter((product) => product.active).map((product) => `<tr><td>${escapeHTML(product.name)}</td><td>${money(product.price)}</td><td>${product.stock}</td><td><button class="text-link" data-action="edit-product" data-id="${product.id}">Edit</button> <button class="remove-item" data-action="delete-product" data-id="${product.id}" aria-label="Remove product">${icon("trash-2")}</button></td></tr>`).join("")}</tbody></table></div>`;
}

function adminCategoriesTable(categories) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Category</th><th>Slug</th><th>Products</th></tr></thead><tbody>${categories.map((category) => `<tr><td>${escapeHTML(category.name)}</td><td>${escapeHTML(category.slug)}</td><td>${category.product_count}</td></tr>`).join("")}</tbody></table></div>`;
}

function adminCouponsTable(coupons) {
  if (!coupons.length) return `<p class="modal-copy">No coupons yet.</p>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Code</th><th>Offer</th><th>Minimum</th><th>State</th><th>Action</th></tr></thead><tbody>${coupons.map((coupon) => `<tr><td>${escapeHTML(coupon.code)}</td><td>${coupon.kind === "percent" ? `${coupon.value}% off` : `${money(coupon.value)} off`}</td><td>${money(coupon.minimum)}</td><td>${coupon.active ? "Active" : "Paused"}</td><td><button class="text-link" data-action="toggle-coupon" data-id="${coupon.id}" data-active="${coupon.active ? "false" : "true"}">${coupon.active ? "Pause" : "Activate"}</button></td></tr>`).join("")}</tbody></table></div>`;
}

function adminCustomersTable(customers) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th></tr></thead><tbody>${customers.map((customer) => `<tr><td>${escapeHTML(customer.name)}</td><td>${escapeHTML(customer.email)}</td><td>${escapeHTML(customer.phone || "—")}</td><td>${new Date(customer.created_at * 1000).toLocaleDateString()}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderContactForm() {
  openModal(`<span class="modal-eyebrow">A REAL HUMAN WILL READ THIS</span><h2 id="modal-title">Send us a little note.</h2><p class="modal-copy">Questions, celebrations, or just want to talk cake? We're listening.</p><form id="contact-form" class="modal-form"><label>Your name<input name="name" required minlength="2"></label><label>Your email<input name="email" type="email" required></label><label>Your note<textarea name="message" required minlength="10" maxlength="1500"></textarea></label><div class="modal-message"></div><button class="button button-dark" type="submit">Send my note ${icon("arrow-right")}</button></form>`);
}

document.addEventListener("click", async (event) => {
  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) {
    state.activeCategory = categoryButton.dataset.category;
    document.querySelector("#category-filter").value = state.activeCategory;
    loadProducts();
    document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, index } = button.dataset;
  if (action === "menu") document.querySelector(".main-nav").classList.toggle("is-open");
    if (action === "search-toggle") {
      const search = button.closest(".search-box");
      search.classList.add("is-open");
      search.querySelector("input").focus({ preventScroll: true });
    }
  if (action === "account") state.user ? openAccount() : openAuth();
  if (action === "cart") renderCart();
  if (action === "close-modal") closeModal();
  if (action === "close-and-shop") closeModal();
  if (action === "detail") openProduct(id);
  if (action === "review-login") { state.reviewProduct = Number(id); openAuth("login", "Sign in to share your note."); }
  if (action === "load-more") { state.visibleCount += 8; renderProducts(); }
  if (action === "clear-filter") {
    state.activeCategory = ""; state.search = ""; document.querySelector("#search-input").value = ""; document.querySelector("#category-filter").value = ""; document.querySelector("#price-filter").value = ""; document.querySelector("#rating-filter").value = ""; loadProducts();
  }
  if (action === "quantity") {
    const item = state.cart[Number(index)];
    item.quantity += Number(button.dataset.change);
    if (item.quantity < 1) state.cart.splice(Number(index), 1);
    persistCart(); renderCart();
  }
  if (action === "remove-item") { state.cart.splice(Number(index), 1); persistCart(); renderCart(); }
  if (action === "add-detail" || action === "buy-detail") {
    const product = state.products.find((item) => Number(item.id) === Number(id));
    addToCart(product, { size: document.querySelector("#detail-size")?.value, flavor: document.querySelector("#detail-flavor")?.value, note: document.querySelector("#detail-note")?.value.trim() });
    if (action === "buy-detail") openCheckout(); else renderCart();
  }
  if (action === "favorite") {
    if (!state.user) return openAuth("login", "Sign in to keep your favorite bakes close.");
    try {
      if (state.favorites.has(Number(id))) { await api(`/api/wishlist/${id}`, { method: "DELETE" }); state.favorites.delete(Number(id)); toast("Removed from your favorites."); }
      else { await api(`/api/wishlist/${id}`, { method: "POST", body: {} }); state.favorites.add(Number(id)); toast("Saved to your favorites."); }
      renderProducts();
    } catch (error) { toast(error.message, "error"); }
  }
  if (action === "apply-coupon") {
    const code = document.querySelector("#coupon-input").value.trim().toUpperCase();
    try {
      state.coupon = await api(`/api/coupons/${encodeURIComponent(code)}`);
      const subtotal = state.cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      if (subtotal < Number(state.coupon.minimum)) { state.coupon = null; throw new Error(`That code starts at ${money((await api(`/api/coupons/${encodeURIComponent(code)}`)).minimum)}.`); }
      renderCart(); toast(`${code} applied. Sweet.`);
    } catch (error) { document.querySelector(".coupon-note").textContent = error.message; document.querySelector(".coupon-note").style.color = "var(--rust)"; }
  }
  if (action === "checkout") openCheckout();
  if (action === "auth-mode") openAuth(button.dataset.mode);
  if (action === "logout") {
    await api("/api/auth/logout", { method: "POST" }); state.user = null; state.favorites.clear(); closeModal(); toast("You've been signed out.");
  }
  if (action === "account-tab") openAccount(button.dataset.tab);
  if (action === "track-order") showTracking(button.dataset.code);
  if (action === "admin") openAdmin();
  if (action === "admin-tab") openAdmin(button.dataset.tab);
  if (action === "admin-add-product") {
    openModal(`<span class="modal-eyebrow">SOMETHING NEW FROM THE OVEN</span><h2 id="modal-title">Add a lovely thing.</h2><form id="product-form" class="modal-form"><label>Product name<input name="name" required minlength="3"></label><label>Description<textarea name="description" maxlength="500"></textarea></label><label>Category<select name="category_id" required>${state.categories.map((category) => `<option value="${category.id}">${escapeHTML(category.name)}</option>`).join("")}</select></label><label>Price<input name="price" type="number" min="1" step="0.01" required></label><label>Image URL<input name="image" type="url" placeholder="https://…" required></label><label>Flavor<input name="flavor"></label><label>Opening stock<input name="stock" type="number" min="0" value="12"></label><div class="modal-message"></div><button class="button button-dark">Add to the bakery</button></form>`);
  }
  if (action === "edit-product") {
    const product = (await api("/api/admin/products")).find((item) => Number(item.id) === Number(id));
    if (!product) return toast("That product is no longer on the menu.", "error");
    openModal(`<span class="modal-eyebrow">A LITTLE BACK-OF-HOUSE POLISH</span><h2 id="modal-title">Edit ${escapeHTML(product.name)}.</h2><form id="product-form" class="modal-form" data-product-id="${product.id}"><label>Product name<input name="name" required minlength="3" value="${escapeHTML(product.name)}"></label><label>Description<textarea name="description" maxlength="500">${escapeHTML(product.description)}</textarea></label><label>Price<input name="price" type="number" min="1" step="0.01" required value="${product.price}"></label><label>Opening stock<input name="stock" type="number" min="0" value="${product.stock}"></label><div class="modal-message"></div><button class="button button-dark">Save changes</button></form>`);
  }
  if (action === "admin-add-category") openModal(`<span class="modal-eyebrow">A NEW LITTLE CORNER</span><h2 id="modal-title">Add a category.</h2><form id="category-form" class="modal-form"><label>Category name<input name="name" required minlength="3" placeholder="Seasonal tarts"></label><label>Short description<input name="description" maxlength="200"></label><div class="modal-message"></div><button class="button button-dark">Add category</button></form>`);
  if (action === "admin-add-coupon") openModal(`<span class="modal-eyebrow">A LITTLE THANK-YOU</span><h2 id="modal-title">Add a coupon.</h2><form id="coupon-form" class="modal-form"><label>Coupon code<input name="code" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_-]+" placeholder="SWEET15"></label><label>Discount type<select name="kind"><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></label><label>Discount value<input name="value" type="number" required min="0.01" step="0.01"></label><label>Minimum order total<input name="minimum" type="number" min="0" step="0.01" value="0"></label><div class="modal-message"></div><button class="button button-dark">Add coupon</button></form>`);
  if (action === "toggle-coupon") {
    try { await api(`/api/admin/coupons/${id}`, { method: "PATCH", body: { active: button.dataset.active === "true" } }); toast("Coupon updated."); openAdmin("coupons"); }
    catch (error) { toast(error.message, "error"); }
  }
  if (action === "delete-product") {
    const product = state.products.find((item) => Number(item.id) === Number(id));
    if (!window.confirm(`Remove ${product?.name || "this product"} from the live bakery?`)) return;
    try { await api(`/api/admin/products/${id}`, { method: "DELETE" }); toast("Product removed from the bakery."); openAdmin("products"); await loadProducts(); }
    catch (error) { toast(error.message, "error"); }
  }
  if (action === "contact-form") renderContactForm();
});

// Enter product details with the keyboard as well as the mouse.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("#modal-backdrop").hidden) closeModal();
  if (event.key === "Escape" && document.activeElement.id === "search-input") { document.querySelector(".search-box").classList.remove("is-open"); document.activeElement.blur(); }
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { event.preventDefault(); document.querySelector(".search-box").classList.add("is-open"); document.querySelector("#search-input").focus(); }
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".product-name[role=button]")) { event.preventDefault(); openProduct(event.target.dataset.id); }
});

document.querySelector("#modal-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "modal-backdrop") closeModal();
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (form.id === "auth-form") {
    const mode = form.dataset.mode;
    const submitButton = form.querySelector("button[type=submit]");
    submitButton.disabled = true; submitButton.textContent = "One little moment…";
    try {
      const result = await api(`/api/auth/${mode}`, { method: "POST", body: values });
      state.user = result.user;
      try { state.favorites = new Set((await api("/api/wishlist")).map((product) => Number(product.id))); } catch {}
      toast(`Lovely to see you, ${state.user.name.split(" ")[0]}.`);
      if (state.checkoutPending) openCheckout();
      else if (state.reviewProduct) { const productId = state.reviewProduct; state.reviewProduct = null; openProduct(productId); }
      else if (state.user.role === "admin") openAdmin();
      else openAccount();
    } catch (error) {
      const message = form.querySelector(".modal-message");
      message.textContent = error.message;
      submitButton.disabled = false;
      submitButton.innerHTML = `${mode === "register" ? "Create my account" : "Sign in"} ${icon("arrow-right")}`;
      refreshIcons();
    }
  }
  if (form.id === "checkout-form") {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true; button.textContent = "Telling the oven…";
    const payload = {
      items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, size: item.size, flavor: item.flavor, note: item.note, customCake: item.customCake, sponge: item.sponge })),
      address: { fullName: values.fullName, email: values.email, phone: values.phone, street: values.street, city: values.city, postalCode: values.postalCode },
      deliveryDate: values.deliveryDate, timeSlot: values.timeSlot, paymentMethod: values.paymentMethod, couponCode: state.coupon?.code || "", note: values.note,
    };
    try {
      const result = await api("/api/orders", { method: "POST", body: payload });
      showOrderConfirmation(result.order);
    } catch (error) {
      const message = document.querySelector("#checkout-message");
      message.textContent = error.message;
      button.disabled = false; button.innerHTML = `Place my order ${icon("arrow-right")}`;
      refreshIcons();
    }
  }
  if (form.id === "product-form") {
    try {
      const productId = form.dataset.productId;
      await api(productId ? `/api/admin/products/${productId}` : "/api/admin/products", { method: productId ? "PATCH" : "POST", body: values });
      toast(productId ? "Product changes saved." : "A new bake is on the menu.");
      await loadProducts(); openAdmin("products");
    } catch (error) { form.querySelector(".modal-message").textContent = error.message; }
  }
  if (form.id === "category-form") {
    try {
      await api("/api/admin/categories", { method: "POST", body: values });
      state.categories = await api("/api/categories");
      renderCategories(); toast("Category added to the menu."); openAdmin("categories");
    } catch (error) { form.querySelector(".modal-message").textContent = error.message; }
  }
  if (form.id === "coupon-form") {
    try { await api("/api/admin/coupons", { method: "POST", body: values }); toast("Coupon added to the menu."); openAdmin("coupons"); }
    catch (error) { form.querySelector(".modal-message").textContent = error.message; }
  }
  if (form.id === "contact-form") {
    try { const result = await api("/api/contact", { method: "POST", body: values }); openModal(`<div class="success-mark">${icon("check")}</div><h2 id="modal-title">${escapeHTML(result.message)}</h2><p class="modal-copy">We're looking forward to talking with you.</p>`); }
    catch (error) { form.querySelector(".modal-message").textContent = error.message; }
  }
  if (form.id === "review-form") {
    const productId = Number(form.dataset.productId);
    try {
      await api(`/api/products/${productId}/reviews`, { method: "POST", body: values });
      toast("Your note is on the menu. Thank you.");
      await loadProducts();
      openProduct(productId);
    } catch (error) { form.querySelector(".modal-message").textContent = error.message; }
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "category-filter") { state.activeCategory = event.target.value; loadProducts(); }
  if (["sort-filter", "price-filter", "rating-filter"].includes(event.target.id)) loadProducts();
  if (event.target.matches("[data-order-status]")) {
    try { await api(`/api/admin/orders/${encodeURIComponent(event.target.dataset.orderStatus)}`, { method: "PATCH", body: { status: event.target.value } }); toast("Order status updated."); openAdmin(state.adminTab); }
    catch (error) { toast(error.message, "error"); }
  }
});

let searchTimer;
document.querySelector("#search-input").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = event.target.value.trim(); state.activeCategory = ""; document.querySelector("#category-filter").value = ""; loadProducts(); if (state.search) document.querySelector("#shop").scrollIntoView({ behavior: "smooth" }); }, 280);
});
document.querySelector("#builder-form").addEventListener("change", (event) => {
  if (event.target.name === "size") document.querySelector("#builder-price").textContent = money(event.target.selectedOptions[0].dataset.price);
});
document.querySelector("#builder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const product = state.products.find((item) => Number(item.id) === 1);
  if (!product) return toast("The cake studio is getting the oven ready. Try again in a moment.", "error");
  const sizeOption = event.currentTarget.elements.size.selectedOptions[0];
  const customCake = { ...product, name: `${values.flavor} cake, ${values.size}`, price: Number(sizeOption.dataset.price), sizes: [values.size], flavors: [values.flavor] };
  addToCart(customCake, { size: values.size, flavor: `${values.cream} · ${values.design}`, note: values.message, customCake: true, sponge: values.flavor });
  renderCart();
});

document.querySelector("#newsletter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get("email");
  try { const result = await api("/api/newsletter", { method: "POST", body: { email } }); event.currentTarget.reset(); toast(result.message); }
  catch (error) { toast(error.message, "error"); }
});

document.querySelector("#modal-content").addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.matches("#auth-form, #checkout-form, #product-form, #contact-form")) return;
});

(async function initialize() {
  refreshIcons();
  updateCartCount();
  try {
    const [categories, userResponse] = await Promise.all([api("/api/categories"), api("/api/auth/me")]);
    state.categories = categories;
    state.user = userResponse.user;
    renderCategories();
    await loadProducts();
    if (state.user) {
      try { state.favorites = new Set((await api("/api/wishlist")).map((product) => Number(product.id))); renderProducts(); } catch {}
    }
  } catch (error) {
    toast("The bakery is having a slow morning. Make sure the server is running.", "error");
  }
})();
