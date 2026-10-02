const express = require("express");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDirectory = path.join(__dirname, "data");
const databasePath = path.join(dataDirectory, "sweetcrust.sqlite");
const sessionCookie = "sweetcrust_session";
let database;

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; script-src 'self' https://unpkg.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (process.env.NODE_ENV === "production") response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

function query(sql, parameters = []) {
  const statement = database.prepare(sql);
  statement.bind(parameters);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

function run(sql, parameters = []) {
  database.run(sql, parameters);
  return database.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0];
}

function persist() {
  fs.writeFileSync(databasePath, Buffer.from(database.export()));
}

function fail(response, status, message) {
  return response.status(status).json({ error: message });
}

function requireUser(request, response, next) {
  if (!request.user) return fail(response, 401, "Please sign in to continue.");
  next();
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== "admin") return fail(response, 403, "Admin access is required.");
  next();
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone || "" };
}

function createSession(response, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
    crypto.createHash("sha256").update(token).digest("hex"), userId, Date.now() + 30 * 86400000,
  ]);
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 86400000,
    path: "/",
  });
}

app.use((request, response, next) => {
  const token = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (!token) return next();
  const tokenHash = crypto.createHash("sha256").update(decodeURIComponent(token)).digest("hex");
  const session = query(
    "SELECT users.id, users.name, users.email, users.role, users.phone FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
    [tokenHash, Date.now()],
  )[0];
  request.user = safeUser(session);
  next();
});

const loginAttempts = new Map();
function limitLoginAttempts(request, response, next) {
  const address = request.ip;
  const recent = (loginAttempts.get(address) || []).filter((time) => Date.now() - time < 60000);
  if (recent.length >= 10) return fail(response, 429, "Too many attempts. Try again in a minute.");
  recent.push(Date.now());
  loginAttempts.set(address, recent);
  next();
}

app.get("/api/health", (request, response) => response.json({ status: "ok" }));
app.get("/api/products", (request, response) => {
  const conditions = ["products.active = 1"];
  const parameters = [];
  if (request.query.category) {
    conditions.push("categories.slug = ?");
    parameters.push(String(request.query.category));
  }
  if (request.query.search) {
    const term = `%${String(request.query.search).slice(0, 80)}%`;
    conditions.push("(products.name LIKE ? OR products.description LIKE ? OR products.flavor LIKE ? OR categories.name LIKE ?)");
    parameters.push(term, term, term, term);
  }
  if (request.query.max) {
    conditions.push("products.price <= ?");
    parameters.push(Math.max(0, Number(request.query.max) || 0));
  }
  if (request.query.min_rating) {
    conditions.push("products.rating >= ?");
    parameters.push(Math.min(5, Math.max(0, Number(request.query.min_rating) || 0)));
  }
  const ordering = {
    popular: "products.popularity DESC, products.id",
    newest: "products.id DESC",
    price_asc: "products.price ASC",
    price_desc: "products.price DESC",
    rating: "products.rating DESC",
    discount: "products.discount DESC",
  }[request.query.sort] || "products.featured DESC, products.popularity DESC";
  const products = query(
    `SELECT products.*, categories.name AS category_name, categories.slug AS category_slug FROM products JOIN categories ON categories.id = products.category_id WHERE ${conditions.join(" AND ")} ORDER BY ${ordering}`,
    parameters,
  ).map((product) => ({ ...product, sizes: JSON.parse(product.sizes), flavors: JSON.parse(product.flavors) }));
  response.json(products);
});

app.get("/api/categories", (request, response) => response.json(query("SELECT * FROM categories ORDER BY id")));

app.get("/api/products/:id/reviews", (request, response) => {
  response.json(query("SELECT reviews.rating, reviews.comment, reviews.created_at, users.name FROM reviews JOIN users ON users.id = reviews.user_id WHERE reviews.product_id = ? ORDER BY reviews.created_at DESC LIMIT 30", [Number(request.params.id)]));
});
app.post("/api/products/:id/reviews", requireUser, (request, response) => {
  const productId = Number(request.params.id);
  const rating = Math.floor(Number(request.body.rating));
  const comment = String(request.body.comment || "").trim();
  if (!query("SELECT id FROM products WHERE id = ? AND active = 1", [productId]).length) return fail(response, 404, "That product is unavailable.");
  if (rating < 1 || rating > 5 || comment.length < 3 || comment.length > 500) return fail(response, 400, "Choose a rating and write a review between 3 and 500 characters.");
  run("INSERT INTO reviews (product_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at", [productId, request.user.id, rating, comment, Date.now()]);
  run("UPDATE products SET rating = (SELECT AVG(rating) FROM reviews WHERE product_id = ?) WHERE id = ?", [productId, productId]);
  persist();
  response.status(201).json({ success: true });
});

