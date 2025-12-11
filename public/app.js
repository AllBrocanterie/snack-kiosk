// ==== CONFIG TACOS SUR-MESURE ====

// Viandes proposées
const TACOS_MEATS = [
  { id: 'poulet', label: 'Poulet mariné' },
  { id: 'tenders', label: 'Tenders' },
  { id: 'steak', label: 'Steak haché' },
  { id: 'merguez', label: 'Merguez' },
  { id: 'cordon', label: 'Cordon bleu' }
];

// Sauces proposées
const TACOS_SAUCES = [
  { id: 'alg', label: 'Algérienne' },
  { id: 'blanche', label: 'Blanche' },
  { id: 'bbq', label: 'Barbecue' },
  { id: 'samourai', label: 'Samouraï' },
  { id: 'ketchup', label: 'Ketchup' },
  { id: 'mayo', label: 'Mayonnaise' }
];

// Suppléments payants
const TACOS_EXTRAS = [
  { id: 'cheddar', label: 'Cheddar', price_cents: 50 },
  { id: 'raclette', label: 'Raclette', price_cents: 70 },
  { id: 'lardons', label: 'Lardons', price_cents: 70 },
  { id: 'jalapenos', label: 'Jalapeños', price_cents: 50 }
];

// État du configurateur
let composerBaseItem = null;
let composerMaxMeats = 1;

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
  composer: document.getElementById('screen-composer'),
  confirmation: document.getElementById('screen-confirmation'),
};

const stepIndicator = document.getElementById('step-indicator');
// Charger la config (nom du snack)
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const headerTitle = document.querySelector('.app-header h1');
    if (headerTitle && data.snackName) {
      headerTitle.textContent = data.snackName;
    }
  } catch (e) {
    console.error('Erreur config', e);
  }
}

// Appeler loadConfig au démarrage
loadConfig();

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
    if (item.category === 'Tacos à composer') {
      openComposer(item);
    } else {
      addToCart(item);
    }
  });
  container.appendChild(div);
});
}

// ==== CONFIGURATEUR DE TACOS SUR-MESURE ====

// Ouvre l'écran de composition pour un tacos sur-mesure
function openComposer(baseItem) {
  composerBaseItem = baseItem;

  // Détermine le nombre max de viandes selon le nom
  const name = baseItem.name.toLowerCase();
  if (name.includes('maxi')) {
    composerMaxMeats = 3;
  } else if (name.includes('double')) {
    composerMaxMeats = 2;
  } else {
    composerMaxMeats = 1;
  }

  document.getElementById('composer-base-name').textContent = baseItem.name;
  document.getElementById('composer-base-price').textContent =
    'Base : ' + (baseItem.price_cents / 100).toFixed(2) + ' €';

  document.getElementById('composer-meats-help').textContent =
    `Choisis jusqu'à ${composerMaxMeats} viande(s).`;

  renderComposerOptions();
  updateComposerTotal();

  showScreen('composer', 'Composition du tacos');
}

// Affiche les options viandes / sauces / extras
function renderComposerOptions() {
  const meatsContainer = document.getElementById('composer-meats');
  const saucesContainer = document.getElementById('composer-sauces');
  const extrasContainer = document.getElementById('composer-extras');

  meatsContainer.innerHTML = '';
  saucesContainer.innerHTML = '';
  extrasContainer.innerHTML = '';

  // Viandes (checkbox + limite)
  TACOS_MEATS.forEach(meat => {
    const label = document.createElement('label');
    label.className = 'composer-chip';
    label.innerHTML = `
      <input type="checkbox" value="${meat.id}" data-type="meat" />
      <span>${meat.label}</span>
    `;
    meatsContainer.appendChild(label);
  });

  // Sauces (checkbox, on conseille 1 ou 2 max)
  TACOS_SAUCES.forEach(sauce => {
    const label = document.createElement('label');
    label.className = 'composer-chip';
    label.innerHTML = `
      <input type="checkbox" value="${sauce.id}" data-type="sauce" />
      <span>${sauce.label}</span>
    `;
    saucesContainer.appendChild(label);
  });

  // Suppléments (checkbox + prix)
  TACOS_EXTRAS.forEach(extra => {
    const label = document.createElement('label');
    label.className = 'composer-chip';
    label.innerHTML = `
      <input type="checkbox" value="${extra.id}" data-type="extra" />
      <span>${extra.label} (+${(extra.price_cents / 100).toFixed(2)}€)</span>
    `;
    extrasContainer.appendChild(label);
  });

  // Gestion des limites et recalcul du total
  document
    .querySelectorAll('#screen-composer input[type="checkbox"]')
    .forEach(input => {
      input.addEventListener('change', onComposerChange);
    });
}

