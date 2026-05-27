# 🎧 Hamza — Audoune Facebook Messenger Bot

Bot Messenger IA auto-apprenant pour **Audoune**, entreprise algérienne de prothèses auditives.  
يجاوب بالدارجة، بالفرنسية، وبالعربية — وكيتعلم من كل محادثة! 🤖

---

## ✨ Features

- 🌍 **Multilingual** — Auto-détecte Darija, Français, Arabe et répond dans la langue du client
- 🧠 **AI-powered** — GPT-4o-mini pour des réponses naturelles et intelligentes
- 📚 **Self-learning** — Apprend de chaque conversation, vous notifie pour révision
- 👨‍💼 **Admin interface** — Enseignez à Hamza via des commandes Messenger simples
- 🛒 **Order collection** — Collecte nom, téléphone, wilaya et vous notifie
- ⚡ **Always-on** — Répond 24/7, même quand vos équipes dorment

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Install Node.js
Download from https://nodejs.org and install (LTS version)

### Step 2 — Install dependencies
```bash
cd audoune-messenger-bot
npm install
```

### Step 3 — Create your `.env` file
Copy `.env.example` to `.env`:
```
PAGE_ACCESS_TOKEN=   ← From Facebook App
VERIFY_TOKEN=hamza-audoune-2024
OPENAI_API_KEY=      ← From OpenAI
ADMIN_PSID=          ← Your Facebook Messenger ID
PORT=3000
```

### Step 4 — Get your OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy it → paste in `.env` as `OPENAI_API_KEY`
4. Add $5 credit (enough for thousands of messages)

### Step 5 — Create a Facebook App & Connect your Page

1. Go to https://developers.facebook.com
2. Click **My Apps → Create App → Business**
3. Add **Messenger** product
4. Under **Messenger → Settings**:
   - Select your Audoune Facebook Page
   - Generate a **Page Access Token** → paste in `.env` as `PAGE_ACCESS_TOKEN`

### Step 6 — Deploy to Railway (Free Hosting)

1. Push your code to GitHub (free at github.com)
2. Go to https://railway.app → Login with GitHub
3. **New Project → Deploy from GitHub Repo**
4. Add your environment variables in Railway dashboard
5. Copy your Railway URL (e.g. `https://hamza-audoune.up.railway.app`)

### Step 7 — Connect Webhook to Facebook

1. In Meta Developer → Messenger → Webhooks → **Add Callback URL**
2. URL: `https://your-railway-url.up.railway.app/webhook`
3. Verify Token: `hamza-audoune-2024` (must match your `.env`)
4. Subscribe to: `messages`, `messaging_postbacks`

### Step 8 — Get Your Admin PSID

1. Send any message to your Audoune Facebook Page from **your personal account**
2. Check Railway logs — you'll see `sender.id: 123456789`
3. Copy that number → paste in `.env` as `ADMIN_PSID`
4. Redeploy

### Step 9 — Go Live!

In Meta Developer → Your App → **App Review → Permissions**:
- Request `pages_messaging` permission
- Submit for review (usually 1-3 days)

---

## 👨‍💼 Admin Commands

Send these from **your personal Messenger** to your Audoune Page:

| Command | What it does |
|---------|-------------|
| `!pending` | See new Q&As Hamza learned (needs your review) |
| `!approve [id]` | ✅ Approve — Hamza will use this answer confidently |
| `!correct [id] [answer]` | ✏️ Fix the answer, then approve |
| `!learn [Q] = [A]` | 📝 Manually teach Hamza a new fact |
| `!help` | Show all commands |

### Example Teaching Session:
```
You: !pending

Hamza: 📋 1 fait en attente:
       ID: a1b2c3d4
       Q: Quelle est la garantie?
       A: La garantie est de 6 mois.

You: !correct a1b2c3d4 La garantie est de 12 mois, pièces et main d'oeuvre.

Hamza: ✅ Fait corrigé et approuvé!
```

---

## 🧪 Local Development & Testing

```bash
# Start the bot locally
npm run dev

# In another terminal — expose local server to internet
npx ngrok http 3000

# Use the ngrok URL as your Facebook webhook for testing
# e.g. https://abc123.ngrok.io/webhook
```

---

## 💬 Conversation Examples

**French customer:**
```
Client:  "Bonjour, c'est efficace à quel pourcentage?"
Hamza:   "Bonjour! 😊 L'efficacité dépend de votre type de perte auditive:
          • Légère à modérée → 80 à 90% d'amélioration
          • Sévère → 60 à 75% d'amélioration
          Depuis combien de temps avez-vous des difficultés? 🎯"
```

**Darija customer:**
```
Client:  "واش التوصيل مجاني؟"
Hamza:   "آه! التوصيل مجاني لكل الـ58 ولاية 🇩🇿
          المدة 24 إلى 48 ساعة بعد التأكيد.
          والدفع عند التوصيل، ماشي أونلاين 💳"
```

**Order flow:**
```
Client:  "بغيت نطلب"
Hamza:   "مزيان! 🎉 محتاج اسمك الكامل، رقم هاتفك، وولايتك"
Client:  "Ahmed Benali, 0661234567, Oran"
Hamza:   "✅ ممتاز! طلبك مسجل. غادي يوصلك في 24-48 ساعة"
[Admin gets notified with order details]
```

---

## 📊 Cost Estimate

| Service | Cost |
|---------|------|
| Railway hosting | Free (500h/month) |
| OpenAI GPT-4o-mini | ~$0.50–2/month for a small business |
| Facebook Messenger API | Free |
| **Total** | **~$2/month** |
