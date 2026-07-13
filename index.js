// index.js — petit serveur toujours actif (Railway) qui écoute Firestore et envoie
// une vraie notification push (téléphone/navigateur fermé compris) à chaque nouvelle
// commande, sans passer par Cloud Functions ni le plan Blaze.

const express = require('express');
const admin = require('firebase-admin');

// --- Init Firebase Admin ---------------------------------------------------
// Colle le JSON de ta clé de service (Firebase Console → Paramètres du projet →
// Comptes de service → Générer une nouvelle clé privée) en base64 dans la variable
// d'environnement Railway FIREBASE_SERVICE_ACCOUNT_BASE64.
const serviceAccountJson = Buffer.from(
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '',
  'base64'
).toString('utf-8');

if (!serviceAccountJson) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_BASE64 manquant. Le serveur ne peut pas démarrer.');
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const messaging = admin.messaging();

// --- Suivi des commandes déjà notifiées (évite les doublons au redémarrage) -
const startedAt = Date.now();
const notifiedOrderIds = new Set();

async function sendPushForOrder(orderId, order) {
  const tokensSnap = await db.collection('staffDeviceTokens').get();
  const tokens = tokensSnap.docs.map((d) => d.id);

  if (tokens.length === 0) {
    console.log(`Commande #${orderId} : aucun appareil staff enregistré, notification ignorée.`);
    return;
  }

  const message = {
    notification: {
      title: 'Nouvelle Commande ! 🍕',
      body: `Commande #${orderId} de ${order.clientName} (${(order.total || 0).toLocaleString('fr-FR')} FCFA)`,
    },
    tokens,
  };

  const response = await messaging.sendEachForMulticast(message);
  console.log(`Commande #${orderId} : ${response.successCount}/${tokens.length} notifications envoyées.`);

  // Nettoyage des tokens invalides
  const invalidTokens = [];
  response.responses.forEach((res, idx) => {
    if (!res.success) {
      const code = res.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        invalidTokens.push(tokens[idx]);
      }
    }
  });

  await Promise.all(
    invalidTokens.map((t) => db.collection('staffDeviceTokens').doc(t).delete())
  );
}

// --- Écoute Firestore en temps réel -----------------------------------------
function watchOrders() {
  db.collection('orders').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;

        const order = change.doc.data();
        const orderId = change.doc.id;

        const orderTime = order.timestamp ? new Date(order.timestamp).getTime() : 0;
        const isNew = orderTime > startedAt && !notifiedOrderIds.has(orderId);
        const shouldNotify = order.status === 'paid' || order.status === 'received';

        if (isNew && shouldNotify) {
          notifiedOrderIds.add(orderId);
          sendPushForOrder(orderId, order).catch((err) =>
            console.error(`Erreur en envoyant la notification pour #${orderId} :`, err)
          );
        }
      });
    },
    (error) => {
      console.error('Erreur Firestore onSnapshot :', error);
    }
  );
}

watchOrders();
console.log('✅ Serveur de notifications démarré, écoute Firestore (collection "orders")...');

// --- Petit serveur HTTP pour que Railway garde le process actif -------------
const app = express();
app.get('/health', (_req, res) => res.json({ status: 'ok', listening: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Health check dispo sur le port ${port}`));
