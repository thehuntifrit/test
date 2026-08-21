import { getState, setLodestoneId, setCharacterName, setVerified, extractLodestoneId, DOM } from "./dataManager.js";
import { verifyLodestoneCharacter, registerUserToFirestore } from "./server.js";
import { cloneTemplate } from "./mobCard.js";

let isLoaded = false;
let currentVCode = "";

export const openUserManual = async () => {
    const modal = DOM.manualModal;
    const container = DOM.readmeContainer;
    if (!modal || !container) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    if (!isLoaded) {
        try {
            const loadingMsg = cloneTemplate('ui-message-template');
            if (loadingMsg) {
                loadingMsg.className = "u-text-center u-text-gray-400";
                loadingMsg.textContent = "読み込み中...";
                container.innerHTML = "";
                container.appendChild(loadingMsg);
            }

            const response = await fetch('./README.md');
            if (!response.ok) throw new Error('Failed to load README');

            const text = await response.text();
            marked.setOptions({
                breaks: true,
                gfm: true
            });
            const html = marked.parse(text);
            container.innerHTML = DOMPurify.sanitize(html);
            isLoaded = true;
            updateAuthUI();
        } catch (error) {
            console.error(error);
            const errorMsg = cloneTemplate('ui-message-template');
            if (errorMsg) {
                errorMsg.className = "u-text-red-400 u-text-center";
                errorMsg.textContent = "マニュアルの読み込みに失敗しました。";
                container.innerHTML = "";
                container.appendChild(errorMsg);
            }
        }
    }
};

export const closeUserManual = () => {
    const modal = document.getElementById('manual-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    const modal = DOM.manualModal;
    const closeBtn = DOM.closeManualModalBtn;

    closeBtn?.addEventListener('click', closeUserManual);

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeUserManual();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeUserManual();
        }
    });
});

window.addEventListener('characterNameSet', () => {
    if (isLoaded) updateAuthUI();
});

async function updateAuthUI() {
    const authContainer = DOM.readmeAuthSession;
    if (!authContainer) return;

    const state = getState();
    authContainer.innerHTML = "";

    if (state.isVerified) {
        const verifiedEl = cloneTemplate('auth-verified-template');
        if (verifiedEl) authContainer.appendChild(verifiedEl);
        return;
    }

    if (!currentVCode) {
        const arr = new Uint8Array(6);
        crypto.getRandomValues(arr);
        const code = Array.from(arr).map(b => b.toString(36).toUpperCase()).join('').substring(0, 8);
        currentVCode = "HUNT-" + code;
    }

    const formEl = cloneTemplate('auth-form-template');
    if (!formEl) return;

    const vcodeDisplay = formEl.querySelector('.auth-vcode-display');
    const copyBtn = formEl.querySelector('.auth-copy-btn');
    const verifyBtn = formEl.querySelector('.auth-verify-btn');
    const idInput = formEl.querySelector('.auth-id-input');
    const statusEl = formEl.querySelector('.auth-status-msg');

    if (vcodeDisplay) vcodeDisplay.textContent = currentVCode;

    copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(currentVCode);
        const original = copyBtn.textContent;
        copyBtn.textContent = "Done!";
        setTimeout(() => copyBtn.textContent = original, 2000);
    });

    verifyBtn?.addEventListener('click', async () => {
        const raw = idInput.value.trim();
        const lodestoneId = extractLodestoneId(raw);

        if (!lodestoneId) {
            statusEl.textContent = "正しいIDまたはURLを入力してください";
            statusEl.className = "text-xs text-red-400";
            return;
        }

        statusEl.textContent = "検証中...";
        statusEl.className = "text-xs text-cyan-400 auth-status-msg";
        verifyBtn.disabled = true;

        try {
            const result = await verifyLodestoneCharacter(lodestoneId, currentVCode);
            verifyBtn.disabled = false;

            if (result.success) {
                statusEl.textContent = "検証成功！登録しています...";
                await registerUserToFirestore(lodestoneId, result.characterName);
                setLodestoneId(lodestoneId);
                setCharacterName(result.characterName);
                setVerified(true);
                updateAuthUI();
            } else {
                statusEl.textContent = result.error;
                statusEl.className = "text-xs text-red-400 auth-status-msg";
                verifyBtn.disabled = false;
            }
        } catch (err) {
            statusEl.textContent = `エラー: ${err.message || "通信失敗"}`;
            statusEl.className = "text-xs text-red-400 auth-status-msg";
            verifyBtn.disabled = false;
        }
    });

    authContainer.appendChild(formEl);
}