app.get("/api/auth/me", (request, response) => response.json({ user: request.user || null }));
app.post("/api/auth/register", async (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  if (name.length < 2 || name.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
    return fail(response, 400, "Enter a valid name and email, and a password with at least 8 characters.");
  }
  if (query("SELECT id FROM users WHERE email = ?", [email]).length) return fail(response, 409, "An account with that email already exists.");
  const id = run("INSERT INTO users (name, email, password_hash, phone) VALUES (?, ?, ?, ?)", [
    name, email, await bcrypt.hash(password, 12), String(request.body.phone || "").slice(0, 30),
  ]);
  createSession(response, id);
  persist();
  response.status(201).json({ user: safeUser(query("SELECT * FROM users WHERE id = ?", [id])[0]) });
});

app.post("/api/auth/login", limitLoginAttempts, async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const user = query("SELECT * FROM users WHERE email = ?", [email])[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return fail(response, 401, "Email or password is incorrect.");
  createSession(response, user.id);
  persist();
  response.json({ user: safeUser(user) });
});

app.post("/api/auth/logout", (request, response) => {
  const token = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", [crypto.createHash("sha256").update(decodeURIComponent(token)).digest("hex")]);
  response.clearCookie(sessionCookie, { httpOnly: true, sameSite: "lax", path: "/" });
  persist();
  response.json({ success: true });
});

app.get("/api/coupons/:code", (request, response) => {
  const coupon = query("SELECT code, kind, value, minimum, expires_at FROM coupons WHERE code = ? AND active = 1", [String(request.params.code).toUpperCase()])[0];
  if (!coupon || (coupon.expires_at && coupon.expires_at < Date.now())) return fail(response, 404, "That code is not valid right now.");
  response.json(coupon);
});

