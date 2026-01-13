# Cardio Revisões (SaaS simples) – Firebase Auth + Firestore

Um app web (single page) para:
- Login/cadastro (email e senha)
- Configurar **regras de revisão** (faixas de % de acerto → dias)
- Registrar sessões de estudo (tema, questões, acertos)
- Gerar automaticamente a **próxima data de revisão**
- Agenda com filtros + marcar como revisado

## 1) Criar o projeto no Firebase
1. Firebase Console → **Adicionar projeto**
2. Authentication → **Sign-in method** → habilitar **Email/Password**
3. Firestore Database → **Create database** (modo produção ou teste)
4. Project settings → **Your apps** → **Web app** → copie o `firebaseConfig`.

## 2) Colar o firebaseConfig
Abra `firebase.js` e cole seus dados:
```js
export const firebaseConfig = { ... }
```

## 3) Regras de Firestore (recomendado)
No Firestore → Rules, use algo como:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 4) Rodar localmente (opcional)
Como é estático, você pode abrir o `index.html` direto. Para evitar limitações de módulos, prefira um servidor local:
- VS Code: extensão **Live Server**
- Ou: `python -m http.server 5173`

## 5) Deploy no Firebase Hosting
1. Instale o Firebase CLI: `npm i -g firebase-tools`
2. Login: `firebase login`
3. Na pasta do projeto:
   - `firebase init hosting`
   - escolha o projeto
   - pasta pública: `.` (ponto)
   - configure como SPA? **Yes**
4. Deploy: `firebase deploy`

## Estrutura
- `index.html` – UI
- `styles.css` – tema rosa/dark
- `firebase.js` – config
- `app.js` – lógica (Auth + Firestore)
- `assets/heart.svg` – ícone

Boa prova de residência! 💗
