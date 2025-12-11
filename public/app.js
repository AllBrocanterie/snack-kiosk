// ==== ÉTAT GLOBAL ====
let currentUserId = null;
let cart = [];
let selectedCategory = null;
let selectedSlot = null;

const screens = {
  home: document.getElementById('screen-home'),
  categories: document.getElementById('screen-categories'),
  products: document.getElementById('screen-products'),
  cart: document.getElementById('screen-cart'),
  auth: document.getElementById('screen-auth'),
  confirmation: document.getElementById('screen-confirmation'),
};

const stepIndicator = document.getElementById('step-indicator');

// ==== FONCTION POUR CHANGER D'ÉCRAN ====
function showScreen(name, stepText) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (stepText) stepIndicator.textContent = stepText;
}

// ==== ACCUEIL ====
document.getElementById('btn-start-order').addEventListener('click', () => {
  loadCategories();
  showScreen('categories', 'Étape 2/4 : Catégories');
});

// ==== NAVIGATION RETOUR ====
document.getElementById('btn-back-home').addEventListener('click', () => {
  showScreen('home', 'Étape 1/4 : Accueil');
});

document.getElementById('btn-back-categories').addEventListener('click', () => {
  showScreen('categories', 'Étape 2/4 : Catégories');
});

document.getElementById('btn-back-products').addEventListener('click', () => {
  showScreen('products', 'Étape 3/4 : Produits');
});

document.getElementById('btn-back-cart').addEventListener('click', () => {
  showScreen('cart', 'Étape 4/4 : Panier & créneau');
});

// ==== CHARGER LES CATÉGORIES ====
async function loadCategories() {
  const res = await fetch('/api/categories');
  const data = await res.json();

  const container = document.getElementById('categories-container');
  container.innerHTML = '';

  data.categories.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<h3>${cat}</h3>`;
    div.addEventListener('click', () => {
      selectedCategory = cat;
      loadProducts(cat);
      document.getElementById('products-title').textContent = cat;
      showScreen('products', 'Étape 3/4 : Produits');
    });
    container.appendChild(div);
  });
}

// ==== CHARGER LES PRODUITS D'UNE CATÉGORIE ====
async function loadProducts(category) {
  const res = await fetch('/api/menu?category=' + encodeURIComponent(category));
  const data = await res.json();

  const container = document.getElementById('products-container');
  container.innerHTML = '';

  data.items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <h3>${item.name}</h3>
      <p>${(item.price_cents / 100).toFixed(2)} €</p>
      <button class="btn-secondary">Ajouter</button>
    `;
    div.querySelector('button').addEventListener('click', () => {
      addToCart(item);
    });
    container.appendChild(div);
  });
}

// ==== PANIER ====
function addToCart(item) {
  const existing = cart.find(ci => ci.id === item.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      price_cents: item.price_cents,
      quantity: 1
    });
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  container.innerHTML = '';
  let total = 0;

  cart.forEach(item => {
    total += item.price_cents * item.quantity;
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <span>${item.name} x ${item.quantity}</span>
      <span>${(item.price_cents * item.quantity / 100).toFixed(2)} €</span>
    `;
    container.appendChild(div);
  });

  document.getElementById('cart-total').textContent = (total / 100).toFixed(2) + ' €';
}

// Quand on clique sur "Voir le panier"
document.getElementById('btn-go-cart').addEventListener('click', () => {
  renderCart();
  loadSlots();
  showScreen('cart', 'Étape 4/4 : Panier & créneau');
});

// ==== CHARGER LES CRÉNEAUX ====
async function loadSlots() {
  const today = new Date().toISOString().slice(0, 10); // format YYYY-MM-DD
  const res = await fetch('/api/slots?date=' + today);
  const data = await res.json();

  const select = document.getElementById('slot-select');
  select.innerHTML = '';

  data.slots.forEach(slot => {
    const d = new Date(slot.time);
    const label = d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const option = document.createElement('option');
    option.value = slot.time;
    option.textContent = label + (slot.available ? '' : ' (complet)');
    if (!slot.available) {
      option.disabled = true;
    }
    select.appendChild(option);
  });
}

// ==== BOUTON "VALIDER LA COMMANDE" ====
document.getElementById('btn-checkout').addEventListener('click', async () => {
  if (cart.length === 0) {
    alert('Votre panier est vide.');
    return;
  }

  // Si pas connecté, on passe par l'écran téléphone
  if (!currentUserId) {
    showScreen('auth', 'Étape 3/4 : Connexion');
    return;
  }

  const slotSelect = document.getElementById('slot-select');
  selectedSlot = slotSelect.value;
  if (!selectedSlot) {
    alert('Veuillez choisir un créneau.');
    return;
  }

  const paymentRadios = document.querySelectorAll('input[name="payment-method"]');
  let paymentMethod = 'counter';
  paymentRadios.forEach(r => {
    if (r.checked) paymentMethod = r.value;
  });

  const body = {
    userId: currentUserId,
    items: cart,
    paymentMethod,
    slotTime: selectedSlot
  };

  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erreur lors de la commande');
    return;
  }

  document.getElementById('order-number').textContent = data.orderId;
  const slotDate = new Date(selectedSlot);
  document.getElementById('order-slot').textContent = slotDate.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  cart = [];
  showScreen('confirmation', 'Commande confirmée');
});

// ==== CONNEXION PAR TÉLÉPHONE ====

// Bouton "Recevoir un code"
document.getElementById('btn-send-code').addEventListener('click', async () => {
  const name = document.getElementById('auth-name').value;
  const phone = document.getElementById('auth-phone').value;

  if (!phone) {
    alert('Veuillez entrer votre téléphone.');
    return;
  }

  const res = await fetch('/api/request-login-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erreur lors de l\'envoi du code');
    return;
  }

  alert('Code généré. En mode développement, regarde la console du serveur.');
});

// Bouton "Valider le code"
document.getElementById('btn-verify-code').addEventListener('click', async () => {
  const phone = document.getElementById('auth-phone').value;
  const code = document.getElementById('auth-code').value;

  if (!phone || !code) {
    alert('Téléphone et code requis.');
    return;
  }

  const res = await fetch('/api/verify-login-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Code invalide');
    return;
  }

  currentUserId = data.userId;
  alert('Vous êtes connecté.');
  showScreen('cart', 'Étape 4/4 : Panier & créneau');
});

// ==== NOUVELLE COMMANDE ====
document.getElementById('btn-new-order').addEventListener('click', () => {
  showScreen('home', 'Étape 1/4 : Accueil');
});
