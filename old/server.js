import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, updateDoc, setDoc, getDoc, Timestamp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app-check.js";

import { getState, DOM, CONFIG, handleAppError } from "./dataManager.js";
import { closeReportModal } from "./modal.js";
import { getMaintenanceRepop } from "./cal.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBikwjGsjL_PVFhx3Vj-OeJCocKA_hQOgU",
    authDomain: "the-hunt-ifrit.firebaseapp.com",
    projectId: "the-hunt-ifrit",
    storageBucket: "the-hunt-ifrit.firebasestorage.app",
    messagingSenderId: "285578581189",
    appId: "1:285578581189:web:4d9826ee3f988a7519ccac"
};

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Firebase App Check
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider('6LeFtbYsAAAAAJETFxeUWd2IOe92slrZcYcZFHeT'),
    isTokenAutoRefreshEnabled: true
});

export async function initializeAuth() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                unsubscribe();
                resolve(user.uid);
            } else {
                signInAnonymously(auth)
                    .catch((error) => {
                        console.error("Anonymous sign-in failed:", error);
                        unsubscribe();
                        resolve(null);
                    });
            }
        });
        setTimeout(() => {
            unsubscribe();
            resolve(auth.currentUser ? auth.currentUser.uid : null);
        }, CONFIG.AUTH_TIMEOUT);
    });
}

export async function getUserData(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
            return userSnap.data();
        }
    } catch (error) {
        handleAppError(error, "ユーザーデータ取得失敗", false);
    }
    return null;
}

export function subscribeMobStatusDocs(onUpdate) {
    const docIds = ["s_latest", "a_latest", "f_latest"];
    const mobStatusDataMap = {};
    const unsubs = docIds.map(id =>
        onSnapshot(doc(db, "mob_status", id), snap => {
            const data = snap.data();
            if (data) mobStatusDataMap[id] = data;
            onUpdate(mobStatusDataMap);
        })
    );
    return () => unsubs.forEach(u => u());
}

export function subscribeMobMemos(onUpdate) {
    const memoDocRef = doc(db, "shared_data", "memo");
    const unsub = onSnapshot(memoDocRef, snap => {
        const data = snap.data() || {};
        onUpdate(data);
    });
    return unsub;
}

export function subscribeMaintenance(onUpdate) {
    const maintenanceDocRef = doc(db, "shared_data", "maintenance");
    const unsub = onSnapshot(maintenanceDocRef, snap => {
        const data = snap.data() || null;
        onUpdate(data);
    }, err => {
        onUpdate(null);
    });
    return unsub;
}

function normalizePoints(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("points.")) {
            const [, locId, field] = key.split(".");
            if (!result[locId]) result[locId] = {};
            result[locId][field] = value;
        }
        else if (key === "points" && typeof value === "object" && value !== null) {
            for (const [locId, locData] of Object.entries(value)) {
                if (!result[locId]) result[locId] = {};
                Object.assign(result[locId], locData);
            }
        }
    }
    return result;
}

export function subscribeMobLocations(onUpdate) {
    const unsub = onSnapshot(collection(db, "mob_locations"), snapshot => {
        const map = {};
        snapshot.forEach(docSnap => {
            const docId = docSnap.id;
            const data = docSnap.data();
            const normalized = normalizePoints(data);
            map[docId] = normalized;
        });
        onUpdate(map);
    });
    return unsub;
}

function ensureAuth() {
    const { isVerified, lodestoneId, userId, mobs } = getState();
    if (!isVerified || !lodestoneId || !userId) return null;
    return { lodestoneId, userId, mobs };
}

export const submitReport = async (mobNo, timeISO) => {
    const authData = ensureAuth();
    if (!authData) return { success: false, error: "認証エラー" };

    const { lodestoneId, mobs } = authData;
    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) return { success: false, error: "Mobデータが見つかりません" };

    let killTimeDate;
    if (timeISO) {
        killTimeDate = new Date(timeISO);
        if (isNaN(killTimeDate.getTime())) {
            killTimeDate = new Date();
        }
    } else {
        killTimeDate = new Date();
    }

    const modalStatusEl = DOM.modalStatus;
    const forceSubmitEl = DOM.modalForceSubmit;
    const isForceSubmit = forceSubmitEl ? forceSubmitEl.checked : false;
    const nowMs = Date.now();
    if (killTimeDate.getTime() > nowMs + CONFIG.REPORT_FUTURE_THRESHOLD) {
        if (modalStatusEl) {
            modalStatusEl.textContent = "現在時刻より10分以上未来の時刻は報告できません。";
            modalStatusEl.classList.add("text-error");
        }
        return { success: false, error: "現在時刻より10分以上未来の時刻は報告できません。" };
    }

    if (!isForceSubmit && mob.last_kill_time) {
        let maintenance = getState().maintenance;
        if (maintenance && maintenance.maintenance) {
            maintenance = maintenance.maintenance;
        }

        const { minRepop } = getMaintenanceRepop(mob, mob.last_kill_time || 0, maintenance, nowMs / 1000);
        const minRepopTimeMs = minRepop * 1000;
        const allowedTimeMs = minRepopTimeMs - CONFIG.REPORT_EARLY_THRESHOLD;

        if (killTimeDate.getTime() < allowedTimeMs) {
            const allowedDate = new Date(allowedTimeMs);
            const timeStr = allowedDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

            if (modalStatusEl) {
                modalStatusEl.textContent = `まだ湧き時間になっていません。\n最短でも ${timeStr} 以降である必要があります。\n(強制送信する場合はチェックを入れてください)`;
                modalStatusEl.classList.add("text-error", "whitespace-pre-wrap");
            }
            return { success: false, error: `最短でも ${timeStr} 以降の時刻で報告してください。` };
        }
    }

    closeReportModal();

    try {
        let collectionSuffix = "s_latest";
        if (mob.rank === "A") collectionSuffix = "a_latest";
        else if (mob.rank === "F") collectionSuffix = "f_latest";

        const docRef = doc(db, "mob_status", collectionSuffix);

        const prevTimeSeconds = mob.last_kill_time || 0;
        const prevTimestamp = prevTimeSeconds > 0
            ? Timestamp.fromMillis(prevTimeSeconds * 1000)
            : null;

        const newData = {
            [mobNo]: {
                last_kill_time: Timestamp.fromDate(killTimeDate),
                prev_kill_time: prevTimestamp,
                reporter_id: lodestoneId
            }
        };

        await setDoc(docRef, newData, { merge: true });
        return { success: true };

    } catch (error) {
        handleAppError(error, "報告送信失敗");
        return {
            success: false,
            error: error.message || "通信失敗",
            code: error.code || (error.message.includes("permission") ? "permission-denied" : "unknown")
        };
    }
};

