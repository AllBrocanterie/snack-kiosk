require('dotenv').config();
// ==== 1. IMPORT DES MODULES ====
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const twilio = require('twilio');

// ==== 2. CONFIG DE BASE EXPRESS ====
const app = express();
const PORT = process.env.PORT || 3000;

// Pour lire le JSON dans les requêtes
app.use(express.json());

// Pour servir les fichiers du dossier "public" (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// ==== 3. CONNEXION À LA BASE SQLITE ====
const db = new sqlite3.Database('./snack.db');
// Client Twilio pour les SMS (si les variables sont définies)
let smsClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  smsClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
const basicAuth = require('express-basic-auth');

// Middleware d'authentification pour les routes admin
const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
  challenge: true, // affiche la popup login/mot de passe dans le navigateur
});

// ==== 4. CRÉATION DES TABLES SI ELLES N'EXISTENT PAS ====
db.serialize(() => {
  // Table utilisateurs : login par téléphone
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      name TEXT,
      phone_verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Codes de validation (OTP) envoyés au téléphone
  db.run(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      code TEXT,
      expires_at DATETIME,
      used INTEGER DEFAULT 0
    )
  `);

  // Produits du menu
  db.run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      price_cents INTEGER,
      category TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);

  // Commandes
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      total_cents INTEGER,
      payment_method TEXT,
      slot_time DATETIME,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Détail des articles dans une commande
  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      menu_item_id INTEGER,
      quantity INTEGER,
      unit_price_cents INTEGER
    )
  `);

  // --- INSÉRER QUELQUES PRODUITS DE TEST (une seule fois) ---
  db.run(`
    INSERT OR IGNORE INTO menu_items (id, name, description, price_cents, category) VALUES
    (1, 'Coca-Cola 33cl', 'Boisson gazeuse', 250, 'Boissons'),
    (2, 'Sandwich Jambon', 'Jambon, beurre', 450, 'Sandwichs'),
    (3, 'Brownie', 'Gâteau chocolat', 300, 'Desserts')
  `);
});

// ==== 5. CONFIG DES CRÉNEAUX ====
const OPEN_HOUR = 11;              // ouverture 11h00
const CLOSE_HOUR = 22;             // fermeture 22h00
const SLOT_INTERVAL_MINUTES = 5;   // créneau de 5 minutes
const MAX_ORDERS_PER_SLOT = 2;     // max 2 commandes par créneau

// ==== 6. ENDPOINT : RÉCUPÉRER LES CATÉGORIES ====
app.get('/api/categories', (req, res) => {
  db.all(
    `SELECT DISTINCT category FROM menu_items WHERE is_active = 1`,
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }
      const categories = rows.map(r => r.category);
      res.json({ categories });
    }
  );
});

// ==== 7. ENDPOINT : RÉCUPÉRER LES PRODUITS D'UNE CATÉGORIE ====
app.get('/api/menu', (req, res) => {
  const { category } = req.query;
  if (!category) {
    return res.status(400).json({ error: 'Catégorie manquante' });
  }

  db.all(
    `SELECT * FROM menu_items WHERE is_active = 1 AND category = ?`,
    [category],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }
      res.json({ items: rows });
    }
  );
});

// ==== 8. FONCTION POUR GÉNÉRER DES CRÉNEAUX ====
function generateSlotsForDate(dateStr) {
  const slots = [];
  const start = new Date(`${dateStr}T${String(OPEN_HOUR).padStart(2, '0')}:00:00`);
  const end = new Date(`${dateStr}T${String(CLOSE_HOUR).padStart(2, '0')}:00:00`);

  for (let d = new Date(start); d < end; d.setMinutes(d.getMinutes() + SLOT_INTERVAL_MINUTES)) {
    slots.push(new Date(d));
  }
  return slots;
}