// Gère les changements dans le configurateur (viandes/sauces/extras)
function onComposerChange(e) {
  const input = e.target;
  const type = input.dataset.type;

  if (type === 'meat') {
    const checkedMeats = Array.from(
      document.querySelectorAll('#composer-meats input[type="checkbox"]:checked')
    );
    if (checkedMeats.length > composerMaxMeats) {
      // On empêche de dépasser la limite
      input.checked = false;
      alert(`Tu peux choisir au maximum ${composerMaxMeats} viande(s) pour ce tacos.`);
      return;
    }
  }

  // On ne bloque pas les sauces, mais on pourrait limiter à 2 si tu veux
  updateComposerTotal();
}

// Recalcule le total du tacos en fonction des suppléments
function updateComposerTotal() {
  if (!composerBaseItem) return;

  let total = composerBaseItem.price_cents;

  const extrasChecked = Array.from(
    document.querySelectorAll('#composer-extras input[type="checkbox"]:checked')
  ).map(i => i.value);

  extrasChecked.forEach(id => {
    const extra = TACOS_EXTRAS.find(e => e.id === id);
    if (extra) {
      total += extra.price_cents;
    }
  });

  document.getElementById('composer-total').textContent =
    (total / 100).toFixed(2) + ' €';
}

// Ajoute le tacos composé au panier
function addComposedTacosToCart() {
  if (!composerBaseItem) return;

  const meatsSelected = Array.from(
    document.querySelectorAll('#composer-meats input[type="checkbox"]:checked')
  ).map(i => i.value);

  if (meatsSelected.length === 0) {
    alert('Choisis au moins 1 viande.');
    return;
  }

  const saucesSelected = Array.from(
    document.querySelectorAll('#composer-sauces input[type="checkbox"]:checked')
  ).map(i => i.value);

  if (saucesSelected.length === 0) {
    alert('Choisis au moins 1 sauce.');
    return;
  }

  const extrasSelected = Array.from(
    document.querySelectorAll('#composer-extras input[type="checkbox"]:checked')
  ).map(i => i.value);

  // Construire un label lisible pour le panier
  const meatLabels = meatsSelected
    .map(id => TACOS_MEATS.find(m => m.id === id)?.label || id)
    .join(', ');
  const sauceLabels = saucesSelected
    .map(id => TACOS_SAUCES.find(s => s.id === id)?.label || id)
    .join(', ');
  const extraLabels = extrasSelected
    .map(id => TACOS_EXTRAS.find(ex => ex.id === id)?.label || id)
    .join(', ');

  const parts = [];
  parts.push('Viandes : ' + meatLabels);
  parts.push('Sauces : ' + sauceLabels);
  if (extrasSelected.length > 0) {
    parts.push('Supp : ' + extraLabels);
  }

  const details = parts.join(' | ');

  // Recalcul du prix final
  let finalPrice = composerBaseItem.price_cents;
  extrasSelected.forEach(id => {
    const extra = TACOS_EXTRAS.find(e => e.id === id);
    if (extra) {
      finalPrice += extra.price_cents;
    }
  });

  // On crée un item spécifique (sans fusion avec les autres)
  const cartItem = {
    id: composerBaseItem.id, // identifiant du produit de base
    name: composerBaseItem.name + ' (' + details + ')',
    price_cents: finalPrice,
    quantity: 1
  };

  // On ajoute directement sans fusionner
  cart.push(cartItem);
  renderCart();

  showScreen('cart', 'Étape 4/4 : Panier & créneau');
}

// Boutons du configurateur
document.getElementById('btn-composer-cancel').addEventListener('click', () => {
  showScreen('products', 'Étape 3/4 : Produits');
});

document.getElementById('btn-composer-add').addEventListener('click', () => {
  addComposedTacosToCart();
});

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
