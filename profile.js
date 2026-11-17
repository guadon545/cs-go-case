
(function () {
    "use strict";

    const API = "https://cs-go-case.onrender.com";

    const style = `
    .profile-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin: 15px 0 22px;
    }
    .profile-stat {
        background: #121b2d;
        border: 1px solid #263550;
        border-radius: 15px;
        padding: 17px 12px;
        text-align: center;
    }
    .profile-stat-icon {
        font-size: 27px;
        margin-bottom: 9px;
    }
    .profile-stat-value {
        font-size: 22px;
        font-weight: 900;
        color: #80b2ff;
        overflow-wrap: anywhere;
    }
    .profile-stat-label {
        color: #8797b2;
        font-size: 11px;
        margin-top: 7px;
    }
    .profile-best {
        background: linear-gradient(135deg,#172d4c,#29204c);
        border: 1px solid #5577bd;
        border-radius: 17px;
        padding: 19px;
        margin: 15px 0;
    }
    .profile-best-title {
        color: #a8bddf;
        font-size: 12px;
        letter-spacing: 1px;
        margin-bottom: 14px;
    }
    .profile-best-name {
        font-size: 17px;
        font-weight: bold;
        overflow-wrap: anywhere;
    }
    .profile-best-price {
        color: #80b2ff;
        font-size: 20px;
        font-weight: 900;
        margin-top: 9px;
    }
    .profile-best-source {
        color: #9aabc5;
        font-size: 12px;
        margin-top: 8px;
    }
    .profile-loading {
        background: #121b2d;
        border: 1px solid #263550;
        border-radius: 15px;
        padding: 20px;
        text-align: center;
        color: #aabbd4;
    }
    `;

    const styleElement = document.createElement("style");
    styleElement.textContent = style;
    document.head.appendChild(styleElement);

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString("ru-RU");
    }

    function getProfileContainer() {
        const section = document.getElementById("profile");
        if (!section) return null;

        let container = document.getElementById("profile-stats-container");

        if (!container) {
            container = document.createElement("div");
            container.id = "profile-stats-container";

            const historyTitle = section.querySelector(".sub-title");

            if (historyTitle) {
                section.insertBefore(container, historyTitle);
            } else {
                section.appendChild(container);
            }
        }

        return container;
    }

    async function loadProfile() {
        const container = getProfileContainer();
        if (!container) return;

        const tg = window.Telegram && window.Telegram.WebApp;

        if (!tg || !tg.initData) {
            container.innerHTML =
                '<div class="profile-loading">Открой приложение через Telegram.</div>';
            return;
        }

        container.innerHTML =
            '<div class="profile-loading">Загружаем профиль...</div>';

        try {
            const response = await fetch(API + "/api/profile", {
                method: "GET",
                headers: {
                    "X-Telegram-Init-Data": tg.initData
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Ошибка загрузки профиля");
            }

            const profile = data.profile || {};
            const best = profile.best_item;

            let bestHtml = "";

            if (best) {
                bestHtml = `
                    <div class="profile-best">
                        <div class="profile-best-title">
                            🏆 ЛУЧШИЙ ПРЕДМЕТ ЗА ВСЁ ВРЕМЯ
                        </div>
                        <div class="profile-best-name">
                            ${escapeHtml(best.name)}
                        </div>
                        <div class="profile-best-price">
                            ${formatNumber(best.price)} DC
                        </div>
                        <div class="profile-best-source">
                            Получен: ${escapeHtml(best.source === "upgrade" ? "Апгрейд" : "Кейс")}
                        </div>
                    </div>
                `;
            } else {
                bestHtml = `
                    <div class="profile-best">
                        <div class="profile-best-title">
                            🏆 ЛУЧШИЙ ПРЕДМЕТ
                        </div>
                        <div class="profile-best-name">
                            Пока нет полученных предметов
                        </div>
                    </div>
                `;
            }

            container.innerHTML = `
                <h2 class="section-title">📊 Моя статистика</h2>

                <div class="profile-stat" style="margin-bottom:12px">
                    <div class="profile-stat-icon">💰</div>
                    <div class="profile-stat-value">
                        ${formatNumber(profile.balance)} DC
                    </div>
                    <div class="profile-stat-label">ТЕКУЩИЙ БАЛАНС</div>
                </div>

                ${bestHtml}

                <div class="profile-stats">
                    <div class="profile-stat">
                        <div class="profile-stat-icon">📦</div>
                        <div class="profile-stat-value">
                            ${formatNumber(profile.opened_cases)}
                        </div>
                        <div class="profile-stat-label">ОТКРЫТО КЕЙСОВ</div>
                    </div>

                    <div class="profile-stat">
                        <div class="profile-stat-icon">⚡</div>
                        <div class="profile-stat-value">
                            ${formatNumber(profile.successful_upgrades)}
                        </div>
                        <div class="profile-stat-label">УСПЕШНЫХ АПГРЕЙДОВ</div>
                    </div>
                </div>
            `;

        } catch (error) {
            console.error("PROFILE ERROR:", error);

            container.innerHTML = `
                <div class="profile-loading">
                    ❌ Не удалось загрузить профиль.<br><br>
                    ${escapeHtml(error.message)}
                    <br><br>
                    <button class="open-button" onclick="window.loadProfile()">
                        Повторить
                    </button>
                </div>
            `;
        }
    }

    window.loadProfile = loadProfile;

    const originalShowPage = window.showPage;

    if (typeof originalShowPage === "function") {
        window.showPage = function (page, button) {
            originalShowPage(page, button);

            if (page === "profile") {
                loadProfile();
            }
        };
    }
})();