export const submitMemo = async (mobNo, memoText) => {
    const authData = ensureAuth();
    if (!authData) return { success: false, error: "認証エラー" };

    const { lodestoneId, mobs } = authData;
    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) return { success: false, error: "Mobデータエラー" };

    if (memoText && memoText.length > CONFIG.MEMO_MAX_LENGTH) {
        return { success: false, error: "メモは30文字以内で入力してください" };
    }

    try {
        const docRef = doc(db, "shared_data", "memo");

        if (!memoText || memoText.trim() === "") {
            await setDoc(docRef, {
                [mobNo]: []
            }, { merge: true });
            return { success: true };
        }

        const memoData = {
            memo_text: memoText,
            created_at: Timestamp.now(),
            reporter_id: lodestoneId
        };

        await setDoc(docRef, {
            [mobNo]: [memoData]
        }, { merge: true });

        return { success: true };

    } catch (error) {
        handleAppError(error, "メモ保存失敗");
        return { success: false, error: error.message || "通信または認証に失敗しました。" };
    }
};

export const toggleCrushStatus = async (mobNo, area, locationId, nextCulled) => {
    const authData = ensureAuth();
    if (!authData) return { success: false };

    const { lodestoneId } = authData;
    if (!area) return { success: false };

    try {
        const instance = mobNo % 10;
        const docRef = doc(db, "mob_locations", `${area}_${instance}`);
        const fieldName = nextCulled ? "culled_at" : "uncull_at";
        const updateKey = `points.${locationId}.${fieldName}`;

        const updatePayload = {
            [updateKey]: Timestamp.now(),
            [`points.${locationId}.reporter_id`]: lodestoneId
        };

        await setDoc(docRef, updatePayload, { merge: true });
        return { success: true };
    } catch (error) {
        handleAppError(error, "スポーン状態更新失敗", false);
        return { success: false };
    }
};

export async function registerUserToFirestore(lodestoneId, characterName) {
    try {
        let user = auth.currentUser;
        if (!user) {
            await initializeAuth();
            user = auth.currentUser;
        }
        if (!user) return;

        const userDocRef = doc(db, "users", user.uid);
        await setDoc(userDocRef, {
            lodestone_id: lodestoneId,
            character_name: characterName,
            updated_at: Timestamp.now()
        }, { merge: true });
    } catch (error) {
        handleAppError(error, "Firestoreユーザー登録失敗", false);
    }
}

const VERIFICATION_PROXY_URL = "https://icy-resonance-2526.the-hunt-ifrit.workers.dev/";

export async function verifyLodestoneCharacter(lodestoneId, verificationCode) {
    if (!VERIFICATION_PROXY_URL) {
        return {
            success: false,
            error: "認証プロキシのURLが設定されていません。管理者に連絡してください。"
        };
    }

    try {
        let user = auth.currentUser;
        if (!user) {
            console.log("Auth user is null, initializing...");
            await initializeAuth();
            user = auth.currentUser;
        }

        if (!user) {
            throw new Error("Firebase Auth user could not be initialized.");
        }

        const token = await user.getIdToken();
        const fetchUrl = `${VERIFICATION_PROXY_URL}?lodestoneId=${encodeURIComponent(lodestoneId)}`;

        const response = await fetch(fetchUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                return { success: false, error: "キャラクターが見つかりませんでした。" };
            }
            if (response.status === 401) {
                return { success: false, error: "認証エラーが発生しました。ページを再読み込みして試してください。" };
            }
            if (response.status === 403) {
                return { success: false, error: "アクセスが拒否されました。日本国外からのアクセス、またはプロキシ利用は制限されています。" };
            }
            throw new Error(`プロキシ・サーバーエラー: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(html, "text/html");

        const bioEl = parsedDoc.querySelector(".character__selfintroduction");
        const nameEl = parsedDoc.querySelector(".frame__chara__box .frame__chara__name");

        const bio = bioEl?.textContent?.trim() || "";
        const name = nameEl?.textContent?.trim() || "Unknown";

        if (bio.includes(verificationCode)) {
            return { success: true, characterName: name };
        } else {
            return {
                success: false,
                error: "検証コードが自己紹介文に見つかりませんでした。保存から反映まで最大5分程度かかる場合があります。また、言語設定が日本語(JP)であることを確認してください。"
            };
        }
    } catch (error) {
        handleAppError(error, "Lodestone認証失敗");
        return {
            success: false,
            error: `認証に失敗しました。(${error.message || "Unknown Error"})`
        };
    }
}


