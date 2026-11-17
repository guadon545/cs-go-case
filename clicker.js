
(function () {
    "use strict";

    const API = "https://cs-go-case.onrender.com";
    const tg = window.Telegram && window.Telegram.WebApp;

    let busy = false;
    let clickerLoaded = false;
    let balance = 0;
    let totalClicks = 0;
    let rewardPerClick = 1;

    async function request(path, options = {}) {
        if (!tg || !tg.initData) {
            throw new Error("Открой приложение через Telegram");
        }

        const response = await fetch(API + path, {
            ...options,
            headers: {
                "X-Telegram-Init-Data": tg.initData,
                ...(options.headers || {})
            }
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Ошибка сервера");
        }
        return data;
    }

    function addClickerInterface() {
        const homeGrid = document.querySelector("#home .grid");
        const main = document.querySelector("main.container");

        if (!homeGrid || !main || document.getElementById("clicker")) return;

        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <div class="card-icon">🖱️</div>
            <div class="card-name">Кликер</div>
            <div class="card-description">Зарабатывай GUADON COIN</div>
        `;
        card.addEventListener("click", () => window.showPage("clicker"));
        homeGrid.appendChild(card);

        const page = document.createElement("section");
        page.className = "page";
        page.id = "clicker";
        page.innerHTML = `
            <h2 class="section-title">🖱️ GUADON Кликер</h2>
            <div class="balance">
                <div class="balance-label">ТВОЙ БАЛАНС</div>
                <div class="balance-number" id="clicker-balance">Загрузка...</div>
                <div class="balance-currency">GUADON COIN</div>
            </div>
            <div class="clicker-stats">
                <div class="clicker-stat">
                    <div class="clicker-stat-label">Всего кликов</div>
                    <div class="clicker-stat-value" id="clicker-total">—</div>
                </div>
                <div class="clicker-stat">
                    <div class="clicker-stat-label">За один клик</div>
                    <div class="clicker-stat-value" id="clicker-reward">1 DC</div>
                </div>
            </div>
            <button id="clicker-button" class="clicker-main-button" type="button">
                <span class="clicker-button-icon">⚡</span>
                <span>НАЖМИ И ПОЛУЧИ DC</span>
                <small>+1 GUADON COIN</small>
            </button>
            <div id="clicker-message" class="notice"></div>
            <div class="small-note">
                За каждое успешное нажатие начисляется 1 DC.
                Между нажатиями действует серверная задержка.
            </div>
        `;
        main.appendChild(page);

        const style = document.createElement("style");
        style.textContent = `
            .clicker-stats {
                display:grid;
                grid-template-columns:1fr 1fr;
                gap:12px;
                margin:16px 0;
            }
            .clicker-stat {
                background:#121b2d;
                border:1px solid #263550;
                border-radius:14px;
                padding:16px 10px;
                text-align:center;
            }
            .clicker-stat-label {
                color:#8797b2;
                font-size:12px;
                margin-bottom:8px;
            }
            .clicker-stat-value {
                color:#8ebaff;
                font-size:23px;
                font-weight:900;
            }
            .clicker-main-button {
                width:100%;
                min-height:190px;
                border:1px solid #668cff;
                border-radius:22px;
                background:linear-gradient(145deg,#234d91,#5739a8);
                color:white;
                display:flex;
                flex-direction:column;
                align-items:center;
                justify-content:center;
                gap:10px;
                font-size:17px;
                font-weight:900;
                box-shadow:0 10px 30px #142b5066;
                cursor:pointer;
                touch-action:manipulation;
                transition:transform .08s,opacity .15s;
            }
            .clicker-main-button:active {
                transform:scale(.97);
            }
            .clicker-main-button:disabled {
                opacity:.65;
                cursor:wait;
            }
            .clicker-button-icon {
                font-size:58px;
                line-height:1.2;
            }
            .clicker-main-button small {
                color:#c4d6ff;
                font-size:12px;
                font-weight:normal;
            }
            .clicker-pop {
                animation:clickerPop .22s ease;
            }
            @keyframes clickerPop {
                0%{transform:scale(1)}
                50%{transform:scale(.96)}
                100%{transform:scale(1)}
            }
        `;
        document.head.appendChild(style);

        document.getElementById("clicker-button")
            .addEventListener("click", makeClick);
    }

    function showClickerMessage(message, type) {
        const box = document.getElementById("clicker-message");
        if (!box) return;
        box.textContent = message;
        box.className = "notice " + type;
    }

    function renderClicker(data) {
        balance = Number(data.balance || 0);
        totalClicks = Number(data.total_clicks || 0);
        rewardPerClick = Number(data.reward_per_click || 1);

        document.getElementById("clicker-balance").textContent =
            balance.toLocaleString("ru-RU") + " DC";
        document.getElementById("clicker-total").textContent =
            totalClicks.toLocaleString("ru-RU");
        document.getElementById("clicker-reward").textContent =
            rewardPerClick.toLocaleString("ru-RU") + " DC";

        const button = document.getElementById("clicker-button");
        button.querySelector("small").textContent =
            "+" + rewardPerClick.toLocaleString("ru-RU") + " GUADON COIN";
    }

    async function loadClicker() {
        if (clickerLoaded) return;

        try {
            const data = await request("/api/clicker");
            renderClicker(data);
            clickerLoaded = true;
        } catch (error) {
            showClickerMessage("❌ " + error.message, "error");
            document.getElementById("clicker-balance").textContent = "Ошибка";
        }
    }

    async function makeClick() {
        if (busy) return;

        busy = true;
        const button = document.getElementById("clicker-button");
        button.disabled = true;
        button.classList.add("clicker-pop");

        try {
            const data = await request("/api/clicker/click", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({})
            });

            renderClicker(data);
            showClickerMessage(
                "✅ +" + Number(data.earned || rewardPerClick) + " DC начислено!",
                "success"
            );

            const mainBalance = document.getElementById("balance");
            if (mainBalance) {
                mainBalance.textContent = balance.toLocaleString("ru-RU") + " DC";
            }

            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.impactOccurred("light");
            }
        } catch (error) {
            showClickerMessage("❌ " + error.message, "error");
        } finally {
            busy = false;
            button.disabled = false;
            button.classList.remove("clicker-pop");
        }
    }

    function init() {
        addClickerInterface();

        const originalShowPage = window.showPage;
        if (typeof originalShowPage === "function" && !originalShowPage.__clickerWrapped) {
            const wrappedShowPage = function (page, button) {
                originalShowPage(page, button);
                if (page === "clicker") loadClicker();
            };
            wrappedShowPage.__clickerWrapped = true;
            window.showPage = wrappedShowPage;
        }
    }

    init();
})();
