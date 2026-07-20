// Serveur Node/Express pour l'envoi de notifications FCM.
// Même principe que le serveur Render déjà utilisé pour Huinest Food.
// À déployer séparément (Render, Railway...) — les tokens FCM ne peuvent
// PAS être envoyés depuis le navigateur, il faut une clé de compte de
// service (service account) côté serveur.

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const cron = require('node-cron');
require('dotenv').config();

// --- Initialisation Firebase Admin ---
// Récupérez le fichier JSON de clé de compte de service depuis :
// Firebase Console > Paramètres du projet > Comptes de service > Générer une nouvelle clé privée
// Collez son contenu (en une seule ligne) dans la variable d'env FIREBASE_SERVICE_ACCOUNT.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
app.use(cors());
app.use(express.json());

// --------------------------------------------------------------
// POST /api/register-token
// Abonne le jeton FCM d'un appareil à un ou plusieurs topics.
// Appelé côté client juste après l'obtention du token (voir messaging.ts).
// --------------------------------------------------------------
app.post('/api/register-token', async (req, res) => {
  const { uid, token, topics } = req.body;

  if (!token || !Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'token et topics (tableau) sont requis.' });
  }

  try {
    for (const topic of topics) {
      await admin.messaging().subscribeToTopic(token, topic);
    }
    console.log(`Token abonné (uid=${uid || 'inconnu'}) aux topics: ${topics.join(', ')}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur abonnement topic:', err);
    res.status(500).json({ error: 'Échec de l\'abonnement au topic.' });
  }
});

// --------------------------------------------------------------
// POST /api/send-notification
// Envoie une notification à un topic (ex: "all-members").
// Appelé depuis le Cockpit Admin (AdminDashboard.tsx).
// --------------------------------------------------------------
app.post('/api/send-notification', async (req, res) => {
  const { title, body, topic } = req.body;

  if (!title || !body || !topic) {
    return res.status(400).json({ error: 'title, body et topic sont requis.' });
  }

  try {
    const messageId = await admin.messaging().send({
      topic,
      notification: { title, body },
      webpush: {
        notification: {
          icon: '/assets/logo.jpg',
        },
      },
    });
    console.log(`Notification envoyée (${messageId}) au topic "${topic}"`);
    res.json({ success: true, messageId });
  } catch (err) {
    console.error('Erreur envoi notification:', err);
    res.status(500).json({ error: 'Échec de l\'envoi de la notification.' });
  }
});

// --------------------------------------------------------------
// Rappels automatiques programmés (heure d'Abidjan = GMT, pas de décalage DST)
// Adaptez les horaires/jours si votre programme change.
// --------------------------------------------------------------
function sendReminder(title, body, topic = 'all-members') {
  admin.messaging()
    .send({ topic, notification: { title, body } })
    .then(id => console.log(`Rappel auto envoyé (${id}): ${title}`))
    .catch(err => console.error('Erreur rappel auto:', err));
}

// Mercredi 17h30 GMT — rappel culte d'enseignement (18h30)
cron.schedule('30 17 * * 3', () => {
  sendReminder(
    'Culte d\'enseignement dans 1h',
    'Rendez-vous à 18h30 à l\'Auditorium Central. Ne manquez pas ce temps de doctrine !'
  );
});

// Vendredi 21h00 GMT — rappel veillée de combat spirituel (22h00)
cron.schedule('0 21 * * 5', () => {
  sendReminder(
    'Grande veillée ce soir dans 1h',
    'La veillée de combat spirituel débute à 22h00 jusqu\'à 02h00. Préparez votre cœur !'
  );
});

// Dimanche 07h00 GMT — rappel culte d'impact (08h00)
cron.schedule('0 7 * * 0', () => {
  sendReminder(
    'Culte du dimanche dans 1h',
    'Le culte d\'impact et de miracles commence à 08h00. Venez nombreux !'
  );
});

// Lundi 09h00 GMT — bilan hebdomadaire (exemple, à enrichir avec de vraies stats Firestore)
cron.schedule('0 9 * * 1', () => {
  sendReminder(
    'Bilan de la semaine — Christ Army',
    'Consultez le résumé des activités, enrôlements et enseignements publiés la semaine dernière.'
  );
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Serveur de notifications Christ Army démarré sur le port ${PORT}`);
});