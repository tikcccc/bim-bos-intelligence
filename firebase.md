
使用 npm

使用 <script> 標記
如果你已使用 npm 和 webpack 或 Rollup 等模組整合工具，則可執行下列指令來安裝最新版 SDK (瞭解詳情)：

npm install firebase
請初始化 Firebase，接著即可開始將 SDK 套用至要使用的產品。

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDapk-SmJvFV6IE7FwBs4hTBl9O48NUMBY",
  authDomain: "jarvis-bom-intellgence.firebaseapp.com",
  projectId: "jarvis-bom-intellgence",
  storageBucket: "jarvis-bom-intellgence.firebasestorage.app",
  messagingSenderId: "961551231808",
  appId: "1:961551231808:web:193ff410b74cc076ee68a5",
  measurementId: "G-W5LJYY4ECM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

如要進一步瞭解適用於網頁應用程式的 Firebase，請查看下列資源：開始使用、Web SDK API 參考資料、使用範例

安裝 Firebase CLI
如要透過 Firebase 託管功能來代管您的網站，則必須使用 Firebase CLI 這項指令列工具。

執行下列 npm 指令，藉此安裝 CLI 或更新至最新版 CLI。

npm install -g firebase-tools
無法順利執行操作嗎？您不妨查看 Firebase CLI 參考資源或變更您的 npm 權限

你可以立即部署，也可以稍後再部署。如要立即部署，請開啟終端機視窗，然後前往網頁應用程式所在的根目錄，或為該應用程式建立根目錄。

登入 Google
firebase login
啟動專案
在應用程式的根目錄中執行這個指令：

firebase init
在 firebase.json 中指定網站
在 firebase.json 設定檔中加入網站 ID。設定完成後，請查看多網站部署作業的最佳做法。

{
  "hosting": {
    "site": "jarvis-bom-intelligence",

    "public": "public",
    ...
  }
}
準備就緒後，即可部署網頁應用程式
將 HTML、CSS 和 JS 等靜態檔案加入應用程式的部署目錄 (預設為「公開」)。接著，從應用程式的根目錄執行下列指令：

firebase deploy --only hosting:jarvis-bom-intelligence
部署之後，請前往「jarvis-bom-intelligence.web.app」查看應用程式