app.post("/api/orders", requireUser, (request, response) => {
  const { items, address, deliveryDate, timeSlot, paymentMethod, couponCode, note } = request.body;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) return fail(response, 400, "Your cart is empty or contains too many items.");
  if (!address || !String(address.fullName || "").trim() || !/^\S+@\S+\.\S+$/.test(String(address.email || "")) || !/^\+?[0-9\s()-]{8,20}$/.test(String(address.phone || "")) || String(address.street || "").length < 5 || String(address.city || "").length < 2 || !/^\d{5,10}$/.test(String(address.postalCode || ""))) return fail(response, 400, "Please check your delivery details.");
  const allowedPayments = ["Cash on delivery", "UPI", "Card"];
  if (!allowedPayments.includes(paymentMethod)) return fail(response, 400, "Choose a valid payment method.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate || "")) || new Date(`${deliveryDate}T00:00:00`).getTime() < new Date(new Date().toDateString()).getTime()) return fail(response, 400, "Choose a valid delivery date.");

  const orderItems = [];
  let subtotal = 0;
  for (const item of items) {
    const product = query("SELECT id, name, price, stock, image, discount, category_id FROM products WHERE id = ? AND active = 1", [Number(item.productId)])[0];
    const quantity = Math.floor(Number(item.quantity));
    if (!product || !Number.isFinite(quantity) || quantity < 1 || quantity > 20 || quantity > product.stock) return fail(response, 400, "A product quantity is unavailable. Please update your cart.");
    const customCakePrices = { "1 kg": 42, "1.5 kg": 58, "2 kg": 74 };
    const cakeFlavors = ["Vanilla bean", "Belgian chocolate", "Red velvet", "Lemon & elderflower", "Carrot & brown butter"];
    const isCustomCake = item.customCake === true && product.category_id === 1 && Object.hasOwn(customCakePrices, item.size) && cakeFlavors.includes(item.sponge);
    if (item.customCake && !isCustomCake) return fail(response, 400, "Choose a valid size for your custom cake.");
    const unitPrice = isCustomCake ? customCakePrices[item.size] : product.price * (1 - product.discount / 100);
    const price = unitPrice * quantity;
    subtotal += price;
    orderItems.push({ ...product, name: isCustomCake ? `${item.sponge} cake` : product.name, quantity, price, unitPrice, size: String(item.size || "").slice(0, 24), flavor: String(item.flavor || "").slice(0, 80), note: String(item.note || "").slice(0, 120) });
  }
  let discount = 0;
  if (couponCode) {
    const coupon = query("SELECT * FROM coupons WHERE code = ? AND active = 1", [String(couponCode).toUpperCase()])[0];
    if (coupon && (!coupon.expires_at || coupon.expires_at > Date.now()) && subtotal >= coupon.minimum) {
      discount = Math.min(subtotal, coupon.kind === "percent" ? Math.round(subtotal * coupon.value) / 100 : coupon.value);
    }
  }
  const delivery = subtotal - discount >= 60 ? 0 : 5;
  const total = Math.max(0, subtotal - discount + delivery);
  const orderId = `SC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const databaseOrderId = run(
    "INSERT INTO orders (order_code, user_id, full_name, email, phone, street, city, postal_code, delivery_date, time_slot, payment_method, status, subtotal, discount, delivery_fee, total, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Order placed', ?, ?, ?, ?, ?, ?)",
    [orderId, request.user.id, String(address.fullName).slice(0, 80), String(address.email).slice(0, 120), String(address.phone).slice(0, 25), String(address.street).slice(0, 200), String(address.city).slice(0, 80), String(address.postalCode), deliveryDate, String(timeSlot || "10am–1pm").slice(0, 30), paymentMethod, subtotal, discount, delivery, total, String(note || "").slice(0, 300), Date.now()],
  );
  for (const item of orderItems) {
    run("INSERT INTO order_items (order_id, product_id, product_name, image, quantity, unit_price, size, flavor, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [databaseOrderId, item.id, item.name, item.image, item.quantity, item.unitPrice, item.size, item.flavor, item.note]);
    run("UPDATE products SET stock = stock - ?, popularity = popularity + ? WHERE id = ?", [item.quantity, item.quantity, item.id]);
  }
  run("INSERT INTO payments (order_id, method, amount, status) VALUES (?, ?, ?, ?)", [databaseOrderId, paymentMethod, total, paymentMethod === "Cash on delivery" ? "Pending" : "Demo payment approved"]);
  run("INSERT INTO addresses (user_id, full_name, phone, street, city, postal_code) VALUES (?, ?, ?, ?, ?, ?)", [request.user.id, address.fullName, address.phone, address.street, address.city, address.postalCode]);
  persist();
  response.status(201).json({ order: { id: orderId, name: address.fullName, items: orderItems, subtotal, discount, delivery, total, deliveryDate, timeSlot, address, paymentMethod, status: "Order placed" } });
});

app.get("/api/orders", requireUser, (request, response) => {
  const orders = query(
    `SELECT orders.* FROM orders ${request.user.role === "admin" ? "" : "WHERE orders.user_id = ?"} ORDER BY orders.created_at DESC`,
    request.user.role === "admin" ? [] : [request.user.id],
  );
  response.json(orders.map((order) => ({ ...order, items: query("SELECT * FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)", [order.order_code]) })));
});

app.get("/api/orders/:code", (request, response) => {
  const order = query("SELECT * FROM orders WHERE order_code = ?", [String(request.params.code)])[0];
  if (!order || (request.user?.role !== "admin" && request.user?.id !== order.user_id)) return fail(response, 404, "We could not find that order.");
  response.json({ ...order, items: query("SELECT * FROM order_items WHERE order_id = ?", [order.id]) });
});

app.get("/api/wishlist", requireUser, (request, response) => response.json(query("SELECT products.*, categories.name AS category_name FROM wishlist JOIN products ON products.id = wishlist.product_id JOIN categories ON categories.id = products.category_id WHERE wishlist.user_id = ?", [request.user.id])));
app.get("/api/addresses", requireUser, (request, response) => response.json(query("SELECT id, full_name, phone, street, city, postal_code FROM addresses WHERE user_id = ? ORDER BY id DESC", [request.user.id])));
app.post("/api/wishlist/:id", requireUser, (request, response) => {
  if (!query("SELECT id FROM products WHERE id = ? AND active = 1", [Number(request.params.id)]).length) return fail(response, 404, "That product is unavailable.");
  database.run("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)", [request.user.id, Number(request.params.id)]);
  persist();
  response.json({ success: true });
});
app.delete("/api/wishlist/:id", requireUser, (request, response) => {
  run("DELETE FROM wishlist WHERE user_id = ? AND product_id = ?", [request.user.id, Number(request.params.id)]);
  persist();
  response.json({ success: true });
});

app.post("/api/newsletter", (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(response, 400, "Enter a valid email address.");
  database.run("INSERT OR IGNORE INTO newsletter (email, created_at) VALUES (?, ?)", [email, Date.now()]);
  persist();
  response.json({ success: true, message: "You’re on the list. A little sweetness is headed your way." });
});

app.post("/api/contact", (request, response) => {
  const { name, email, message } = request.body;
  if (String(name || "").trim().length < 2 || !/^\S+@\S+\.\S+$/.test(String(email || "")) || String(message || "").trim().length < 10) return fail(response, 400, "Please fill in your name, email, and a message of at least 10 characters.");
  run("INSERT INTO messages (name, email, message, created_at) VALUES (?, ?, ?, ?)", [String(name).slice(0, 80), String(email).slice(0, 120), String(message).slice(0, 1500), Date.now()]);
  persist();
  response.json({ success: true, message: "Thanks for reaching out. We’ll be in touch shortly." });
});

app.get("/api/admin/stats", requireAdmin, (request, response) => response.json({
  orders: query("SELECT COUNT(*) AS count FROM orders")[0].count,
  customers: query("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'")[0].count,
  products: query("SELECT COUNT(*) AS count FROM products WHERE active = 1")[0].count,
  revenue: query("SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'Delivered'")[0].total,
  pending: query("SELECT COUNT(*) AS count FROM orders WHERE status NOT IN ('Delivered', 'Cancelled')")[0].count,
  completed: query("SELECT COUNT(*) AS count FROM orders WHERE status = 'Delivered'")[0].count,
  recentOrders: query("SELECT order_code, full_name, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 8"),
}));
app.get("/api/admin/products", requireAdmin, (request, response) => response.json(query("SELECT * FROM products ORDER BY id DESC")));
app.get("/api/admin/categories", requireAdmin, (request, response) => response.json(query("SELECT categories.*, COUNT(products.id) AS product_count FROM categories LEFT JOIN products ON products.category_id = categories.id GROUP BY categories.id ORDER BY categories.id")));
app.post("/api/admin/categories", requireAdmin, (request, response) => {
  const name = String(request.body.name || "").trim();
  const slug = String(request.body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).toLowerCase();
  if (name.length < 3 || !/^[a-z0-9-]{3,60}$/.test(slug)) return fail(response, 400, "Enter a category name with at least 3 characters.");
  try {
    const id = run("INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)", [name.slice(0, 80), slug, String(request.body.description || "").slice(0, 200)]);
    persist();
    response.status(201).json({ id });
  } catch { return fail(response, 409, "That category name is already on the menu."); }
});
app.get("/api/admin/coupons", requireAdmin, (request, response) => response.json(query("SELECT * FROM coupons ORDER BY id DESC")));
app.post("/api/admin/coupons", requireAdmin, (request, response) => {
  const code = String(request.body.code || "").trim().toUpperCase();
  const kind = String(request.body.kind || "");
  const value = Number(request.body.value);
  const minimum = Math.max(0, Number(request.body.minimum) || 0);
  if (!/^[A-Z0-9_-]{3,20}$/.test(code) || !["percent", "fixed"].includes(kind) || !Number.isFinite(value) || value <= 0 || (kind === "percent" && value > 100)) return fail(response, 400, "Check the code, discount type, and amount.");
  try {
    const id = run("INSERT INTO coupons (code, kind, value, minimum, active) VALUES (?, ?, ?, ?, 1)", [code, kind, value, minimum]);
    persist();
    response.status(201).json({ id });
  } catch { return fail(response, 409, "That coupon code is already on the menu."); }
});
app.patch("/api/admin/coupons/:id", requireAdmin, (request, response) => {
  if (typeof request.body.active !== "boolean") return fail(response, 400, "Choose whether the coupon is active.");
  run("UPDATE coupons SET active = ? WHERE id = ?", [request.body.active ? 1 : 0, Number(request.params.id)]);
  persist();
  response.json({ success: true });
});
app.post("/api/admin/products", requireAdmin, (request, response) => {
  const { name, description, price, category_id, image } = request.body;
  if (String(name || "").trim().length < 3 || !Number.isFinite(Number(price)) || Number(price) < 1 || !query("SELECT id FROM categories WHERE id = ?", [Number(category_id)]).length) return fail(response, 400, "Check the product name, price, and category.");
  const id = run("INSERT INTO products (category_id, name, description, price, image, flavor, sizes, flavors, stock, rating, featured, popularity, discount, active) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, 5, 0, 0, 0, 1)", [Number(category_id), String(name).trim().slice(0, 100), String(description || "").slice(0, 500), Number(price), String(image || "").slice(0, 500), String(request.body.flavor || "").slice(0, 80), Math.max(0, Math.floor(Number(request.body.stock) || 0))]);
  persist();
  response.status(201).json({ id });
});
app.patch("/api/admin/products/:id", requireAdmin, (request, response) => {
  const id = Number(request.params.id);
  const { name, description, price, stock, active } = request.body;
  if (name !== undefined && String(name).trim().length < 3) return fail(response, 400, "Product names need at least 3 characters.");
  if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 1)) return fail(response, 400, "Enter a valid product price.");
  run("UPDATE products SET name = COALESCE(?, name), description = COALESCE(?, description), price = COALESCE(?, price), stock = COALESCE(?, stock), active = COALESCE(?, active) WHERE id = ?", [name === undefined ? null : String(name).trim().slice(0, 100), description === undefined ? null : String(description).slice(0, 500), price === undefined ? null : Number(price), stock === undefined ? null : Math.max(0, Number(stock)), active === undefined ? null : (active ? 1 : 0), id]);
  persist();
  response.json({ success: true });
});
app.delete("/api/admin/products/:id", requireAdmin, (request, response) => {
  run("UPDATE products SET active = 0 WHERE id = ?", [Number(request.params.id)]);
  persist();
  response.json({ success: true });
});
app.patch("/api/admin/orders/:id", requireAdmin, (request, response) => {
  const statuses = ["Order placed", "Order confirmed", "Baking", "Out for delivery", "Delivered", "Cancelled"];
  if (!statuses.includes(request.body.status)) return fail(response, 400, "Choose a valid order status.");
  run("UPDATE orders SET status = ? WHERE order_code = ?", [request.body.status, String(request.params.id)]);
  persist();
  response.json({ success: true });
});
app.get("/api/admin/customers", requireAdmin, (request, response) => response.json(query("SELECT id, name, email, phone, created_at FROM users WHERE role = 'customer' ORDER BY created_at DESC")));

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: "Something went wrong. Please try again." });
});

const categorySeeds = [
  ["Birthday cakes", "birthday-cakes", "A little celebration in every slice."],
  ["Wedding cakes", "wedding-cakes", "Made for your once-in-a-lifetime yes."],
  ["Anniversary cakes", "anniversary-cakes", "For the love that keeps getting sweeter."],
  ["Chocolate cakes", "chocolate-cakes", "For your cocoa-obsessed moments."],
  ["Photo cakes", "photo-cakes", "Your favorite moments, freshly frosted."],
  ["Cupcakes", "cupcakes", "Small, delightful reasons to celebrate."],
  ["Pastries", "pastries", "An afternoon pick-me-up, perfected."],
  ["Cookies", "cookies", "Golden edges, soft centers, always."],
  ["Brownies", "brownies", "Deeply chocolate. Entirely worth it."],
  ["Donuts", "donuts", "A little ring of everyday joy."],
  ["Breads", "breads", "Slow-fermented, baked fresh each morning."],
  ["Custom cakes", "custom-cakes", "Dream it up. We’ll bake it beautiful."],
];

const productSeeds = [
  [1, "Strawberry cloud cake", "Vanilla bean sponge, silky mascarpone cream and berries picked at their sweetest.", 48, "https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=900&q=85", "Vanilla", 16, 4.9, 1, 98, 0, "[\"1 kg\",\"1.5 kg\",\"2 kg\"]", "[\"Vanilla\",\"Strawberry\",\"Lemon\"]"],
  [4, "Midnight chocolate torte", "Layers of Belgian chocolate, cocoa sponge and a whisper of espresso ganache.", 54, "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=85", "Chocolate", 12, 5.0, 1, 86, 0, "[\"1 kg\",\"1.5 kg\",\"2 kg\"]", "[\"Dark chocolate\",\"Mocha\",\"Hazelnut\"]"],
  [6, "Sunday garden cupcakes", "A box of six vanilla-bean cupcakes finished with seasonal buttercream flowers.", 26, "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?auto=format&fit=crop&w=900&q=85", "Vanilla", 24, 4.8, 1, 76, 0, "[\"Box of 4\",\"Box of 6\",\"Box of 12\"]", "[\"Vanilla\",\"Chocolate\",\"Red velvet\"]"],
  [8, "Brown butter sea-salt cookies", "Crisp around the edges, soft in the middle, finished with flaky sea salt.", 14, "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=900&q=85", "Brown butter", 30, 4.9, 0, 65, 0, "[\"Box of 6\",\"Box of 12\"]", "[\"Classic\",\"Dark chocolate\"]"],
  [7, "Raspberry rose mille-feuille", "Butter-laminated pastry, fresh raspberries and a delicate rose pastry cream.", 12, "https://images.unsplash.com/photo-1483695028939-5bb13f8648b0?auto=format&fit=crop&w=900&q=85", "Raspberry", 18, 4.7, 0, 58, 10, "[\"Single\",\"Box of 4\"]", "[\"Raspberry\",\"Vanilla\"]"],
  [9, "Fudgy walnut brownies", "A crackly top, a fudgy center and toasted walnuts in every generous square.", 18, "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=85", "Chocolate walnut", 22, 4.9, 0, 54, 0, "[\"Box of 4\",\"Box of 8\"]", "[\"Walnut\",\"Classic\"]"],
  [10, "Pistachio morning donuts", "Pillowy brioche donuts dipped in pistachio glaze and roasted, chopped nuts.", 16, "https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=900&q=85", "Pistachio", 20, 4.8, 0, 48, 0, "[\"Box of 4\",\"Box of 6\"]", "[\"Pistachio\",\"Vanilla\"]"],
  [11, "Country sourdough loaf", "Naturally leavened for 24 hours, with a crisp crust and a tender, open crumb.", 10, "https://images.unsplash.com/photo-1585478259715-876acc5be8eb?auto=format&fit=crop&w=900&q=85", "Sourdough", 14, 4.9, 0, 45, 0, "[\"Small\",\"Large\"]", "[\"Country\",\"Olive rosemary\"]"],
  [3, "Honey & elderflower cake", "Lemon-scented layers, local wildflower honey and a light elderflower frosting.", 52, "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?auto=format&fit=crop&w=900&q=85", "Lemon elderflower", 10, 4.8, 0, 42, 0, "[\"1 kg\",\"1.5 kg\"]", "[\"Elderflower\",\"Lemon\"]"],
  [5, "Little moment photo cake", "A smooth buttercream canvas with your favorite photograph printed in edible color.", 58, "https://images.unsplash.com/photo-1542826438-bd32f43d626f?auto=format&fit=crop&w=900&q=85", "Vanilla", 8, 4.7, 0, 38, 0, "[\"1 kg\",\"1.5 kg\",\"2 kg\"]", "[\"Vanilla\",\"Chocolate\",\"Red velvet\"]"],
  [2, "The soft-rose wedding cake", "Three hand-finished tiers with ivory buttercream, garden roses and vanilla bean.", 240, "https://images.unsplash.com/photo-1535254973040-607b474cb50d?auto=format&fit=crop&w=900&q=85", "Vanilla bean", 4, 5.0, 1, 34, 0, "[\"3 tiers\",\"4 tiers\"]", "[\"Vanilla\",\"Lemon\",\"Chocolate\"]"],
  [1, "Funfetti birthday layer cake", "Confetti sprinkles inside and out, with fluffy vanilla frosting and happy-making.", 44, "https://images.unsplash.com/photo-1571115177098-24ec42ed204d?auto=format&fit=crop&w=900&q=85", "Birthday cake", 14, 4.8, 0, 33, 15, "[\"1 kg\",\"1.5 kg\"]", "[\"Vanilla\",\"Chocolate\"]"],
  [6, "Salted caramel cupcakes", "Brown sugar sponge with a soft salted caramel heart and cloud-like frosting.", 28, "https://images.unsplash.com/photo-1603532648955-039310d9ed75?auto=format&fit=crop&w=900&q=85", "Salted caramel", 18, 4.9, 0, 31, 0, "[\"Box of 4\",\"Box of 6\",\"Box of 12\"]", "[\"Caramel\",\"Chocolate\"]"],
  [4, "Black forest celebration cake", "Dark cocoa sponge, tart cherries and fresh whipped cream, just like you remember.", 50, "https://images.unsplash.com/photo-1606890737304-57a1ca8a5b62?auto=format&fit=crop&w=900&q=85", "Black forest", 11, 4.9, 1, 29, 0, "[\"1 kg\",\"1.5 kg\",\"2 kg\"]", "[\"Chocolate cherry\",\"Dark chocolate\"]"],
  [9, "Salted caramel blondies", "Chewy brown-butter blondies with soft ribbons of handmade salted caramel.", 17, "https://images.unsplash.com/photo-1607920591413-4ec007e70023?auto=format&fit=crop&w=900&q=85", "Caramel", 15, 4.7, 0, 25, 0, "[\"Box of 4\",\"Box of 8\"]", "[\"Classic\",\"Walnut\"]"],
];

async function start() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const SQL = await initSqlJs();
  database = fs.existsSync(databasePath) ? new SQL.Database(fs.readFileSync(databasePath)) : new SQL.Database();
  database.run("PRAGMA foreign_keys = ON");
  database.run(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', phone TEXT DEFAULT '', created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id), name TEXT NOT NULL, description TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), image TEXT NOT NULL, flavor TEXT DEFAULT '', sizes TEXT NOT NULL DEFAULT '[]', flavors TEXT NOT NULL DEFAULT '[]', stock INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 5, featured INTEGER NOT NULL DEFAULT 0, popularity INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS carts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY, cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity > 0), options TEXT DEFAULT '{}', UNIQUE(cart_id, product_id, options));
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, order_code TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id), full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, street TEXT NOT NULL, city TEXT NOT NULL, postal_code TEXT NOT NULL, delivery_date TEXT NOT NULL, time_slot TEXT NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL, subtotal REAL NOT NULL, discount REAL NOT NULL, delivery_fee REAL NOT NULL, total REAL NOT NULL, note TEXT DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, product_name TEXT NOT NULL, image TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, size TEXT DEFAULT '', flavor TEXT DEFAULT '', note TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), method TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(product_id, user_id));
    CREATE TABLE IF NOT EXISTS wishlist (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), PRIMARY KEY(user_id, product_id));
    CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, value REAL NOT NULL, minimum REAL NOT NULL DEFAULT 0, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, full_name TEXT NOT NULL, phone TEXT NOT NULL, street TEXT NOT NULL, city TEXT NOT NULL, postal_code TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  if (!query("SELECT id FROM categories LIMIT 1").length) {
    categorySeeds.forEach((category) => run("INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)", category));
    productSeeds.forEach((product) => run("INSERT INTO products (category_id, name, description, price, image, flavor, stock, rating, featured, popularity, discount, sizes, flavors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", product));
    run("INSERT INTO coupons (code, kind, value, minimum, active) VALUES ('SWEET10', 'percent', 10, 30, 1)");
    run("INSERT INTO coupons (code, kind, value, minimum, active) VALUES ('FIRSTBAKE', 'fixed', 8, 40, 1)");
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || "SweetCrust2026!", 12);
    run("INSERT INTO users (name, email, password_hash, role, phone) VALUES ('SweetCrust Admin', 'admin@sweetcrust.com', ?, 'admin', '')", [passwordHash]);
    persist();
  }
  app.listen(port, "0.0.0.0", () => console.log(`SweetCrust is baking at http://localhost:${port}`));
}

start().catch((error) => {
  console.error("Could not start SweetCrust:", error);
  process.exit(1);
});