// ==== 9. ENDPOINT : CRÉNEAUX DISPONIBLES POUR UNE DATE ====
app.get('/api/slots', (req, res) => {
  const { date } = req.query; // format 'YYYY-MM-DD'

  if (!date) {
    return res.status(400).json({ error: 'date manquante' });
  }

  const slots = generateSlotsForDate(date);

  // On compte les commandes par créneau pour cette date
  db.all(
    `SELECT slot_time, COUNT(*) as count
     FROM orders
     WHERE DATE(slot_time) = ?
       AND status IN ('pending', 'accepted', 'in_progress')
     GROUP BY slot_time`,
    [date],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }

      const counts = {};
      rows.forEach(r => {
        counts[r.slot_time] = r.count;
      });

      const result = slots.map(s => {
        const iso = s.toISOString();
        const count = counts[iso] || 0;
        return {
          time: iso,
          available: count < MAX_ORDERS_PER_SLOT
        };
      });

      res.json({ slots: result });
    }
  );
});

// ==== 10. ENDPOINT : DEMANDER UN CODE DE CONNEXION PAR TÉLÉPHONE ====
// Étape 1 : l'utilisateur entre son numéro, on génère un code.
app.post('/api/request-login-code', (req, res) => {
  const { phone, name } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Numéro de téléphone manquant' });
  }

  // On cherche si ce téléphone existe déjà
  db.get(
    `SELECT * FROM users WHERE phone = ?`,
    [phone],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }

      const proceedWithUser = (userId) => {
        // Génère un code à 6 chiffres
        const code = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // +15 minutes

        db.run(
          `INSERT INTO verification_codes (user_id, code, expires_at) VALUES (?, ?, ?)`,
          [userId, code, expiresAt],
          (err2) => {
            if (err2) {
              console.error(err2);
              return res.status(500).json({ error: 'Erreur BDD' });
            }

            // En dev : toujours afficher le code dans la console (pratique pour tester)
            console.log(`CODE POUR ${phone} : ${code}`);

            // Si Twilio est configuré, on envoie un vrai SMS
            if (smsClient && process.env.TWILIO_FROM_NUMBER) {
              smsClient.messages
                .create({
                  body: `Votre code de connexion Snack est : ${code}`,
                  from: process.env.TWILIO_FROM_NUMBER,
                  to: phone
                })
                .then(message => {
                  console.log('SMS envoyé, id Twilio :', message.sid);
                })
                .catch(err => {
                  console.error('Erreur envoi SMS', err);
                });
            } else {
              console.log('Twilio non configuré, SMS non envoyé (seulement console)');
            }

            res.json({ message: 'Code envoyé (SMS si configuré, sinon console)' });
          }
        );
      };

      if (user) {
        // Utilisateur existant : on génère juste un code
        proceedWithUser(user.id);
      } else {
        // Nouvel utilisateur : on le crée, puis on génère un code
        db.run(
          `INSERT INTO users (phone, name) VALUES (?, ?)`,
          [phone, name || null],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({ error: 'Erreur création utilisateur' });
            }
            proceedWithUser(this.lastID);
          }
        );
      }
    }
  );
});

// ==== 11. ENDPOINT : VÉRIFIER LE CODE DE CONNEXION ====
// Étape 2 : l'utilisateur entre le code à 6 chiffres.
app.post('/api/verify-login-code', (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Téléphone ou code manquant' });
  }

  // On récupère l'utilisateur + le code le plus récent
  db.get(
    `SELECT u.id as user_id, vc.id as code_id, vc.expires_at, vc.used
     FROM users u
     JOIN verification_codes vc ON vc.user_id = u.id
     WHERE u.phone = ? AND vc.code = ?
     ORDER BY vc.id DESC
     LIMIT 1`,
    [phone, code],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }

      if (!row) {
        return res.status(400).json({ error: 'Code ou téléphone invalide' });
      }

      if (row.used) {
        return res.status(400).json({ error: 'Code déjà utilisé' });
      }

      const now = new Date();
      if (new Date(row.expires_at) < now) {
        return res.status(400).json({ error: 'Code expiré' });
      }

      // Marque le code comme utilisé
      db.run(
        `UPDATE verification_codes SET used = 1 WHERE id = ?`,
        [row.code_id]
      );

      // Marque le téléphone comme vérifié
      db.run(
        `UPDATE users SET phone_verified = 1 WHERE id = ?`,
        [row.user_id]
      );

      // On renvoie l'id utilisateur pour l'auth côté frontend
      res.json({ message: 'Connexion réussie', userId: row.user_id });
    }
  );
});

