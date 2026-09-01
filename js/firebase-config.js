// js/firebase-config.js: Connects your app to Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCF_6foG4Y9Pq9FSbFcpKaoQNi2I_MQiAg",
    authDomain: "futnetsite-de7c3.firebaseapp.com",
    projectId: "futnetsite-de7c3",
    storageBucket: "futnetsite-de7c3.firebasestorage.app",
    messagingSenderId: "540556709101",
    appId: "1:540556709101:web:31d653e4b6d50d67a390e4",
    measurementId: "G-8BFTQ9HWCY"
};

export const appId = 'futnetsite-de7c3';
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Keep user logged in across page refreshes
setPersistence(auth, browserLocalPersistence);