// admin.js

// Fonction utilitaire pour formater les heures en français
function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Fonction utilitaire pour formater les montants en euros
function formatPrice(cents) {
  return (cents / 100).toFixed(2) + ' €';
}

// Récupère et affiche les commandes du jour
async function loadOrders() {
  const info = document.getElementById('admin-info');
  const tbody = document.getElementById('orders-body');
  tbody.innerHTML = '';

  info.textContent = 'Chargement des commandes...';

  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch('/api/admin/orders?date=' + today);
  const data = await res.json();

  if (!res.ok) {
    info.textContent = data.error || 'Erreur de chargement';
    return;
  }

  if (!data.orders || data.orders.length === 0) {
    info.textContent = 'Aucune commande pour aujourd\'hui.';
    return;
  }

  info.textContent = `Commandes du ${today} : ${data.orders.length} trouvée(s).`;

  data.orders.forEach(order => {
    const tr = document.createElement('tr');

    // Heure
    const tdTime = document.createElement('td');
    tdTime.textContent = formatTime(order.slot_time);
    tr.appendChild(tdTime);

    // Numéro de commande
    const tdId = document.createElement('td');
    tdId.textContent = '#' + order.id;
    tr.appendChild(tdId);

    // Téléphone
    const tdPhone = document.createElement('td');
    tdPhone.textContent = order.phone || '-';
    tr.appendChild(tdPhone);

    // Articles
    const tdItems = document.createElement('td');
    tdItems.textContent = order.items || '';
    tr.appendChild(tdItems);

    // Total
    const tdTotal = document.createElement('td');
    tdTotal.textContent = formatPrice(order.total_cents);
    tr.appendChild(tdTotal);

    // Statut
    const tdStatus = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'status-badge status-' + order.status;
    let label = '';
    if (order.status === 'pending') label = 'En attente';
    if (order.status === 'in_progress') label = 'En préparation';
    if (order.status === 'ready') label = 'Prête';
    if (order.status === 'completed') label = 'Terminée';
    span.textContent = label || order.status;
    tdStatus.appendChild(span);
    tr.appendChild(tdStatus);

    // Actions
    const tdActions = document.createElement('td');

    const btnPending = document.createElement('button');
    btnPending.textContent = 'Attente';
    btnPending.className = 'btn-small';
    btnPending.addEventListener('click', () => updateStatus(order.id, 'pending'));

    const btnPrep = document.createElement('button');
    btnPrep.textContent = 'Prépa';
    btnPrep.className = 'btn-small';
    btnPrep.addEventListener('click', () => updateStatus(order.id, 'in_progress'));

    const btnReady = document.createElement('button');
    btnReady.textContent = 'Prête';
    btnReady.className = 'btn-small';
    btnReady.addEventListener('click', () => updateStatus(order.id, 'ready'));

    const btnDone = document.createElement('button');
    btnDone.textContent = 'Terminée';
    btnDone.className = 'btn-small';
    btnDone.addEventListener('click', () => updateStatus(order.id, 'completed'));

    tdActions.appendChild(btnPending);
    tdActions.appendChild(btnPrep);
    tdActions.appendChild(btnReady);
    tdActions.appendChild(btnDone);

    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

// Met à jour le statut d'une commande
async function updateStatus(orderId, status) {
  const res = await fetch('/api/admin/orders/' + orderId + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Erreur lors de la mise à jour');
    return;
  }

  // On recharge la liste pour mettre à jour l'affichage
  await loadOrders();
}

// Bouton "Recharger les commandes"
document.getElementById('btn-refresh').addEventListener('click', () => {
  loadOrders();
});

// Charger automatiquement à l'ouverture de la page
loadOrders();