// ==== 12. ENDPOINT : CRÉER UNE COMMANDE ====
app.post('/api/orders', (req, res) => {
  const { userId, items, paymentMethod, slotTime } = req.body;

  if (!userId || !items || items.length === 0 || !paymentMethod || !slotTime) {
    return res.status(400).json({ error: 'Données manquantes' });
  }

  // Vérifie que le créneau n'est pas déjà plein
  db.get(
    `SELECT COUNT(*) as count FROM orders
     WHERE slot_time = ?
       AND status IN ('pending', 'accepted', 'in_progress')`,
    [slotTime],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }

      if (row.count >= MAX_ORDERS_PER_SLOT) {
        return res.status(400).json({ error: 'Créneau complet' });
      }

      // Calcule le total
      const totalCents = items.reduce(
        (sum, it) => sum + it.price_cents * it.quantity,
        0
      );

      // Crée la commande
      db.run(
        `INSERT INTO orders (user_id, total_cents, payment_method, slot_time, status)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, totalCents, paymentMethod, slotTime, 'pending'],
        function (err2) {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: 'Erreur BDD' });
          }

          const orderId = this.lastID;

          // Insère les lignes de commande
          const stmt = db.prepare(
            `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_cents)
             VALUES (?, ?, ?, ?)`
          );

          items.forEach(it => {
            stmt.run(orderId, it.id, it.quantity, it.price_cents);
          });

          stmt.finalize();

          // Ici tu pourrais appeler le système de gestion existant (POS)
          // pour lui envoyer la commande (via API, fichier, etc.)

          res.json({ message: 'Commande créée', orderId });
        }
      );
    }
  );
});
// ==== 14. ENDPOINT ADMIN : LISTE DES COMMANDES DU JOUR ====
// GET /api/admin/orders?date=YYYY-MM-DD (date optionnelle, par défaut aujourd'hui)
app.get('/api/admin/orders', adminAuth, (req, res) => {
  let { date } = req.query;

  if (!date) {
    // si pas de date fournie, on prend la date du jour
    date = new Date().toISOString().slice(0, 10);
  }

  db.all(
    `
    SELECT
      o.id,
      o.slot_time,
      o.status,
      o.total_cents,
      u.phone,
      GROUP_CONCAT(mi.name || ' x' || oi.quantity, ', ') AS items
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN order_items oi ON oi.order_id = o.id
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE DATE(o.slot_time) = ?
    GROUP BY o.id
    ORDER BY o.slot_time ASC
    `,
    [date],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }
      res.json({ orders: rows });
    }
  );
});

// ==== 15. ENDPOINT ADMIN : CHANGER LE STATUT D'UNE COMMANDE ====
// POST /api/admin/orders/:id/status  { status: 'in_progress' | 'ready' | 'completed' }
app.post('/api/admin/orders/:id/status', adminAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ['pending', 'in_progress', 'ready', 'completed'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }

  db.run(
    `UPDATE orders SET status = ? WHERE id = ?`,
    [status, id],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur BDD' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Commande introuvable' });
      }

      res.json({ message: 'Statut mis à jour' });
    }
  );
});
app.get('/healthz', (req, res) => {
  res.send('OK');
});
// ==== 13. LANCER LE SERVEUR ====
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
