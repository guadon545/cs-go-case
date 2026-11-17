
(function () {
    "use strict";

    const API = "https://cs-go-case.onrender.com";

    let busy = false;
    let clickerLoaded = false;
    let balance = 0;
    let totalClicks = 0;
    let rewardPerClick = 1;

    function getTelegram() {
        return window.Telegram && window.Telegram.WebApp;
    }

    async function request(path, options = {}) {
        const tg = getTelegram();

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

    function addStyles() {
        if (document.getElementById("clicker-styles")) return;

        const style = document.createElement("style");
        style.id = "clicker-styles";

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

            .clicker-area {
                margin:25px 0;
                padding:22px 12px;
                border-radius:22px;
                background:radial-gradient(
                    ellipse at center,
                    #203b65,
                    #152640 55%,
                    #101a2c
                );
                border:1px solid #304b70;
                text-align:center;
                overflow:hidden;
            }

            .clicker-instruction {
                color:#b9c9e7;
                font-size:12px;
                font-weight:900;
                letter-spacing:2px;
                margin-bottom:18px;
            }

            .clicker-main-button {
                width:100%;
                border:0;
                background:transparent;
                color:white;
                display:flex;
                flex-direction:column;
                align-items:center;
                justify-content:center;
                gap:12px;
                cursor:pointer;
                touch-action:manipulation;
                -webkit-tap-highlight-color:transparent;
            }

            .clicker-main-button:disabled {
                opacity:.7;
                cursor:wait;
            }

            .clicker-coin-wrap {
                width:190px;
                height:190px;
                display:flex;
                align-items:center;
                justify-content:center;
                perspective:900px;
                filter:drop-shadow(0 14px 15px #0009);
            }

            .clicker-coin {
                width:174px;
                height:174px;
                border-radius:50%;
                padding:8px;
                box-sizing:border-box;
                display:flex;
                align-items:center;
                justify-content:center;
                background:linear-gradient(
                    135deg,
                    #fff2a8,
                    #e7b83f 17%,
                    #a86b12 35%,
                    #ffe58a 52%,
                    #bd821e 72%,
                    #fff0a4
                );
                border:3px solid #ffe99b;
                box-shadow:
                    0 0 0 3px #956014,
                    0 0 0 6px #eac45f,
                    inset 0 3px 5px #fff9c5,
                    inset 0 -6px 8px #7b4b0b;
            }

            .clicker-coin-face {
                width:100%;
                height:100%;
                border-radius:50%;
                border:3px solid #e9bd55;
                box-sizing:border-box;
                background:radial-gradient(
                    circle at 30% 23%,
                    #416fae,
                    #203e70 55%,
                    #101d39
                );
                display:flex;
                flex-direction:column;
                align-items:center;
                justify-content:center;
                position:relative;
                overflow:hidden;
                box-shadow:
                    inset 0 3px 12px #ffffff24,
                    inset 0 -5px 12px #0008;
            }

            .clicker-coin-face:before {
                content:"";
                position:absolute;
                inset:8px;
                border:1px solid #e7bd61;
                border-radius:50%;
            }

            .clicker-coin-top {
                color:#ffdf81;
                font-size:13px;
                font-weight:1000;
                letter-spacing:3px;
                z-index:1;
            }

            .clicker-coin-logo {
                font-family:Arial,sans-serif;
                font-size:79px;
                line-height:1;
                font-weight:1000;
                font-style:italic;
                background:linear-gradient(
                    135deg,
                    #fff6b8,
                    #f4c64e 45%,
                    #a86c16 75%,
                    #ffeaa0
                );
                -webkit-background-clip:text;
                background-clip:text;
                color:transparent;
                -webkit-text-stroke:1px #eac15b;
                filter:drop-shadow(0 4px 2px #0009);
                z-index:1;
            }

            .clicker-coin-bottom {
                color:#ffdf81;
                font-size:12px;
                font-weight:1000;
                letter-spacing:5px;
                z-index:1;
            }

            .clicker-coin-stars {
                position:absolute;
                bottom:20px;
                color:#f5d77e;
                font-size:9px;
            }

            .clicker-button-text {
                font-size:16px;
                font-weight:1000;
                color:#fff;
            }

            .clicker-main-button small {
                color:#ffdf81;
                font-size:13px;
                font-weight:800;
            }

            .clicker-pop .clicker-coin {
                animation:clickerCoinSpin .55s ease;
            }

            @keyframes clickerCoinSpin {
                0% {transform:scale(1) rotateY(0deg)}
                40% {transform:scale(1.12) rotateY(180deg)}
                75% {transform:scale(.96) rotateY(300deg)}
                100% {transform:scale(1) rotateY(360deg)}
            }

            @media(max-width:360px) {
                .clicker-coin-wrap {
                    width:170px;
                    height:170px;
                }

                .clicker-coin {
                    width:155px;
                    height:155px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function addClickerInterface() {
        const page = document.getElementById("clicker");

        if (!page) {
            console.error("CS GO CASE: страница clicker не найдена");
            return false;
        }

        // Не создаём интерфейс повторно, если он уже существует.
        if (document.getElementById("clicker-button")) {
            return true;
        }

        page.innerHTML = `
            <h2 class="page-title">🪙 GUADON COIN</h2>

            <div class="balance">
                <div class="balance-label">ТВОЙ БАЛАНС</div>
                <div class="balance-number" id="clicker-balance">
                    Загрузка...
                </div>
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

            <div class="clicker-area">
                <div class="clicker-instruction">
                    НАЖИМАЙ НА МОНЕТУ
                </div>

                <button id="clicker-button"
                    class="clicker-main-button"
                    type="button">

                    <span class="clicker-coin-wrap">
                        <span class="clicker-coin">
                            <span class="clicker-coin-face">
                                <span class="clicker-coin-top">GUADON</span>
                                <span class="clicker-coin-logo">G</span>
                                <span class="clicker-coin-bottom">COIN</span>
                                <span class="clicker-coin-stars">★　 ★</span>
                            </span>
                        </span>
                    </span>

                    <span class="clicker-button-text">
                        НАЖМИ И ПОЛУЧИ DC
                    </span>

                    <small id="clicker-button-reward">
                        +1 GUADON COIN
                    </small>
                </button>
            </div>

            <div id="clicker-message" class="notice"></div>

            <div class="small-note">
                За каждое успешное нажатие начисляется DC.
                Между нажатиями действует серверная задержка.
            </div>
        `;

        addStyles();

        const button = document.getElementById("clicker-button");

        if (button && button.dataset.clickerBound !== "true") {
            button.dataset.clickerBound = "true";
            button.addEventListener("click", makeClick);
        }

        return true;
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

        const balanceElement = document.getElementById("clicker-balance");
        const totalElement = document.getElementById("clicker-total");
        const rewardElement = document.getElementById("clicker-reward");
        const buttonReward = document.getElementById("clicker-button-reward");

        if (balanceElement) {
            balanceElement.textContent =
                balance.toLocaleString("ru-RU") + " DC";
        }

        if (totalElement) {
            totalElement.textContent =
                totalClicks.toLocaleString("ru-RU");
        }

        if (rewardElement) {
            rewardElement.textContent =
                rewardPerClick.toLocaleString("ru-RU") + " DC";
        }

        if (buttonReward) {
            buttonReward.textContent =
                "+" + rewardPerClick.toLocaleString("ru-RU") +
                " GUADON COIN";
        }

        const headerBalance = document.getElementById("balance");

        if (headerBalance) {
            headerBalance.textContent =
                balance.toLocaleString("ru-RU") + " DC";
        }
    }

    async function loadClicker() {
        // Каждый раз проверяем, что интерфейс существует.
        if (!addClickerInterface()) return;

        if (clickerLoaded) return;

        try {
            const data = await request("/api/clicker");

            renderClicker(data);
            clickerLoaded = true;

        } catch (error) {
            showClickerMessage("❌ " + error.message, "error");

            const balanceElement =
                document.getElementById("clicker-balance");

            if (balanceElement) {
                balanceElement.textContent = "Ошибка";
            }
        }
    }

    async function makeClick() {
        if (busy) return;

        const button = document.getElementById("clicker-button");

        if (!button) return;

        busy = true;
        button.disabled = true;

        button.classList.remove("clicker-pop");
        void button.offsetWidth;
        button.classList.add("clicker-pop");

        try {
            const data = await request("/api/clicker/click", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({})
            });

            renderClicker(data);

            showClickerMessage(
                "✅ +" + Number(data.earned || rewardPerClick) +
                " DC начислено!",
                "success"
            );

            const tg = getTelegram();

            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.impactOccurred("light");
            }

        } catch (error) {
            showClickerMessage("❌ " + error.message, "error");

        } finally {
            busy = false;

            button.disabled = false;

            setTimeout(() => {
                button.classList.remove("clicker-pop");
            }, 600);
        }
    }

    // Сначала делаем функцию доступной для index.html.
    window.loadClicker = loadClicker;

    function init() {
        addClickerInterface();
    }

    // Запускаем после загрузки HTML.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
