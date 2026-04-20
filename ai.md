步驟 1：設定 Firebase 專案並連結應用程式
登入 Firebase 控制台，然後選取 Firebase 專案。

還沒有 Firebase 專案嗎？

在 Firebase 控制台中，依序前往「AI Services」(AI 服務) >「AI Logic」(AI 邏輯)。

按一下「開始使用」，即可啟動導覽工作流程，協助您為專案設定必要 API 和資源。

設定專案以使用「Gemini API」供應商。

建議您先使用 Gemini Developer API。 您隨時可以設定 Vertex AI Gemini API (以及帳單的相關規定)。

對於 Gemini Developer API，主控台會啟用必要的 API，並在專案中建立 Gemini API 金鑰。
請勿將這個 Gemini API 金鑰加入應用程式的程式碼集。 瞭解詳情。

如果控制台的工作流程中出現提示，請按照畫面上的指示註冊應用程式，並將其連結至 Firebase。

請繼續按照本指南的下一個步驟，將 SDK 新增至應用程式。

注意： 在 Firebase 控制台中，強烈建議您設定 Firebase App Check。
如果你只是想試用 Gemini API，不一定要立刻設定 App Check。不過，為防範 API 濫用行為，請務必盡早設定 App Check (特別是在分享應用程式或公開發布前)。
步驟 2：新增 SDK
設定 Firebase 專案並將應用程式連結至 Firebase (請參閱上一個步驟) 後，您現在可以將 Firebase AI Logic SDK 新增至應用程式。

Swift
Kotlin
Java
Web
Dart
Unity
Firebase AI Logic 程式庫提供 API，可與 Gemini 模型互動。這個程式庫是 Firebase JavaScript SDK for Web 的一部分。

使用 npm 安裝適用於網頁的 Firebase JS SDK：


npm install firebase
在應用程式中初始化 Firebase：


import { initializeApp } from "firebase/app";

// TODO(developer) Replace the following with your app's Firebase configuration
// See: https://firebase.google.com/docs/web/learn-more#config-object
const firebaseConfig = {
  // ...
};

// Initialize FirebaseApp
const firebaseApp = initializeApp(firebaseConfig);
步驟 3：初始化服務並建立模型例項

按一下 Gemini API 供應商，即可在這個頁面查看供應商專屬內容和程式碼。

Gemini Developer API Vertex AI Gemini API
將提示傳送至 Gemini 模型前，請先初始化所選 API 供應商的服務，並建立 GenerativeModel 例項。

Swift
Kotlin
Java
Web
Dart
Unity


import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

// TODO(developer) Replace the following with your app's Firebase configuration
// See: https://firebase.google.com/docs/web/learn-more#config-object
const firebaseConfig = {
  // ...
};

// Initialize FirebaseApp
const firebaseApp = initializeApp(firebaseConfig);

// Initialize the Gemini Developer API backend service
const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// Create a `GenerativeModel` instance with a model that supports your use case
const model = getGenerativeModel(ai, { model: "gemini-3-flash-preview" });

請注意，視您使用的功能而定，您可能不一定會建立 GenerativeModel 執行個體。如要使用 Gemini Live API串流輸入和輸出內容，請建立 LiveModel 例項。

此外，完成這份入門指南後，請瞭解如何為您的用途和應用程式選擇模型。

重要事項： 強烈建議您先實作 Firebase Remote Config，再發布正式版，這樣就能遠端變更應用程式使用的模型名稱。
步驟 4：將提示要求傳送至模型
您現在可以傳送提示要求給 Gemini 模型。

你可以使用 generateContent()，根據含有文字的提示生成文字：

Swift
Kotlin
Java
Web
Dart
Unity


import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

// TODO(developer) Replace the following with your app's Firebase configuration
// See: https://firebase.google.com/docs/web/learn-more#config-object
const firebaseConfig = {
  // ...
};

// Initialize FirebaseApp
const firebaseApp = initializeApp(firebaseConfig);

// Initialize the Gemini Developer API backend service
const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// Create a `GenerativeModel` instance with a model that supports your use case
const model = getGenerativeModel(ai, { model: "gemini-3-flash-preview" });

// Wrap in an async function so you can use await
async function run() {
  // Provide a prompt that contains text
  const prompt = "Write a story about a magic backpack."

  // To generate text output, call generateContent with the text input
  const result = await model.generateContent(prompt);

  const response = result.response;
  const text = response.text();
  console.log(text);
}

run();
Gemini API 也可串流回應，加快互動速度，並處理多模態提示，包括圖片、影片、音訊和 PDF 等內容。本頁面稍後會提供 Gemini API各項功能的指南連結。
如果發生錯誤，請確認 Firebase 專案已正確設定 Blaze 定價方案，並啟用必要 API。
你還能做些什麼？

進一步瞭解支援的機型
瞭解各種用途適用的模型，以及這些模型的配額和價格。

試試其他功能
進一步瞭解如何從純文字提示詞生成文字，包括如何逐句顯示回應。
透過各種檔案類型 (例如圖片、PDF、影片和音訊) 提示生成文字。
建構多輪對話 (即時通訊)。
從文字和多模態提示生成結構化輸出內容 (例如 JSON)。
生成及編輯圖片： 使用文字和多模態提示生成及編輯圖片。
使用 Gemini Live API 串流輸入和輸出 (包括音訊)。
使用工具 (例如函式呼叫和以 Google 搜尋強化事實基礎)，將 Gemini 模型連結至應用程式的其他部分，以及外部系統和資訊。

瞭解如何控管內容生成
瞭解提示設計，包括最佳做法、策略和提示範例。
設定模型參數，例如溫度參數和輸出詞元數量上限。
使用安全性設定，調整收到可能有害回覆的機率。
您也可以使用 Google AI Studio 測試提示和模型設定，甚至取得生成的程式碼片段。